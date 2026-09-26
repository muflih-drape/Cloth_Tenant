from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.accounts.permissions import IsSuperuser

from .models import Brand
from .serializers import BrandSerializer


class BrandViewSet(ModelViewSet):
    """The mill's company profile.

    Read for any signed-in user (invoices need it); write for superusers only.
    There is no delete -- ``Brand.delete()`` refuses, and ``destroy`` returns 405
    -- because invoicing would break without a company name.
    """

    serializer_class = BrandSerializer

    def get_queryset(self):
        return Brand.objects.all()

    def get_permissions(self):
        if self.request.method in ["POST", "PUT", "PATCH"]:
            return [IsSuperuser()]
        return [IsAuthenticated()]

    def list(self, request, *args, **kwargs):
        """Always return exactly the one profile, creating it if absent."""
        return Response([self.get_serializer(Brand.load()).data])

    def create(self, request, *args, **kwargs):
        """Update the singleton instead of adding a second company."""
        serializer = self.get_serializer(Brand.load(), data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, partial=True, **kwargs)

    def destroy(self, request, *args, **kwargs):
        return Response(
            {
                "error": "The company profile is required for invoicing and "
                "cannot be deleted. Clear the fields instead."
            },
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )
