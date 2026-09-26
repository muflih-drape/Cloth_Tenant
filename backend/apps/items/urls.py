from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ItemVariantViewSet, ItemViewSet, SizeRangesAPIView

item_router = DefaultRouter()
variant_router = DefaultRouter()

item_router.register(r"", ItemViewSet, basename="items")
variant_router.register(r"", ItemVariantViewSet, basename="item-variants")

urlpatterns = [
    path("", include(item_router.urls)),
    path("variants/", include(variant_router.urls)),
    path(
        "size-ranges",
        SizeRangesAPIView.as_view(),
        name="size-ranges",
    ),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
