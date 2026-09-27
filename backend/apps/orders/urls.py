from django.urls import path
from rest_framework.routers import DefaultRouter

from . import packing_views
from .views import (
    AddOrderItemView,
    DeleteOrderItemView,
    InvoiceView,
    MergeOrderItemsView,
    OrderItemViewSet,
    OrderLogsView,
    OrderViewSet,
    PlaceOrderView,
    SaveEditView,
    SetOrderPriceView,
    StartEditView,
)

router = DefaultRouter()
router.register("", OrderViewSet, basename="orders")
router.register("order-items", OrderItemViewSet, basename="order-items")

# The packing-round paths must come *before* the router. The router's detail
# route is ``^(?P<pk>[^/.]+)/$``, so a bare ``packing-rounds/`` would otherwise be
# swallowed as ``pk="packing-rounds"`` and 405 on POST instead of creating a round.
urlpatterns = [
    path("packing-rounds/queue/", packing_views.queue, name="packing-queue"),
    path("packing-rounds/preview/", packing_views.preview, name="packing-preview"),
    path("packing-rounds/list/", packing_views.list_rounds, name="packing-list"),
    path("packing-rounds/<int:pk>/confirm/", packing_views.confirm, name="packing-confirm"),
    path("packing-rounds/<int:pk>/cancel/", packing_views.cancel, name="packing-cancel"),
    path("packing-rounds/", packing_views.create_round, name="packing-create"),
] + router.urls + [
    path("<int:order_id>/place-order/", PlaceOrderView.as_view()),
    path("<int:order_id>/add-item/", AddOrderItemView.as_view()),
    path("<int:order_id>/delete-item/<int:item_id>/", DeleteOrderItemView.as_view()),
    path("<int:order_id>/merge-items/", MergeOrderItemsView.as_view()),
    path("<int:order_id>/invoice/", InvoiceView.as_view()),
    path("<int:order_id>/logs/", OrderLogsView.as_view()),
    path("<int:order_id>/start-edit/", StartEditView.as_view()),
    path("<int:order_id>/save-edit/", SaveEditView.as_view()),
    path("<int:order_id>/set-price/", SetOrderPriceView.as_view()),
]
