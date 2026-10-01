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


class AgentDeleteTests(AgentTestBase):
    """Deleting an agent requires the calling admin's PIN for both paths.

    The PIN check runs before either the transfer or the deactivate action. The
    frontend sends it as a JSON body key ``pin`` on the DELETE request, which is
    exactly what ``check_admin_pin`` reads.
    """

    def setUp(self):
        super().setUp()
        self.admin_user.set_pin("123456")
        # set_pin writes only the in-memory attribute, so the hashed value has to
        # be saved for check_pin in the view to see it.
        self.admin_user.save(update_fields=["pin"])
        self.target_user = User.objects.create_user(
            username="agent2",
            email="agent2@test.com",
            password="pass1234",
            role="AGENT",
        )
        self.target_agent = Agent.objects.create(
            user=self.target_user, contact="3333333333"
        )

    def delete_agent(self, pin=None, action="deactivate", transfer_to_id=None):
        self.client.credentials(**get_auth_header(self.admin_user))
        payload = {}
        if pin is not None:
            payload["pin"] = pin
        payload["action"] = action
        if transfer_to_id is not None:
            payload["transfer_to_id"] = transfer_to_id
        return self.client.delete(
            f"/api/agents/{self.agent.pk}/", payload, format="json"
        )

    def test_missing_pin_is_rejected(self):
        resp = self.delete_agent(pin=None)

        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(resp.data["error"], "PIN is required to delete.")
        self.agent.refresh_from_db()
        self.assertTrue(self.agent.is_active)

    def test_wrong_pin_is_rejected(self):
        resp = self.delete_agent(pin="000000")

        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(resp.data["error"], "Incorrect PIN.")
        self.agent.refresh_from_db()
        self.assertTrue(self.agent.is_active)

    def test_deactivate_with_correct_pin_keeps_references(self):
        resp = self.delete_agent(pin="123456", action="deactivate")

        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

        self.agent.refresh_from_db()
        self.assertFalse(self.agent.is_active)
        self.assertIsNotNone(self.agent.deactivated_at)
        # The user account is deactivated, not removed, so history is intact.
        self.agent.user.refresh_from_db()
        self.assertFalse(self.agent.user.is_active)
        self.assertTrue(User.objects.filter(pk=self.agent.user_id).exists())
        self.assertTrue(
            Customer.objects.filter(pk=self.customer.pk, agent=self.agent).exists()
        )

    def test_transfer_with_correct_pin_moves_customers_and_deletes_agent(self):
        resp = self.delete_agent(
            pin="123456", action="transfer", transfer_to_id=self.target_agent.pk
        )

        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

        # Customers moved to the target agent, the source agent and its user
        # account are gone.
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.agent_id, self.target_agent.pk)
        self.assertFalse(Agent.objects.filter(pk=self.agent.pk).exists())
        self.assertFalse(
            User.objects.filter(pk=self.agent.user_id).exists()
        )

    def test_transfer_requires_a_target(self):
        resp = self.delete_agent(pin="123456", action="transfer")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.agent.refresh_from_db()
        self.assertTrue(self.agent.is_active)


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
