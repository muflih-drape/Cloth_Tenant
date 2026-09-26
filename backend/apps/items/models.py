import uuid

from django.db import models
from django.utils import timezone


class Item(models.Model):
    TYPE_CHOICES = [("kids", "Kids"), ("gents", "Gents")]

    name = models.CharField(max_length=100)

    description = models.TextField(blank=True)

    price = models.DecimalField(max_digits=10, decimal_places=2)

    type = models.CharField(max_length=10, choices=TYPE_CHOICES, default="NONE")

    brand = models.ForeignKey(
        "business.Brand",
        related_name="items",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
    )

    is_deleted = models.BooleanField(default=False)
    out_of_stock_since = models.DateTimeField(null=True, blank=True)
    catalog_updated_at = models.DateTimeField(
        default=timezone.now, db_index=True
    )

    def __str__(self):
        return self.name


def item_variant_image_path(instance, filename):
    return f"items/{instance.item.id}/{filename}"


class ItemVariant(models.Model):
    item = models.ForeignKey(Item, related_name="variants", on_delete=models.CASCADE)
    display_order = models.CharField(max_length=100, blank=True, null=True)

    qr_code = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)

    image = models.ImageField(upload_to=item_variant_image_path, null=True, blank=True)

    def __str__(self):
        img_name = self.image.name.split("/")[-1] if self.image else "no image"
        return f"{self.item.name} - {img_name}"


class ItemVariantSize(models.Model):
    SIZE_CHOICES = [
        ("20-24", "20-24"),
        ("26-30", "26-30"),
        ("32-36", "32-36"),
        ("38", "38"),
        ("S", "S"),
        ("M,L,XL", "M,L,XL"),
        ("XXL", "XXL"),
    ]

    item_variant = models.ForeignKey(
        ItemVariant, related_name="sizes", on_delete=models.CASCADE
    )

    size = models.CharField(max_length=10, choices=SIZE_CHOICES)

    stock = models.PositiveIntegerField(default=0)

    stock_updated_at = models.DateTimeField(
        default=timezone.now, db_index=True
    )

    class Meta:
        unique_together = ["item_variant", "size"]

    def __str__(self):
        return f"{self.item_variant} - {self.size}"
