from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db.models import F, Prefetch, Sum, ProtectedError
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.accounts.permissions import IsAdmin, check_admin_pin
from apps.agents.models import Agent, AgentItem
from apps.orders.models import OrderItem, RollAllocation

from .models import Fabric, FabricRoll, FabricVariant
from .rolls import (
    RollError,
    adjust_roll,
    clean_meters,
    is_roll_tracked,
    preview_consumption,
    receive_roll,
    receive_rolls,
    roll_payload,
    sync_variant_stock,
    variant_roll_info,
)
from .serializers import (
    ROLL_TRACKED_MESSAGE,
    BulkRollCreateSerializer,
    CreateFabricSerializer,
    CustomerRequirementSerializer,
    FabricRollCreateSerializer,
    FabricRollSerializer,
    FabricSerializer,
    FabricVariantSerializer,
    RollAdjustSerializer,
    RollHistoryEntrySerializer,
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
    return Fabric.objects.prefetch_related(_variants_with_availability()).filter(
        is_deleted=False
    ).exclude(out_of_stock_since__isnull=False, out_of_stock_since__lte=cutoff)


def _variants_with_availability():
    """Every colour's orderable metres, resolved in one extra query.

    ``available_to_order`` would otherwise run one SUM per colour, which on a
    catalogue page is a query per row. Carrying it on the prefetch keeps the
    Inventory list at a constant query count however many colours are shown.
    """
    from apps.orders.stock import variants_with_committed_demand

    return Prefetch("variants", queryset=variants_with_committed_demand())


def _total_stock(qs):
    return FabricVariant.objects.filter(fabric__in=qs).aggregate(
        total=Sum("stock_meters")
    )["total"] or ZERO


def _roll_fields(variant):
    """``(is_roll_tracked, roll_count, roll_stock_meters)`` for a variant row."""
    tracked, count, stock = variant_roll_info(variant)
    return (
        tracked,
        count,
        str(stock),
    )


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
        return _active_fabrics().annotate(
            _total_stock=Sum("variants__stock_meters")
        ).order_by("-id")

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
                            # What is still orderable, so the Inventory page shows
                            # the figure that drops as orders are placed rather
                            # than only the shelf total.
                            "available_meters": str(variant.available_to_order),
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
        # Annotated so each colour's orderable metres ride along with this one
        # query. The scanner shows this figure before the line is even added, so
        # leaving it off would mean showing the shelf total and calling it
        # availability.
        from apps.orders.stock import variants_with_committed_demand

        variants = list(
            variants_with_committed_demand().filter(fabric_id=fabric.id)
        )

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
                        "available_meters": str(v.available_to_order),
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

        # One grouped aggregate for every variant instead of one SUM query per
        # variant; the values are identical, only the round trips change.
        demand = {
            row["variant_id"]: row["outstanding"] or ZERO
            for row in OrderItem.objects.filter(
                order__status__in=OPEN_ORDER_STATUSES
            )
            .values("variant_id")
            .annotate(outstanding=Sum("ordered_quantity") - Sum("allocated_quantity"))
        }

        rows = []
        for variant in qs:
            wanted = demand.get(variant.id, ZERO)
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


class FabricRollViewSet(ModelViewSet):
    """The physical rolls of a colour, and their warehouse history.

    Reading is open to any signed-in user; receiving, adjusting and removing
    cloth is admin-only, like every other stock movement in this project.
    """

    serializer_class = FabricRollSerializer
    lookup_value_regex = "[0-9]+"

    def get_queryset(self):
        qs = FabricRoll.objects.select_related("variant__fabric").all()
        variant_id = self.request.query_params.get("variant")
        if variant_id:
            qs = qs.filter(variant_id=variant_id)
        if self.request.query_params.get("active") in ("1", "true", "True"):
            qs = qs.filter(is_active=True)
        return qs

    def get_permissions(self):
        if self.request.method in ["POST", "PUT", "PATCH", "DELETE"]:
            return [IsAdmin()]
        return [IsAuthenticated()]

    def destroy(self, request, *args, **kwargs):
        """Only a roll nobody has cut from, and that holds nothing, may go.

        Cloth that has been packed is part of the warehouse's record
        (``RollAllocation`` protects it), and cloth still on the shelf belongs to
        the colour's stock, so it has to be handed back first.
        """
        roll = self.get_object()
        if roll.remaining_meters > ZERO:
            return Response(
                {
                    "error": f"{roll.roll_number} still holds "
                    f"{roll.remaining_meters.normalize()} m. Take that cloth off "
                    f"the roll before deleting it."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            roll.delete()
        except ProtectedError:
            return Response(
                {
                    "error": f"{roll.roll_number} has been packed. A roll keeps "
                    f"its record once cloth has been cut from it, so cancel the "
                    f"packing round instead of deleting the roll."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, pk=None):
        """Everything that has been cut from this roll, and what was given back."""
        roll = self.get_object()
        entries = roll.roll_allocations.select_related(
            "allocation__order_item__order__customer", "allocation__round"
        ).order_by("id")
        return Response(
            {
                "roll": FabricRollSerializer(roll).data,
                "entries": RollHistoryEntrySerializer(entries, many=True).data,
            }
        )

    @action(detail=True, methods=["post"], url_path="adjust")
    def adjust(self, request, pk=None):
        """Correct a roll's metres, moving the colour's stock with it."""
        roll = self.get_object()
        serializer = RollAdjustSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            adjust_roll(roll, serializer.validated_data["meters"])
        except RollError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(FabricRollSerializer(roll).data)


class FabricVariantViewSet(ModelViewSet):
    serializer_class = FabricVariantSerializer

    def get_queryset(self):
        return FabricVariant.objects.select_related("fabric").prefetch_related(
            "rolls"
        ).filter(fabric__is_deleted=False)

    def get_permissions(self):
        if self.request.method in ["POST", "PUT", "PATCH", "DELETE"]:
            return [IsAdmin()]
        return [IsAuthenticated()]

    def destroy(self, request, *args, **kwargs):
        """Refuse to drop a colour that still has cloth on its rolls.

        Deleting the colour would take the rolls with it and the metres with
        those, so the stock would quietly disappear. A colour whose rolls are all
        used up but whose cloth has been packed is refused too: those rolls are
        the warehouse's record of what it sent out, and ``RollAllocation``
        protects them.
        """
        variant = self.get_object()
        if variant.rolls.filter(is_active=True, remaining_meters__gt=0).exists():
            return Response(
                {"error": ROLL_TRACKED_MESSAGE},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if RollAllocation.objects.filter(roll__variant=variant).exists():
            return Response(
                {
                    "error": f"{variant.fabric.name} ({variant.display_order or 'unlabelled'}) "
                    f"has packed cloth recorded against its rolls. Keep the colour so "
                    f"the warehouse history stays intact."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            variant.delete()
        except ProtectedError:
            return Response(
                {
                    "error": f"{variant.fabric.name} has packed cloth recorded "
                    f"against its rolls, so it cannot be deleted."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        methods=["GET", "POST"],
        summary="Physical rolls of one colour, and receive a new one",
        request=FabricRollCreateSerializer,
        responses={201: FabricRollSerializer},
    )
    @action(detail=True, methods=["get", "post"], url_path="rolls")
    def rolls(self, request, pk=None):
        # Already carries select_related("fabric") and prefetch_related("rolls"),
        # so the fabric's name and rate and this colour's rolls are both in hand.
        variant = self.get_object()

        if request.method == "GET":
            # Free: these are the prefetched rows.
            rows = list(variant.rolls.all())
            return Response(
                {
                    "variant": variant.pk,
                    "fabric": variant.fabric.name,
                    "display_order": variant.display_order,
                    # The roll's label prints a value, and the fabric's price is
                    # where that value comes from -- the roll stores metres only.
                    "price_per_meter": str(variant.fabric.price_per_meter),
                    "stock_meters": str(variant.stock_meters),
                    # Counted from the rows already read, not fetched again to be
                    # counted: this used to be a second identical query.
                    **roll_payload(variant, rows=rows),
                    "rolls": FabricRollSerializer(rows, many=True).data,
                }
            )

        serializer = FabricRollCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            roll = receive_roll(
                variant,
                serializer.validated_data["meters"],
                roll_number=serializer.validated_data.get("roll_number"),
                note=serializer.validated_data.get("note", ""),
                created_by=request.user,
            )
        except RollError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        variant.refresh_from_db()
        return Response(
            {
                "roll": FabricRollSerializer(roll).data,
                "stock_meters": str(variant.stock_meters),
                **roll_payload(variant),
            },
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        methods=["POST"],
        summary="Receive a factory delivery as several rolls at once",
        request=BulkRollCreateSerializer,
    )
    @action(detail=True, methods=["post"], url_path="rolls/bulk-add")
    def rolls_bulk_add(self, request, pk=None):
        variant = self.get_object()
        serializer = BulkRollCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            created, total, variant = receive_rolls(
                variant,
                serializer.validated_data["rolls"],
                created_by=request.user,
            )
        except RollError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "created": len(created),
                "total_meters": str(total),
                "stock_meters": str(variant.stock_meters),
                **roll_payload(variant),
                "rolls": FabricRollSerializer(created, many=True).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        methods=["GET", "POST"],
        summary="Which rolls a packing of this many metres would come off (best fit)",
    )
    @action(detail=True, methods=["get", "post"], url_path="rolls/preview")
    def rolls_preview(self, request, pk=None):
        variant = self.get_object()
        raw = (
            request.data.get("meters")
            if request.method == "POST"
            else request.query_params.get("meters")
        )
        try:
            metres = clean_meters(raw, field="meters")
        except RollError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(preview_consumption(variant, metres))

    @extend_schema(
        methods=["POST"],
        summary="Put the colour's metre total back in step with its rolls",
    )
    @action(detail=True, methods=["post"], url_path="rolls/sync-stock")
    def rolls_sync_stock(self, request, pk=None):
        """Repair the invariant after somebody edited metres outside the rolls."""
        variant = self.get_object()
        if not is_roll_tracked(variant):
            return Response(
                {"error": "This colour has no physical rolls."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        sync_variant_stock(variant, force=True)
        return Response(
            {
                "stock_meters": str(variant.stock_meters),
                **roll_payload(variant),
            }
        )

    @action(detail=False, methods=["get"], url_path="all")
    def get_all_variants(self, request):
        variants = (
            FabricVariant.objects.select_related("fabric")
            .prefetch_related("rolls")
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
                    **dict(
                        zip(
                            ("is_roll_tracked", "roll_count", "roll_stock_meters"),
                            _roll_fields(variant),
                        )
                    ),
                }
                for variant in variants
            ]
        )
