from datetime import timedelta
from decimal import Decimal, InvalidOperation
from functools import partial

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import F, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from apps.accounts.permissions import IsAdmin, IsAgent, IsAgentOrAdmin, check_admin_pin
from apps.agents.models import Agent, AgentItem
from apps.notification.utils import notify_user_safely
from apps.orders.pricing import (
    METRE,
    order_computed_total,
    recompute_order_total,
    set_final_total,
)
from apps.orders.stock import (
    backorder_report,
    return_to_stock,
    stock_movement_for_lines,
)
from apps.orders.models import Order, OrderItem, OrderLog, UserViewedOrder
from apps.orders.serializers import (
    AddOrderItemSerializer,
    InvoiceSerializer,
    OrderItemSerializer,
    OrderSerializer,
)

User = get_user_model()

ZERO = Decimal("0")

#: Statuses whose lines still compete for cloth in the packing queue.
OPEN_STATUSES = ("PENDING", "PACKED")


class OrderPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


def _build_snapshot(order):
    """Capture every OrderItem so an in-progress edit can be rolled back."""
    return [
        {
            "id": oi.pk,
            "fabric_id": oi.fabric_id,
            "variant_id": oi.variant_id,
            "fabric_name": oi.fabric_name,
            "rate_per_meter": str(oi.rate_per_meter),
            "original_rate_per_meter": (
                str(oi.original_rate_per_meter)
                if oi.original_rate_per_meter is not None
                else None
            ),
            "rate_overridden_by_id": oi.rate_overridden_by_id,
            "rate_overridden_at": (
                oi.rate_overridden_at.isoformat() if oi.rate_overridden_at else None
            ),
            "variant_image": oi.variant_image,
            "variant_display_order": oi.variant_display_order,
            "ordered_quantity": str(oi.ordered_quantity),
            "allocated_quantity": str(oi.allocated_quantity),
        }
        for oi in order.items.all()
    ]


def _has_allocations(order):
    """Whether packing has already handed any cloth to this order.

    Such orders are off-limits to the edit flow: lines cannot be added, removed or
    resized without either rewriting allocation history or leaving the roll out of
    balance. Undo the round first, or dispatch as shipped short.
    """
    return order.items.filter(allocations__isnull=False).exists()


def _restore_snapshot(order):
    """Rebuild an abandoned edit's lines from its snapshot.

    Only ever called for orders with no allocations, so deleting and recreating
    lines cannot touch packing history.
    """
    with transaction.atomic():
        order.items.all().delete()
        for snap in order.edit_snapshot or []:
            overridden_at = snap.get("rate_overridden_at")
            OrderItem.objects.create(
                order=order,
                fabric_id=snap["fabric_id"],
                variant_id=snap["variant_id"],
                fabric_name=snap["fabric_name"],
                rate_per_meter=snap["rate_per_meter"],
                # An abandoned edit must not leave a negotiated rate behind, or
                # the rolled-back order would keep billing off-catalogue.
                original_rate_per_meter=snap.get("original_rate_per_meter"),
                rate_overridden_by_id=snap.get("rate_overridden_by_id"),
                rate_overridden_at=(
                    parse_datetime(overridden_at) if overridden_at else None
                ),
                variant_image=snap.get("variant_image"),
                variant_display_order=snap.get("variant_display_order", ""),
                ordered_quantity=snap["ordered_quantity"],
            )
        recompute_order_total(order)
        order.edit_snapshot = []
        order.editing_started_at = None
        order.status = "PENDING"
        order.save()


def _is_creator(user, order):
    """Whether ``user`` owns a draft order.

    Orders created after the ``created_by`` migration are owned strictly by
    ``created_by``. Legacy drafts with a NULL creator belong to the order's
    agent.
    """
    if order.created_by_id is not None:
        return order.created_by_id == user.id
    return bool(order.agent_id) and order.agent.user_id == user.id


def _may_touch(user, order):
    """Admins may act on any order; agents only on their own."""
    if user.role == "ADMIN":
        return True
    return bool(order.agent_id) and order.agent.user_id == user.id


def _reap_stale_drafts(user):
    """Delete stale DRAFT orders using a role-based expiry.

    Agents: drafts they created (or legacy drafts owned via their agent FK)
    older than 15 minutes. Admins: drafts they created older than
    ``ADMIN_DRAFT_EXPIRY_HOURS``.
    """
    if user.role == "ADMIN":
        cutoff = timezone.now() - timedelta(
            hours=getattr(settings, "ADMIN_DRAFT_EXPIRY_HOURS", 24)
        )
        Order.objects.filter(
            status="DRAFT", created_by=user, created_at__lt=cutoff
        ).delete()
        return

    cutoff = timezone.now() - timedelta(minutes=15)
    Order.objects.filter(
        status="DRAFT", agent__user=user, created_at__lt=cutoff
    ).filter(Q(created_by=user) | Q(created_by__isnull=True)).delete()


def _notify_admins(title, body, order_id=None, ids=None):
    recipients = (
        ids
        if ids is not None
        else set(
            User.objects.filter(role="ADMIN")
            .values_list("id", flat=True)
        )
        | set(User.objects.filter(is_superuser=True).values_list("id", flat=True))
    )
    for uid in recipients:
        transaction.on_commit(
            partial(
                notify_user_safely,
                uid,
                title,
                body,
                data={"order_id": str(order_id)} if order_id else None,
            ),
            robust=True,
        )


class PlaceOrderView(APIView):
    permission_classes = [IsAgentOrAdmin]

    @extend_schema(
        summary="Place a DRAFT order (records its demand)",
        request=None,
        responses={200: None, 400: None, 403: None},
    )
    def post(self, request, order_id):
        order = get_object_or_404(Order, id=order_id)

        if order.status != "DRAFT":
            return Response(
                {"error": "Only DRAFT orders can be placed"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not _is_creator(request.user, order):
            return Response(
                {"error": "You can only place your own draft orders"},
                status=status.HTTP_403_FORBIDDEN,
            )

        if not order.items.exists():
            return Response(
                {"error": "Cannot place an empty order"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        expected_delivery_date = request.data.get("expected_delivery_date")
        preferred_transport = request.data.get("preferred_transport")
        notes = request.data.get("notes")

        with transaction.atomic():
            order.status = "PENDING"
            if expected_delivery_date:
                order.expected_delivery_date = expected_delivery_date
            if preferred_transport:
                from transports.models import Transport

                transport = Transport.objects.filter(id=preferred_transport).first()
                if transport:
                    order.preferred_transport = transport
            if notes:
                order.notes = notes
            order.save()
            recompute_order_total(order)

            # Placing an order records demand; it does not move cloth. Demand may
            # exceed supply -- that is exactly the situation packing arbitrates --
            # so an oversubscribed variant is reported, not rejected.
            # This must run *after* the status flip: the report only counts open
            # orders, and a DRAFT order is not one, so calling it earlier would
            # never see the order being placed.
            short = backorder_report(order)

            customer_name = order.customer.name if order.customer else ""
            order_detail = f"{customer_name} · {order.effective_total:,.2f}"
            _notify_admins("New Order", order_detail, order_id=order.id)

            if short:
                agent_user_id = order.agent.user_id if order.agent else None
                if agent_user_id:
                    transaction.on_commit(
                        partial(
                            notify_user_safely,
                            agent_user_id,
                            "Stock Short",
                            f"{len(short)} fabric(s) in your order exceed the "
                            "cloth on hand. Packing will allocate what is available.",
                        ),
                        robust=True,
                    )
                _notify_admins(
                    "Demand Exceeds Stock",
                    f"Order #{order.id} asks for more than we hold on "
                    f"{len(short)} fabric line(s)",
                    order_id=order.id,
                )

        return Response(
            {
                "message": "Order placed successfully",
                "order_id": order.id,
                "shortfall_lines": short,
                "notice": (
                    "Some fabrics exceed the cloth on hand. The order is queued "
                    "for packing, which will allocate what is available."
                    if short
                    else None
                ),
            }
        )


class StartEditView(APIView):
    permission_classes = [IsAgent]

    @extend_schema(
        summary="Start editing a PENDING order",
        request=None,
        responses={200: None, 400: None, 403: None},
    )
    def post(self, request, order_id):
        order = get_object_or_404(Order, id=order_id)

        if order.status != "PENDING":
            return Response(
                {"error": "Only PENDING orders can be edited"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if order.agent.user != request.user:
            return Response({"error": "Unauthorized"}, status=403)

        if _has_allocations(order):
            return Response(
                {
                    "error": "Part of this order has already been packed, so it "
                    "can no longer be edited. Cancel the packing round, or "
                    "dispatch the packed portion as shipped short.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        order.edit_snapshot = _build_snapshot(order)
        order.editing_started_at = timezone.now()
        order.status = "EDITING"
        order.save()
        UserViewedOrder.objects.filter(order=order).delete()

        OrderLog.record(
            order,
            action="EDIT_STARTED",
            details={"items_count": len(order.edit_snapshot)},
            performed_by=request.user,
        )

        return Response({"message": "Edit started"})


class SaveEditView(APIView):
    permission_classes = [IsAgent]

    @extend_schema(
        summary="Save edits made to a PENDING order",
        request=None,
        responses={200: None, 400: None, 403: None},
    )
    def post(self, request, order_id):
        order = get_object_or_404(Order, id=order_id)

        if order.agent.user != request.user:
            return Response({"error": "Unauthorized"}, status=403)

        if order.status not in ("EDITING", "PENDING"):
            return Response(
                {"error": "Only an order being edited can be saved"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if order.status == "EDITING" and _has_allocations(order):
            return Response(
                {
                    "error": "Part of this order has been packed since the edit "
                    "began, so the changes cannot be saved."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not order.items.exists():
            return Response(
                {"error": "An order needs at least one fabric line"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            # No stock movement: placing and editing only record demand.
            order.edit_snapshot = []
            order.editing_started_at = None
            order.status = "PENDING"

            order.expected_delivery_date = (
                request.data.get("expected_delivery_date") or None
            )
            if request.data.get("preferred_transport"):
                from transports.models import Transport

                order.preferred_transport = Transport.objects.filter(
                    id=request.data["preferred_transport"]
                ).first()
            else:
                order.preferred_transport = None
            if request.data.get("notes"):
                order.notes = request.data["notes"]
            order.save()
            recompute_order_total(order)

        OrderLog.record(
            order,
            action="EDIT_SAVED",
            details={"items_count": order.items.count()},
            performed_by=request.user,
        )

        return Response({"message": "Order saved successfully", "order_id": order.id})


class SetOrderPriceView(APIView):
    """Override the billed total of an order.

    Only a draft can be repriced, for everyone. Once placed, the number an agent
    puts on paper is a commitment, so the figure is frozen and any change to it
    has to go through dispatching or cancelling the order. This keeps the audit
    trail honest: nobody can quietly reprice stock that packing has moved.

    An agent may only discount -- their total is capped at the line arithmetic.
    An admin may set any amount, which is how a goodwill gesture is recorded.

    The reason is optional, but every change is logged either way.
    """

    permission_classes = [IsAgentOrAdmin]

    @extend_schema(
        summary="Set or clear an order's final total",
        responses={200: None, 400: None, 403: None},
    )
    def post(self, request, order_id):
        order = get_object_or_404(Order, id=order_id)

        if not _may_touch(request.user, order):
            return Response({"error": "Unauthorized"}, status=403)

        if order.status != "DRAFT":
            return Response(
                {
                    "error": "The total can only be changed before the order "
                    "is placed"
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_total = request.data.get("final_total")
        if raw_total in (None, ""):
            return Response(
                {"error": "final_total is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            new_total = Decimal(str(raw_total))
        except (InvalidOperation, TypeError):
            return Response(
                {"error": "final_total must be a number"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # An agent may reduce the bill but never inflate it. Compare against the
        # live line arithmetic rather than the stored column, so a draft whose
        # lines changed since the last recompute is still capped correctly.
        if request.user.role == "AGENT":
            computed = order_computed_total(order)
            if new_total > computed:
                return Response(
                    {
                        "error": "An agent total cannot be higher than the order "
                        f"total of {computed:,.2f}"
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            set_final_total(order, new_total, request.user, request.data.get("reason"))
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        order.refresh_from_db()
        return Response(
            {
                "message": "Order total updated",
                "computed_total": str(order.computed_total),
                "final_total": (
                    str(order.final_total) if order.final_total is not None else None
                ),
                "effective_total": str(order.effective_total),
                "is_price_overridden": order.is_price_overridden,
                "price_override_reason": order.price_override_reason,
            }
        )


class OrderViewSet(ModelViewSet):
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = OrderPagination

    def get_queryset(self):
        user = self.request.user

        if self.action == "list":
            _reap_stale_drafts(user)
            # A half-finished edit that was abandoned gets rolled back.
            cutoff = timezone.now() - timedelta(minutes=15)
            for stale in Order.objects.filter(
                status="EDITING", agent__user=user, editing_started_at__lt=cutoff
            ):
                _restore_snapshot(stale)

        qs = Order.objects.select_related("customer", "agent__user").prefetch_related(
            "items__variant", "items__fabric", "items__allocations"
        ).order_by("-created_at")

        if self.action == "list":
            archive_cutoff = timezone.now() - timedelta(days=30)
            qs = qs.exclude(
                status="DISPATCHED",
                dispatched_at__isnull=False,
                dispatched_at__lte=archive_cutoff,
            )

        customer_id = self.request.query_params.get("customer")
        if customer_id:
            qs = qs.filter(customer_id=customer_id)

        from_date = self.request.query_params.get("from_date")
        if from_date:
            qs = qs.filter(created_at__date__gte=from_date)

        to_date = self.request.query_params.get("to_date")
        if to_date:
            qs = qs.filter(created_at__date__lte=to_date)

        agent_id = self.request.query_params.get("agent")
        if agent_id and user.role == "ADMIN":
            qs = qs.filter(agent_id=agent_id)

        statuses = self.request.query_params.getlist("status")
        if statuses:
            qs = qs.filter(status__in=[s.upper() for s in statuses])

        if user.role == "ADMIN":
            # An admin only sees their own drafts; everything else is shared.
            qs = qs.filter(
                Q(status="DRAFT", created_by=user) | ~Q(status="DRAFT")
            ).distinct()

            search = self.request.query_params.get("search")
            if search:
                qs = qs.filter(
                    Q(customer__name__icontains=search)
                    | Q(agent__user__username__icontains=search)
                    | Q(id__icontains=search)
                ).distinct()
            return qs

        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(
                Q(customer__name__icontains=search)
                | Q(agent__user__username__icontains=search)
                | Q(id__icontains=search)
            ).distinct()

        return qs.filter(agent__user=user)

    def perform_create(self, serializer):
        user = self.request.user

        if user.role == "ADMIN":
            agent_id = self.request.data.get("agent")
            if not agent_id:
                raise ValidationError(
                    {"agent": "An agent is required when an admin creates an order."}
                )
            agent = Agent.objects.filter(id=agent_id).select_related("user").first()
            if agent is None:
                raise ValidationError({"agent": "The selected agent does not exist."})
            if not agent.is_active or not agent.user.is_active:
                raise ValidationError(
                    {"agent": "The selected agent is inactive and cannot be assigned orders."}
                )
            serializer.save(agent=agent, created_by=user)
            return

        serializer.save(agent=user.agent, created_by=user)

    def update(self, request, *args, **kwargs):
        order = self.get_object()
        new_status = request.data.get("status")

        if new_status == "DISPATCHED":
            return Response(
                {"error": "Use the dispatch endpoint to mark an order as dispatched"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if order.status == "DRAFT":
            if not _is_creator(request.user, order):
                return Response(
                    {"error": "You can only edit your own draft orders"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if new_status and new_status != "DRAFT":
                return Response(
                    {"error": "A draft order can only be placed via the place-order endpoint"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        return super().update(request, *args, **kwargs)

    def destroy(self, request, pk=None):
        order = self.get_object()
        if not _may_touch(request.user, order):
            return Response({"error": "Unauthorized"}, status=403)

        # Deleting a live order gives back any cloth packing had already handed it.
        with transaction.atomic():
            if order.status != "DRAFT" and order.status != "DISPATCHED":
                stock_movement_for_lines(order.items.all(), direction="return")

            OrderLog.record(
                order,
                action="ORDER_DELETED",
                details={
                    "customer": order.customer.name,
                    "items_count": order.items.count(),
                    "status": order.status,
                    "metres_returned_to_stock": str(
                        sum(
                            (
                                line.allocated_quantity or ZERO
                                for line in order.items.all()
                            ),
                            ZERO,
                        )
                    ),
                },
                performed_by=request.user,
            )
            order.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(summary="Dispatch a PENDING/PACKED order")
    @action(detail=True, methods=["post"], url_path="dispatch")
    def dispatch_order(self, request, pk=None):
        order = self.get_object()

        if order.status not in ("PENDING", "PACKED"):
            return Response(
                {"error": "Only PENDING or PACKED orders can be dispatched"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        shortfall = [
            line
            for line in order.items.all()
            if line.allocated_quantity < line.ordered_quantity
        ]
        allow_partial = str(
            request.data.get("allow_partial", "")
        ).lower() in ("1", "true", "yes")
        shortfall_reason = (request.data.get("shortfall_reason") or "").strip()

        if shortfall and not allow_partial:
            return Response(
                {
                    "error": "This order has fabric that has not been fully packed.",
                    "unallocated_lines": [
                        {
                            "order_item_id": line.pk,
                            "fabric_name": line.fabric_name,
                            "ordered_quantity": str(line.ordered_quantity),
                            "allocated_quantity": str(line.allocated_quantity),
                            "outstanding_quantity": str(line.outstanding_quantity),
                        }
                        for line in shortfall
                    ],
                    "hint": "Resend with allow_partial=true and a shortfall_reason "
                    "to ship the packed portion only.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if shortfall and not shortfall_reason:
            return Response(
                {"error": "A shortfall_reason is required when shipping short"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        transport_company_id = request.data.get("transport_company")
        lr_number = request.data.get("lr_number", "")
        agent_user_id = order.agent.user_id if order.agent else None

        with transaction.atomic():
            # No stock movement: cloth already left the roll when packing
            # confirmed the allocation, and the un-allocated remainder of a short
            # line never left it in the first place.
            OrderLog.record(
                order,
                "DISPATCHED",
                details={
                    "fully_packed": not shortfall,
                    "short_lines": len(shortfall),
                    "shortfall_meters": str(
                        sum((line.outstanding_quantity for line in shortfall), ZERO)
                    ),
                    "total_items": order.items.count(),
                },
                performed_by=request.user,
            )

            order.status = "DISPATCHED"
            order.dispatched_at = timezone.now()
            order.shortfall_reason = shortfall_reason

            if transport_company_id:
                from transports.models import Transport

                order.transport_company = Transport.objects.filter(
                    id=transport_company_id
                ).first()
            if lr_number:
                order.lr_number = lr_number
            order.save()

            if agent_user_id:
                customer_name = order.customer.name if order.customer else "Customer"
                transaction.on_commit(
                    partial(
                        notify_user_safely,
                        agent_user_id,
                        "Order Dispatched",
                        f"Order for {customer_name} has been dispatched",
                    ),
                    robust=True,
                )

            UserViewedOrder.objects.filter(order=order).delete()

        return Response({"message": "Order dispatched successfully"})

    @extend_schema(summary="Cancel an in-progress order edit")
    @action(detail=True, methods=["post"], url_path="cancel-edit")
    def cancel_edit(self, request, pk=None):
        order = self.get_object()

        if order.status != "EDITING":
            return Response(
                {"error": "Order is not in editing mode"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if order.agent.user != request.user:
            return Response({"error": "Unauthorized"}, status=403)

        _restore_snapshot(order)

        OrderLog.record(
            order, "EDIT_CANCELLED", details={}, performed_by=request.user
        )
        return Response({"message": "Edit cancelled"})

    @extend_schema(summary="List order IDs viewed by the current user")
    @action(detail=False, methods=["get"], url_path="my-viewed-ids")
    def my_viewed_ids(self, request):
        viewed = UserViewedOrder.objects.filter(user=request.user).values_list(
            "order_id", flat=True
        )
        return Response(list(viewed))

    @extend_schema(summary="Mark an order as viewed by the current user")
    @action(detail=True, methods=["post"], url_path="mark-viewed")
    def mark_viewed(self, request, pk=None):
        order = self.get_object()
        if order.status in OPEN_STATUSES:
            UserViewedOrder.objects.get_or_create(user=request.user, order=order)
        else:
            UserViewedOrder.objects.filter(user=request.user, order=order).delete()
        return Response({"message": "Viewed status updated"})

    @extend_schema(summary="List lightweight {id, status} pairs for the current user")
    @action(detail=False, methods=["get"], url_path="order-ids")
    def order_ids(self, request):
        user = self.request.user
        qs = Order.objects.all()
        if user.role != "ADMIN":
            qs = qs.filter(agent__user=user)
        # Admin clients hide DRAFTs entirely, so omit them for consistent badges.
        else:
            qs = qs.exclude(status="DRAFT")
        qs = qs.values_list("id", "status")
        return Response([{"id": oid, "status": stat} for oid, stat in qs])

    @extend_schema(summary="List dispatched orders archived after 30 days")
    @action(detail=False, methods=["get"], url_path="archived")
    def get_archived(self, request):
        cutoff = timezone.now() - timedelta(days=30)
        qs = (
            Order.objects.prefetch_related("items__variant", "items__fabric")
            .filter(
                status="DISPATCHED",
                dispatched_at__isnull=False,
                dispatched_at__lte=cutoff,
            )
            .order_by("-dispatched_at")
        )

        user = self.request.user
        if user.role != "ADMIN":
            qs = qs.filter(agent__user=user)

        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(
                self.get_serializer(page, many=True).data
            )
        return Response(self.get_serializer(qs, many=True).data)


class AddOrderItemView(APIView):
    permission_classes = [IsAgentOrAdmin]

    @extend_schema(
        summary="Add a fabric line to a DRAFT/EDITING/PENDING order",
        request=AddOrderItemSerializer,
        responses={201: None, 400: None, 403: None},
    )
    def post(self, request, order_id):
        serializer = AddOrderItemSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)

        order = get_object_or_404(Order, id=order_id)

        if order.status not in ("DRAFT", "EDITING", "PENDING"):
            return Response(
                {"error": "Items can only be added to DRAFT or EDITING orders"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Ownership is unconditional. This used to be skipped for EDITING
        # orders, which let any agent append lines to another agent's order the
        # moment its owner opened it for editing.
        if not _may_touch(request.user, order):
            return Response(
                {"error": "You can only add items to your own orders"},
                status=status.HTTP_403_FORBIDDEN,
            )

        if _has_allocations(order):
            return Response(
                {
                    "error": "Part of this order has already been packed, so "
                    "lines can no longer be added."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        variant = serializer.validated_data["variant"]

        if request.user.role == "AGENT" and not AgentItem.objects.filter(
            agent=request.user.agent, variant=variant
        ).exists():
            return Response(
                {
                    "error": "This fabric is not assigned to you. Please contact admin "
                    "for assignment."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            line = OrderItem.objects.create(
                order=order,
                fabric=serializer.validated_data["fabric"],
                variant=variant,
                fabric_name=serializer.validated_data["fabric_name"],
                rate_per_meter=serializer.validated_data["rate_per_meter"],
                original_rate_per_meter=serializer.validated_data[
                    "original_rate_per_meter"
                ],
                rate_overridden_by=serializer.validated_data["rate_overridden_by"],
                rate_overridden_at=serializer.validated_data["rate_overridden_at"],
                variant_image=serializer.validated_data.get("variant_image"),
                variant_display_order=serializer.validated_data.get(
                    "variant_display_order", ""
                ),
                ordered_quantity=serializer.validated_data["ordered_quantity"],
            )
            if line.is_rate_overridden:
                # A rate agreed for one customer is worth a trace of its own:
                # the catalogue is untouched, so this line is the only record
                # that the order was billed off-rate.
                OrderLog.record(
                    order,
                    "ITEM_RATE_OVERRIDE",
                    details={
                        "item_id": line.pk,
                        "fabric_name": line.fabric_name,
                        "catalog_rate": str(line.original_rate_per_meter),
                        "rate_per_meter": str(line.rate_per_meter),
                        "metres": str(line.ordered_quantity),
                    },
                    performed_by=request.user,
                )
            recompute_order_total(order)

        return Response(
            {"message": "Item added successfully"}, status=status.HTTP_201_CREATED
        )


def _remove_order_line(request, order, order_item):
    """Take one line off an order, refusing anything that would strand the order.

    Shared by DeleteOrderItemView and OrderItemViewSet.destroy so the status,
    ownership, packing and empty-order rules can only exist in one place. The
    generic viewset used to delete through ModelViewSet with none of them, which
    cascaded the allocation rows away and left the roll debited forever.
    """
    if order.status not in ("DRAFT", "EDITING", "PENDING"):
        return Response(
            {
                "error": "Lines can only be removed from a DRAFT, EDITING or "
                "PENDING order"
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not _may_touch(request.user, order):
        return Response(
            {"error": "You can only edit your own orders"},
            status=status.HTTP_403_FORBIDDEN,
        )

    if order_item.allocated_quantity > ZERO:
        # Cloth has physically moved; undo the packing round instead so the
        # allocation record and the roll stay in step.
        return Response(
            {
                "error": f"{order_item.allocated_quantity} m of this fabric "
                f"has already been packed. Cancel the packing round to remove it."
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # A placed order exists to be packed, dispatched and invoiced. Removing its
    # final line leaves demand nothing to fulfil, and no later step can put the
    # cloth back, so the last line of a placed order is fixed.
    if (
        order.status == "PENDING"
        and not order.items.exclude(id=order_item.id).exists()
    ):
        return Response(
            {
                "error": "This is the only line left on a placed order. Add a "
                "line before removing it, or cancel the order instead."
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        OrderLog.record(
            order,
            "ITEM_DELETED",
            details={
                "fabric_name": order_item.fabric_name,
                "ordered_quantity": str(order_item.ordered_quantity),
                "metres_removed": str(order_item.ordered_quantity),
            },
            performed_by=request.user,
        )
        order_item.delete()
        recompute_order_total(order)

    return Response({"message": "Item Deleted Successfully"})


class MergeOrderItemsSerializer(serializers.Serializer):
    """Fold duplicate lines of one colour into a single line."""

    keep_item_id = serializers.IntegerField(min_value=1)
    drop_item_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), allow_empty=True
    )

    def validate(self, attrs):
        keep = attrs["keep_item_id"]
        if keep in attrs["drop_item_ids"]:
            raise serializers.ValidationError(
                "The line being kept cannot also be dropped."
            )
        if len(set(attrs["drop_item_ids"])) != len(attrs["drop_item_ids"]):
            raise serializers.ValidationError("A line cannot be dropped twice.")
        return attrs


class MergeOrderItemsView(APIView):
    """Combine duplicate lines of the same colour, in one transaction.

    The wizard used to sum the metres in JavaScript and then issue one request
    per line: `0.1 + 0.2` serialises as `0.30000000000000004`, which the
    serializer rejects, and a failure part-way through left the order holding
    the group's metres twice while the agent was told placement had failed.
    """

    permission_classes = [IsAgentOrAdmin]

    @extend_schema(
        summary="Merge duplicate lines of an order into one",
        request=MergeOrderItemsSerializer,
        responses={200: None, 400: None, 403: None, 404: None},
    )
    def post(self, request, order_id):
        serializer = MergeOrderItemsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        keep_id = serializer.validated_data["keep_item_id"]
        drop_ids = serializer.validated_data["drop_item_ids"]

        with transaction.atomic():
            order = Order.objects.select_for_update().filter(id=order_id).first()
            if order is None:
                return Response(
                    {"error": "Order not found"}, status=status.HTTP_404_NOT_FOUND
                )

            if order.status not in ("DRAFT", "EDITING"):
                return Response(
                    {
                        "error": "Lines can only be merged on a DRAFT or EDITING "
                        "order"
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not _may_touch(request.user, order):
                return Response(
                    {"error": "You can only edit your own orders"},
                    status=status.HTTP_403_FORBIDDEN,
                )

            if _has_allocations(order):
                return Response(
                    {
                        "error": "Part of this order has already been packed, so "
                        "lines can no longer be merged."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            wanted = [keep_id, *drop_ids]
            lines = list(order.items.filter(id__in=wanted))
            if len(lines) != len(wanted):
                return Response(
                    {"error": "One or more lines are not on this order"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            keeper = next(line for line in lines if line.id == keep_id)
            dropping = [line for line in lines if line.id != keep_id]

            variants = {line.variant_id for line in lines}
            if len(variants) > 1:
                return Response(
                    {
                        "error": "Only lines of the same colour can be merged."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # The keeper's rate would be applied to the dropped lines' metres too,
            # so merging lines that were priced differently would quietly reprice
            # the order. Lines that agree carry no information, so only a genuine
            # difference blocks the merge.
            rates = {line.rate_per_meter for line in lines}
            if len(rates) > 1:
                return Response(
                    {
                        "error": "These lines are billed at different rates. Set "
                        "the same rate on each of them before merging."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Decimals all the way: the metres are stored to three places, so
            # the sum must be too.
            merged = sum(
                (line.ordered_quantity for line in lines), ZERO
            ).quantize(METRE)

            if merged > ZERO:
                if merged < keeper.allocated_quantity:
                    return Response(
                        {
                            "error": "The merged total is below the metres already "
                            "packed for this line. Cancel the packing round first."
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                keeper.ordered_quantity = merged
                keeper.save(update_fields=["ordered_quantity"])

            for line in dropping:
                OrderLog.record(
                    order,
                    "ITEM_MERGED",
                    details={
                        "fabric_name": line.fabric_name,
                        "metres_merged": str(line.ordered_quantity),
                        "into_item_id": keep_id,
                    },
                    performed_by=request.user,
                )
                line.delete()

            OrderLog.record(
                order,
                "ORDER_EDITED",
                details={
                    "item_id": keep_id,
                    "fabric_name": keeper.fabric_name,
                    "old_quantity": str(lines[0].ordered_quantity),
                    "new_quantity": str(merged),
                    "merged_lines": len(dropping),
                },
                performed_by=request.user,
            )
            recompute_order_total(order)

        return Response({"message": "Lines merged", "ordered_quantity": str(merged)})


class DeleteOrderItemView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Delete a line from an order",
        responses={200: None, 400: None, 403: None, 404: None},
    )
    def delete(self, request, order_id, item_id):
        order = get_object_or_404(Order, id=order_id)
        order_item = get_object_or_404(OrderItem, id=item_id, order=order)
        return _remove_order_line(request, order, order_item)


class InvoiceView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Get the invoice for an order",
        responses={200: InvoiceSerializer, 403: None, 404: None},
    )
    def get(self, request, order_id):
        order = get_object_or_404(
            Order.objects.prefetch_related("items__variant__fabric"), id=order_id
        )

        # An invoice carries the customer's name, address and GSTIN, so it follows
        # the same ownership rule as the order logs and the price override: an
        # admin may read any, an agent only their own.
        if not _may_touch(request.user, order):
            return Response({"error": "Unauthorized"}, status=403)

        return Response(InvoiceSerializer(order, context={"request": request}).data)


class OrderLogsView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Get the audit log for an order",
        responses={200: None, 403: None, 404: None},
    )
    def get(self, request, order_id):
        order = get_object_or_404(Order, id=order_id)

        if not _may_touch(request.user, order):
            return Response({"error": "Unauthorized"}, status=403)

        return Response(
            [
                {
                    "id": log.id,
                    "action": log.action,
                    "details": log.details,
                    "performed_by": log.performed_by.username if log.performed_by else None,
                    "created_at": log.created_at.isoformat(),
                }
                for log in order.logs.all().order_by("-created_at")
            ]
        )


class OrderItemViewSet(ModelViewSet):
    queryset = OrderItem.objects.all()
    serializer_class = OrderItemSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = OrderItem.objects.select_related("order", "variant", "fabric")
        if user.role != "ADMIN":
            return qs.filter(order__agent__user=user)
        return qs

    def create(self, request, *args, **kwargs):
        # Lines are born through AddOrderItemView, which derives the fabric from
        # the scanned QR, snapshots the rate and checks agent assignment. This
        # route could not target an order at all, so it only ever 500'd.
        return Response(
            {"error": "Use the order add-item endpoint to add a line"},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def destroy(self, request, *args, **kwargs):
        # Route through the same guarded removal as DeleteOrderItemView.
        order_item = self.get_object()
        return _remove_order_line(request, order_item.order, order_item)

    def update(self, request, *args, **kwargs):
        order_item = self.get_object()
        order = order_item.order

        if order.status not in ("DRAFT", "EDITING", "PENDING"):
            return Response(
                {
                    "error": "This order can no longer be edited. Dispatched and "
                    "fully packed orders are fixed."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not _may_touch(request.user, order):
            return Response(
                {"error": "You can only edit your own orders"},
                status=status.HTTP_403_FORBIDDEN,
            )

        old_quantity = order_item.ordered_quantity
        old_rate = order_item.rate_per_meter
        raw_quantity = request.data.get("ordered_quantity", old_quantity)
        try:
            new_quantity = Decimal(str(raw_quantity))
        except (InvalidOperation, TypeError, ValueError):
            return Response(
                {"error": "ordered_quantity must be a number"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if new_quantity <= ZERO:
            return Response(
                {"error": "ordered_quantity must be greater than zero"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Shrinking below what packing already handed over would make the
        # allocation record point past the end of the line.
        if new_quantity < order_item.allocated_quantity:
            return Response(
                {
                    "error": f"{order_item.allocated_quantity} m of this fabric "
                    "has already been packed, so the order cannot be reduced below "
                    "that. Cancel the packing round first."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate before writing anything. The quantity was previously saved
        # first and the serializer validated afterwards, so a bad payload came
        # back as a 400 with the change already committed -- the agent was told
        # the edit failed while the order had in fact moved. Read `partial`
        # without popping it: super().update() needs it to keep PATCH sparse.
        partial = kwargs.get("partial", False)
        self.get_serializer(
            order_item, data=request.data, partial=partial
        ).is_valid(raise_exception=True)

        with transaction.atomic():
            response = super().update(request, *args, **kwargs)
            if old_quantity != new_quantity:
                OrderLog.record(
                    order,
                    "ORDER_EDITED",
                    details={
                        "item_id": order_item.id,
                        "fabric_name": order_item.fabric_name,
                        "old_quantity": str(old_quantity),
                        "new_quantity": str(new_quantity),
                    },
                    performed_by=request.user,
                )
            # ``super().update()`` fetches its own copy of the line, so this one
            # is still the pre-edit row. Read the rate back off the database or
            # a reprice looks like no change and never reaches the audit log.
            order_item.refresh_from_db()
            new_rate = order_item.rate_per_meter
            if old_rate != new_rate:
                OrderLog.record(
                    order,
                    "ITEM_RATE_OVERRIDE"
                    if order_item.is_rate_overridden
                    else "ITEM_RATE_OVERRIDE_CLEARED",
                    details={
                        "item_id": order_item.id,
                        "fabric_name": order_item.fabric_name,
                        "old_rate": str(old_rate),
                        "new_rate": str(new_rate),
                        "catalog_rate": (
                            str(order_item.original_rate_per_meter)
                            if order_item.original_rate_per_meter is not None
                            else None
                        ),
                        "metres": str(order_item.ordered_quantity),
                    },
                    performed_by=request.user,
                )
            # After the write, so a changed colour or rate is billed correctly.
            recompute_order_total(order)

        return response
