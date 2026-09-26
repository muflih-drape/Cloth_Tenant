from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db.models import Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from drf_spectacular.utils import OpenApiTypes, extend_schema

from apps.accounts.permissions import IsAdmin, admin_business, check_admin_pin
from apps.agents.models import Agent, AgentItem
from apps.orders.models import OrderItem
from apps.orders.utils import SIZE_MAPPING

from .models import Item, ItemVariant, ItemVariantSize
from .serializers import (
    CreateItemSerializer,
    CustomerRequirementSerializer,
    ItemSerializer,
    ItemVariantSerializer,
    UpdateItemSerializer,
)
from .services import delete_item_keep_history

ITEM_CREATION_SIZES_BY_TYPE = {
    "gents": [
        "S,M,L,XL,XXL",
        "S,M,L,XL",
        "M,L,XL,XXL",
        "M,L,XL",
    ],
    "kids": [
        "20-24",
        "26-36",
        "38",
    ],
}

ORDER_CREATION_SIZES_BY_TYPE = {
    "gents": [
        "S,M,L,XL,XXL",
        "S,M,L,XL",
        "M,L,XL,XXL",
        "M,L,XL",
    ],
    "kids": [
        "20-24",
        "20-36",
        "20-30",
        "26-36",
        "32-36",
        "20-38",
        "26-38",
        "32-38",
    ],
}


def get_agent_reservation_boost(user):
    """Return {(variant_id, size): qty} the agent can additionally see as available
    because of their currently-EDITING orders."""
    boost = {}
    if not hasattr(user, "role") or user.role != "AGENT":
        return boost

    from apps.orders.models import Order

    editing_orders = Order.objects.filter(agent__user=user, status="EDITING")
    for order in editing_orders:
        for snap in order.reservation_snapshot:
            item_type = snap["item_type"]
            if item_type not in SIZE_MAPPING:
                continue
            size_group = snap["size_group"]
            if size_group not in SIZE_MAPPING[item_type]:
                continue
            variant_id = snap["variant_id"]
            qty = snap["quantity"]
            for size in SIZE_MAPPING[item_type][size_group]:
                key = (variant_id, size)
                boost[key] = boost.get(key, 0) + qty
    return boost


def filter_items_by_business(qs, user):
    biz = admin_business(user)
    return qs.filter(type=biz) if biz else qs


def _clamp_int(raw, default, lo, hi):
    try:
        val = int(raw)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, val))


def _sync_total_stock(qs):
    return (
        ItemVariantSize.objects.filter(item_variant__item__in=qs)
        .aggregate(total=Sum("stock"))["total"]
        or 0
    )


def _sync_items_payload(request, qs, page, page_size):
    """Build sync item entries for a page of ``qs`` (constant query count)."""
    start = (page - 1) * page_size
    end = start + page_size
    items = []
    qs = qs.order_by("id")[start:end].prefetch_related("variants__sizes")
    for item in qs:
        first = item.variants.first()
        items.append(
            {
                "id": item.id,
                "rev": item.catalog_updated_at.isoformat(),
                "name": item.name,
                "type": item.type,
                "price": str(item.price),
                "thumb": (
                    request.build_absolute_uri(first.image.url)
                    if first is not None and first.image
                    else None
                ),
                "out_of_stock_since": (
                    item.out_of_stock_since.isoformat()
                    if item.out_of_stock_since
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
                        "sizes": [
                            {"id": s.id, "size": s.size, "stock": s.stock}
                            for s in variant.sizes.all()
                        ],
                    }
                    for variant in item.variants.all()
                ],
            }
        )
    return items


def _sync_stock_payload(since, active_ids):
    rows = ItemVariantSize.objects.filter(
        stock_updated_at__gt=since,
        item_variant__item__in=active_ids,
    ).values_list("id", "size", "stock")
    return [{"id": rid, "size": sz, "stock": st} for rid, sz, st in rows]


class ItemViewSet(ModelViewSet):
    queryset = Item.objects.prefetch_related("variants__sizes").all()
    serializer_class = ItemSerializer

    def get_permissions(self):
        if self.action == "items_sync":
            return [IsAdmin()]
        if self.request.method in ["POST", "PUT", "PATCH", "DELETE"]:
            return [IsAdmin()]
        return [IsAuthenticated()]

    def get_queryset(self):
        cutoff = timezone.now() - timedelta(days=settings.ARCHIVE_AFTER_DAYS)
        return (
            filter_items_by_business(
                Item.objects.prefetch_related("variants__sizes"),
                self.request.user,
            )
            .filter(is_deleted=False)
            .exclude(out_of_stock_since__isnull=False, out_of_stock_since__lte=cutoff)
            .order_by("-id")
        )

    def get_serializer_class(self):
        if self.action == "create":
            return CreateItemSerializer
        if self.action in ["update", "partial_update"]:
            return UpdateItemSerializer
        return ItemSerializer

    def destroy(self, request, *args, **kwargs):
        pin_error = check_admin_pin(request)
        if pin_error:
            return pin_error
        instance = self.get_object()
        delete_item_keep_history(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"], url_path="stock-list")
    def get_stock_list(self, request):
        items = (
            filter_items_by_business(
                Item.objects.prefetch_related("variants__sizes"),
                request.user,
            )
            .filter(is_deleted=False)
            .order_by("-id")
        )

        boost = get_agent_reservation_boost(request.user)

        result = []
        for item in items:
            variants = []
            for variant in item.variants.all():
                sizes = [
                    {
                        "size_range": s.size,
                        "stock": s.stock + boost.get((variant.id, s.size), 0),
                    }
                    for s in variant.sizes.all()
                ]
                variants.append(
                    {
                        "id": variant.id,
                        "qr_code": str(variant.qr_code) if variant.qr_code else None,
                        "image": request.build_absolute_uri(variant.image.url)
                        if variant.image
                        else None,
                        "sizes": sizes,
                        "total_stock": sum(s["stock"] for s in sizes),
                        "display_order": variant.display_order,
                    }
                )

            result.append(
                {
                    "id": item.id,
                    "name": item.name,
                    "type": item.type,
                    "price": str(item.price),
                    "image": request.build_absolute_uri(item.variants.first().image.url)
                    if item.variants.exists() and item.variants.first().image
                    else None,
                    "variants": variants,
                }
            )

        return Response(result)

    @extend_schema(
        summary="Incremental sync feed for the mobile Inventory screen",
        description=(
            "Accepts an opaque cursor (?since=<ISO>) and returns either a delta "
            " (catalog items, stock rows and removed ids since the cursor) or a "
            "full snapshot (bootstrap / out-of-window / too-many-deltas). "
            "Full snapshots are paged via page/page_size. The response also "
            "carries `server_time` (UTC ISO) so clients can correct for "
            "device-clock skew, `check` (an integrity fingerprint over the "
            "server's visible item set) and `archive_after_days`. Delta "
            "`stock` rows carry the ItemVariantSize `id` so clients can map "
            "them onto the sizes returned in `items`."
        ),
        responses={200: OpenApiTypes.OBJECT},
    )
    @action(detail=False, methods=["get"], url_path="sync")
    def items_sync(self, request):
        since_raw = request.query_params.get("since", "").strip()
        page = _clamp_int(request.query_params.get("page"), 1, 1, 10_000_000)
        page_size = _clamp_int(request.query_params.get("page_size"), 100, 1, 500)

        cutoff = timezone.now() - timedelta(days=settings.ARCHIVE_AFTER_DAYS)

        active = (
            filter_items_by_business(
                Item.objects.prefetch_related("variants__sizes"),
                request.user,
            )
            .filter(is_deleted=False)
            .exclude(
                out_of_stock_since__isnull=False, out_of_stock_since__lte=cutoff
            )
        )
        active_ids = set(active.values_list("id", flat=True))

        check = {"items": len(active_ids), "total_stock": _sync_total_stock(active)}

        since = None
        if since_raw:
            try:
                since = timezone.datetime.fromisoformat(since_raw)
                if timezone.is_aware(since):
                    since = timezone.localtime(since)
                else:
                    since = timezone.make_aware(since)
            except ValueError:
                since = None

        cursor = timezone.now()

        use_full = since is None
        if since is not None and not use_full:
            if since < timezone.now() - timedelta(days=settings.ITEM_SYNC_MAX_AGE_DAYS):
                use_full = True

        if not use_full:
            catalog_changed = Item.objects.filter(
                catalog_updated_at__gt=since
            ).values_list("id", flat=True)
            stock_rows = ItemVariantSize.objects.filter(
                stock_updated_at__gt=since,
                item_variant__item__in=active,
            ).count()
            changed_ids = set(catalog_changed)
            if (
                len(changed_ids) + stock_rows
                > settings.ITEM_SYNC_MAX_DELTA_ITEMS
            ):
                use_full = True

        if use_full:
            items_data = _sync_items_payload(request, active, page, page_size)
            page_has_more = (page * page_size) < check["items"]
            return Response(
                {
                    "mode": "full",
                    "cursor": cursor.isoformat(),
                    "server_time": cursor.isoformat(),
                    "archive_after_days": settings.ARCHIVE_AFTER_DAYS,
                    "items": items_data,
                    "stock": [],
                    "removed_item_ids": [],
                    "check": check,
                    "next_page": page + 1 if page_has_more else None,
                }
            )

        changed_ids = set(catalog_changed)
        removed_ids = sorted(changed_ids - active_ids)

        delta_active = active.filter(id__in=changed_ids & active_ids)
        delta_items = _sync_items_payload(request, delta_active, 1, 500)

        stock_rows_data = _sync_stock_payload(since, active_ids)

        return Response(
            {
                "mode": "delta",
                "cursor": cursor.isoformat(),
                "server_time": cursor.isoformat(),
                "archive_after_days": settings.ARCHIVE_AFTER_DAYS,
                "items": delta_items,
                "stock": stock_rows_data,
                "removed_item_ids": removed_ids,
                "check": check,
                "next_page": None,
            }
        )

    @action(detail=False, methods=["get"], url_path="by-qr")
    def get_by_qr(self, request):
        qr_code = request.query_params.get("qr_code", "").strip()

        if not qr_code or len(qr_code) > 255 or "/" in qr_code:
            return Response({"error": "No such item with this QR exists"}, status=400)

        try:
            variant = (
                ItemVariant.objects.select_related("item")
                .prefetch_related("sizes")
                .get(qr_code=qr_code, item__is_deleted=False)
            )
        except (ItemVariant.DoesNotExist, ValidationError):
            return Response({"error": "Invalid QR code"}, status=400)

        biz = admin_business(request.user)
        if biz and variant.item.type != biz:
            return Response({"error": "Not found"}, status=404)

        item = variant.item
        variants = item.variants.prefetch_related("sizes").all()
        agent_id = request.query_params.get("agent_id")
        assigned_variant_ids = None

        if agent_id:
            try:
                agent = Agent.objects.get(user_id=agent_id)
            except Agent.DoesNotExist:
                return Response({"error": "Agent not found"}, status=404)

            assigned_variant_ids = list(
                AgentItem.objects.filter(agent=agent).values_list(
                    "variant_id", flat=True
                )
            )
            if variant.id not in assigned_variant_ids:
                return Response(
                    {
                        "error": "This item is not assigned to you. Please contact admin for assignment."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            variants = variants.filter(id__in=assigned_variant_ids)

        boost = get_agent_reservation_boost(request.user)

        response_variants = []
        for v in variants:
            variant_data = {
                "id": v.id,
                "qr_code": v.qr_code,
                "image": request.build_absolute_uri(v.image.url) if v.image else None,
                "sizes": [
                    {
                        "id": s.id,
                        "size_range": s.size,
                        "stock": s.stock + boost.get((v.id, s.size), 0),
                    }
                    for s in v.sizes.all()
                ],
                "display_order": v.display_order,
            }
            response_variants.append(variant_data)

        return Response(
            {
                "id": item.id,
                "name": item.name,
                "price": item.price,
                "type": item.type,
                "description": item.description,
                "variants": response_variants,
                "matched_variant_id": variant.id,
            }
        )

    @action(detail=False, methods=["get"], url_path="archived")
    def get_archived(self, request):
        cutoff = timezone.now() - timedelta(days=settings.ARCHIVE_AFTER_DAYS)
        items = filter_items_by_business(
            Item.objects.prefetch_related("variants__sizes"),
            request.user,
        ).filter(
            is_deleted=False,
            out_of_stock_since__isnull=False,
            out_of_stock_since__lte=cutoff,
        )
        serializer = self.get_serializer(items, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="by-qr/out-of-stock")
    def check_out_of_stock(self, request):
        qr_code = request.query_params.get("qr_code", "").strip()
        order_id = request.query_params.get("order_id")

        if not qr_code or len(qr_code) > 255 or "/" in qr_code:
            return Response({"error": "Invalid QR code"}, status=400)

        try:
            variant = (
                ItemVariant.objects.select_related("item")
                .prefetch_related("sizes")
                .get(qr_code=qr_code, item__is_deleted=False)
            )
        except (ItemVariant.DoesNotExist, ValidationError):
            return Response({"error": "Variant not found"}, status=404)

        biz = admin_business(request.user)
        if biz and variant.item.type != biz:
            return Response({"error": "Not found"}, status=404)

        item = variant.item
        item_type = item.type
        boost = get_agent_reservation_boost(request.user)

        # Existing draft quantities for this order
        draft_reserved: dict[str, int] = {}

        if order_id:
            draft_items = OrderItem.objects.filter(
                order_id=order_id,
                order__status="DRAFT",
                variant=variant,
            )

            for d in draft_items:
                for draft_size in SIZE_MAPPING[item_type][d.size_group]:
                    draft_reserved[draft_size] = d.quantity

        # Build a flat stock map: { size: total_stock } across all variants
        stock_map: dict[str, int] = {}
        for s in variant.sizes.all():
            effective = s.stock + boost.get((variant.id, s.size), 0)
            # Reducing quantity that are already orderdered by the agent
            effective -= draft_reserved.get(s.size, 0)

            stock_map[s.size] = stock_map.get(s.size, 0) + effective

        size_groups = ORDER_CREATION_SIZES_BY_TYPE.get(item_type, [])

        group_stock = {}
        for group in size_groups:
            members = SIZE_MAPPING[item_type][group]
            group_stock[group] = min(stock_map.get(m, 0) for m in members)

        out_of_stock = all(v == 0 for v in group_stock.values())

        return Response(
            {
                "out_of_stock": out_of_stock,
                "group_stock": group_stock,
            }
        )

    @action(detail=False, methods=["get"], url_path="customer-requirements")
    def customer_requirements(self, request):
        item_id = request.query_params.get("item_id")
        if not item_id:
            return Response(
                {"detail": "item_id query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            order_item = OrderItem.objects.select_related("item").get(pk=item_id)
        except (OrderItem.DoesNotExist, ValueError):
            return Response(
                {"detail": "OrderItem not found."}, status=status.HTTP_404_NOT_FOUND
            )

        if order_item.item is None or order_item.item.is_deleted:
            return Response(
                {"detail": "Item not found."}, status=status.HTTP_404_NOT_FOUND
            )

        item = order_item.item

        biz = admin_business(request.user)
        if biz and item.type != biz:
            return Response(
                {"detail": "Item not found."}, status=status.HTTP_404_NOT_FOUND
            )

        order_items = (
            OrderItem.objects.filter(item=item, packed_quantity=0)
            .select_related("order__customer", "variant")
            .order_by("-id")
        )

        serializer = CustomerRequirementSerializer(
            order_items, many=True, context={"request": request}
        )

        return Response(
            {
                "item": {"id": item.id, "name": item.name},
                "customers": serializer.data,
            }
        )


class ItemVariantViewSet(ModelViewSet):
    queryset = (
        ItemVariant.objects.prefetch_related("sizes")
        .filter(item__is_deleted=False)
        .all()
    )
    serializer_class = ItemVariantSerializer

    def get_permissions(self):
        if self.request.method in ["POST", "PUT", "PATCH", "DELETE"]:
            return [IsAdmin()]
        return [IsAuthenticated()]

    @action(detail=False, methods=["get"], url_path="all")
    def get_all_variants(self, request):
        variants = filter_items_by_business(
            ItemVariant.objects.select_related("item").prefetch_related("sizes"),
            request.user,
        ).filter(item__is_deleted=False)

        boost = get_agent_reservation_boost(request.user)

        result = []
        for variant in variants:
            sizes_with_boost = [
                {"size": s.size, "stock": s.stock + boost.get((variant.id, s.size), 0)}
                for s in variant.sizes.all()
            ]
            total_stock = sum(s["stock"] for s in sizes_with_boost)
            unique_sizes = list(set(s["size"] for s in sizes_with_boost))

            result.append(
                {
                    "id": variant.id,
                    "item_id": variant.item.id,
                    "item_name": variant.item.name,
                    "item_type": variant.item.type,
                    "item_price": str(variant.item.price),
                    "qr_code": str(variant.qr_code) if variant.qr_code else None,
                    "image": request.build_absolute_uri(variant.image.url)
                    if variant.image
                    else None,
                    "sizes": sizes_with_boost,
                    "total_stock": total_stock,
                    "unique_sizes": unique_sizes,
                }
            )

        return Response(result)


class SizeRangesAPIView(APIView):
    def get(self, request):
        return Response(
            {
                "item_creation_sizes_by_type": ITEM_CREATION_SIZES_BY_TYPE,
                "order_creation_sizes_by_type": ORDER_CREATION_SIZES_BY_TYPE,
            }
        )
