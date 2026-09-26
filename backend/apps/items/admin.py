from django.contrib import admin

from .models import Fabric, FabricVariant


class FabricVariantInline(admin.TabularInline):
    model = FabricVariant
    extra = 0
    fields = ("display_order", "stock_meters", "qr_code", "image")
    readonly_fields = ("qr_code",)


@admin.register(Fabric)
class FabricAdmin(admin.ModelAdmin):
    list_display = ("name", "price_per_meter", "variant_count", "stock_meters",
                    "is_deleted", "catalog_updated_at")
    list_filter = ("is_deleted",)
    search_fields = ("name",)
    inlines = [FabricVariantInline]

    @admin.display(description="Variants")
    def variant_count(self, obj):
        return obj.variants.count()

    @admin.display(description="Stock (m)")
    def stock_meters(self, obj):
        return sum(v.stock_meters for v in obj.variants.all())


@admin.register(FabricVariant)
class FabricVariantAdmin(admin.ModelAdmin):
    list_display = ("__str__", "fabric", "display_order", "stock_meters",
                    "stock_updated_at")
    list_filter = ("fabric",)
    search_fields = ("fabric__name", "display_order")
    readonly_fields = ("qr_code", "stock_updated_at")
