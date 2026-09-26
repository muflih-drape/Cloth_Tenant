from django.urls import path

from .views import (
    RegisterDeviceTokenView,
    SaveSubscriptionView,
    UnregisterDeviceTokenView,
)

urlpatterns = [
    path("save-subscription/", SaveSubscriptionView.as_view()),
    path("register-token/", RegisterDeviceTokenView.as_view()),
    path("unregister-token/", UnregisterDeviceTokenView.as_view()),
]
