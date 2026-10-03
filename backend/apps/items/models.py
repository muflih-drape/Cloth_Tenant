import uuid
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone


class Fabric(models.Model):
    """A cloth quality the mill sells, priced per metre.

    A fabric is the parent of one or more :class:`FabricVariant` rows (colours /
    finishes). Stock lives on the variant, not the fabric, because the warehouse
    physically holds one colour at a time and each variant carries its own QR
    label that agents scan.
    """

    name = models.CharField(max_length=100)

    description = models.TextField(blank=True)

    price_per_meter = models.DecimalField(max_digits=10, decimal_places=2)

    is_deleted = models.BooleanField(default=False)
    out_of_stock_since = models.DateTimeField(null=True, blank=True)
    catalog_updated_at = models.DateTimeField(
        default=timezone.now, db_index=True
    )

    class Meta:
        ordering = ["-id"]

    def __str__(self):
        return self.name


def fabric_variant_image_path(instance, filename):
    return f"fabrics/{instance.fabric.id}/{filename}"


class FabricVariant(models.Model):
    """A colour/finish of a fabric: own QR label, own image, own stock."""

    fabric = models.ForeignKey(
        Fabric, related_name="variants", on_delete=models.CASCADE
    )
    display_order = models.CharField(max_length=100, blank=True, null=True)

    qr_code = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)

    image = models.ImageField(
        upload_to=fabric_variant_image_path, null=True, blank=True
    )

    # Fractional metres: cloth is cut and sold to three decimal places.
    stock_meters = models.DecimalField(
        max_digits=14,
        decimal_places=3,
        default=0,
        validators=[MinValueValidator(Decimal("0"))],
    )
    stock_updated_at = models.DateTimeField(
        default=timezone.now, db_index=True
    )

    class Meta:
        ordering = ["-id"]

    def __str__(self):
        label = self.display_order or "no colour"
        return f"{self.fabric.name} - {label}"

    @property
    def is_roll_tracked(self):
        """Whether this colour's metres are broken down into physical rolls.

        A colour with no roll rows keeps the original single-figure stock model,
        so existing data and every existing packing path carry on working
        untouched. The moment the first roll is received the rolls become the
        breakdown of ``stock_meters`` and ``sum(roll.remaining_meters)`` must
        equal it.
        """
        return self.rolls.exists()


class FabricRoll(models.Model):
    """One physical roll of cloth in the warehouse, for one colour.

    ``FabricVariant.stock_meters`` stays the warehouse's total -- it is what
    packing, valuation and the allocation engine read. A roll is the *breakdown*
    of that total: every roll received adds its metres to the variant, and every
    metre packing cuts comes off a named roll, so a cancelling round can hand the
    cloth back to the roll it actually came off rather than to an arbitrary one.

    A roll is never deleted for being used up: ``remaining_meters`` reaches zero,
    ``is_active`` flips to false and the row stays as the warehouse's record of
    what was received and where it went. Rolls are metres at the same three
    decimals as everything else in this project, so no float ever touches cloth.
    """

    variant = models.ForeignKey(
        FabricVariant, related_name="rolls", on_delete=models.CASCADE
    )
    #: Warehouse label (``R-000001``). Unique across the catalogue: it is what an
    #: offcut gets tagged with, and it is generated when the admin does not type
    #: one themselves.
    roll_number = models.CharField(max_length=32, unique=True)
    note = models.CharField(max_length=100, blank=True, default="")

    original_meters = models.DecimalField(
        max_digits=14, decimal_places=3, validators=[MinValueValidator(Decimal("0.001"))]
    )
    remaining_meters = models.DecimalField(max_digits=14, decimal_places=3)

    #: A roll with cloth on it is active; one that has been cut to zero is kept
    #: for its history and marked inactive.
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["roll_number"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(original_meters__gt=Decimal("0")),
                name="fabricroll_original_meters_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(remaining_meters__gte=Decimal("0")),
                name="fabricroll_remaining_not_negative",
            ),
            models.CheckConstraint(
                condition=models.Q(remaining_meters__lte=models.F("original_meters")),
                name="fabricroll_remaining_within_original",
            ),
        ]

    def __str__(self):
        return self.roll_number

    @property
    def is_exhausted(self):
        """True once the roll has been cut down to its last millimetre."""
        return (self.remaining_meters or Decimal("0")) <= Decimal("0")

    @property
    def consumed_meters(self):
        """Metres cut off this roll so far."""
        return (self.original_meters or Decimal("0")) - (
            self.remaining_meters or Decimal("0")
        )
