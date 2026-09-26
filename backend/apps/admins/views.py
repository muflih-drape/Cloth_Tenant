from rest_framework.viewsets import ModelViewSet

from apps.accounts.models import User
from apps.accounts.permissions import IsAdmin

from .serializers import AdminSerializer


class AdminViewSet(ModelViewSet):
    """Every admin can see and manage every other admin.

    Single-tenant, so there is no business scoping left to do.
    """

    serializer_class = AdminSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        return User.objects.filter(role="ADMIN").order_by("username")
