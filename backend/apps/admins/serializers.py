from django.contrib.auth.hashers import make_password
from rest_framework import serializers

from apps.accounts.models import User
from apps.business.models import Brand


class AdminSerializer(serializers.ModelSerializer):
    business = serializers.CharField(required=False, allow_blank=True)
    brand_id = serializers.IntegerField(required=False, allow_null=True)
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
            "business",
            "brand_id",
            "display_name",
            "pin",
        )
        extra_kwargs = {"password": {"write_only": True}}
        read_only_fields = ("id",)

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError(f'Username "{value}" is already taken.')
        return value

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        rep["brand_id"] = instance.brand_id if instance.brand else None
        if not self.context["request"].user.is_superuser:
            rep["business"] = instance.business
        return rep

    def validate(self, attrs):
        request_user = self.context["request"].user
        if request_user.is_superuser:
            brand_id = attrs.get("brand_id")
            if not brand_id:
                raise serializers.ValidationError(
                    {"brand_id": "A brand must be assigned to the new admin."}
                )
            if not Brand.objects.filter(id=brand_id).exists():
                raise serializers.ValidationError(
                    {"brand_id": f"Brand with ID {brand_id} does not exist."}
                )
        else:
            if not hasattr(request_user, "brand_id") or not request_user.brand_id:
                raise serializers.ValidationError(
                    {
                        "non_field_errors": [
                            "Your admin account does not have a brand assigned. "
                            "Please contact the superuser to assign a brand before creating other admins."
                        ]
                    }
                )
        username = attrs.get("username")
        if username and User.objects.filter(username=username).exists():
            raise serializers.ValidationError(
                {
                    "username": f'Username "{username}" is already taken. Please use a different display name.'
                }
            )
        return attrs

    def create(self, validated_data):
        validated_data["password"] = make_password(validated_data["password"])
        validated_data["role"] = "ADMIN"
        request_user = self.context["request"].user
        if request_user.is_superuser:
            validated_data["business"] = validated_data.get("business", "")
        elif request_user.business:
            validated_data["business"] = request_user.business
            validated_data["brand_id"] = request_user.brand_id
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
        request_user = self.context["request"].user
        raw_pin = validated_data.pop("pin", None)
        if request_user.is_superuser and "brand_id" in validated_data:
            brand_id = validated_data["brand_id"]
            if not brand_id:
                raise serializers.ValidationError(
                    {"brand_id": "A brand must be assigned to the admin."}
                )
            if not Brand.objects.filter(id=brand_id).exists():
                raise serializers.ValidationError(
                    {"brand_id": f"Brand with ID {brand_id} does not exist."}
                )
            instance.brand_id = validated_data.pop("brand_id")
        if "display_name" in validated_data:
            instance.display_name = validated_data.pop("display_name")

        instance = super().update(instance, validated_data)
        if raw_pin:
            instance.set_pin(raw_pin)
            instance.save()
        return instance
