"""Packing-round allocation engine.

The problem this solves: two customers each order 1400 m of the same cotton and
the mill only holds 2400 m. Packing has to hand out a fair share first and then
decide who gets the leftover. The rule is:

1. **Equal fill** -- every participating line receives up to ``round_size``
   metres, capped by its own outstanding demand *and* by an equal share of the
   available stock so a short roll is never handed to the first line in the list.
2. **Priority top-up** -- whatever stock is left after the equal fill goes to
   the highest-ranked outstanding customers, in order, until the roll is empty
   or everyone is fulfilled.

Running that with 2400 m on hand, ``round_size`` of 1000 m, customer A at
1400 m and customer B at 1400 m yields: equal fill gives A 1000 m and B 1000 m
(400 m left), and the top-up gives the remaining 400 m to whichever of the two
is the bigger customer, leaving A at 1400 m and B at 1000 m.

Both orders are placeable precisely because placing an order only records demand;
cloth leaves the warehouse here, when the round is confirmed.

Priority is lifetime metres sold (dispatched order lines). Ties fall back to the
customer's earliest order, then to customer id, so the ordering is total and
stable. An admin can pin a customer to the top of the queue with
``Customer.priority_override``.
"""

from collections import defaultdict
from datetime import datetime as dt_datetime
from datetime import timezone as dt_timezone
from decimal import Decimal

from django.db import transaction
from django.db.models import F, Min, Sum
from django.utils import timezone

from apps.customers.models import Customer
from apps.items.models import FabricVariant
from apps.items.services import sync_out_of_stock
from apps.orders.models import Allocation, Order, OrderItem, OrderLog, PackingRound

ZERO = Decimal("0")

#: Order statuses whose lines still compete for cloth in a packing round.
OPEN_STATUSES = ("PENDING", "PACKED")


# --------------------------------------------------------------------------- #
# Priority
# --------------------------------------------------------------------------- #


def customer_priority(customer_ids):
    """Rank customers for packing priority.

    Returns ``{customer_id: {"rank": int, "metres_sold": Decimal,
    "source": "override"|"sales", "override": int|None}}`` with ``rank`` 0 being
    the highest priority. A customer pinned via ``priority_override`` always
    outranks unpinned ones, and lower override numbers outrank higher ones.

    "Metres sold" is the sum of ``allocated_quantity`` on dispatched lines, i.e.
    cloth that actually left the warehouse. Using ``ordered_quantity`` here would
    over-count partial dispatches and hand priority to a customer who was
    shipped short.
    """
    ids = {cid for cid in customer_ids if cid is not None}
    if not ids:
        return {}

    sold = defaultdict(lambda: ZERO)
    for row in (
        OrderItem.objects.filter(
            order__status="DISPATCHED", order__customer_id__in=ids
        )
        .values("order__customer_id")
        .annotate(total=Sum("allocated_quantity"))
    ):
        sold[row["order__customer_id"]] = row["total"] or ZERO

    first_order = {
        row["customer_id"]: row["first"]
        for row in Order.objects.filter(customer_id__in=ids)
        .values("customer_id")
        .annotate(first=Min("created_at"))
    }

    overrides = dict(
        Customer.objects.filter(id__in=ids).values_list("id", "priority_override")
    )

    epoch = dt_datetime(1970, 1, 1, tzinfo=dt_timezone.utc)

    def sort_key(cid):
        override = overrides.get(cid)
        if override is not None:
            # Pinned customers form their own tier ahead of everyone else.
            return (0, override, ZERO, epoch, cid)
        return (1, 0, -sold.get(cid, ZERO), first_order.get(cid) or epoch, cid)

    ordered = sorted(ids, key=sort_key)

    return {
        cid: {
            "rank": position,
            "metres_sold": sold.get(cid, ZERO),
            "source": "override" if overrides.get(cid) is not None else "sales",
            "override": overrides.get(cid),
        }
        for position, cid in enumerate(ordered)
    }


# --------------------------------------------------------------------------- #
# Demand
# --------------------------------------------------------------------------- #


def outstanding_lines(variant, order_ids=None):
    """Order lines for ``variant`` that packing has not fully satisfied yet."""
    qs = (
        OrderItem.objects.filter(
            variant=variant,
            order__status__in=OPEN_STATUSES,
        )
        .filter(allocated_quantity__lt=F("ordered_quantity"))
        .select_related("order__customer", "order__agent__user", "variant")
        .order_by("order__created_at", "id")
    )
    if order_ids is not None:
        ids = [int(i) for i in order_ids]
        qs = qs.filter(order_id__in=ids)
    return qs


def build_plan(variant, round_size, order_ids=None, available_meters=None):
    """Compute an allocation plan without touching any stock.

    ``available_meters`` overrides the variant's on-hand stock; used by the
    preview endpoint to test a hypothetical.
    """
    round_size = Decimal(str(round_size))
    if round_size <= ZERO:
        raise ValueError("Round size must be greater than zero")

    lines = list(outstanding_lines(variant, order_ids))
    stock = (
        Decimal(str(available_meters))
        if available_meters is not None
        else variant.stock_meters
    )
    stock = max(stock, ZERO)

    result = {
        "variant": variant.pk,
        "round_size": round_size,
        "available_meters": stock,
        "participants": len(lines),
        "fully_covered": False,
        "unallocated_meters": ZERO,
        "shortfall_meters": ZERO,
        "allocations": [],
    }

    if not lines or stock <= ZERO:
        result["unallocated_meters"] = stock
        result["shortfall_meters"] = sum(
            (line.outstanding_quantity for line in lines), ZERO
        )
        return result

    priority = customer_priority({line.order.customer_id for line in lines})

    # An equal share of the roll caps the equal-fill grant, so a short roll is
    # split evenly instead of being consumed by whichever line comes first.
    equal_cap = min(round_size, stock / Decimal(len(lines)))
    per_line = {}

    remaining = stock
    for line in lines:
        grant = min(equal_cap, line.outstanding_quantity, remaining)
        if grant > ZERO:
            per_line[line.pk] = grant
            result["allocations"].append(
                {
                    "order_item": line.pk,
                    "order": line.order_id,
                    "customer": line.order.customer.name,
                    "customer_id": line.order.customer_id,
                    "fabric": line.fabric_name,
                    "variant_display_order": line.variant_display_order,
                    "ordered_quantity": line.ordered_quantity,
                    "already_allocated": line.allocated_quantity,
                    "outstanding_quantity": line.outstanding_quantity,
                    "metres": grant,
                    "sequence": 1,
                    "is_priority_award": False,
                    "priority_rank": priority.get(line.order.customer_id, {}).get(
                        "rank"
                    ),
                }
            )
            remaining -= grant

    # Top-up: leftover stock to the best-ranked customers still short.
    outstanding_by_priority = sorted(
        lines, key=lambda ln: (priority.get(ln.order.customer_id, {}).get("rank", 0), ln.pk)
    )
    for line in outstanding_by_priority:
        if remaining <= ZERO:
            break
        already = per_line.get(line.pk, ZERO)
        gap = line.outstanding_quantity - already
        if gap <= ZERO:
            continue
        grant = min(gap, remaining)
        per_line[line.pk] = already + grant
        result["allocations"].append(
            {
                "order_item": line.pk,
                "order": line.order_id,
                "customer": line.order.customer.name,
                "customer_id": line.order.customer_id,
                "fabric": line.fabric_name,
                "variant_display_order": line.variant_display_order,
                "ordered_quantity": line.ordered_quantity,
                "already_allocated": line.allocated_quantity,
                "outstanding_quantity": line.outstanding_quantity,
                "metres": grant,
                "sequence": 2,
                "is_priority_award": True,
                "priority_rank": priority.get(line.order.customer_id, {}).get("rank"),
            }
        )
        remaining -= grant

    # Fold the two passes into one row per line for display.
    merged = {}
    for entry in result["allocations"]:
        row = merged.setdefault(
            entry["order_item"],
            {**entry, "metres": ZERO, "sequence": 1, "is_priority_award": False},
        )
        row["metres"] += entry["metres"]
        if entry["is_priority_award"]:
            row["is_priority_award"] = True
            row["sequence"] = 2
    result["allocations"] = sorted(
        merged.values(), key=lambda e: (e["priority_rank"] if e["priority_rank"] is not None else 0, e["order_item"])
    )

    total_granted = sum((e["metres"] for e in result["allocations"]), ZERO)
    result["unallocated_meters"] = stock - total_granted
    result["shortfall_meters"] = max(
        ZERO,
        sum((line.outstanding_quantity for line in lines), ZERO) - total_granted,
    )
    result["fully_covered"] = result["shortfall_meters"] <= ZERO
    result["priority"] = {
        str(cid): meta for cid, meta in priority.items()
    }
    return result


# --------------------------------------------------------------------------- #
# Applying
# --------------------------------------------------------------------------- #


def _adjust_stock(variant, delta):
    """Move metres on a variant and re-sync the parent fabric's stock status.

    ``QuerySet.update`` skips ``post_save``, so the ``sync_out_of_stock`` signal
    never fires for packing. Without this the fabric could sit at zero on hand
    with a stale ``out_of_stock_since`` and never get archived.
    """
    FabricVariant.objects.filter(pk=variant.pk).update(
        stock_meters=F("stock_meters") + delta,
        stock_updated_at=timezone.now(),
    )
    variant.refresh_from_db(fields=["stock_meters"])
    sync_out_of_stock(variant.fabric)


def _lock_round(packing_round):
    """Re-read a round under ``SELECT FOR UPDATE`` so status can't race.

    Both confirm and cancel mutate stock, so two admins clicking at the same
    moment must not both read a stale ``DRAFT``/``CONFIRMED`` status and apply
    the plan twice.
    """
    return PackingRound.objects.select_for_update().get(pk=packing_round.pk)


def confirm_round(packing_round, user=None, note=""):
    """Move stock for a draft round and record the allocations.

    Locks the round and the variant so a concurrent round cannot double-confirm
    or overdraw the roll. Recomputes each affected order's total and promotes the
    order to PACKED once every one of its lines is fully allocated.
    """
    with transaction.atomic():
        packing_round = _lock_round(packing_round)
        if packing_round.status != "DRAFT":
            raise ValueError("Only a draft round can be confirmed")

        variant = FabricVariant.objects.select_for_update().get(
            pk=packing_round.variant_id
        )

        plan = build_plan(
            variant,
            packing_round.round_size,
            available_meters=variant.stock_meters,
        )

        if not plan["allocations"]:
            packing_round.status = "CANCELLED"
            packing_round.confirmed_at = timezone.now()
            if note:
                packing_round.note = note
            packing_round.save()
            return packing_round

        lines = {
            line.pk: line
            for line in OrderItem.objects.select_for_update().filter(
                pk__in=[e["order_item"] for e in plan["allocations"]]
            ).select_related("order")
        }

        total_granted = ZERO
        touched_orders = {}
        for entry in plan["allocations"]:
            line = lines.get(entry["order_item"])
            if line is None:
                continue
            if line.outstanding_quantity < entry["metres"]:
                raise ValueError(
                    f"Order #{line.order_id} no longer needs "
                    f"{entry['metres']} m of {line.fabric_name}"
                )

            Allocation.objects.create(
                round=packing_round,
                order_item=line,
                metres=entry["metres"],
                sequence=entry["sequence"],
                is_priority_award=entry["is_priority_award"],
            )
            line.allocated_quantity = line.allocated_quantity + entry["metres"]
            line.save(update_fields=["allocated_quantity"])
            total_granted += entry["metres"]
            touched_orders[line.order_id] = line.order

        # Leftover stock (``plan["unallocated_meters"]``) simply stays on the
        # roll; only what was actually granted comes off it.
        _adjust_stock(variant, -total_granted)

        packing_round.status = "CONFIRMED"
        packing_round.confirmed_at = timezone.now()
        if note:
            packing_round.note = note
        packing_round.save()

        for order in touched_orders.values():
            sync_order_after_allocation(order, user, packing_round)

    return packing_round


def cancel_round(packing_round, user=None):
    """Reverse a confirmed round, returning the metres to the roll."""
    with transaction.atomic():
        packing_round = _lock_round(packing_round)
        if packing_round.status != "CONFIRMED":
            raise ValueError("Only a confirmed round can be cancelled")

        variant = FabricVariant.objects.select_for_update().get(
            pk=packing_round.variant_id
        )

        allocations = list(
            packing_round.allocations.select_related("order_item__order")
        )
        returned = ZERO
        per_order = {}
        orders = {}
        for allocation in allocations:
            line = allocation.order_item
            line.allocated_quantity = max(
                ZERO, line.allocated_quantity - allocation.metres
            )
            line.save(update_fields=["allocated_quantity"])
            returned += allocation.metres
            per_order[line.order_id] = per_order.get(line.order_id, ZERO) + (
                allocation.metres
            )
            orders[line.order_id] = line.order

        if returned > ZERO:
            _adjust_stock(variant, returned)

        packing_round.status = "CANCELLED"
        packing_round.save()

        for order_id, order in orders.items():
            sync_order_after_allocation(
                order,
                user,
                packing_round,
                action="ALLOCATION_REVERSED",
                demote=True,
                extra_details={"metres_returned": str(per_order[order_id])},
            )

    return packing_round


def sync_order_after_allocation(
    order, user, packing_round, action="ALLOCATION_MADE", demote=False,
    extra_details=None,
):
    """Recompute totals, write a log entry, and sync the order's packing state.

    ``demote=True`` walks a fully packed order back to PENDING, which is what
    reversing a round should do.
    """
    from .pricing import recompute_order_total

    recompute_order_total(order)
    order.refresh_from_db()

    lines = list(order.items.all())
    allocated = sum((line.allocated_quantity for line in lines), ZERO)
    ordered = sum((line.ordered_quantity for line in lines), ZERO)
    fully_packed = ordered > ZERO and allocated >= ordered

    if fully_packed and order.status == "PENDING":
        order.status = "PACKED"
        order.save(update_fields=["status"])
    elif not fully_packed and order.status == "PACKED" and demote:
        order.status = "PENDING"
        order.save(update_fields=["status"])

    details = {
        "round": packing_round.pk,
        "variant": packing_round.variant.display_order
        or str(packing_round.variant.fabric_id),
        "round_size": str(packing_round.round_size),
        "allocated_meters": str(allocated),
        "ordered_meters": str(ordered),
    }
    details.update(extra_details or {})

    OrderLog.record(
        order,
        action=action,
        details=details,
        performed_by=user,
    )
