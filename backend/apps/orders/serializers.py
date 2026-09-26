from decimal import Decimal

from django.conf import settings
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
            "variant_image",
            "ordered_quantity",
            "allocated_quantity",
            "outstanding_quantity",
            "line_total",
            "allocation_count",
        ]
        read_only_fields = (
            "order",
            "fabric_name",
            "rate_per_meter",
            "variant_image",
            "allocated_quantity",
        )

    def get_line_total(self, obj):
        return str(line_value(obj).quantize(CENT))

    def get_allocation_count(self, obj):
        return obj.allocations.count()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")

        variant_image = data.get("variant_image")
        if not variant_image and request and instance.variant and instance.variant.image:
            data["variant_image"] = request.build_absolute_uri(instance.variant.image.url)
        elif variant_image and request and not variant_image.startswith("http"):
            data["variant_image"] = request.build_absolute_uri(variant_image)

        return data


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
        read_only_fields = ("created_by",)

    def get_totals(self, obj):
        totals = order_totals(obj)
        return {
            **totals,
            "total_ordered_meters": str(totals["total_ordered_meters"]),
            "total_allocated_meters": str(totals["total_allocated_meters"]),
            "total_outstanding_meters": str(totals["total_outstanding_meters"]),
            "computed_total": str(totals["computed_total"]),
            "final_total": (
                str(totals["final_total"]) if totals["final_total"] is not None else None
            ),
            "effective_total": str(totals["effective_total"]),
            "price_overridden_at": (
                totals["price_overridden_at"].isoformat()
                if totals["price_overridden_at"]
                else None
            ),
        }


class AddOrderItemSerializer(serializers.Serializer):
    """Add a fabric line to a draft by scanning its QR label."""

    qr_code = serializers.UUIDField()
    ordered_quantity = serializers.DecimalField(
        max_digits=14, decimal_places=3, min_value=MIN_ORDER_METERS
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
        attrs["rate_per_meter"] = variant.fabric.price_per_meter
        attrs["variant_display_order"] = variant.display_order or ""

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
        totals = order_totals(obj)
        return {
            "total_ordered_meters": str(totals["total_ordered_meters"]),
            "total_allocated_meters": str(totals["total_allocated_meters"]),
            "total_outstanding_meters": str(totals["total_outstanding_meters"]),
            "computed_total": str(totals["computed_total"]),
            "final_total": (
                str(totals["final_total"]) if totals["final_total"] is not None else None
            ),
            "total_price": str(totals["effective_total"]),
            "is_price_overridden": totals["is_price_overridden"],
            "price_override_reason": totals["price_override_reason"],
        }
