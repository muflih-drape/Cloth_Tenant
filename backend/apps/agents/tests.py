from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from kombu.exceptions import OperationalError
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.agents.models import Agent, AgentItem
from apps.business.models import Brand
from apps.customers.models import Customer
from apps.items.models import Item, ItemVariant, ItemVariantSize
from apps.orders.models import Order

User = get_user_model()


def get_auth_header(user):
    refresh = RefreshToken.for_user(user)
    return {"HTTP_AUTHORIZATION": f"Bearer {refresh.access_token}"}


class AgentDeleteInfoTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.admin_user = User.objects.create_user(
            username="admin1",
            email="admin1@test.com",
            password="pass1234",
            role="ADMIN",
            business="gents",
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

    def test_delete_info_orders_count_excludes_drafts(self):
        Order.objects.create(
            customer=self.customer, agent=self.agent, status="PENDING"
        )
        Order.objects.create(
            customer=self.customer, agent=self.agent, status="DRAFT"
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(f"/api/agents/{self.agent.id}/delete_info/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["orders_count"], 1)


class AgentItemAssignNotifyResilienceTests(TestCase):
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
        self.item = Item.objects.create(
            name="Classic Shirt", price=500.00, type="gents", brand=self.brand
        )
        self.variant = ItemVariant.objects.create(
            item=self.item, display_order="101"
        )

    def test_assignment_succeeds_when_notify_raises(self):
        with mock.patch("apps.notification.utils.send_push_to_user") as task:
            task.apply_async.side_effect = OperationalError("Connection refused")

            self.client.credentials(**get_auth_header(self.admin_user))
            response = self.client.post(
                f"/api/agents/{self.agent.id}/items/",
                {"variant_ids": [self.variant.id]},
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            AgentItem.objects.filter(
                agent=self.agent, variant=self.variant
            ).exists()
        )


class AgentItemAssignmentQRFlowTests(TestCase):
    """Scan QR -> by-qr resolves variant -> assign -> verified in DB.

    Mirrors the mobile Agent Item Assignment flow. The QR value is the uuid
    stored in ``ItemVariant.qr_code`` (what labels encode and scanners return).
    """

    def setUp(self):
        self.client = APIClient()

        self.brand = Brand.objects.create(
            name="QR Brand",
            phone="9998887776",
            email="qr@test.com",
            address_line1="7 QR St",
        )
        self.gents_admin = User.objects.create_user(
            username="qrgents",
            email="qrgents@test.com",
            password="pass1234",
            role="ADMIN",
            business="gents",
            brand=self.brand,
        )
        self.kids_admin = User.objects.create_user(
            username="qrkids",
            email="qrkids@test.com",
            password="pass1234",
            role="ADMIN",
            business="kids",
            brand=self.brand,
        )
        self.agent_user = User.objects.create_user(
            username="qragent", email="qragent@test.com", password="pass1234"
        )
        self.agent = Agent.objects.create(
            user=self.agent_user, contact="1111111111"
        )

        self.gents_item = Item.objects.create(
            name="Gents Shirt", price=500.00, type="gents", brand=self.brand
        )
        self.gents_variant = ItemVariant.objects.create(
            item=self.gents_item, display_order="1"
        )
        ItemVariantSize.objects.create(
            item_variant=self.gents_variant, size="M,L,XL", stock=5
        )

        self.kids_item = Item.objects.create(
            name="Kids Set", price=300.00, type="kids", brand=self.brand
        )
        self.kids_variant = ItemVariant.objects.create(
            item=self.kids_item, display_order="2"
        )
        ItemVariantSize.objects.create(
            item_variant=self.kids_variant, size="20-24", stock=4
        )

    def _scan(self, user, qr_value):
        return self.client.get(
            "/api/items/by-qr/", {"qr_code": qr_value}, **get_auth_header(user)
        )

    def _assign(self, user, agent_id, variant_ids):
        self.client.credentials(**get_auth_header(user))
        return self.client.post(
            f"/api/agents/{agent_id}/items/",
            {"variant_ids": variant_ids},
            format="json",
        )

    def test_scan_valid_qr_resolves_variant_and_admin_can_assign(self):
        resp = self._scan(
            self.gents_admin, str(self.gents_variant.qr_code)
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["matched_variant_id"], self.gents_variant.id)

        assign = self._assign(
            self.gents_admin, self.agent.id, [resp.data["matched_variant_id"]]
        )
        self.assertEqual(assign.status_code, status.HTTP_200_OK)
        self.assertTrue(
            AgentItem.objects.filter(
                agent=self.agent, variant=self.gents_variant
            ).exists()
        )

    def test_scan_again_already_assigned_keeps_single_row(self):
        self._assign(self.gents_admin, self.agent.id, [self.gents_variant.id])
        self._assign(self.gents_admin, self.agent.id, [self.gents_variant.id])

        self.assertEqual(
            AgentItem.objects.filter(
                agent=self.agent, variant=self.gents_variant
            ).count(),
            1,
        )

    def test_other_business_admin_cannot_assign_variant(self):
        # by-qr is business-scoped: the kids admin must not resolve the gents QR.
        hidden = self._scan(
            self.kids_admin, str(self.gents_variant.qr_code)
        )
        self.assertEqual(hidden.status_code, status.HTTP_404_NOT_FOUND)

        # The assignment endpoint must reject/ignore the out-of-scope variant.
        assign = self._assign(
            self.kids_admin, self.agent.id, [self.gents_variant.id]
        )
        self.assertEqual(assign.status_code, status.HTTP_200_OK)
        self.assertFalse(
            AgentItem.objects.filter(
                agent=self.agent, variant=self.gents_variant
            ).exists()
        )

    def test_cross_business_admin_assigns_own_variant_only(self):
        assign = self._assign(
            self.kids_admin,
            self.agent.id,
            [self.kids_variant.id, self.gents_variant.id],
        )
        self.assertEqual(assign.status_code, status.HTTP_200_OK)
        assigned = set(
            AgentItem.objects.filter(agent=self.agent).values_list(
                "variant_id", flat=True
            )
        )
        self.assertEqual(assigned, {self.kids_variant.id})

    def test_invalid_random_qr_returns_error(self):
        resp = self._scan(self.gents_admin, "not-a-real-qr-code")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_qr_param_returns_error_not_500(self):
        self.client.credentials(**get_auth_header(self.gents_admin))
        resp = self.client.get("/api/items/by-qr/")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
