from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import CustomerViewSet, bulk_import_customers

router = DefaultRouter()
router.register("", CustomerViewSet, basename="customer")

urlpatterns = [
    path("bulk-import/", bulk_import_customers, name="customer-bulk-import"),
] + router.urls
