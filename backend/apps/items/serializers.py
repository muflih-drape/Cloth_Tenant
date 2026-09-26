import uuid
from datetime import timedelta
from io import BytesIO

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils import timezone
from PIL import Image
from rest_framework import serializers

from apps.business.models import Brand
from apps.orders.utils import SIZE_MAPPING

from .models import Item, ItemVariant, ItemVariantSize
from .services import touch_catalog

KIDS_SIZES = set()
for sizes in SIZE_MAPPING.get("kids", {}).values():
    KIDS_SIZES.update(sizes)
KIDS_SIZES = list(KIDS_SIZES)

GENTS_SIZES = set()
for sizes in SIZE_MAPPING.get("gents", {}).values():
    GENTS_SIZES.update(sizes)
GENTS_SIZES = list(GENTS_SIZES)


class ItemVariantSizeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItemVariantSize
        fields = ["id", "size", "stock"]


class ItemVariantSerializer(serializers.ModelSerializer):
    sizes = ItemVariantSizeSerializer(many=True, read_only=True)

    class Meta:
        model = ItemVariant
        fields = ["id", "qr_code", "image", "sizes", "display_order"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if data.get("image") and request:
            data["image"] = request.build_absolute_uri(data["image"])
        return data

    def create(self, validated_data):
        sizes_data = validated_data.pop("sizes", [])
        variant = ItemVariant.objects.create(**validated_data)
        for size_data in sizes_data:
            ItemVariantSize.objects.create(item_variant=variant, **size_data)

        if variant.item_id:
            touch_catalog(variant.item)
        return variant

    def update(self, instance, validated_data):
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if instance.item_id:
            touch_catalog(instance.item)
        return instance


class ItemSerializer(serializers.ModelSerializer):
    variants = ItemVariantSerializer(many=True, read_only=True)
    brand_id = serializers.IntegerField(source="brand.id", read_only=True)
    brand_name = serializers.CharField(source="brand.name", read_only=True)
    purge_on = serializers.SerializerMethodField()
    days_until_purge = serializers.SerializerMethodField()

    class Meta:
        model = Item
        fields = [
            "id",
            "name",
            "type",
            "price",
            "description",
            "brand_id",
            "brand_name",
            "variants",
            "out_of_stock_since",
            "purge_on",
            "days_until_purge",
        ]

    def _purge_date(self, obj):
        if not obj.out_of_stock_since:
            return None
        total = settings.ARCHIVE_AFTER_DAYS + settings.ARCHIVED_ITEM_RETENTION_DAYS
        return timezone.localdate(obj.out_of_stock_since + timedelta(days=total))

    def get_purge_on(self, obj):
        purge = self._purge_date(obj)
        return purge.isoformat() if purge else None

    def get_days_until_purge(self, obj):
        purge = self._purge_date(obj)
        if purge is None:
            return None
        return max((purge - timezone.localdate()).days, 0)


class ItemVariantSizeRequestSerializer(serializers.Serializer):
    size = serializers.CharField()
    stock = serializers.IntegerField(required=False, default=0)


class ItemVariantRequestSerializer(serializers.Serializer):
    id = serializers.IntegerField(required=False)
    image = serializers.FileField(required=False)
    remove_image = serializers.BooleanField(required=False, default=False)  # ← new
    sizes = ItemVariantSizeRequestSerializer(many=True)
    display_order = serializers.CharField(
        max_length=100, required=False, allow_null=True, allow_blank=True
    )


class CreateItemSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    description = serializers.CharField(required=False, default="")
    price = serializers.DecimalField(max_digits=10, decimal_places=2)
    type = serializers.ChoiceField(choices=Item.TYPE_CHOICES)
    brand_id = serializers.IntegerField(required=False)
    variants = ItemVariantRequestSerializer(many=True)

    def validate_variants(self, variants):
        item_type = self.initial_data.get("type")

        for variant in variants:
            for size_data in variant.get("sizes", []):
                size = size_data.get("size")
                if not size:
                    raise serializers.ValidationError(
                        "Size is required for each variant size"
                    )

                if item_type == "kids" and size not in KIDS_SIZES:
                    raise serializers.ValidationError(
                        f"'{size}' is not a valid size for kids items"
                    )
                if item_type == "gents" and size not in GENTS_SIZES:
                    raise serializers.ValidationError(
                        f"'{size}' is not a valid size for gents items"
                    )

        return variants

    def create(self, validated_data):
        variants_data = validated_data.pop("variants", [])
        brand_id = validated_data.pop("brand_id", None)

        request_user = self.context["request"].user

        if request_user.is_superuser:
            if not brand_id:
                raise serializers.ValidationError("brand_id is required for superuser")

            try:
                brand = Brand.objects.get(id=brand_id)
            except Brand.DoesNotExist:
                raise serializers.ValidationError("Invalid brand_id")
        else:
            if not hasattr(request_user, "brand") or not request_user.brand:
                raise serializers.ValidationError(
                    "User has no brand assigned, please contact your superuser."
                )

            brand = request_user.brand

        item = Item.objects.create(
            name=validated_data["name"],
            description=validated_data.get("description", ""),
            price=validated_data["price"],
            type=validated_data["type"],
            brand=brand,
        )

        for variant_data in variants_data:
            self._create_variant(item, variant_data)

        return item

    def _create_variant(self, item, variant_data):
        image_file = variant_data.pop("image", None)
        variant_data.pop("remove_image", None)  # ← ignore on create
        display_order = variant_data.pop("display_order", None) or None
        variant = ItemVariant.objects.create(
            item=item, qr_code=uuid.uuid4(), display_order=display_order
        )

        if image_file:
            self._save_variant_image(variant, image_file)

        for size_data in variant_data.get("sizes", []):
            ItemVariantSize.objects.create(
                item_variant=variant,
                size=size_data["size"],
                stock=size_data.get("stock", 0),
            )

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
        request_user = self.context["request"].user
        brand_id = self.initial_data.get("brand_id")

        if request_user.is_superuser:
            if brand_id:
                from apps.business.models import (
                    Brand,  # ← fixed import (was apps.brands)
                )

                instance.brand = Brand.objects.get(id=brand_id)
        else:
            if hasattr(request_user, "brand") and request_user.brand:
                instance.brand = request_user.brand

        instance.name = validated_data.get("name", instance.name)
        instance.description = validated_data.get("description", instance.description)
        instance.price = validated_data.get("price", instance.price)
        instance.type = validated_data.get("type", instance.type)
        instance.save()

        existing_variants = {v.id: v for v in instance.variants.all()}

        for variant_data in variants_data:
            variant_id = variant_data.get("id")
            remove_image = variant_data.get("remove_image", False)

            if variant_id and variant_id in existing_variants:
                variant = existing_variants.pop(variant_id)  # ← pop so it's not deleted

                if "display_order" in variant_data:
                    variant.display_order = variant_data.get("display_order") or None

                # Handle image removal
                if remove_image and variant.image:
                    variant.image.delete(save=False)
                    variant.image = None
                    variant.save()

                # Handle new image upload
                image_file = variant_data.get("image")
                if image_file:
                    self._save_variant_image(variant, image_file)
                variant.save()
                self._update_sizes(variant, variant_data.get("sizes", []))

            else:
                # No id → brand new variant being added from the edit page
                self._create_variant(instance, dict(variant_data))

        # Delete variants that were removed on the frontend
        for variant in existing_variants.values():
            variant.delete()

        touch_catalog(instance)

        return instance

    def _update_sizes(self, variant, sizes_data):
        existing_sizes = {s.size: s for s in variant.sizes.all()}

        for size_data in sizes_data:
            size_name = size_data["size"]

            if size_name in existing_sizes:
                existing = existing_sizes[size_name]
                new_stock = size_data.get("stock", existing.stock)
                if existing.stock != new_stock:
                    existing.stock = new_stock
                    existing.stock_updated_at = timezone.now()
                    existing.save()
                del existing_sizes[size_name]
            else:
                ItemVariantSize.objects.create(
                    item_variant=variant,
                    size=size_name,
                    stock=size_data.get("stock", 0),
                    stock_updated_at=timezone.now(),
                )

        for size in existing_sizes.values():
            size.delete()


UpdateItemSerializer = CreateItemSerializer


class CustomerRequirementSerializer(serializers.Serializer):
    customer_name = serializers.CharField(source="order.customer.name")
    variant_display_order = serializers.CharField(
        source="variant.display_order", default=""
    )
    quantity = serializers.IntegerField()
    size_group = serializers.CharField()
    variant_image = serializers.SerializerMethodField()

    def get_variant_image(self, obj):
        request = self.context.get("request")
        image = obj.variant_image
        if not image and obj.variant and obj.variant.image:
            image = obj.variant.image.url
        if image and request and not image.startswith("http"):
            image = request.build_absolute_uri(image)
        return image
