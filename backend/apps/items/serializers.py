import uuid
from datetime import timedelta
from decimal import Decimal
from io import BytesIO

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from PIL import Image
from rest_framework import serializers

from .models import Fabric, FabricRoll, FabricVariant
from .rolls import (
    MAX_METERS,
    MIN_ROLL_METERS,
    RollError,
    clean_meters,
    is_roll_tracked,
    receive_rolls,
    variant_roll_info,
)
from .services import sync_out_of_stock, touch_catalog

ZERO = Decimal("0")

#: Said wherever a colour's metres are owned by its rolls, so the admin is sent
#: to the rolls screen instead of guessing why the field will not save.
ROLL_TRACKED_MESSAGE = (
    "This colour's stock is tracked as physical rolls. Add or adjust rolls "
    "instead of setting the metre total directly."
)


class FabricVariantSerializer(serializers.ModelSerializer):
    """One colour/finish of a fabric: its own QR label, image and metre stock."""

    #: True once the colour has rolls, so clients know the metre total is their
    #: sum rather than a figure somebody typed.
    is_roll_tracked = serializers.SerializerMethodField()
    roll_count = serializers.SerializerMethodField()
    roll_stock_meters = serializers.SerializerMethodField()
    #: What is genuinely still orderable: the warehouse total less what live
    #: orders have already claimed. Derived per read, never stored, so it cannot
    #: drift from the orders behind it. May be negative.
    available_meters = serializers.SerializerMethodField()

    class Meta:
        model = FabricVariant
        fields = [
            "id",
            "qr_code",
            "image",
            "display_order",
            "stock_meters",
            "available_meters",
            "stock_updated_at",
            "is_roll_tracked",
            "roll_count",
            "roll_stock_meters",
        ]
        read_only_fields = ["qr_code", "stock_updated_at", "available_meters"]

    def get_available_meters(self, obj):
        return str(obj.available_to_order)

    def get_is_roll_tracked(self, obj):
        return variant_roll_info(obj)[0]

    def get_roll_count(self, obj):
        return variant_roll_info(obj)[1]

    def get_roll_stock_meters(self, obj):
        return str(variant_roll_info(obj)[2])

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if data.get("image") and request:
            data["image"] = request.build_absolute_uri(data["image"])
        return data

    def validate_stock_meters(self, value):
        # The one figure that must never be written directly: on a roll-tracked
        # colour it *is* the sum of the rolls, so editing it here would leave the
        # two disagreeing with nothing to say which is right.
        if self.instance is not None and is_roll_tracked(self.instance):
            raise serializers.ValidationError(ROLL_TRACKED_MESSAGE)
        return value

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
        total = getattr(obj, "_total_stock", None)
        if total is not None:
            return str(total or 0)
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


def _roll_lengths(roll_drafts):
    """Normalise submitted roll entries into ``receive_rolls``'s own shape.

    The form sends ``{"meters": "500", "note": "..."}`` per roll, but a bare
    number is accepted too. Anything else is passed through untouched so the
    service produces the one message the admin sees.
    """
    lengths = []
    for draft in roll_drafts or []:
        if not isinstance(draft, dict):
            lengths.append(draft)
            continue
        lengths.append(
            {
                "meters": draft.get("meters"),
                "note": (draft.get("note") or "").strip()[:100],
            }
        )
    return lengths


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
        help_text="Stock in metres; applied on create and on edit.",
    )
    rolls = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        allow_empty=True,
        # Only ever an input: what a roll-tracked colour reports back comes from
        # `FabricVariantSerializer`, which reads the rolls themselves.
        write_only=True,
        help_text=(
            "Physical rolls this colour arrives on, one entry per roll with a "
            "'meters' figure and an optional 'note'. When any roll is given, the "
            "rolls are the colour's stock and 'stock_meters' is not applied on "
            "top of them."
        ),
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
        # A roll figure is validated while the rows are being written, so the whole
        # fabric goes in together: a bad length on colour three must not leave the
        # first two colours behind.
        with transaction.atomic():
            fabric = Fabric.objects.create(**validated_data)
            for variant_data in variants_data:
                self._create_variant(fabric, variant_data)
        return fabric

    def _create_variant(self, fabric, variant_data):
        image_file = variant_data.pop("image", None)
        variant_data.pop("remove_image", None)  # nothing to remove on create
        roll_drafts = variant_data.pop("rolls", None)
        stock = variant_data.pop("stock_meters", None) or 0
        display_order = variant_data.pop("display_order", None) or None

        # Rolls are the opening stock whenever any are given: the colour starts at
        # zero and ``receive_rolls`` builds the total from the rolls, so the typed
        # opening figure is never added on top of them. The two are deliberately
        # not required to agree -- if they differ, the rolls are what is on hand.
        initial_stock = ZERO if roll_drafts else stock

        variant = FabricVariant.objects.create(
            fabric=fabric,
            qr_code=uuid.uuid4(),
            display_order=display_order,
            stock_meters=initial_stock,
        )
        if roll_drafts:
            try:
                receive_rolls(variant, _roll_lengths(roll_drafts))
            except RollError as exc:
                raise serializers.ValidationError({"rolls": [str(exc)]})
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

                if "stock_meters" in variant_data:
                    new_stock = variant_data["stock_meters"] or 0
                    if is_roll_tracked(variant):
                        # The metre total is the sum of this colour's rolls now,
                        # so the catalogue form must not overwrite it. The row
                        # is saved unchanged instead of failing the whole save.
                        pass
                    elif variant.stock_meters != new_stock:
                        variant.stock_meters = new_stock
                        variant.stock_updated_at = timezone.now()

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


# --------------------------------------------------------------------------- #
# Physical rolls
# --------------------------------------------------------------------------- #


class FabricRollSerializer(serializers.ModelSerializer):
    """One physical roll, as the warehouse sees it."""

    consumed_meters = serializers.SerializerMethodField()
    is_exhausted = serializers.BooleanField(read_only=True)
    fabric_name = serializers.CharField(source="variant.fabric.name", read_only=True)
    display_order = serializers.CharField(
        source="variant.display_order", read_only=True
    )

    class Meta:
        model = FabricRoll
        fields = [
            "id",
            "variant",
            "roll_number",
            "note",
            "original_meters",
            "remaining_meters",
            "consumed_meters",
            "is_active",
            "is_exhausted",
            "fabric_name",
            "display_order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "variant",
            "original_meters",
            "remaining_meters",
            "consumed_meters",
            "is_active",
            "is_exhausted",
            "created_at",
            "updated_at",
        ]

    def get_consumed_meters(self, obj):
        return str(obj.consumed_meters)


class FabricRollCreateSerializer(serializers.Serializer):
    """Receive one roll onto a colour, adding its metres to the warehouse."""

    meters = serializers.DecimalField(
        max_digits=14,
        decimal_places=3,
        help_text="Roll length in metres, e.g. 250.000",
    )
    roll_number = serializers.CharField(
        max_length=32,
        required=False,
        allow_blank=True,
        help_text="Optional label. Generated as R-000001 when left blank.",
    )
    note = serializers.CharField(max_length=100, required=False, allow_blank=True)

    def validate_meters(self, value):
        if value < MIN_ROLL_METERS:
            raise serializers.ValidationError(
                f"A roll must hold at least {MIN_ROLL_METERS.normalize()} m."
            )
        if value > MAX_METERS:
            raise serializers.ValidationError(
                f"A roll cannot hold more than {MAX_METERS:,} m."
            )
        return value


class BulkRollCreateSerializer(serializers.Serializer):
    """Receive a factory delivery as several rolls in one go."""

    rolls = serializers.ListField(
        child=serializers.DictField(), allow_empty=False, min_length=1
    )

    def validate_rolls(self, rolls):
        cleaned = []
        for index, entry in enumerate(rolls, start=1):
            raw = entry.get("meters", entry.get("original_meters"))
            try:
                metres = clean_meters(raw, field=f"rolls[{index - 1}].meters")
            except RollError as exc:
                raise serializers.ValidationError({"rolls": f"Roll {index}: {exc}"})
            note = str(entry.get("note") or "").strip()[:100]
            cleaned.append({"meters": metres, "note": note})
        return cleaned


class RollAdjustSerializer(serializers.Serializer):
    """Correct a roll's metres after the fact, in either direction."""

    meters = serializers.DecimalField(
        max_digits=14,
        decimal_places=3,
        help_text="Metres to add (positive) or remove (negative).",
    )
    reason = serializers.CharField(required=False, allow_blank=True, max_length=200)

    def validate_meters(self, value):
        if value == ZERO:
            raise serializers.ValidationError("Enter a non-zero figure to adjust by.")
        if abs(value) > MAX_METERS:
            raise serializers.ValidationError(
                f"A roll cannot hold more than {MAX_METERS:,} m."
            )
        return value


class RollHistoryEntrySerializer(serializers.Serializer):
    """One line of a roll's consumption history, for the warehouse."""

    id = serializers.IntegerField()
    roll_number = serializers.CharField(source="roll.roll_number", read_only=True)
    metres = serializers.DecimalField(max_digits=14, decimal_places=3)
    is_reversed = serializers.BooleanField()
    created_at = serializers.DateTimeField()
    round = serializers.IntegerField(source="allocation.round_id", allow_null=True)
    round_status = serializers.CharField(
        source="allocation.round.status", allow_null=True
    )
    order = serializers.IntegerField(
        source="allocation.order_item.order_id", allow_null=True
    )
    order_status = serializers.CharField(
        source="allocation.order_item.order.status", allow_null=True
    )
    customer = serializers.CharField(
        source="allocation.order_item.order.customer.name", allow_null=True
    )
    order_item = serializers.IntegerField(source="allocation.order_item_id")


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
