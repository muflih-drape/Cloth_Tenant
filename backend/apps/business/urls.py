from rest_framework.routers import DefaultRouter
from .views import BrandViewSet
from django.conf import settings
from django.conf.urls.static import static

router = DefaultRouter()
router.register(r'', BrandViewSet, basename='brands')

urlpatterns = router.urls + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
