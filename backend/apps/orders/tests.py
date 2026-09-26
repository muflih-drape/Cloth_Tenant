from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from kombu.exceptions import OperationalError
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.agents.models import Agent
from apps.business.models import Brand
from apps.customers.models import Customer
from apps.items.models import Item, ItemVariant, ItemVariantSize
from apps.orders.models import Order, OrderItem

User = get_user_model()


def get_auth_header(user):
    refresh = RefreshToken.for_user(user)
    return {"HTTP_AUTHORIZATION": f"Bearer {refresh.access_token}"}


class UnpackedOrderItemsTestBase(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.brand = Brand.objects.create(
            name="Test Brand",
            phone="1234567890",
            email="brand@test.com",
            address_line1="123 St",
        )

        self.admin_user = User.objects.create_user(
            username="admin1",
            email="admin1@test.com",
            password="pass1234",
            role="ADMIN",
            business="gents",
            brand=self.brand,
        )

        self.agent_user = User.objects.create_user(
            username="agent1",
            email="agent1@test.com",
            password="pass1234",
            role="AGENT",
        )

        self.agent = Agent.objects.create(
            user=self.agent_user, contact="1111111111"
        )

        self.customer = Customer.objects.create(
            name="ABC Fashions", contact="2222222222", agent=self.agent
        )

        self.item = Item.objects.create(
            name="Classic Shirt",
            price=500.00,
            type="gents",
            brand=self.brand,
        )

        self.variant = ItemVariant.objects.create(
            item=self.item, display_order="101"
        )

        self.order = Order.objects.create(
            customer=self.customer, agent=self.agent, status="PENDING"
        )

        self.url = "/api/orders/order-items/unpacked/"


class UnpackedOrderItemsSuccessTests(UnpackedOrderItemsTestBase):
    def test_returns_unpacked_items_from_pending_orders(self):
        OrderItem.objects.create(
            order=self.order,
            item=self.item,
            variant=self.variant,
            quantity=20,
            packed_quantity=0,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="M,L,XL",
            item_type="gents",
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)

    def test_excludes_packed_items(self):
        OrderItem.objects.create(
            order=self.order,
            item=self.item,
            variant=self.variant,
            quantity=20,
            packed_quantity=20,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="M,L,XL",
            item_type="gents",
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 0)

    def test_excludes_items_from_non_pending_orders(self):
        dispatched_order = Order.objects.create(
            customer=self.customer, agent=self.agent, status="DISPATCHED"
        )
        OrderItem.objects.create(
            order=dispatched_order,
            item=self.item,
            variant=self.variant,
            quantity=20,
            packed_quantity=0,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="M,L,XL",
            item_type="gents",
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 0)

    def test_excludes_draft_order_items(self):
        draft_order = Order.objects.create(
            customer=self.customer, agent=self.agent, status="DRAFT"
        )
        OrderItem.objects.create(
            order=draft_order,
            item=self.item,
            variant=self.variant,
            quantity=20,
            packed_quantity=0,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="M,L,XL",
            item_type="gents",
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 0)

    def test_returns_lightweight_fields(self):
        OrderItem.objects.create(
            order=self.order,
            item=self.item,
            variant=self.variant,
            quantity=20,
            packed_quantity=0,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="M,L,XL",
            item_type="gents",
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.url)

        item = response.data[0]
        self.assertIn("id", item)
        self.assertIn("item_name", item)
        self.assertIn("variant_display_order", item)
        self.assertIn("quantity", item)
        self.assertIn("size_group", item)
        self.assertIn("item_type", item)
        self.assertIn("piece_count", item)

        self.assertNotIn("item_price", item)
        self.assertNotIn("packed_quantity", item)
        self.assertNotIn("order", item)
        self.assertIn("variant_image", item)

    def test_correct_field_values(self):
        OrderItem.objects.create(
            order=self.order,
            item=self.item,
            variant=self.variant,
            quantity=25,
            packed_quantity=0,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="M,L,XL",
            item_type="gents",
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.url)

        item = response.data[0]
        self.assertEqual(item["item_name"], "Classic Shirt")
        self.assertEqual(item["variant_display_order"], "101")
        self.assertEqual(item["quantity"], 25)
        self.assertEqual(item["size_group"], "M,L,XL")
        self.assertEqual(item["item_type"], "gents")
        self.assertEqual(item["piece_count"], 3)

    def test_empty_list_when_no_unpacked_items(self):
        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_multiple_unpacked_items(self):
        customer2 = Customer.objects.create(
            name="XYZ Garments", contact="3333333333", agent=self.agent
        )
        order2 = Order.objects.create(
            customer=customer2, agent=self.agent, status="PENDING"
        )

        OrderItem.objects.create(
            order=self.order,
            item=self.item,
            variant=self.variant,
            quantity=20,
            packed_quantity=0,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="M,L,XL",
            item_type="gents",
        )
        OrderItem.objects.create(
            order=order2,
            item=self.item,
            variant=self.variant,
            quantity=30,
            packed_quantity=0,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="S,M,L,XL",
            item_type="gents",
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)


class UnpackedOrderItemsIsolationTests(UnpackedOrderItemsTestBase):
    def test_unauthenticated_request_rejected(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_agent_sees_only_own_items(self):
        OrderItem.objects.create(
            order=self.order,
            item=self.item,
            variant=self.variant,
            quantity=20,
            packed_quantity=0,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="M,L,XL",
            item_type="gents",
        )

        other_agent_user = User.objects.create_user(
            username="agent2",
            email="agent2@test.com",
            password="pass1234",
            role="AGENT",
        )
        other_agent = Agent.objects.create(
            user=other_agent_user, contact="4444444444"
        )
        other_customer = Customer.objects.create(
            name="Other Corp", contact="5555555555", agent=other_agent
        )
        other_order = Order.objects.create(
            customer=other_customer, agent=other_agent, status="PENDING"
        )
        OrderItem.objects.create(
            order=other_order,
            item=self.item,
            variant=self.variant,
            quantity=15,
            packed_quantity=0,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="M,L,XL",
            item_type="gents",
        )

        self.client.credentials(**get_auth_header(self.agent_user))
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["quantity"], 20)

    def test_admin_business_type_isolation(self):
        OrderItem.objects.create(
            order=self.order,
            item=self.item,
            variant=self.variant,
            quantity=20,
            packed_quantity=0,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="M,L,XL",
            item_type="gents",
        )

        kids_item = Item.objects.create(
            name="Kids Top", price=300.00, type="kids", brand=self.brand
        )
        kids_variant = ItemVariant.objects.create(
            item=kids_item, display_order="201"
        )
        kids_order = Order.objects.create(
            customer=self.customer, agent=self.agent, status="PENDING"
        )
        OrderItem.objects.create(
            order=kids_order,
            item=kids_item,
            variant=kids_variant,
            quantity=10,
            packed_quantity=0,
            item_name="Kids Top",
            item_price=300.00,
            size_group="20-36",
            item_type="kids",
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["item_name"], "Classic Shirt")

    def test_mixed_packed_and_unpacked_across_orders(self):
        customer2 = Customer.objects.create(
            name="XYZ Garments", contact="3333333333", agent=self.agent
        )
        order2 = Order.objects.create(
            customer=customer2, agent=self.agent, status="PENDING"
        )

        OrderItem.objects.create(
            order=self.order,
            item=self.item,
            variant=self.variant,
            quantity=20,
            packed_quantity=0,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="M,L,XL",
            item_type="gents",
        )
        OrderItem.objects.create(
            order=order2,
            item=self.item,
            variant=self.variant,
            quantity=30,
            packed_quantity=15,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="S,M,L,XL",
            item_type="gents",
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["quantity"], 20)


class DraftTestBase(UnpackedOrderItemsTestBase):
    def setUp(self):
        super().setUp()
        self.orders_url = "/api/orders/"

    def make_order_item(self, order, quantity=5):
        return OrderItem.objects.create(
            order=order,
            item=self.item,
            variant=self.variant,
            quantity=quantity,
            packed_quantity=0,
            item_name="Classic Shirt",
            item_price=500.00,
            size_group="M,L,XL",
            item_type="gents",
        )

    def analytics_range(self, days_back=30):
        """Explicit from/to covering today in the configured local timezone.

        ``created_at__date`` casts rows with the ``TIME_ZONE`` (Asia/Kolkata)
        while the analytics view's default range is derived from
        ``timezone.now().date()`` (UTC). Between 00:00-05:29 IST those two
        dates differ, so orders created "now" fall outside the default window
        and analytics totals read 0. Tests that need the default 30-day window
        must pass an explicit range computed from ``timezone.localdate()`` so
        the suite does not depend on the wall-clock time it happens to run at.
        """
        end = timezone.localdate()
        start = end - timedelta(days=days_back)
        return {"from": start.isoformat(), "to": end.isoformat()}

    def make_draft(self, created_by, agent=None, age=None, with_item=False):
        draft = Order.objects.create(
            customer=self.customer,
            agent=agent if agent is not None else self.agent,
            status="DRAFT",
            created_by=created_by,
        )
        if with_item:
            self.make_order_item(draft)
        if age is not None:
            Order.objects.filter(id=draft.id).update(
                created_at=timezone.now() - age
            )
        return draft


class DraftOwnershipTests(DraftTestBase):
    def test_admin_cannot_place_agent_created_draft(self):
        draft = self.make_draft(created_by=self.agent_user, with_item=True)

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.post(f"/api/orders/{draft.id}/place-order/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        draft.refresh_from_db()
        self.assertEqual(draft.status, "DRAFT")

    def test_admin_cannot_add_item_to_agent_created_draft(self):
        draft = self.make_draft(created_by=self.agent_user)

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.post(
            f"/api/orders/{draft.id}/add-item/",
            {
                "qr_code": str(self.variant.qr_code),
                "quantity": 1,
                "size_group": "M,L,XL",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(draft.items.count(), 0)

    def test_agent_cannot_place_admin_created_draft(self):
        draft = self.make_draft(
            created_by=self.admin_user, agent=self.agent, with_item=True
        )

        self.client.credentials(**get_auth_header(self.agent_user))
        response = self.client.post(f"/api/orders/{draft.id}/place-order/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        draft.refresh_from_db()
        self.assertEqual(draft.status, "DRAFT")

    def test_agent_cannot_add_item_to_admin_created_draft(self):
        draft = self.make_draft(created_by=self.admin_user, agent=self.agent)

        self.client.credentials(**get_auth_header(self.agent_user))
        response = self.client.post(
            f"/api/orders/{draft.id}/add-item/",
            {
                "qr_code": str(self.variant.qr_code),
                "quantity": 1,
                "size_group": "M,L,XL",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(draft.items.count(), 0)

    def test_admin_can_add_item_to_own_draft_without_assignment(self):
        draft = self.make_draft(created_by=self.admin_user, agent=self.agent)

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.post(
            f"/api/orders/{draft.id}/add-item/",
            {
                "qr_code": str(self.variant.qr_code),
                "quantity": 3,
                "size_group": "M,L,XL",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(draft.items.count(), 1)

    def test_legacy_draft_without_creator_still_owned_by_agent(self):
        legacy = self.make_draft(created_by=None, agent=self.agent, with_item=True)

        self.client.credentials(**get_auth_header(self.agent_user))
        response = self.client.post(f"/api/orders/{legacy.id}/place-order/")

        self.assertNotEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class DraftSweepTests(DraftTestBase):
    def test_legacy_draft_swept_after_15_minutes_for_agent(self):
        legacy = self.make_draft(
            created_by=None, agent=self.agent, age=timedelta(minutes=20)
        )

        self.client.credentials(**get_auth_header(self.agent_user))
        response = self.client.get(self.orders_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(Order.objects.filter(id=legacy.id).exists())

    def test_legacy_draft_visible_in_agent_list_before_expiry(self):
        legacy = self.make_draft(created_by=None, agent=self.agent)

        self.client.credentials(**get_auth_header(self.agent_user))
        response = self.client.get(self.orders_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [o["id"] for o in response.data["results"]]
        self.assertIn(legacy.id, ids)

    def test_admin_draft_swept_after_24_hours(self):
        old = self.make_draft(
            created_by=self.admin_user, age=timedelta(hours=25), with_item=True
        )
        fresh = self.make_draft(
            created_by=self.admin_user, age=timedelta(hours=1), with_item=True
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.orders_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(Order.objects.filter(id=old.id).exists())
        self.assertTrue(Order.objects.filter(id=fresh.id).exists())

    def test_admin_sweep_does_not_delete_agent_drafts(self):
        agent_draft = self.make_draft(
            created_by=self.agent_user,
            agent=self.agent,
            age=timedelta(hours=25),
            with_item=True,
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        self.client.get(self.orders_url)

        self.assertTrue(Order.objects.filter(id=agent_draft.id).exists())


class AdminDraftVisibilityTests(DraftTestBase):
    def test_admin_list_shows_only_own_drafts(self):
        own = self.make_draft(
            created_by=self.admin_user, with_item=True
        )
        agent_draft = self.make_draft(
            created_by=self.agent_user, agent=self.agent, with_item=True
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.orders_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [o["id"] for o in response.data["results"]]
        self.assertIn(own.id, ids)
        self.assertNotIn(agent_draft.id, ids)

    def test_admin_retrieve_own_draft_by_id(self):
        own = self.make_draft(created_by=self.admin_user, with_item=True)

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(f"/api/orders/{own.id}/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["id"], own.id)

    def test_admin_cannot_retrieve_other_draft_by_id(self):
        agent_draft = self.make_draft(
            created_by=self.agent_user, agent=self.agent, with_item=True
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(f"/api/orders/{agent_draft.id}/")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class AdminPerformCreateTests(DraftTestBase):
    def test_admin_create_requires_agent(self):
        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.post(
            self.orders_url, {"customer": self.customer.id}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("agent", response.data)

    def test_admin_create_rejects_inactive_agent(self):
        self.agent.is_active = False
        self.agent.save(update_fields=["is_active"])

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.post(
            self.orders_url,
            {"customer": self.customer.id, "agent": self.agent.id},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("agent", response.data)

    def test_admin_create_rejects_inactive_agent_user(self):
        self.agent_user.is_active = False
        self.agent_user.save(update_fields=["is_active"])

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.post(
            self.orders_url,
            {"customer": self.customer.id, "agent": self.agent.id},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("agent", response.data)

    def test_admin_create_sets_agent_and_creator(self):
        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.post(
            self.orders_url,
            {"customer": self.customer.id, "agent": self.agent.id},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        order = Order.objects.get(id=response.data["id"])
        self.assertEqual(order.agent_id, self.agent.id)
        self.assertEqual(order.created_by_id, self.admin_user.id)

    def test_agent_create_sets_creator(self):
        self.client.credentials(**get_auth_header(self.agent_user))
        response = self.client.post(
            self.orders_url, {"customer": self.customer.id}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        order = Order.objects.get(id=response.data["id"])
        self.assertEqual(order.agent_id, self.agent.id)
        self.assertEqual(order.created_by_id, self.agent_user.id)


class PatchGuardTests(DraftTestBase):
    def test_patch_dispatched_is_blocked(self):
        self.make_order_item(self.order)

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.patch(
            f"/api/orders/{self.order.id}/",
            {"status": "DISPATCHED"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "PENDING")

    def test_patch_draft_to_pending_is_blocked(self):
        draft = self.make_draft(created_by=self.agent_user)

        self.client.credentials(**get_auth_header(self.agent_user))
        response = self.client.patch(
            f"/api/orders/{draft.id}/", {"status": "PENDING"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        draft.refresh_from_db()
        self.assertEqual(draft.status, "DRAFT")

    def test_agent_cannot_patch_admin_created_draft(self):
        draft = self.make_draft(created_by=self.admin_user, agent=self.agent)

        self.client.credentials(**get_auth_header(self.agent_user))
        response = self.client.patch(
            f"/api/orders/{draft.id}/", {"notes": "x"}, format="json"
        )

        self.assertIn(
            response.status_code,
            (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND),
        )

    def test_patch_pending_to_packed_allowed(self):
        self.client.credentials(**get_auth_header(self.agent_user))
        response = self.client.patch(
            f"/api/orders/{self.order.id}/", {"status": "PACKED"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "PACKED")


class AdminNonDraftActionTests(DraftTestBase):
    def _add_item_payload(self):
        return {
            "qr_code": str(self.variant.qr_code),
            "quantity": 1,
            "size_group": "M,L,XL",
        }

    def test_admin_add_item_to_pending_order_forbidden(self):
        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.post(
            f"/api/orders/{self.order.id}/add-item/",
            self._add_item_payload(),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_place_pending_order_forbidden(self):
        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.post(f"/api/orders/{self.order.id}/place-order/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "PENDING")

    def test_admin_cannot_replace_pending_order(self):
        self.order.created_by = self.admin_user
        self.order.save(update_fields=["created_by"])

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.post(f"/api/orders/{self.order.id}/place-order/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class OrderIdsCountTests(DraftTestBase):
    def test_admin_order_ids_exclude_drafts(self):
        self.make_order_item(self.order)
        own_draft = self.make_draft(created_by=self.admin_user, with_item=True)

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get("/api/orders/order-ids/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [o["id"] for o in response.data]
        self.assertIn(self.order.id, ids)
        self.assertNotIn(own_draft.id, ids)

    def test_agent_order_ids_include_own_drafts(self):
        draft = self.make_draft(created_by=self.agent_user)

        self.client.credentials(**get_auth_header(self.agent_user))
        response = self.client.get("/api/orders/order-ids/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [o["id"] for o in response.data]
        self.assertIn(draft.id, ids)


class AnalyticsDraftTests(DraftTestBase):
    analytics_url = "/api/dashboard/analytics/"

    def test_kpis_draft_key_is_present(self):
        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.analytics_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("draft", response.data["kpis"])

    def test_draft_excluded_from_total_trend_and_top_lists(self):
        self.make_draft(created_by=self.agent_user, with_item=True)
        self.make_order_item(self.order, quantity=7)

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.analytics_url, self.analytics_range())

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        kpis = response.data["kpis"]
        self.assertEqual(kpis["draft"], 1)
        self.assertEqual(kpis["total"], 1)
        self.assertEqual(kpis["pending"], 1)

        self.assertEqual(len(response.data["top_customers"]), 1)
        self.assertEqual(response.data["top_customers"][0]["count"], 1)
        self.assertEqual(response.data["top_items"][0]["qty"], 7)

        trend_total = sum(point["count"] for point in response.data["trend"])
        self.assertEqual(trend_total, 1)


class AnalyticsKPITotalsTests(DraftTestBase):
    """kpis.total_sets / total_pieces / total_value over placed orders."""

    analytics_url = "/api/dashboard/analytics/"

    def _item(self, order, quantity, price=500.00, size_group="M,L,XL",
              item_type="gents", item=None, variant=None):
        return OrderItem.objects.create(
            order=order,
            item=item or self.item,
            variant=variant or self.variant,
            quantity=quantity,
            packed_quantity=0,
            item_name=(item or self.item).name,
            item_price=price,
            size_group=size_group,
            item_type=item_type,
        )

    def _placed_order(self, status="PENDING"):
        return Order.objects.create(
            customer=self.customer, agent=self.agent, status=status
        )

    def test_totals_match_known_dataset(self):
        self._item(self.order, quantity=7)  # 500 x 7 x 3
        self._item(self.order, quantity=2, price=100.00,
                   size_group="S,M,L,XL,XXL")  # 100 x 2 x 5

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.analytics_url, self.analytics_range())

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        kpis = response.data["kpis"]
        for key in ("total", "draft", "pending", "editing", "packed", "dispatched"):
            self.assertIn(key, kpis)
        self.assertEqual(kpis["total_sets"], 9)
        self.assertEqual(kpis["total_pieces"], 7 * 3 + 2 * 5)
        self.assertEqual(kpis["total_value"], 7 * 500 * 3 + 2 * 100 * 5)

    def test_draft_excluded_from_totals(self):
        self.make_draft(created_by=self.agent_user, with_item=True)
        self._item(self.order, quantity=4)

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.analytics_url, self.analytics_range())

        kpis = response.data["kpis"]
        self.assertEqual(kpis["draft"], 1)
        self.assertEqual(kpis["total_sets"], 4)
        self.assertEqual(kpis["total_pieces"], 12)
        self.assertEqual(kpis["total_value"], 6000.0)

    def test_date_range_excludes_outside_orders(self):
        old_order = self._placed_order()
        self._item(old_order, quantity=3)
        Order.objects.filter(id=old_order.id).update(
            created_at=timezone.now() - timedelta(days=45)
        )
        self._item(self.order, quantity=3)

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.analytics_url, self.analytics_range())

        kpis = response.data["kpis"]
        self.assertEqual(kpis["total_sets"], 3)
        self.assertEqual(kpis["total_pieces"], 9)
        self.assertEqual(kpis["total_value"], 4500.0)

    def test_business_scoping(self):
        kids_item = Item.objects.create(
            name="Kids Tee", price=300.00, type="kids", brand=self.brand
        )
        kids_variant = ItemVariant.objects.create(
            item=kids_item, display_order="201"
        )
        kids_order = self._placed_order()
        self._item(kids_order, quantity=2, price=300.00, size_group="20-24",
                   item_type="kids", item=kids_item, variant=kids_variant)
        self._item(self.order, quantity=5)

        gents_admin = self.admin_user
        kids_admin = User.objects.create_user(
            username="admin2", email="admin2@test.com", password="pass1234",
            role="ADMIN", business="kids", brand=self.brand,
        )
        super_user = User.objects.create_superuser(
            username="root1", email="root1@test.com", password="pass1234"
        )

        self.client.credentials(**get_auth_header(gents_admin))
        gents_kpis = self.client.get(
            self.analytics_url, self.analytics_range()
        ).data["kpis"]
        self.assertEqual(gents_kpis["total_sets"], 5)
        self.assertEqual(gents_kpis["total_pieces"], 15)
        self.assertEqual(gents_kpis["total_value"], 7500.0)

        self.client.credentials(**get_auth_header(kids_admin))
        kids_kpis = self.client.get(
            self.analytics_url, self.analytics_range()
        ).data["kpis"]
        self.assertEqual(kids_kpis["total_sets"], 2)
        self.assertEqual(kids_kpis["total_pieces"], 6)
        self.assertEqual(kids_kpis["total_value"], 1800.0)

        self.client.credentials(**get_auth_header(super_user))
        all_kpis = self.client.get(
            self.analytics_url, self.analytics_range()
        ).data["kpis"]
        self.assertEqual(all_kpis["total_sets"], 7)
        self.assertEqual(all_kpis["total_pieces"], 21)
        self.assertEqual(all_kpis["total_value"], 9300.0)

    def test_snapshot_fields_ignore_item_changes(self):
        self._item(self.order, quantity=7)

        self.item.price = 999.00
        self.item.is_deleted = True
        self.item.save()

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.analytics_url, self.analytics_range())

        kpis = response.data["kpis"]
        self.assertEqual(kpis["total_sets"], 7)
        self.assertEqual(kpis["total_pieces"], 21)
        self.assertEqual(kpis["total_value"], 10500.0)

    def test_empty_range_returns_zero_totals_not_null(self):
        self._item(self.order, quantity=7)

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(
            self.analytics_url, {"from": "2020-01-01", "to": "2020-01-02"}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        kpis = response.data["kpis"]
        self.assertEqual(kpis["total"], 0)
        self.assertEqual(kpis["total_sets"], 0)
        self.assertEqual(kpis["total_pieces"], 0)
        self.assertEqual(kpis["total_value"], 0.0)
        self.assertIsNotNone(kpis["total_value"])

    def test_total_value_matches_invoice_totals(self):
        self._item(self.order, quantity=7)
        self._item(self.order, quantity=3)
        other = self._placed_order(status="DISPATCHED")
        self._item(other, quantity=2, price=400.00, size_group="S,M,L,XL")

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self.analytics_url, self.analytics_range())

        invoice_total = 0.0
        for order_id in (self.order.id, other.id):
            invoice_response = self.client.get(
                f"/api/orders/{order_id}/invoice/"
            )
            self.assertEqual(invoice_response.status_code, status.HTTP_200_OK)
            invoice_total += invoice_response.data["total_price"]

        self.assertEqual(response.data["kpis"]["total_value"], invoice_total)
        self.assertEqual(invoice_total, 10 * 500 * 3 + 2 * 400 * 4)


class AdminDraftRetrieveTests(DraftTestBase):
    """A freshly created admin draft must be immediately retrievable.

    Regression: the admin business-type filter joined ``items__item_type``,
    which excluded item-less drafts and made the retrieve 404.
    """

    def _make_admin(self, username, business="", superuser=False):
        if superuser:
            return User.objects.create_superuser(
                username=username,
                email=f"{username}@test.com",
                password="pass1234",
            )
        return User.objects.create_user(
            username=username,
            email=f"{username}@test.com",
            password="pass1234",
            role="ADMIN",
            business=business,
            brand=self.brand,
        )

    def _create_draft(self, admin):
        self.client.credentials(**get_auth_header(admin))
        response = self.client.post(
            self.orders_url,
            {
                "customer": self.customer.id,
                "status": "DRAFT",
                "agent": self.agent.id,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return response.data["id"]

    def test_admin_can_retrieve_own_fresh_draft_for_every_admin_type(self):
        admins = {
            "superuser": self._make_admin("superadmin", superuser=True),
            "gents": self._make_admin("gentsadmin", business="gents"),
            "kids": self._make_admin("kidsadmin", business="kids"),
            "no_business": self._make_admin("plainadmin", business=""),
        }

        for label, admin in admins.items():
            with self.subTest(admin=label):
                draft_id = self._create_draft(admin)
                response = self.client.get(f"/api/orders/{draft_id}/")
                self.assertEqual(
                    response.status_code,
                    status.HTTP_200_OK,
                    msg=f"{label} retrieve failed: {response.status_code} {response.data}",
                )
                self.assertEqual(response.data["id"], draft_id)

    def test_fresh_admin_draft_survives_list_call(self):
        admin = self._make_admin("gentslistadmin", business="gents")
        draft_id = self._create_draft(admin)

        list_response = self.client.get(self.orders_url)
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)

        retrieve = self.client.get(f"/api/orders/{draft_id}/")
        self.assertEqual(retrieve.status_code, status.HTTP_200_OK)
        self.assertTrue(Order.objects.filter(id=draft_id, status="DRAFT").exists())


class AdminDraftEndToEndTests(DraftTestBase):
    """Admin creates a draft, adds items, places it, stock drops, agent sees it."""

    def _stock(self, variant, size="M,L,XL"):
        return ItemVariantSize.objects.get(item_variant=variant, size=size).stock

    def test_admin_draft_full_flow(self):
        variant2 = ItemVariant.objects.create(item=self.item, display_order="102")
        ItemVariantSize.objects.create(
            item_variant=self.variant, size="M,L,XL", stock=100
        )
        ItemVariantSize.objects.create(
            item_variant=variant2, size="M,L,XL", stock=100
        )

        self.client.credentials(**get_auth_header(self.admin_user))

        create = self.client.post(
            self.orders_url,
            {
                "customer": self.customer.id,
                "status": "DRAFT",
                "agent": self.agent.id,
            },
            format="json",
        )
        self.assertEqual(create.status_code, status.HTTP_201_CREATED)
        order_id = create.data["id"]

        self.assertEqual(
            self.client.get(f"/api/orders/{order_id}/").status_code,
            status.HTTP_200_OK,
        )

        for variant, qty in ((self.variant, 3), (variant2, 4)):
            add = self.client.post(
                f"/api/orders/{order_id}/add-item/",
                {
                    "qr_code": str(variant.qr_code),
                    "quantity": qty,
                    "size_group": "M,L,XL",
                },
                format="json",
            )
            self.assertEqual(add.status_code, status.HTTP_201_CREATED)

        place = self.client.post(
            f"/api/orders/{order_id}/place-order/", {}, format="json"
        )
        self.assertEqual(place.status_code, status.HTTP_200_OK)

        order = Order.objects.get(id=order_id)
        self.assertEqual(order.status, "PENDING")
        self.assertEqual(self._stock(self.variant), 97)
        self.assertEqual(self._stock(variant2), 96)

        # The order shows up in the customer's agent's history.
        self.client.credentials(**get_auth_header(self.agent_user))
        agent_list = self.client.get(self.orders_url)
        self.assertEqual(agent_list.status_code, status.HTTP_200_OK)
        payload = agent_list.data
        rows = payload["results"] if isinstance(payload, dict) else payload
        self.assertIn(order_id, [row["id"] for row in rows])


class NotifyFailureResilienceTests(DraftTestBase):
    """A broker outage must never change the HTTP response or business state."""

    def _broker_down(self):
        patcher = mock.patch("apps.notification.utils.send_push_to_user")
        task = patcher.start()
        task.apply_async.side_effect = OperationalError("Connection refused")
        self.addCleanup(patcher.stop)
        return task

    def _stock(self):
        return ItemVariantSize.objects.get(
            item_variant=self.variant, size="M,L,XL"
        ).stock

    def test_admin_place_order_succeeds_when_notify_raises(self):
        draft = self.make_draft(created_by=self.admin_user, agent=self.agent)
        ItemVariantSize.objects.create(
            item_variant=self.variant, size="M,L,XL", stock=10
        )
        self.make_order_item(draft, quantity=4)

        self._broker_down()
        self.client.credentials(**get_auth_header(self.admin_user))
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                f"/api/orders/{draft.id}/place-order/", {}, format="json"
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        draft.refresh_from_db()
        self.assertEqual(draft.status, "PENDING")
        self.assertEqual(self._stock(), 6)

    def test_agent_place_order_succeeds_when_notify_raises(self):
        draft = self.make_draft(created_by=self.agent_user)
        ItemVariantSize.objects.create(
            item_variant=self.variant, size="M,L,XL", stock=10
        )
        self.make_order_item(draft, quantity=4)

        self._broker_down()
        self.client.credentials(**get_auth_header(self.agent_user))
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                f"/api/orders/{draft.id}/place-order/", {}, format="json"
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        draft.refresh_from_db()
        self.assertEqual(draft.status, "PENDING")
        self.assertEqual(self._stock(), 6)

    def test_out_of_stock_400_preserved_when_notify_raises(self):
        draft = self.make_draft(created_by=self.agent_user)
        ItemVariantSize.objects.create(
            item_variant=self.variant, size="M,L,XL", stock=1
        )
        self.make_order_item(draft, quantity=4)

        self._broker_down()
        self.client.credentials(**get_auth_header(self.agent_user))
        response = self.client.post(
            f"/api/orders/{draft.id}/place-order/", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(response.data["out_of_stock_items"])
        draft.refresh_from_db()
        self.assertEqual(draft.status, "DRAFT")
        self.assertEqual(self._stock(), 1)

    def test_dispatch_succeeds_when_notify_raises(self):
        self.make_order_item(self.order, quantity=2)

        self._broker_down()
        self.client.credentials(**get_auth_header(self.admin_user))
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                f"/api/orders/{self.order.id}/dispatch/", {}, format="json"
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "DISPATCHED")


class StockDepletionNotifyTests(DraftTestBase):
    """Placing an order that drains a size to 0 must notify admins."""

    def _capture_queued(self):
        patchers = [
            mock.patch("apps.notification.utils.send_push_to_user"),
            mock.patch("apps.notification.utils.send_fcm_to_user"),
        ]
        mocks = [p.start() for p in patchers]
        for m in mocks:
            self.addCleanup(m.stop)
        return mocks

    def test_place_order_hits_zero_notifies_admins(self):
        draft = self.make_draft(created_by=self.agent_user)
        ItemVariantSize.objects.create(
            item_variant=self.variant, size="M,L,XL", stock=4
        )
        self.make_order_item(draft, quantity=4)

        web, fcm = self._capture_queued()
        self.client.credentials(**get_auth_header(self.agent_user))
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                f"/api/orders/{draft.id}/place-order/", {}, format="json"
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        draft.refresh_from_db()
        self.assertEqual(draft.status, "PENDING")

        titles = []
        for call in web.apply_async.call_args_list:
            args = call.kwargs["args"]
            titles.append(args[1])
        fcm_titles = [
            call.kwargs["args"][1]
            for call in fcm.apply_async.call_args_list
        ]
        self.assertIn("Item Out of Stock", titles)
        self.assertIn("Item Out of Stock", fcm_titles)

    def test_place_order_not_to_zero_no_stock_alert(self):
        draft = self.make_draft(created_by=self.agent_user)
        ItemVariantSize.objects.create(
            item_variant=self.variant, size="M,L,XL", stock=10
        )
        self.make_order_item(draft, quantity=4)

        web, _ = self._capture_queued()
        self.client.credentials(**get_auth_header(self.agent_user))
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                f"/api/orders/{draft.id}/place-order/", {}, format="json"
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = [
            call.kwargs["args"][1]
            for call in web.apply_async.call_args_list
        ]
        self.assertNotIn("Item Out of Stock", titles)

    def test_new_order_notify_includes_customer_amount_and_order_id(self):
        draft = self.make_draft(created_by=self.agent_user)
        ItemVariantSize.objects.create(
            item_variant=self.variant, size="M,L,XL", stock=10
        )
        self.make_order_item(draft, quantity=2)

        web, fcm = self._capture_queued()
        self.client.credentials(**get_auth_header(self.agent_user))
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                f"/api/orders/{draft.id}/place-order/", {}, format="json"
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        draft.refresh_from_db()
        self.assertEqual(draft.status, "PENDING")

        new_order_web = [
            call
            for call in web.apply_async.call_args_list
            if call.kwargs["args"][1] == "New Order"
        ]
        self.assertTrue(new_order_web)
        body = new_order_web[0].kwargs["args"][2]
        self.assertIn("ABC Fashions", body)
        self.assertIn("₹", body)
        self.assertEqual(
            new_order_web[0].kwargs["kwargs"]["data"]["order_id"],
            str(draft.id),
        )

        new_order_fcm = [
            call
            for call in fcm.apply_async.call_args_list
            if call.kwargs["args"][1] == "New Order"
        ]
        self.assertTrue(new_order_fcm)
        self.assertEqual(
            new_order_fcm[0].kwargs["kwargs"]["data"]["order_id"],
            str(draft.id),
        )

    def test_pre_exhausted_other_size_row_does_not_alert(self):
        draft = self.make_draft(created_by=self.agent_user)
        ItemVariantSize.objects.create(
            item_variant=self.variant, size="M,L,XL", stock=10
        )
        ItemVariantSize.objects.create(
            item_variant=self.variant, size="S", stock=0
        )
        self.make_order_item(draft, quantity=4)

        web, _ = self._capture_queued()
        self.client.credentials(**get_auth_header(self.agent_user))
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                f"/api/orders/{draft.id}/place-order/", {}, format="json"
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = [
            call.kwargs["args"][1]
            for call in web.apply_async.call_args_list
        ]
        self.assertNotIn("Item Out of Stock", titles)
