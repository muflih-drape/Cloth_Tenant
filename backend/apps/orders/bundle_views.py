"""Order-level packing bundles.

A :class:`~apps.orders.models.PackingBundle` is the unit of handover: a box that
leaves the warehouse carrying whole rolls, possibly of different colours, against
one order. This module is the whole public surface for that -- open a bundle, scan
rolls into it, take a roll back out, seal it, or throw it away.

Everything here delegates the stock movement. A scan creates the same one-entry
``PackingRound`` and hands it to :func:`~apps.orders.packing_views._apply_plan`
that every other allocation path uses, and removing a roll cancels that round
through :func:`~apps.orders.allocation.cancel_round`. So the ``Allocation`` rows,
the ``RollAllocation`` rows, the stock deduction, the order's ``PACKED`` promotion
and the audit log all behave identically no matter which door the cloth came
through; a bundle is a label on top of that, never a second way of moving stock.
"""

from decimal import Decimal

from django.db import transaction
from django.db.models import Max
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin
from apps.items.models import FabricRoll, FabricVariant
from apps.orders.allocation import OPEN_STATUSES, cancel_round
from apps.orders.models import (
    Allocation,
    Order,
    OrderItem,
    PackingBundle,
    PackingRound,
    RollAllocation,
)
from apps.orders.packing_views import _SCAN_NOTE, _apply_plan

ZERO = Decimal("0")


class _ScanIntoBundleSerializer(serializers.Serializer):
    """The roll a warehouse scan resolved to, named by its own identifier.

    A roll's label carries its primary key, which is what makes a scan resolve to
    exactly one roll row rather than to a colour with several lengths on it.
    """

    roll = serializers.IntegerField(min_value=1)


def _bundle_rolls(bundle):
    """The live rolls sitting in a bundle, oldest scan first."""
    return (
        RollAllocation.objects.filter(bundle=bundle, is_reversed=False)
        .select_related(
            "roll__variant__fabric",
            "allocation__order_item__variant__fabric",
            "allocation__round",
        )
        .order_by("id")
    )


def _serialise_bundle(bundle, order=None):
    """One bundle with its rolls, plus the order fields the packing slip needs."""
    order = order or bundle.order
    rolls = list(_bundle_rolls(bundle))

    line_ids = {entry.allocation.order_item_id for entry in rolls}
    lines = {
        line.pk: line
        for line in OrderItem.objects.filter(pk__in=line_ids).select_related("variant")
    }

    total_metres = ZERO
    total_value = ZERO
    entries = []
    for entry in rolls:
        line = lines.get(entry.allocation.order_item_id)
        rate = line.rate_per_meter if line is not None else ZERO
        value = (entry.metres * rate).quantize(Decimal("0.01"))
        total_metres += entry.metres
        total_value += value
        entries.append(
            {
                "id": entry.pk,
                "roll": entry.roll_id,
                "roll_number": entry.roll.roll_number,
                "colour": entry.roll.variant.display_order,
                "fabric": entry.roll.variant.fabric.name,
                "metres": str(entry.metres),
                "item": entry.allocation.order_item_id,
                "fabric_name": line.fabric_name if line is not None else "",
                "variant_display_order": (
                    line.variant_display_order if line is not None else ""
                ),
                "rate_per_meter": str(rate),
                "value": str(value),
                "round": entry.allocation.round_id,
                "scanned_at": entry.created_at.isoformat(),
            }
        )

    return {
        "id": bundle.pk,
        "number": bundle.number,
        "code": bundle.code,
        "status": bundle.status,
        "created_at": bundle.created_at.isoformat(),
        "sealed_at": bundle.sealed_at.isoformat() if bundle.sealed_at else None,
        "created_by": bundle.created_by.username if bundle.created_by_id else None,
        "order": order.pk,
        "order_number": order.pk,
        "customer": order.customer.name,
        "customer_address": order.customer.address,
        "rolls": entries,
        "roll_count": len(entries),
        "total_metres": str(total_metres),
        "total_value": str(total_value.quantize(Decimal("0.01"))),
    }


def _reject(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"error": message}, status=code)


class _BundleError(Exception):
    """A bundle operation the caller got wrong; reported as a 400."""


def _locked_open_bundle(order, bundle_id):
    """Fetch a bundle for update and insist it is still open to changes.

    The row lock is the whole concurrency story for sealing: a scan and a seal
    both take this lock, so whichever arrives second waits for the first to commit
    and then sees the outcome. A scan that loses the race to a seal is refused
    rather than quietly packed into a bundle that is already closed.
    """
    bundle = (
        PackingBundle.objects.select_for_update()
        .select_related("order")
        .filter(pk=bundle_id, order=order)
        .first()
    )
    if bundle is None:
        raise _BundleError(f"Order #{order.pk} has no packing bundle #{bundle_id}.")
    if bundle.status != "OPEN":
        raise _BundleError(
            f"{bundle.code} is {bundle.status.lower()} and cannot be changed."
        )
    return bundle


def _resolve_target_line(order, roll):
    """The order line a scanned roll belongs on.

    The roll carries its colour, so the line is found by colour: the first line of
    this order, in display order, that wants this colour and has not been fully
    packed yet. Where an order lists the same colour twice, the earlier line is
    taken first -- which line is filled is not something the warehouse should have
    to think about at the scanner, and either choice is undone the same way when
    the roll is taken back out of the bundle.

    A roll whose colour is not wanted on this order is refused outright rather than
    forced onto a line that did not ask for it.
    """
    lines = (
        OrderItem.objects.filter(order=order, variant_id=roll.variant_id)
        .order_by("id")
        .select_related("variant__fabric")
    )
    for line in lines:
        if line.outstanding_quantity > ZERO:
            return line

    wanted = roll.variant
    if lines.exists():
        raise _BundleError(
            f"Order #{order.pk} already has all the {wanted.fabric.name} "
            f"({wanted.display_order or 'unlabelled'}) it is waiting for."
        )
    return None


@extend_schema(
    methods=["GET"],
    summary="List the packing bundles on an order",
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def list_bundles(request, order_id):
    """Every bundle on this order, sealed ones included, so a slip can be reprinted.

    Sealed bundles keep their rolls in this response, which is what makes the
    packing slip reproducible: the same bundle always prints the same sheet.
    """
    order = get_object_or_404(Order.objects.select_related("customer"), pk=order_id)
    bundles = PackingBundle.objects.filter(order=order).select_related("created_by")
    return Response([_serialise_bundle(bundle, order) for bundle in bundles])


@extend_schema(
    methods=["POST"],
    summary="Open a new packing bundle on an order",
)
@api_view(["POST"])
@permission_classes([IsAdmin])
def create_bundle(request, order_id):
    """Start a bundle.

    A bundle is born ``OPEN`` and empty. Nothing is sealed and nothing can be
    undone once it is sealed, so a worker can be interrupted at any point before
    that and pick the bundle back up.

    Only one bundle per order is open at a time. Two open boxes on one order would
    both have to be worked on at once, and the panel drives a single one, so a
    second open bundle is refused rather than left where nobody would find it. Seal
    or cancel the open one and the next number is there to be used.
    """
    order = get_object_or_404(Order, pk=order_id)

    if order.status not in OPEN_STATUSES:
        return _reject(
            f"Order #{order.pk} is {order.status.lower()}, not open for packing."
        )

    with transaction.atomic():
        # The order lock serialises numbering: two bundles opened at once would
        # otherwise both read the same highest number and collide on the unique
        # (order, number) constraint. It also serialises the one-open-bundle check
        # below, so two simultaneous requests cannot both see "none open".
        locked_order = Order.objects.select_for_update().get(pk=order.pk)

        already_open = PackingBundle.objects.filter(
            order=locked_order, status="OPEN"
        ).first()
        if already_open is not None:
            return _reject(
                f"Order #{order.pk} already has {already_open.code} open. "
                "Seal or cancel it before opening another."
            )

        highest = (
            PackingBundle.objects.filter(order=locked_order)
            .aggregate(top=Max("number"))
            .get("top")
        )
        bundle = PackingBundle.objects.create(
            order=locked_order,
            number=(highest or 0) + 1,
            status="OPEN",
            created_by=request.user,
        )

    return Response(
        {
            "message": f"Opened {bundle.code}",
            "bundle": _serialise_bundle(bundle, locked_order),
        },
        status=status.HTTP_201_CREATED,
    )


@extend_schema(
    methods=["POST"],
    summary="Scan a roll into an open bundle",
    request=_ScanIntoBundleSerializer,
)
@api_view(["POST"])
@permission_classes([IsAdmin])
def scan_into_bundle(request, order_id, pk):
    """Add one whole scanned roll to an open bundle.

    The roll's colour decides which order line it lands on, so the scanner needs
    no line selection at all: the colour on the label picks the line, the whole
    remaining length is cut for it, and the roll joins the bundle's running list.

    The whole operation is one transaction under three locks -- the bundle, the
    colour and the roll -- so two scanners hitting the same bundle serialise, a
    scan cannot slip into a bundle that has just been sealed, and the same label
    cannot be scanned twice at once.
    """
    order = get_object_or_404(Order, pk=order_id)

    if order.status not in OPEN_STATUSES:
        return _reject(
            f"Order #{order.pk} is {order.status.lower()}, not open for packing."
        )

    serializer = _ScanIntoBundleSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    roll_id = serializer.validated_data["roll"]

    try:
        with transaction.atomic():
            bundle = _locked_open_bundle(order, pk)

            # Re-read the roll under its own lock: it may have moved since the
            # client read it. Unknown, spent and wrong-colour rolls are refused
            # with the reason spelled out, because a mis-scan at a scanner is
            # otherwise a silent mystery.
            roll = FabricRoll.objects.select_for_update().filter(pk=roll_id).first()
            if roll is None:
                raise _BundleError(
                    "That label does not belong to any roll in this warehouse."
                )
            if not roll.is_active or Decimal(str(roll.remaining_meters)) <= ZERO:
                raise _BundleError(f"Roll {roll.roll_number} has already been used up.")

            line = _resolve_target_line(order, roll)
            if line is None:
                wanted = roll.variant
                raise _BundleError(
                    f"Order #{order.pk} has no line for {wanted.fabric.name} "
                    f"({wanted.display_order or 'unlabelled'})."
                )

            variant = FabricVariant.objects.select_for_update().get(pk=roll.variant_id)

            metres = Decimal(str(roll.remaining_meters))
            plan = [
                {
                    "order_item": line.pk,
                    "metres": str(metres),
                    "rolls": [{"roll": roll.pk, "metres": str(metres)}],
                }
            ]
            note = f"{_SCAN_NOTE} into {bundle.code}"

            packing_round = PackingRound.objects.create(
                variant=variant,
                round_size=metres,
                status="DRAFT",
                note=note,
                plan_override=plan,
                created_by=request.user,
            )
            # Moves the stock, writes the allocation, promotes the order and logs
            # it. Deliberately the only writer of stock_meters on this path.
            _apply_plan(packing_round, plan, request.user, note)

            # Tag the roll with the bundle *after* the plan is applied, because the
            # bundle row is already locked above and re-locking it here would be a
            # no-op at best.
            entry = RollAllocation.objects.get(
                allocation__round=packing_round, roll=roll, is_reversed=False
            )
            entry.bundle = bundle
            entry.save(update_fields=["bundle"])
    except _BundleError as exc:
        return _reject(str(exc))
    except ValueError as exc:
        return _reject(str(exc))

    line.refresh_from_db()
    order.refresh_from_db()
    bundle.refresh_from_db()

    return Response(
        {
            "message": (
                f"Added roll {roll.roll_number} ({metres.normalize()} m) to "
                f"{bundle.code}"
            ),
            "item_id": line.pk,
            "fabric_name": line.fabric_name,
            "variant_display_order": line.variant_display_order,
            "order_status": order.status,
            "bundle": _serialise_bundle(bundle, order),
        },
        status=status.HTTP_201_CREATED,
    )


@extend_schema(
    methods=["POST"],
    summary="Take one roll back out of an open bundle",
)
@api_view(["POST"])
@permission_classes([IsAdmin])
def remove_roll(request, order_id, pk, roll_allocation_id):
    """Give one roll back and take it off the bundle's list.

    This is the bundle's undo, and it is per roll rather than "undo the last one",
    so a worker who realises mid-box that the wrong colour went in can remove that
    one roll and leave the rest of the bundle standing.

    Removing is exactly cancelling the scan that put the roll there: the metres go
    back on the very roll they came off, the ``RollAllocation`` is marked reversed
    so the same cloth cannot be credited twice, the line's packed total comes back
    down, and the order re-syncs. Sealing is what makes this unavailable.
    """
    order = get_object_or_404(Order, pk=order_id)

    if order.status not in OPEN_STATUSES:
        return _reject(
            f"Order #{order.pk} is {order.status.lower()}, not open for packing."
        )

    try:
        with transaction.atomic():
            bundle = _locked_open_bundle(order, pk)

            entry = (
                # ``of=("self",)`` because the round link is nullable and a
                # select_for_update cannot ride along an outer join.
                RollAllocation.objects.select_for_update(of=("self",))
                .select_related("roll", "allocation__round", "allocation__order_item")
                .filter(pk=roll_allocation_id, bundle=bundle, is_reversed=False)
                .first()
            )
            if entry is None:
                raise _BundleError(
                    f"{bundle.code} does not contain that roll."
                )

            packing_round = entry.allocation.round
            if packing_round is None or packing_round.status != "CONFIRMED":
                raise _BundleError(
                    "That roll's packing round is no longer confirmed, so it cannot "
                    "be given back."
                )

            roll_number = entry.roll.roll_number
            cancel_round(packing_round, user=request.user)
    except _BundleError as exc:
        return _reject(str(exc))
    except ValueError as exc:
        return _reject(str(exc))

    order.refresh_from_db()
    bundle.refresh_from_db()

    return Response(
        {
            "message": f"Removed roll {roll_number} from {bundle.code}",
            "order_status": order.status,
            "bundle": _serialise_bundle(bundle, order),
        }
    )


@extend_schema(
    methods=["POST"],
    summary="Close an open bundle, keeping it as a record",
)
@api_view(["POST"])
@permission_classes([IsAdmin])
def seal_bundle(request, order_id, pk):
    """Seal a bundle so its contents become final.

    Sealing is the point of no return: the packing slip printed for a sealed
    bundle is a promise about what is in the box, so afterwards no roll can be
    added and none can be taken out. The bundle stays on the order and its slip
    can be reprinted as often as needed.

    The status flip and the seal timestamp happen together under the bundle lock,
    so a scan arriving at the same moment waits, then finds the bundle sealed and is
    refused -- there is no window where a bundle is closed but still accepting.

    A bundle with nothing in it cannot be sealed: a sealed bundle's slip is a
    promise about what is in the box, and an empty one promises nothing. The same
    rule is enforced on the panel, so this is the API holding the line rather than
    announcing a new one.
    """
    order = get_object_or_404(Order, pk=order_id)

    try:
        with transaction.atomic():
            bundle = (
                PackingBundle.objects.select_for_update()
                .select_related("order")
                .filter(pk=pk, order=order)
                .first()
            )
            if bundle is None:
                raise _BundleError(
                    f"Order #{order.pk} has no packing bundle #{pk}."
                )
            if bundle.status != "OPEN":
                raise _BundleError(
                    f"{bundle.code} is already {bundle.status.lower()}."
                )
            if not _bundle_rolls(bundle).exists():
                raise _BundleError(
                    f"{bundle.code} is empty. Scan at least one roll into it "
                    "before sealing, or cancel it."
                )

            bundle.status = "SEALED"
            bundle.sealed_at = timezone.now()
            bundle.save(update_fields=["status", "sealed_at"])
    except _BundleError as exc:
        return _reject(str(exc))

    return Response(
        {
            "message": f"{bundle.code} sealed. It can no longer be changed.",
            "bundle": _serialise_bundle(bundle, order),
        }
    )


@extend_schema(
    methods=["POST"],
    summary="Throw away an open bundle and return every roll in it",
)
@api_view(["POST"])
@permission_classes([IsAdmin])
def cancel_bundle(request, order_id, pk):
    """Cancel an open bundle, undoing every scan in it.

    Used when a box is abandoned part-built -- wrong customer, wrong order, or
    just abandoned. Every live roll in the bundle is cancelled in turn, which puts
    each one back on the roll it was cut from and drops the affected lines back
    down, and the bundle itself is left as ``CANCELLED`` rather than deleted so the
    order's history still shows what was tried.

    The whole thing is one transaction: either the bundle is empty because every
    roll went back, or nothing changed.
    """
    order = get_object_or_404(Order, pk=order_id)

    if order.status not in OPEN_STATUSES:
        return _reject(
            f"Order #{order.pk} is {order.status.lower()}, not open for packing."
        )

    try:
        with transaction.atomic():
            bundle = _locked_open_bundle(order, pk)

            rounds = []
            for entry in _bundle_rolls(bundle):
                packing_round = entry.allocation.round
                if packing_round is not None and packing_round.status == "CONFIRMED":
                    rounds.append(packing_round)
            for packing_round in rounds:
                cancel_round(packing_round, user=request.user)

            bundle.status = "CANCELLED"
            bundle.save(update_fields=["status"])
    except _BundleError as exc:
        return _reject(str(exc))
    except ValueError as exc:
        return _reject(str(exc))

    order.refresh_from_db()
    bundle.refresh_from_db()
    # cancel_round already demotes the order per round it reverses; refreshing is
    # all that is left to do, since a cancelled bundle can leave a fully packed
    # order short again.

    return Response(
        {
            "message": (
                f"Cancelled {bundle.code} and returned "
                f"{len(rounds)} roll{'s' if len(rounds) != 1 else ''}."
            ),
            "order_status": order.status,
            "bundle": _serialise_bundle(bundle, order),
        }
    )
