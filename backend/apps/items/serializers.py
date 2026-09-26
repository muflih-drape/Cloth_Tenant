import uuid
from datetime import timedelta
from io import BytesIO

from django.conf import settings
from django.core.files.base import ContentFile
from django.db.models import Sum
from django.utils import timezone
from PIL import Image
from rest_framework import serializers

from .models import Fabric, FabricVariant
from .services import sync_out_of_stock, touch_catalog


class FabricVariantSerializer(serializers.ModelSerializer):
    """One colour/finish of a fabric: its own QR label, image and metre stock."""

    class Meta:
        model = FabricVariant
        fields = [
            "id",
            "qr_code",
            "image",
            "display_order",
            "stock_meters",
            "stock_updated_at",
        ]
        read_only_fields = ["qr_code", "stock_updated_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if data.get("image") and request:
            data["image"] = request.build_absolute_uri(data["image"])
        return data

    def create(self, validated_data):
        variant = FabricVariant.objects.create(**validated_data)
        touch_catalog(variant.fabric)
        sync_out_of_stock(variant.fabric)
        return variant

    def update(self, instance, validated_data):
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        touch_catalog(instance.fabric)
        return instance


class FabricSerializer(serializers.ModelSerializer):
    """A cloth quality, priced per metre, with its colour variants."""

    variants = FabricVariantSerializer(many=True, read_only=True)
    total_stock_meters = serializers.SerializerMethodField()
    purge_on = serializers.SerializerMethodField()
    days_until_purge = serializers.SerializerMethodField()

    class Meta:
        model = Fabric
        fields = [
            "id",
            "name",
            "description",
            "price_per_meter",
            "variants",
            "total_stock_meters",
            "out_of_stock_since",
            "purge_on",
            "days_until_purge",
        ]

    def get_total_stock_meters(self, obj):
        total = obj.variants.aggregate(total=Sum("stock_meters"))["total"]
        return str(total or 0)

    def _purge_date(self, obj):
        if not obj.out_of_stock_since:
            return None
        total = (
            settings.ARCHIVE_AFTER_DAYS + settings.ARCHIVED_FABRIC_RETENTION_DAYS
        )
        return timezone.localdate(obj.out_of_stock_since + timedelta(days=total))

    def get_purge_on(self, obj):
        purge = self._purge_date(obj)
        return purge.isoformat() if purge else None

    def get_days_until_purge(self, obj):
        purge = self._purge_date(obj)
        if purge is None:
            return None
        return max((purge - timezone.localdate()).days, 0)


class FabricVariantRequestSerializer(serializers.Serializer):
    id = serializers.IntegerField(required=False)
    image = serializers.FileField(required=False)
    remove_image = serializers.BooleanField(required=False, default=False)
    display_order = serializers.CharField(
        max_length=100, required=False, allow_null=True, allow_blank=True
    )
    stock_meters = serializers.DecimalField(
        max_digits=14,
        decimal_places=3,
        required=False,
        allow_null=True,
        help_text="Opening stock in metres, for a new variant only.",
    )


class CreateFabricSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    description = serializers.CharField(required=False, default="")
    price_per_meter = serializers.DecimalField(max_digits=10, decimal_places=2)
    variants = FabricVariantRequestSerializer(many=True)

    def validate_price_per_meter(self, value):
        if value <= 0:
            raise serializers.ValidationError("Price per metre must be greater than zero.")
        return value

    def validate_variants(self, variants):
        seen = set()
        for variant in variants:
            if variant.get("id"):
                if variant["id"] in seen:
                    raise serializers.ValidationError(
                        f"Variant {variant['id']} was sent twice."
                    )
                seen.add(variant["id"])
        return variants

    def create(self, validated_data):
        variants_data = validated_data.pop("variants", [])
        fabric = Fabric.objects.create(**validated_data)
        for variant_data in variants_data:
            self._create_variant(fabric, variant_data)
        return fabric

    def _create_variant(self, fabric, variant_data):
        image_file = variant_data.pop("image", None)
        variant_data.pop("remove_image", None)  # nothing to remove on create
        stock = variant_data.pop("stock_meters", None) or 0
        display_order = variant_data.pop("display_order", None) or None

        variant = FabricVariant.objects.create(
            fabric=fabric,
            qr_code=uuid.uuid4(),
            display_order=display_order,
            stock_meters=stock,
        )
        if image_file:
            self._save_variant_image(variant, image_file)
        sync_out_of_stock(fabric)
        return variant

    def _save_variant_image(self, variant, image_file):
        if not image_file:
            return

        img = Image.open(image_file)
        has_transparency = img.mode in ("RGBA", "P", "LA")

        if has_transparency:
            img = img.convert("RGBA")
            img.thumbnail((1024, 1024))
            buffer = BytesIO()
            img.save(buffer, format="PNG", optimize=True)
            ext = "png"
        else:
            img = img.convert("RGB")
            img.thumbnail((1024, 1024))
            buffer = BytesIO()
            img.save(buffer, format="JPEG", quality=80)
            ext = "jpg"

        file_name = f"{uuid.uuid4().hex}.{ext}"

        if variant.image:
            variant.image.delete(save=False)

        variant.image.save(file_name, ContentFile(buffer.getvalue()), save=True)

    def update(self, instance, validated_data):
        variants_data = validated_data.pop("variants", [])

        instance.name = validated_data.get("name", instance.name)
        instance.description = validated_data.get(
            "description", instance.description
        )
        instance.price_per_meter = validated_data.get(
            "price_per_meter", instance.price_per_meter
        )
        instance.save()

        existing = {v.id: v for v in instance.variants.all()}

        for variant_data in variants_data:
            variant_id = variant_data.get("id")
            remove_image = variant_data.get("remove_image", False)

            if variant_id and variant_id in existing:
                variant = existing.pop(variant_id)

                if "display_order" in variant_data:
                    variant.display_order = variant_data.get("display_order") or None

                if remove_image and variant.image:
                    variant.image.delete(save=False)
                    variant.image = None

                image_file = variant_data.get("image")
                if image_file:
                    self._save_variant_image(variant, image_file)
                variant.save()
            else:
                self._create_variant(instance, dict(variant_data))

        for variant in existing.values():
            variant.delete()

        touch_catalog(instance)
        return instance


UpdateFabricSerializer = CreateFabricSerializer


class CustomerRequirementSerializer(serializers.Serializer):
    """One line of open packing demand, as shown on the admin packing board."""

    order_id = serializers.IntegerField()
    order_status = serializers.CharField(source="order.status")
    customer_name = serializers.CharField(source="order.customer.name")
    agent = serializers.SerializerMethodField()
    fabric_name = serializers.CharField()
    variant_display_order = serializers.CharField(default="")
    ordered_quantity = serializers.DecimalField(max_digits=14, decimal_places=3)
    allocated_quantity = serializers.DecimalField(max_digits=14, decimal_places=3)
    outstanding_quantity = serializers.SerializerMethodField()
    variant_image = serializers.SerializerMethodField()

    def get_agent(self, obj):
        return obj.order.agent.user.username if obj.order.agent_id else None

    def get_outstanding_quantity(self, obj):
        return str(obj.outstanding_quantity)

    def get_variant_image(self, obj):
        request = self.context.get("request")
        image = obj.variant_image
        if not image and obj.variant and obj.variant.image:
            image = obj.variant.image.url
        if image and request and not image.startswith("http"):
            image = request.build_absolute_uri(image)
        return image
