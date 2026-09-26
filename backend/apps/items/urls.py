from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import FabricVariantViewSet, FabricViewSet

fabric_router = DefaultRouter()
variant_router = DefaultRouter()

fabric_router.register(r"", FabricViewSet, basename="items")
variant_router.register(r"", FabricVariantViewSet, basename="item-variants")

urlpatterns = [
    path("", include(fabric_router.urls)),
    path("variants/", include(variant_router.urls)),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
