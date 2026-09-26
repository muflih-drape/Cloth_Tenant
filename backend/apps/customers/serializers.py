from rest_framework import serializers
from .models import Customer
from apps.orders.models import Order
from apps.accounts.permissions import admin_business

class CustomerSerializer(serializers.ModelSerializer):
    total_orders = serializers.SerializerMethodField()
    agent_name = serializers.SerializerMethodField()
    has_business_orders = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = '__all__'

    def get_agent_name(self, obj):
        return obj.agent.user.username if obj.agent_id else None

    def get_total_orders(self, obj):
        return Order.objects.filter(customer=obj).exclude(status="DRAFT").count()

    def get_has_business_orders(self, obj):
        request = self.context.get('request')
        biz = admin_business(getattr(request, 'user', None))
        if not biz:
            return None
        return obj.order_set.filter(items__item_type=biz).exists()