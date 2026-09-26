from django.db import models

from apps.agents.models import Agent
from transports.models import Transport


class Customer(models.Model):
    name = models.CharField(max_length=100, unique=True)
    address = models.TextField(blank=True)
    contact = models.CharField(max_length=20)
    gst = models.CharField(max_length=20, blank=True, default="")
    agent = models.ForeignKey(Agent, on_delete=models.PROTECT, related_name="customers", null=True)
    preferred_transport = models.ForeignKey(Transport, on_delete=models.SET_NULL, null=True, blank=True, related_name="customers")
    is_active = models.BooleanField(default=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.name
