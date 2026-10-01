from collections import defaultdict

from django.contrib.auth.hashers import make_password
from rest_framework import serializers

from apps.accounts.models import User
from apps.items.models import FabricVariant

from .models import Agent, AgentItem


class VariantColorSerializer(serializers.Serializer):
    """A colour/finish an agent may sell, with the cloth on hand for it."""

    id = serializers.IntegerField()
    image = serializers.CharField(allow_null=True)
    qr_code = serializers.CharField(allow_null=True)
    created_at = serializers.CharField(allow_null=True)
    display_order = serializers.CharField(allow_null=True)
    stock_meters = serializers.DecimalField(max_digits=14, decimal_places=3)


class AgentFabricListSerializer(serializers.Serializer):
    """A fabric the agent is assigned, grouped with its assigned colours."""

    id = serializers.IntegerField()
    name = serializers.CharField()
    price_per_meter = serializers.DecimalField(max_digits=10, decimal_places=2)
    variants = VariantColorSerializer(many=True)

    @staticmethod
    def get_image_url(image_obj, request=None):
        if request and image_obj:
            return request.build_absolute_uri(image_obj.url)
        elif image_obj:
            return image_obj.url
        return None

    @classmethod
    def from_assigned_variants(cls, fabric, agent_items, request=None):
        variants_data = [
            {
                "id": ai.variant.id,
                "image": cls.get_image_url(ai.variant.image, request),
                "qr_code": str(ai.variant.qr_code),
                "created_at": ai.created_at.isoformat(),
                "display_order": ai.variant.display_order,
                "stock_meters": str(ai.variant.stock_meters),
            }
            for ai in agent_items
        ]

        return cls(
            {
                "id": fabric.id,
                "name": fabric.name,
                "price_per_meter": fabric.price_per_meter,
                "variants": variants_data,
            }
        ).data


#: Kept as an alias so existing import sites keep working.
AgentItemListSerializer = AgentFabricListSerializer


class AgentItemSerializer(serializers.ModelSerializer):
    variant = VariantColorSerializer(read_only=True)
    variant_id = serializers.PrimaryKeyRelatedField(
        queryset=FabricVariant.objects.all(),
        source="variant",
        write_only=True,
    )

    class Meta:
        model = AgentItem
        fields = ("id", "variant", "variant_id", "created_at")


class AgentUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "username", "email", "role", "display_name")


class AgentSerializer(serializers.ModelSerializer):
    user = AgentUserSerializer(read_only=True)
    username = serializers.CharField(write_only=True)
    password = serializers.CharField(write_only=True)
    email = serializers.EmailField(write_only=True)
    display_name = serializers.CharField(
        write_only=True, required=False, allow_blank=True
    )

    total_customers = serializers.SerializerMethodField()
    assigned_items = serializers.SerializerMethodField()

    class Meta:
        model = Agent
        fields = (
            "id",
            "username",
            "user",
            "email",
            "password",
            "contact",
            "total_customers",
            "assigned_items",
            "display_name",
        )

    def validate_username(self, value):
        instance = self.instance
        existing = User.objects.filter(username=value)
        if instance:
            existing = existing.exclude(id=instance.user.id)
        if existing.exists():
            raise serializers.ValidationError(f'Username "{value}" is already taken.')
        return value

    def validate_email(self, value):
        instance = self.instance
        existing = User.objects.filter(email=value)
        if instance:
            existing = existing.exclude(id=instance.user.id)
        if existing.exists():
            raise serializers.ValidationError(f'Email "{value}" is already taken.')
        return value

    def get_total_customers(self, obj):
        total = getattr(obj, "total_customers", None)
        if total is not None:
            return total
        return obj.customers.count()

    def get_assigned_items(self, obj):
        request = self.context.get("request")
        if "assigned_items" in getattr(obj, "_prefetched_objects_cache", {}):
            qs = obj.assigned_items.all()
        else:
            qs = (
                obj.assigned_items.select_related("variant__fabric")
                .filter(variant__fabric__is_deleted=False)
                .order_by("-created_at")
            )
        fabric_groups = defaultdict(list)
        for ai in qs:
            fabric_groups[ai.variant.fabric_id].append(ai)

        return [
            AgentFabricListSerializer.from_assigned_variants(
                agent_items[0].variant.fabric, agent_items, request
            )
            for agent_items in fabric_groups.values()
        ]

    def create(self, validated_data):
        display_name = validated_data.pop("display_name", "")
        user = User.objects.create(
            username=validated_data["username"],
            email=validated_data["email"],
            password=make_password(validated_data["password"]),
            role="AGENT",
            display_name=display_name,
        )
        agent = Agent.objects.create(user=user, contact=validated_data["contact"])
        return agent

    def update(self, instance, validated_data):
        user = instance.user
        if "username" in validated_data and validated_data["username"] != user.username:
            user.username = validated_data["username"]
        if "email" in validated_data and validated_data["email"] != user.email:
            user.email = validated_data["email"]
        if "password" in validated_data:
            password = validated_data["password"]
            if password and not user.check_password(password):
                user.password = make_password(password)
        if (
            "display_name" in validated_data
            and validated_data["display_name"] != user.display_name
        ):
            user.display_name = validated_data["display_name"]
        user.save()
        if (
            "contact" in validated_data
            and validated_data["contact"] != instance.contact
        ):
            instance.contact = validated_data["contact"]
        instance.save()
        return instance
