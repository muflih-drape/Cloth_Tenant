from django.db import models
from django.utils import timezone
from apps.accounts.models import User


class Agent(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    contact = models.CharField(max_length=20)
    is_active = models.BooleanField(default=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)

    def soft_delete(self):
        self.is_active = False
        self.deactivated_at = timezone.now()

        self.user.is_active = False

        self.user.save(update_fields=["is_active"])
        self.save(update_fields=["is_active", "deactivated_at"])

    def hard_delete(self, *args, **kwargs):
        user = self.user
        super().delete(*args, **kwargs)
        try:
            user.delete()
        except Exception:
            pass

    def __str__(self):
        return self.user.username


class AgentItem(models.Model):
    agent = models.ForeignKey(
        Agent,
        related_name="assigned_items",
        on_delete=models.CASCADE
    )
    variant = models.ForeignKey(
        "items.ItemVariant",
        related_name="assigned_agents",
        on_delete=models.CASCADE,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("agent", "variant")

    def __str__(self):
        return f"{self.agent.user.username} - {self.variant.item.name} ({self.variant.qr_code})"
