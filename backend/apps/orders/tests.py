"""Order lifecycle tests for the metre domain.

The invariant that shapes almost everything here: **placing an order records
demand and never moves cloth**. Stock only changes when a packing round is
confirmed, and comes back when that round is cancelled or an undispatched order
is deleted. So "2400 m on hand, two 1400 m orders" is a legal, expected state.
"""

from decimal import Decimal

import threading

from django.contrib.auth import get_user_model
from django.db import connections, transaction
from django.test import TestCase, TransactionTestCase
from django.conf import settings
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.agents.models import Agent, AgentItem
from apps.customers.models import Customer
from apps.items.models import Fabric, FabricVariant
from apps.orders.models import Allocation, Order, OrderItem, OrderLog, PackingRound
from apps.orders.pricing import order_totals, recompute_order_total

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

    def test_a_stale_draft_cannot_overdraw_the_roll_at_confirm(self):
        """A plan frozen while the roll was full must be re-checked against stock.

        The board screens a plan before saving it, but a round can be left as a
        draft and confirmed later, by which time the roll may have shrunk. Cloth
        on the roll is the one hard limit, so that is what has to still hold.
        """
        self.auth(self.admin)

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

        # Something else takes most of the roll while this one sits as a draft.
        FabricVariant.objects.filter(pk=self.variant.pk).update(
            stock_meters=Decimal("500.000")
        )

        confirm = self.client.post(
            f"/api/orders/packing-rounds/{create.data['id']}/confirm/",
            {},
            format="json",
        )
        self.assertEqual(confirm.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("in stock", confirm.data["error"])

        # The refusal rolled the whole thing back: no allocation, no stock moved.
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("500.000"))
        self.line_a.refresh_from_db()
        self.assertEqual(self.line_a.allocated_quantity, ZERO)
        self.assertFalse(
            Allocation.objects.filter(order_item=self.line_a).exists()
        )

    def test_a_stale_draft_may_hand_out_more_than_the_line_now_needs(self):
        """Handing over more than a line owes is allowed, so a stale plan applies.

        The order was shrunk after the round was drafted, leaving the plan
        over-paying the line by a wide margin. That is no longer a reason to
        refuse: a roll is cut whole, rounding up is deliberate, and the only
        limit is whether the cloth is physically there. The line settles at zero
        outstanding rather than going negative.
        """
        self.auth(self.admin)
        stock_before = self.variant.stock_meters

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

        OrderItem.objects.filter(pk=self.line_a.pk).update(
            ordered_quantity=Decimal("500.000")
        )

        confirm = self.client.post(
            f"/api/orders/packing-rounds/{create.data['id']}/confirm/",
            {},
            format="json",
        )
        self.assertEqual(confirm.status_code, status.HTTP_200_OK, confirm.data)

        # The full plan is honoured, and the whole of it came off the roll.
        self.variant.refresh_from_db()
        self.assertEqual(
            self.variant.stock_meters, stock_before - Decimal("2000.000")
        )
        self.line_a.refresh_from_db()
        self.assertEqual(self.line_a.allocated_quantity, Decimal("2000.000"))
        self.assertEqual(self.line_a.outstanding_quantity, Decimal("0.000"))

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


class PackSingleLineTests(OrderTestBase):
    """Packing one order line straight from the order page.

    The shortcut is only allowed to be a shortcut: it must leave the same trail
    a board round does (PackingRound -> Allocation -> OrderLog) and move the roll
    through the same code, so these tests check the audit trail as closely as the
    quantities.
    """

    def setUp(self):
        super().setUp()
        self.order = self.make_draft()
        self.line = self.add_line(self.order, 1400)
        self.place(self.order)

        # A second customer on the same colour, to prove a single-line pack
        # touches only the line it was aimed at.
        self.customer_b = Customer.objects.create(
            name="XYZ Garments", contact="3333333333", agent=self.agent
        )
        self.order_b = self.make_draft(customer=self.customer_b)
        self.line_b = self.add_line(self.order_b, 900)
        self.place(self.order_b)

    def pack_url(self, order=None, line=None):
        order = order or self.order
        line = line or self.line
        return f"/api/orders/{order.pk}/items/{line.pk}/pack/"

    def pack(self, metres, order=None, line=None):
        self.auth(self.admin)
        return self.client.post(
            self.pack_url(order, line), {"metres": str(metres)}, format="json"
        )

    def test_pack_single_line_from_order_page(self):
        resp = self.pack(600)

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("600.000"))
        self.assertEqual(self.line.outstanding_quantity, Decimal("800.000"))

        # Cloth really left the roll, and only what was handed over.
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("1800.000"))

        # The response carries the new figures so the page can update in place.
        self.assertEqual(resp.data["item"]["allocated_quantity"], "600.000")
        self.assertEqual(resp.data["item"]["outstanding_quantity"], "800.000")
        self.assertEqual(resp.data["stock_meters"], "1800.000")
        self.assertEqual(resp.data["order_status"], "PENDING")

        # The trail is a normal round, tagged with where it was packed from.
        packing_round = PackingRound.objects.get(pk=resp.data["round"])
        self.assertEqual(packing_round.status, "CONFIRMED")
        self.assertEqual(packing_round.variant_id, self.variant.pk)
        self.assertEqual(packing_round.note, f"Packed directly from order #{self.order.pk}")
        allocation = Allocation.objects.get(round=packing_round)
        self.assertEqual(allocation.order_item_id, self.line.pk)
        self.assertEqual(allocation.metres, Decimal("600.000"))
        self.assertEqual(allocation.sequence, 1)
        self.assertFalse(allocation.is_priority_award)

        log = OrderLog.objects.filter(
            order_ref=self.order.pk, action="ALLOCATION_MADE"
        ).latest("created_at")
        self.assertEqual(log.details["round"], packing_round.pk)
        self.assertEqual(log.details["allocated_meters"], "600.000")
        self.assertEqual(log.performed_by_id, self.admin.pk)

    def test_pack_single_line_leaves_other_orders_on_the_colour_alone(self):
        resp = self.pack(600)

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line_b.refresh_from_db()
        self.assertEqual(self.line_b.allocated_quantity, ZERO)
        self.assertFalse(Allocation.objects.filter(order_item=self.line_b).exists())
        self.order_b.refresh_from_db()
        self.assertEqual(self.order_b.status, "PENDING")

    def test_packing_the_last_metres_promotes_the_order_to_packed(self):
        self.pack(1000)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "PENDING")

        resp = self.pack(400)

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["order_status"], "PACKED")
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "PACKED")
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("1000.000"))

    def test_packing_more_than_the_line_owes_is_allowed(self):
        """A roll is cut whole, so rounding a line up is a legitimate pack.

        The line is ordered 1400 m; handing over 1500 m takes 1500 m off the roll
        and leaves the line settled rather than negative.
        """
        resp = self.pack(1500)

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("1500.000"))

        # Nothing is owed back, and the API says so with a plain zero.
        self.assertEqual(self.line.outstanding_quantity, Decimal("0.000"))
        self.assertEqual(resp.data["item"]["outstanding_quantity"], "0.000")

        # Every metre handed over came off the roll -- the overage is not free.
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("900.000"))

        allocation = Allocation.objects.get(order_item=self.line)
        self.assertEqual(allocation.metres, Decimal("1500.000"))

    def test_packing_less_than_the_line_owes_leaves_the_remainder(self):
        resp = self.pack(500)

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("500.000"))
        self.assertEqual(self.line.outstanding_quantity, Decimal("900.000"))
        self.assertEqual(resp.data["item"]["outstanding_quantity"], "900.000")

        # A partial pack is not a finished one, so the order stays open.
        self.assertEqual(resp.data["order_status"], "PENDING")
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("1900.000"))

    def test_cannot_pack_more_than_available_stock(self):
        self.variant.stock_meters = Decimal("500.000")
        self.variant.save(update_fields=["stock_meters"])

        resp = self.pack(700)

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("in stock", resp.data["error"])

        # Stock is the one hard limit, and it is enforced before anything moves.
        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, ZERO)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("500.000"))
        self.assertEqual(Allocation.objects.filter(order_item=self.line).count(), 0)
        self.assertEqual(PackingRound.objects.filter(note__startswith="Packed directly").count(), 0)

    def test_a_fully_packed_line_can_still_be_packed(self):
        """Settling a line does not freeze it; the roll decides.

        The line is already handed over in full, so its outstanding demand is
        zero, but the roll still has cloth on it and the admin is allowed to cut
        more for this line rather than opening a fresh one.
        """
        self.pack(1400)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "PACKED")

        resp = self.pack(100)

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("1500.000"))
        self.assertEqual(self.line.outstanding_quantity, Decimal("0.000"))
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("900.000"))

    def test_cannot_pack_a_dispatched_order(self):
        self.pack(1400)
        self.order.refresh_from_db()
        Order.objects.filter(pk=self.order.pk).update(status="DISPATCHED")

        resp = self.pack(100)

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not open for packing", resp.data["error"])

    def test_cannot_pack_a_draft_order(self):
        draft = self.make_draft()
        line = self.add_line(draft, 500)

        resp = self.pack(500, order=draft, line=line)

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not open for packing", resp.data["error"])

    def test_packing_less_than_a_millimetre_is_refused(self):
        resp = self.pack(0.0004)

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("metres", resp.data)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2400.000"))

    def test_zero_and_negative_metres_are_refused(self):
        for metres in ("0", "-5"):
            resp = self.pack(metres)
            self.assertEqual(
                resp.status_code, status.HTTP_400_BAD_REQUEST, f"metres={metres}"
            )

    def test_a_line_from_another_order_is_not_reachable(self):
        resp = self.pack(100, order=self.order, line=self.line_b)

        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_line_with_no_variant_cannot_be_packed(self):
        order = self.make_draft()
        line = OrderItem.objects.create(
            order=order,
            fabric=self.fabric,
            variant=None,
            fabric_name=self.fabric.name,
            rate_per_meter=self.fabric.price_per_meter,
            ordered_quantity=Decimal("500"),
        )
        Order.objects.filter(pk=order.pk).update(status="PENDING")

        resp = self.pack(100, order=order, line=line)

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("no fabric variant", resp.data["error"])

    def test_agents_cannot_reach_this_endpoint(self):
        self.auth(self.agent_user)
        resp = self.client.post(
            self.pack_url(), {"metres": "600"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, ZERO)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2400.000"))

    def test_anonymous_cannot_reach_this_endpoint(self):
        self.client.force_authenticate(user=None)
        resp = self.client.post(self.pack_url(), {"metres": "600"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_single_line_pack_round_can_be_cancelled_like_any_other(self):
        resp = self.pack(600)
        round_id = resp.data["round"]

        self.auth(self.admin)
        cancel = self.client.post(
            f"/api/orders/packing-rounds/{round_id}/cancel/", {}, format="json"
        )
        self.assertEqual(cancel.status_code, status.HTTP_200_OK, cancel.data)

        # Reversal goes through the ordinary cancel path, which is the point: the
        # shortcut created a round like any other, not a private ledger entry.
        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, ZERO)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2400.000"))
        self.assertTrue(
            OrderLog.objects.filter(
                order_ref=self.order.pk, action="ALLOCATION_REVERSED"
            ).exists()
        )


class PackLineQuantityTests(OrderTestBase):
    """The packed figure is whatever was actually cut, in every direction.

    A roll is cut whole, so the metres handed over are not bounded by what the
    line was ordered for: the warehouse may cut short, land exactly on the figure,
    or overshoot and keep the surplus. Whatever is entered has to be what is
    stored, returned and displayed, and the still-owed remainder is floored at
    zero rather than turned into a negative.
    """

    def setUp(self):
        super().setUp()
        self.order = self.make_draft()
        self.line = self.add_line(self.order, 50)
        self.place(self.order)

    def pack(self, metres):
        self.auth(self.admin)
        return self.client.post(
            f"/api/orders/{self.order.pk}/items/{self.line.pk}/pack/",
            {"metres": str(metres)},
            format="json",
        )

    def cancel_round(self, round_id):
        self.auth(self.admin)
        return self.client.post(
            f"/api/orders/packing-rounds/{round_id}/cancel/", {}, format="json"
        )

    def test_packing_past_the_ordered_figure_keeps_every_metre(self):
        resp = self.pack(55)

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

        # All 55 m came off the roll, not just the 50 m that were ordered.
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2345.000"))

        # And all 55 m are recorded against the line, with the surplus kept.
        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("55.000"))
        self.assertEqual(Allocation.objects.get().metres, Decimal("55.000"))

        # The line is satisfied, so nothing is owed and the gap never goes
        # negative.
        self.assertEqual(self.line.outstanding_quantity, Decimal("0.000"))

        # The response reports the real figures, not a figure capped at ordered.
        self.assertEqual(resp.data["item"]["allocated_quantity"], "55.000")
        self.assertEqual(resp.data["item"]["outstanding_quantity"], "0.000")
        self.assertEqual(resp.data["stock_meters"], "2345.000")

        # The order is settled, and its own totals carry the real packed figure.
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "PACKED")
        totals = order_totals(self.order)
        self.assertEqual(totals["total_ordered_meters"], Decimal("50.000"))
        self.assertEqual(totals["total_allocated_meters"], Decimal("55.000"))
        self.assertEqual(totals["total_outstanding_meters"], ZERO)

    def test_packing_short_leaves_the_difference_owed(self):
        resp = self.pack(49)

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2351.000"))

        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("49.000"))
        self.assertEqual(self.line.outstanding_quantity, Decimal("1.000"))
        self.assertEqual(Allocation.objects.get().metres, Decimal("49.000"))

        self.assertEqual(resp.data["item"]["allocated_quantity"], "49.000")
        self.assertEqual(resp.data["item"]["outstanding_quantity"], "1.000")
        self.assertEqual(resp.data["order_status"], "PENDING")

    def test_packing_exactly_the_ordered_figure_settles_the_line(self):
        resp = self.pack(50)

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("50.000"))
        self.assertEqual(self.line.outstanding_quantity, ZERO)
        self.assertEqual(resp.data["item"]["allocated_quantity"], "50.000")

    def test_a_long_pack_can_be_cut_back_down_by_repacking(self):
        """A roll cut too long is corrected by cancelling and re-packing.

        The engine has no in-place decrease -- ``pack_line`` only ever adds -- so
        the supported way to land on a smaller figure is to reverse the round
        (which credits the metres back to the roll) and pack the new figure.
        """
        first = self.pack(55)
        self.assertEqual(first.status_code, status.HTTP_200_OK, first.data)

        cancelled = self.cancel_round(first.data["round"])
        self.assertEqual(cancelled.status_code, status.HTTP_200_OK, cancelled.data)

        # The 55 m are back on the roll and off the line.
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2400.000"))
        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, ZERO)

        second = self.pack(52)
        self.assertEqual(second.status_code, status.HTTP_200_OK, second.data)

        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2348.000"))
        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("52.000"))
        self.assertEqual(self.line.outstanding_quantity, ZERO)
        self.assertEqual(second.data["item"]["allocated_quantity"], "52.000")

    def test_a_long_pack_is_still_limited_by_the_roll(self):
        """Over-packing has no ceiling but the metres physically on the roll."""
        resp = self.pack(2600)

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, ZERO)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2400.000"))


class PackSingleLineConcurrencyTests(TransactionTestCase):
    """The order page and the packing board must not both spend the same roll.

    ``TestCase`` wraps each test in a transaction that ``select_for_update``
    cannot meaningfully contend with, so this runs on ``TransactionTestCase``
    with two real connections racing.
    """

    reset_sequences = True

    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin1", email="admin1@test.com",
            password="pass1234", role="ADMIN",
        )
        self.agent_user = User.objects.create_user(
            username="agent1", email="agent1@test.com",
            password="pass1234", role="AGENT",
        )
        agent = Agent.objects.create(user=self.agent_user, contact="111")
        customer = Customer.objects.create(
            name="ABC Fashions", contact="2222222222", agent=agent
        )
        self.fabric = Fabric.objects.create(
            name="Cotton Cambric 140 GSM", price_per_meter=Decimal("9.00")
        )
        self.variant = FabricVariant.objects.create(
            fabric=self.fabric,
            display_order="Natural",
            stock_meters=Decimal("1000.000"),
        )
        AgentItem.objects.create(agent=agent, variant=self.variant)

        self.order = Order.objects.create(
            customer=customer, agent=agent, created_by=self.agent_user, status="PENDING"
        )
        self.line = OrderItem.objects.create(
            order=self.order,
            fabric=self.fabric,
            variant=self.variant,
            fabric_name=self.fabric.name,
            rate_per_meter=self.fabric.price_per_meter,
            variant_display_order=self.variant.display_order,
            ordered_quantity=Decimal("1000.000"),
        )
        recompute_order_total(self.order)

    def test_packing_from_order_page_and_packing_round_screen_lock_correctly_under_concurrency(self):
        # 800 + 800 against 1000 m: without the row lock both requests read the
        # same stock and the roll would go overdrawn.
        single_line_url = f"/api/orders/{self.order.pk}/items/{self.line.pk}/pack/"
        board_round = PackingRound.objects.create(
            variant=self.variant,
            round_size=Decimal("800.000"),
            status="DRAFT",
            note="Board round racing the order page",
            plan_override=[{"order_item": self.line.pk, "metres": "800"}],
            created_by=self.admin,
        )
        header_a = get_auth_header(self.admin)
        header_b = get_auth_header(self.admin)
        barrier = threading.Barrier(2)
        statuses = []
        guard = threading.Lock()

        def pack(url, header, body):
            client = APIClient()
            client.credentials(**header)
            try:
                barrier.wait(timeout=20)
                resp = client.post(url, body, format="json")
                code = resp.status_code
            except Exception as exc:  # pragma: no cover - surfaced in the assert
                code = repr(exc)
            finally:
                connections.close_all()
            with guard:
                statuses.append(code)

        threads = [
            threading.Thread(
                target=pack, args=(single_line_url, header_a, {"metres": "800"})
            ),
            threading.Thread(
                target=pack,
                args=(
                    f"/api/orders/packing-rounds/{board_round.pk}/confirm/",
                    header_b,
                    {},
                ),
            ),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)

        self.assertEqual(len(statuses), 2, statuses)
        self.assertEqual(
            statuses.count(status.HTTP_200_OK), 1, f"both or neither may win: {statuses}"
        )
        self.assertEqual(
            statuses.count(status.HTTP_400_BAD_REQUEST), 1, f"one must be refused: {statuses}"
        )

        # The invariant that matters: the roll never goes overdrawn and the line
        # is never filled past what the customer ordered.
        self.variant.refresh_from_db()
        self.line.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("200.000"))
        self.assertEqual(self.line.allocated_quantity, Decimal("800.000"))
        self.assertEqual(self.line.outstanding_quantity, Decimal("200.000"))


class PackSingleLineRollConcurrencyTests(TransactionTestCase):
    """Two packs naming the same rolls must not overdraw them.

    Same shape as :class:`PackSingleLineConcurrencyTests`, but on a colour tracked
    by physical rolls, where the metres are cut off named ``FabricRoll`` rows. Both
    requests therefore name the *same* rolls, which is exactly the case where an
    unlocked read would let both believe the cloth was still there.
    """

    reset_sequences = True

    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin1", email="admin1@test.com",
            password="pass1234", role="ADMIN",
        )
        self.agent_user = User.objects.create_user(
            username="agent1", email="agent1@test.com",
            password="pass1234", role="AGENT",
        )
        agent = Agent.objects.create(user=self.agent_user, contact="111")
        customer = Customer.objects.create(
            name="ABC Fashions", contact="2222222222", agent=agent
        )
        self.fabric = Fabric.objects.create(
            name="Cotton Cambric 140 GSM", price_per_meter=Decimal("9.00")
        )
        self.variant = FabricVariant.objects.create(
            fabric=self.fabric,
            display_order="Natural",
            stock_meters=Decimal("0.000"),
        )
        AgentItem.objects.create(agent=agent, variant=self.variant)

        # 600 + 400 + 100 = 1100 m on hand, so 700 + 700 cannot both be granted:
        # the second request has to be refused rather than left to overdraw
        # whichever rolls the first one already took from.
        from apps.items.rolls import receive_roll

        self.rolls = [
            receive_roll(self.variant, Decimal("600")),
            receive_roll(self.variant, Decimal("400")),
            receive_roll(self.variant, Decimal("100")),
        ]

        self.order = Order.objects.create(
            customer=customer, agent=agent, created_by=self.agent_user, status="PENDING"
        )
        self.line = OrderItem.objects.create(
            order=self.order,
            fabric=self.fabric,
            variant=self.variant,
            fabric_name=self.fabric.name,
            rate_per_meter=self.fabric.price_per_meter,
            variant_display_order=self.variant.display_order,
            ordered_quantity=Decimal("1000.000"),
        )
        recompute_order_total(self.order)

    def test_racing_packs_over_shared_candidate_rolls_stay_safe(self):
        # 700 + 700 against 1100 m, both naming the same two rolls. Both requests
        # read those rolls' remaining_meters at the same moment, and the loser must
        # be refused rather than left to overdraw what the winner already took.
        url = f"/api/orders/{self.order.pk}/items/{self.line.pk}/pack/"
        payload = {
            "metres": "700",
            "rolls": [
                {"roll": self.rolls[0].pk, "metres": "600"},
                {"roll": self.rolls[2].pk, "metres": "100"},
            ],
        }
        header_a = get_auth_header(self.admin)
        header_b = get_auth_header(self.admin)
        barrier = threading.Barrier(2)
        statuses = []
        guard = threading.Lock()

        def pack(header):
            client = APIClient()
            client.credentials(**header)
            try:
                barrier.wait(timeout=20)
                resp = client.post(url, payload, format="json")
                code = resp.status_code
            except Exception as exc:  # pragma: no cover - surfaced in the assert
                code = repr(exc)
            finally:
                connections.close_all()
            with guard:
                statuses.append(code)

        threads = [
            threading.Thread(target=pack, args=(header,))
            for header in (header_a, header_b)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)

        # The line only owes 1000 m, so it can be filled once: one request wins and
        # the other is refused.
        self.assertEqual(len(statuses), 2, statuses)
        self.assertEqual(statuses.count(status.HTTP_200_OK), 1, statuses)
        self.assertEqual(statuses.count(status.HTTP_400_BAD_REQUEST), 1, statuses)

        self.variant.refresh_from_db()
        self.line.refresh_from_db()

        # No roll was left negative, the recorded cuts equal the metres actually
        # granted, and the warehouse total still agrees with the rolls.
        from apps.items.models import FabricRoll
        from apps.items.rolls import roll_invariant_holds
        from apps.orders.models import RollAllocation

        remaining = list(
            FabricRoll.objects.filter(variant=self.variant).values_list(
                "remaining_meters", flat=True
            )
        )
        self.assertTrue(all(value >= Decimal("0.000") for value in remaining), remaining)
        # 1100 received less the single granted pack.
        self.assertEqual(
            sum(remaining), Decimal("400.000")
        )
        self.assertEqual(self.variant.stock_meters, Decimal("400.000"))
        self.assertTrue(roll_invariant_holds(self.variant))
        self.assertEqual(self.line.allocated_quantity, Decimal("700.000"))
        self.assertEqual(
            sum(
                RollAllocation.objects.filter(
                    allocation__order_item=self.line
                ).values_list("metres", flat=True),
                Decimal("0.000"),
            ),
            Decimal("700.000"),
        )


class ScanRollPackingTests(OrderTestBase):
    """A scanned roll label fills the line it was scanned against, and only it.

    The label carries a ``FabricRoll`` primary key, so a scan is specific: it names
    one physical roll of one colour. These tests pin what the admin sees when the
    label is right, and that a wrong, spent or foreign label is refused with
    something worth reading rather than quietly packing the wrong cloth.
    """

    def setUp(self):
        super().setUp()
        from apps.items.rolls import receive_roll

        # The colour under test is tracked by rolls, so its warehouse total is the
        # sum of the rolls rather than a figure typed in by hand.
        FabricVariant.objects.filter(pk=self.variant.pk).update(stock_meters=ZERO)
        self.rolls = [
            receive_roll(self.variant, Decimal("600")),
            receive_roll(self.variant, Decimal("400")),
        ]
        self.variant.refresh_from_db()

        # A second colour, so a label from the wrong fabric has somewhere to be
        # scanned from.
        self.other_fabric = Fabric.objects.create(
            name="Linen 200 GSM", price_per_meter=Decimal("14.00")
        )
        self.other_variant = FabricVariant.objects.create(
            fabric=self.other_fabric,
            display_order="Ivory",
            stock_meters=Decimal("0.000"),
        )
        AgentItem.objects.create(agent=self.agent, variant=self.other_variant)
        self.other_roll = receive_roll(self.other_variant, Decimal("250"))

        self.order = self.make_draft()
        self.line = self.add_line(self.order, 1000)
        self.place(self.order)
        self.order.refresh_from_db()

    def scan_url(self, line=None):
        line = line or self.line
        return f"/api/orders/{self.order.pk}/items/{line.pk}/pack/scan-roll/"

    def undo_url(self, line=None):
        line = line or self.line
        return f"/api/orders/{self.order.pk}/items/{line.pk}/pack/undo-scan/"

    def scan(self, roll, line=None):
        self.auth(self.admin)
        return self.client.post(
            self.scan_url(line), {"roll": roll.pk}, format="json"
        )

    def test_a_scanned_roll_fills_the_line_with_that_roll_s_own_metres(self):
        roll = self.rolls[0]

        resp = self.scan(roll)

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line.refresh_from_db()
        self.order.refresh_from_db()
        roll.refresh_from_db()
        self.variant.refresh_from_db()
        # The roll is the unit: all 600 m of it went to this line, no more.
        self.assertEqual(self.line.allocated_quantity, Decimal("600.000"))
        self.assertEqual(self.line.outstanding_quantity, Decimal("400.000"))
        self.assertEqual(roll.remaining_meters, ZERO)
        self.assertFalse(roll.is_active)
        # 1000 received, 600 cut, and the warehouse total agrees with the rolls.
        self.assertEqual(self.variant.stock_meters, Decimal("400.000"))
        self.assertEqual(resp.data["stock_meters"], "400.000")
        self.assertEqual(resp.data["rolls"][0]["roll_number"], roll.roll_number)
        self.assertEqual(resp.data["rolls"][0]["metres"], "600.000")

    def test_a_scan_is_recorded_as_a_confirmed_round_naming_the_roll(self):
        roll = self.rolls[0]

        resp = self.scan(roll)

        packing_round = PackingRound.objects.get(pk=resp.data["round"])
        self.assertEqual(packing_round.status, "CONFIRMED")
        self.assertEqual(packing_round.variant, self.variant)
        self.assertEqual(packing_round.round_size, Decimal("600.000"))
        allocation = Allocation.objects.get()
        self.assertEqual(allocation.order_item, self.line)
        self.assertEqual(allocation.metres, Decimal("600.000"))
        # The round is the same audit trail a hand-approved round leaves.
        self.assertTrue(
            OrderLog.objects.filter(
                order=self.order, action="ALLOCATION_MADE"
            ).exists()
        )

    def test_two_scans_of_different_rolls_accumulate_on_the_line(self):
        self.scan(self.rolls[1])
        resp = self.scan(self.rolls[0])

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line.refresh_from_db()
        self.variant.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("1000.000"))
        self.assertEqual(self.line.outstanding_quantity, ZERO)
        self.assertEqual(self.variant.stock_meters, Decimal("0.000"))
        self.assertEqual(Allocation.objects.count(), 2)

    def test_undoing_the_last_scan_gives_only_that_roll_back(self):
        self.scan(self.rolls[0])
        self.scan(self.rolls[1])
        self.auth(self.admin)

        resp = self.client.post(self.undo_url(), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line.refresh_from_db()
        self.order.refresh_from_db()
        self.rolls[0].refresh_from_db()
        self.rolls[1].refresh_from_db()
        self.variant.refresh_from_db()
        self.assertEqual(self.rolls[1].remaining_meters, Decimal("400.000"))
        self.assertTrue(self.rolls[1].is_active)
        # The earlier scan is untouched.
        self.assertEqual(self.rolls[0].remaining_meters, ZERO)
        self.assertFalse(self.rolls[0].is_active)
        self.assertEqual(self.line.allocated_quantity, Decimal("600.000"))
        self.assertEqual(self.variant.stock_meters, Decimal("400.000"))

    def test_undo_leaves_a_hand_packed_line_alone(self):
        # Packed by hand with an explicit breakdown, then asked to undo: there is
        # no scan on this line, so there is nothing for undo to reverse.
        self.auth(self.admin)
        packed = self.client.post(
            f"/api/orders/{self.order.pk}/items/{self.line.pk}/pack/",
            {
                "metres": "500",
                "rolls": [{"roll": self.rolls[0].pk, "metres": "500"}],
            },
            format="json",
        )
        self.assertEqual(packed.status_code, status.HTTP_200_OK, packed.data)

        resp = self.client.post(self.undo_url(), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("no scan to undo", resp.data["error"])
        self.line.refresh_from_db()
        self.rolls[0].refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("500.000"))
        self.assertEqual(self.rolls[0].remaining_meters, Decimal("100.000"))

    def test_a_label_from_another_colour_is_refused_naming_both_fabrics(self):
        resp = self.scan(self.other_roll)

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Linen 200 GSM", resp.data["error"])
        self.assertIn("Cotton Cambric 140 GSM", resp.data["error"])
        self.line.refresh_from_db()
        self.other_roll.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, ZERO)
        self.assertEqual(self.other_roll.remaining_meters, Decimal("250.000"))

    def test_a_label_for_no_roll_at_all_is_refused(self):
        self.auth(self.admin)
        resp = self.client.post(self.scan_url(), {"roll": 999999}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("does not belong to any roll", resp.data["error"])

    def test_a_spent_rolls_label_is_refused(self):
        spent = self.rolls[0]
        self.scan(spent)
        # Put the line back in debt so the refusal can only be about the roll.
        self.line.allocated_quantity = ZERO
        self.line.save(update_fields=["allocated_quantity"])

        resp = self.scan(spent)

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("already been used up", resp.data["error"])
        self.assertEqual(Allocation.objects.count(), 1)

    def test_a_scan_is_refused_once_the_order_is_out_of_reach(self):
        self.order.status = "DISPATCHED"
        self.order.save(update_fields=["status"])

        resp = self.scan(self.rolls[0])

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not open for packing", resp.data["error"])
        self.rolls[0].refresh_from_db()
        self.assertEqual(self.rolls[0].remaining_meters, Decimal("600.000"))

    def test_a_line_with_no_variant_has_no_roll_to_scan(self):
        # A custom fabric line: no colour, so no roll of it exists to scan.
        custom = self.make_draft()
        custom_line = OrderItem.objects.create(
            order=custom,
            fabric=self.fabric,
            variant=None,
            fabric_name=self.fabric.name,
            rate_per_meter=self.fabric.price_per_meter,
            ordered_quantity=Decimal("100.000"),
        )
        recompute_order_total(custom)
        self.place(custom)
        self.auth(self.admin)

        resp = self.client.post(
            f"/api/orders/{custom.pk}/items/{custom_line.pk}/pack/scan-roll/",
            {"roll": self.rolls[0].pk},
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("no fabric variant", resp.data["error"])


class ScanRollConcurrencyTests(TransactionTestCase):
    """Two scans of one label must not both cut that roll.

    A roll is scanned by picking it up, so the same label can be scanned twice at
    once -- two scanners, or a retry after a dropped connection. The roll row is
    locked before its remaining length is read, so exactly one request wins and the
    other is told the roll is gone rather than overdrawing it.
    """

    reset_sequences = True

    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin1", email="admin1@test.com",
            password="pass1234", role="ADMIN",
        )
        agent_user = User.objects.create_user(
            username="agent1", email="agent1@test.com",
            password="pass1234", role="AGENT",
        )
        agent = Agent.objects.create(user=agent_user, contact="111")
        customer = Customer.objects.create(
            name="ABC Fashions", contact="2222222222", agent=agent
        )
        self.fabric = Fabric.objects.create(
            name="Cotton Cambric 140 GSM", price_per_meter=Decimal("9.00")
        )
        self.variant = FabricVariant.objects.create(
            fabric=self.fabric, display_order="Natural", stock_meters=Decimal("0.000")
        )
        AgentItem.objects.create(agent=agent, variant=self.variant)

        from apps.items.rolls import receive_roll

        self.roll = receive_roll(self.variant, Decimal("600"))

        self.order = Order.objects.create(
            customer=customer, agent=agent, created_by=agent_user, status="PENDING"
        )
        self.line = OrderItem.objects.create(
            order=self.order,
            fabric=self.fabric,
            variant=self.variant,
            fabric_name=self.fabric.name,
            rate_per_meter=self.fabric.price_per_meter,
            variant_display_order=self.variant.display_order,
            ordered_quantity=Decimal("600.000"),
        )
        recompute_order_total(self.order)

    def test_two_scans_of_the_same_roll_leave_one_winner(self):
        url = f"/api/orders/{self.order.pk}/items/{self.line.pk}/pack/scan-roll/"
        barrier = threading.Barrier(2)
        statuses = []
        guard = threading.Lock()

        def scan():
            client = APIClient()
            client.credentials(**get_auth_header(self.admin))
            try:
                barrier.wait(timeout=20)
                code = client.post(
                    url, {"roll": self.roll.pk}, format="json"
                ).status_code
            except Exception as exc:  # pragma: no cover - surfaced in the assert
                code = repr(exc)
            finally:
                connections.close_all()
            with guard:
                statuses.append(code)

        threads = [threading.Thread(target=scan) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)

        self.assertEqual(len(statuses), 2, statuses)
        self.assertEqual(statuses.count(status.HTTP_200_OK), 1, statuses)
        self.assertEqual(statuses.count(status.HTTP_400_BAD_REQUEST), 1, statuses)

        self.roll.refresh_from_db()
        self.variant.refresh_from_db()
        self.line.refresh_from_db()
        # The cloth moved once and only once.
        self.assertEqual(self.roll.remaining_meters, ZERO)
        self.assertEqual(self.variant.stock_meters, ZERO)
        self.assertEqual(self.line.allocated_quantity, Decimal("600.000"))
        self.assertEqual(Allocation.objects.count(), 1)


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


class LineRateOverrideTests(OrderTestBase):
    """A line may be billed at a rate agreed for one customer.

    The whole feature rests on one rule: the negotiated rate lands on the
    ``OrderItem`` and nowhere else. ``Fabric.price_per_meter`` -- the price every
    other customer pays -- must come out of every one of these tests unchanged,
    or the "for a dedicated customer" part is meaningless.
    """

    def setUp(self):
        super().setUp()
        self.order = self.make_draft()

    def add_line(self, order, metres, rate=None, user=None, variant=None):
        payload = {
            "qr_code": str((variant or self.variant).qr_code),
            "ordered_quantity": str(metres),
        }
        if rate is not None:
            payload["rate_override"] = rate
        self.auth(user)
        resp = self.client.post(
            f"/api/orders/{order.pk}/add-item/", payload, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        return order.items.order_by("id").last()

    def reprice(self, line, rate, user=None):
        self.auth(user)
        return self.client.patch(
            f"/api/orders/order-items/{line.pk}/",
            {"rate_override": rate},
            format="json",
        )

    # ── default behaviour is unchanged ─────────────────────────────────────

    def test_line_added_without_a_rate_is_billed_at_the_catalogue(self):
        line = self.add_line(self.order, 100)

        self.assertEqual(line.rate_per_meter, Decimal("9.00"))
        self.assertEqual(line.original_rate_per_meter, Decimal("9.00"))
        self.assertFalse(line.is_rate_overridden)
        self.assertIsNone(line.rate_overridden_by)
        self.order.refresh_from_db()
        self.assertEqual(self.order.computed_total, Decimal("900.00"))

    def test_a_rate_matching_the_catalogue_is_not_an_override(self):
        # Typing the catalogue price back in is a reset, not an override.
        line = self.add_line(self.order, 100, rate="9.00")

        self.assertFalse(line.is_rate_overridden)
        self.assertIsNone(line.rate_overridden_by)
        self.assertFalse(
            OrderLog.objects.filter(action="ITEM_RATE_OVERRIDE").exists()
        )

    # ── the negotiated rate stays on this order and nowhere else ───────────

    def test_agent_can_add_a_line_at_a_negotiated_rate(self):
        line = self.add_line(self.order, 100, rate="8.25")

        self.assertEqual(line.rate_per_meter, Decimal("8.25"))
        self.assertEqual(line.original_rate_per_meter, Decimal("9.00"))
        self.assertTrue(line.is_rate_overridden)
        self.assertEqual(line.rate_overridden_by, self.agent_user)
        self.assertIsNotNone(line.rate_overridden_at)
        self.order.refresh_from_db()
        self.assertEqual(self.order.computed_total, Decimal("825.00"))

    def test_the_catalogue_price_is_never_written(self):
        self.add_line(self.order, 100, rate="8.25")

        self.fabric.refresh_from_db()
        self.assertEqual(self.fabric.price_per_meter, Decimal("9.00"))

    def test_the_rate_does_not_leak_into_the_next_order(self):
        other_customer = Customer.objects.create(
            name="DEF Textiles", contact="3333333333", agent=self.agent
        )
        other_order = self.make_draft(customer=other_customer)

        self.add_line(self.order, 100, rate="8.25")
        line = self.add_line(other_order, 100)

        self.assertEqual(line.rate_per_meter, Decimal("9.00"))
        self.assertFalse(line.is_rate_overridden)

    def test_a_later_catalogue_change_does_not_reprice_the_line(self):
        line = self.add_line(self.order, 100, rate="8.25")

        self.fabric.price_per_meter = Decimal("11.00")
        self.fabric.save(update_fields=["price_per_meter"])

        line.refresh_from_db()
        self.assertEqual(line.rate_per_meter, Decimal("8.25"))
        self.assertEqual(line.original_rate_per_meter, Decimal("9.00"))
        self.assertTrue(line.is_rate_overridden)

    def test_the_agreed_rate_survives_being_placed(self):
        self.add_line(self.order, 100, rate="8.25")

        self.place(self.order)

        self.order.refresh_from_db()
        line = self.order.items.get()
        self.assertEqual(line.rate_per_meter, Decimal("8.25"))
        self.assertEqual(self.order.computed_total, Decimal("825.00"))

    def test_admin_may_price_above_the_catalogue(self):
        line = self.add_line(self.order, 100, rate="9.75", user=self.admin)

        self.assertEqual(line.rate_per_meter, Decimal("9.75"))
        self.assertTrue(line.is_rate_overridden)
        self.assertEqual(line.rate_overridden_by, self.admin)
        self.fabric.refresh_from_db()
        self.assertEqual(self.fabric.price_per_meter, Decimal("9.00"))

    # ── an agent may discount, never inflate ──────────────────────────────

    def test_agent_cannot_price_a_line_above_the_catalogue(self):
        self.auth()
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/add-item/",
            {
                "qr_code": str(self.variant.qr_code),
                "ordered_quantity": "100",
                "rate_override": "9.50",
            },
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("cannot be higher", str(resp.data))
        self.assertEqual(self.order.items.count(), 0)

    def test_agent_cannot_reprice_a_line_above_the_catalogue(self):
        line = self.add_line(self.order, 100)

        resp = self.reprice(line, "9.50")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        line.refresh_from_db()
        self.assertEqual(line.rate_per_meter, Decimal("9.00"))

    def test_a_rate_of_zero_is_rejected(self):
        self.auth()
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/add-item/",
            {
                "qr_code": str(self.variant.qr_code),
                "ordered_quantity": "100",
                "rate_override": "0",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("rate_override", resp.data)

    # ── repricing an existing line from the same page ──────────────────────

    def test_a_line_on_the_order_can_be_repriced(self):
        line = self.add_line(self.order, 100)

        resp = self.reprice(line, "8.00")

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        line.refresh_from_db()
        self.assertEqual(line.rate_per_meter, Decimal("8.00"))
        self.assertTrue(line.is_rate_overridden)
        self.order.refresh_from_db()
        self.assertEqual(self.order.computed_total, Decimal("800.00"))

    def test_restoring_the_catalogue_rate_clears_the_override(self):
        line = self.add_line(self.order, 100, rate="8.00")
        self.assertTrue(line.is_rate_overridden)

        resp = self.reprice(line, "9.00")

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        line.refresh_from_db()
        self.assertFalse(line.is_rate_overridden)
        self.assertIsNone(line.rate_overridden_by)
        self.assertIsNone(line.rate_overridden_at)
        self.assertTrue(
            OrderLog.objects.filter(
                order=self.order, action="ITEM_RATE_OVERRIDE_CLEARED"
            ).exists()
        )

    def test_a_reprice_alongside_a_quantity_change_takes_both(self):
        line = self.add_line(self.order, 100)
        self.auth()

        resp = self.client.patch(
            f"/api/orders/order-items/{line.pk}/",
            {"ordered_quantity": "200", "rate_override": "8.00"},
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        line.refresh_from_db()
        self.assertEqual(line.ordered_quantity, Decimal("200.000"))
        self.assertEqual(line.rate_per_meter, Decimal("8.00"))
        self.order.refresh_from_db()
        self.assertEqual(self.order.computed_total, Decimal("1600.00"))

    def test_another_agent_cannot_reprice_the_line(self):
        line = self.add_line(self.order, 100)

        resp = self.reprice(line, "1.00", user=self.other_agent_user)

        # Their queryset filters to their own orders, so the line is invisible.
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        line.refresh_from_db()
        self.assertEqual(line.rate_per_meter, Decimal("9.00"))

    def test_the_audit_columns_are_not_reachable_through_a_plain_patch(self):
        line = self.add_line(self.order, 100, rate="8.00")
        self.auth()

        resp = self.client.patch(
            f"/api/orders/order-items/{line.pk}/",
            {
                "rate_per_meter": "1.00",
                "original_rate_per_meter": "1.00",
                "rate_overridden_by": self.other_agent_user.pk,
            },
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        line.refresh_from_db()
        self.assertEqual(line.rate_per_meter, Decimal("8.00"))
        self.assertEqual(line.original_rate_per_meter, Decimal("9.00"))

    def test_a_line_whose_fabric_is_gone_cannot_be_repriced(self):
        # Fabric is SET_NULL on the line, so a hard delete leaves a rate with
        # nothing to cap it against. That has to read as a refusal, not a 500.
        line = self.add_line(self.order, 100)
        self.fabric.delete()
        self.auth()

        resp = self.reprice(line, "8.00")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        self.assertIn("no longer in the catalogue", str(resp.data))
        line.refresh_from_db()
        self.assertEqual(line.rate_per_meter, Decimal("9.00"))

    def test_a_reprice_is_audited(self):
        self.add_line(self.order, 100, rate="8.00")

        log = OrderLog.objects.filter(
            order=self.order, action="ITEM_RATE_OVERRIDE"
        ).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.details["catalog_rate"], "9.00")
        self.assertEqual(log.details["rate_per_meter"], "8.00")
        self.assertEqual(log.performed_by, self.agent_user)

    def test_adding_a_line_at_a_negotiated_rate_is_audited(self):
        self.add_line(self.order, 100, rate="8.00")

        self.assertEqual(
            OrderLog.objects.filter(
                order=self.order, action="ITEM_RATE_OVERRIDE"
            ).count(),
            1,
        )

    # ── the other edit paths must not lose the rate ───────────────────────

    def test_a_cancelled_edit_restores_the_original_rate(self):
        self.add_line(self.order, 100, rate="8.00")
        line = self.order.items.get()
        self.place(self.order)
        self.order.refresh_from_db()
        self.auth()
        self.client.post(f"/api/orders/{self.order.pk}/start-edit/", {}, format="json")
        self.order.refresh_from_db()
        self.reprice(line, "5.00")
        line.refresh_from_db()
        self.assertEqual(line.rate_per_meter, Decimal("5.00"))

        self.client.post(f"/api/orders/{self.order.pk}/cancel-edit/", {}, format="json")

        self.order.refresh_from_db()
        restored = self.order.items.get()
        self.assertEqual(restored.rate_per_meter, Decimal("8.00"))
        self.assertEqual(restored.original_rate_per_meter, Decimal("9.00"))
        self.assertEqual(restored.rate_overridden_by, self.agent_user)
        self.assertTrue(restored.is_rate_overridden)

    def test_saving_an_edit_keeps_the_agreed_rate(self):
        self.add_line(self.order, 100, rate="8.00")
        line = self.order.items.get()
        self.place(self.order)
        self.order.refresh_from_db()
        self.auth()
        self.client.post(f"/api/orders/{self.order.pk}/start-edit/", {}, format="json")
        self.reprice(line, "5.00")

        resp = self.client.post(
            f"/api/orders/{self.order.pk}/save-edit/", {}, format="json"
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        line.refresh_from_db()
        self.assertEqual(line.rate_per_meter, Decimal("5.00"))
        self.order.refresh_from_db()
        self.assertEqual(self.order.computed_total, Decimal("500.00"))

    def test_lines_priced_differently_cannot_be_merged(self):
        # Merging keeps the keeper's rate, so folding an off-rate line into a
        # catalogue one would silently reprice its metres.
        keeper = self.add_line(self.order, 100)
        drop = self.add_line(self.order, 100, rate="8.00")
        self.auth()

        resp = self.client.post(
            f"/api/orders/{self.order.pk}/merge-items/",
            {"keep_item_id": keeper.pk, "drop_item_ids": [drop.pk]},
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("different rates", str(resp.data))
        self.assertEqual(self.order.items.count(), 2)

    def test_lines_at_the_same_rate_still_merge(self):
        keeper = self.add_line(self.order, 100)
        drop = self.add_line(self.order, 100)
        self.auth()

        resp = self.client.post(
            f"/api/orders/{self.order.pk}/merge-items/",
            {"keep_item_id": keeper.pk, "drop_item_ids": [drop.pk]},
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.items.get().ordered_quantity, Decimal("200.000"))

    # ── editing a line keeps the rate it was given ─────────────────────────

    def test_editing_the_quantity_keeps_an_agreed_rate(self):
        # The order page sends the colour again with every edit, so "no rate in
        # the payload" has to mean "change nothing", not "go back to catalogue".
        line = self.add_line(self.order, 100, rate="8.00")
        self.auth()

        resp = self.client.patch(
            f"/api/orders/order-items/{line.pk}/",
            {"ordered_quantity": "200", "variant": self.variant.pk},
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        line.refresh_from_db()
        self.assertEqual(line.ordered_quantity, Decimal("200.000"))
        self.assertEqual(line.rate_per_meter, Decimal("8.00"))
        self.assertEqual(line.original_rate_per_meter, Decimal("9.00"))
        self.assertEqual(line.rate_overridden_by, self.agent_user)
        self.assertTrue(line.is_rate_overridden)
        self.order.refresh_from_db()
        self.assertEqual(self.order.computed_total, Decimal("1600.00"))

    def test_a_catalogue_line_stays_at_the_catalogue_after_an_edit(self):
        line = self.add_line(self.order, 100)
        self.auth()

        self.client.patch(
            f"/api/orders/order-items/{line.pk}/",
            {"ordered_quantity": "200", "variant": self.variant.pk},
            format="json",
        )

        line.refresh_from_db()
        self.assertEqual(line.rate_per_meter, Decimal("9.00"))
        self.assertEqual(line.original_rate_per_meter, Decimal("9.00"))
        self.assertFalse(line.is_rate_overridden)

    def test_changing_the_colour_rebases_the_rate_snapshot(self):
        other = FabricVariant.objects.create(
            fabric=self.fabric, display_order="Black", stock_meters=Decimal("500")
        )
        line = self.add_line(self.order, 100, rate="8.00")
        self.auth()

        resp = self.client.patch(
            f"/api/orders/order-items/{line.pk}/",
            {"ordered_quantity": "100", "variant": other.pk},
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        line.refresh_from_db()
        # Different cloth with no agreed rate: the line is at catalogue, so there
        # is no difference left to report and nobody left to credit with it.
        self.assertEqual(line.variant_id, other.pk)
        self.assertEqual(line.rate_per_meter, Decimal("9.00"))
        self.assertEqual(line.original_rate_per_meter, Decimal("9.00"))
        self.assertIsNone(line.rate_overridden_by)
        self.assertIsNone(line.rate_overridden_at)
        self.assertFalse(line.is_rate_overridden)

    def test_changing_the_colour_with_a_rate_takes_the_new_rate(self):
        other = FabricVariant.objects.create(
            fabric=self.fabric, display_order="Black", stock_meters=Decimal("500")
        )
        line = self.add_line(self.order, 100, rate="8.00")
        self.auth()

        resp = self.client.patch(
            f"/api/orders/order-items/{line.pk}/",
            {"ordered_quantity": "100", "variant": other.pk, "rate_override": "7.50"},
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        line.refresh_from_db()
        self.assertEqual(line.rate_per_meter, Decimal("7.50"))
        self.assertEqual(line.original_rate_per_meter, Decimal("9.00"))
        self.assertEqual(line.rate_overridden_by, self.agent_user)
        self.assertTrue(line.is_rate_overridden)

    # ── the line reports what it was repriced from ─────────────────────────

    def test_the_line_serialises_the_override(self):
        line = self.add_line(self.order, 100, rate="8.00")

        self.auth()
        resp = self.client.get(f"/api/orders/{self.order.pk}/")

        payload = resp.data["items"][0]
        self.assertEqual(payload["rate_per_meter"], "8.00")
        self.assertEqual(payload["original_rate_per_meter"], "9.00")
        self.assertTrue(payload["is_rate_overridden"])
        self.assertEqual(payload["rate_overridden_by"], "agent1")
        self.assertIsNotNone(payload["rate_overridden_at"])
        self.assertEqual(payload["line_total"], "800.00")
        self.assertNotIn("rate_override", payload)

