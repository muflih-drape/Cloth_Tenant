"""Order lifecycle tests for the metre domain.

The invariant that shapes almost everything here: **placing an order records
demand and never moves cloth**. Stock only changes when a packing round is
confirmed, and comes back when that round is cancelled or an undispatched order
is deleted. So "2400 m on hand, two 1400 m orders" is a legal, expected state.
"""

from decimal import Decimal
import threading
from unittest import mock

from django.contrib.auth import get_user_model
from django.db import connections, transaction
from django.test import TestCase, TransactionTestCase
from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.agents.models import Agent, AgentItem
from apps.customers.models import Customer
from apps.items.models import Fabric, FabricRoll, FabricVariant
from apps.orders.models import (
    Allocation,
    Order,
    OrderItem,
    OrderLog,
    PackingBundle,
    PackingRound,
    RollAllocation,
)
from apps.orders.pricing import order_totals, recompute_order_total
from transports.models import Transport

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


class PackingBundleTests(OrderTestBase):
    """The bundle is the unit of handover: open it, scan rolls in, seal it.

    Every assertion here is about what a warehouse worker actually gets. A scan
    must land on the right line without anyone picking it, the box must list what
    is in it, a mistake must be undoable roll by roll until the bundle is sealed,
    and after sealing the contents must not change at all.
    """

    def setUp(self):
        super().setUp()
        from apps.items.rolls import receive_roll

        self.customer.address = "14 Mill Lane, Coimbatore"
        self.customer.save(update_fields=["address"])

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

    # -- helpers -----------------------------------------------------------

    def bundles_url(self, order=None):
        order = order or self.order
        return f"/api/orders/{order.pk}/bundles/"

    def open_bundle(self, order=None):
        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{(order or self.order).pk}/bundles/create/", {}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        return resp.data["bundle"]

    def scan_url(self, bundle, order=None):
        order = order or self.order
        return f"/api/orders/{order.pk}/bundles/{bundle['id']}/scan/"

    def scan(self, roll, bundle=None, order=None):
        bundle = bundle or self.open_bundle(order)
        self.auth(self.admin)
        resp = self.client.post(
            self.scan_url(bundle, order), {"roll": roll.pk}, format="json"
        )
        return bundle, resp

    # -- creating ----------------------------------------------------------

    def test_creating_a_bundle_numbers_it_within_the_order_and_leaves_it_open(self):
        first = self.open_bundle()

        self.assertEqual(first["number"], 1)
        self.assertEqual(first["status"], "OPEN")
        self.assertEqual(first["rolls"], [])
        self.assertEqual(first["roll_count"], 0)
        # The code is what the slip prints and what a worker reads out.
        self.assertEqual(first["code"], f"Order #{self.order.pk} -- Bundle 1")
        # Nothing has moved, so nothing about the order has changed.
        self.assertEqual(self.line.allocated_quantity, ZERO)

    def test_a_second_open_bundle_is_refused_while_one_is_still_open(self):
        first = self.open_bundle()
        self.auth(self.admin)

        resp = self.client.post(self.bundles_url() + "create/", {}, format="json")

        # Two open boxes would both have to be worked on at once, and the panel
        # drives one, so the second is refused rather than left where nobody finds it.
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("already has", resp.data["error"])
        self.assertIn(first["code"], resp.data["error"])
        self.assertEqual(PackingBundle.objects.filter(status="OPEN").count(), 1)

    def test_numbering_carries_on_after_the_previous_bundle_is_closed(self):
        first = self.open_bundle()
        self.auth(self.admin)
        self.client.post(
            f"/api/orders/{self.order.pk}/bundles/{first['id']}/cancel/",
            {},
            format="json",
        )

        second = self.open_bundle()

        # The counter is per order and never reuses a number, so the slip for the
        # cancelled bundle and the slip for this one cannot be confused.
        self.assertEqual(second["number"], 2)
        self.assertEqual(second["code"], f"Order #{self.order.pk} -- Bundle 2")
        self.assertEqual(PackingBundle.objects.count(), 2)

    def test_bundles_are_listed_with_their_rolls_so_a_slip_can_be_reprinted(self):
        bundle, resp = self.scan(self.rolls[0])

        listing = self.client.get(self.bundles_url())

        self.assertEqual(listing.status_code, status.HTTP_200_OK, listing.data)
        self.assertEqual(len(listing.data), 1)
        entry = listing.data[0]
        self.assertEqual(entry["id"], bundle["id"])
        self.assertEqual(entry["roll_count"], 1)
        self.assertEqual(entry["rolls"][0]["roll_number"], self.rolls[0].roll_number)
        # The slip needs the customer's delivery details, which ride along.
        self.assertEqual(entry["customer"], "ABC Fashions")
        self.assertEqual(entry["customer_address"], "14 Mill Lane, Coimbatore")

    def test_a_bundle_cannot_be_opened_on_an_order_that_is_out_of_reach(self):
        self.order.status = "DISPATCHED"
        self.order.save(update_fields=["status"])
        self.auth(self.admin)

        resp = self.client.post(self.bundles_url() + "create/", {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not open for packing", resp.data["error"])

    # -- scanning ----------------------------------------------------------

    def test_a_scan_fills_the_matching_line_with_that_roll_s_own_metres(self):
        roll = self.rolls[0]

        bundle, resp = self.scan(roll)

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["item_id"], self.line.pk)
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
        # ...and the bundle now lists it.
        self.assertEqual(bundle["roll_count"], 0)
        self.assertEqual(resp.data["bundle"]["roll_count"], 1)
        listed = resp.data["bundle"]["rolls"][0]
        self.assertEqual(listed["roll"], roll.pk)
        self.assertEqual(listed["metres"], "600.000")
        self.assertEqual(listed["colour"], "Natural")
        self.assertEqual(listed["fabric"], self.fabric.name)

    def test_a_scan_is_recorded_as_a_confirmed_round_naming_the_roll(self):
        _, resp = self.scan(self.rolls[0])

        packing_round = PackingRound.objects.get(pk=resp.data["bundle"]["rolls"][0]["round"])
        self.assertEqual(packing_round.status, "CONFIRMED")
        self.assertEqual(packing_round.variant, self.variant)
        self.assertEqual(packing_round.round_size, Decimal("600.000"))
        allocation = Allocation.objects.get()
        self.assertEqual(allocation.order_item, self.line)
        self.assertEqual(allocation.metres, Decimal("600.000"))
        # The roll is tagged with the bundle it went into, so the box and the stock
        # movement can be traced to each other.
        self.assertEqual(allocation.roll_allocations.get().bundle_id, resp.data["bundle"]["id"])
        # The round is the same audit trail a hand-approved round leaves.
        self.assertTrue(
            OrderLog.objects.filter(
                order=self.order, action="ALLOCATION_MADE"
            ).exists()
        )

    def test_two_scans_of_different_rolls_accumulate_on_the_line(self):
        bundle = self.open_bundle()

        self.scan(self.rolls[1], bundle)
        _, resp = self.scan(self.rolls[0], bundle)

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.line.refresh_from_db()
        self.variant.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("1000.000"))
        self.assertEqual(self.line.outstanding_quantity, ZERO)
        self.assertEqual(self.variant.stock_meters, Decimal("0.000"))
        self.assertEqual(Allocation.objects.count(), 2)
        self.assertEqual(resp.data["bundle"]["total_metres"], "1000.000")

    def test_a_bundle_may_mix_colours_from_the_same_order(self):
        self.add_line(self.order, 250, variant=self.other_variant)
        recompute_order_total(self.order)
        bundle = self.open_bundle()

        self.scan(self.rolls[0], bundle)
        _, resp = self.scan(self.other_roll, bundle)

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["bundle"]["roll_count"], 2)
        fabrics = {row["fabric"] for row in resp.data["bundle"]["rolls"]}
        self.assertEqual(fabrics, {self.fabric.name, self.other_fabric.name})
        # Each roll landed on the line that wanted its colour.
        self.other_roll.refresh_from_db()
        self.assertEqual(self.other_roll.remaining_meters, ZERO)

    def test_a_scanned_roll_goes_to_the_first_outstanding_line_of_its_colour(self):
        # The same colour listed twice. The earlier line is filled first, and the
        # choice is reversible because the roll can be taken back out.
        second = self.add_line(self.order, 500)
        recompute_order_total(self.order)

        _, resp = self.scan(self.rolls[0])

        self.assertEqual(resp.data["item_id"], self.line.pk)
        self.line.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("600.000"))
        self.assertEqual(second.allocated_quantity, ZERO)

    def test_a_label_from_a_colour_the_order_does_not_want_is_refused(self):
        _, resp = self.scan(self.other_roll)

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("has no line for Linen 200 GSM", resp.data["error"])
        self.other_roll.refresh_from_db()
        self.assertEqual(self.other_roll.remaining_meters, Decimal("250.000"))
        self.assertEqual(Allocation.objects.count(), 0)

    def test_a_foreign_label_is_refused_mid_bundle_and_leaves_the_box_alone(self):
        # The bundle is already part-built, so the refusal has to cost nothing:
        # no stock moves, no allocation is written, and what is already in the box
        # is still in the box.
        bundle = self.open_bundle()
        self.scan(self.rolls[0], bundle)
        bundle_id = bundle["id"]

        _, resp = self.scan(self.other_roll, bundle)

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("has no line for Linen 200 GSM", resp.data["error"])
        # The refused roll never left its own roll.
        self.other_roll.refresh_from_db()
        self.assertEqual(self.other_roll.remaining_meters, Decimal("250.000"))
        self.assertTrue(self.other_roll.is_active)
        self.assertEqual(Allocation.objects.count(), 1)
        self.assertEqual(
            RollAllocation.objects.filter(is_reversed=False).count(), 1
        )
        # And the bundle still holds exactly the one roll that was wanted.
        listing = self.client.get(self.bundles_url())
        self.assertEqual(listing.data[0]["id"], bundle_id)
        self.assertEqual(listing.data[0]["roll_count"], 1)
        self.assertEqual(listing.data[0]["rolls"][0]["roll"], self.rolls[0].pk)

    def test_packing_a_roll_by_scan_takes_the_cloth_off_it_immediately(self):
        # The bundle tag on the RollAllocation is bookkeeping; the stock movement is
        # what the scan is for, and it must not wait for the bundle to be sealed.
        roll = self.rolls[0]
        self.assertEqual(roll.remaining_meters, Decimal("600"))
        self.assertTrue(roll.is_active)
        self.assertEqual(self.variant.stock_meters, Decimal("1000.000"))

        _, resp = self.scan(roll)

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        roll.refresh_from_db()
        self.variant.refresh_from_db()
        # A whole roll is cut, so nothing is left on it and it stops being stock.
        self.assertEqual(roll.remaining_meters, ZERO)
        self.assertFalse(roll.is_active)
        # 600 m off a 1000 m colour, which is the sum of the two active rolls.
        self.assertEqual(self.variant.stock_meters, Decimal("400.000"))
        self.assertEqual(
            sum(FabricRoll.objects.filter(variant=self.variant, is_active=True)
                .values_list("remaining_meters", flat=True)),
            Decimal("400.000"),
        )
        # Sealing the box changes nothing about the stock: it was already moved.
        self.auth(self.admin)
        sealed = self.client.post(self.seal_url(resp.data["bundle"]), {}, format="json")
        self.assertEqual(sealed.status_code, status.HTTP_200_OK, sealed.data)
        roll.refresh_from_db()
        self.variant.refresh_from_db()
        self.assertEqual(roll.remaining_meters, ZERO)
        self.assertFalse(roll.is_active)
        self.assertEqual(self.variant.stock_meters, Decimal("400.000"))

    def test_a_label_for_no_roll_at_all_is_refused(self):
        bundle = self.open_bundle()
        self.auth(self.admin)

        resp = self.client.post(
            self.scan_url(bundle), {"roll": 999999}, format="json"
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("does not belong to any roll", resp.data["error"])

    def test_a_spent_rolls_label_is_refused(self):
        spent = self.rolls[0]
        bundle = self.open_bundle()
        self.scan(spent, bundle)
        # Put the line back in debt so the refusal can only be about the roll.
        self.line.allocated_quantity = ZERO
        self.line.save(update_fields=["allocated_quantity"])

        _, resp = self.scan(spent, bundle)

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("already been used up", resp.data["error"])
        self.assertEqual(Allocation.objects.count(), 1)

    def test_a_scan_is_refused_once_the_order_is_out_of_reach(self):
        bundle = self.open_bundle()
        self.order.status = "DISPATCHED"
        self.order.save(update_fields=["status"])

        _, resp = self.scan(self.rolls[0], bundle)

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not open for packing", resp.data["error"])
        self.rolls[0].refresh_from_db()
        self.assertEqual(self.rolls[0].remaining_meters, Decimal("600.000"))

    # -- removing one roll -------------------------------------------------

    def remove_url(self, bundle, entry_id):
        return (
            f"/api/orders/{self.order.pk}/bundles/{bundle['id']}/rolls/"
            f"{entry_id}/remove/"
        )

    def test_removing_one_roll_leaves_the_rest_of_the_bundle_standing(self):
        bundle = self.open_bundle()
        self.scan(self.rolls[0], bundle)
        _, resp = self.scan(self.rolls[1], bundle)
        bundle = resp.data["bundle"]
        first_entry = bundle["rolls"][0]["id"]
        self.auth(self.admin)

        resp = self.client.post(self.remove_url(bundle, first_entry), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line.refresh_from_db()
        self.rolls[0].refresh_from_db()
        self.rolls[1].refresh_from_db()
        self.variant.refresh_from_db()
        # The removed roll is whole again and on the shelf...
        self.assertEqual(self.rolls[0].remaining_meters, Decimal("600.000"))
        self.assertTrue(self.rolls[0].is_active)
        self.assertEqual(self.variant.stock_meters, Decimal("600.000"))
        # ...while the other roll keeps its place in the box.
        self.assertEqual(self.rolls[1].remaining_meters, ZERO)
        self.assertEqual(self.line.allocated_quantity, Decimal("400.000"))
        self.assertEqual(resp.data["bundle"]["roll_count"], 1)
        self.assertEqual(resp.data["bundle"]["rolls"][0]["roll"], self.rolls[1].pk)

    def test_a_removed_roll_can_be_scanned_into_the_bundle_again(self):
        bundle = self.open_bundle()
        _, resp = self.scan(self.rolls[0], bundle)
        entry_id = resp.data["bundle"]["rolls"][0]["id"]
        self.auth(self.admin)
        self.client.post(self.remove_url(bundle, entry_id), {}, format="json")

        _, again = self.scan(self.rolls[0], bundle)

        self.assertEqual(again.status_code, status.HTTP_201_CREATED, again.data)
        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("600.000"))
        self.assertEqual(again.data["bundle"]["roll_count"], 1)

    def test_removing_a_roll_that_is_not_in_this_bundle_is_refused(self):
        bundle = self.open_bundle()
        # Packed by hand, which puts the roll in a box of its own rather than in this
        # one -- so it belongs to some other bundle, not to this bundle.
        self.auth(self.admin)
        packed = self.client.post(
            f"/api/orders/{self.order.pk}/items/{self.line.pk}/pack/",
            {
                "metres": "600",
                "rolls": [{"roll": self.rolls[0].pk, "metres": "600"}],
                "note": "Packed by hand",
            },
            format="json",
        )
        self.assertEqual(packed.status_code, status.HTTP_200_OK, packed.data)
        loose = RollAllocation.objects.get(roll=self.rolls[0], is_reversed=False)
        self.assertNotEqual(loose.bundle_id, bundle["id"])
        self.assertEqual(PackingBundle.objects.get(pk=loose.bundle_id).status, "SEALED")

        resp = self.client.post(self.remove_url(bundle, loose.pk), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("does not contain that roll", resp.data["error"])

    # -- cancelling the whole bundle ---------------------------------------

    def test_cancelling_a_bundle_returns_every_roll_it_holds(self):
        bundle = self.open_bundle()
        self.scan(self.rolls[0], bundle)
        _, resp = self.scan(self.rolls[1], bundle)
        bundle = resp.data["bundle"]
        self.auth(self.admin)

        resp = self.client.post(
            f"/api/orders/{self.order.pk}/bundles/{bundle['id']}/cancel/",
            {},
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.line.refresh_from_db()
        self.order.refresh_from_db()
        self.variant.refresh_from_db()
        for roll in self.rolls:
            roll.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, ZERO)
        self.assertEqual(self.variant.stock_meters, Decimal("1000.000"))
        self.assertEqual(self.rolls[0].remaining_meters, Decimal("600.000"))
        self.assertEqual(self.rolls[1].remaining_meters, Decimal("400.000"))
        self.assertEqual(resp.data["bundle"]["status"], "CANCELLED")
        self.assertEqual(resp.data["bundle"]["roll_count"], 0)
        self.assertEqual(resp.data["order_status"], "PENDING")

    def test_a_cancelled_bundle_is_kept_as_a_record_and_shows_up_empty(self):
        bundle = self.open_bundle()
        self.scan(self.rolls[0], bundle)
        self.auth(self.admin)

        self.client.post(
            f"/api/orders/{self.order.pk}/bundles/{bundle['id']}/cancel/",
            {},
            format="json",
        )
        listing = self.client.get(self.bundles_url())

        self.assertEqual(len(listing.data), 1)
        self.assertEqual(listing.data[0]["status"], "CANCELLED")
        self.assertEqual(listing.data[0]["rolls"], [])

    def test_an_empty_bundle_can_be_cancelled_outright(self):
        bundle = self.open_bundle()
        self.auth(self.admin)

        resp = self.client.post(
            f"/api/orders/{self.order.pk}/bundles/{bundle['id']}/cancel/",
            {},
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["bundle"]["status"], "CANCELLED")

    # -- sealing -----------------------------------------------------------

    def seal_url(self, bundle):
        return f"/api/orders/{self.order.pk}/bundles/{bundle['id']}/seal/"

    def test_sealing_stamps_the_bundle_and_freezes_its_contents(self):
        bundle, resp = self.scan(self.rolls[0])
        bundle = resp.data["bundle"]
        entry_id = bundle["rolls"][0]["id"]
        self.auth(self.admin)

        resp = self.client.post(self.seal_url(bundle), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["bundle"]["status"], "SEALED")
        self.assertIsNotNone(resp.data["bundle"]["sealed_at"])
        self.assertEqual(resp.data["bundle"]["roll_count"], 1)

        # Nothing can be added or taken out once the slip can be printed.
        added = self.client.post(
            self.scan_url(bundle), {"roll": self.rolls[1].pk}, format="json"
        )
        self.assertEqual(added.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("sealed and cannot be changed", added.data["error"])

        removed = self.client.post(self.remove_url(bundle, entry_id), {}, format="json")
        self.assertEqual(removed.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("sealed and cannot be changed", removed.data["error"])

        cancelled = self.client.post(
            f"/api/orders/{self.order.pk}/bundles/{bundle['id']}/cancel/",
            {},
            format="json",
        )
        self.assertEqual(cancelled.status_code, status.HTTP_400_BAD_REQUEST)

        # The cloth is exactly where sealing found it.
        self.line.refresh_from_db()
        self.rolls[0].refresh_from_db()
        self.rolls[1].refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("600.000"))
        self.assertEqual(self.rolls[0].remaining_meters, ZERO)
        self.assertEqual(self.rolls[1].remaining_meters, Decimal("400.000"))

    def test_an_empty_bundle_cannot_be_sealed(self):
        bundle = self.open_bundle()
        self.auth(self.admin)

        resp = self.client.post(self.seal_url(bundle), {}, format="json")

        # A slip for an empty box promises nothing, so the seal is refused and the
        # bundle is left open to be scanned into or cancelled.
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("is empty", resp.data["error"])
        row = PackingBundle.objects.get(pk=bundle["id"])
        self.assertEqual(row.status, "OPEN")
        self.assertIsNone(row.sealed_at)

    def test_sealing_twice_is_refused_rather_than_re_stamping(self):
        bundle, resp = self.scan(self.rolls[0])
        bundle = resp.data["bundle"]
        self.auth(self.admin)
        self.client.post(self.seal_url(bundle), {}, format="json")

        resp = self.client.post(self.seal_url(bundle), {}, format="json")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("already sealed", resp.data["error"])

    def test_a_sealed_bundle_slip_still_lists_its_rolls_for_a_reprint(self):
        bundle, resp = self.scan(self.rolls[0])
        self.auth(self.admin)
        self.client.post(self.seal_url(bundle), {}, format="json")

        listing = self.client.get(self.bundles_url())

        self.assertEqual(listing.data[0]["status"], "SEALED")
        self.assertEqual(listing.data[0]["roll_count"], 1)
        self.assertEqual(listing.data[0]["rolls"][0]["roll"], self.rolls[0].pk)

    # -- more than one bundle on one order ---------------------------------
    #
    # An order's cloth does not always leave in one box. Rolls are packed across
    # several bundles -- several boxes, or several sessions on different days --
    # so sealing a bundle has to leave the next one available on the same order,
    # with each bundle keeping its own contents and its own slip.

    def seal_bundle(self, bundle):
        self.auth(self.admin)
        resp = self.client.post(self.seal_url(bundle), {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        return resp.data["bundle"]

    def test_a_second_bundle_can_be_opened_and_sealed_on_the_same_order(self):
        first, resp = self.scan(self.rolls[0])
        self.seal_bundle(first)

        second = self.open_bundle()

        # The counter carries on rather than restarting, so the two slips can never
        # be mistaken for one another.
        self.assertEqual(second["number"], 2)
        self.assertEqual(second["status"], "OPEN")

        second, resp = self.scan(self.rolls[1], bundle=second)
        sealed_second = self.seal_bundle(second)

        self.assertEqual(sealed_second["number"], 2)
        self.assertEqual(sealed_second["roll_count"], 1)
        self.assertEqual(PackingBundle.objects.count(), 2)

    def test_both_sealed_bundles_keep_their_own_rolls_and_totals(self):
        first, _ = self.scan(self.rolls[0])
        self.seal_bundle(first)
        second = self.open_bundle()
        second, _ = self.scan(self.rolls[1], bundle=second)
        self.seal_bundle(second)

        listing = self.client.get(self.bundles_url())

        self.assertEqual(len(listing.data), 2)
        one, two = listing.data
        self.assertEqual([one["number"], two["number"]], [1, 2])
        self.assertEqual(one["status"], "SEALED")
        self.assertEqual(two["status"], "SEALED")
        # Independent contents: neither bundle has grown the other's roll, which is
        # what makes each slip a true statement about its own box.
        self.assertEqual([r["roll"] for r in one["rolls"]], [self.rolls[0].pk])
        self.assertEqual([r["roll"] for r in two["rolls"]], [self.rolls[1].pk])
        self.assertEqual(one["roll_count"], 1)
        self.assertEqual(two["roll_count"], 1)
        self.assertEqual(one["total_metres"], "600.000")
        self.assertEqual(two["total_metres"], "400.000")

    def test_a_sealed_bundle_still_refuses_a_late_scan(self):
        # Sealing Bundle 1 must not open it back up just because Bundle 2 exists.
        first, _ = self.scan(self.rolls[0])
        self.seal_bundle(first)
        self.open_bundle()
        self.auth(self.admin)

        resp = self.client.post(
            self.scan_url(first), {"roll": self.rolls[1].pk}, format="json"
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("sealed", resp.data["error"].lower())

    def test_opening_a_third_bundle_still_needs_only_one_box_open(self):
        first, _ = self.scan(self.rolls[0])
        self.seal_bundle(first)
        second = self.open_bundle()
        self.scan(self.rolls[1], bundle=second)
        self.auth(self.admin)

        resp = self.client.post(self.bundles_url() + "create/", {}, format="json")

        # Blocking, not auto-sealing: a half-filled box must never be sealed off
        # behind the packer's back, so the third bundle is refused by name.
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn(second["code"], resp.data["error"])
        self.assertIn("Seal or cancel", resp.data["error"])
        self.assertEqual(
            PackingBundle.objects.filter(status="OPEN").count(), 1
        )
        # And the two sealed ones are untouched by the refusal.
        self.assertEqual(PackingBundle.objects.filter(status="SEALED").count(), 1)

    def test_cancelling_a_second_bundle_leaves_the_first_sealed_one_alone(self):
        first, _ = self.scan(self.rolls[0])
        self.seal_bundle(first)
        second = self.open_bundle()
        self.scan(self.rolls[1], bundle=second)
        self.auth(self.admin)

        self.client.post(
            f"/api/orders/{self.order.pk}/bundles/{second['id']}/cancel/",
            {},
            format="json",
        )

        rows = {row.number: row for row in PackingBundle.objects.all()}
        # The cancelled box gave its roll back; the sealed one did not.
        self.assertEqual(rows[1].status, "SEALED")
        self.assertEqual(rows[2].status, "CANCELLED")
        self.assertEqual(rows[1].roll_allocations.count(), 1)

    def test_sealing_does_not_by_itself_change_the_orders_packing_status(self):
        # An open bundle is just a container. What decides PACKED is still whether
        # every line has been fully packed, so sealing half a box leaves the order
        # exactly where it was.
        bundle, _ = self.scan(self.rolls[0])
        self.auth(self.admin)

        self.client.post(self.seal_url(bundle), {}, format="json")

        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "PENDING")

    # -- pricing on the slip ----------------------------------------------

    def test_the_slip_totals_are_computed_at_the_line_s_own_rate(self):
        # A rate agreed with this customer, snapshotted onto the line.
        self.line.rate_per_meter = Decimal("7.25")
        self.line.save(update_fields=["rate_per_meter"])
        bundle = self.open_bundle()

        _, resp = self.scan(self.rolls[0], bundle)

        row = resp.data["bundle"]["rolls"][0]
        self.assertEqual(row["rate_per_meter"], "7.25")
        self.assertEqual(row["value"], "4350.00")
        self.assertEqual(resp.data["bundle"]["total_value"], "4350.00")


class PackingBundleConcurrencyTests(TransactionTestCase):
    """Two scanners, one bundle.

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

    def open_bundle(self):
        client = APIClient()
        client.credentials(**get_auth_header(self.admin))
        resp = client.post(
            f"/api/orders/{self.order.pk}/bundles/create/", {}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        connections.close_all()
        return resp.data["bundle"]

    def test_two_scans_of_the_same_roll_leave_one_winner(self):
        bundle = self.open_bundle()
        url = f"/api/orders/{self.order.pk}/bundles/{bundle['id']}/scan/"
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
        self.assertEqual(statuses.count(status.HTTP_201_CREATED), 1, statuses)
        self.assertEqual(statuses.count(status.HTTP_400_BAD_REQUEST), 1, statuses)

        self.roll.refresh_from_db()
        self.variant.refresh_from_db()
        self.line.refresh_from_db()
        # The cloth moved once and only once.
        self.assertEqual(self.roll.remaining_meters, ZERO)
        self.assertEqual(self.variant.stock_meters, ZERO)
        self.assertEqual(self.line.allocated_quantity, Decimal("600.000"))
        self.assertEqual(Allocation.objects.count(), 1)

    def test_a_scan_arriving_after_a_seal_is_refused_rather_than_applied(self):
        from apps.items.rolls import receive_roll

        spare = receive_roll(self.variant, Decimal("400"))
        bundle = self.open_bundle()
        seal_url = f"/api/orders/{self.order.pk}/bundles/{bundle['id']}/seal/"
        scan_url = f"/api/orders/{self.order.pk}/bundles/{bundle['id']}/scan/"

        client = APIClient()
        client.credentials(**get_auth_header(self.admin))

        # The box is closed first, and only then does another label turn up.
        scanned = client.post(scan_url, {"roll": self.roll.pk}, format="json")
        connections.close_all()
        self.assertEqual(scanned.status_code, status.HTTP_201_CREATED, scanned.data)
        sealed = client.post(seal_url, {}, format="json")
        connections.close_all()
        self.assertEqual(sealed.status_code, status.HTTP_200_OK, sealed.data)

        late = client.post(scan_url, {"roll": spare.pk}, format="json")
        connections.close_all()

        self.assertEqual(late.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("sealed", late.data["error"])
        spare.refresh_from_db()
        # Only the scan that made it in before the seal moved any cloth.
        self.assertEqual(spare.remaining_meters, Decimal("400.000"))
        self.assertEqual(Allocation.objects.count(), 1)

    def test_two_bundles_opened_at_once_leave_exactly_one_open(self):
        barrier = threading.Barrier(2)
        results = []
        guard = threading.Lock()

        def create():
            client = APIClient()
            client.credentials(**get_auth_header(self.admin))
            try:
                barrier.wait(timeout=20)
                resp = client.post(
                    f"/api/orders/{self.order.pk}/bundles/create/", {}, format="json"
                )
                value = (
                    (resp.status_code, resp.data["bundle"]["number"])
                    if resp.status_code == 201
                    else (resp.status_code, resp.data.get("error", repr(resp.data)))
                )
            except Exception as exc:  # pragma: no cover - surfaced in the assert
                value = ("EXC", repr(exc))
            finally:
                connections.close_all()
            with guard:
                results.append(value)

        threads = [threading.Thread(target=create) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)

        self.assertEqual(len(results), 2, results)
        # Whoever wins takes number 1; the loser is told there is already a box
        # open rather than being handed a second one nobody would work on.
        self.assertEqual(
            sorted(code for code, _ in results),
            [status.HTTP_201_CREATED, status.HTTP_400_BAD_REQUEST],
            results,
        )
        self.assertEqual(PackingBundle.objects.filter(status="OPEN").count(), 1)
        self.assertEqual(PackingBundle.objects.count(), 1)


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
    """Deleting an order has to give the cloth back, and must refuse to pretend.

    The records that say which roll each metre came off -- OrderItem, Allocation
    and RollAllocation -- all cascade with the order, so any restoration has to run
    before the delete, in the same transaction. A dispatched order is refused
    outright instead, because its cloth is not on a roll any more. An order with a
    *mix* is the awkward middle: the bundles that went out stay gone while the ones
    still on the shelf come back, which is only possible because the restoration
    works per allocation rather than per line.
    """

    def setUp(self):
        super().setUp()
        # Dispatch needs a transport on the order, chosen once and then reused, so
        # these tests carry one rather than re-deciding it per case.
        self.transport = Transport.objects.create(name="VRL Logistics")

    def roll_backed_order(self, metres=1000):
        """A placed order on a colour tracked by two real rolls."""
        from apps.items.rolls import receive_roll

        FabricVariant.objects.filter(pk=self.variant.pk).update(
            stock_meters=ZERO
        )
        self.rolls = [
            receive_roll(self.variant, Decimal("600")),
            receive_roll(self.variant, Decimal("400")),
        ]
        self.variant.refresh_from_db()

        order = self.make_draft()
        self.line = self.add_line(order, metres)
        self.place(order)
        order.refresh_from_db()
        return order

    def open_bundle(self, order):
        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{order.pk}/bundles/create/", {}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        return resp.data["bundle"]

    def scan_into(self, order, bundle, roll):
        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{order.pk}/bundles/{bundle['id']}/scan/",
            {"roll": roll.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        return resp

    def seal(self, order, bundle):
        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{order.pk}/bundles/{bundle['id']}/seal/", {}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        return resp

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
        # The same refusal for a colour with no rolls behind it, where the cloth is
        # just a figure on the variant rather than metres on a named roll.
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

        # Packing straight through the engine bypasses the bundle API, so the box is
        # written directly: the metres are cut and there is nothing to add to it.
        bundle = PackingBundle.objects.create(
            order=order,
            number=1,
            status="SEALED",
            sealed_at=timezone.now(),
            created_by=self.admin,
        )
        Allocation.objects.filter(round=packing_round).update(bundle=bundle)

        self.auth(self.admin)
        self.client.post(
            f"/api/orders/{order.pk}/bundles/{bundle.pk}/dispatch/",
            {"transport_company": self.transport.pk},
            format="json",
        )
        order.refresh_from_db()
        self.assertEqual(order.status, "DISPATCHED")
        resp = self.client.delete(f"/api/orders/{order.pk}/")

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Order.objects.filter(pk=order.pk).exists())
        self.variant.refresh_from_db()
        self.assertEqual(
            self.variant.stock_meters, Decimal("1400.000"),
            "shipped cloth must never return to stock",
        )

    def test_a_dispatched_order_cannot_be_deleted_at_all(self):
        order = self.roll_backed_order()
        bundle = self.open_bundle(order)
        # Both rolls, so the order ships complete and is genuinely dispatched.
        self.scan_into(order, bundle, self.rolls[0])
        self.scan_into(order, bundle, self.rolls[1])
        self.seal(order, bundle)

        self.auth(self.admin)
        dispatched = self.client.post(
            f"/api/orders/{order.pk}/bundles/{bundle['id']}/dispatch/",
            {"transport_company": self.transport.pk},
            format="json",
        )
        self.assertEqual(dispatched.status_code, status.HTTP_200_OK, dispatched.data)

        resp = self.client.delete(f"/api/orders/{order.pk}/")

        # Refused with a reason, rather than deleted with the cloth quietly lost.
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("already been dispatched", resp.data["error"])
        self.assertIn("Goods have left the warehouse", resp.data["error"])
        # Nothing was restored and nothing was deleted.
        order.refresh_from_db()
        self.assertTrue(Order.objects.filter(pk=order.pk).exists())
        self.assertEqual(order.status, "DISPATCHED")
        for roll in self.rolls:
            roll.refresh_from_db()
            self.assertEqual(roll.remaining_meters, ZERO)
            self.assertFalse(roll.is_active)
        self.assertEqual(RollAllocation.objects.filter(is_reversed=False).count(), 2)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, ZERO)

    def test_a_bundle_still_open_cannot_be_dispatched(self):
        """A box still being filled cannot be claimed as shipped."""
        order = self.roll_backed_order()
        bundle = self.open_bundle(order)
        self.scan_into(order, bundle, self.rolls[0])

        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{order.pk}/bundles/{bundle['id']}/dispatch/",
            {"transport_company": self.transport.pk},
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Only a sealed bundle", resp.data["error"])
        order.refresh_from_db()
        # Only one of the two rolls went in, so the order was never fully packed and
        # nothing could have been dispatched off the back of it either.
        self.assertEqual(order.status, "PENDING")
        self.assertIsNone(PackingBundle.objects.get().dispatched_at)

    def test_a_sealed_but_undispatched_order_still_gives_its_cloth_back(self):
        """Sealing is not shipping: an undispatched box is still here to be undone."""
        order = self.roll_backed_order()
        bundle = self.open_bundle(order)
        self.scan_into(order, bundle, self.rolls[0])
        self.seal(order, bundle)

        self.auth(self.admin)
        resp = self.client.delete(f"/api/orders/{order.pk}/")

        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT, resp.data)
        self.rolls[0].refresh_from_db()
        self.assertEqual(self.rolls[0].remaining_meters, Decimal("600"))
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("1000.000"))

    def test_deleting_an_order_with_packed_rolls_puts_them_back_on_their_rolls(self):
        order = self.roll_backed_order()
        bundle = self.open_bundle(order)
        self.scan_into(order, bundle, self.rolls[0])
        self.rolls[0].refresh_from_db()
        self.assertEqual(self.rolls[0].remaining_meters, ZERO)
        self.assertFalse(self.rolls[0].is_active)

        self.auth(self.admin)
        resp = self.client.delete(f"/api/orders/{order.pk}/")

        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        # Both rolls are whole again, and the colour's stock is back to the total
        # those two rolls hold.
        self.rolls[0].refresh_from_db()
        self.rolls[1].refresh_from_db()
        self.assertEqual(self.rolls[0].remaining_meters, Decimal("600"))
        self.assertTrue(self.rolls[0].is_active)
        self.assertEqual(self.rolls[1].remaining_meters, Decimal("400"))
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("1000.000"))
        # The order and everything hanging off it is gone.
        self.assertFalse(Order.objects.filter(pk=order.pk).exists())
        self.assertFalse(OrderItem.objects.filter(order_id=order.pk).exists())
        self.assertFalse(
            RollAllocation.objects.filter(roll__in=self.rolls).exists()
        )

    def test_deleting_an_order_with_a_sealed_bundle_still_returns_its_rolls(self):
        # A sealed bundle is supposed to be final, but the order is being deleted:
        # the box is being scrapped, so its cloth has to go back on the roll.
        order = self.roll_backed_order()
        bundle = self.open_bundle(order)
        self.scan_into(order, bundle, self.rolls[0])
        self.auth(self.admin)
        sealed = self.client.post(
            f"/api/orders/{order.pk}/bundles/{bundle['id']}/seal/", {}, format="json"
        )
        self.assertEqual(sealed.status_code, status.HTTP_200_OK, sealed.data)

        resp = self.client.delete(f"/api/orders/{order.pk}/")

        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.rolls[0].refresh_from_db()
        self.assertEqual(self.rolls[0].remaining_meters, Decimal("600"))
        self.assertTrue(self.rolls[0].is_active)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("1000.000"))
        self.assertFalse(PackingBundle.objects.filter(pk=bundle["id"]).exists())

    def test_deleting_an_order_closes_out_its_open_bundles(self):
        order = self.roll_backed_order()
        open_bundle = self.open_bundle(order)
        self.scan_into(order, open_bundle, self.rolls[0])

        self.auth(self.admin)
        resp = self.client.delete(f"/api/orders/{order.pk}/")

        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        # The bundle went with its order, so it can never be left open on an order
        # that no longer exists.
        self.assertFalse(PackingBundle.objects.filter(pk=open_bundle["id"]).exists())
        self.rolls[0].refresh_from_db()
        self.assertEqual(self.rolls[0].remaining_meters, Decimal("600"))
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("1000.000"))

    def test_deleting_an_unpacked_order_changes_nothing(self):
        order = self.make_draft()
        self.add_line(order, 1000)
        self.place(order)
        line_pk = order.items.get().pk

        self.auth(self.admin)
        resp = self.client.delete(f"/api/orders/{order.pk}/")

        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Order.objects.filter(pk=order.pk).exists())
        # No cloth was ever taken, so the warehouse total is untouched and no roll
        # was touched either.
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2400.000"))
        self.assertEqual(RollAllocation.objects.count(), 0)
        self.assertEqual(Allocation.objects.count(), 0)

    def test_a_failure_mid_restoration_leaves_the_order_and_the_stock_alone(self):
        order = self.roll_backed_order()
        bundle = self.open_bundle(order)
        self.scan_into(order, bundle, self.rolls[0])

        # The roll is credited back and the order delete then fails. Without the
        # whole thing being one transaction the cloth would be on the roll twice.
        with mock.patch(
            "apps.orders.views.OrderLog.record", side_effect=RuntimeError("boom")
        ):
            with self.assertRaises(RuntimeError):
                self.auth(self.admin)
                self.client.delete(f"/api/orders/{order.pk}/")

        # The order survives...
        self.assertTrue(Order.objects.filter(pk=order.pk).exists())
        # ...and so does the state that says the cloth is spoken for.
        self.rolls[0].refresh_from_db()
        self.variant.refresh_from_db()
        self.assertEqual(self.rolls[0].remaining_meters, ZERO)
        self.assertFalse(self.rolls[0].is_active)
        self.assertEqual(self.variant.stock_meters, Decimal("400.000"))
        entry = RollAllocation.objects.get(roll=self.rolls[0], is_reversed=False)
        self.assertFalse(entry.is_reversed)

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

    # â”€â”€ ownership â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    # â”€â”€ the generic viewset must not be a way around the guards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    # â”€â”€ a line may not be re-pointed at a foreign variant â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    # â”€â”€ merging duplicates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    # â”€â”€ a placed order must keep something to fulfil â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    # â”€â”€ default behaviour is unchanged â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    # â”€â”€ the negotiated rate stays on this order and nowhere else â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    # â”€â”€ an agent may discount, never inflate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    # â”€â”€ repricing an existing line from the same page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    # â”€â”€ the other edit paths must not lose the rate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    # â”€â”€ editing a line keeps the rate it was given â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    # â”€â”€ the line reports what it was repriced from â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


class BundleDispatchTests(OrderTestBase):
    """Dispatch is a per-bundle event: a sealed box is what leaves the warehouse.

    These cover the three things that follow from moving dispatch off the order and
    onto the bundle. Hand-packed metres have to become a bundle so they can be sent
    at all; one box leaving must leave the order honestly part-dispatched rather than
    wholly sent; and the transport is one decision for the order, not a fresh choice
    every time a truck leaves.
    """

    def setUp(self):
        super().setUp()
        # No FabricRoll rows for this variant, so it is a roll-less colour and the
        # only way to pack it is by typing a figure.
        self.assertFalse(FabricRoll.objects.filter(variant=self.variant).exists())
        self.transport = Transport.objects.create(name="VRL Logistics")
        self.other_transport = Transport.objects.create(name="TC Freight")

        self.order = self.make_draft()
        self.line = self.add_line(self.order, 100)
        self.place(self.order)
        self.order.refresh_from_db()

    # -- helpers -----------------------------------------------------------

    def pack_line(self, line=None, metres="100", **extra):
        line = line or self.line
        body = {"metres": metres}
        body.update(extra)
        self.auth(self.admin)
        return self.client.post(
            f"/api/orders/{self.order.pk}/items/{line.pk}/pack/",
            body,
            format="json",
        )

    def dispatch_bundle(self, bundle_id, **body):
        self.auth(self.admin)
        return self.client.post(
            f"/api/orders/{self.order.pk}/bundles/{bundle_id}/dispatch/",
            body,
            format="json",
        )

    def bundles(self):
        self.auth(self.admin)
        resp = self.client.get(f"/api/orders/{self.order.pk}/bundles/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        return resp.data

    def reload_order(self):
        self.order.refresh_from_db()
        return self.order

    # -- hand-packed metres become a bundle --------------------------------

    def test_roll_less_pack_creates_a_sealed_implicit_bundle(self):
        """Typing a figure still puts the cloth in a box, so a box is recorded."""
        resp = self.pack_line(metres="60")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertIsNotNone(resp.data["bundle_id"])

        bundle = PackingBundle.objects.get(pk=resp.data["bundle_id"])
        # Sealed on arrival: there is no half-typed bundle, the metres are final the
        # moment the request succeeds.
        self.assertEqual(bundle.status, "SEALED")
        self.assertIsNotNone(bundle.sealed_at)
        self.assertIsNone(bundle.dispatched_at)

        allocation = Allocation.objects.get(round_id=resp.data["round"])
        self.assertEqual(allocation.bundle_id, bundle.pk)
        self.assertEqual(allocation.metres, Decimal("60"))

        self.line.refresh_from_db()
        self.assertEqual(self.line.allocated_quantity, Decimal("60"))

    def test_each_pack_makes_its_own_bundle(self):
        """Two packs are two boxes, because a bundle means "handed over once"."""
        self.pack_line(metres="30")
        self.pack_line(metres="20")

        numbers = list(
            PackingBundle.objects.order_by("number").values_list("number", flat=True)
        )
        self.assertEqual(numbers, [1, 2])
        # Nothing is left hanging outside a bundle, so the panel has nothing stranded
        # in its "packed without a bundle" list.
        self.assertEqual(Allocation.objects.filter(bundle__isnull=True).count(), 0)
        self.assertEqual(RollAllocation.objects.filter(bundle__isnull=True).count(), 0)

    def test_implicit_bundle_serialises_its_metres_without_a_roll(self):
        """A box of cloth that was never rolled lists its metres and no roll number."""
        self.pack_line(metres="45")
        bundle = self.bundles()[0]

        self.assertEqual(bundle["status"], "SEALED")
        self.assertEqual(bundle["roll_count"], 0)
        self.assertFalse(bundle["is_roll_based"])
        self.assertEqual(bundle["piece_count"], 1)
        self.assertEqual(bundle["total_metres"], "45.000")

        piece = bundle["rolls"][0]
        self.assertIsNone(piece["roll"])
        self.assertEqual(piece["roll_number"], "")
        self.assertEqual(piece["metres"], "45.000")
        self.assertEqual(piece["fabric_name"], self.fabric.name)

    def test_roll_tracked_pack_keeps_its_roll_numbers(self):
        """Packing against named rolls still names them on the slip."""
        from apps.items.rolls import receive_roll

        FabricVariant.objects.filter(pk=self.variant.pk).update(stock_meters=ZERO)
        roll = receive_roll(self.variant, Decimal("600"))
        self.variant.refresh_from_db()

        resp = self.pack_line(metres="25", rolls=[{"roll": roll.pk, "metres": "25"}])
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

        bundle = self.bundles()[0]
        self.assertTrue(bundle["is_roll_based"])
        self.assertEqual(bundle["roll_count"], 1)
        self.assertEqual(bundle["rolls"][0]["roll_number"], roll.roll_number)
        # One piece, not two: the allocation is reachable by both links and must not
        # be counted twice.
        self.assertEqual(bundle["piece_count"], 1)
        self.assertEqual(bundle["total_metres"], "25.000")

    # -- one bundle leaving, order honestly part-dispatched ----------------

    def test_dispatching_one_bundle_leaves_the_order_partially_dispatched(self):
        second = self.add_line(self.order, 100)
        self.pack_line(line=self.line, metres="100")
        self.pack_line(line=second, metres="40")

        bundle = PackingBundle.objects.order_by("number").first()
        resp = self.dispatch_bundle(bundle.pk, transport_company=self.transport.pk)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["order_status"], "PARTIALLY_DISPATCHED")

        self.assertEqual(self.reload_order().status, "PARTIALLY_DISPATCHED")
        bundle.refresh_from_db()
        self.assertIsNotNone(bundle.dispatched_at)

    def test_fully_packed_and_fully_dispatched_becomes_dispatched(self):
        self.pack_line(metres="100")
        bundle = PackingBundle.objects.get()

        resp = self.dispatch_bundle(bundle.pk, transport_company=self.transport.pk)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["order_status"], "DISPATCHED")

        order = self.reload_order()
        self.assertEqual(order.status, "DISPATCHED")
        self.assertIsNotNone(order.dispatched_at)

    def test_unpacked_line_keeps_the_order_partially_dispatched(self):
        """Every box gone is not the same as everything gone."""
        self.pack_line(metres="40")
        bundle = PackingBundle.objects.get()

        resp = self.dispatch_bundle(bundle.pk, transport_company=self.transport.pk)
        self.assertEqual(resp.data["order_status"], "PARTIALLY_DISPATCHED")
        self.assertEqual(self.reload_order().status, "PARTIALLY_DISPATCHED")

    def test_a_part_dispatched_order_can_still_be_packed(self):
        """Part of the order went out; the rest is still being filled."""
        second = self.add_line(self.order, 100)
        self.pack_line(line=self.line, metres="100")
        bundle = PackingBundle.objects.order_by("number").first()
        self.dispatch_bundle(bundle.pk, transport_company=self.transport.pk)

        resp = self.pack_line(line=second, metres="30")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        second.refresh_from_db()
        self.assertEqual(second.allocated_quantity, Decimal("30"))
        self.assertEqual(self.reload_order().status, "PARTIALLY_DISPATCHED")

    def test_cancelled_bundle_does_not_hold_up_full_dispatch(self):
        """A box that was given back never went anywhere, so it is not outstanding."""
        from apps.items.rolls import receive_roll

        # A scanned, cancellable bundle on the roll-tracked colour...
        FabricVariant.objects.filter(pk=self.variant.pk).update(stock_meters=ZERO)
        roll = receive_roll(self.variant, Decimal("600"))
        self.variant.refresh_from_db()

        self.auth(self.admin)
        opened = self.client.post(
            f"/api/orders/{self.order.pk}/bundles/create/", {}, format="json"
        )
        self.assertEqual(opened.status_code, status.HTTP_201_CREATED, opened.data)
        scan = self.client.post(
            f"/api/orders/{self.order.pk}/bundles/{opened.data['bundle']['id']}/scan/",
            {"roll": roll.pk},
            format="json",
        )
        self.assertEqual(scan.status_code, status.HTTP_201_CREATED, scan.data)
        cancel = self.client.post(
            f"/api/orders/{self.order.pk}/bundles/{opened.data['bundle']['id']}/cancel/",
            {},
            format="json",
        )
        self.assertEqual(cancel.status_code, status.HTTP_200_OK, cancel.data)

        # Both lines are then packed for real: the scanned line from the roll it came
        # off, the roll-less line by hand. Only the cancelled bundle is left behind.
        again = self.pack_line(
            line=self.line, metres="100", rolls=[{"roll": roll.pk, "metres": "100"}]
        )
        self.assertEqual(again.status_code, status.HTTP_200_OK, again.data)

        plain_fabric = Fabric.objects.create(
            name="Linen 200 GSM", price_per_meter=Decimal("14.00")
        )
        plain_variant = FabricVariant.objects.create(
            fabric=plain_fabric, display_order="Ivory", stock_meters=Decimal("500")
        )
        line = self.add_line(self.order, 100, variant=plain_variant)
        by_hand = self.pack_line(line=line, metres="100")
        self.assertEqual(by_hand.status_code, status.HTTP_200_OK, by_hand.data)

        for bundle in PackingBundle.objects.filter(
            dispatched_at__isnull=True
        ).exclude(status="CANCELLED"):
            resp = self.dispatch_bundle(
                bundle.pk, transport_company=self.transport.pk
            )
            self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

        self.assertEqual(resp.data["order_status"], "DISPATCHED")
        self.reload_order()
        self.assertEqual(self.order.status, "DISPATCHED")

    def test_a_bundle_emptied_by_a_reversed_round_does_not_block_dispatch(self):
        """A hand-packed box whose round was cancelled holds nothing outstanding."""
        first = self.pack_line(metres="40")
        self.assertEqual(first.status_code, status.HTTP_200_OK, first.data)

        # Reverse that round through the packing history, the way a mistake is undone.
        self.auth(self.admin)
        cancel = self.client.post(
            f"/api/orders/packing-rounds/{first.data['round']}/cancel/", {}, format="json"
        )
        self.assertEqual(cancel.status_code, status.HTTP_200_OK, cancel.data)

        self.pack_line(metres="100")
        second = PackingBundle.objects.order_by("number").last()
        resp = self.dispatch_bundle(second.pk, transport_company=self.transport.pk)
        self.assertEqual(resp.data["order_status"], "DISPATCHED")

    def test_dispatch_writes_an_order_log(self):
        self.pack_line(metres="100")
        bundle = PackingBundle.objects.get()
        self.dispatch_bundle(bundle.pk, transport_company=self.transport.pk)

        log = OrderLog.objects.filter(
            order=self.order, action="DISPATCHED"
        ).latest("id")
        self.assertEqual(log.details["bundle"], bundle.code)
        self.assertEqual(log.details["transport"], "VRL Logistics")

    # -- guards ------------------------------------------------------------

    def test_open_bundle_cannot_be_dispatched(self):
        """An open box is still being filled; dispatching it would promise too much."""
        self.auth(self.admin)
        created = self.client.post(
            f"/api/orders/{self.order.pk}/bundles/create/", {}, format="json"
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        bundle_id = created.data["bundle"]["id"]

        resp = self.dispatch_bundle(bundle_id, transport_company=self.transport.pk)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not sealed", resp.data["error"])
        self.assertEqual(self.reload_order().status, "PENDING")

    def test_a_bundle_cannot_be_dispatched_twice(self):
        self.pack_line(metres="100")
        bundle = PackingBundle.objects.get()
        self.dispatch_bundle(bundle.pk, transport_company=self.transport.pk)

        resp = self.dispatch_bundle(bundle.pk)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("already been dispatched", resp.data["error"])

    def test_dispatch_requires_a_transport_on_the_first_bundle(self):
        self.pack_line(metres="100")
        bundle = PackingBundle.objects.get()

        resp = self.dispatch_bundle(bundle.pk)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("no transport yet", resp.data["error"])
        bundle.refresh_from_db()
        self.assertIsNone(bundle.dispatched_at)

    def test_transport_is_reused_and_cannot_be_swapped(self):
        """The transport is one decision for the order, not a per-truck choice."""
        second = self.add_line(self.order, 100)
        third = self.add_line(self.order, 100)
        self.pack_line(line=self.line, metres="100")
        self.pack_line(line=second, metres="100")
        first, other = PackingBundle.objects.order_by("number")[:2]

        self.dispatch_bundle(first.pk, transport_company=self.transport.pk)

        # Naming the same transport again is simply accepted -- the order already
        # knows it, so the caller is not asked anything.
        resp = self.dispatch_bundle(other.pk, transport_company=self.transport.pk)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.reload_order()
        self.assertEqual(self.order.transport_company_id, self.transport.pk)

        # A different one is refused rather than rewriting where the first box went.
        self.pack_line(line=third, metres="100")
        last = PackingBundle.objects.order_by("number").last()
        resp = self.dispatch_bundle(last.pk, transport_company=self.other_transport.pk)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("already going on", resp.data["error"])
        self.reload_order()
        self.assertEqual(self.order.transport_company_id, self.transport.pk)
        last.refresh_from_db()
        self.assertIsNone(last.dispatched_at)

    # -- there is no whole-order dispatch ---------------------------------

    def test_there_is_no_whole_order_dispatch_endpoint(self):
        """A dispatch is a box leaving, so the order itself has nothing to dispatch.

        The old endpoint is gone rather than deprecated: leaving it in place would
        offer a second way of claiming cloth has gone out, and the two would not
        agree on what a partly dispatched order means.
        """
        self.pack_line(metres="100")
        self.auth(self.admin)
        resp = self.client.post(
            f"/api/orders/{self.order.pk}/dispatch/",
            {"transport_company": self.transport.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        # Nothing was claimed on the way past: the box is still waiting and the
        # order is still short.
        self.assertEqual(
            PackingBundle.objects.filter(dispatched_at__isnull=True).count(), 1
        )
        self.assertEqual(self.reload_order().status, "PACKED")

    # -- deleting an order that is only partly out of the door ------------

    def test_deleting_a_part_dispatched_order_returns_only_the_undispatched_cloth(self):
        """A box on a truck stays gone; the one on the shelf comes back."""
        second = self.add_line(self.order, 100)
        shipped = self.pack_line(line=self.line, metres="100")
        waiting = self.pack_line(line=second, metres="100")
        self.assertEqual(shipped.status_code, status.HTTP_200_OK, shipped.data)
        self.assertEqual(waiting.status_code, status.HTTP_200_OK, waiting.data)

        gone, here = PackingBundle.objects.order_by("number")
        self.dispatch_bundle(gone.pk, transport_company=self.transport.pk)
        self.assertEqual(self.reload_order().status, "PARTIALLY_DISPATCHED")

        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2200.000"))

        self.auth(self.admin)
        resp = self.client.delete(f"/api/orders/{self.order.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT, resp.data)

        # Only the 100 m that was still on the shelf came back.
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2300.000"))

        log = OrderLog.objects.filter(action="ORDER_DELETED").latest("id")
        self.assertEqual(log.details["metres_returned_to_stock"], "100.000")
        self.assertEqual(log.details["bundles_dispatched"], 1)


