from django.urls import path

from .views import (
    ForgotPasswordView,
    LoginView,
    ProfileView,
    ResetPasswordView,
    VerifyPinView,
)

urlpatterns = [
    path("login/", LoginView.as_view(), name="login"),
    path("profile/", ProfileView.as_view(), name="profile"),
    path("forgot-password/", ForgotPasswordView.as_view(), name="forgot-password"),
    path("reset-password/", ResetPasswordView.as_view(), name="reset-password"),
    path("verify-pin/", VerifyPinView.as_view(), name="verify-pin"),
]
