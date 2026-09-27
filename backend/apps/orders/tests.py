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
from django.conf import settings
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.agents.models import Agent, AgentItem
from apps.customers.models import Customer
from apps.items.models import Fabric, FabricVariant
from apps.orders.models import Allocation, Order, OrderItem, OrderLog, PackingRound
from apps.orders.pricing import recompute_order_total

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
        line = OrderItem.objects.create(
            order=order,
            fabric=self.fabric,
            variant=variant,
            fabric_name=self.fabric.name,
            rate_per_meter=self.fabric.price_per_meter,
            variant_display_order=variant.display_order,
            ordered_quantity=Decimal(metres),
            allocated_quantity=Decimal(allocated),
        )
        # The line endpoints recompute after every change; writing the row
        # directly skips that, so mirror it here or computed_total stays 0.
        recompute_order_total(order)
        return line

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
    """The total may only be agreed while the order is still a draft.

    The draft holds one 1000 m line at 9.00/m, so the order total is 9000.00.
    """

    def setUp(self):
        super().setUp()
        self.order = self.make_draft()
        self.add_line(self.order, 1000)
        self.order.refresh_from_db()
        self.assertEqual(self.order.computed_total, Decimal("9000.00"))

    def set_price(self, total, reason=None, user=None):
        payload = {"final_total": total}
        if reason is not None:
            payload["reason"] = reason
        self.auth(user)
        return self.client.post(
            f"/api/orders/{self.order.pk}/set-price/", payload, format="json"
        )

    def test_agent_can_discount_their_own_draft(self):
        resp = self.set_price("8000.00", "Regular customer discount")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.effective_total, Decimal("8000.00"))
        self.assertTrue(self.order.is_price_overridden)

    def test_reason_is_optional(self):
        resp = self.set_price("8000.00")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.effective_total, Decimal("8000.00"))
        # The audit entry still records the numbers even with no narrative.
        log = OrderLog.objects.filter(
            order=self.order, action="PRICE_OVERRIDE"
        ).first()
        self.assertIsNotNone(log)
        self.assertIn("8000.00", str(log.details))

    def test_reason_over_200_chars_is_rejected(self):
        resp = self.set_price("8000.00", "x" * 201)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("200", str(resp.data))

    def test_agent_cannot_raise_the_total_above_the_order_total(self):
        resp = self.set_price("9500.00", "Inflating an invoice")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("cannot be higher", str(resp.data))
        self.order.refresh_from_db()
        self.assertIsNone(self.order.final_total)

    def test_agent_can_still_match_the_order_total(self):
        resp = self.set_price("9000.00", "No change needed")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        # Matching the order total is a no-op, so no override is recorded.
        self.assertIsNone(self.order.final_total)
        self.assertFalse(self.order.is_price_overridden)

    def test_admin_may_raise_the_total(self):
        resp = self.set_price("9500.00", "Goodwill gesture", user=self.admin)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.effective_total, Decimal("9500.00"))

    def test_negative_total_is_rejected(self):
        resp = self.set_price("-1.00", "nonsense")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("negative", str(resp.data).lower())

    def test_non_numeric_total_is_rejected(self):
        resp = self.set_price("free", "nonsense")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("number", str(resp.data))

    def test_agent_cannot_override_someone_elses_draft(self):
        resp = self.set_price("1.00", "nope", user=self.other_agent_user)
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_override_is_audited(self):
        self.set_price("8000.00", "Negotiated rate")
        log = OrderLog.objects.filter(
            order=self.order, action="PRICE_OVERRIDE"
        ).first()
        self.assertIsNotNone(log)
        self.assertIn("Negotiated", str(log.details))
        self.assertEqual(log.performed_by, self.agent_user)

    def test_posting_the_order_total_clears_an_override(self):
        self.set_price("8000.00", "Negotiated rate")
        self.order.refresh_from_db()
        self.assertTrue(self.order.is_price_overridden)

        resp = self.set_price("9000.00", "Rate agreed after all")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        self.assertIsNone(self.order.final_total)
        self.assertFalse(self.order.is_price_overridden)
        self.assertTrue(
            OrderLog.objects.filter(
                order=self.order, action="PRICE_OVERRIDE_CLEARED"
            ).exists()
        )

    def test_placed_order_can_no_longer_be_repriced(self):
        self.place(self.order)
        self.order.refresh_from_db()
        resp = self.set_price("1.00", "too late")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("before the order is placed", str(resp.data))

    def test_dispatched_order_cannot_be_repriced(self):
        self.place(self.order)
        self.order.status = "DISPATCHED"
        self.order.save(update_fields=["status"])

        resp = self.set_price("1.00", "too late", user=self.admin)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_agreed_total_survives_being_placed(self):
        # Placing recomputes computed_total, and that must not wipe the figure the
        # agent already agreed with the customer.
        self.set_price("8000.00", "Negotiated rate")
        self.place(self.order)
        self.order.refresh_from_db()
        self.assertEqual(self.order.computed_total, Decimal("9000.00"))
        self.assertEqual(self.order.effective_total, Decimal("8000.00"))
        self.assertTrue(self.order.is_price_overridden)

    def test_generic_patch_cannot_reach_the_total(self):
        # final_total used to be writable on the plain order serializer, which
        # would have bypassed the draft window, the agent cap and the audit log.
        self.auth()
        resp = self.client.patch(
            f"/api/orders/{self.order.pk}/",
            {"final_total": "1.00", "price_override_reason": "sneaky"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        self.assertIsNone(self.order.final_total)
        self.assertEqual(self.order.effective_total, Decimal("9000.00"))

    def test_generic_patch_cannot_change_status(self):
        self.auth()
        self.client.patch(
            f"/api/orders/{self.order.pk}/", {"status": "DISPATCHED"}, format="json"
        )
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "DRAFT")


class InvoiceTests(OrderTestBase):
    """The invoice is paperwork, so it must show real money and obey ownership."""

    def setUp(self):
        super().setUp()
        self.order = self.make_draft()
        self.add_line(self.order, 1000)
        self.place(self.order)
        self.order.refresh_from_db()

    def invoice(self, user=None):
        self.auth(user)
        return self.client.get(f"/api/orders/{self.order.pk}/invoice/")

    def test_invoice_exposes_the_total_the_frontend_reads(self):
        # The invoice used to send totals.total_price while both invoice
        # renderers read totals.effective_total, so subtotal, GST and the grand
        # total all rendered as zero.
        resp = self.invoice()
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["totals"]["effective_total"], "9000.00")
        self.assertNotIn("total_price", resp.data["totals"])

    def test_invoice_totals_match_the_order_totals(self):
        invoice = self.invoice().data
        detail = self.client.get(f"/api/orders/{self.order.pk}/").data
        self.assertEqual(invoice["totals"], detail["totals"])

    def test_invoice_shows_an_agreed_total(self):
        self.auth(self.admin)
        self.order.status = "DRAFT"
        self.order.save(update_fields=["status"])
        self.client.post(
            f"/api/orders/{self.order.pk}/set-price/",
            {"final_total": "8000.00", "reason": "Negotiated rate"},
            format="json",
        )
        self.order.refresh_from_db()
        self.place(self.order)

        totals = self.invoice().data["totals"]
        self.assertEqual(totals["computed_total"], "9000.00")
        self.assertEqual(totals["effective_total"], "8000.00")
        self.assertTrue(totals["is_price_overridden"])
        self.assertEqual(totals["price_override_reason"], "Negotiated rate")

    def test_invoice_carries_the_gst_rate(self):
        resp = self.invoice()
        self.assertEqual(
            resp.data["gst_rate"], float(settings.GST_RATE), resp.data["gst_rate"]
        )

    def test_agent_can_read_their_own_invoice(self):
        resp = self.invoice()
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["customer"]["id"], self.customer.id)

    def test_agent_cannot_read_another_agents_invoice(self):
        resp = self.invoice(user=self.other_agent_user)
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_read_any_invoice(self):
        resp = self.invoice(user=self.admin)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)



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

    def test_packing_a_subset_leaves_the_unticked_orders_waiting(self):
        """The board now hands over only the orders the admin ticked.

        Everyone else on the queue must keep waiting untouched: no allocation
        row, no stock moved, and the order still open. This is the difference
        between packing for a chosen few and the old behaviour, where the
        engine handed the roll to everybody waiting on the colour.
        """
        third = Customer.objects.create(
            name="Riverside Textiles", contact="4444444444", agent=self.agent
        )
        self.order_c = self.make_draft(customer=third)
        self.line_c = self.add_line(self.order_c, 900)
        self.place(self.order_c)

        self.auth(self.admin)
        stock_before = self.variant.stock_meters

        create = self.client.post(
            "/api/orders/packing-rounds/",
            {
                "variant": self.variant.pk,
                "round_size": "900",
                "allocations": [
                    {"order_item": self.line_a.pk, "metres": "500"},
                    {"order_item": self.line_c.pk, "metres": "400"},
                ],
            },
            format="json",
        )
        self.assertEqual(create.status_code, status.HTTP_201_CREATED, create.data)
        self.assertEqual(len(create.data["plan_override"]), 2)

        confirm = self.client.post(
            f"/api/orders/packing-rounds/{create.data['id']}/confirm/",
            {},
            format="json",
        )
        self.assertEqual(confirm.status_code, status.HTTP_200_OK, confirm.data)

        # Exactly the two ticked lines were filled.
        self.line_a.refresh_from_db()
        self.line_c.refresh_from_db()
        self.assertEqual(self.line_a.allocated_quantity, Decimal("500.000"))
        self.assertEqual(self.line_c.allocated_quantity, Decimal("400.000"))

        # The unticked line is untouched and still has cloth outstanding.
        self.line_b.refresh_from_db()
        self.assertEqual(self.line_b.allocated_quantity, ZERO)
        self.assertEqual(
            self.line_b.outstanding_quantity, self.line_b.ordered_quantity
        )
        self.assertFalse(
            Allocation.objects.filter(order_item=self.line_b).exists()
        )

        # Only the handed-over metres came off the roll.
        self.variant.refresh_from_db()
        self.assertEqual(
            self.variant.stock_meters, stock_before - Decimal("900.000")
        )
        self.order_b.refresh_from_db()
        self.assertEqual(self.order_b.status, "PENDING")

    def test_a_round_cannot_exceed_what_one_order_still_needs(self):
        """A typed figure larger than the line's demand is refused on confirm.

        The board screens for this before saving, but a round can be left as a
        draft and confirmed later, by which time the check has to still hold.
        """
        self.auth(self.admin)
        stock_before = self.variant.stock_meters

        # line_a only ever needs 1400 and 2000 is on the roll, so freezing this
        # is legal; it is only the later shrink that makes it stale.
        create = self.client.post(
            "/api/orders/packing-rounds/",
            {
                "variant": self.variant.pk,
                "round_size": "2000",
                "allocations": [
                    {"order_item": self.line_a.pk, "metres": "2000"},
                ],
            },
            format="json",
        )
        self.assertEqual(create.status_code, status.HTTP_201_CREATED, create.data)

        # Shrink what the order needs, then try to apply the stale plan.
        OrderItem.objects.filter(pk=self.line_a.pk).update(
            ordered_quantity=Decimal("500.000")
        )
        confirm = self.client.post(
            f"/api/orders/packing-rounds/{create.data['id']}/confirm/",
            {},
            format="json",
        )
        self.assertEqual(confirm.status_code, status.HTTP_400_BAD_REQUEST)

        # The refusal rolled the whole thing back: no allocation, no stock moved.
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, stock_before)
        self.line_a.refresh_from_db()
        self.assertEqual(self.line_a.allocated_quantity, ZERO)
        self.assertFalse(
            Allocation.objects.filter(order_item=self.line_a).exists()
        )

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


class LineIntegrityTests(OrderTestBase):
    """Lines are the money: they may only change on an order the caller owns.

    Every bug here was reachable by a plain HTTP call from the agent's own
    browser session, so each one is pinned by a test.
    """

    def setUp(self):
        super().setUp()
        self.order = self.make_draft()
        self.line = self.add_line(self.order, 1000)

    def make_editing_order(self):
        """A PENDING order its owner has opened for editing."""
        self.place(self.order)
        self.order.refresh_from_db()
        self.auth()
        self.client.post(f"/api/orders/{self.order.pk}/start-edit/", {}, format="json")
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "EDITING")
        return self.order

    # ── ownership ──────────────────────────────────────────────────────────

    def test_cannot_add_line_to_another_agents_editing_order(self):
        # The ownership check used to be skipped while a draft was EDITING,
        # which handed any agent the right to add lines to a competitor's order.
        self.make_editing_order()
        self.auth(self.other_agent_user)
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/add-item/",
            {"qr_code": str(self.variant.qr_code), "ordered_quantity": "5"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.order.items.count(), 1)

    def test_cannot_delete_line_from_another_agents_editing_order(self):
        self.make_editing_order()
        self.auth(self.other_agent_user)
        resp = self.client.delete(
            f"/api/orders/{self.order.pk}/delete-item/{self.line.pk}/"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(OrderItem.objects.filter(id=self.line.pk).exists())

    def test_owner_can_still_add_to_their_editing_order(self):
        self.make_editing_order()
        self.auth()
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/add-item/",
            {"qr_code": str(self.variant.qr_code), "ordered_quantity": "5"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    # ── the generic viewset must not be a way around the guards ───────────

    def test_generic_delete_cannot_strip_a_packed_line(self):
        # DELETE /api/orders/order-items/{id}/ used to delete straight through
        # ModelViewSet: no status check, no packed check. Allocation rows are
        # CASCADE, so the roll stayed debited with nothing left to credit it.
        self.place(self.order)
        from apps.orders.packing_views import _apply_plan

        line = self.order.items.get()
        packing_round = PackingRound.objects.create(
            variant=self.variant, round_size=Decimal("400")
        )
        with transaction.atomic():
            _apply_plan(packing_round, [{"order_item": line.pk, "metres": "400"}], self.admin)

        self.auth()
        resp = self.client.delete(f"/api/orders/order-items/{line.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(OrderItem.objects.filter(id=line.pk).exists())

    def test_generic_delete_follows_the_ownership_rules(self):
        self.auth(self.other_agent_user)
        resp = self.client.delete(f"/api/orders/order-items/{self.line.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(OrderItem.objects.filter(id=self.line.pk).exists())

    def test_generic_delete_removes_an_unallocated_line(self):
        self.auth()
        resp = self.client.delete(f"/api/orders/order-items/{self.line.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertFalse(OrderItem.objects.filter(id=self.line.pk).exists())

    def test_generic_create_is_rejected(self):
        # There is no order field on the serializer, so this used to 500.
        self.auth()
        resp = self.client.post(
            "/api/orders/order-items/",
            {"ordered_quantity": "10", "variant": self.variant.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    # ── a line may not be re-pointed at a foreign variant ─────────────────

    def test_changing_the_colour_keeps_the_fabric_and_rate_consistent(self):
        other_variant = FabricVariant.objects.create(
            fabric=self.fabric, display_order="Maroon", stock_meters=Decimal("500")
        )
        self.auth()
        resp = self.client.patch(
            f"/api/orders/order-items/{self.line.pk}/",
            {"variant": other_variant.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line.refresh_from_db()
        self.assertEqual(self.line.variant_id, other_variant.pk)
        self.assertEqual(self.line.fabric_id, self.fabric.pk)
        self.assertEqual(self.line.variant_display_order, "Maroon")

    def test_cannot_point_a_line_at_another_fabrics_variant(self):
        # fabric and variant were both writable and never cross-checked, so this
        # billed fabric A's rate for fabric B's cloth and queued the line against
        # a variant nothing had paid for.
        other_fabric = Fabric.objects.create(
            name="Silk charmeuse", price_per_meter=Decimal("40.00")
        )
        foreign = FabricVariant.objects.create(
            fabric=other_fabric, display_order="Scarlet", stock_meters=Decimal("10")
        )
        self.auth()
        resp = self.client.patch(
            f"/api/orders/order-items/{self.line.pk}/",
            {"variant": foreign.pk, "fabric": self.fabric.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line.refresh_from_db()
        self.assertEqual(
            self.line.fabric_id,
            other_fabric.pk,
            "the fabric must follow the variant, not the client",
        )
        self.assertEqual(
            self.line.rate_per_meter,
            other_fabric.price_per_meter,
            "the snapshotted rate must be re-taken from the new fabric",
        )
        self.assertEqual(self.line.fabric_name, other_fabric.name)

    def test_cannot_recolour_a_line_that_is_already_packed(self):
        self.place(self.order)
        from apps.orders.packing_views import _apply_plan

        line = self.order.items.get()
        packing_round = PackingRound.objects.create(
            variant=self.variant, round_size=Decimal("400")
        )
        with transaction.atomic():
            _apply_plan(packing_round, [{"order_item": line.pk, "metres": "400"}], self.admin)

        other_variant = FabricVariant.objects.create(
            fabric=self.fabric, display_order="Maroon", stock_meters=Decimal("500")
        )
        self.auth()
        resp = self.client.patch(
            f"/api/orders/order-items/{self.line.pk}/",
            {"variant": other_variant.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        line.refresh_from_db()
        self.assertEqual(line.variant_id, self.variant.pk)

    def test_rejected_edit_does_not_change_the_quantity(self):
        # The quantity used to be written and logged before the serializer ran,
        # so a rejected payload left the line changed behind a 400.
        self.auth()
        resp = self.client.patch(
            f"/api/orders/order-items/{self.line.pk}/",
            {"ordered_quantity": "5", "variant": 999999},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.line.refresh_from_db()
        self.assertEqual(self.line.ordered_quantity, Decimal("1000.000"))

    # ── merging duplicates ─────────────────────────────────────────────────

    def test_merge_combines_metres_in_decimals(self):
        # Summing in JavaScript gave 0.30000000000000004 for 0.1 + 0.2, which the
        # serializer rejects, so the Proceed button 400'd on ordinary metres.
        self.line.ordered_quantity = Decimal("0.100")
        self.line.save(update_fields=["ordered_quantity"])
        second = OrderItem.objects.create(
            order=self.order,
            fabric=self.fabric,
            variant=self.variant,
            fabric_name=self.fabric.name,
            rate_per_meter=self.fabric.price_per_meter,
            variant_display_order=self.variant.display_order,
            ordered_quantity=Decimal("0.200"),
        )
        recompute_order_total(self.order)

        self.auth()
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/merge-items/",
            {"keep_item_id": self.line.pk, "drop_item_ids": [second.pk]},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line.refresh_from_db()
        self.assertEqual(self.line.ordered_quantity, Decimal("0.300"))
        self.assertEqual(self.order.items.count(), 1)
        self.order.refresh_from_db()
        self.assertEqual(self.order.computed_total, Decimal("2.70"))

    def test_merge_refuses_lines_of_different_colours(self):
        other_variant = FabricVariant.objects.create(
            fabric=self.fabric, display_order="Maroon", stock_meters=Decimal("500")
        )
        second = OrderItem.objects.create(
            order=self.order,
            fabric=self.fabric,
            variant=other_variant,
            fabric_name=self.fabric.name,
            rate_per_meter=self.fabric.price_per_meter,
            ordered_quantity=Decimal("50"),
        )
        self.auth()
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/merge-items/",
            {"keep_item_id": self.line.pk, "drop_item_ids": [second.pk]},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.order.items.count(), 2)

    def test_cannot_merge_another_agents_lines(self):
        second = OrderItem.objects.create(
            order=self.order,
            fabric=self.fabric,
            variant=self.variant,
            fabric_name=self.fabric.name,
            rate_per_meter=self.fabric.price_per_meter,
            ordered_quantity=Decimal("50"),
        )
        self.auth(self.other_agent_user)
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/merge-items/",
            {"keep_item_id": self.line.pk, "drop_item_ids": [second.pk]},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.order.items.count(), 2)

    def test_cannot_merge_a_line_with_itself(self):
        self.auth()
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/merge-items/",
            {"keep_item_id": self.line.pk, "drop_item_ids": [self.line.pk]},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_merge_once_a_metre_is_packed(self):
        self.place(self.order)
        from apps.orders.packing_views import _apply_plan

        line = self.order.items.get()
        packing_round = PackingRound.objects.create(
            variant=self.variant, round_size=Decimal("400")
        )
        with transaction.atomic():
            _apply_plan(packing_round, [{"order_item": line.pk, "metres": "400"}], self.admin)

        self.auth()
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/merge-items/",
            {"keep_item_id": line.pk, "drop_item_ids": []},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    # ── a placed order must keep something to fulfil ──────────────────────

    def test_cannot_delete_the_last_line_of_a_placed_order(self):
        # This is how a PENDING order ended up with no lines but a manually
        # entered total: every line was removed one at a time, each removal
        # legal because nothing was packed yet.
        self.place(self.order)
        self.order.refresh_from_db()
        self.auth()
        resp = self.client.delete(
            f"/api/orders/{self.order.pk}/delete-item/{self.line.pk}/"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("only line", str(resp.data))
        self.assertTrue(OrderItem.objects.filter(id=self.line.pk).exists())

    def test_can_still_delete_a_line_when_another_remains(self):
        self.place(self.order)
        second = OrderItem.objects.create(
            order=self.order,
            fabric=self.fabric,
            variant=self.variant,
            fabric_name=self.fabric.name,
            rate_per_meter=self.fabric.price_per_meter,
            ordered_quantity=Decimal("100"),
        )
        recompute_order_total(self.order)
        self.auth()
        resp = self.client.delete(f"/api/orders/{self.order.pk}/delete-item/{second.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(self.order.items.count(), 1)

    def test_last_line_of_a_draft_is_still_removable(self):
        # Only a *placed* order is protected; a draft has nothing to strand.
        self.auth()
        resp = self.client.delete(
            f"/api/orders/{self.order.pk}/delete-item/{self.line.pk}/"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(self.order.items.count(), 0)
