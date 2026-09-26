"""Agent-facing tests: catalogue assignment, QR scanning, and delete guards."""

from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from kombu.exceptions import OperationalError
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.agents.models import Agent, AgentItem
from apps.customers.models import Customer
from apps.items.models import Fabric, FabricVariant
from apps.orders.models import Order

User = get_user_model()


def get_auth_header(user):
    refresh = RefreshToken.for_user(user)
    return {"HTTP_AUTHORIZATION": f"Bearer {refresh.access_token}"}


class AgentTestBase(TestCase):
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
        self.customer = Customer.objects.create(
            name="ABC Fashions", contact="2222222222", agent=self.agent
        )
        self.fabric = Fabric.objects.create(
            name="Cotton Cambric 140 GSM", price_per_meter=Decimal("9.00")
        )
        self.variant = FabricVariant.objects.create(
            fabric=self.fabric,
            display_order="Natural",
            stock_meters=Decimal("2500"),
        )


class AgentDeleteInfoTests(AgentTestBase):
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

    def test_delete_info_counts_customers(self):
        Customer.objects.create(name="Second Buyer", contact="3", agent=self.agent)

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(f"/api/agents/{self.agent.id}/delete_info/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["customers_count"], 2)


class AgentFabricAssignNotifyResilienceTests(AgentTestBase):
    def test_assignment_succeeds_when_notify_raises(self):
        """A dead push broker must not roll back a successful assignment."""
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


class AgentFabricAssignmentTests(AgentTestBase):
    def _assign(self, variant_ids, user=None):
        self.client.credentials(**get_auth_header(user or self.admin_user))
        return self.client.post(
            f"/api/agents/{self.agent.id}/items/",
            {"variant_ids": variant_ids},
            format="json",
        )

    def test_assign_adds_the_variant(self):
        response = self._assign([self.variant.id])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            AgentItem.objects.filter(
                agent=self.agent, variant=self.variant
            ).exists()
        )

    def test_assigning_twice_keeps_a_single_row(self):
        self._assign([self.variant.id])
        self._assign([self.variant.id])

        self.assertEqual(
            AgentItem.objects.filter(
                agent=self.agent, variant=self.variant
            ).count(),
            1,
        )

    def test_post_replaces_the_whole_assignment(self):
        other = FabricVariant.objects.create(
            fabric=self.fabric, display_order="White", stock_meters=Decimal("10")
        )
        self._assign([self.variant.id])
        self._assign([other.id])

        assigned = set(
            AgentItem.objects.filter(agent=self.agent).values_list(
                "variant_id", flat=True
            )
        )
        self.assertEqual(assigned, {other.id})

    def test_soft_deleted_fabric_is_not_assignable(self):
        self.fabric.is_deleted = True
        self.fabric.save(update_fields=["is_deleted"])

        response = self._assign([self.variant.id])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(AgentItem.objects.filter(agent=self.agent).exists())

    def test_unknown_variant_ids_are_ignored(self):
        response = self._assign([self.variant.id, 999_999])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            AgentItem.objects.filter(agent=self.agent).count(), 1
        )

    def test_non_list_variant_ids_rejected(self):
        response = self._assign(str(self.variant.id))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_agent_cannot_assign(self):
        response = self._assign([self.variant.id], user=self.agent_user)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_assigned_list_reports_metres(self):
        self._assign([self.variant.id])

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(f"/api/agents/{self.agent.id}/items/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        fabric_row = response.data[0]
        self.assertEqual(fabric_row["id"], self.fabric.id)
        variant_row = fabric_row["variants"][0]
        self.assertEqual(variant_row["id"], self.variant.id)
        self.assertEqual(Decimal(variant_row["stock_meters"]), Decimal("2500.000"))


class AgentQRFlowTests(AgentTestBase):
    """Scan QR -> by-qr resolves the variant -> assign -> verified in the DB."""

    def _scan(self, user, qr_value):
        return self.client.get(
            "/api/items/by-qr/", {"qr_code": qr_value}, **get_auth_header(user)
        )

    def test_scan_valid_qr_resolves_variant_and_admin_can_assign(self):
        resp = self._scan(self.admin_user, str(self.variant.qr_code))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["matched_variant_id"], self.variant.id)

        self.client.credentials(**get_auth_header(self.admin_user))
        assign = self.client.post(
            f"/api/agents/{self.agent.id}/items/",
            {"variant_ids": [resp.data["matched_variant_id"]]},
            format="json",
        )
        self.assertEqual(assign.status_code, status.HTTP_200_OK)
        self.assertTrue(
            AgentItem.objects.filter(
                agent=self.agent, variant=self.variant
            ).exists()
        )

    def test_invalid_random_qr_returns_error(self):
        resp = self._scan(self.admin_user, "not-a-real-qr-code")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_qr_param_returns_error_not_500(self):
        self.client.credentials(**get_auth_header(self.admin_user))
        resp = self.client.get("/api/items/by-qr/")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_qr_of_deleted_fabric_does_not_resolve(self):
        """A soft-deleted fabric must be invisible to the scanner."""
        self.fabric.is_deleted = True
        self.fabric.save(update_fields=["is_deleted"])

        resp = self._scan(self.admin_user, str(self.variant.qr_code))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertNotIn("matched_variant_id", resp.data)
