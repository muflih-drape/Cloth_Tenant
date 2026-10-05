"""Packing-round API: the demand board, the planner, and the confirm/cancel pair.

The warehouse works one fabric variant at a time. ``queue`` shows every order
line still waiting on that roll, ranked by how much each customer buys.
``preview`` runs the allocation engine without writing anything so the admin can
check who gets the leftover metres before committing. ``create_round`` freezes a
plan (optionally hand-adjusted) as a DRAFT round; ``confirm`` moves the stock and
writes the audit trail; ``cancel`` reverses it.

``pack_line`` is the shortcut for filling one order line from the order page
without opening the board. It is not a second way of moving stock: it builds the
same one-entry round and hands it to the same applier, so the trail is identical.

Scanning a roll's label is handled in :mod:`apps.orders.bundle_views`, because a
scanned roll must belong to a bundle and a bundle is an order-level thing.
"""

from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import F, Max
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin
from apps.items.models import FabricVariant
from apps.items.rolls import (
    consume_for_allocation,
    is_roll_tracked,
    preview_consumption,
)
from apps.items.serializers import RollHistoryEntrySerializer
from apps.orders.allocation import (
    OPEN_STATUSES,
    build_plan,
    cancel_round,
    confirm_round,
    customer_priority,
    outstanding_lines,
    sync_order_after_allocation,
)
from apps.orders.models import (
    Allocation,
    Order,
    OrderItem,
    PackingBundle,
    PackingRound,
    RollAllocation,
)
from apps.orders.serializers import (
    MIN_ORDER_METERS,
    AllocationSerializer,
    OrderItemSerializer,
)

ZERO = Decimal("0")

#: Marks a round as having come from a label scan rather than a typed figure, so a
#: bundle knows which rounds it is allowed to reverse and a hand-packed line keeps
#: its pack.
_SCAN_NOTE = "Roll scan"


def _parse_metres(raw, field):
    if raw in (None, ""):
        raise serializers.ValidationError({field: "This field is required."})
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, TypeError, ValueError):
        raise serializers.ValidationError({field: "Must be a number."})
    if value <= ZERO:
        raise serializers.ValidationError({field: "Must be greater than zero."})
    return value


def _serialise_plan(plan, variant=None):
    """JSON-safe version of :func:`build_plan`'s output."""
    payload = {
        "variant": plan["variant"],
        "round_size": str(plan["round_size"]),
        "available_meters": str(plan["available_meters"]),
        "participants": plan["participants"],
        "fully_covered": plan["fully_covered"],
        "unallocated_meters": str(plan["unallocated_meters"]),
        "shortfall_meters": str(plan["shortfall_meters"]),
        "allocations": [
            {
                "order_item": entry["order_item"],
                "order": entry["order"],
                "customer": entry["customer"],
                "customer_id": entry["customer_id"],
                "fabric": entry["fabric"],
                "variant_display_order": entry["variant_display_order"],
                "ordered_quantity": str(entry["ordered_quantity"]),
                "already_allocated": str(entry["already_allocated"]),
                "outstanding_quantity": str(entry["outstanding_quantity"]),
                "metres": str(entry["metres"]),
                "sequence": entry["sequence"],
                "is_priority_award": entry["is_priority_award"],
                "priority_rank": entry["priority_rank"],
            }
            for entry in plan["allocations"]
        ],
        "priority": plan.get("priority", {}),
    }

    if variant is not None and is_roll_tracked(variant):
        # Which physical rolls this plan would be cut from, so the admin sees the
        # cloth leaving a numbered roll rather than an anonymous total.
        cutting = sum(
            (Decimal(str(entry["metres"])) for entry in plan["allocations"]), ZERO
        )
        payload["roll_cut"] = preview_consumption(variant, cutting)

    return payload


def _roll_usage(packing_round):
    """The roll-level records behind a confirmed round, for the response body."""

    entries = RollAllocation.objects.filter(
        allocation__round=packing_round
    ).select_related(
        "roll",
        "allocation__round",
        "allocation__order_item__order__customer",
    )
    return RollHistoryEntrySerializer(entries, many=True).data


class _PreviewRequestSerializer(serializers.Serializer):
    variant = serializers.IntegerField()
    round_size = serializers.DecimalField(max_digits=14, decimal_places=3)
    order_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, allow_empty=True
    )
    available_meters = serializers.DecimalField(
        max_digits=14,
        decimal_places=3,
        required=False,
        allow_null=True,
        help_text="Hypothetical on-hand stock, for what-if planning.",
    )

    def validate_round_size(self, value):
        if value <= ZERO:
            raise serializers.ValidationError("Must be greater than zero.")
        return value


class _CreateRoundSerializer(serializers.Serializer):
    variant = serializers.IntegerField()
    round_size = serializers.DecimalField(max_digits=14, decimal_places=3)
    note = serializers.CharField(required=False, allow_blank=True, max_length=200)
    allocations = serializers.ListField(required=False, allow_empty=True)

    def validate_round_size(self, value):
        if value <= ZERO:
            raise serializers.ValidationError("Must be greater than zero.")
        return value

    def validate(self, attrs):
        variant = get_object_or_404(FabricVariant, pk=attrs["variant"])
        attrs["variant_obj"] = variant

        raw = attrs.get("allocations")
        if not raw:
            # No hand-edits: freeze the engine's own plan.
            plan = build_plan(variant, attrs["round_size"])
            attrs["plan_override"] = [
                {"order_item": e["order_item"], "metres": str(e["metres"])}
                for e in plan["allocations"]
            ]
            return attrs

        cleaned = []
        seen = set()
        for entry in raw:
            order_item = get_object_or_404(
                OrderItem, pk=entry.get("order_item"), variant=variant
            )
            if order_item.pk in seen:
                raise serializers.ValidationError(
                    {
                        "allocations": f"Order line #{order_item.pk} (order "
                        f"#{order_item.order_id}) is listed twice. Combine the "
                        f"metres into a single entry."
                    }
                )
            seen.add(order_item.pk)
            cleaned.append(
                {
                    "order_item": order_item.pk,
                    "metres": str(
                        _parse_metres(entry.get("metres"), "allocations.metres")
                    ),
                }
            )

        total = sum((Decimal(c["metres"]) for c in cleaned), ZERO)
        if total > variant.stock_meters:
            raise serializers.ValidationError(
                {
                    "allocations": f"This plan hands out {total} m but only "
                    f"{variant.stock_meters} m of {variant.fabric.name} "
                    f"({variant.display_order or 'unlabelled'}) are in stock."
                }
            )
        attrs["plan_override"] = cleaned
        return attrs


class _PackLineRollSerializer(serializers.Serializer):
    """One roll of the admin's own breakdown for a single-line pack."""

    roll = serializers.IntegerField()
    metres = serializers.DecimalField(max_digits=14, decimal_places=3)


class _PackLineSerializer(serializers.Serializer):
    """Metres to hand one order line, typed in from the order page."""

    metres = serializers.DecimalField(max_digits=14, decimal_places=3)
    #: Optional: the roll breakdown to cut these metres from. Required in practice
    #: for a colour tracked by physical rolls, which is refused rather than guessed
    #: at when it is absent -- scan the roll into a bundle instead (see
    #: :mod:`apps.orders.bundle_views`). Re-validated against the rolls under lock
    #: before anything is cut.
    rolls = _PackLineRollSerializer(many=True, required=False)

    def validate_metres(self, value):
        if value < MIN_ORDER_METERS:
            raise serializers.ValidationError(
                f"Must be at least {MIN_ORDER_METERS.normalize()} m."
            )
        return value


@extend_schema(
    methods=["GET"],
    summary="Outstanding demand for a fabric variant, ranked by customer priority",
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def queue(request):
    """The packing board for one fabric variant.

    Every order line packing has not fully satisfied, annotated with the
    customer's lifetime metres sold and their rank -- i.e. who the leftover
    stock is about to go to.
    """
    raw_variant = request.query_params.get("variant")
    if not raw_variant:
        return Response(
            {"error": "A variant is required"}, status=status.HTTP_400_BAD_REQUEST
        )
    variant = get_object_or_404(FabricVariant, pk=raw_variant)

    lines = list(outstanding_lines(variant))
    priority = customer_priority({line.order.customer_id for line in lines})

    rows = []
    for line in lines:
        meta = priority.get(line.order.customer_id, {})
        rows.append(
            {
                "order_item": line.pk,
                "order": line.order_id,
                "order_status": line.order.status,
                "customer": line.order.customer.name,
                "customer_id": line.order.customer_id,
                "agent": (
                    line.order.agent.user.username if line.order.agent_id else None
                ),
                "fabric": line.fabric_name,
                "variant_display_order": line.variant_display_order,
                "ordered_quantity": str(line.ordered_quantity),
                "allocated_quantity": str(line.allocated_quantity),
                "outstanding_quantity": str(line.outstanding_quantity),
                "priority_rank": meta.get("rank"),
                "metres_sold": str(meta.get("metres_sold", ZERO)),
                "priority_source": meta.get("source"),
                "order_created_at": line.order.created_at.isoformat(),
            }
        )
    rows.sort(
        key=lambda r: (
            r["priority_rank"] if r["priority_rank"] is not None else 0,
            r["order_item"],
        )
    )

    return Response(
        {
            "variant": {
                "id": variant.pk,
                "fabric": variant.fabric.name,
                "display_order": variant.display_order,
                "stock_meters": str(variant.stock_meters),
                "price_per_meter": str(variant.fabric.price_per_meter),
            },
            "outstanding_orders": Order.objects.filter(
                pk__in={line.order_id for line in lines}
            ).count(),
            "total_outstanding_meters": str(
                sum((line.outstanding_quantity for line in lines), ZERO)
            ),
            "lines": rows,
        }
    )


@extend_schema(
    methods=["POST"],
    summary="Preview an allocation plan without committing it",
    request=_PreviewRequestSerializer,
)
@api_view(["POST"])
@permission_classes([IsAdmin])
def preview(request):
    """Dry-run the allocation engine.

    Returns the equal-fill grants plus the priority top-up so the admin can
    confirm they agree with how leftover metres are being handed out.
    """
    serializer = _PreviewRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    variant = get_object_or_404(FabricVariant, pk=data["variant"])
    try:
        plan = build_plan(
            variant,
            data["round_size"],
            order_ids=data.get("order_ids") or None,
            available_meters=data.get("available_meters"),
        )
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    return Response(_serialise_plan(plan, variant))


@extend_schema(
    methods=["POST"],
    summary="Freeze a plan as a DRAFT packing round",
    request=_CreateRoundSerializer,
)
@api_view(["POST"])
@permission_classes([IsAdmin])
def create_round(request):
    """Create a DRAFT round holding the metres to hand to each order line."""
    serializer = _CreateRoundSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    packing_round = PackingRound.objects.create(
        variant=data["variant_obj"],
        round_size=data["round_size"],
        status="DRAFT",
        note=(data.get("note") or "").strip(),
        plan_override=data["plan_override"],
        created_by=request.user,
    )

    return Response(
        {
            "id": packing_round.pk,
            "status": packing_round.status,
            "variant": packing_round.variant_id,
            "round_size": str(packing_round.round_size),
            "plan_override": packing_round.plan_override,
        },
        status=status.HTTP_201_CREATED,
    )


@extend_schema(
    methods=["POST"],
    summary="Confirm a draft round: move the stock and record the allocations",
)
@api_view(["POST"])
@permission_classes([IsAdmin])
def confirm(request, pk):
    """Apply a round's frozen plan.

    Stock is locked and re-checked first, so a round created a while ago can
    never overdraw the roll.
    """
    packing_round = get_object_or_404(PackingRound, pk=pk)
    if packing_round.status != "DRAFT":
        return Response(
            {"error": f"This round is already {packing_round.status.lower()}."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    note = (request.data.get("note") or "").strip()[:200]

    try:
        with transaction.atomic():
            # Re-read under a row lock: a second admin clicking confirm at the
            # same moment must see the first one's status, not a stale DRAFT.
            from apps.orders.allocation import _lock_round

            locked = _lock_round(packing_round)
            if locked.status != "DRAFT":
                return Response(
                    {"error": f"This round is already {locked.status.lower()}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            stored = list(locked.plan_override or [])
            if stored:
                _apply_plan(locked, stored, request.user, note)
            else:
                # Nothing was frozen: plan against live stock.
                locked.plan_override = []
                confirm_round(locked, user=request.user, note=note)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    packing_round.refresh_from_db()
    return Response(
        {
            "message": "Packing round confirmed",
            "id": packing_round.pk,
            "status": packing_round.status,
            "allocations": AllocationSerializer(
                packing_round.allocations.all(), many=True
            ).data,
            "rolls": _roll_usage(packing_round),
        }
    )


def _apply_plan(packing_round, stored, user, note=""):
    """Apply the exact per-line metres the admin approved.

    The only hard limit is physical stock: a roll is cut whole, so a plan may
    hand out more metres than a line had outstanding.
    """
    from apps.orders.allocation import _adjust_stock, _lock_round

    packing_round = _lock_round(packing_round)
    if packing_round.status != "DRAFT":
        raise ValueError("Only a draft round can be confirmed")

    variant = FabricVariant.objects.select_for_update().get(pk=packing_round.variant_id)

    seen = set()
    for entry in stored:
        line_id = entry.get("order_item")
        if line_id in seen:
            raise ValueError(
                f"Order line #{line_id} appears twice in this plan. Each order "
                f"line can only be filled once per round."
            )
        seen.add(line_id)

    total = sum((Decimal(str(s["metres"])) for s in stored), ZERO)
    if total > variant.stock_meters:
        raise ValueError(
            f"This plan hands out {total} m but only {variant.stock_meters} m "
            f"of {variant.fabric.name} are in stock."
        )

    lines = {
        line.pk: line
        for line in OrderItem.objects.select_for_update()
        .filter(pk__in=[s["order_item"] for s in stored])
        .select_related("order")
    }

    touched = {}
    roll_entries = []
    for sequence, entry in enumerate(stored, start=1):
        line = lines.get(entry["order_item"])
        if line is None:
            continue
        metres = Decimal(str(entry["metres"]))
        # No check against what the line still owes: a roll is cut whole, so
        # handing over more than was ordered is allowed and `allocated_quantity`
        # may legitimately pass `ordered_quantity`. The only hard limit is the
        # metres physically on the roll, which is enforced above.
        allocation = Allocation.objects.create(
            round=packing_round,
            order_item=line,
            metres=metres,
            sequence=sequence,
            is_priority_award=False,
        )
        # For a colour tracked by physical rolls, cut the metres off them here
        # and record which roll each metre came off, so a cancelled round can
        # put the cloth back where it was cut from. `rolls` is the roll the admin
        # named -- a scanned label, or an explicit breakdown -- and a roll-tracked
        # colour is refused without one rather than falling back to a guess.
        roll_entries.extend(
            consume_for_allocation(variant, allocation, metres, entry.get("rolls"))
        )
        line.allocated_quantity += metres
        line.save(update_fields=["allocated_quantity"])
        touched[line.order_id] = line.order

    if total > ZERO:
        _adjust_stock(variant, -total)

    packing_round.status = "CONFIRMED"
    packing_round.confirmed_at = timezone.now()
    if note:
        packing_round.note = note
    packing_round.save()

    for order in touched.values():
        sync_order_after_allocation(order, user, packing_round)

    packing_round.roll_entries = roll_entries
    return packing_round


def _create_implicit_bundle(order, user):
    """Wrap a hand-packed line in a bundle that is finished the moment it is born.

    Packing a line by typing a figure rather than scanning it still puts the cloth
    in a box, so it still has to be a bundle -- otherwise dispatch, which works in
    bundles, would have nothing to send for a colour the warehouse does not track in
    rolls. The bundle is created already ``SEALED``: there is no partial state to
    work through, because the metres are entered in one go and are final the moment
    the request succeeds. That is what makes it *implicit* -- the user never names
    or opens it, it simply exists as the thing these metres left in.

    One action makes one bundle. A bundle here means "one box, handed over once",
    and a single typed figure is exactly that; grouping several clicks into a shared
    box would need to guess where one box ends and the next begins, which is not a
    decision this should be making on the warehouse's behalf.

    Numbering is taken under the order lock by the caller, matching
    ``create_bundle``, so a hand pack and a scanned bundle cannot claim the same
    number at the same moment.
    """
    highest = (
        PackingBundle.objects.filter(order=order).aggregate(top=Max("number")).get("top")
    )
    return PackingBundle.objects.create(
        order=order,
        number=(highest or 0) + 1,
        status="SEALED",
        sealed_at=timezone.now(),
        created_by=user,
    )


@extend_schema(
    methods=["POST"],
    summary="Pack a single order line straight from the order page",
    request=_PackLineSerializer,
)
@api_view(["POST"])
@permission_classes([IsAdmin])
def pack_line(request, order_id, item_id):
    """Fill one order line without opening the packing board.

    This is the same stock-moving event as a multi-order round, just scoped to a
    single line: the metres go out as a one-entry ``PackingRound`` and are applied
    by :func:`_apply_plan`, the very function ``confirm`` uses for a hand-adjusted
    plan. So the round, the ``Allocation``, the ``_adjust_stock`` call and the
    ``ALLOCATION_MADE`` order log all land exactly as they would from
    ``/admin/packing``, and the round is visible (and cancellable) in the same
    history. The note says where it came from, so a single-line pack is
    distinguishable from a board round after the fact.

Unlike placing an order, this really does take cloth off the roll, so a
    figure the warehouse cannot cover is refused rather than reported. That is the
    *only* limit: the admin may enter less than the line still owes (leaving
    the remainder owed) or more than it owes (a roll is cut whole, and rounding it
    up is deliberate). Either way exactly the metres entered come off the roll.

    The metres also leave in a bundle. Whatever the cloth was packed against, this
    is a box handed over once, so it is sealed into an implicit bundle for dispatch
    to act on -- for a roll-tracked colour the named rolls are linked to that bundle
    as well, so the packing slip still names the roll each metre came off.
    """
    order = get_object_or_404(Order, pk=order_id)
    line = get_object_or_404(
        OrderItem.objects.select_related("variant__fabric"),
        pk=item_id,
        order=order,
    )

    if line.variant_id is None:
        return Response(
            {"error": f"Order #{order.pk} line #{line.pk} has no fabric variant."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if order.status not in OPEN_STATUSES:
        return Response(
            {"error": f"Order #{order.pk} is {order.status.lower()}, not open for packing."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = _PackLineSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    metres = serializer.validated_data["metres"]

    plan = [{"order_item": line.pk, "metres": str(metres)}]
    # Only present when the caller named the rolls to cut from. A roll-tracked
    # colour with no breakdown is refused downstream, so an untouched line cannot
    # quietly take cloth off whichever roll the server likes.
    chosen_rolls = serializer.validated_data.get("rolls")
    if chosen_rolls:
        plan[0]["rolls"] = [
            {"roll": row["roll"], "metres": str(row["metres"])} for row in chosen_rolls
        ]
    note = f"Packed directly from order #{order.pk}"

    bundle = None
    try:
        with transaction.atomic():
            # Re-read the roll under a lock: a round confirmed from the packing
            # board, or another single-line pack, may have moved it since the
            # checks above ran. Every ValueError raised from here on leaves the
            # block, so the transaction rolls back rather than half-applying the
            # plan. The order line is locked by _apply_plan itself.
            locked_variant = FabricVariant.objects.select_for_update().get(
                pk=line.variant_id
            )

            # Physical stock is the only hard limit, and it is read under the
            # same lock the deduction will take it with.
            if metres > locked_variant.stock_meters:
                raise ValueError(
                    f"That is {metres} m but only {locked_variant.stock_meters} m of "
                    f"{locked_variant.fabric.name} "
                    f"({locked_variant.display_order or 'unlabelled'}) are in stock."
                )

            packing_round = PackingRound.objects.create(
                variant=locked_variant,
                round_size=metres,
                status="DRAFT",
                note=note,
                plan_override=plan,
                created_by=request.user,
            )
            # Moves the stock, writes the allocation, promotes the order and logs
            # it. Deliberately the only writer of stock_meters on this path.
            _apply_plan(packing_round, plan, request.user)

            # Everything this call just packed belongs to one box. Taken under the
            # order lock so the bundle number cannot collide with a bundle being
            # opened at the same moment.
            locked_order = Order.objects.select_for_update().get(pk=order.pk)
            bundle = _create_implicit_bundle(locked_order, request.user)
            packed = Allocation.objects.filter(round=packing_round)
            packed.update(bundle=bundle)
            # A named roll keeps its own link so the slip can name it; without this
            # the metres would reach the bundle through the allocation alone and the
            # roll numbers would be lost.
            RollAllocation.objects.filter(
                allocation__round=packing_round, is_reversed=False
            ).update(bundle=bundle)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    # _apply_plan works on its own instances of these rows, and may have promoted
    # the order to PACKED, so re-read before answering.
    line.refresh_from_db()
    order.refresh_from_db()
    locked_variant.refresh_from_db()

    return Response(
        {
            "message": (
                f"Packed {metres} m of {line.fabric_name}"
                f"{f' ({line.variant_display_order})' if line.variant_display_order else ''}"
                f" for order #{order.pk}"
            ),
            "round": packing_round.pk,
            "order": order.pk,
            "order_status": order.status,
            "item": OrderItemSerializer(line).data,
            "stock_meters": str(locked_variant.stock_meters),
            "rolls": _roll_usage(packing_round),
            "bundle_id": bundle.pk if bundle is not None else None,
            "bundle_code": bundle.code if bundle is not None else None,
        }
    )


@extend_schema(
    methods=["POST"], summary="Cancel a confirmed round and return its metres"
)
@api_view(["POST"])
@permission_classes([IsAdmin])
def cancel(request, pk):
    packing_round = get_object_or_404(PackingRound, pk=pk)
    try:
        cancel_round(packing_round, user=request.user)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    return Response(
        {
            "message": "Packing round cancelled",
            "id": packing_round.pk,
            "status": packing_round.status,
            "rolls": _roll_usage(packing_round),
        }
    )


@extend_schema(methods=["GET"], summary="List recent packing rounds")
@api_view(["GET"])
@permission_classes([IsAdmin])
def list_rounds(request):
    qs = PackingRound.objects.select_related("variant__fabric", "created_by").all()
    variant = request.query_params.get("variant")
    if variant:
        qs = qs.filter(variant_id=variant)
    return Response(
        [
            {
                "id": r.pk,
                "variant": r.variant_id,
                "fabric": r.variant.fabric.name,
                "display_order": r.variant.display_order,
                "round_size": str(r.round_size),
                "status": r.status,
                "note": r.note,
                "created_by": r.created_by.username if r.created_by_id else None,
                "created_at": r.created_at.isoformat(),
                "confirmed_at": r.confirmed_at.isoformat() if r.confirmed_at else None,
                "total_allocated": str(
                    sum((a.metres for a in r.allocations.all()), ZERO)
                ),
            }
            for r in qs[:50]
        ]
    )
