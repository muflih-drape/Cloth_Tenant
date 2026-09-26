from collections import defaultdict

from django.contrib.auth.hashers import make_password
from rest_framework import serializers

from apps.accounts.models import User
from apps.items.models import Item, ItemVariant

from .models import Agent, AgentItem


class VariantSizeRangeSerializer(serializers.Serializer):
    size_range = serializers.CharField()
    stock = serializers.IntegerField()


class VariantColorSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    image = serializers.CharField(allow_null=True)
    size_ranges = VariantSizeRangeSerializer(many=True)
    qr_code = serializers.CharField(allow_null=True)
    created_at = serializers.CharField(allow_null=True)
    display_order = serializers.CharField(allow_null=True)


class AgentItemListSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    type = serializers.CharField()
    price = serializers.DecimalField(max_digits=10, decimal_places=2)
    variants = VariantColorSerializer(many=True)

    @staticmethod
    def get_image_url(image_obj, request=None):
        if request and image_obj:
            return request.build_absolute_uri(image_obj.url)
        elif image_obj:
            return image_obj.url
        return None

    @classmethod
    def from_assigned_variants(cls, item, agent_items, request=None):
        variants_data = []
        for ai in agent_items:
            variant = ai.variant
            sizes = variant.sizes.all() if hasattr(variant, "sizes") else []
            variants_data.append(
                {
                    "id": variant.id,
                    "image": cls.get_image_url(variant.image, request),
                    "qr_code": str(variant.qr_code),
                    "size_ranges": [
                        {"size_range": s.size, "stock": s.stock} for s in sizes
                    ],
                    "created_at": ai.created_at.isoformat(),
                    "display_order": variant.display_order,
                }
            )

        return cls(
            {
                "id": item.id,
                "name": item.name,
                "type": item.type,
                "price": item.price,
                "variants": variants_data,
            }
        ).data


class AgentItemSerializer(serializers.ModelSerializer):
    variant = VariantColorSerializer(read_only=True)
    variant_id = serializers.PrimaryKeyRelatedField(
        queryset=ItemVariant.objects.all(),
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
        return obj.customers.count()

    def get_assigned_items(self, obj):
        request = self.context.get("request")
        qs = (
            obj.assigned_items.select_related("variant__item")
            .prefetch_related("variant__sizes")
            .filter(variant__item__is_deleted=False)
            .order_by("-created_at")
        )
        item_groups = defaultdict(list)
        for ai in qs:
            item_groups[ai.variant.item_id].append(ai)

        result = []
        for item_id, agent_items in item_groups.items():
            item_obj = agent_items[0].variant.item
            result.append(
                AgentItemListSerializer.from_assigned_variants(
                    item_obj, agent_items, request
                )
            )
        return result

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
