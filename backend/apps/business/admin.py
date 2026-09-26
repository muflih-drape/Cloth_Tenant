from django.contrib import admin
from .models import Brand


@admin.register(Brand)
class BrandAdmin(admin.ModelAdmin):
    list_display = ('name', 'phone', 'email', 'gst')
    search_fields = ('name', 'email', 'phone')
