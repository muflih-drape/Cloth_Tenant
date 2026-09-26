from django.db import models

from apps.agents.models import Agent
from transports.models import Transport


class Customer(models.Model):
    """A buyer of cloth.

    ``priority_override`` lets an admin force a customer's position in the
    packing queue. ``None`` means "rank by lifetime metres sold" (see
    :func:`apps.orders.allocation.customer_priority`); a lower number wins.
    """

    name = models.CharField(max_length=100, unique=True)
    address = models.TextField(blank=True)
    contact = models.CharField(max_length=20)
    gst = models.CharField(max_length=20, blank=True, default="")
    agent = models.ForeignKey(
        Agent, on_delete=models.PROTECT, related_name="customers", null=True
    )
    preferred_transport = models.ForeignKey(
        Transport,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customers",
    )
    priority_override = models.IntegerField(
        null=True,
        blank=True,
        help_text="Lower wins when ranking packing priority. Blank = rank by sales.",
    )
    is_active = models.BooleanField(default=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.name
