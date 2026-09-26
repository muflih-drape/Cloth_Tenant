"""Order lifecycle tests for the metre domain.

The invariant that shapes almost everything here: **placing an order records
demand and never moves cloth**. Stock only changes when a packing round is
confirmed, and comes back when that round is cancelled or an undispatched order
is deleted. So "2400 m on hand, two 1400 m orders" is a legal, expected state.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.agents.models import Agent, AgentItem
from apps.customers.models import Customer
from apps.items.models import Fabric, FabricVariant
from apps.orders.models import Allocation, Order, OrderItem, OrderLog, PackingRound

User = get_user_model()

ZERO = Decimal("0")


def get_auth_header(user):
    refresh = RefreshToken.for_user(user)
    return {"HTTP_AUTHORIZATION": f"Bearer {refresh.access_token}"}


class OrderTestBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username="admin1", email="admin1@test.com",
            password="pass1234", role="ADMIN",
        )
        self.agent_user = User.objects.create_user(
            username="agent1", email="agent1@test.com",
            password="pass1234", role="AGENT",
        )
        self.agent = Agent.objects.create(user=self.agent_user, contact="111")
        self.other_agent_user = User.objects.create_user(
            username="agent2", email="agent2@test.com",
            password="pass1234", role="AGENT",
        )
        self.other_agent = Agent.objects.create(
            user=self.other_agent_user, contact="222"
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
            stock_meters=Decimal("2400"),
        )
        for agent in (self.agent, self.other_agent):
            AgentItem.objects.create(agent=agent, variant=self.variant)

    def auth(self, user=None):
        self.client.credentials(**get_auth_header(user or self.agent_user))

    def make_draft(self, customer=None, agent=None, user=None):
        return Order.objects.create(
            customer=customer or self.customer,
            agent=agent or self.agent,
            created_by=user or self.agent_user,
            status="DRAFT",
        )

    def add_line(self, order, metres, variant=None, allocated=ZERO):
        variant = variant or self.variant
        return OrderItem.objects.create(
            order=order,
            fabric=self.fabric,
            variant=variant,
            fabric_name=self.fabric.name,
            rate_per_meter=self.fabric.price_per_meter,
            variant_display_order=variant.display_order,
            ordered_quantity=Decimal(metres),
            allocated_quantity=Decimal(allocated),
        )

    def place(self, order, user=None):
        self.auth(user)
        return self.client.post(f"/api/orders/{order.pk}/place-order/", {}, format="json")


class DraftAndPlacementTests(OrderTestBase):
    def test_add_line_by_qr(self):
        order = self.make_draft()
        self.auth()
        resp = self.client.post(
            f"/api/orders/{order.pk}/add-item/",
            {"qr_code": str(self.variant.qr_code), "ordered_quantity": "1400"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

        line = order.items.get()
        self.assertEqual(line.ordered_quantity, Decimal("1400.000"))
        self.assertEqual(line.rate_per_meter, Decimal("9.00"))
        self.assertEqual(line.allocated_quantity, ZERO)

    def test_add_line_rejects_unassigned_fabric_for_agents(self):
        other = FabricVariant.objects.create(
            fabric=self.fabric, display_order="White", stock_meters=Decimal("10")
        )
        order = self.make_draft()
        self.auth()
        resp = self.client.post(
            f"/api/orders/{order.pk}/add-item/",
            {"qr_code": str(other.qr_code), "ordered_quantity": "5"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not assigned", str(resp.data).lower())

    def test_add_line_rejects_bad_qr(self):
        order = self.make_draft()
        self.auth()
        resp = self.client.post(
            f"/api/orders/{order.pk}/add-item/",
            {"qr_code": "00000000-0000-0000-0000-000000000000",
             "ordered_quantity": "5"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_add_line_to_another_agents_draft(self):
        order = self.make_draft()
        self.auth(self.other_agent_user)
        resp = self.client.post(
            f"/api/orders/{order.pk}/add-item/",
            {"qr_code": str(self.variant.qr_code), "ordered_quantity": "5"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_placing_does_not_move_stock(self):
        """The central invariant: placement records demand only."""
        order = self.make_draft()
        self.add_line(order, 1400)

        resp = self.place(order)

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.variant.refresh_from_db()
        self.assertEqual(
            self.variant.stock_meters, Decimal("2400.000"),
            "placing an order must not touch the roll",
        )
        order.refresh_from_db()
        self.assertEqual(order.status, "PENDING")

    def test_oversubscribed_order_is_placed_with_a_warning(self):
        """2400 m on hand, 1400 m wanted: allowed, but flagged."""
        order = self.make_draft()
        self.add_line(order, 4000)

        resp = self.place(order)

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(len(resp.data["shortfall_lines"]), 1)
        self.assertEqual(resp.data["shortfall_lines"][0]["shortfall"], "1600.000")
        self.assertIsNotNone(resp.data["notice"])

    def test_cannot_place_empty_order(self):
        order = self.make_draft()
        resp = self.place(order)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_place_someone_elses_draft(self):
        order = self.make_draft()
        self.add_line(order, 100)
        resp = self.place(order, user=self.other_agent_user)
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_cannot_place_twice(self):
        order = self.make_draft()
        self.add_line(order, 100)
        self.assertEqual(self.place(order).status_code, status.HTTP_200_OK)
        self.assertEqual(self.place(order).status_code, status.HTTP_400_BAD_REQUEST)

    def test_placed_order_computes_total_from_metres(self):
        order = self.make_draft()
        self.add_line(order, 1400)

        self.place(order)

        order.refresh_from_db()
        self.assertEqual(order.computed_total, Decimal("12600.00"))
        self.assertEqual(order.effective_total, Decimal("12600.00"))


class PricingOverrideTests(OrderTestBase):
    def setUp(self):
        super().setUp()
        self.order = self.make_draft()
        self.add_line(self.order, 1000)
        self.place(self.order)
        self.order.refresh_from_db()

    def test_agent_can_override_own_order_with_a_reason(self):
        self.auth()
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/set-price/",
            {"final_total": "8000.00", "reason": "Regular customer discount"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.effective_total, Decimal("8000.00"))

    def test_reason_is_mandatory(self):
        self.auth()
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/set-price/",
            {"final_total": "8000.00"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("reason", str(resp.data).lower())

    def test_agent_cannot_override_someone_elses_order(self):
        self.auth(self.other_agent_user)
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/set-price/",
            {"final_total": "1.00", "reason": "nope"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_override_any_order(self):
        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/set-price/",
            {"final_total": "9500.00", "reason": "Goodwill gesture"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.effective_total, Decimal("9500.00"))

    def test_override_is_audited(self):
        self.auth(self.admin)
        self.client.post(
            f"/api/orders/{self.order.pk}/set-price/",
            {"final_total": "9500.00", "reason": "Goodwill gesture"},
            format="json",
        )
        log = OrderLog.objects.filter(
            order=self.order, action="PRICE_OVERRIDE"
        ).first()
        self.assertIsNotNone(log)
        self.assertIn("Goodwill", str(log.details))

    def test_dispatched_order_cannot_be_repriced(self):
        self.order.status = "DISPATCHED"
        self.order.save(update_fields=["status"])

        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/set-price/",
            {"final_total": "1.00", "reason": "too late"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class DispatchTests(OrderTestBase):
    def setUp(self):
        super().setUp()
        self.order = self.make_draft()
        self.line = self.add_line(self.order, 1400)
        self.place(self.order)
        self.order.refresh_from_db()

    def _pack(self, metres):
        """Apply a hand-set plan, the way the admin packing board does."""
        from apps.orders.packing_views import _apply_plan

        packing_round = PackingRound.objects.create(
            variant=self.variant, round_size=Decimal("1000")
        )
        stored = [{"order_item": self.line.pk, "metres": str(Decimal(metres))}]
        with transaction.atomic():
            _apply_plan(packing_round, stored, self.admin)
        return packing_round

    def test_dispatch_blocked_while_unallocated(self):
        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/dispatch/", {}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("unallocated_lines", resp.data)

    def test_partial_dispatch_requires_allow_partial(self):
        self._pack("1000")
        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/dispatch/",
            {"shortfall_reason": "Mill ran out of Natural"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_partial_dispatch_requires_a_reason(self):
        self._pack("1000")
        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/dispatch/",
            {"allow_partial": True},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("shortfall_reason", str(resp.data))

    def test_partial_dispatch_succeeds(self):
        self._pack("1000")
        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/dispatch/",
            {"allow_partial": True, "shortfall_reason": "Mill ran out of Natural"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "DISPATCHED")

    def test_full_dispatch_needs_no_reason(self):
        self._pack("1400")
        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/dispatch/", {}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_dispatch_does_not_move_stock_again(self):
        self._pack("1000")
        self.variant.refresh_from_db()
        after_packing = self.variant.stock_meters

        self.auth(self.admin)
        self.client.post(
            f"/api/orders/{self.order.pk}/dispatch/",
            {"allow_partial": True, "shortfall_reason": "ran out"},
            format="json",
        )

        self.variant.refresh_from_db()
        self.assertEqual(
            self.variant.stock_meters, after_packing,
            "cloth already left the roll at packing time",
        )


class PackingRoundAPITests(OrderTestBase):
    def setUp(self):
        super().setUp()
        self.customer_b = Customer.objects.create(
            name="XYZ Garments", contact="3333333333", agent=self.agent
        )
        self.order_a = self.make_draft()
        self.line_a = self.add_line(self.order_a, 1400)
        self.place(self.order_a)

        self.order_b = self.make_draft(customer=self.customer_b)
        self.line_b = self.add_line(self.order_b, 1400)
        self.place(self.order_b)

    def test_queue_lists_open_lines_with_priority(self):
        self.auth(self.admin)
        resp = self.client.get("/api/orders/packing-rounds/queue/",
                               {"variant": self.variant.pk})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["total_outstanding_meters"], "2800.000")
        self.assertEqual(len(resp.data["lines"]), 2)
        ranks = [line["priority_rank"] for line in resp.data["lines"]]
        self.assertEqual(sorted(ranks), [0, 1])

    def test_queue_requires_a_variant(self):
        self.auth(self.admin)
        resp = self.client.get("/api/orders/packing-rounds/queue/")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_preview_matches_the_business_scenario(self):
        self.auth(self.admin)
        resp = self.client.post(
            "/api/orders/packing-rounds/preview/",
            {"variant": self.variant.pk, "round_size": "1000"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        grants = {
            a["order_item"]: Decimal(a["metres"]) for a in resp.data["allocations"]
        }
        self.assertEqual(grants[self.line_a.pk], Decimal("1400.000"))
        self.assertEqual(grants[self.line_b.pk], Decimal("1000.000"))
        self.assertEqual(sum(grants.values()), Decimal("2400.000"))

    def test_create_confirm_moves_stock(self):
        self.auth(self.admin)
        create = self.client.post(
            "/api/orders/packing-rounds/",
            {"variant": self.variant.pk, "round_size": "1000"},
            format="json",
        )
        self.assertEqual(create.status_code, status.HTTP_201_CREATED, create.data)
        round_id = create.data["id"]

        # A DRAFT round must not have touched anything yet.
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2400.000"))
        self.assertEqual(Allocation.objects.count(), 0)

        confirm = self.client.post(
            f"/api/orders/packing-rounds/{round_id}/confirm/", {}, format="json"
        )
        self.assertEqual(confirm.status_code, status.HTTP_200_OK, confirm.data)

        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("0.000"))
        self.assertEqual(Allocation.objects.count(), 2)

        self.order_a.refresh_from_db()
        self.order_b.refresh_from_db()
        self.assertEqual(self.order_a.status, "PACKED")
        self.assertEqual(self.order_b.status, "PENDING")

    def test_confirming_twice_is_rejected(self):
        self.auth(self.admin)
        create = self.client.post(
            "/api/orders/packing-rounds/",
            {"variant": self.variant.pk, "round_size": "1000"},
            format="json",
        )
        round_id = create.data["id"]
        url = f"/api/orders/packing-rounds/{round_id}/confirm/"

        self.assertEqual(
            self.client.post(url, {}, format="json").status_code, status.HTTP_200_OK
        )
        second = self.client.post(url, {}, format="json")
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("0.000"))

    def test_cancel_returns_the_metres(self):
        self.auth(self.admin)
        create = self.client.post(
            "/api/orders/packing-rounds/",
            {"variant": self.variant.pk, "round_size": "1000"},
            format="json",
        )
        round_id = create.data["id"]
        self.client.post(
            f"/api/orders/packing-rounds/{round_id}/confirm/", {}, format="json"
        )

        cancel = self.client.post(
            f"/api/orders/packing-rounds/{round_id}/cancel/", {}, format="json"
        )
        self.assertEqual(cancel.status_code, status.HTTP_200_OK, cancel.data)

        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2400.000"))
        self.order_a.refresh_from_db()
        self.order_b.refresh_from_db()
        self.assertEqual(self.order_a.status, "PENDING")
        self.assertEqual(self.order_b.status, "PENDING")

    def test_hand_edited_plan_is_honoured(self):
        self.auth(self.admin)
        create = self.client.post(
            "/api/orders/packing-rounds/",
            {
                "variant": self.variant.pk,
                "round_size": "1000",
                "allocations": [
                    {"order_item": self.line_a.pk, "metres": "600"},
                    {"order_item": self.line_b.pk, "metres": "600"},
                ],
                "note": "Mill closed early",
            },
            format="json",
        )
        self.assertEqual(create.status_code, status.HTTP_201_CREATED, create.data)

        self.client.post(
            f"/api/orders/packing-rounds/{create.data['id']}/confirm/",
            {},
            format="json",
        )
        self.line_a.refresh_from_db()
        self.line_b.refresh_from_db()
        self.assertEqual(self.line_a.allocated_quantity, Decimal("600.000"))
        self.assertEqual(self.line_b.allocated_quantity, Decimal("600.000"))
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("1200.000"))

    def test_plan_cannot_exceed_stock(self):
        self.auth(self.admin)
        resp = self.client.post(
            "/api/orders/packing-rounds/",
            {
                "variant": self.variant.pk,
                "round_size": "1000",
                "allocations": [
                    {"order_item": self.line_a.pk, "metres": "2000"},
                    {"order_item": self.line_b.pk, "metres": "2000"},
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_agents_cannot_reach_the_packing_api(self):
        self.auth(self.agent_user)
        for url in ("/api/orders/packing-rounds/queue/", "/api/orders/packing-rounds/list/"):
            resp = self.client.get(url, {"variant": self.variant.pk})
            self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_list_rounds(self):
        self.auth(self.admin)
        self.client.post(
            "/api/orders/packing-rounds/",
            {"variant": self.variant.pk, "round_size": "1000"},
            format="json",
        )
        resp = self.client.get("/api/orders/packing-rounds/list/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["status"], "DRAFT")


class EditFlowTests(OrderTestBase):
    def setUp(self):
        super().setUp()
        self.order = self.make_draft()
        self.add_line(self.order, 1000)
        self.place(self.order)
        self.order.refresh_from_db()

    def test_start_edit_snapshots_the_order(self):
        self.auth()
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/start-edit/", {}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "EDITING")
        self.assertIsNotNone(self.order.edit_snapshot)

    def test_cancel_edit_restores_the_snapshot(self):
        self.auth()
        self.client.post(f"/api/orders/{self.order.pk}/start-edit/", {}, format="json")

        self.add_line(self.order, 500)

        resp = self.client.post(
            f"/api/orders/{self.order.pk}/cancel-edit/", {}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "PENDING")
        self.assertEqual(self.order.items.count(), 1)

    def test_admin_cannot_start_edit(self):
        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/start-edit/", {}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_cannot_edit_once_any_metre_is_packed(self):
        """A partial allocation is enough to freeze the order against edits."""
        from apps.orders.packing_views import _apply_plan

        line = self.order.items.get()
        packing_round = PackingRound.objects.create(
            variant=self.variant, round_size=Decimal("400")
        )
        with transaction.atomic():
            _apply_plan(
                packing_round,
                [{"order_item": line.pk, "metres": "400"}],
                self.admin,
            )

        self.order.refresh_from_db()
        self.assertEqual(
            self.order.status, "PENDING", "still short, so still editable by status"
        )

        self.auth()
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/start-edit/", {}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("packed", str(resp.data).lower())

    def test_fully_packed_order_cannot_be_edited(self):
        from apps.orders.packing_views import _apply_plan

        line = self.order.items.get()
        packing_round = PackingRound.objects.create(
            variant=self.variant, round_size=Decimal("1000")
        )
        with transaction.atomic():
            _apply_plan(
                packing_round,
                [{"order_item": line.pk, "metres": "1000"}],
                self.admin,
            )
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "PACKED")

        self.auth()
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/start-edit/", {}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class OrderDeletionTests(OrderTestBase):
    def test_deleting_a_packed_order_returns_its_cloth(self):
        from apps.orders.packing_views import _apply_plan

        order = self.make_draft()
        line = self.add_line(order, 1000)
        self.place(order)

        packing_round = PackingRound.objects.create(
            variant=self.variant, round_size=Decimal("1000")
        )
        with transaction.atomic():
            _apply_plan(
                packing_round,
                [{"order_item": line.pk, "metres": "1000"}],
                self.admin,
            )
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("1400.000"))

        self.auth(self.admin)
        resp = self.client.delete(f"/api/orders/{order.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

        self.variant.refresh_from_db()
        self.assertEqual(
            self.variant.stock_meters, Decimal("2400.000"),
            "undispatched cloth must go back on the roll",
        )

    def test_deleting_a_dispatched_order_keeps_the_cloth_gone(self):
        order = self.make_draft()
        line = self.add_line(order, 1000)
        self.place(order)

        from apps.orders.packing_views import _apply_plan

        packing_round = PackingRound.objects.create(
            variant=self.variant, round_size=Decimal("1000")
        )
        with transaction.atomic():
            _apply_plan(
                packing_round,
                [{"order_item": line.pk, "metres": "1000"}],
                self.admin,
            )

        self.auth(self.admin)
        self.client.post(
            f"/api/orders/{order.pk}/dispatch/", {}, format="json"
        )
        self.client.delete(f"/api/orders/{order.pk}/")

        self.variant.refresh_from_db()
        self.assertEqual(
            self.variant.stock_meters, Decimal("1400.000"),
            "shipped cloth must never return to stock",
        )

    def test_audit_log_survives_deletion(self):
        order = self.make_draft()
        self.add_line(order, 100)
        self.place(order)

        self.auth(self.admin)
        self.client.delete(f"/api/orders/{order.pk}/")

        self.assertFalse(Order.objects.filter(pk=order.pk).exists())
        logs = OrderLog.objects.filter(order_ref=order.pk)
        self.assertTrue(logs.exists(), "the audit trail must outlive the order")
        for log in logs:
            self.assertIsNone(log.order)


class OrderVisibilityTests(OrderTestBase):
    def test_my_viewed_ids(self):
        order = self.make_draft()
        self.add_line(order, 100)
        self.place(order)

        self.auth()
        resp = self.client.get("/api/orders/my-viewed-ids/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertNotIn(order.pk, resp.data)

        self.client.post(
            f"/api/orders/{order.pk}/mark-viewed/", {}, format="json"
        )
        resp = self.client.get("/api/orders/my-viewed-ids/")
        self.assertIn(order.pk, resp.data)

    def test_agents_do_not_see_other_agents_drafts(self):
        mine = self.make_draft()
        theirs = self.make_draft(agent=self.other_agent,
                                 user=self.other_agent_user)

        self.auth(self.agent_user)
        resp = self.client.get("/api/orders/")
        ids = [o["id"] for o in resp.data.get("results", resp.data)]
        self.assertIn(mine.pk, ids)
        self.assertNotIn(theirs.pk, ids)

    def test_admins_see_placed_orders_from_any_agent(self):
        placed = self.make_draft()
        self.add_line(placed, 100)
        self.place(placed)

        self.auth(self.admin)
        resp = self.client.get("/api/orders/")
        ids = [o["id"] for o in resp.data.get("results", resp.data)]
        self.assertIn(placed.pk, ids)

    def test_admin_sees_own_draft_but_not_another_users(self):
        mine = Order.objects.create(
            customer=self.customer,
            agent=self.agent,
            created_by=self.admin,
            status="DRAFT",
        )
        theirs = self.make_draft()

        self.auth(self.admin)
        resp = self.client.get("/api/orders/")
        ids = [o["id"] for o in resp.data.get("results", resp.data)]
        self.assertIn(mine.pk, ids)
        self.assertNotIn(theirs.pk, ids)
