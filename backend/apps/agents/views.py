from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet
from collections import defaultdict
from django.db import transaction

from apps.accounts.permissions import (
    IsAdmin,
    IsAdminOrSelfAgent,
    check_admin_pin,
)
from apps.items.models import FabricVariant
from apps.notification.utils import notify_user_safely
from apps.orders.models import Order

from .models import Agent, AgentItem
from .serializers import AgentFabricListSerializer, AgentSerializer


def _assigned_fabrics(agent, request):
    """Group an agent's assigned variants by parent fabric, in stable order."""
    qs = (
        agent.assigned_items.select_related("variant__fabric")
        .filter(variant__fabric__is_deleted=False)
        .order_by("-id")
    )
    groups = defaultdict(list)
    for assignment in qs:
        groups[assignment.variant.fabric_id].append(assignment)

    return [
        AgentFabricListSerializer.from_assigned_variants(
            assignments[0].variant.fabric, assignments, request
        )
        for assignments in groups.values()
    ]


def _may_manage(request, agent):
    """Admins may see any agent's catalogue; agents only their own."""
    if request.user.role == "ADMIN":
        return True
    return agent.user_id == request.user.id


class AgentViewSet(ModelViewSet):
    serializer_class = AgentSerializer
    permission_classes = [IsAdminOrSelfAgent]

    def get_queryset(self):
        user = self.request.user

        if user.role == "ADMIN":
            return Agent.objects.filter(is_active=True).order_by('-id')

        return Agent.objects.filter(user=user, is_active=True).order_by('-id')

    @action(detail=True, methods=["get"])
    def delete_info(self, request, pk=None):
        agent = self.get_object()
        customers_count = agent.customers.count()
        orders_count = (
            Order.objects.filter(agent=agent).exclude(status="DRAFT").count()
        )
        other_agents = Agent.objects.filter(is_active=True).exclude(id=agent.id)
        transferable_agents = [
            {"id": a.id, "name": a.user.username} for a in other_agents
        ]
        return Response(
            {
                "customers_count": customers_count,
                "orders_count": orders_count,
                "transferable_agents": transferable_agents,
            }
        )

    def destroy(self, request, *args, **kwargs):
        pin_error = check_admin_pin(request)
        if pin_error:
            return pin_error

        agent = self.get_object()
        action_param = request.data.get("action", "deactivate")

        if action_param == "transfer":
            transfer_to_id = request.data.get("transfer_to_id")
            if not transfer_to_id:
                return Response(
                    {"error": "transfer_to_id is required for transfer action."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                target_agent = Agent.objects.get(id=transfer_to_id, is_active=True)
            except Agent.DoesNotExist:
                return Response(
                    {"error": "Target agent not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            agent.customers.all().update(agent=target_agent)
            agent.hard_delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        agent.soft_delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AgentDetail(APIView):
    def get(self, request, user_id):
        agent = get_object_or_404(Agent, user_id=user_id)
        serializer = AgentSerializer(agent, context={"request": request})
        return Response(serializer.data)


class AgentItemsView(APIView):
    """The fabrics an agent is allowed to sell.

    Reads are open to the agent themselves and to admins. Writes are admin-only:
    an agent must not be able to widen their own catalogue.
    """

    def get_permissions(self):
        if self.request.method == "GET":
            return [IsAdminOrSelfAgent()]
        return [IsAdmin()]

    def get(self, request, agent_id):
        agent = get_object_or_404(Agent, id=agent_id)
        if not _may_manage(request, agent):
            return Response({"error": "Unauthorized"}, status=status.HTTP_403_FORBIDDEN)
        return Response(_assigned_fabrics(agent, request))

    def post(self, request, agent_id):
        agent = get_object_or_404(Agent, id=agent_id)
        variant_ids = request.data.get("variant_ids", [])

        if not isinstance(variant_ids, list):
            return Response(
                {"error": "variant_ids must be a list"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing_qs = agent.assigned_items.all()
        existing_variant_ids = set(
            existing_qs.values_list("variant_id", flat=True)
        )
        incoming_variant_ids = set(variant_ids)

        ids_to_remove = existing_variant_ids - incoming_variant_ids
        if ids_to_remove:
            agent.assigned_items.filter(variant_id__in=ids_to_remove).delete()

        ids_to_add = incoming_variant_ids - existing_variant_ids
        assigned_count = 0
        for variant_id in ids_to_add:
            try:
                variant = FabricVariant.objects.get(
                    id=variant_id, fabric__is_deleted=False
                )
            except FabricVariant.DoesNotExist:
                continue
            AgentItem.objects.create(agent=agent, variant=variant)
            assigned_count += 1

        result = _assigned_fabrics(agent, request)

        if assigned_count > 0:
            notify_user_safely(
                agent.user_id,
                "Fabrics Assigned",
                f"{assigned_count} fabric{'s' if assigned_count > 1 else ''} "
                "have been assigned to you",
            )

        return Response(result)

    def delete(self, request, agent_id):
        agent = get_object_or_404(Agent, id=agent_id)
        agent.assigned_items.all().delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

class AgentItemDetailView(APIView):
    permission_classes = [IsAdmin()]

    def delete(self, request, agent_id, variant_id):
        agent = get_object_or_404(Agent, id=agent_id)
        agent_item = get_object_or_404(
            AgentItem, agent=agent, variant_id=variant_id
        )
        agent_item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AgentItemTransferView(APIView):
    permission_classes = [IsAdmin()]

    def post(self, request, agent_id):
        source_agent = get_object_or_404(Agent, id=agent_id)
        target_agent_id = request.data.get("target_agent_id")
        
        if not target_agent_id:
            return Response(
                {"error": "target_agent_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
            
        target_agent = get_object_or_404(Agent, id=target_agent_id, is_active=True)
        
        if source_agent.id == target_agent.id:
            return Response(
                {"error": "Source and target agents cannot be the same."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        source_items = source_agent.assigned_items.all()

        if not source_items.exists():
            return Response(
                {"message": "No fabrics to transfer."},
                status=status.HTTP_200_OK
            )
            
        target_existing_variants = set(
            target_agent.assigned_items.values_list("variant_id", flat=True)
        )
        
        assigned_count = 0
        with transaction.atomic():
            for item in source_items:
                if item.variant_id not in target_existing_variants:
                    AgentItem.objects.create(agent=target_agent, variant_id=item.variant_id)
                    assigned_count += 1
                    
            source_items.delete()

        if assigned_count > 0:
            notify_user_safely(
                target_agent.user_id,
                "Fabrics Transferred",
                f"{assigned_count} fabric{'s' if assigned_count > 1 else ''} "
                "have been transferred to you",
            )

        return Response(
            {"message": "Fabrics successfully transferred."},
            status=status.HTTP_200_OK
        )


class AgentItemCopyView(APIView):
    permission_classes = [IsAdmin()]

    def post(self, request, agent_id):
        source_agent = get_object_or_404(Agent, id=agent_id)
        target_agent_id = request.data.get("target_agent_id")
        
        if not target_agent_id:
            return Response(
                {"error": "target_agent_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
            
        target_agent = get_object_or_404(Agent, id=target_agent_id, is_active=True)
        
        if source_agent.id == target_agent.id:
            return Response(
                {"error": "Source and target agents cannot be the same."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        source_items = source_agent.assigned_items.all()

        if not source_items.exists():
            return Response(
                {"message": "No fabrics to copy."},
                status=status.HTTP_200_OK
            )
            
        target_existing_variants = set(
            target_agent.assigned_items.values_list("variant_id", flat=True)
        )
        
        assigned_count = 0
        with transaction.atomic():
            for item in source_items:
                if item.variant_id not in target_existing_variants:
                    AgentItem.objects.create(agent=target_agent, variant_id=item.variant_id)
                    assigned_count += 1
                    
        if assigned_count > 0:
            notify_user_safely(
                target_agent.user_id,
                "Fabrics Copied",
                f"{assigned_count} fabric{'s' if assigned_count > 1 else ''} "
                "have been copied to you",
            )

        return Response(
            {"message": "Fabrics successfully copied."},
            status=status.HTTP_200_OK
        )
