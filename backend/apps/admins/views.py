from rest_framework.viewsets import ModelViewSet
from apps.accounts.permissions import IsAdmin
from apps.accounts.models import User
from .serializers import AdminSerializer

class AdminViewSet(ModelViewSet):
    serializer_class = AdminSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        qs = User.objects.filter(role='ADMIN')
        if self.request.user.is_superuser:
            return qs
        biz = self.request.user.business
        if biz:
            qs = qs.filter(business=biz)
        return qs
