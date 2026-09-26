from django.contrib.auth.hashers import make_password
from rest_framework import serializers

from apps.accounts.models import User


class AdminSerializer(serializers.ModelSerializer):
    """Create and edit admin accounts.

    There is no business or brand to pick any more -- the mill is single-tenant and
    the company profile is a singleton -- so an admin only has a name, contact and
    an optional PIN for destructive actions.
    """

    display_name = serializers.CharField(
        write_only=True, required=False, allow_blank=True
    )
    pin = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "password",
            "display_name",
            "pin",
        )
        extra_kwargs = {"password": {"write_only": True}}
        read_only_fields = ("id",)

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError(f'Username "{value}" is already taken.')
        return value

    def create(self, validated_data):
        validated_data["password"] = make_password(validated_data["password"])
        validated_data["role"] = "ADMIN"

        display_name = validated_data.pop("display_name", "")
        if display_name:
            validated_data["display_name"] = display_name
        raw_pin = validated_data.pop("pin", None)

        user = super().create(validated_data)
        if raw_pin:
            user.set_pin(raw_pin)
            user.save()
        return user

    def update(self, instance, validated_data):
        raw_pin = validated_data.pop("pin", None)
        if "display_name" in validated_data:
            instance.display_name = validated_data.pop("display_name")

        instance = super().update(instance, validated_data)
        if raw_pin:
            instance.set_pin(raw_pin)
            instance.save()
        return instance
