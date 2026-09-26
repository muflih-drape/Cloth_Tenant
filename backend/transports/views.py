from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from .models import Transport
from .serializers import TransportSerializer


class IsAdminUser(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user and request.user.is_staff


class TransportViewSet(viewsets.ModelViewSet):
    queryset = Transport.objects.all()
    serializer_class = TransportSerializer

    def get_permissions(self):
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsAdminUser()]
        return [permissions.AllowAny()]

    @action(detail=False, methods=["get"])
    def active(self, request):
        transports = Transport.objects.filter(is_active=True)
        serializer = self.get_serializer(transports, many=True)
        return Response(serializer.data)
