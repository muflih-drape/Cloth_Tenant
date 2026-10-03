from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path
from rest_framework.routers import DefaultRouter, SimpleRouter

from .views import FabricRollViewSet, FabricVariantViewSet, FabricViewSet

fabric_router = DefaultRouter()
variant_router = DefaultRouter()

# SimpleRouter, not DefaultRouter: DefaultRouter also serves an API-root view at
# `^$`, and this router is mounted at the app root, so its root view would take
# `/api/items/` away from the fabric list/create endpoints. Rolls need no root
# view of their own.
roll_router = SimpleRouter()

fabric_router.register(r"", FabricViewSet, basename="items")
variant_router.register(r"", FabricVariantViewSet, basename="item-variants")
roll_router.register(r"rolls", FabricRollViewSet, basename="item-rolls")

urlpatterns = [
    # Rolls are declared before the catalogue router: its detail route is
    # `^(?P<pk>[^/.]+)/$`, which would otherwise swallow `/api/items/rolls/` as
    # pk="rolls" and 404 the whole roll API.
    path("", include(roll_router.urls)),
    path("", include(fabric_router.urls)),
    path("variants/", include(variant_router.urls)),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)