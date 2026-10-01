from django.db.models import Sum
from rest_framework import serializers

from apps.orders.models import Order

from .models import Customer


class CustomerSerializer(serializers.ModelSerializer):
    total_orders = serializers.SerializerMethodField()
    agent_name = serializers.SerializerMethodField()
    total_metres_bought = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = "__all__"
        read_only_fields = ("total_orders", "agent_name", "total_metres_bought")

    def get_agent_name(self, obj):
        return obj.agent.user.username if obj.agent_id else None

    def get_total_orders(self, obj):
        total = getattr(obj, "total_orders", None)
        if total is not None:
            return total
        return Order.objects.filter(customer=obj).exclude(status="DRAFT").count()

    def get_total_metres_bought(self, obj):
        """Lifetime dispatched metres -- the figure packing priority ranks on."""
        total = getattr(obj, "total_metres_bought", None)
        if total is None:
            total = Order.objects.filter(
                customer=obj, status="DISPATCHED"
            ).aggregate(total=Sum("items__allocated_quantity"))["total"]
        return str(total or 0)
