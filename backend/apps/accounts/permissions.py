from rest_framework.permissions import BasePermission
from rest_framework.response import Response


class IsAgent(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == "AGENT"


class IsAgentOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role in ("AGENT", "ADMIN")


class IsAdmin(BasePermission):
    def has_permission(self, request, view):

        print(f"Role {request.user.role}")
        return request.user.is_authenticated and request.user.role == "ADMIN"


class IsSuperuser(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_superuser


class IsAdminOrSelfAgent(BasePermission):
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        if request.user.role == "ADMIN":
            return True

        return obj.user == request.user


def admin_business(user):
    """Return the business string for an admin user, or None for non-admins."""
    return user.business if getattr(user, "role", None) == "ADMIN" else None


def check_admin_pin(request):
    if request.user.is_superuser:
        return None
    if request.user.role == "AGENT":
        return None
    if request.user.role != "ADMIN":
        return Response({"error": "Forbidden"}, status=403)
    raw_pin = request.data.get("pin")
    if not raw_pin:
        return Response({"error": "PIN is required to delete."}, status=403)
    if not request.user.check_pin(raw_pin):
        return Response({"error": "Incorrect PIN."}, status=403)
    return None
