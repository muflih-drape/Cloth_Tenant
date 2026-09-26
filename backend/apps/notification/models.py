from django.db import models

from apps.accounts.models import User


class PushSubscription(models.Model):
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="push_subscriptions",
    )
    endpoint = models.TextField(unique=True)
    p256dh = models.TextField()
    auth = models.TextField()

    user_agent = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"PushSubscription(user={self.user_id})"


class DeviceToken(models.Model):
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="device_tokens",
    )
    token = models.CharField(max_length=4096, unique=True)
    PLATFORM_CHOICES = (
        ("android", "Android"),
        ("ios", "iOS"),
    )
    platform = models.CharField(
        max_length=16, choices=PLATFORM_CHOICES, default="android"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"DeviceToken(user={self.user_id}, platform={self.platform})"
