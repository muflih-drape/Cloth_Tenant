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
