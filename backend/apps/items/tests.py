"""Items (fabric catalogue) tests: requirements, archive/purge, sync, stock.

The domain is metres of cloth, so every fixture here is a ``Fabric`` with
colour ``FabricVariant``s holding ``stock_meters``. Order placement records
demand only -- cloth leaves the warehouse on a confirmed packing round -- so
these tests lean on ``outstanding_demand`` rather than reserved stock.
"""

from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.agents.models import Agent
from apps.customers.models import Customer
from apps.items.models import Fabric, FabricVariant
from apps.items.services import (
    delete_fabric_keep_history,
    purge_archived_fabrics,
    sync_out_of_stock,
)
from apps.items.tasks import purge_archived_fabrics_task
from apps.orders.models import Order, OrderItem

User = get_user_model()

REQUIREMENTS_URL = "/api/items/customer-requirements/"
SYNC_URL = "/api/items/sync/"


def get_auth_header(user):
    refresh = RefreshToken.for_user(user)
    return {"HTTP_AUTHORIZATION": f"Bearer {refresh.access_token}"}


def make_image(name="swatch.png", size=(8, 8), color="red"):
    buffer = BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.read(), content_type="image/png")


class FabricTestBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin_user = User.objects.create_user(
            username="admin1",
            email="admin1@test.com",
            password="pass1234",
            role="ADMIN",
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
        self.fabric = Fabric.objects.create(
            name="Cotton Cambric 140 GSM",
            description="Plain weave",
            price_per_meter=Decimal("9.00"),
        )
        self.variant1 = FabricVariant.objects.create(
            fabric=self.fabric, display_order="Natural", stock_meters=Decimal("3000")
        )
        self.variant2 = FabricVariant.objects.create(
            fabric=self.fabric, display_order="White", stock_meters=Decimal("1500")
        )

    def make_order(self, customer, status="PENDING"):
        return Order.objects.create(
            customer=customer, agent=self.agent, status=status
        )

    def make_line(self, order, ordered, allocated=Decimal("0"), variant=None):
        variant = variant or self.variant1
        return OrderItem.objects.create(
            order=order,
            fabric=self.fabric,
            variant=variant,
            fabric_name=self.fabric.name,
            rate_per_meter=self.fabric.price_per_meter,
            variant_display_order=variant.display_order,
            ordered_quantity=Decimal(ordered),
            allocated_quantity=Decimal(allocated),
        )

    def auth(self, user=None):
        self.client.credentials(**get_auth_header(user or self.admin_user))


class CustomerRequirementsTests(FabricTestBase):
    def test_lists_open_lines_grouped_per_customer(self):
        o1 = self.make_order(self.customer1)
        o2 = self.make_order(self.customer2)
        self.make_line(o1, 1400)
        self.make_line(o2, 800)

        self.auth()
        resp = self.client.get(REQUIREMENTS_URL, {"fabric_id": self.fabric.pk})

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["fabric"]["id"], self.fabric.id)
        self.assertEqual(len(resp.data["customers"]), 2)
        self.assertEqual(
            {c["customer_name"] for c in resp.data["customers"]},
            {"ABC Fashions", "XYZ Garments"},
        )

    def test_outstanding_is_ordered_minus_allocated(self):
        order = self.make_order(self.customer1)
        self.make_line(order, 1400, allocated=400)

        self.auth()
        resp = self.client.get(REQUIREMENTS_URL, {"fabric_id": self.fabric.pk})

        row = resp.data["customers"][0]
        self.assertEqual(Decimal(row["outstanding_quantity"]), Decimal("1000.000"))

    def test_fully_allocated_lines_are_excluded(self):
        order = self.make_order(self.customer1)
        self.make_line(order, 1000, allocated=1000)

        self.auth()
        resp = self.client.get(REQUIREMENTS_URL, {"fabric_id": self.fabric.pk})

        self.assertEqual(resp.data["customers"], [])

    def test_dispatched_orders_are_excluded(self):
        order = self.make_order(self.customer1, status="DISPATCHED")
        self.make_line(order, 1000)

        self.auth()
        resp = self.client.get(REQUIREMENTS_URL, {"fabric_id": self.fabric.pk})

        self.assertEqual(resp.data["customers"], [])

    def test_oversubscribed_demand_is_still_reported(self):
        """Two 1400 m lines against 3000 m on hand must both show up."""
        o1 = self.make_order(self.customer1)
        o2 = self.make_order(self.customer2)
        self.make_line(o1, 1400)
        self.make_line(o2, 1400)

        self.auth()
        resp = self.client.get(REQUIREMENTS_URL, {"fabric_id": self.fabric.pk})

        self.assertEqual(len(resp.data["customers"]), 2)
        total = sum(
            Decimal(c["outstanding_quantity"]) for c in resp.data["customers"]
        )
        self.assertEqual(total, Decimal("2800.000"))

    def test_missing_fabric_id_is_400(self):
        self.auth()
        resp = self.client.get(REQUIREMENTS_URL)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unknown_fabric_is_404(self):
        self.auth()
        resp = self.client.get(REQUIREMENTS_URL, {"fabric_id": 999999})
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_deleted_fabric_is_404(self):
        self.fabric.is_deleted = True
        self.fabric.save(update_fields=["is_deleted"])

        self.auth()
        resp = self.client.get(REQUIREMENTS_URL, {"fabric_id": self.fabric.pk})
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_requires_authentication(self):
        self.client.credentials()
        resp = self.client.get(REQUIREMENTS_URL, {"fabric_id": self.fabric.pk})
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


class OutstandingDemandTests(FabricTestBase):
    URL = "/api/items/outstanding-demand/"

    def test_aggregates_open_demand_for_a_variant(self):
        o1 = self.make_order(self.customer1)
        o2 = self.make_order(self.customer2)
        self.make_line(o1, 1400)
        self.make_line(o2, 1400, allocated=400)

        self.auth()
        resp = self.client.get(self.URL, {"variant": self.variant1.pk})

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        row = resp.data[0]
        self.assertEqual(row["variant"], self.variant1.pk)
        self.assertEqual(row["fabric_id"], self.fabric.pk)
        self.assertEqual(Decimal(row["outstanding_meters"]), Decimal("2400.000"))
        self.assertEqual(Decimal(row["stock_meters"]), Decimal("3000.000"))
        self.assertFalse(row["is_backordered"])

    def test_flags_a_variant_whose_demand_exceeds_stock(self):
        o1 = self.make_order(self.customer1)
        self.make_line(o1, 4000)

        self.auth()
        resp = self.client.get(self.URL, {"variant": self.variant1.pk})
        self.assertTrue(resp.data[0]["is_backordered"])


class StockAccountingTests(FabricTestBase):
    def test_out_of_stock_since_set_when_every_variant_empties(self):
        sync_out_of_stock(self.fabric)
        self.fabric.refresh_from_db()
        self.assertIsNone(self.fabric.out_of_stock_since)

        FabricVariant.objects.filter(fabric=self.fabric).update(
            stock_meters=Decimal("0")
        )
        sync_out_of_stock(self.fabric)

        self.fabric.refresh_from_db()
        self.assertIsNotNone(self.fabric.out_of_stock_since)

    def test_out_of_stock_since_clears_when_stock_returns(self):
        FabricVariant.objects.filter(fabric=self.fabric).update(
            stock_meters=Decimal("0")
        )
        sync_out_of_stock(self.fabric)
        self.fabric.refresh_from_db()
        self.assertIsNotNone(self.fabric.out_of_stock_since)

        FabricVariant.objects.filter(fabric=self.fabric).update(
            stock_meters=Decimal("10")
        )
        sync_out_of_stock(self.fabric)

        self.fabric.refresh_from_db()
        self.assertIsNone(self.fabric.out_of_stock_since)

    def test_one_live_variant_keeps_the_fabric_active(self):
        FabricVariant.objects.filter(pk=self.variant1.pk).update(
            stock_meters=Decimal("0")
        )
        sync_out_of_stock(self.fabric)

        self.fabric.refresh_from_db()
        self.assertIsNone(
            self.fabric.out_of_stock_since, "variant2 still has 1500 m on hand"
        )


class ArchiveAndPurgeTests(FabricTestBase):
    def _archive(self, fabric, days=45, empty=True):
        if empty:
            FabricVariant.objects.filter(fabric=fabric).update(
                stock_meters=Decimal("0")
            )
        fabric.out_of_stock_since = timezone.now() - timedelta(days=days)
        fabric.save(update_fields=["out_of_stock_since"])
        fabric.refresh_from_db()

    def test_soft_delete_keeps_history_and_frees_the_image(self):
        order = self.make_order(self.customer1, status="DISPATCHED")
        self.make_line(order, 1000, allocated=1000)
        self._archive(self.fabric)

        delete_fabric_keep_history(self.fabric)

        self.fabric.refresh_from_db()
        self.assertTrue(self.fabric.is_deleted)
        self.assertEqual(OrderItem.objects.filter(fabric=self.fabric).count(), 1)

    def test_open_orders_block_purge(self):
        order = self.make_order(self.customer1, status="PENDING")
        self.make_line(order, 1000)
        self._archive(self.fabric)

        result = purge_archived_fabrics(dry_run=True)

        self.assertEqual(result.deleted, 0)
        self.assertTrue(Fabric.objects.filter(pk=self.fabric.pk).exists())

    def test_dispatched_only_fabric_is_purged(self):
        order = self.make_order(self.customer1, status="DISPATCHED")
        self.make_line(order, 1000, allocated=1000)
        self._archive(self.fabric, days=90)

        result = purge_archived_fabrics(dry_run=True)
        self.assertEqual(result.deleted, 1)

        purge_archived_fabrics()
        fabric = Fabric.objects.get(pk=self.fabric.pk)
        self.assertTrue(fabric.is_deleted, "purge is a soft delete")
        self.assertFalse(
            Fabric.objects.filter(pk=self.fabric.pk, is_deleted=False).exists()
        )
        self.assertEqual(
            OrderItem.objects.filter(fabric_name=self.fabric.name).count(), 1
        )

    def test_restocked_fabric_is_left_alone(self):
        self._archive(self.fabric, days=90, empty=False)
        result = purge_archived_fabrics(dry_run=True)
        self.assertEqual(result.deleted, 0)
        self.assertEqual(result.skipped_restocked, 1)

    def test_archived_but_inside_retention_is_left_alone(self):
        """Archived past 30 days but inside the 30-day retention window."""
        self._archive(self.fabric, days=45)
        result = purge_archived_fabrics(dry_run=True)
        self.assertEqual(result.deleted, 0)
        self.assertTrue(Fabric.objects.filter(pk=self.fabric.pk).exists())

    def test_dry_run_changes_nothing(self):
        order = self.make_order(self.customer1, status="DISPATCHED")
        self.make_line(order, 1000, allocated=1000)
        self._archive(self.fabric, days=90)

        purge_archived_fabrics(dry_run=True)
        self.assertTrue(Fabric.objects.filter(pk=self.fabric.pk).exists())

    def test_task_delegates_to_the_service(self):
        with patch("apps.items.tasks.purge_archived_fabrics") as service:
            purge_archived_fabrics_task()
        service.assert_called_once()


class ArchiveAPITests(FabricTestBase):
    URL = "/api/items/archived/"

    def _archive(self, fabric):
        FabricVariant.objects.filter(fabric=fabric).update(stock_meters=Decimal("0"))
        fabric.out_of_stock_since = timezone.now() - timedelta(days=45)
        fabric.save(update_fields=["out_of_stock_since"])

    def test_archived_endpoint_hides_active_fabrics(self):
        self.auth()
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertNotIn(self.fabric.name, [f.get("name") for f in resp.data])

    def test_archived_endpoint_lists_long_out_of_stock(self):
        self._archive(self.fabric)
        self.auth()
        resp = self.client.get(self.URL)
        self.assertIn(self.fabric.name, [f.get("name") for f in resp.data])

    def test_recently_empty_fabric_is_not_yet_archived(self):
        FabricVariant.objects.filter(fabric=self.fabric).update(
            stock_meters=Decimal("0")
        )
        sync_out_of_stock(self.fabric)
        self.fabric.refresh_from_db()

        self.auth()
        resp = self.client.get(self.URL)
        self.assertNotIn(self.fabric.name, [f.get("name") for f in resp.data])

    def test_soft_deleted_fabric_leaves_the_archived_list(self):
        self._archive(self.fabric)
        self.fabric.is_deleted = True
        self.fabric.save(update_fields=["is_deleted"])

        self.auth()
        resp = self.client.get(self.URL)
        self.assertNotIn(self.fabric.name, [f.get("name") for f in resp.data])


class FabricSyncTests(FabricTestBase):
    def test_full_sync_returns_fabrics_with_metre_stock(self):
        self.auth()
        resp = self.client.get(SYNC_URL, {"use_full": "true", "page": 1})

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        row = resp.data["fabrics"][0]
        self.assertEqual(row["id"], self.fabric.id)
        self.assertEqual(row["price_per_meter"], "9.00")
        self.assertEqual(len(row["variants"]), 2)
        self.assertEqual(
            Decimal(resp.data["check"]["total_stock_meters"]), Decimal("4500.000")
        )

    def test_full_sync_never_reports_removals(self):
        self.auth()
        resp = self.client.get(SYNC_URL)
        self.assertEqual(resp.data["mode"], "full")
        self.assertEqual(resp.data["removed_fabric_ids"], [])

    def test_delta_sync_excludes_untouched_fabrics(self):
        old = timezone.now() - timedelta(days=1)
        Fabric.objects.filter(pk=self.fabric.pk).update(catalog_updated_at=old)
        FabricVariant.objects.filter(fabric=self.fabric).update(
            stock_updated_at=old
        )

        since = (timezone.now() - timedelta(minutes=5)).isoformat()
        self.auth()
        resp = self.client.get(SYNC_URL, {"since": since})

        self.assertEqual(resp.data["mode"], "delta")
        self.assertEqual(resp.data["removed_fabric_ids"], [])
        self.assertEqual(resp.data["fabrics"], [])

    def test_soft_deleted_fabric_is_reported_removed(self):
        self.fabric.is_deleted = True
        self.fabric.save(update_fields=["is_deleted"])
        Fabric.objects.filter(pk=self.fabric.pk).update(
            catalog_updated_at=timezone.now()
        )

        since = (timezone.now() - timedelta(minutes=5)).isoformat()
        self.auth()
        resp = self.client.get(SYNC_URL, {"since": since})
        self.assertIn(self.fabric.pk, resp.data["removed_fabric_ids"])

    def test_stock_delta_reports_changed_variants(self):
        FabricVariant.objects.filter(pk=self.variant2.pk).update(
            stock_updated_at=timezone.now() - timedelta(days=1)
        )
        self.variant1.stock_meters = Decimal("3333")
        self.variant1.save(update_fields=["stock_meters", "stock_updated_at"])

        since = (timezone.now() - timedelta(minutes=5)).isoformat()
        self.auth()
        resp = self.client.get(SYNC_URL, {"since": since})
        self.assertEqual(resp.data["mode"], "delta")
        self.assertEqual(len(resp.data["stock"]), 1)
        self.assertEqual(resp.data["stock"][0]["variant_id"], self.variant1.pk)

    def test_sync_requires_admin(self):
        self.auth(self.agent_user)
        resp = self.client.get(SYNC_URL, {"page": 1})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class StockListTests(FabricTestBase):
    URL = "/api/items/stock-list/"

    def test_lists_fabrics_with_per_colour_metre_stock(self):
        self.auth()
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 1)
        variants = resp.data[0]["variants"]
        self.assertEqual(len(variants), 2)
        self.assertIn("stock_meters", variants[0])


class FabricWriteTests(FabricTestBase):
    def test_create_fabric_with_variants(self):
        self.auth()
        resp = self.client.post(
            "/api/items/",
            {
                "name": "Linen Blend 180 GSM",
                "description": "Suiting",
                "price_per_meter": "14.50",
                "variants": [
                    {"display_order": "Ivory", "stock_meters": "800"},
                    {"display_order": "Sage", "stock_meters": "400"},
                ],
            },
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        fabric = Fabric.objects.get(name="Linen Blend 180 GSM")
        self.assertEqual(fabric.variants.count(), 2)
        self.assertEqual(fabric.price_per_meter, Decimal("14.50"))

    def test_price_per_meter_must_be_positive(self):
        self.auth()
        resp = self.client.post(
            "/api/items/",
            {"name": "Bad", "price_per_meter": "0", "variants": []},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_web_style_multipart_create_with_two_variants(self):
        """The flat bracket-key payload the web form actually builds."""
        self.auth()
        resp = self.client.post(
            "/api/items/",
            {
                "name": "Denim 320 GSM",
                "description": "Rigid selvedge",
                "price_per_meter": "18.90",
                "variants[0]display_order": "Indigo",
                "variants[0]stock_meters": "1200",
                "variants[0]image": make_image("indigo.png", (2200, 1600)),
                "variants[1]display_order": "Ecru",
                "variants[1]stock_meters": "300",
            },
            format="multipart",
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        fabric = Fabric.objects.get(name="Denim 320 GSM")
        self.assertEqual(fabric.variants.count(), 2)

        indigo = fabric.variants.get(display_order="Indigo")
        self.assertEqual(indigo.stock_meters, Decimal("1200"))
        self.assertTrue(indigo.image)
        with Image.open(indigo.image.path) as stored:
            self.assertLessEqual(max(stored.size), 1024)

        ecru = fabric.variants.get(display_order="Ecru")
        self.assertFalse(ecru.image)

    def test_admin_can_edit_price(self):
        self.auth()
        resp = self.client.patch(
            f"/api/items/{self.fabric.pk}/",
            {"price_per_meter": "11.25"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.fabric.refresh_from_db()
        self.assertEqual(self.fabric.price_per_meter, Decimal("11.25"))

    def test_edit_can_set_stock_for_an_existing_colour(self):
        self.auth()
        resp = self.client.patch(
            f"/api/items/{self.fabric.pk}/",
            {
                "variants": [
                    {
                        "id": self.variant1.pk,
                        "display_order": "Natural",
                        "stock_meters": "7777",
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.variant1.refresh_from_db()
        self.assertEqual(self.variant1.stock_meters, Decimal("7777.000"))

    def test_edit_leaves_stock_untouched_when_the_key_is_absent(self):
        # A payload that does not mention stock must not rewrite the live count.
        self.auth()
        resp = self.client.patch(
            f"/api/items/{self.fabric.pk}/",
            {"variants": [{"id": self.variant1.pk, "display_order": "Natural"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.variant1.refresh_from_db()
        self.assertEqual(self.variant1.stock_meters, Decimal("3000.000"))

    def test_edit_stock_bumps_the_stock_cursor(self):
        # The sync feed only reports variants with a fresh stock_updated_at.
        FabricVariant.objects.filter(pk=self.variant1.pk).update(
            stock_updated_at=timezone.now() - timedelta(days=1)
        )
        self.auth()
        resp = self.client.patch(
            f"/api/items/{self.fabric.pk}/",
            {
                "variants": [
                    {
                        "id": self.variant1.pk,
                        "display_order": "Natural",
                        "stock_meters": "4000",
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.variant1.refresh_from_db()
        self.assertGreater(
            self.variant1.stock_updated_at, timezone.now() - timedelta(seconds=10)
        )

    def test_agent_cannot_create(self):
        self.auth(self.agent_user)
        resp = self.client.post(
            "/api/items/",
            {"name": "Nope", "price_per_meter": "5.00", "variants": []},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class FabricVariantWriteTests(FabricTestBase):
    def test_admin_can_restock_a_variant(self):
        self.auth()
        resp = self.client.patch(
            f"/api/items/variants/{self.variant1.pk}/",
            {"stock_meters": "4200"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.variant1.refresh_from_db()
        self.assertEqual(self.variant1.stock_meters, Decimal("4200.000"))

    def test_negative_stock_rejected(self):
        self.auth()
        resp = self.client.patch(
            f"/api/items/variants/{self.variant1.pk}/",
            {"stock_meters": "-5"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_all_variants_endpoint(self):
        self.auth()
        resp = self.client.get("/api/items/variants/all/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 2)
