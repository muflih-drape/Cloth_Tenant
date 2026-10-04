from decimal import Decimal

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from apps.agents.models import Agent
from apps.business.models import Brand
from apps.customers.models import Customer
from apps.items.models import FabricVariant

from .models import Allocation, Order, OrderItem
from .pricing import line_value, order_totals

CENT = Decimal("0.01")

#: Smallest orderable quantity: one gram, i.e. 0.001 m at 3 decimal places.
#: Anything below this is a rounding artefact, not a real order line.
MIN_ORDER_METERS = Decimal("0.001")

#: A negotiated rate has to be money: one paisa per metre is the floor.
MIN_RATE = CENT


def rate_columns(request, catalog_rate, override):
    """Decide what one order line will be billed at.

    ``override`` is the rate typed on the item preview page, and is optional --
    leave it out and the line is billed at the catalogue rate as before. The
    returned columns are written to the ``OrderItem`` only; ``Fabric``'s
    ``price_per_meter`` is never touched, so a price agreed with one customer
    cannot leak into the price every other customer pays.

    An agent is held to the catalogue rate, mirroring ``SetOrderPriceView``'s cap
    on the order total: they can discount a line, but only an admin can bill
    above catalogue.
    """
    if override is None or override == catalog_rate:
        return {
            "rate_per_meter": catalog_rate,
            "original_rate_per_meter": catalog_rate,
            "rate_overridden_by": None,
            "rate_overridden_at": None,
        }

    if request.user.role == "AGENT" and override > catalog_rate:
        raise serializers.ValidationError(
            {
                "rate_override": "An agent rate cannot be higher than the "
                f"catalogue rate of {catalog_rate:,.2f}"
            }
        )

    return {
        "rate_per_meter": override,
        "original_rate_per_meter": catalog_rate,
        "rate_overridden_by": request.user,
        "rate_overridden_at": timezone.now(),
    }


class SimpleCustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["id", "name", "contact", "address", "gst"]


class SimpleAgentSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username")

    class Meta:
        model = Agent
        fields = ["id", "username", "contact"]


class SimpleBrandSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()

    class Meta:
        model = Brand
        fields = [
            "id",
            "name",
            "phone",
            "email",
            "address_line1",
            "address_line2",
            "gst",
            "logo_url",
        ]

    def get_logo_url(self, obj):
        request = self.context.get("request")
        if obj.logo and request:
            return request.build_absolute_uri(obj.logo.url)
        return None


class OrderItemSerializer(serializers.ModelSerializer):
    fabric_name_display = serializers.CharField(source="fabric_name", read_only=True)
    variant_display_order = serializers.CharField(
        source="variant.display_order", read_only=True
    )
    outstanding_quantity = serializers.DecimalField(
        max_digits=14, decimal_places=3, read_only=True
    )
    line_total = serializers.SerializerMethodField()
    allocation_count = serializers.SerializerMethodField()
    is_rate_overridden = serializers.BooleanField(read_only=True)
    #: Whether this colour's metres live on physical rolls, so the order page can
    #: offer the scan-a-roll control instead of a typed figure.
    is_roll_tracked = serializers.SerializerMethodField()
    #: What is still orderable of this line's colour, warehouse total less every
    #: order's claim on it. Carried on the line so the order form can say "this
    #: will oversell" while the agent types, instead of only after they commit.
    #: Includes this line's own outstanding metres, so it is the figure to
    #: compare an edit against.
    variant_available_meters = serializers.SerializerMethodField()
    rate_overridden_by = serializers.CharField(
        source="rate_overridden_by.username", read_only=True
    )
    #: Write-only: the rate to bill this line at instead of the catalogue one.
    rate_override = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=MIN_RATE,
        required=False,
        write_only=True,
    )

    class Meta:
        model = OrderItem
        fields = [
            "id",
            "fabric",
            "variant",
            "variant_display_order",
            "fabric_name",
            "fabric_name_display",
            "rate_per_meter",
            "original_rate_per_meter",
            "is_rate_overridden",
            "rate_overridden_by",
            "rate_overridden_at",
            "rate_override",
            "variant_image",
            "ordered_quantity",
            "allocated_quantity",
            "outstanding_quantity",
            "line_total",
            "allocation_count",
            "is_roll_tracked",
            "variant_available_meters",
        ]
        read_only_fields = (
            "order",
            "fabric_name",
            "rate_per_meter",
            "original_rate_per_meter",
            "rate_overridden_by",
            "rate_overridden_at",
            "variant_image",
            "allocated_quantity",
        )

    def get_line_total(self, obj):
        return str(line_value(obj).quantize(CENT))

    def get_allocation_count(self, obj):
        return obj.allocations.count()

    def get_is_roll_tracked(self, obj):
        from apps.items.rolls import is_roll_tracked

        return obj.variant_id is not None and is_roll_tracked(obj.variant)

    def get_variant_available_meters(self, obj):
        if obj.variant_id is None:
            return None
        # Reads the annotated prefetch when the order came through the viewset, and
        # falls back to a single sum for a line fetched on its own.
        return str(obj.variant.available_to_order)

    def validate(self, attrs):
        """Keep the line internally consistent and its snapshots honest.

        ``variant`` was writable without being cross-checked against ``fabric``,
        so a PATCH could re-point a line at another fabric's cloth while
        ``fabric_name`` and ``rate_per_meter`` -- both read-only -- kept
        describing the old one. The order then billed fabric A's rate for
        fabric B's metres, and the packing board queued the line against a
        variant that had never been paid for.
        """
        variant = attrs.get("variant")
        override = attrs.pop("rate_override", None)

        if variant is None:
            if "fabric" in attrs and self.instance is not None:
                raise serializers.ValidationError(
                    {"variant": "A colour is required to change the fabric."}
                )
            if override is not None:
                attrs.update(self._rate_attrs(override))
            return attrs

        if variant.fabric.is_deleted:
            raise serializers.ValidationError(
                {"variant": "This fabric has been deleted."}
            )

        # Whether this edit moves the line onto different cloth. A line that stays
        # on its colour must keep whatever rate was agreed for it, even though the
        # client sends the colour again with every edit.
        changing_variant = (
            self.instance is not None and self.instance.variant_id != variant.id
        )

        if changing_variant and self.instance.allocations.exists():
            raise serializers.ValidationError(
                {
                    "variant": "This line has already been packed, so the colour "
                    "cannot be changed. Cancel the packing round first."
                }
            )

        # The variant is the source of truth for the fabric and the rate.
        attrs["fabric"] = variant.fabric
        attrs["fabric_name"] = variant.fabric.name
        attrs["variant_display_order"] = variant.display_order or ""

        if override is not None:
            attrs.update(self._rate_attrs(override, variant.fabric.price_per_meter))
        elif changing_variant:
            # Different cloth, no agreed rate: bill the new colour's catalogue
            # rate and rebase the snapshot onto it. Leaving the old snapshot and
            # the old "repriced by" behind would report a difference that no
            # longer exists and credit the wrong person with it.
            attrs.update(
                {
                    "rate_per_meter": variant.fabric.price_per_meter,
                    "original_rate_per_meter": variant.fabric.price_per_meter,
                    "rate_overridden_by": None,
                    "rate_overridden_at": None,
                }
            )

        return attrs

    def _rate_attrs(self, override, catalog_rate=None):
        """Validate a client-supplied rate for this line.

        The catalogue rate comes from the colour being moved to when there is
        one, and otherwise from the fabric the line already points at -- so a
        quantity edit that also carries ``rate_override`` is capped against the
        right price.
        """
        if catalog_rate is None:
            fabric = self.instance.fabric if self.instance else None
            catalog_rate = fabric.price_per_meter if fabric else None

        if catalog_rate is None:
            raise serializers.ValidationError(
                {
                    "rate_override": "This line's fabric is no longer in the "
                    "catalogue, so its rate cannot be changed."
                }
            )

        return rate_columns(self.context["request"], catalog_rate, override)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")

        variant_image = data.get("variant_image")
        if not variant_image and request and instance.variant and instance.variant.image:
            data["variant_image"] = request.build_absolute_uri(instance.variant.image.url)
        elif variant_image and request and not variant_image.startswith("http"):
            data["variant_image"] = request.build_absolute_uri(variant_image)

        return data


def order_totals_payload(order):
    """The one totals shape every order endpoint returns, as JSON-safe values.

    Both the order and the invoice payloads render money, so they must agree
    key for key -- a consumer reading ``totals.effective_total`` has to find it
    on both. This used to be spelled out twice and the copies drifted, which is
    what left the invoice subtotal, GST and grand total rendering as zero.
    """
    totals = order_totals(order)
    return {
        "total_ordered_meters": str(totals["total_ordered_meters"]),
        "total_allocated_meters": str(totals["total_allocated_meters"]),
        "total_outstanding_meters": str(totals["total_outstanding_meters"]),
        "computed_total": str(totals["computed_total"]),
        "final_total": (
            str(totals["final_total"]) if totals["final_total"] is not None else None
        ),
        "effective_total": str(totals["effective_total"]),
        "is_price_overridden": totals["is_price_overridden"],
        "price_override_reason": totals["price_override_reason"],
        "price_overridden_by": totals["price_overridden_by"],
        "price_overridden_at": (
            totals["price_overridden_at"].isoformat()
            if totals["price_overridden_at"]
            else None
        ),
    }


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    customer = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.filter(is_active=True), write_only=True
    )
    agent_details = SimpleAgentSerializer(source="agent", read_only=True)
    customer_details = SimpleCustomerSerializer(source="customer", read_only=True)
    created_by = serializers.PrimaryKeyRelatedField(read_only=True)

    totals = serializers.SerializerMethodField()
    is_price_overridden = serializers.BooleanField(read_only=True)

    class Meta:
        model = Order
        fields = "__all__"
        # Money and lifecycle are server-owned. The total is reachable only via
        # SetOrderPriceView, which caps an agent at the line arithmetic, allows
        # the change on drafts only, and writes an audit entry. Leaving these
        # writable let a plain PATCH skip every one of those rules.
        read_only_fields = (
            "created_by",
            "computed_total",
            "final_total",
            "price_override_reason",
            "price_overridden_by",
            "price_overridden_at",
            "status",
            "shortfall_reason",
            "edit_snapshot",
            "editing_started_at",
        )

    def get_totals(self, obj):
        return order_totals_payload(obj)


class AddOrderItemSerializer(serializers.Serializer):
    """Add a fabric line to a draft by scanning its QR label.

    ``rate_override`` is optional. Send it to bill this one line at a rate
    negotiated for this customer; omit it and the catalogue rate applies.
    """

    qr_code = serializers.UUIDField()
    ordered_quantity = serializers.DecimalField(
        max_digits=14, decimal_places=3, min_value=MIN_ORDER_METERS
    )
    rate_override = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=MIN_RATE,
        required=False,
        write_only=True,
    )

    def validate(self, attrs):
        try:
            variant = FabricVariant.objects.select_related("fabric").get(
                qr_code=attrs["qr_code"]
            )
        except FabricVariant.DoesNotExist:
            raise serializers.ValidationError("Invalid QR Code")

        if variant.fabric.is_deleted:
            raise serializers.ValidationError("This fabric has been deleted")

        attrs["variant"] = variant
        attrs["fabric"] = variant.fabric

        request = self.context.get("request")
        image_url = getattr(variant.image, "url", None) if variant.image else None
        attrs["variant_image"] = (
            request.build_absolute_uri(image_url) if request and image_url else None
        )

        attrs["fabric_name"] = variant.fabric.name
        attrs["variant_display_order"] = variant.display_order or ""

        catalog_rate = variant.fabric.price_per_meter
        attrs.update(
            rate_columns(request, catalog_rate, attrs.pop("rate_override", None))
        )

        return attrs


class AllocationSerializer(serializers.ModelSerializer):
    customer = serializers.CharField(source="order_item.order.customer.name", read_only=True)
    fabric = serializers.CharField(source="order_item.fabric_name", read_only=True)

    class Meta:
        model = Allocation
        fields = [
            "id",
            "metres",
            "sequence",
            "is_priority_award",
            "created_at",
            "customer",
            "fabric",
        ]


class InvoiceSerializer(serializers.ModelSerializer):
    customer = SimpleCustomerSerializer()
    agent = SimpleAgentSerializer()
    items = OrderItemSerializer(many=True)
    brand = serializers.SerializerMethodField()
    totals = serializers.SerializerMethodField()
    gst_rate = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id",
            "customer",
            "agent",
            "brand",
            "created_at",
            "status",
            "items",
            "totals",
            "gst_rate",
            "lr_number",
            "notes",
        ]

    def get_gst_rate(self, obj):
        return settings.GST_RATE

    def get_brand(self, obj):
        brand = Brand.objects.order_by("id").first()
        if brand is None:
            return None
        return SimpleBrandSerializer(brand, context=self.context).data

    def get_totals(self, obj):
        return order_totals_payload(obj)
