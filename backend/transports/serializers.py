from rest_framework import serializers
from .models import Transport


class TransportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transport
        fields = ["id", "name", "is_active", "created_at"]
