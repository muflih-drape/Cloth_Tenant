"""Order pricing.

An order's money has two parts:

* ``computed_total`` is derived from the lines and is never edited by hand:
  ``SUM(ordered_quantity * rate_per_meter)``.
* ``final_total`` is what gets billed. It starts out equal to the computed
  value and an agent or admin can replace it -- but only with a reason, and
  every change lands in the order's audit log.
"""

from decimal import Decimal

from django.utils import timezone

from apps.orders.models import Order, OrderItem, OrderLog

ZERO = Decimal("0")

# Metres are stored to three decimal places; anything summed for storage has to
# land on the same grid or the serializer rejects it.
METRE = Decimal("0.001")


def line_value(order_item):
    return (order_item.ordered_quantity or ZERO) * (order_item.rate_per_meter or ZERO)


def order_computed_total(order):
    """Recalculate and persist ``computed_total`` from the order's lines.

    Summed in Python rather than SQL because ``rate_per_meter`` is snapshotted
    onto each line, and rates differ per line within one order.
    """
    total = ZERO
    for line in order.items.all():
        total += line_value(line)
    total = total.quantize(Decimal("0.01"))

    order.computed_total = total
    return total


def recompute_order_total(order, save=True):
    """Refresh ``computed_total`` and clear an override that no longer applies.

    An override is dropped when the new computed total happens to equal it, so
    the order is not left flagged as "adjusted" for a no-op change.
    """
    total = order_computed_total(order)

    if order.final_total is not None and order.final_total == total:
        order.final_total = None
        order.price_override_reason = ""
        order.price_overridden_by = None
        order.price_overridden_at = None

    if save:
        order.save(
            update_fields=[
                "computed_total",
                "final_total",
                "price_override_reason",
                "price_overridden_by",
                "price_overridden_at",
            ]
        )
    return total


def set_final_total(order, new_total, user, reason):
    """Override the billed total of an order, with an audit entry.

    Passing ``new_total`` equal to the computed total clears the override
    instead of recording a no-op adjustment.

    ``reason`` is optional -- an agent adjusting a draft should not be forced to
    invent a justification. The audit entry records who changed the total, when,
    and from what to what regardless, so the numbers are always traceable even
    when the narrative is empty.
    """
    new_total = Decimal(str(new_total)).quantize(Decimal("0.01"))
    if new_total < ZERO:
        raise ValueError("The final total cannot be negative")

    reason = (reason or "").strip()
    if len(reason) > 200:
        raise ValueError("The reason must be 200 characters or fewer")

    previous = order.effective_total
    clearing = new_total == order.computed_total

    if clearing:
        order.final_total = None
        order.price_override_reason = ""
        order.price_overridden_by = None
        order.price_overridden_at = None
        order.save(
            update_fields=[
                "final_total",
                "price_override_reason",
                "price_overridden_by",
                "price_overridden_at",
            ]
        )
        OrderLog.record(
            order,
            action="PRICE_OVERRIDE_CLEARED",
            details={
                "previous_total": str(previous),
                "computed_total": str(order.computed_total),
                "reason": reason,
            },
            performed_by=user,
        )
        return order

    order.final_total = new_total
    order.price_override_reason = reason
    order.price_overridden_by = user
    order.price_overridden_at = timezone.now()
    order.save(
        update_fields=[
            "final_total",
            "price_override_reason",
            "price_overridden_by",
            "price_overridden_at",
        ]
    )

    OrderLog.record(
        order,
        action="PRICE_OVERRIDE",
        details={
            "previous_total": str(previous),
            "computed_total": str(order.computed_total),
            "new_total": str(new_total),
            "reason": reason,
        },
        performed_by=user,
    )
    return order


def order_totals(order):
    """Every metre/rupee figure the UI needs, in one place."""
    ordered = ZERO
    allocated = ZERO
    for line in order.items.all():
        ordered += line.ordered_quantity or ZERO
        allocated += line.allocated_quantity or ZERO

    return {
        "total_ordered_meters": ordered,
        "total_allocated_meters": allocated,
        "total_outstanding_meters": max(ZERO, ordered - allocated),
        "computed_total": order.computed_total,
        "final_total": order.final_total,
        "effective_total": order.effective_total,
        "is_price_overridden": order.is_price_overridden,
        "price_override_reason": order.price_override_reason,
        "price_overridden_by": (
            order.price_overridden_by.username
            if order.price_overridden_by_id
            else None
        ),
        "price_overridden_at": order.price_overridden_at,
    }
