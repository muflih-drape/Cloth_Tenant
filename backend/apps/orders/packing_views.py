"""Packing-round API: the demand board, the planner, and the confirm/cancel pair.

The warehouse works one fabric variant at a time. ``queue`` shows every order
line still waiting on that roll, ranked by how much each customer buys.
``preview`` runs the allocation engine without writing anything so the admin can
check who gets the leftover metres before committing. ``create_round`` freezes a
plan (optionally hand-adjusted) as a DRAFT round; ``confirm`` moves the stock and
writes the audit trail; ``cancel`` reverses it.
"""

from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import F
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin
from apps.items.models import FabricVariant
from apps.orders.allocation import (
    build_plan,
    cancel_round,
    confirm_round,
    customer_priority,
    outstanding_lines,
    sync_order_after_allocation,
)
from apps.orders.models import Allocation, Order, OrderItem, PackingRound
from apps.orders.serializers import AllocationSerializer

ZERO = Decimal("0")


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


def _serialise_plan(plan):
    """JSON-safe version of :func:`build_plan`'s output."""
    return {
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

    return Response(_serialise_plan(plan))


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
    never overdraw the roll or hand out metres a line no longer needs.
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
        }
    )


def _apply_plan(packing_round, stored, user, note=""):
    """Apply the exact per-line metres the admin approved."""
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
    for sequence, entry in enumerate(stored, start=1):
        line = lines.get(entry["order_item"])
        if line is None:
            continue
        metres = Decimal(str(entry["metres"]))
        if line.outstanding_quantity < metres:
            raise ValueError(
                f"Order #{line.order_id} no longer needs {metres} m of "
                f"{line.fabric_name}."
            )
        Allocation.objects.create(
            round=packing_round,
            order_item=line,
            metres=metres,
            sequence=sequence,
            is_priority_award=False,
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

    return packing_round


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
