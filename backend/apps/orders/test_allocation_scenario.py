from decimal import Decimal

from django.test import TestCase

from apps.agents.models import Agent
from apps.customers.models import Customer
from apps.items.models import Fabric, FabricVariant
from apps.orders.allocation import (
    build_plan,
    cancel_round,
    confirm_round,
    customer_priority,
)
from apps.orders.models import Order, OrderItem, PackingRound


class ScenarioBase(TestCase):
    """Shared 2400 m / 1400 m + 1400 m / 1000 m roll for the tests below."""

    def setUp(self):
        self.fabric = Fabric.objects.create(
            name="Cotton Cambric 140 GSM", price_per_meter=Decimal("9.00")
        )
        self.variant = FabricVariant.objects.create(
            fabric=self.fabric, display_order="White", stock_meters=Decimal("2400")
        )

        agent_user = self.make_user("agent", "AGENT")
        self.agent = Agent.objects.create(user=agent_user, contact="1")
        self.a = Customer.objects.create(
            name="Alpha", contact="1", agent=self.agent
        )
        self.b = Customer.objects.create(
            name="Beta", contact="2", agent=self.agent
        )

        self.order_a = self.make_order(self.a, Decimal("1400"))
        self.order_b = self.make_order(self.b, Decimal("1400"))

    def make_user(self, username, role):
        from django.contrib.auth import get_user_model

        return get_user_model().objects.create_user(
            username=username, password="x", role=role
        )

    def make_order(self, customer, metres):
        order = Order.objects.create(
            customer=customer, agent=self.agent, status="PENDING"
        )
        OrderItem.objects.create(
            order=order,
            fabric=self.fabric,
            variant=self.variant,
            fabric_name=self.fabric.name,
            rate_per_meter=self.fabric.price_per_meter,
            ordered_quantity=metres,
        )
        return order

    def make_history(self, customer, metres):
        """Record dispatched metres so the customer earns packing priority."""
        order = Order.objects.create(
            customer=customer, agent=self.agent, status="DISPATCHED"
        )
        OrderItem.objects.create(
            order=order,
            fabric=self.fabric,
            variant=self.variant,
            fabric_name=self.fabric.name,
            ordered_quantity=metres,
            allocated_quantity=metres,
        )
        return order


class AllocationScenarioTests(ScenarioBase):
    def test_two_1400m_orders_share_2400m_roll(self):
        """A and B each want 1400 m; only 2400 m exists. Round size 1000 m.

        Each open line takes one 1000 m roll, leaving a 400 m remainder that
        goes to the highest-priority customer. Neither has a sales history, so
        the tie-break is earliest order: A placed first, so A tops up.
        """
        plan = build_plan(self.variant, Decimal("1000"))

        grants = {e["order_item"]: e["metres"] for e in plan["allocations"]}
        line_a = self.order_a.items.get()
        line_b = self.order_b.items.get()

        self.assertEqual(grants[line_a.pk], Decimal("1400"))
        self.assertEqual(grants[line_b.pk], Decimal("1000"))
        self.assertEqual(sum(grants.values()), Decimal("2400"))
        self.assertEqual(plan["unallocated_meters"], Decimal("0"))
        self.assertFalse(plan["fully_covered"])

    def test_later_customer_tops_up_when_it_ranks_higher(self):
        """Mirror of the above: when B ranks first, B takes the 400 m."""
        self.make_history(self.b, Decimal("5000"))

        plan = build_plan(self.variant, Decimal("1000"))
        grants = {e["order_item"]: e["metres"] for e in plan["allocations"]}

        self.assertEqual(grants[self.order_b.items.get().pk], Decimal("1400"))
        self.assertEqual(grants[self.order_a.items.get().pk], Decimal("1000"))

    def test_confirm_moves_stock_and_promotes_the_filled_order(self):
        plan = build_plan(self.variant, Decimal("1000"))
        override = [
            {"order_item": e["order_item"], "metres": str(e["metres"])}
            for e in plan["allocations"]
        ]
        packing_round = PackingRound.objects.create(
            variant=self.variant,
            round_size=Decimal("1000"),
            plan_override=override,
        )

        confirm_round(packing_round)

        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("0"))

        self.order_a.refresh_from_db()
        self.order_b.refresh_from_db()
        self.assertEqual(self.order_a.status, "PACKED")
        self.assertEqual(self.order_b.status, "PENDING")

        self.assertEqual(
            self.order_a.items.get().allocated_quantity, Decimal("1400")
        )
        self.assertEqual(
            self.order_b.items.get().allocated_quantity, Decimal("1000")
        )

    def test_cancelling_a_round_returns_the_metres(self):
        packing_round = PackingRound.objects.create(
            variant=self.variant, round_size=Decimal("1000")
        )
        confirm_round(packing_round)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("0"))

        cancel_round(packing_round)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2400"))

        self.order_a.refresh_from_db()
        self.order_b.refresh_from_db()
        self.assertEqual(self.order_a.status, "PENDING")
        self.assertEqual(self.order_a.items.get().allocated_quantity, Decimal("0"))

    def test_lifetime_metres_decides_the_top_up(self):
        """Give B a history of buying more than A; B should win the leftover."""
        self.make_history(self.b, Decimal("5000"))

        priority = customer_priority([self.a.id, self.b.id])
        self.assertEqual(priority[self.b.id]["rank"], 0)
        self.assertEqual(priority[self.a.id]["rank"], 1)
        self.assertEqual(priority[self.b.id]["metres_sold"], Decimal("5000"))
        self.assertEqual(priority[self.a.id]["metres_sold"], Decimal("0"))

        plan = build_plan(self.variant, Decimal("1000"))
        grants = {e["order_item"]: e["metres"] for e in plan["allocations"]}
        self.assertEqual(grants[self.order_b.items.get().pk], Decimal("1400"))
        self.assertEqual(grants[self.order_a.items.get().pk], Decimal("1000"))

    def test_admin_override_beats_a_bigger_sales_history(self):
        """A pin must jump a customer ahead of the top salesman."""
        self.make_history(self.b, Decimal("5000"))
        self.assertEqual(
            customer_priority([self.a.id, self.b.id])[self.b.id]["rank"], 0
        )

        self.a.priority_override = 0
        self.a.save(update_fields=["priority_override"])

        priority = customer_priority([self.a.id, self.b.id])
        self.assertEqual(priority[self.a.id]["rank"], 0)
        self.assertEqual(priority[self.a.id]["source"], "override")
        self.assertEqual(priority[self.b.id]["rank"], 1)

    def test_lower_override_number_outranks_higher(self):
        self.a.priority_override = 5
        self.b.priority_override = 2
        self.a.save(update_fields=["priority_override"])
        self.b.save(update_fields=["priority_override"])

        priority = customer_priority([self.a.id, self.b.id])
        self.assertEqual(priority[self.b.id]["rank"], 0)
        self.assertEqual(priority[self.a.id]["rank"], 1)


class PlanGuardTests(ScenarioBase):
    """The invariants a hand-edited plan must not be able to break."""

    def test_backorder_warning_uses_aggregate_demand(self):
        """2400 m on hand vs 2800 m of demand must warn, even per-line it fits."""
        from apps.orders.stock import backorder_report

        report = backorder_report(self.order_a)
        self.assertEqual(len(report), 1, "A's line should be flagged as short")
        entry = report[0]
        self.assertEqual(entry["available"], "2400.000")
        self.assertEqual(entry["total_demand"], "2800.000")
        self.assertEqual(entry["shortfall"], "400.000")

    def test_no_warning_when_demand_fits(self):
        from apps.orders.stock import backorder_report

        FabricVariant.objects.filter(pk=self.variant.pk).update(
            stock_meters=Decimal("5000")
        )
        self.assertEqual(backorder_report(self.order_a), [])

    def test_duplicate_line_in_override_is_rejected(self):
        from apps.orders.packing_views import _CreateRoundSerializer

        line = self.order_a.items.get()
        serializer = _CreateRoundSerializer(
            data={
                "variant": self.variant.pk,
                "round_size": "1000",
                "allocations": [
                    {"order_item": line.pk, "metres": "500"},
                    {"order_item": line.pk, "metres": "500"},
                ],
            }
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("listed twice", str(serializer.errors))

    def test_confirmed_round_cannot_be_confirmed_again(self):
        from apps.orders.allocation import confirm_round

        plan = build_plan(self.variant, Decimal("1000"))
        packing_round = PackingRound.objects.create(
            variant=self.variant,
            round_size=Decimal("1000"),
            plan_override=[
                {"order_item": e["order_item"], "metres": str(e["metres"])}
                for e in plan["allocations"]
            ],
        )
        confirm_round(packing_round)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("0"))

        with self.assertRaises(ValueError):
            confirm_round(packing_round)

        self.variant.refresh_from_db()
        self.assertEqual(
            self.variant.stock_meters, Decimal("0"), "stock must not go negative"
        )

    def test_cancelled_round_cannot_be_cancelled_twice(self):
        from apps.orders.allocation import cancel_round

        packing_round = PackingRound.objects.create(
            variant=self.variant, round_size=Decimal("1000")
        )
        confirm_round(packing_round)
        cancel_round(packing_round)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_meters, Decimal("2400"))

        with self.assertRaises(ValueError):
            cancel_round(packing_round)

        self.variant.refresh_from_db()
        self.assertEqual(
            self.variant.stock_meters, Decimal("2400"), "stock must not double-return"
        )

    def test_emptying_the_roll_marks_the_fabric_out_of_stock(self):
        from apps.items.models import Fabric

        plan = build_plan(self.variant, Decimal("1000"))
        packing_round = PackingRound.objects.create(
            variant=self.variant,
            round_size=Decimal("1000"),
            plan_override=[
                {"order_item": e["order_item"], "metres": str(e["metres"])}
                for e in plan["allocations"]
            ],
        )
        confirm_round(packing_round)

        self.fabric.refresh_from_db()
        self.assertIsNotNone(
            self.fabric.out_of_stock_since,
            "packing emptied the roll, so the fabric must look out of stock",
        )
        Fabric.objects.filter(pk=self.fabric.pk).update(out_of_stock_since=None)
