"""Physical stock movements.

``FabricVariant.stock_meters`` is **on-hand stock in the warehouse**, and it moves
in exactly one place: when packing hands cloth to a customer. That is the only
model that makes the business's own scenario work -- two customers each order
1400 m of the same cotton while the mill only holds 2400 m. Both orders must be
placeable; it is the packing round that decides who actually gets cloth.

So placing an order records *demand* and nothing else. Demand is allowed to exceed
supply -- that is precisely the situation the allocation engine exists to
arbitrate. :func:`backorder_report` surfaces the oversubscription so the UI and
the admin notifications can show it, and the packing queue ranks those lines.

Metres leave the roll in :func:`consume_for_allocation` (a confirmed packing
round) and come back in :func:`return_to_stock` (a cancelled round, or a deleted
order whose cloth was never dispatched).
"""

from decimal import Decimal

from django.db.models import (
    DecimalField,
    Exists,
    F,
    OuterRef,
    Subquery,
    Sum,
    Value,
)
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.items.models import Fabric, FabricRoll, FabricVariant
from apps.items.rolls import (
    return_metres_for_allocations,
)
from apps.items.rolls import return_metres_for_lines as return_metres_to_rolls
from apps.items.services import sync_out_of_stock

ZERO = Decimal("0")

#: Order statuses whose lines still compete for cloth in a packing round.
#:
#: A part-dispatched order is still in play: some bundles have gone out on a truck
#: while others are still sealed on the shelf, and those can still be packed. It
#: stays here so its outstanding lines keep competing for cloth.
OPEN_STATUSES = ("PENDING", "PACKED", "PARTIALLY_DISPATCHED")

#: Order statuses that are still alive and may be edited or cancelled.
LIVE_STATUSES = ("DRAFT", "PENDING", "EDITING", "PACKED")


# --------------------------------------------------------------------------- #
# Movements
# --------------------------------------------------------------------------- #


def consume_for_allocation(metres_by_variant):
    """Take ``{variant_id: metres}`` off the roll.

    Callers must already hold a row lock on the variants; the update is a single
    ``F()`` expression per variant so concurrent rounds cannot interleave.
    """
    _apply_stock_delta(metres_by_variant, consume=True)


def return_to_stock(metres_by_variant):
    """Put ``{variant_id: metres}`` back on the roll."""
    _apply_stock_delta(metres_by_variant, consume=False)


def _apply_stock_delta(metres_by_variant, consume):
    """Move metres on the named variants and re-sync each parent fabric.

    ``QuerySet.update`` skips ``post_save``, so without the explicit
    ``sync_out_of_stock`` call a fabric could be left at zero on hand with a
    stale ``out_of_stock_since`` and never get archived.
    """
    from apps.items.models import FabricVariant
    from apps.items.services import sync_out_of_stock

    now = timezone.now()
    touched = []
    for variant_id, metres in (metres_by_variant or {}).items():
        metres = Decimal(str(metres or 0))
        if metres <= ZERO or variant_id is None:
            continue
        delta = -metres if consume else metres
        FabricVariant.objects.filter(pk=variant_id).update(
            stock_meters=F("stock_meters") + delta,
            stock_updated_at=now,
        )
        touched.append(variant_id)

    if touched:
        for fabric in Fabric.objects.filter(
            variants__id__in=touched
        ).distinct():
            sync_out_of_stock(fabric)


def allocated_totals_by_variant(lines):
    """``{variant_id: metres}`` of cloth physically moved for these lines.

    Uses ``allocated_quantity`` because that is the only quantity that has
    actually left the roll -- ``ordered_quantity`` is just demand.
    """
    totals = {}
    for line in lines:
        if line.variant_id is None:
            continue
        metres = Decimal(str(line.allocated_quantity or 0))
        if metres <= ZERO:
            continue
        totals[line.variant_id] = totals.get(line.variant_id, ZERO) + metres
    return totals


def stock_movement_for_lines(lines, direction="consume", keep_allocation_ids=None):
    """Move the cloth allocated to ``lines`` on or off the roll.

    ``direction`` is ``"consume"`` (cloth leaves the warehouse) or ``"return"``
    (cloth comes back, e.g. deleting an order that was never dispatched).
    Performs the update and returns the ``{variant_id: metres}`` map it applied,
    which is empty when none of the lines had been allocated.

    On the way back, cloth from a colour with physical rolls is credited to the
    exact rolls it was cut from, found through each line's allocation records.
    Cloth packed before rolls existed has no records and simply goes back on the
    warehouse total.

    ``keep_allocation_ids`` narrows a ``"return"`` to one set of allocations instead
    of everything these lines have. This exists for deleting an order whose bundles
    have partly shipped: a line's metres can sit in a bundle that went out on a truck
    and a bundle still on the shelf, and only the shelf one may come back. It is
    counted per allocation rather than per line for exactly that reason -- the line
    total cannot tell the two apart. Ignored for ``"consume"``.
    """
    lines = list(lines)

    if direction == "return" and keep_allocation_ids is not None:
        return _return_named_allocations(keep_allocation_ids)

    totals = allocated_totals_by_variant(lines)
    if not totals:
        return {}

    if direction == "consume":
        consume_for_allocation(totals)
    elif direction == "return":
        return_to_stock(totals)
        return_metres_to_rolls(lines)
    else:
        raise ValueError(f"Unknown stock direction: {direction!r}")

    return totals


def _return_named_allocations(allocation_ids):
    """Return exactly these allocations' metres, and nothing else.

    Split out of :func:`stock_movement_for_lines` because returning a *subset* of a
    line's cloth cannot go through the line totals -- those would credit the whole
    line, including any metres already on a truck. It credits the variant total and
    then the underlying rolls for precisely the allocations named, in that order,
    which is the same pair of writes the whole-line path performs.
    """
    from apps.orders.models import Allocation

    allocations = list(
        Allocation.objects.filter(pk__in=allocation_ids).select_related(
            "order_item", "order_item__variant"
        )
    )
    if not allocations:
        return {}

    totals = {}
    for allocation in allocations:
        variant_id = allocation.order_item.variant_id
        if variant_id is None:
            continue
        totals[variant_id] = totals.get(variant_id, ZERO) + allocation.metres

    if not totals:
        return {}

    return_to_stock(totals)
    return_metres_for_allocations(allocations)
    return totals


# --------------------------------------------------------------------------- #
# Visibility
# --------------------------------------------------------------------------- #


def outstanding_demand(variant, exclude_order=None):
    """Metres still wanted for ``variant`` across live orders."""
    from apps.orders.models import OrderItem

    qs = OrderItem.objects.filter(
        variant=variant, order__status__in=OPEN_STATUSES
    )
    if exclude_order is not None:
        qs = qs.exclude(order=exclude_order)
    return qs.aggregate(total=Sum("ordered_quantity") - Sum("allocated_quantity"))[
        "total"
    ] or ZERO


def committed_demand_for_variant(variant):
    """Metres already promised for ``variant``, across every order still here.

    Deliberately **not** :func:`outstanding_demand`. That one counts only the
    orders a packing round can still act on (PENDING/PACKED); this one is the
    whole claim on the cloth, so an order that has been edited or is still being
    drafted has already spent availability.

    Two details make this the figure to judge orderability by:

    * It is **unfloored**. ``outstanding_quantity`` clamps at zero for display,
      which would let an over-packed line look like it still wants cloth and hide
      the metres it over-took. Summing the raw difference keeps the sign.
    * An order has **no CANCELLED status** -- withdrawing one deletes it and the
      lines cascade away -- so "not cancelled and not deleted" means simply
      "still here". DISPATCHED orders count too: dispatching ships the packed
      portion, and a partial dispatch (``allow_partial``) leaves the rest owed,
      which is still a claim on the cloth.
    """
    from apps.orders.models import OrderItem

    total = OrderItem.objects.filter(variant=variant).aggregate(
        total=Sum("ordered_quantity") - Sum("allocated_quantity")
    )["total"]
    return Decimal(str(total or ZERO))


def _committed_demand_expression(variant_ref):
    """The same sum inlined as a subquery, so a whole page costs one query."""
    from apps.orders.models import OrderItem

    return Coalesce(
        Subquery(
            OrderItem.objects.filter(variant=variant_ref)
            .order_by()
            .values("variant")
            .annotate(d=Sum("ordered_quantity") - Sum("allocated_quantity"))
            .values("d")[:1],
            output_field=DecimalField(max_digits=20, decimal_places=3),
        ),
        Value(ZERO),
        output_field=DecimalField(max_digits=20, decimal_places=3),
    )


def variants_with_committed_demand():
    """Variant queryset carrying its promised metres, for use in a ``Prefetch``.

    :attr:`FabricVariant.available_to_order` reads the annotation when it is
    there and falls back to a single query when it is not -- the same
    annotate-then-fallback shape the catalogue serializers already use for a
    fabric's total stock, so the Inventory list resolves every variant in one
    extra query instead of one per colour.
    """
    return FabricVariant.objects.annotate(
        _committed_demand=_committed_demand_expression(OuterRef("pk")),
        # Rolls are needed to answer "is this colour tracked in rolls?" for every
        # line on an order page. Folding that into the query this Prefetch already
        # makes turns one round trip per line into none.
        _has_rolls=Exists(FabricRoll.objects.filter(variant_id=OuterRef("pk"))),
    )


def backorder_report(order):
    """Lines of ``order`` competing for cloth the warehouse cannot cover.

    Purely informational -- demand legitimately outruns supply in this business,
    so this drives warnings rather than rejections.

    The comparison is per *variant* and uses every open order's outstanding
    demand, not just this order's line. A per-line check would never warn in the
    common case: with 2400 m on hand and two separate orders of 1400 m each,
    neither line exceeds stock on its own even though the roll is oversubscribed
    by 400 m.
    """
    from apps.orders.models import OrderItem

    lines = [
        line
        for line in order.items.select_related("variant", "fabric")
        if line.variant_id is not None and line.outstanding_quantity > ZERO
    ]
    if not lines:
        return []

    variant_ids = {line.variant_id for line in lines}

    on_hand = {
        pk: Decimal(str(metres or 0))
        for pk, metres in FabricVariant.objects.filter(
            pk__in=variant_ids
        ).values_list("pk", "stock_meters")
    }

    # Total metres still wanted for each variant, across every live order.
    demand = {}
    for row in (
        OrderItem.objects.filter(
            variant_id__in=variant_ids, order__status__in=OPEN_STATUSES
        )
        .values("variant_id")
        .annotate(total=Sum("ordered_quantity") - Sum("allocated_quantity"))
    ):
        demand[row["variant_id"]] = Decimal(str(row["total"] or 0))

    short = []
    for line in lines:
        available = on_hand.get(line.variant_id, ZERO)
        total_demand = demand.get(line.variant_id, ZERO)
        if total_demand > available:
            short.append(
                {
                    "order_item_id": line.pk,
                    "fabric_name": line.fabric_name,
                    "variant_display_order": line.variant_display_order,
                    "required": str(line.outstanding_quantity),
                    "available": str(available),
                    "total_demand": str(total_demand),
                    "shortfall": str(total_demand - available),
                }
            )
    return short


def shortfall_for_line(order_item):
    """Metres of this line that packing has not yet satisfied."""
    return max(
        ZERO,
        (order_item.ordered_quantity or ZERO)
        - (order_item.allocated_quantity or ZERO),
    )


def order_is_fully_allocated(order):
    from apps.orders.models import OrderItem

    lines = OrderItem.objects.filter(order=order)
    return not lines.filter(allocated_quantity__lt=F("ordered_quantity")).exists()
