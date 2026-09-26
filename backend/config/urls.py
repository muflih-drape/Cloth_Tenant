from django.conf import settings
from django.conf.urls.static import serve
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path, re_path
from django.views.decorators.cache import cache_control
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

urlpatterns = [
    path("health/", lambda r: JsonResponse({"status": "ok"}), name="health"),
    # API schema
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    # Swagger UI
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    # Redoc (optional)
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
    # reset password
    path("api/password/", include("django_rest_passwordreset.urls")),
    path("admin/", admin.site.urls),
    path("api/admins/", include("apps.admins.urls")),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/agents/", include("apps.agents.urls")),
    path("api/customers/", include("apps.customers.urls")),
    path("api/items/", include("apps.items.urls")),
    path("api/orders/", include("apps.orders.urls")),
    path("api/dashboard/", include("apps.dashboard.urls")),
    path("api/business/", include("apps.business.urls")),
    path("api/notification/", include("apps.notification.urls")),
    path("api/", include("transports.urls")),
]

urlpatterns += [
    re_path(
        r"^media/(?P<path>.*)$",
        # Uploaded images get unique UUID filenames that are never overwritten,
        # so they are immutable once written — safe to cache for a year.
        cache_control(public=True, max_age=31536000, immutable=True)(serve),
        {
            "document_root": settings.MEDIA_ROOT,
        },
    ),
]
