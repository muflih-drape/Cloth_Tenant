from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import AbstractUser
from django.db import models

# Create your models here.


class User(AbstractUser):
    ROLE_CHOICES = (("ADMIN", "Admin"), ("AGENT", "Agent"))
    BUSINESS_CHOICES = (
        ("gents", "Gents"),
        ("kids", "Kids"),
    )

    email = models.EmailField(unique=True)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, blank=True)
    business = models.CharField(max_length=10, choices=BUSINESS_CHOICES, blank=True)
    brand = models.ForeignKey(
        "business.Brand",
        related_name="users",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    display_name = models.CharField(max_length=255, blank=True, default="")
    pin = models.CharField(max_length=128, blank=True, default="")

    def set_pin(self, raw_pin):
        self.pin = make_password(str(raw_pin))

    def check_pin(self, raw_pin):
        return check_password(str(raw_pin), self.pin)

    def save(self, *args, **kwargs):
        if self.is_superuser:
            self.role = "ADMIN"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.username} ({self.role})"


class PasswordResetToken(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="custom_password_reset_tokens",
    )
    token = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"PasswordResetToken({self.user.email}, used={self.used})"
