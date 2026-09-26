from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import AgentViewSet, AgentDetail, AgentItemsView, AgentItemDetailView, AgentItemTransferView, AgentItemCopyView

router = DefaultRouter()
router.register('', AgentViewSet, basename='agent')

urlpatterns = [
    path('', include(router.urls)),
    path('profile/<int:user_id>/', AgentDetail.as_view(), name='agent-by-user'),
    path('<int:agent_id>/items/', AgentItemsView.as_view(), name='agent-items'),
    path('<int:agent_id>/items/transfer/', AgentItemTransferView.as_view(), name='agent-item-transfer'),
    path('<int:agent_id>/items/copy/', AgentItemCopyView.as_view(), name='agent-item-copy'),
    path('<int:agent_id>/items/variants/<int:variant_id>/', AgentItemDetailView.as_view(), name='agent-item-detail'),
]

