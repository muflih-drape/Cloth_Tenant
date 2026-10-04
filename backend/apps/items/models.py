import uuid
from decimal import Decimal

from django.conf import settings
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

    @property
    def available_to_order(self):
        """Metres of this colour that are not already promised to an order.

        ``stock_meters`` minus what live orders have asked for and not yet had.
        This is the figure that moves when an order is placed and is meant to be
        shown instead of the raw total, because an admin deciding whether to take
        an order cares what is still free, not what is on the shelf.

        It is derived on every read rather than stored, so it cannot drift from
        the orders behind it: placing, editing, withdrawing or packing an order
        all show up here without anything keeping a counter in step.

        Packing leaves it alone on purpose. Packing X metres takes X off
        ``stock_meters`` *and* closes X of the promised gap, so the two cancel and
        availability is unchanged by the act of packing itself. It moves when an
        order is written, or when cloth is received or adjusted.

        Goes negative when orders between them promise more than exists, which is
        a real and allowed state here -- the shortage is arbitrated at packing,
        not by refusing orders.
        """
        promised = getattr(self, "_committed_demand", None)
        if promised is None:
            from apps.orders.stock import committed_demand_for_variant

            promised = committed_demand_for_variant(self)
        return (self.stock_meters or Decimal("0")) - Decimal(str(promised or 0))


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


class StockMovement(models.Model):
    """A recorded change to a colour's warehouse total that is otherwise silent.

    Most stock movement is reconstructable: a roll that was cut from says so, and
    a roll that was received is still on the shelf. One transition is not. A colour
    created with a plain opening metre figure has stock that belongs to no roll,
    and the first roll received on it replaces that figure instead of adding to
    it -- otherwise the warehouse would count the same cloth twice. Without a
    record, the total dropping from the opening figure to the roll total looks
    like cloth going missing, so the discard is written down here.

    This is a log of notable transitions, not a complete double-entry ledger: it
    records what would otherwise leave no trace, and nothing else.
    """

    #: A colour's metres were replaced by its first physical rolls.
    OPENING_FIGURE_DISCARDED = "opening_figure_discarded"
    REASON_CHOICES = [
        (OPENING_FIGURE_DISCARDED, "Opening figure replaced by first roll"),
    ]

    variant = models.ForeignKey(
        FabricVariant, related_name="stock_movements", on_delete=models.CASCADE
    )

    #: Signed: negative when the total went down. The figure the admin needs to
    #: explain the change, kept alongside it.
    metres = models.DecimalField(max_digits=14, decimal_places=3)

    #: Both ends of the change, so one row is enough to explain it without
    #: having to reconstruct the surrounding history.
    stock_before = models.DecimalField(max_digits=14, decimal_places=3)
    stock_after = models.DecimalField(max_digits=14, decimal_places=3)

    reason = models.CharField(max_length=40, choices=REASON_CHOICES)

    #: The warehouse label of the roll that triggered it, snapshotted so the
    #: record still reads properly if that roll is later deleted.
    roll_number = models.CharField(max_length=32, blank=True, default="")

    #: Who did it, where known. Receiving can also come from a service call.
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-id"]

    def __str__(self):
        return (
            f"{self.variant_id}: {self.metres} m "
            f"({self.stock_before} -> {self.stock_after}) {self.reason}"
        )
