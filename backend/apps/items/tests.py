import os
import shutil
import tempfile
from datetime import timedelta
from io import BytesIO, StringIO
from unittest.mock import patch

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.agents.models import Agent
from apps.business.models import Brand
from apps.customers.models import Customer
from apps.items.models import Item, ItemVariant, ItemVariantSize
from apps.items.services import (
    delete_item_keep_history,
    purge_archived_items,
    touch_catalog,
)
from apps.items.tasks import purge_archived_items_task
from apps.items.views import get_agent_reservation_boost
from apps.orders.models import Order, OrderItem

User = get_user_model()

URL = "/api/items/customer-requirements/"


def get_auth_header(user):
    refresh = RefreshToken.for_user(user)
    return {"HTTP_AUTHORIZATION": f"Bearer {refresh.access_token}"}


def _make_order_item(**kwargs):
    defaults = {
        "quantity": 20,
        "packed_quantity": 0,
        "item_name": "Classic Shirt",
        "item_price": 500.00,
        "size_group": "M,L,XL",
        "item_type": "gents",
    }
    defaults.update(kwargs)
    return OrderItem.objects.create(**defaults)


class CustomerRequirementsAPITestBase(TestCase):
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

        self.customer1 = Customer.objects.create(
            name="ABC Fashions", contact="2222222222", agent=self.agent
        )

        self.customer2 = Customer.objects.create(
            name="XYZ Garments", contact="3333333333", agent=self.agent
        )

        self.item = Item.objects.create(
            name="Classic Shirt",
            price=500.00,
            type="gents",
            brand=self.brand,
        )

        self.variant1 = ItemVariant.objects.create(
            item=self.item, display_order="101"
        )
        self.variant2 = ItemVariant.objects.create(
            item=self.item, display_order="104"
        )

        self.order1 = Order.objects.create(
            customer=self.customer1, agent=self.agent, status="PENDING"
        )
        self.order2 = Order.objects.create(
            customer=self.customer2, agent=self.agent, status="PENDING"
        )
        self.order3 = Order.objects.create(
            customer=self.customer1, agent=self.agent, status="PENDING"
        )

    def _url(self, order_item_id):
        return f"{URL}?item_id={order_item_id}"


class CustomerRequirementsSuccessTests(CustomerRequirementsAPITestBase):
    def test_returns_pending_order_items(self):
        oi1 = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1, quantity=20
        )
        _make_order_item(
            order=self.order2, item=self.item, variant=self.variant2, quantity=30
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self._url(oi1.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["item"]["id"], self.item.id)
        self.assertEqual(response.data["item"]["name"], "Classic Shirt")
        self.assertEqual(len(response.data["customers"]), 2)

    def test_excludes_packed_order_items(self):
        oi1 = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1,
            quantity=20, packed_quantity=0,
        )
        _make_order_item(
            order=self.order2, item=self.item, variant=self.variant2,
            quantity=30, packed_quantity=10,
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self._url(oi1.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["customers"]), 1)
        self.assertEqual(response.data["customers"][0]["customer_name"], "ABC Fashions")

    def test_fully_packed_returns_empty_customers(self):
        oi1 = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1,
            quantity=20, packed_quantity=20,
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self._url(oi1.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["item"]["id"], self.item.id)
        self.assertEqual(response.data["customers"], [])

    def test_multiple_customers_same_item(self):
        oi1 = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1, quantity=20
        )
        _make_order_item(
            order=self.order2, item=self.item, variant=self.variant2, quantity=30
        )
        _make_order_item(
            order=self.order3, item=self.item, variant=self.variant1, quantity=25
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self._url(oi1.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["customers"]), 3)

        customer_names = [c["customer_name"] for c in response.data["customers"]]
        self.assertIn("ABC Fashions", customer_names)
        self.assertIn("XYZ Garments", customer_names)

    def test_correct_customer_name(self):
        oi1 = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1, quantity=20
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self._url(oi1.id))

        self.assertEqual(response.data["customers"][0]["customer_name"], "ABC Fashions")

    def test_correct_variant_display_order(self):
        oi1 = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1, quantity=20
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self._url(oi1.id))

        self.assertEqual(response.data["customers"][0]["variant_display_order"], "101")

    def test_correct_quantity(self):
        oi1 = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1, quantity=45
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self._url(oi1.id))

        self.assertEqual(response.data["customers"][0]["quantity"], 45)
        self.assertIn("variant_image", response.data["customers"][0])
        self.assertEqual(response.data["customers"][0]["size_group"], "M,L,XL")

    def test_only_packed_order_item_still_returns_others(self):
        oi1 = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1,
            quantity=20, packed_quantity=20,
        )
        _make_order_item(
            order=self.order2, item=self.item, variant=self.variant2,
            quantity=30, packed_quantity=0,
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self._url(oi1.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["customers"]), 1)
        self.assertEqual(response.data["customers"][0]["quantity"], 30)

    def test_invalid_order_item_id(self):
        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self._url(99999))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data["detail"], "OrderItem not found.")

    def test_missing_item_id_param(self):
        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(URL)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data["detail"], "item_id query parameter is required."
        )

    def test_deleted_item_returns_not_found(self):
        oi1 = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1, quantity=20
        )
        self.item.is_deleted = True
        self.item.save()

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self._url(oi1.id))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data["detail"], "Item not found.")


class CustomerRequirementsIsolationTests(CustomerRequirementsAPITestBase):
    def test_admin_sees_only_own_business_items(self):
        kids_item = Item.objects.create(
            name="Kids Shirt", price=300.00, type="kids", brand=self.brand
        )
        variant_kids = ItemVariant.objects.create(
            item=kids_item, display_order="201"
        )
        order_kids = Order.objects.create(
            customer=self.customer1, agent=self.agent, status="PENDING"
        )
        kids_oi = _make_order_item(
            order=order_kids, item=kids_item, variant=variant_kids,
            quantity=10, item_name="Kids Shirt", item_price=300.00,
            size_group="20-36", item_type="kids",
        )

        gents_oi = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1, quantity=20
        )

        self.client.credentials(**get_auth_header(self.admin_user))

        response = self.client.get(self._url(kids_oi.id))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        response = self.client.get(self._url(gents_oi.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["customers"]), 1)

    def test_other_admin_with_different_business_cannot_access(self):
        oi1 = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1, quantity=20
        )

        kids_admin = User.objects.create_user(
            username="admin3",
            email="admin3@test.com",
            password="pass1234",
            role="ADMIN",
            business="kids",
            brand=self.brand,
        )

        self.client.credentials(**get_auth_header(kids_admin))
        response = self.client.get(self._url(oi1.id))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_agent_can_access(self):
        oi1 = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1, quantity=20
        )

        self.client.credentials(**get_auth_header(self.agent_user))
        response = self.client.get(self._url(oi1.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["customers"]), 1)

    def test_unauthenticated_request_rejected(self):
        oi1 = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1, quantity=20
        )

        response = self.client.get(self._url(oi1.id))

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_mixed_packed_and_unpacked_across_orders(self):
        oi1 = _make_order_item(
            order=self.order1, item=self.item, variant=self.variant1, quantity=20
        )
        _make_order_item(
            order=self.order2, item=self.item, variant=self.variant2,
            quantity=30, packed_quantity=15,
        )
        _make_order_item(
            order=self.order3, item=self.item, variant=self.variant1, quantity=25
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(self._url(oi1.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["customers"]), 2)

        customer_names = [c["customer_name"] for c in response.data["customers"]]
        self.assertIn("ABC Fashions", customer_names)
        self.assertNotIn("XYZ Garments", customer_names)


class AdminDraftItemLookupTests(CustomerRequirementsAPITestBase):
    """Admin lookups for building an admin-created DRAFT.

    The admin has no ``user.agent`` and no item assignments, so these endpoints
    must not assume either, and the draft-reservation accounting must key on
    ``order_id``. ``get_agent_reservation_boost`` must stay a no-op for admins.
    """

    def setUp(self):
        super().setUp()
        self.by_qr_url = "/api/items/by-qr/"
        self.out_of_stock_url = "/api/items/by-qr/out-of-stock/"

        ItemVariantSize.objects.create(
            item_variant=self.variant1, size="M,L,XL", stock=10
        )
        ItemVariantSize.objects.create(
            item_variant=self.variant1, size="S", stock=10
        )
        ItemVariantSize.objects.create(
            item_variant=self.variant1, size="XXL", stock=10
        )

        self.draft = Order.objects.create(
            customer=self.customer1,
            agent=self.agent,
            status="DRAFT",
            created_by=self.admin_user,
        )

    def test_admin_by_qr_without_agent_id_succeeds(self):
        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(
            self.by_qr_url, {"qr_code": str(self.variant1.qr_code)}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["matched_variant_id"], self.variant1.id)

    def test_admin_by_qr_not_restricted_by_assignment(self):
        self.assertFalse(
            self.agent.assigned_items.filter(variant=self.variant1).exists()
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(
            self.by_qr_url, {"qr_code": str(self.variant1.qr_code)}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_admin_out_of_stock_keys_on_order_id(self):
        _make_order_item(
            order=self.draft,
            item=self.item,
            variant=self.variant1,
            quantity=4,
            size_group="M,L,XL",
        )

        self.client.credentials(**get_auth_header(self.admin_user))

        without_draft = self.client.get(
            self.out_of_stock_url, {"qr_code": str(self.variant1.qr_code)}
        )
        with_draft = self.client.get(
            self.out_of_stock_url,
            {"qr_code": str(self.variant1.qr_code), "order_id": self.draft.id},
        )

        self.assertEqual(without_draft.status_code, status.HTTP_200_OK)
        self.assertEqual(with_draft.status_code, status.HTTP_200_OK)
        self.assertEqual(without_draft.data["group_stock"]["M,L,XL"], 10)
        self.assertEqual(with_draft.data["group_stock"]["M,L,XL"], 6)

    def test_reservation_boost_is_empty_for_admin(self):
        self.assertEqual(get_agent_reservation_boost(self.admin_user), {})


class ArchivedItemPurgeTests(TestCase):
    """Rules for the scheduled archived-item purge."""

    def setUp(self):
        self.brand = Brand.objects.create(
            name="Purge Brand",
            phone="9988776655",
            email="purge@test.com",
            address_line1="1 St",
        )
        self.agent = Agent.objects.create(
            user=User.objects.create_user(
                username="purge_agent", password="pass1234"
            ),
            contact="9988776655",
        )
        self.customer = Customer.objects.create(
            name="Purge Customer", contact="9988776655", agent=self.agent
        )

    def _item(self, name="Purge Item", days_out=61, stock=0, size="M,L,XL"):
        item = Item.objects.create(
            name=name,
            price=100.00,
            type="gents",
            brand=self.brand,
            out_of_stock_since=timezone.now() - timedelta(days=days_out),
        )
        variant = ItemVariant.objects.create(item=item)
        ItemVariantSize.objects.create(
            item_variant=variant, size=size, stock=stock
        )
        return item, variant

    def _order(self, status):
        return Order.objects.create(
            customer=self.customer, agent=self.agent, status=status
        )

    def _order_item(self, order, item, variant, quantity=5):
        return OrderItem.objects.create(
            order=order,
            item=item,
            variant=variant,
            quantity=quantity,
            item_name=item.name,
            item_price=item.price,
            size_group="M,L,XL",
            item_type="gents",
        )

    def _save_image(self, variant, name):
        buf = BytesIO()
        Image.new("RGB", (8, 8), (0, 120, 255)).save(buf, "PNG")
        variant.image.save(name, ContentFile(buf.getvalue()), save=True)
        return variant.image.path

    def test_59_days_out_not_purged(self):
        item, _v = self._item(days_out=59)
        result = purge_archived_items()
        self.assertEqual(result.deleted, 0)
        item.refresh_from_db()
        self.assertFalse(item.is_deleted)

    def test_61_days_out_purged(self):
        item, _v = self._item(days_out=61)
        result = purge_archived_items()
        self.assertEqual(result.deleted, 1)
        item.refresh_from_db()
        self.assertTrue(item.is_deleted)

    def test_restocked_item_not_purged(self):
        # Restock via save() triggers the signal and clears out_of_stock_since.
        item, variant = self._item(days_out=61)
        size = variant.sizes.get()
        size.stock = 10
        size.save()
        item.refresh_from_db()
        self.assertIsNone(item.out_of_stock_since)
        result = purge_archived_items()
        self.assertEqual(result.deleted, 0)
        item.refresh_from_db()
        self.assertFalse(item.is_deleted)

    def test_restock_between_selection_and_delete_skipped(self):
        # Queryset updates bypass save signals, leaving a stale
        # out_of_stock_since; the in-transaction re-check must still protect it.
        item, variant = self._item(days_out=61)
        ItemVariantSize.objects.filter(item_variant=variant).update(stock=10)
        result = purge_archived_items()
        self.assertEqual(result.deleted, 0)
        self.assertEqual(result.skipped_restocked, 1)
        item.refresh_from_db()
        self.assertFalse(item.is_deleted)

    def test_open_orders_skip_until_dispatched(self):
        for current_status in ("DRAFT", "PENDING", "EDITING", "PACKED"):
            with self.subTest(status=current_status):
                item, variant = self._item(
                    name=f"Item {current_status}", days_out=61
                )
                order = self._order(current_status)
                self._order_item(order, item, variant)

                result = purge_archived_items()
                item.refresh_from_db()
                self.assertFalse(item.is_deleted)
                self.assertEqual(result.skipped_open_orders, 1)

                order.status = "DISPATCHED"
                order.dispatched_at = timezone.now()
                order.save()

                result = purge_archived_items()
                item.refresh_from_db()
                self.assertTrue(item.is_deleted)
                self.assertEqual(result.deleted, 1)

    def test_orders_and_snapshots_unchanged_after_purge(self):
        item, variant = self._item(days_out=61)
        order = self._order("DISPATCHED")
        order_item = self._order_item(order, item, variant, quantity=7)
        order_item.item_name = "Snap Name"
        order_item.item_price = 250.00
        order_item.variant_image = (
            "http://example.com/media/items/1/snap.png"
        )
        order_item.save()

        result = purge_archived_items()
        self.assertEqual(result.deleted, 1)

        order.refresh_from_db()
        order_item.refresh_from_db()
        self.assertEqual(order.status, "DISPATCHED")
        self.assertEqual(order_item.item_name, "Snap Name")
        self.assertEqual(float(order_item.item_price), 250.0)
        self.assertEqual(
            order_item.variant_image, "http://example.com/media/items/1/snap.png"
        )
        self.assertEqual(order.items.count(), 1)
        self.assertEqual(OrderItem.objects.count(), 1)
        self.assertEqual(order.logs.count(), 0)

    def test_images_kept_when_referenced_and_removed_when_orphaned(self):
        item, variant = self._item(name="Referenced", days_out=61)
        order = self._order("DISPATCHED")
        self._order_item(order, item, variant)
        referenced_path = self._save_image(variant, "referenced.png")
        self.assertTrue(os.path.exists(referenced_path))

        result = purge_archived_items()
        item.refresh_from_db()
        self.assertTrue(item.is_deleted)
        self.assertTrue(os.path.exists(referenced_path))

        item2, variant2 = self._item(name="Unreferenced", days_out=61)
        stray_path = self._save_image(variant2, "stray.png")
        self.assertTrue(os.path.exists(stray_path))

        result = purge_archived_items()
        item2.refresh_from_db()
        self.assertTrue(item2.is_deleted)
        self.assertFalse(os.path.exists(stray_path))

    def test_dry_run_changes_nothing_and_second_run_deletes_nothing(self):
        for i in range(3):
            self._item(name=f"Dry {i}", days_out=61)

        out = StringIO()
        call_command("purge_archived_items", dry_run=True, stdout=out)
        output = out.getvalue()
        self.assertIn("WOULD DELETE", output)
        self.assertEqual(Item.objects.filter(is_deleted=True).count(), 0)

        result = purge_archived_items()
        self.assertEqual(result.deleted, 3)

        result = purge_archived_items()
        self.assertEqual(result.deleted, 0)
        self.assertEqual(Item.objects.filter(is_deleted=True).count(), 3)

    def test_limit_respected(self):
        for i in range(3):
            self._item(name=f"Limit {i}", days_out=61)

        result = purge_archived_items(limit=2)
        self.assertEqual(result.deleted, 2)

        result = purge_archived_items(limit=2)
        self.assertEqual(result.deleted, 1)
        self.assertEqual(Item.objects.filter(is_deleted=True).count(), 3)

    def test_one_failing_item_does_not_block_rest(self):
        for i in range(3):
            self._item(name=f"Fail {i}", days_out=61)

        from apps.items import services as items_services

        real = items_services.delete_item_keep_history
        calls = {"n": 0}

        def flaky(item):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("boom")
            return real(item)

        with patch(
            "apps.items.services.delete_item_keep_history", side_effect=flaky
        ):
            result = purge_archived_items()

        self.assertEqual(result.failed, 1)
        self.assertEqual(result.deleted, 2)
        self.assertEqual(Item.objects.filter(is_deleted=True).count(), 2)

    def test_celery_task_kill_switch_off_does_nothing(self):
        item, _v = self._item(days_out=61)
        with override_settings(ARCHIVED_ITEM_PURGE_ENABLED=False):
            purge_archived_items_task()
        item.refresh_from_db()
        self.assertFalse(item.is_deleted)

    def test_celery_task_purges_when_enabled(self):
        item, _v = self._item(days_out=61)
        purge_archived_items_task()
        item.refresh_from_db()
        self.assertTrue(item.is_deleted)

    def test_beat_schedule_has_purge_entry(self):
        entry = settings.CELERY_BEAT_SCHEDULE["purge-archived-items-daily"]
        self.assertEqual(entry["task"], "apps.items.tasks.purge_archived_items_task")


class ArchivedItemsAPITests(TestCase):
    """/api/items/archived/ fields and post-purge visibility."""

    def setUp(self):
        self.client = APIClient()
        self.brand = Brand.objects.create(
            name="Test Brand",
            phone="1234567890",
            email="brand@test.com",
            address_line1="123 St",
        )
        self.admin_user = User.objects.create_user(
            username="archives_admin",
            email="a@test.com",
            password="pass1234",
            role="ADMIN",
            business="gents",
            brand=self.brand,
        )
        self.agent = Agent.objects.create(
            user=User.objects.create_user(
                username="archives_agent", password="pass1234"
            ),
            contact="1111111111",
        )
        self.customer = Customer.objects.create(
            name="Cust", contact="1111111111", agent=self.agent
        )
        self.client.credentials(**get_auth_header(self.admin_user))

    def _archived_item(self, days_out=31):
        item = Item.objects.create(
            name=f"Arch {days_out}",
            price=100.00,
            type="gents",
            brand=self.brand,
            out_of_stock_since=timezone.now() - timedelta(days=days_out),
        )
        variant = ItemVariant.objects.create(item=item)
        ItemVariantSize.objects.create(
            item_variant=variant, size="M,L,XL", stock=0
        )
        return item, variant

    def test_archived_endpoint_includes_purge_fields(self):
        item, _v = self._archived_item(days_out=31)
        response = self.client.get("/api/items/archived/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        entry = response.data[0]
        self.assertEqual(entry["id"], item.id)
        self.assertIn("purge_on", entry)
        self.assertIn("days_until_purge", entry)
        self.assertTrue(entry["purge_on"])
        self.assertIsInstance(entry["days_until_purge"], int)
        self.assertGreaterEqual(entry["days_until_purge"], 0)
        self.assertLessEqual(entry["days_until_purge"], 30)

    def test_non_archived_items_return_null_purge_fields(self):
        item = Item.objects.create(
            name="Fresh", price=100.00, type="gents", brand=self.brand
        )
        ItemVariant.objects.create(item=item)
        response = self.client.get("/api/items/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        entry = next(e for e in response.data if e["id"] == item.id)
        self.assertIsNone(entry["purge_on"])
        self.assertIsNone(entry["days_until_purge"])

    def test_archived_endpoint_excludes_purged(self):
        self._archived_item(days_out=61)
        purge_archived_items()
        response = self.client.get("/api/items/archived/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_purged_item_qr_is_invalid(self):
        _item, variant = self._archived_item(days_out=61)
        purge_archived_items()
        response = self.client.get(
            "/api/items/by-qr/", {"qr_code": str(variant.qr_code)}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"], "Invalid QR code")


class OrderSnapshotAfterPurgeAPITests(TestCase):
    """Order detail/invoice/logs keep working with snapshot data after purge."""

    def setUp(self):
        self.client = APIClient()
        self.brand = Brand.objects.create(
            name="Test Brand",
            phone="1234567890",
            email="brand@test.com",
            address_line1="123 St",
        )
        self.admin_user = User.objects.create_user(
            username="snapshot_admin",
            email="s@test.com",
            password="pass1234",
            role="ADMIN",
            business="gents",
            brand=self.brand,
        )
        self.agent = Agent.objects.create(
            user=User.objects.create_user(
                username="snapshot_agent", password="pass1234"
            ),
            contact="1111111111",
        )
        self.customer = Customer.objects.create(
            name="Snap Customer", contact="1111111111", agent=self.agent
        )
        self.client.credentials(**get_auth_header(self.admin_user))

    def setUp_archived_item_with_dispatch_order(self):
        item = Item.objects.create(
            name="Snapshot Shirt",
            price=450.00,
            type="gents",
            brand=self.brand,
            out_of_stock_since=timezone.now() - timedelta(days=61),
        )
        variant = ItemVariant.objects.create(item=item)
        ItemVariantSize.objects.create(
            item_variant=variant, size="M,L,XL", stock=0
        )
        order = Order.objects.create(
            customer=self.customer,
            agent=self.agent,
            status="DISPATCHED",
            dispatched_at=timezone.now(),
        )
        OrderItem.objects.create(
            order=order,
            item=item,
            variant=variant,
            quantity=3,
            item_name="Snapshot Shirt",
            item_price=450.00,
            variant_image="http://testserver/media/items/1/snap.png",
            size_group="M,L,XL",
            item_type="gents",
        )
        purge_archived_items()
        return item, order

    def test_order_detail_returns_snapshot_after_purge(self):
        _item, order = self.setUp_archived_item_with_dispatch_order()
        response = self.client.get(f"/api/orders/{order.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        entry = response.data["items"][0]
        self.assertEqual(entry["item_name"], "Snapshot Shirt")
        self.assertEqual(entry["item_price"], "450.00")
        self.assertEqual(
            entry["variant_image"], "http://testserver/media/items/1/snap.png"
        )

    def test_invoice_returns_snapshot_after_purge(self):
        _item, order = self.setUp_archived_item_with_dispatch_order()
        response = self.client.get(f"/api/orders/{order.id}/invoice/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        entry = response.data["items"][0]
        self.assertEqual(entry["item_name"], "Snapshot Shirt")
        self.assertEqual(entry["item_price"], "450.00")

    def test_logs_endpoint_after_purge(self):
        _item, order = self.setUp_archived_item_with_dispatch_order()
        response = self.client.get(f"/api/orders/{order.id}/logs/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class ManualDeleteRegressionTests(TestCase):
    """`DELETE /api/items/{id}/` (PIN) must behave exactly as before."""

    def setUp(self):
        self.client = APIClient()
        self.brand = Brand.objects.create(
            name="Test Brand",
            phone="1234567890",
            email="brand@test.com",
            address_line1="123 St",
        )
        self.admin_user = User.objects.create_user(
            username="pin_admin",
            email="p@test.com",
            password="pass1234",
            role="ADMIN",
            business="gents",
            brand=self.brand,
        )
        self.admin_user.set_pin("1234")
        self.admin_user.save()
        self.client.credentials(**get_auth_header(self.admin_user))

    def _save_image(self, variant, name):
        buf = BytesIO()
        Image.new("RGB", (8, 8), (255, 0, 0)).save(buf, "PNG")
        variant.image.save(name, ContentFile(buf.getvalue()), save=True)
        return variant.image.path

    def test_manual_delete_soft_deletes_and_removes_unreferenced_image(self):
        item = Item.objects.create(
            name="Del Me", price=100.00, type="gents", brand=self.brand
        )
        variant = ItemVariant.objects.create(item=item)
        ItemVariantSize.objects.create(
            item_variant=variant, size="M,L,XL", stock=5
        )
        image_path = self._save_image(variant, "manual.png")
        self.assertTrue(os.path.exists(image_path))

        response = self.client.delete(
            f"/api/items/{item.id}/", data={"pin": "1234"}
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        item.refresh_from_db()
        self.assertTrue(item.is_deleted)
        self.assertFalse(os.path.exists(image_path))

        # Purged/deleted items are gone from every listing.
        archived = self.client.get("/api/items/archived/")
        self.assertEqual(archived.status_code, status.HTTP_200_OK)
        self.assertEqual(archived.data, [])
        by_qr = self.client.get(
            "/api/items/by-qr/", {"qr_code": str(variant.qr_code)}
        )
        self.assertEqual(by_qr.status_code, status.HTTP_400_BAD_REQUEST)


SYNC_URL = "/api/items/sync/"


class ItemSyncAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.brand = Brand.objects.create(
            name="Sync Brand",
            phone="0987654321",
            email="sync@test.com",
            address_line1="999 St",
        )
        self.admin_user = User.objects.create_user(
            username="syncadmin",
            email="syncadmin@test.com",
            password="pass1234",
            role="ADMIN",
            business="kids",
            brand=self.brand,
        )
        self.client.credentials(**get_auth_header(self.admin_user))

        self.item = Item.objects.create(
            name="Sync Item", price=250.00, type="kids", brand=self.brand
        )
        self.variant = ItemVariant.objects.create(item=self.item, display_order="1")
        self.size_s = ItemVariantSize.objects.create(
            item_variant=self.variant, size="20-24", stock=5
        )
        self.size_m = ItemVariantSize.objects.create(
            item_variant=self.variant, size="26-30", stock=7
        )

        self.hidden_item = Item.objects.create(
            name="Out of Scope", price=300.00, type="gents", brand=self.brand
        )

        self.since = timezone.now()

    def _sync(self, **params):
        url = "{}?{}".format(
            SYNC_URL,
            "&".join(f"{k}={v}" for k, v in params.items()),
        )
        return self.client.get(url)

    def _cursor_url(self, cursor):
        from urllib.parse import quote
        return f"{SYNC_URL}?since={quote(cursor)}"

    def test_full_bootstrap_shape_and_check(self):
        resp = self._sync()
        self.assertEqual(resp.status_code, 200)
        data = resp.data
        self.assertEqual(data["mode"], "full")
        self.assertEqual(data["archive_after_days"], settings.ARCHIVE_AFTER_DAYS)
        self.assertEqual(data["next_page"], None)
        self.assertEqual(data["stock"], [])
        self.assertEqual(data["removed_item_ids"], [])
        # Business scoping keeps only kids items + the admin's own scope.
        ids = sorted(i["id"] for i in data["items"])
        self.assertEqual(ids, [self.item.id])
        self.assertEqual(data["check"]["items"], 1)
        self.assertEqual(data["check"]["total_stock"], 12)

        entry = data["items"][0]
        self.assertEqual(entry["name"], "Sync Item")
        self.assertEqual(entry["type"], "kids")
        self.assertEqual(entry["price"], "250.00")
        self.assertIn("rev", entry)
        self.assertIsNone(entry["out_of_stock_since"])
        self.assertTrue(entry["thumb"] is None or entry["thumb"].startswith("http"))
        variant = entry["variants"][0]
        self.assertEqual(variant["id"], self.variant.id)
        sizes = {s["size"]: s["stock"] for s in variant["sizes"]}
        self.assertEqual(sizes, {"20-24": 5, "26-30": 7})

        # Cursor must be a parseable, timezone-aware ISO timestamp.
        from django.utils.dateparse import parse_datetime
        self.assertIsNotNone(parse_datetime(data["cursor"]))

    def test_full_pagination(self):
        Item.objects.create(
            name="Extra A", price=100.00, type="kids", brand=self.brand
        )
        Item.objects.create(
            name="Extra B", price=120.00, type="kids", brand=self.brand
        )
        resp = self._sync(page=1, page_size=1)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["items"]), 1)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["next_page"], 2)
        self.assertEqual(resp.data["check"]["items"], 3)

        page2 = self._sync(page=2, page_size=1)
        self.assertEqual(page2.status_code, 200)
        self.assertEqual(len(page2.data["items"]), 1)
        self.assertEqual(page2.data["next_page"], 3)

        page3 = self._sync(page=3, page_size=1)
        self.assertEqual(page3.status_code, 200)
        self.assertEqual(len(page3.data["items"]), 1)
        self.assertIsNone(page3.data["next_page"])

    def test_delta_stock_row_change(self):
        before = self._sync().data["cursor"]
        new_size = ItemVariantSize.objects.create(
            item_variant=self.variant, size="32-36", stock=9
        )
        resp = self.client.get(self._cursor_url(before))
        self.assertEqual(resp.status_code, 200)
        data = resp.data
        self.assertEqual(data["mode"], "delta")
        self.assertEqual(
            data["stock"],
            [
                {
                    "id": new_size.id,
                    "size": "32-36",
                    "stock": 9,
                }
            ],
        )
        self.assertEqual(data["items"], [])
        self.assertEqual(data["removed_item_ids"], [])

    def test_delta_catalog_change(self):
        resp = self._sync()
        self.assertEqual(resp.status_code, 200)
        before = resp.data["cursor"]

        self.item.name = "Renamed Sync Item"
        self.item.save()
        touch_catalog(self.item)

        resp = self.client.get(self._cursor_url(before))
        self.assertEqual(resp.status_code, 200)
        data = resp.data
        self.assertEqual(data["mode"], "delta")
        self.assertEqual(len(data["items"]), 1)
        self.assertEqual(data["items"][0]["name"], "Renamed Sync Item")
        self.item.refresh_from_db()
        self.assertEqual(data["items"][0]["rev"], self.item.catalog_updated_at.isoformat())
        self.assertEqual(data["stock"], [])
        self.assertEqual(data["removed_item_ids"], [])

    def test_delta_removed_ids_on_soft_delete(self):
        resp = self._sync()
        self.assertEqual(resp.status_code, 200)
        before = resp.data["cursor"]

        delete_item_keep_history(self.item)

        resp = self.client.get(self._cursor_url(before))
        self.assertEqual(resp.status_code, 200)
        data = resp.data
        self.assertEqual(data["mode"], "delta")
        self.assertEqual(data["items"], [])
        self.assertEqual(data["removed_item_ids"], [self.item.id])

    def test_out_of_window_since_forces_full(self):
        url = f"{SYNC_URL}?since=2020-01-01T00%3A00%3A00%2B00%3A00"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["mode"], "full")

    def test_too_many_deltas_forces_full(self):
        before = self._sync().data["cursor"]
        for i in range(3):
            ItemVariantSize.objects.create(
                item_variant=self.variant,
                size=["32-36", "38", "S"][i],
                stock=i + 1,
            )
        with override_settings(ITEM_SYNC_MAX_DELTA_ITEMS=2):
            resp = self.client.get(self._cursor_url(before))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["mode"], "full")

    def test_agent_forbidden(self):
        agent_user = User.objects.create_user(
            username="syncagent",
            email="syncagent@test.com",
            password="pass1234",
            role="AGENT",
        )
        client = APIClient()
        client.credentials(**get_auth_header(agent_user))
        resp = client.get(SYNC_URL)
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_item_edit_with_unchanged_stock_produces_no_stock_delta(self):
        before = self._sync().data["cursor"]
        payload = {
            "name": "Edited but same stock",
            "description": "plain text description",
            "price": "250.00",
            "type": "kids",
            "variants": [
                {
                    "id": self.variant.id,
                    "display_order": self.variant.display_order,
                    "sizes": [
                        {"size": "20-24", "stock": 5},
                        {"size": "26-30", "stock": 7},
                    ],
                }
            ],
        }
        resp = self.client.put(
            f"/api/items/{self.item.id}/", payload, format="json"
        )
        self.assertEqual(resp.status_code, 200)

        sync_resp = self.client.get(self._cursor_url(before))
        data = sync_resp.data
        self.assertEqual(data["mode"], "delta")
        self.assertEqual(data["stock"], [])
        self.assertEqual(len(data["items"]), 1)
        self.assertEqual(data["items"][0]["name"], "Edited but same stock")


def _image_bytes(fmt="JPEG", size=(80, 60)):
    buffer = BytesIO()
    Image.new("RGB", size, (10, 120, 200)).save(buffer, format=fmt)
    return buffer.getvalue()


class ItemEditMatrixAPITests(TestCase):
    """Covers every edit action the web/mobile clients send to PUT /items/{id}/.

    Regression focus: an explicit ``display_order: null`` (what both clients send
    when the field is cleared) used to 400 with "This field may not be null."
    """

    def setUp(self):
        self.client = APIClient()
        self.brand = Brand.objects.create(
            name="Edit Brand",
            phone="1112223333",
            email="edit@test.com",
            address_line1="1 Edit St",
        )
        self.admin_user = User.objects.create_user(
            username="editadmin",
            email="editadmin@test.com",
            password="pass1234",
            role="ADMIN",
            business="kids",
            brand=self.brand,
        )
        self.client.credentials(**get_auth_header(self.admin_user))

        self.item = Item.objects.create(
            name="Edit Item", price=250.00, type="kids", brand=self.brand
        )
        self.variant = ItemVariant.objects.create(item=self.item, display_order="1")
        self.size_a = ItemVariantSize.objects.create(
            item_variant=self.variant, size="20-24", stock=5
        )
        self.size_b = ItemVariantSize.objects.create(
            item_variant=self.variant, size="26-30", stock=7
        )

        self._media = tempfile.mkdtemp(prefix="items-edit-media-")
        self.addCleanup(shutil.rmtree, self._media, True)
        self._media_override = override_settings(MEDIA_ROOT=self._media)
        self._media_override.enable()
        self.addCleanup(self._media_override.disable)

    # ── helpers ──────────────────────────────────────────────────────────────
    def _url(self):
        return f"/api/items/{self.item.id}/"

    def _variant_payload(self, **overrides):
        payload = {
            "id": self.variant.id,
            "display_order": "1",
            "sizes": [
                {"size": "20-24", "stock": 5},
                {"size": "26-30", "stock": 7},
            ],
        }
        payload.update(overrides)
        return payload

    def _put(self, variants, **item_fields):
        payload = {
            "name": "Edit Item",
            "price": "250.00",
            "type": "kids",
            "variants": variants,
        }
        payload.update(item_fields)
        return self.client.put(self._url(), payload, format="json")

    def _multipart_put(self, variants, **item_fields):
        data = {
            "name": "Edit Item",
            "description": "",
            "price": "250.00",
            "type": "kids",
        }
        data.update(item_fields)
        for i, variant in enumerate(variants):
            if "id" in variant:
                data[f"variants[{i}]id"] = str(variant["id"])
            if variant.get("display_order") is not None:
                data[f"variants[{i}]display_order"] = str(variant["display_order"])
            if variant.get("remove_image"):
                data[f"variants[{i}]remove_image"] = "true"
            if variant.get("image") is not None:
                data[f"variants[{i}]image"] = variant["image"]
            for j, size in enumerate(variant.get("sizes", [])):
                data[f"variants[{i}]sizes[{j}]size"] = size["size"]
                data[f"variants[{i}]sizes[{j}]stock"] = str(size["stock"])
        return self.client.put(self._url(), data, format="multipart")

    def _sync_cursor(self):
        return self.client.get(SYNC_URL).data["cursor"]

    def _sync_delta(self, cursor):
        from urllib.parse import quote

        return self.client.get(f"{SYNC_URL}?since={quote(cursor)}")

    def _upload(self, name="variant.jpg", fmt="JPEG", size=(80, 60)):
        content_type = "image/jpeg" if fmt == "JPEG" else "image/png"
        return SimpleUploadedFile(name, _image_bytes(fmt, size), content_type=content_type)

    # ── BUG 2 regression: display_order null ─────────────────────────────────
    def test_edit_explicit_null_display_order_clears_field(self):
        resp = self._put([self._variant_payload(display_order=None)])
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.variant.refresh_from_db()
        self.assertIsNone(self.variant.display_order)

    def test_edit_legacy_null_display_order_row_is_editable(self):
        # Items created before migration 0009 have NULL display_order.
        self.variant.display_order = None
        self.variant.save(update_fields=["display_order"])

        resp = self._put([self._variant_payload(display_order=None)])
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.variant.refresh_from_db()
        self.assertIsNone(self.variant.display_order)

    def test_edit_blank_display_order_clears_field(self):
        resp = self._put([self._variant_payload(display_order="")])
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.variant.refresh_from_db()
        self.assertIsNone(self.variant.display_order)

    def test_edit_display_order_value_persists(self):
        resp = self._put([self._variant_payload(display_order="7")])
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.display_order, "7")

    # ── common fields ────────────────────────────────────────────────────────
    def test_edit_name_and_price_persist(self):
        resp = self._put(
            [self._variant_payload()], name="Renamed", price="399.50"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.item.refresh_from_db()
        self.assertEqual(self.item.name, "Renamed")
        self.assertEqual(str(self.item.price), "399.50")

    # ── variant add / remove ─────────────────────────────────────────────────
    def test_edit_add_variant_creates_variant_and_sizes(self):
        variants = [
            self._variant_payload(),
            {"display_order": "2", "sizes": [{"size": "32-36", "stock": 3}]},
        ]
        resp = self._put(variants)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(self.item.variants.count(), 2)
        created = self.item.variants.exclude(id=self.variant.id).get()
        self.assertEqual(created.display_order, "2")
        self.assertEqual(
            {s.size: s.stock for s in created.sizes.all()}, {"32-36": 3}
        )

    def test_edit_delete_variant_omitted_from_payload(self):
        extra = ItemVariant.objects.create(item=self.item, display_order="2")
        ItemVariantSize.objects.create(item_variant=extra, size="38", stock=1)

        resp = self._put([self._variant_payload()])
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(ItemVariant.objects.filter(id=extra.id).exists())
        self.assertEqual(self.item.variants.count(), 1)

    def test_edit_remove_variant_image(self):
        self.variant.image.save(
            "seed.jpg", ContentFile(_image_bytes()), save=True
        )
        stored_name = self.variant.image.name
        self.assertTrue(
            os.path.exists(os.path.join(settings.MEDIA_ROOT, stored_name))
        )

        resp = self._put([self._variant_payload(remove_image=True)])
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.variant.refresh_from_db()
        self.assertFalse(bool(self.variant.image))
        self.assertFalse(
            os.path.exists(os.path.join(settings.MEDIA_ROOT, stored_name))
        )

    # ── images ───────────────────────────────────────────────────────────────
    def test_edit_multipart_add_variant_with_image(self):
        variants = [
            self._variant_payload(),
            {
                "display_order": "2",
                "sizes": [{"size": "32-36", "stock": 4}],
                "image": self._upload("new.jpg", size=(2000, 1500)),
            },
        ]
        resp = self._multipart_put(variants)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        created = self.item.variants.exclude(id=self.variant.id).get()
        self.assertTrue(bool(created.image))
        with Image.open(created.image.path) as stored:
            self.assertLessEqual(max(stored.size), 1024)

    def test_edit_multipart_replaces_variant_image(self):
        self.variant.image.save(
            "seed.jpg", ContentFile(_image_bytes()), save=True
        )
        old_name = self.variant.image.name

        resp = self._multipart_put(
            [self._variant_payload(image=self._upload("replacement.png", "PNG"))]
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.variant.refresh_from_db()
        self.assertNotEqual(self.variant.image.name, old_name)
        self.assertFalse(
            os.path.exists(os.path.join(settings.MEDIA_ROOT, old_name))
        )

    # ── stock deltas ─────────────────────────────────────────────────────────
    def test_edit_change_stock_produces_stock_delta(self):
        cursor = self._sync_cursor()
        payload = self._variant_payload(
            sizes=[
                {"size": "20-24", "stock": 5},
                {"size": "26-30", "stock": 99},
            ]
        )
        resp = self._put([payload])
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        data = self._sync_delta(cursor).data
        self.assertEqual(data["mode"], "delta")
        self.size_b.refresh_from_db()
        self.assertEqual(self.size_b.stock, 99)
        rows = {row["id"]: row["stock"] for row in data["stock"]}
        self.assertEqual(rows.get(self.size_b.id), 99)
        self.assertNotIn(self.size_a.id, rows)

    def test_edit_add_size_produces_stock_delta(self):
        cursor = self._sync_cursor()
        payload = self._variant_payload(
            sizes=[
                {"size": "20-24", "stock": 5},
                {"size": "26-30", "stock": 7},
                {"size": "32-36", "stock": 11},
            ]
        )
        resp = self._put([payload])
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        data = self._sync_delta(cursor).data
        added = self.variant.sizes.get(size="32-36")
        rows = {row["id"]: row["stock"] for row in data["stock"]}
        self.assertEqual(rows.get(added.id), 11)

    def test_edit_catalog_change_bumps_rev(self):
        before = self.item.catalog_updated_at
        resp = self._put([self._variant_payload()], name="Catalog Changed")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.item.refresh_from_db()
        self.assertGreater(self.item.catalog_updated_at, before)

        entry = self.client.get(SYNC_URL).data["items"][0]
        self.assertEqual(entry["rev"], self.item.catalog_updated_at.isoformat())


class ItemCreateMultipartAPITests(TestCase):
    """The exact flat bracket-key multipart payload the web form builds."""

    def setUp(self):
        self.client = APIClient()
        self.brand = Brand.objects.create(
            name="Create Brand",
            phone="4445556666",
            email="create@test.com",
            address_line1="2 Create St",
        )
        self.admin_user = User.objects.create_user(
            username="createadmin",
            email="createadmin@test.com",
            password="pass1234",
            role="ADMIN",
            business="kids",
            brand=self.brand,
        )
        self.client.credentials(**get_auth_header(self.admin_user))

        self._media = tempfile.mkdtemp(prefix="items-create-media-")
        self.addCleanup(shutil.rmtree, self._media, True)
        self._media_override = override_settings(MEDIA_ROOT=self._media)
        self._media_override.enable()
        self.addCleanup(self._media_override.disable)

    def _upload(self, name="photo.jpg", size=(2200, 1600)):
        return SimpleUploadedFile(
            name, _image_bytes("JPEG", size), content_type="image/jpeg"
        )

    def test_web_style_multipart_create_with_two_variants_and_images(self):
        data = {
            "name": "Web Created",
            "description": "from the web wizard",
            "price": "499.99",
            "type": "kids",
            "variants[0]display_order": "1",
            "variants[0]image": self._upload("one.jpg"),
            "variants[0]sizes[0]size": "20-24",
            "variants[0]sizes[0]stock": "5",
            "variants[0]sizes[1]size": "26-30",
            "variants[0]sizes[1]stock": "6",
            "variants[1]display_order": "2",
            "variants[1]image": self._upload("two.jpg"),
            "variants[1]sizes[0]size": "32-36",
            "variants[1]sizes[0]stock": "7",
        }
        resp = self.client.post("/api/items/", data, format="multipart")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

        item = Item.objects.get(name="Web Created")
        self.assertEqual(item.variants.count(), 2)
        for variant in item.variants.all():
            self.assertTrue(bool(variant.image))
            with Image.open(variant.image.path) as stored:
                self.assertLessEqual(max(stored.size), 1024)
                self.assertGreater(min(stored.size), 0)
