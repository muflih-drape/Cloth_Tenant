from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import models

from apps.agents.models import Agent
from apps.customers.models import Customer
from apps.items.models import Fabric, FabricRoll, FabricVariant
from transports.models import Transport

User = get_user_model()


class Order(models.Model):
    """A cloth order placed by an agent (or an admin) for a customer.

    Money is tracked in two fields on purpose:

    * ``computed_total`` is always derived from the lines
      (``SUM(ordered_quantity * rate_per_meter)``) and is never edited.
    * ``final_total`` is what the customer is actually invoiced. It mirrors
      ``computed_total`` until somebody overrides it, after which the override
      plus its reason is preserved on the order and in the audit log.
    """

    STATUS_CHOICES = (
        ("DRAFT", "Draft"),
        ("PENDING", "Pending"),
        ("EDITING", "Editing"),
        ("PACKED", "Packed"),
        ("PARTIALLY_DISPATCHED", "Partially Dispatched"),
        ("DISPATCHED", "Dispatched"),
    )

    customer = models.ForeignKey(Customer, on_delete=models.PROTECT)
    agent = models.ForeignKey(Agent, on_delete=models.PROTECT, null=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_orders",
    )

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")

    computed_total = models.DecimalField(
        max_digits=14, decimal_places=2, default=0
    )
    final_total = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    price_override_reason = models.CharField(max_length=200, blank=True, default="")
    price_overridden_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="priced_orders",
    )
    price_overridden_at = models.DateTimeField(null=True, blank=True)

    expected_delivery_date = models.DateField(null=True, blank=True)
    preferred_transport = models.ForeignKey(
        Transport,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="orders",
    )
    transport_company = models.ForeignKey(
        Transport,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dispatched_orders",
    )
    lr_number = models.CharField(max_length=50, blank=True, default="")

    # Set when an order ships short: a line could not be fully allocated and the
    # shortfall was accepted deliberately rather than refunded.
    shortfall_reason = models.CharField(max_length=200, blank=True, default="")

    #: Line-by-line copy taken when an agent starts editing, so an abandoned edit
    #: can be rolled back exactly.
    edit_snapshot = models.JSONField(default=list, blank=True)
    editing_started_at = models.DateTimeField(null=True, blank=True)
    notes = models.CharField(max_length=200, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    dispatched_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def is_price_overridden(self):
        return (
            self.final_total is not None
            and self.final_total != self.computed_total
        )

    @property
    def effective_total(self):
        """The number that is actually billed and reported everywhere."""
        if self.final_total is not None:
            return self.final_total
        return self.computed_total

    def __str__(self):
        return f"Order #{self.id}"


class OrderLog(models.Model):
    """Audit trail for an order.

    ``order`` is nullable and ``SET_NULL`` so that deleting an order does not erase
    the record of what happened to it -- which matters most for a deletion, since
    that is exactly the entry you need afterwards. ``order_ref`` keeps the original
    id so log entries stay traceable to a row that no longer exists.
    """

    ACTION_CHOICES = (
        ("ITEM_DELETED", "Item Deleted"),
        ("ORDER_DELETED", "Order Deleted"),
        ("ORDER_EDITED", "Order Edited"),
        ("DISPATCHED", "Dispatched"),
        ("EDIT_STARTED", "Edit Started"),
        ("EDIT_SAVED", "Edit Saved"),
        ("EDIT_CANCELLED", "Edit Cancelled"),
        ("PRICE_OVERRIDE", "Price Overridden"),
        ("PRICE_OVERRIDE_CLEARED", "Price Override Cleared"),
        ("ITEM_RATE_OVERRIDE", "Item Rate Overridden"),
        ("ITEM_RATE_OVERRIDE_CLEARED", "Item Rate Override Cleared"),
        ("ALLOCATION_MADE", "Stock Allocated"),
        ("ALLOCATION_REVERSED", "Allocation Reversed"),
        ("ROUND_CANCELLED", "Packing Round Cancelled"),
    )

    order = models.ForeignKey(
        Order, on_delete=models.SET_NULL, null=True, related_name="logs"
    )
    #: The order's id at the time the entry was written.
    order_ref = models.PositiveIntegerField(db_index=True)
    action = models.CharField(max_length=30, choices=ACTION_CHOICES)
    details = models.JSONField(default=dict, blank=True)
    performed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["order_ref", "-created_at"])]

    @classmethod
    def record(cls, order, action, details=None, performed_by=None):
        """Append an audit entry for ``order``.

        ``order_ref`` is filled in here so no call site can forget it.
        """
        return cls.objects.create(
            order=order,
            order_ref=order.pk,
            action=action,
            details=details or {},
            performed_by=performed_by,
        )

    def __str__(self):
        return f"Order #{self.order_ref} - {self.action}"


class OrderItem(models.Model):
    """One fabric line on an order.

    Quantities are metres. ``ordered_quantity`` is what the customer asked for;
    ``allocated_quantity`` is how much of it packing has actually handed over.
    The gap between the two is the outstanding demand that the packing queue
    works through. Packing may overshoot ``ordered_quantity`` -- a roll is cut
    whole -- so the gap is clamped at zero rather than allowed to go negative.

    Money is snapshotted onto the line too, so an order keeps billing the rate
    that was agreed even after the catalogue changes. ``rate_per_meter`` may be
    set to a rate negotiated for one customer; the fabric's own
    ``price_per_meter`` is never written, so that rate stays on this order and
    this order alone.
    """

    order = models.ForeignKey(Order, related_name="items", on_delete=models.CASCADE)

    fabric = models.ForeignKey(
        Fabric, on_delete=models.SET_NULL, null=True, blank=True
    )

    variant = models.ForeignKey(
        FabricVariant, on_delete=models.SET_NULL, null=True, blank=True
    )

    fabric_name = models.CharField(max_length=100, default="Unknown Fabric")
    rate_per_meter = models.DecimalField(
        max_digits=10, decimal_places=2, default=0
    )
    #: The catalogue rate this line was added at. Kept beside the billed rate so
    #: an agreed price stays auditable: the fabric's own ``price_per_meter`` may
    #: move afterwards, and a line created before that must still show what it
    #: would have cost. Equal to ``rate_per_meter`` unless the line was repriced.
    original_rate_per_meter = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    #: Who agreed the per-customer rate, and when. Null while the line is billed
    #: at the catalogue rate.
    rate_overridden_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="repriced_order_items",
    )
    rate_overridden_at = models.DateTimeField(null=True, blank=True)
    variant_image = models.URLField(null=True, blank=True)
    variant_display_order = models.CharField(max_length=100, blank=True, default="")

    ordered_quantity = models.DecimalField(max_digits=14, decimal_places=3)
    allocated_quantity = models.DecimalField(
        max_digits=14, decimal_places=3, default=0
    )

    @property
    def is_rate_overridden(self):
        """Whether this line is billed at something other than the catalogue."""
        return (
            self.original_rate_per_meter is not None
            and self.rate_per_meter != self.original_rate_per_meter
        )

    @property
    def outstanding_quantity(self):
        """Metres of this line packing has not yet handed over.

        Floored at zero: packing is allowed to overshoot what was ordered, since
        a roll is cut whole and rounding it up is a deliberate choice. Once
        ``allocated_quantity`` passes ``ordered_quantity`` the line is satisfied
        and the negative remainder is meaningless -- nobody owes cloth back.
        """
        gap = self.ordered_quantity - self.allocated_quantity
        return gap if gap > 0 else Decimal("0")

    def __str__(self):
        return f"{self.fabric_name} x {self.ordered_quantity}m"


class PackingRound(models.Model):
    """One admin-initiated allocation of warehouse stock to pending demand.

    A round is planned against a single :class:`FabricVariant` because the
    warehouse holds one colour at a time. ``round_size`` is the per-line grant
    the admin types in (metres each participating line receives before any
    leftover is handed to the highest-priority customer). A round is created in
    ``DRAFT`` so the plan can be reviewed and hand-adjusted before any stock
    moves.
    """

    STATUS_CHOICES = (
        ("DRAFT", "Draft"),
        ("CONFIRMED", "Confirmed"),
        ("CANCELLED", "Cancelled"),
    )

    variant = models.ForeignKey(
        FabricVariant, related_name="packing_rounds", on_delete=models.PROTECT
    )
    round_size = models.DecimalField(max_digits=14, decimal_places=3)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="DRAFT")
    note = models.CharField(max_length=200, blank=True, default="")

    #: When the admin hand-adjusts the plan, the metres per ``order_item`` are
    #: stored here as ``[{"order_item": <pk>, "metres": "<decimal>"}]`` and
    #: applied verbatim on confirm. Empty means "re-plan from live stock".
    plan_override = models.JSONField(default=list, blank=True)

    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Round #{self.id} - {self.variant} ({self.status})"


class Allocation(models.Model):
    """Metres handed to one order line by one packing round.

    ``sequence`` records which pass of the engine awarded the metres: ``1`` is
    the equal fill every participant receives, ``2`` is a priority top-up given
    to a top-ranked customer when stock ran past the round size. The link to the
    round is ``SET_NULL`` so that cancelling a round never erases the record of
    cloth that physically changed hands.
    """

    round = models.ForeignKey(
        PackingRound,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="allocations",
    )
    order_item = models.ForeignKey(
        OrderItem, on_delete=models.CASCADE, related_name="allocations"
    )

    metres = models.DecimalField(max_digits=14, decimal_places=3)
    sequence = models.PositiveSmallIntegerField(default=1)
    is_priority_award = models.BooleanField(default=False)
    #: The bundle these metres were handed over in.
    #:
    #: A scanned roll carries its own bundle link (see :class:`RollAllocation`), so
    #: this is only populated for a roll-less colour packed by hand -- there is no
    #: roll to hang the link on, but the metres still leave the warehouse in a box,
    #: so they still need to belong to one. That is what lets dispatch treat every
    #: handover the same way regardless of how it was packed.
    #:
    #: SET_NULL, matching ``RollAllocation.bundle``, so a bundle that is deleted as
    #: bookkeeping never takes the record of cloth that moved with it.
    bundle = models.ForeignKey(
        "PackingBundle",
        related_name="allocations",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sequence", "id"]

    def __str__(self):
        return f"{self.metres}m -> {self.order_item_id}"


class PackingBundle(models.Model):
    """A named, reversible group of rolls packed for one order.

    A round moves stock to a single line of a single colour; a *bundle* is the
    unit a warehouse worker actually hands over -- a box that leaves with rolls of
    possibly different colours, tied to one customer and one order. Rolls are
    added by scanning their labels, and until the bundle is sealed any one of them
    can be taken back out, which is why the link to :class:`RollAllocation` lives
    on the roll allocation rather than being baked into the round.

    ``number`` counts from 1 within the order, so an order shows "Bundle 1",
    "Bundle 2" and so on and the human-readable code on the packing slip is
    ``Order #<id> -- Bundle <number>``.

    Sealing is what makes a bundle final. An ``OPEN`` bundle is still being worked
    on and can be scanned into or removed from; ``SEALED`` is immutable, so the
    packing slip printed for it stays true for as long as the record exists.
    ``CANCELLED`` is a bundle whose rolls were all given back.

    Dispatch is tracked as its own fact rather than a fourth status. A dispatched
    bundle is still the sealed bundle whose slip was printed -- flipping its status
    would quietly drop it out of the sealed list and out of the slip reprint, which
    is exactly the record you most want to keep once the truck has left. So
    ``SEALED`` stays ``SEALED`` and ``dispatched_at`` carries the fact that it also
    went out.
    """

    STATUS_CHOICES = (
        ("OPEN", "Open"),
        ("SEALED", "Sealed"),
        ("CANCELLED", "Cancelled"),
    )

    order = models.ForeignKey(
        Order, related_name="packing_bundles", on_delete=models.CASCADE
    )
    #: 1-based sequence within the order. Assigned under a lock on the order so
    #: two bundles started at once cannot claim the same number.
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="OPEN")
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)
    sealed_at = models.DateTimeField(null=True, blank=True)
    #: When this sealed bundle went out on a truck, or null while it is still here.
    #: The transport is not repeated per bundle: it is chosen once on the order
    #: (:attr:`Order.transport_company`) and reused for every bundle it covers.
    dispatched_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["number"]
        constraints = [
            models.UniqueConstraint(
                fields=["order", "number"], name="packingbundle_unique_number_per_order"
            )
        ]

    def __str__(self):
        return f"Order #{self.order_id} - Bundle {self.number} ({self.status})"

    @property
    def code(self):
        """The label a human reads out loud and reads on the slip."""
        return f"Order #{self.order_id} -- Bundle {self.number}"

    @property
    def is_open(self):
        return self.status == "OPEN"

    @property
    def is_dispatched(self):
        return self.dispatched_at is not None


class RollAllocation(models.Model):
    """Which physical roll a packing allocation's metres were cut from.

    :class:`Allocation` records *that* cloth moved; this records *which roll* it
    came off, one row per roll the metres spanned. Without it, cancelling a round
    could only give the metres back as a total, and putting them on an arbitrary
    roll would falsify the warehouse's book-keeping -- the roll the cloth left
    would stay short forever while a roll nobody touched grew.

    Rows are kept after a round is cancelled and marked ``is_reversed``, so the
    history of what was cut and given back survives while the metres cannot be
    returned twice.
    """

    allocation = models.ForeignKey(
        Allocation, related_name="roll_allocations", on_delete=models.CASCADE
    )
    #: PROTECT: a roll that has been cut from is part of the warehouse's record
    #: and cannot be deleted out from under that record.
    roll = models.ForeignKey(
        FabricRoll, related_name="roll_allocations", on_delete=models.PROTECT
    )
    metres = models.DecimalField(max_digits=14, decimal_places=3)
    #: Which roll of the allocation this was, i.e. the order they were cut.
    sequence = models.PositiveSmallIntegerField(default=1)
    #: The bundle this roll was scanned into, if it was scanned rather than packed
    #: by hand. Null on every row written before bundles existed, and on roll-less
    #: packing, which has no roll to bundle in the first place.
    bundle = models.ForeignKey(
        PackingBundle,
        related_name="roll_allocations",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    is_reversed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["allocation_id", "sequence", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(metres__gt=Decimal("0")),
                name="rollallocation_metres_positive",
            )
        ]

    def __str__(self):
        return f"{self.metres}m off {self.roll_id} (allocation {self.allocation_id})"


class UserViewedOrder(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    order = models.ForeignKey(Order, on_delete=models.CASCADE)
    viewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = (("user", "order"),)
        ordering = ["-viewed_at"]

    def __str__(self):
        return f"User {self.user_id} viewed Order #{self.order_id}"
