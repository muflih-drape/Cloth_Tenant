from rest_framework import serializers
from .models import Brand


class BrandSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()

    class Meta:
        model = Brand
        fields = ['id', 'name', 'phone', 'email', 'address_line1', 'address_line2', 'logo', 'logo_url', 'gst', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']

    def get_logo_url(self, obj):
        request = self.context.get('request')
        if obj.logo and request:
            return request.build_absolute_uri(obj.logo.url)
        return None
