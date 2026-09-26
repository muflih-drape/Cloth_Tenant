from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from rest_framework.permissions import IsAuthenticated
from apps.accounts.permissions import IsSuperuser, check_admin_pin
from apps.items.models import Item
from apps.accounts.models import User
from .models import Brand
from .serializers import BrandSerializer


class BrandViewSet(ModelViewSet):
    queryset = Brand.objects.filter(is_active=True)
    serializer_class = BrandSerializer

    def get_permissions(self):
        if self.request.method in ['POST', 'PUT', 'PATCH', 'DELETE']:
            return [IsSuperuser()]
        return [IsAuthenticated()]

    @action(detail=True, methods=["get"])
    def delete_info(self, request, pk=None):
        brand = self.get_object()
        items_count = Item.objects.filter(brand=brand).count()
        users_count = User.objects.filter(brand=brand).count()
        other_brands = Brand.objects.filter(is_active=True).exclude(id=brand.id)
        transferable_brands = [
            {"id": b.id, "name": b.name} for b in other_brands
        ]
        return Response({
            "items_count": items_count,
            "users_count": users_count,
            "transferable_brands": transferable_brands,
        })

    def destroy(self, request, *args, **kwargs):
        pin_error = check_admin_pin(request)
        if pin_error:
            return pin_error

        brand = self.get_object()
        action = request.data.get("action", "deactivate")

        if action == "transfer":
            transfer_to_id = request.data.get("transfer_to_id")
            if not transfer_to_id:
                return Response(
                    {"error": "transfer_to_id is required for transfer action."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                target_brand = Brand.objects.get(id=transfer_to_id, is_active=True)
            except Brand.DoesNotExist:
                return Response(
                    {"error": "Target brand not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            Item.objects.filter(brand=brand).update(brand=target_brand)
            User.objects.filter(brand=brand).update(brand=target_brand)
            return super().destroy(request, *args, **kwargs)

        brand.is_active = False
        brand.deactivated_at = timezone.now()
        brand.save(update_fields=["is_active", "deactivated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)
