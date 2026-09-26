from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db.models import F, Sum
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.accounts.permissions import IsAdmin, check_admin_pin
from apps.agents.models import Agent, AgentItem
from apps.orders.models import OrderItem

from .models import Fabric, FabricVariant
from .serializers import (
    CreateFabricSerializer,
    CustomerRequirementSerializer,
    FabricSerializer,
    FabricVariantSerializer,
    UpdateFabricSerializer,
)
from .services import delete_fabric_keep_history

ZERO = Decimal("0")

#: Order statuses whose lines are still open packing demand.
OPEN_ORDER_STATUSES = ("PENDING", "PACKED")


def _clamp_int(raw, default, lo, hi):
    try:
        val = int(raw)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, val))


def _parse_iso(raw):
    try:
        parsed = timezone.datetime.fromisoformat(raw)
    except (TypeError, ValueError):
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed)
    return parsed


def _active_fabrics():
    """Fabrics still shown in the catalogue (not deleted, not long archived)."""
    cutoff = timezone.now() - timedelta(days=settings.ARCHIVE_AFTER_DAYS)
    return Fabric.objects.prefetch_related("variants").filter(
        is_deleted=False
    ).exclude(out_of_stock_since__isnull=False, out_of_stock_since__lte=cutoff)


def _total_stock(qs):
    return FabricVariant.objects.filter(fabric__in=qs).aggregate(
        total=Sum("stock_meters")
    )["total"] or ZERO


def _sync_fabrics_payload(request, qs, page, page_size):
    """Build sync entries for one page of ``qs`` at constant query count."""
    start = (page - 1) * page_size
    end = start + page_size
    fabrics = []
    qs = qs.order_by("id")[start:end]
    for fabric in qs:
        variants = list(fabric.variants.all())
        first = variants[0] if variants else None
        fabrics.append(
            {
                "id": fabric.id,
                "rev": fabric.catalog_updated_at.isoformat(),
                "name": fabric.name,
                "price_per_meter": str(fabric.price_per_meter),
                "thumb": (
                    request.build_absolute_uri(first.image.url)
                    if first is not None and first.image
                    else None
                ),
                "out_of_stock_since": (
                    fabric.out_of_stock_since.isoformat()
                    if fabric.out_of_stock_since
                    else None
                ),
                "variants": [
                    {
                        "id": variant.id,
                        "qr_code": str(variant.qr_code) if variant.qr_code else None,
                        "display_order": variant.display_order,
                        "image": (
                            request.build_absolute_uri(variant.image.url)
                            if variant.image
                            else None
                        ),
                        "stock_meters": str(variant.stock_meters),
                        "stock_updated_at": variant.stock_updated_at.isoformat(),
                    }
                    for variant in variants
                ],
            }
        )
    return fabrics


def _sync_stock_payload(since, active_ids):
    """Variants whose metre stock moved since the cursor."""
    rows = FabricVariant.objects.filter(
        stock_updated_at__gt=since, fabric__in=active_ids
    ).values_list("id", "stock_meters")
    return [
        {"variant_id": vid, "stock_meters": str(stock)} for vid, stock in rows
    ]


class FabricViewSet(ModelViewSet):
    serializer_class = FabricSerializer

    def get_queryset(self):
        return _active_fabrics().order_by("-id")

    def get_permissions(self):
        if self.action == "fabrics_sync":
            return [IsAdmin()]
        if self.request.method in ["POST", "PUT", "PATCH", "DELETE"]:
            return [IsAdmin()]
        return [IsAuthenticated()]

    def get_serializer_class(self):
        if self.action == "create":
            return CreateFabricSerializer
        if self.action in ["update", "partial_update"]:
            return UpdateFabricSerializer
        return FabricSerializer

    def destroy(self, request, *args, **kwargs):
        pin_error = check_admin_pin(request)
        if pin_error:
            return pin_error
        delete_fabric_keep_history(self.get_object())
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"], url_path="stock-list")
    def get_stock_list(self, request):
        """Every fabric with its per-colour metre stock, for the order wizard."""
        result = []
        for fabric in _active_fabrics().order_by("-id"):
            variants = list(fabric.variants.all())
            result.append(
                {
                    "id": fabric.id,
                    "name": fabric.name,
                    "price_per_meter": str(fabric.price_per_meter),
                    "image": (
                        request.build_absolute_uri(variants[0].image.url)
                        if variants and variants[0].image
                        else None
                    ),
                    "variants": [
                        {
                            "id": variant.id,
                            "qr_code": (
                                str(variant.qr_code) if variant.qr_code else None
                            ),
                            "display_order": variant.display_order,
                            "image": (
                                request.build_absolute_uri(variant.image.url)
                                if variant.image
                                else None
                            ),
                            "stock_meters": str(variant.stock_meters),
                        }
                        for variant in variants
                    ],
                }
            )
        return Response(result)

    @extend_schema(
        summary="Incremental sync feed for the mobile Inventory screen",
        description=(
            "Accepts an opaque cursor (?since=<ISO>) and returns either a delta "
            "(catalog fabrics, stock rows and removed ids since the cursor) or a "
            "full snapshot (bootstrap / out-of-window / too-many-deltas). "
            "Full snapshots are paged via page/page_size. The response also "
            "carries `server_time` (UTC ISO) so clients can correct for "
            "device-clock skew, `check` (an integrity fingerprint over the "
            "server's visible fabric set) and `archive_after_days`. Delta "
            "`stock` rows carry the FabricVariant `variant_id`."
        ),
        responses={200: OpenApiTypes.OBJECT},
    )
    @action(detail=False, methods=["get"], url_path="sync")
    def fabrics_sync(self, request):
        since_raw = request.query_params.get("since", "").strip()
        page = _clamp_int(request.query_params.get("page"), 1, 1, 10_000_000)
        page_size = _clamp_int(request.query_params.get("page_size"), 100, 1, 500)

        active = _active_fabrics()
        active_ids = set(active.values_list("id", flat=True))

        check = {
            "fabrics": len(active_ids),
            "total_stock_meters": str(_total_stock(active)),
        }

        since = _parse_iso(since_raw) if since_raw else None
        cursor = timezone.now()

        use_full = since is None
        if since is not None and since < cursor - timedelta(
            days=settings.FABRIC_SYNC_MAX_AGE_DAYS
        ):
            use_full = True

        catalog_changed = set(
            Fabric.objects.filter(catalog_updated_at__gt=since).values_list(
                "id", flat=True
            )
        ) if since is not None else set()

        if not use_full:
            stock_rows = FabricVariant.objects.filter(
                stock_updated_at__gt=since, fabric__in=active
            ).count()
            if len(catalog_changed) + stock_rows > settings.FABRIC_SYNC_MAX_DELTA_FABRICS:
                use_full = True

        if use_full:
            fabrics_data = _sync_fabrics_payload(request, active, page, page_size)
            page_has_more = (page * page_size) < check["fabrics"]
            return Response(
                {
                    "mode": "full",
                    "cursor": cursor.isoformat(),
                    "server_time": cursor.isoformat(),
                    "archive_after_days": settings.ARCHIVE_AFTER_DAYS,
                    "fabrics": fabrics_data,
                    "stock": [],
                    "removed_fabric_ids": [],
                    "check": check,
                    "next_page": page + 1 if page_has_more else None,
                }
            )

        removed_ids = sorted(catalog_changed - active_ids)
        delta_active = active.filter(id__in=catalog_changed & active_ids)

        return Response(
            {
                "mode": "delta",
                "cursor": cursor.isoformat(),
                "server_time": cursor.isoformat(),
                "archive_after_days": settings.ARCHIVE_AFTER_DAYS,
                "fabrics": _sync_fabrics_payload(request, delta_active, 1, 500),
                "stock": _sync_stock_payload(since, active_ids),
                "removed_fabric_ids": removed_ids,
                "check": check,
                "next_page": None,
            }
        )

    @action(detail=False, methods=["get"], url_path="by-qr")
    def get_by_qr(self, request):
        """Resolve a scanned fabric QR into the fabric and its colours."""
        qr_code = request.query_params.get("qr_code", "").strip()
        if not qr_code or len(qr_code) > 255 or "/" in qr_code:
            return Response(
                {"error": "No such fabric with this QR exists"}, status=400
            )

        try:
            variant = FabricVariant.objects.select_related("fabric").get(
                qr_code=qr_code, fabric__is_deleted=False
            )
        except (FabricVariant.DoesNotExist, ValidationError):
            return Response({"error": "Invalid QR code"}, status=400)

        fabric = variant.fabric
        variants = list(fabric.variants.all())

        agent_id = request.query_params.get("agent_id")
        if agent_id:
            try:
                agent = Agent.objects.get(user_id=agent_id)
            except Agent.DoesNotExist:
                return Response({"error": "Agent not found"}, status=404)

            assigned_variant_ids = set(
                AgentItem.objects.filter(agent=agent).values_list(
                    "variant_id", flat=True
                )
            )
            if variant.id not in assigned_variant_ids:
                return Response(
                    {
                        "error": "This fabric is not assigned to you. Please "
                        "contact admin for assignment."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            variants = [v for v in variants if v.id in assigned_variant_ids]

        return Response(
            {
                "id": fabric.id,
                "name": fabric.name,
                "price_per_meter": str(fabric.price_per_meter),
                "description": fabric.description,
                "variants": [
                    {
                        "id": v.id,
                        "qr_code": str(v.qr_code),
                        "image": (
                            request.build_absolute_uri(v.image.url) if v.image else None
                        ),
                        "display_order": v.display_order,
                        "stock_meters": str(v.stock_meters),
                    }
                    for v in variants
                ],
                "matched_variant_id": variant.id,
            }
        )

    @action(detail=False, methods=["get"], url_path="archived")
    def get_archived(self, request):
        cutoff = timezone.now() - timedelta(days=settings.ARCHIVE_AFTER_DAYS)
        fabrics = Fabric.objects.prefetch_related("variants").filter(
            is_deleted=False,
            out_of_stock_since__isnull=False,
            out_of_stock_since__lte=cutoff,
        )
        return Response(FabricSerializer(fabrics, many=True).data)

    @action(detail=False, methods=["get"], url_path="outstanding-demand")
    def outstanding_demand(self, request):
        """Metres still wanted per variant, and how much cloth is on hand.

        This is the number that tells the admin whether an order is routine or
        genuinely oversubscribed.
        """
        variant_id = request.query_params.get("variant")
        qs = FabricVariant.objects.select_related("fabric").filter(
            fabric__is_deleted=False
        )
        if variant_id:
            qs = qs.filter(pk=variant_id)

        rows = []
        for variant in qs:
            wanted = OrderItem.objects.filter(
                variant=variant, order__status__in=OPEN_ORDER_STATUSES
            ).aggregate(total=Sum("ordered_quantity") - Sum("allocated_quantity"))[
                "total"
            ] or ZERO
            rows.append(
                {
                    "variant": variant.id,
                    "fabric": variant.fabric.name,
                    "fabric_id": variant.fabric_id,
                    "display_order": variant.display_order,
                    "stock_meters": str(variant.stock_meters),
                    "outstanding_meters": str(wanted),
                    "is_backordered": wanted > variant.stock_meters,
                }
            )
        return Response(rows)

    @action(detail=False, methods=["get"], url_path="customer-requirements")
    def customer_requirements(self, request):
        """Who is waiting for a given fabric, and how much each still needs."""
        fabric_id = request.query_params.get("fabric_id")
        if not fabric_id:
            return Response(
                {"detail": "fabric_id query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            fabric = Fabric.objects.get(pk=fabric_id)
        except (Fabric.DoesNotExist, ValueError):
            return Response(
                {"detail": "Fabric not found."}, status=status.HTTP_404_NOT_FOUND
            )

        if fabric.is_deleted:
            return Response(
                {"detail": "Fabric not found."}, status=status.HTTP_404_NOT_FOUND
            )

        order_items = (
            OrderItem.objects.filter(fabric=fabric)
            .filter(order__status__in=OPEN_ORDER_STATUSES)
            .filter(allocated_quantity__lt=F("ordered_quantity"))
            .select_related("order__customer", "order__agent__user", "variant")
            .order_by("-order__created_at")
        )

        return Response(
            {
                "fabric": {
                    "id": fabric.id,
                    "name": fabric.name,
                    "price_per_meter": str(fabric.price_per_meter),
                },
                "customers": CustomerRequirementSerializer(
                    order_items, many=True, context={"request": request}
                ).data,
            }
        )


class FabricVariantViewSet(ModelViewSet):
    serializer_class = FabricVariantSerializer

    def get_queryset(self):
        return FabricVariant.objects.select_related("fabric").filter(
            fabric__is_deleted=False
        )

    def get_permissions(self):
        if self.request.method in ["POST", "PUT", "PATCH", "DELETE"]:
            return [IsAdmin()]
        return [IsAuthenticated()]

    @action(detail=False, methods=["get"], url_path="all")
    def get_all_variants(self, request):
        variants = (
            FabricVariant.objects.select_related("fabric")
            .filter(fabric__is_deleted=False)
            .order_by("fabric__name", "display_order")
        )

        return Response(
            [
                {
                    "id": variant.id,
                    "fabric_id": variant.fabric_id,
                    "fabric_name": variant.fabric.name,
                    "price_per_meter": str(variant.fabric.price_per_meter),
                    "qr_code": str(variant.qr_code) if variant.qr_code else None,
                    "display_order": variant.display_order,
                    "image": (
                        request.build_absolute_uri(variant.image.url)
                        if variant.image
                        else None
                    ),
                    "stock_meters": str(variant.stock_meters),
                    "stock_updated_at": variant.stock_updated_at.isoformat(),
                }
                for variant in variants
            ]
        )
