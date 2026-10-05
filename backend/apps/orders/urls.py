from django.urls import path
from rest_framework.routers import DefaultRouter

from . import bundle_views, packing_views
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
    path(
        "<int:order_id>/items/<int:item_id>/pack/",
        packing_views.pack_line,
        name="packing-pack-line",
    ),
    # Bundles are an order-level concept, so their paths hang off the order too
    # and likewise precede the router. "bundles" is a literal segment here and
    # never reaches the router's catch-all detail route.
    path("<int:order_id>/bundles/", bundle_views.list_bundles, name="bundle-list"),
    path(
        "<int:order_id>/bundles/create/", bundle_views.create_bundle, name="bundle-create"
    ),
    path(
        "<int:order_id>/bundles/<int:pk>/scan/",
        bundle_views.scan_into_bundle,
        name="bundle-scan",
    ),
    path(
        "<int:order_id>/bundles/<int:pk>/rolls/<int:roll_allocation_id>/remove/",
        bundle_views.remove_roll,
        name="bundle-remove-roll",
    ),
    path(
        "<int:order_id>/bundles/<int:pk>/seal/",
        bundle_views.seal_bundle,
        name="bundle-seal",
    ),
    path(
        "<int:order_id>/bundles/<int:pk>/cancel/",
        bundle_views.cancel_bundle,
        name="bundle-cancel",
    ),
    path(
        "<int:order_id>/bundles/<int:pk>/dispatch/",
        bundle_views.dispatch_bundle,
        name="bundle-dispatch",
    ),
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
