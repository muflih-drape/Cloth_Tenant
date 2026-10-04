"""Physical roll tracking tests: the invariant, the API, and packing.

The invariant under test throughout::

    variant.stock_meters == SUM(remaining_meters for the variant's active rolls)

for any colour that has rolls, and *no* change at all for a colour that has none
-- every existing variant predates rolls, and the whole packing engine keeps
working on the flat ``stock_meters`` figure.

Two things are checked over and over, because getting either wrong is the classic
way a warehouse loses track of its own cloth:

1. rolls and the warehouse total move together in the same transaction, and
2. cancelling a packing round puts the cloth back on the exact rolls it was cut
   from, rather than on an arbitrary roll that happens to be active.

Roll selection itself is covered by :class:`RollSelectionTests` (best fit, in the
documented priority order) and by :class:`RollOverrideTests` (the admin's own
breakdown, and the server re-checking it). Both run against the same rolls the
packing tests use, so a change to one cannot quietly break the other.
"""

from decimal import Decimal
import time

from django.test import TestCase
from rest_framework import status

from apps.items.models import Fabric, FabricRoll, FabricVariant, StockMovement
from apps.items.rolls import (
    MAX_ROLLS_FOR_EXACT_FIT,
    RollError,
    adjust_roll,
    is_roll_tracked,
    plan_roll_consumption,
    preview_consumption,
    receive_roll,
    receive_rolls,
    resolve_roll_plan,
    roll_invariant_holds,
    sync_variant_stock,
)
from apps.orders.allocation import cancel_round, confirm_round
from apps.orders.models import Allocation, OrderItem, PackingRound, RollAllocation
from apps.orders.stock import stock_movement_for_lines

from .tests import FabricTestBase

ZERO = Decimal("0")
D = Decimal


def stub_rolls(sizes):
    """Plain objects with the attributes ``plan_roll_consumption`` reads.

    Lets the roll-count tests run the selection logic over dozens of rolls without
    receiving dozens of rolls over the database to do it.
    """

    class Stub:
        def __init__(self, pk, size):
            self.pk = pk
            self.roll_number = f"R-{pk:06d}"
            self.remaining_meters = D(size)
            self.created_at = None

    return [Stub(index + 1, size) for index, size in enumerate(sizes)]


class RollTestBase(FabricTestBase):
    """Adds a roll-tracked colour to the shared catalogue fixture."""

    def setUp(self):
        super().setUp()
        # variant1 ships with a flat 3000 m and no rolls: the legacy shape that
        # must keep behaving exactly as before.
        self.tracked = FabricVariant.objects.create(
            fabric=self.fabric,
            display_order="Royal Blue",
            stock_meters=ZERO,
        )

    def receive(self, metres, variant=None, **kwargs):
        return receive_roll(variant or self.tracked, metres, **kwargs)

    def assert_in_step(self, variant=None):
        variant = variant or self.tracked
        variant.refresh_from_db()
        self.assertTrue(
            roll_invariant_holds(variant),
            f"{variant.display_order}: stock {variant.stock_meters} != roll total",
        )
        return variant

    def make_round(self, variant=None, round_size=D("1000"), allocations=None):
        variant = variant or self.tracked
        if allocations is None:
            order = self.make_order(self.customer1)
            line = self.make_line(order, round_size, variant=variant)
            allocations = [{"order_item": line.pk, "metres": str(round_size)}]
        return PackingRound.objects.create(
            variant=variant,
            round_size=round_size,
            status="DRAFT",
            plan_override=allocations,
            created_by=self.admin_user,
        )

    def confirm(self, packing_round):
        return confirm_round(packing_round, user=self.admin_user)

    def open_bundle(self, order):
        """Open a bundle on ``order``; a scanned roll always lives in one."""
        self.auth()
        return self.client.post(
            f"/api/orders/{order.pk}/bundles/create/", {}, format="json"
        ).data["bundle"]

    def scan(self, order, bundle, roll):
        """Cut all of ``roll`` into ``bundle``."""
        self.auth()
        return self.client.post(
            f"/api/orders/{order.pk}/bundles/{bundle['id']}/scan/",
            {"roll": roll.pk},
            format="json",
        )

    def cancel_bundle(self, order, bundle):
        """Throw the bundle away, giving back every roll it held."""
        self.auth()
        return self.client.post(
            f"/api/orders/{order.pk}/bundles/{bundle['id']}/cancel/", {}, format="json"
        )

    def pack(self, order, line, metres, rolls=None):
        """Pack one line through the single-line endpoint, optionally by roll."""
        self.auth()
        payload = {"metres": str(metres)}
        if rolls is not None:
            payload["rolls"] = [
                {"roll": row["roll"], "metres": str(row["metres"])} for row in rolls
            ]
        # JSON, because a breakdown is a list of objects and multipart cannot
        # carry one.
        return self.client.post(
            f"/api/orders/{order.pk}/items/{line.pk}/pack/", payload, format="json"
        )


# --------------------------------------------------------------------------- #
# The invariant
# --------------------------------------------------------------------------- #


class RollReceiptTests(RollTestBase):
    def test_receiving_a_roll_adds_its_metres_to_the_warehouse_total(self):
        roll = self.receive(D("250"))

        self.assertTrue(roll.roll_number.startswith("R-"))
        self.assertEqual(roll.original_meters, D("250.000"))
        self.assertEqual(roll.remaining_meters, D("250.000"))
        self.assertTrue(roll.is_active)
        self.assert_in_step()

    def test_receiving_more_rolls_keeps_one_total(self):
        self.receive(D("250"))
        self.receive(D("100.500"))

        self.assert_in_step()
        self.assertEqual(self.tracked.stock_meters, D("350.500"))
        self.assertEqual(FabricRoll.objects.count(), 2)

    def test_bulk_receipt_is_all_or_nothing(self):
        self.receive(D("100"))

        with self.assertRaises(RollError):
            receive_rolls(self.tracked, [D("50"), "not a number"])

        # The bad delivery left the warehouse exactly as it was: no second roll,
        # no stray metres.
        self.assertEqual(FabricRoll.objects.count(), 1)
        self.assert_in_step()

    def test_roll_numbers_keep_climbing_and_can_be_typed(self):
        first = self.receive(D("50"))
        second = self.receive(D("50"))
        typed = self.receive(D("50"), roll_number="LOT-7")

        self.assertNotEqual(first.roll_number, second.roll_number)
        self.assertEqual(typed.roll_number, "LOT-7")

    def test_a_duplicate_roll_number_is_refused(self):
        self.receive(D("50"), roll_number="R-000001")
        with self.assertRaises(RollError):
            self.receive(D("50"), roll_number="R-000001")

    def test_nonsense_lengths_are_refused(self):
        for bad in (None, "", 0, "-5", "abc"):
            with self.assertRaises(RollError):
                self.receive(bad)
        self.assertEqual(FabricRoll.objects.count(), 0)

    def test_a_colour_with_no_rolls_is_not_roll_tracked(self):
        self.assertFalse(is_roll_tracked(self.variant1))

    def test_sending_a_variant_into_step_repairs_a_drifted_total(self):
        self.receive(D("250"))

        # Simulate somebody having edited metres behind the rolls' back.
        FabricVariant.objects.filter(pk=self.tracked.pk).update(
            stock_meters=D("999")
        )
        self.tracked.refresh_from_db()
        self.assertFalse(roll_invariant_holds(self.tracked))

        sync_variant_stock(self.tracked, force=True)
        self.assertEqual(self.tracked.stock_meters, D("250.000"))
        self.assertTrue(roll_invariant_holds(self.tracked))


class FirstRollReplacesOpeningStockTests(RollTestBase):
    """The one transition where receiving a roll takes stock away.

    A colour created with a plain metre figure has stock belonging to no roll. Its
    first real roll has to *replace* that figure -- the rolls become the total, and
    adding them would count the same cloth twice (1000 untracked + a 100 m roll =
    1100 m that does not exist). After that first roll the rule is the ordinary
    one again: receiving adds.
    """

    def untracked_colour(self, metres="1000"):
        """A colour with a plain opening figure and no roll rows, as created."""
        variant = FabricVariant.objects.create(
            fabric=self.fabric,
            display_order="Untracked",
            stock_meters=D(metres),
        )
        self.assertFalse(is_roll_tracked(variant))
        return variant

    def test_first_roll_replaces_the_opening_figure_rather_than_adding_to_it(self):
        variant = self.untracked_colour("1000")

        self.receive(D("100"), variant=variant)

        variant.refresh_from_db()
        # 100, not 1100: the untracked 1000 m is gone, not stacked on top of.
        self.assertEqual(variant.stock_meters, D("100.000"))
        self.assertTrue(is_roll_tracked(variant))
        self.assert_in_step(variant)

    def test_the_first_roll_satisfies_the_invariant_the_old_total_broke(self):
        variant = self.untracked_colour("1000")
        self.receive(D("100"), variant=variant)

        # Before the fix the total would have been 1100 against 100 m of rolls,
        # which is exactly the drift the invariant exists to catch.
        variant.refresh_from_db()
        self.assertEqual(
            variant.stock_meters,
            sum(
                FabricRoll.objects.filter(variant=variant).values_list(
                    "remaining_meters", flat=True
                ),
                ZERO,
            ),
        )

    def test_the_discarded_quantity_is_recorded_as_a_stock_movement(self):
        variant = self.untracked_colour("1000")

        self.receive(D("100"), variant=variant)

        # Without a record, stock dropping 1000 -> 100 looks like cloth vanishing.
        movement = StockMovement.objects.get(variant=variant)
        self.assertEqual(movement.reason, StockMovement.OPENING_FIGURE_DISCARDED)
        self.assertEqual(movement.metres, D("-1000.000"))
        self.assertEqual(movement.stock_before, D("1000.000"))
        self.assertEqual(movement.stock_after, D("100.000"))

    def test_a_bulk_first_delivery_is_recorded_once_for_the_whole_delivery(self):
        variant = self.untracked_colour("1000")

        receive_rolls(variant, [D("500"), D("450")], created_by=self.admin_user)

        variant.refresh_from_db()
        self.assertEqual(variant.stock_meters, D("950.000"))
        self.assert_in_step(variant)
        movement = StockMovement.objects.get(variant=variant)
        self.assertEqual(movement.stock_before, D("1000.000"))
        self.assertEqual(movement.stock_after, D("950.000"))
        self.assertEqual(movement.created_by, self.admin_user)

    def test_a_second_roll_adds_normally_and_records_nothing(self):
        variant = self.untracked_colour("1000")
        self.receive(D("100"), variant=variant)

        self.receive(D("250"), variant=variant)

        variant.refresh_from_db()
        # Ordinary additive behaviour: 100 from the first roll, plus 250 more.
        self.assertEqual(variant.stock_meters, D("350.000"))
        self.assert_in_step(variant)
        # The transition happened once. It is not repeated on every receive.
        self.assertEqual(StockMovement.objects.filter(variant=variant).count(), 1)

    def test_later_receives_never_write_another_movement(self):
        variant = self.untracked_colour("1000")
        self.receive(D("100"), variant=variant)
        self.receive(D("250"), variant=variant)
        receive_rolls(variant, [D("10"), D("20")])

        variant.refresh_from_db()
        self.assertEqual(variant.stock_meters, D("380.000"))
        self.assertEqual(StockMovement.objects.filter(variant=variant).count(), 1)

    def test_a_colour_opened_at_zero_records_no_movement(self):
        # Nothing to discard, so there is nothing to explain away.
        variant = self.untracked_colour("0")

        self.receive(D("100"), variant=variant)

        variant.refresh_from_db()
        self.assertEqual(variant.stock_meters, D("100.000"))
        self.assertEqual(StockMovement.objects.filter(variant=variant).count(), 0)

    def test_the_transition_survives_a_failed_receive_being_rolled_back(self):
        variant = self.untracked_colour("1000")

        with self.assertRaises(RollError):
            receive_rolls(variant, [D("100"), "not a number"])

        # A refused delivery must not leave the opening figure discarded.
        variant.refresh_from_db()
        self.assertEqual(variant.stock_meters, D("1000.000"))
        self.assertFalse(is_roll_tracked(variant))
        self.assertEqual(StockMovement.objects.filter(variant=variant).count(), 0)

    def test_the_api_reports_the_replacement_not_an_inflated_total(self):
        variant = self.untracked_colour("1000")
        self.auth()

        resp = self.client.post(
            f"/api/items/variants/{variant.pk}/rolls/",
            {"meters": "100"},
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["stock_meters"], "100.000")
        self.assertEqual(resp.data["roll_stock_meters"], "100.000")
        self.assertEqual(resp.data["roll_count"], 1)
        self.assertTrue(resp.data["is_roll_tracked"])

    def test_creating_a_colour_on_its_rolls_is_untouched_by_this(self):
        """The create form starts such a colour at zero, so there is nothing to
        discard: the roll sum is the whole stock and no movement is written."""
        self.auth()
        resp = self.client.post(
            "/api/items/",
            {
                "name": "Cotton Lawn",
                "description": "Light lawn",
                "price_per_meter": "180.00",
                "variants": [
                    {
                        "display_order": "Natural",
                        "stock_meters": "1000",
                        "rolls": [{"meters": "500"}, {"meters": "450"}],
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        created = Fabric.objects.get(name="Cotton Lawn")
        variant = created.variants.get(display_order="Natural")
        # Still the roll sum, exactly as before: 950 and not 1950.
        self.assertEqual(variant.stock_meters, D("950.000"))
        self.assertEqual(StockMovement.objects.filter(variant=variant).count(), 0)


class RollAdjustmentTests(RollTestBase):
    def test_adding_cloth_to_a_roll_raises_what_the_roll_has_ever_held(self):
        roll = self.receive(D("250"))

        adjust_roll(roll, D("10"))

        roll.refresh_from_db()
        self.assertEqual(roll.remaining_meters, D("260.000"))
        self.assertEqual(roll.original_meters, D("260.000"))
        self.assert_in_step()

    def test_taking_cloth_off_a_roll_lowers_stock_but_not_its_original_length(self):
        roll = self.receive(D("250"))

        adjust_roll(roll, D("-25"))

        roll.refresh_from_db()
        self.assertEqual(roll.remaining_meters, D("225.000"))
        self.assertEqual(roll.original_meters, D("250.000"))
        self.assert_in_step()

    def test_a_roll_cannot_give_up_more_than_it_holds(self):
        roll = self.receive(D("10"))

        with self.assertRaises(RollError):
            adjust_roll(roll, D("-10.001"))
        self.assert_in_step()

    def test_a_zero_adjustment_is_refused(self):
        roll = self.receive(D("10"))
        with self.assertRaises(RollError):
            adjust_roll(roll, ZERO)


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #


class RollApiTests(RollTestBase):
    def rolls_url(self, variant=None):
        return f"/api/items/variants/{(variant or self.tracked).pk}/rolls/"

    def test_receiving_requires_authentication(self):
        self.client.credentials()
        response = self.client.post(self.rolls_url(), {"meters": "250"})
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_an_agent_cannot_receive_stock(self):
        self.auth(self.agent_user)
        response = self.client.post(self.rolls_url(), {"meters": "250"})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(FabricRoll.objects.count(), 0)

    def test_an_admin_can_receive_and_the_total_follows(self):
        self.auth()

        response = self.client.post(self.rolls_url(), {"meters": "250.500"})

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["stock_meters"], "250.500")
        self.assertEqual(response.data["roll_count"], 1)
        self.assertEqual(response.data["roll"]["remaining_meters"], "250.500")
        self.assertEqual(response.data["roll_stock_meters"], "250.500")
        self.assert_in_step()

    def test_bulk_receipt_endpoint(self):
        self.auth()

        response = self.client.post(
            f"{self.rolls_url()}bulk-add/",
            {"rolls": [{"meters": "100"}, {"meters": "150"}]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["total_meters"], "250.000")
        self.assert_in_step()

    def test_bulk_receipt_reports_which_roll_was_bad(self):
        self.auth()
        response = self.client.post(
            f"{self.rolls_url()}bulk-add/",
            {"rolls": [{"meters": "100"}, {"meters": "-5"}]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(FabricRoll.objects.count(), 0)

    def test_rolls_can_be_listed_per_colour(self):
        self.receive(D("100"))
        self.receive(D("150"))
        self.auth()

        response = self.client.get(self.rolls_url())

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["rolls"]), 2)
        self.assertEqual(response.data["roll_stock_meters"], "250.000")
        self.assertEqual(response.data["display_order"], "Royal Blue")

    def test_a_roll_can_be_adjusted_through_the_api(self):
        roll = self.receive(D("100"))
        self.auth()

        response = self.client.post(
            f"/api/items/rolls/{roll.pk}/adjust/", {"meters": "-12.500"}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        roll.refresh_from_db()
        self.assertEqual(roll.remaining_meters, D("87.500"))
        self.assert_in_step()

    def test_a_roll_with_cloth_on_it_cannot_be_deleted(self):
        roll = self.receive(D("100"))
        self.auth()

        response = self.client.delete(f"/api/items/rolls/{roll.pk}/")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(FabricRoll.objects.filter(pk=roll.pk).exists())

    def test_a_roll_with_history_cannot_be_deleted_even_when_empty(self):
        roll = self.receive(D("100"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("100"), variant=self.tracked)
        self.pack(order, line, 100, rolls=[{"roll": roll.pk, "metres": "100"}])
        roll.refresh_from_db()
        self.assertEqual(roll.remaining_meters, ZERO)
        self.auth()

        response = self.client.delete(f"/api/items/rolls/{roll.pk}/")

        # PROTECT on RollAllocation keeps the warehouse's record intact, and the
        # message says so rather than surfacing a database error.
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("packed", response.data["error"].lower())
        self.assertTrue(FabricRoll.objects.filter(pk=roll.pk).exists())

    def test_an_empty_unused_roll_can_be_deleted(self):
        roll = FabricRoll.objects.create(
            variant=self.tracked,
            roll_number="R-TEST-1",
            original_meters=D("5"),
            remaining_meters=D("0"),
            is_active=False,
        )
        self.auth()

        response = self.client.delete(f"/api/items/rolls/{roll.pk}/")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(FabricRoll.objects.filter(pk=roll.pk).exists())

    def test_a_colour_holding_cloth_on_its_rolls_cannot_be_deleted(self):
        self.receive(D("100"))
        self.auth()

        response = self.client.delete(f"/api/items/variants/{self.tracked.pk}/")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(FabricVariant.objects.filter(pk=self.tracked.pk).exists())

    def test_a_colour_with_only_empty_rolls_can_be_deleted(self):
        roll = self.receive(D("100"))
        adjust_roll(roll, D("-100"))
        self.auth()

        response = self.client.delete(f"/api/items/variants/{self.tracked.pk}/")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(FabricVariant.objects.filter(pk=self.tracked.pk).exists())

    def test_a_colour_whose_rolls_were_packed_keeps_its_history(self):
        roll = self.receive(D("100"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("100"), variant=self.tracked)
        self.pack(order, line, 100, rolls=[{"roll": roll.pk, "metres": "100"}])
        self.auth()

        response = self.client.delete(f"/api/items/variants/{self.tracked.pk}/")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(FabricVariant.objects.filter(pk=self.tracked.pk).exists())

    def test_preview_endpoint_shows_which_rolls_would_be_cut(self):
        first = self.receive(D("100"))
        second = self.receive(D("100"))
        self.auth()

        response = self.client.post(f"{self.rolls_url()}preview/", {"meters": "150"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        cut = response.data
        self.assertEqual(cut["requested_meters"], "150.000")
        self.assertEqual(len(cut["rolls"]), 2)
        self.assertEqual(cut["rolls"][0]["roll_number"], first.roll_number)
        self.assertEqual(cut["rolls"][0]["metres"], "100.000")
        self.assertEqual(cut["rolls"][0]["remaining_after"], "0.000")
        self.assertEqual(cut["rolls"][1]["roll_number"], second.roll_number)
        self.assertEqual(cut["rolls"][1]["metres"], "50.000")
        self.assertEqual(cut["shortfall_meters"], "0.000")

    def test_preview_reports_a_shortfall_rather_than_pretending(self):
        self.receive(D("40"))
        self.auth()

        response = self.client.post(f"{self.rolls_url()}preview/", {"meters": "150"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["shortfall_meters"], "110.000")

    def test_stock_cannot_be_typed_over_a_roll_tracked_colour(self):
        self.receive(D("100"))
        self.auth()

        response = self.client.patch(
            f"/api/items/variants/{self.tracked.pk}/", {"stock_meters": "9999"}
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assert_in_step()

    def test_stock_can_still_be_typed_for_a_colour_with_no_rolls(self):
        self.auth()

        response = self.client.patch(
            f"/api/items/variants/{self.variant1.pk}/", {"stock_meters": "1234"}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.variant1.refresh_from_db()
        self.assertEqual(self.variant1.stock_meters, D("1234.000"))

    def test_metres_on_a_roll_are_not_directly_writable(self):
        roll = self.receive(D("100"))
        self.auth()

        response = self.client.patch(
            f"/api/items/rolls/{roll.pk}/", {"remaining_meters": "0"}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        roll.refresh_from_db()
        self.assertEqual(roll.remaining_meters, D("100.000"))
        self.assert_in_step()

    def test_the_variant_list_reports_roll_tracking(self):
        self.receive(D("100"))
        self.auth()

        response = self.client.get("/api/items/variants/all/")

        rows = {row["display_order"]: row for row in response.data}
        self.assertTrue(rows["Royal Blue"]["is_roll_tracked"])
        self.assertEqual(rows["Royal Blue"]["roll_count"], 1)
        self.assertEqual(rows["Royal Blue"]["roll_stock_meters"], "100.000")
        self.assertFalse(rows["Natural"]["is_roll_tracked"])
        self.assertEqual(rows["Natural"]["roll_count"], 0)
        self.assertEqual(rows["Natural"]["roll_stock_meters"], "3000.000")

    def test_a_fabric_serializer_reports_its_colour_roll_totals(self):
        self.receive(D("100"))
        self.receive(D("25"))

        data = self._fabric_detail()

        colours = {
            entry["display_order"]: entry for entry in data["variants"]
        }
        self.assertTrue(colours["Royal Blue"]["is_roll_tracked"])
        self.assertEqual(colours["Royal Blue"]["roll_count"], 2)
        self.assertEqual(colours["Royal Blue"]["roll_stock_meters"], "125.000")
        self.assertEqual(colours["Royal Blue"]["stock_meters"], "125.000")

    def _fabric_detail(self):
        self.auth()
        response = self.client.get(f"/api/items/{self.fabric.pk}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data


# --------------------------------------------------------------------------- #
# Packing
# --------------------------------------------------------------------------- #


class PackingConsumesRollsTests(RollTestBase):
    def test_the_least_leftover_combination_is_what_the_preview_offers(self):
        # Rolled in this order, so FIFO would take 300, then 250, then 50 off the
        # third: three rolls cut and 450 m of cloth left stranded on them.
        self.receive(D("300"))
        self.receive(D("250"))
        third = self.receive(D("500"))

        # Selection is no longer the server's to make at pack time -- it is what
        # the preview shows the admin before they scan -- so this is asserted
        # against the planner rather than against a confirmed round.
        plan = plan_roll_consumption(self.tracked, D("600"))

        self.assertEqual(
            [(roll.pk, take) for roll, take in plan],
            [(third.pk - 1, D("250.000")), (third.pk, D("350.000"))],
        )
        self.assert_in_step()

    def test_a_single_roll_is_offered_in_preference_to_splitting_one(self):
        # 450 m fits on the 450 m roll on its own, so the 900 m roll is not
        # suggested even though it was received first.
        first = self.receive(D("900"))
        fitting = self.receive(D("450"))

        plan = plan_roll_consumption(self.tracked, D("400"))

        self.assertEqual([roll.pk for roll, _ in plan], [fitting.pk])
        self.assertNotIn(first.pk, [roll.pk for roll, _ in plan])
        self.assert_in_step()

    def test_every_cut_is_recorded_against_its_roll(self):
        first = self.receive(D("300"))
        second = self.receive(D("200"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("500"), variant=self.tracked)
        bundle = self.open_bundle(order)

        self.scan(order, bundle, first)
        self.scan(order, bundle, second)

        entries = RollAllocation.objects.order_by("allocation_id")
        self.assertEqual([e.roll_id for e in entries], [first.pk, second.pk])
        # A scan cuts the whole roll, so each entry is that roll's full length.
        self.assertEqual([e.metres for e in entries], [D("300.000"), D("200.000")])
        self.assertEqual([e.sequence for e in entries], [1, 1])
        self.assertFalse(any(e.is_reversed for e in entries))
        # Both are tagged with the bundle they were scanned into.
        self.assertEqual({e.bundle_id for e in entries}, {bundle["id"]})

    def test_cancelling_puts_the_cloth_back_on_the_same_rolls(self):
        first = self.receive(D("300"))
        second = self.receive(D("200"))
        order = self.make_order(self.customer1)
        self.make_line(order, D("500"), variant=self.tracked)
        bundle = self.open_bundle(order)
        self.scan(order, bundle, first)
        self.scan(order, bundle, second)

        self.cancel_bundle(order, bundle)

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.remaining_meters, D("300.000"))
        self.assertTrue(first.is_active)
        self.assertEqual(second.remaining_meters, D("200.000"))
        self.assertTrue(second.is_active)
        self.assert_in_step()
        self.assertEqual(self.tracked.stock_meters, D("500.000"))
        self.assertTrue(all(e.is_reversed for e in RollAllocation.objects.all()))

    def test_a_cancelled_roll_is_not_credited_a_second_time(self):
        roll = self.receive(D("300"))
        order = self.make_order(self.customer1)
        self.make_line(order, D("300"), variant=self.tracked)
        bundle = self.open_bundle(order)
        self.scan(order, bundle, roll)
        self.cancel_bundle(order, bundle)

        # The roll is whole again, so a fresh bundle can take it once more...
        again = self.open_bundle(order)
        response = self.scan(order, again, roll)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        # ...and the old, reversed entry is still marked reversed rather than
        # quietly reused, so the two records cannot be mistaken for one cut.
        entries = RollAllocation.objects.order_by("id")
        self.assertEqual([e.is_reversed for e in entries], [True, False])
        self.assertEqual([e.bundle_id for e in entries], [bundle["id"], again["id"]])
        roll.refresh_from_db()
        self.assertEqual(roll.remaining_meters, D("0.000"))
        self.assertEqual(self.tracked.stock_meters, D("0.000"))

    def test_the_roll_history_shows_where_the_metres_went(self):
        roll = self.receive(D("300"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("300"), variant=self.tracked)
        self.scan(order, self.open_bundle(order), roll)
        self.auth()

        response = self.client.get(f"/api/items/rolls/{roll.pk}/history/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["roll"]["roll_number"], roll.roll_number)
        entry = response.data["entries"][0]
        self.assertEqual(str(entry["metres"]), "300.000")
        self.assertEqual(entry["roll_number"], roll.roll_number)
        self.assertEqual(entry["order"], order.pk)

    def test_a_scan_cannot_cut_more_than_the_roll_actually_holds(self):
        roll = self.receive(D("100"))
        # Somebody edited the warehouse total by hand, so it claims cloth the
        # rolls do not have. Packing must trust the roll.
        FabricVariant.objects.filter(pk=self.tracked.pk).update(
            stock_meters=D("500")
        )
        self.tracked.refresh_from_db()
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("450"), variant=self.tracked)

        self.scan(order, self.open_bundle(order), roll)

        # Only the roll's own 100 m moved; the drifted total was not packed against.
        roll.refresh_from_db()
        self.assertEqual(roll.remaining_meters, ZERO)
        self.assertFalse(roll.is_active)
        self.assertEqual(Allocation.objects.count(), 1)
        self.assertEqual(
            Allocation.objects.get().metres, D("100.000")
        )

    def test_preview_shows_the_rolls_a_round_would_cut(self):
        first = self.receive(D("100"))
        self.receive(D("100"))
        order = self.make_order(self.customer1)
        self.make_line(order, D("150"), variant=self.tracked)
        self.auth()

        response = self.client.post(
            "/api/orders/packing-rounds/preview/",
            {"variant": self.tracked.pk, "round_size": "150"},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        cut = response.data["roll_cut"]
        self.assertEqual(len(cut["rolls"]), 2)
        self.assertEqual(cut["rolls"][0]["roll_number"], first.roll_number)

    def test_a_colour_with_no_rolls_is_packed_exactly_as_before(self):
        packing_round = self.make_round(variant=self.variant1, round_size=D("500"))

        self.confirm(packing_round)

        self.variant1.refresh_from_db()
        self.assertEqual(self.variant1.stock_meters, D("2500.000"))
        self.assertEqual(RollAllocation.objects.count(), 0)
        self.assertEqual(Allocation.objects.count(), 1)

    def test_stock_returns_follow_the_rolls_when_an_order_is_deleted(self):
        first = self.receive(D("100"))
        second = self.receive(D("100"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("200"), variant=self.tracked)
        bundle = self.open_bundle(order)
        self.scan(order, bundle, first)
        self.scan(order, bundle, second)
        # The scans moved the packed total on the row, so hand the return the
        # line as it now stands rather than as it was when it was created.
        line.refresh_from_db()

        stock_movement_for_lines([line], direction="return")

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.remaining_meters, D("100.000"))
        self.assertEqual(second.remaining_meters, D("100.000"))
        self.assert_in_step()
        self.assertTrue(all(e.is_reversed for e in RollAllocation.objects.all()))

    def test_the_single_line_pack_endpoint_reports_the_roll_it_cut(self):
        roll = self.receive(D("100"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("50"), variant=self.tracked)

        response = self.pack(
            order, line, 30, rolls=[{"roll": roll.pk, "metres": "30"}]
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["rolls"]), 1)
        self.assertEqual(response.data["rolls"][0]["roll_number"], roll.roll_number)
        self.assertEqual(response.data["rolls"][0]["metres"], "30.000")
        self.assertEqual(response.data["stock_meters"], "70.000")
        self.assert_in_step()

    def test_the_single_line_pack_endpoint_refuses_what_the_rolls_do_not_hold(self):
        self.receive(D("10"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("500"), variant=self.tracked)

        response = self.pack(order, line, 50)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assert_in_step()
        self.assertEqual(Allocation.objects.count(), 0)


class RollPreviewHelperTests(RollTestBase):
    def test_preview_is_best_fit_and_writes_nothing(self):
        first = self.receive(D("100"))
        second = self.receive(D("100"))

        preview = preview_consumption(self.tracked, D("150"))

        self.assertEqual(
            [row["roll_number"] for row in preview["rolls"]],
            [first.roll_number, second.roll_number],
        )
        self.assertEqual(FabricRoll.objects.count(), 2)
        self.assert_in_step()

    def test_a_roll_that_is_used_up_is_skipped(self):
        empty = self.receive(D("50"))
        adjust_roll(empty, D("-50"))
        stocked = self.receive(D("80"))

        preview = preview_consumption(self.tracked, D("20"))

        self.assertEqual(len(preview["rolls"]), 1)
        self.assertEqual(preview["rolls"][0]["roll_number"], stocked.roll_number)


# --------------------------------------------------------------------------- #
# Best-fit roll selection
# --------------------------------------------------------------------------- #


class RollSelectionTests(RollTestBase):
    """``plan_roll_consumption`` in priority order, before anything is written."""

    def plan(self, metres):
        return [
            (roll.roll_number, take)
            for roll, take in plan_roll_consumption(self.tracked, metres)
        ]

    def numbers(self, metres):
        return [roll.roll_number for roll, _ in plan_roll_consumption(self.tracked, metres)]

    def test_an_exact_match_is_used_on_its_own(self):
        first = self.receive(D("300"))
        exact = self.receive(D("500"))
        self.receive(D("250"))

        self.assertEqual(self.plan(D("500")), [(exact.roll_number, D("500.000"))])
        # The other two are untouched, and nothing was written to say so.
        first.refresh_from_db()
        self.assertEqual(first.remaining_meters, D("300.000"))

    def test_exact_match_wins_over_a_smaller_sufficient_roll(self):
        # The 100 m roll would be the tighter fit, but the brief puts exact match
        # first, so 500 goes entirely off the 500 m roll.
        smaller = self.receive(D("100"))
        exact = self.receive(D("500"))

        self.assertEqual(self.plan(D("500")), [(exact.roll_number, D("500.000"))])
        smaller.refresh_from_db()
        self.assertEqual(smaller.remaining_meters, D("100.000"))

    def test_the_smallest_sufficient_roll_is_chosen(self):
        self.receive(D("300"))
        self.receive(D("900"))
        fitting = self.receive(D("450"))
        oversized = self.receive(D("700"))

        self.assertEqual(self.plan(D("400")), [(fitting.roll_number, D("400.000"))])
        oversized.refresh_from_db()
        self.assertEqual(oversized.remaining_meters, D("700.000"))

    def test_ties_on_size_go_to_the_oldest_roll(self):
        # Nothing matches 400 m exactly and both 450 m rolls would serve, so the
        # older of the twins is the one cut.
        self.receive(D("300"))
        older_twin = self.receive(D("450"))
        newer_twin = self.receive(D("450"))

        self.assertEqual(self.plan(D("400")), [(older_twin.roll_number, D("400.000"))])
        newer_twin.refresh_from_db()
        self.assertEqual(newer_twin.remaining_meters, D("450.000"))

    def test_the_combination_beats_the_fifo_order(self):
        # FIFO would take 300 + 250 + 50 off the 500, cutting three rolls and
        # stranding 450 m. The least-leftover combination is 250 + 350.
        first = self.receive(D("300"))
        second = self.receive(D("250"))
        third = self.receive(D("500"))

        self.assertEqual(
            self.plan(D("600")),
            [(second.roll_number, D("250.000")), (third.roll_number, D("350.000"))],
        )
        first.refresh_from_db()
        self.assertEqual(first.remaining_meters, D("300.000"))

    def test_leftover_is_judged_before_roll_count(self):
        # Two rolls could cover 1000 m (700 + 500), leaving 200 m stranded. Three
        # rolls cover it exactly (700 + 200 + 100), leaving none. Leftover is the
        # first tie-break, so the three-roll plan wins despite touching more rolls.
        first = self.receive(D("700"))
        self.receive(D("500"))
        second = self.receive(D("200"))
        third = self.receive(D("100"))

        self.assertEqual(
            self.plan(D("1000")),
            [
                (first.roll_number, D("700.000")),
                (second.roll_number, D("200.000")),
                (third.roll_number, D("100.000")),
            ],
        )

    def test_fewest_rolls_breaks_a_leftover_tie(self):
        # 700 + 310 and 500 + 400 + 110 both come to 1010, so the tie is broken on
        # how many rolls it takes rather than which ones.
        first = self.receive(D("700"))
        self.receive(D("500"))
        self.receive(D("400"))
        fourth = self.receive(D("310"))
        self.receive(D("110"))

        plan = self.plan(D("1000"))

        self.assertEqual(
            [roll for roll, _ in plan], [first.roll_number, fourth.roll_number]
        )
        # The 310 m roll gives up only the 300 m still wanted; its last 10 m are
        # the leftover the selection measured.
        self.assertEqual([take for _, take in plan], [D("700.000"), D("300.000")])

    def test_oldest_rolls_break_a_two_way_tie(self):
        # Both 400 m rolls serve equally well, so the older one is used.
        older_twin = self.receive(D("400"))
        self.receive(D("400"))
        big = self.receive(D("1000"))

        self.assertEqual(
            self.numbers(D("1100")), [older_twin.roll_number, big.roll_number]
        )

    def test_selection_sees_only_the_metres_not_what_was_ordered(self):
        # Same rolls, same metres figure, so the same answer every time: selection
        # is about the metres being packed, not the quantity on the order line.
        self.receive(D("300"))
        second = self.receive(D("250"))
        third = self.receive(D("500"))
        expected = [
            (second.roll_number, D("250.000")),
            (third.roll_number, D("350.000")),
        ]

        for _ in range(3):
            self.assertEqual(self.plan(D("600")), expected)

    def test_three_decimal_places_are_carried_exactly(self):
        first = self.receive(D("300.250"))
        second = self.receive(D("300.250"))

        self.assertEqual(
            self.plan(D("600.500")),
            [(first.roll_number, D("300.250")), (second.roll_number, D("300.250"))],
        )

    def test_more_rolls_than_the_bound_still_answer_promptly(self):
        # Past MAX_ROLLS_FOR_EXACT_FIT the exact subset search is skipped for the
        # documented greedy fallback. A pack at that scale must not hang, so this
        # is timed: the fallback is a sort and a walk, not a search.
        sizes = [100] * (MAX_ROLLS_FOR_EXACT_FIT + 5) + [9000]

        started = time.monotonic()
        plan = plan_roll_consumption(self.tracked, D("1000"), rolls=stub_rolls(sizes))
        elapsed = time.monotonic() - started

        # Greedy largest-first reaches for the 9000 m roll.
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0][1], D("1000.000"))
        self.assertLess(elapsed, 2.0, f"the fallback took {elapsed:.2f}s")

    def test_up_to_the_bound_the_exact_search_still_answers_promptly(self):
        # Right at the bound the exact search still runs, and is what chooses here.
        sizes = [100] * MAX_ROLLS_FOR_EXACT_FIT

        started = time.monotonic()
        plan = plan_roll_consumption(self.tracked, D("4000"), rolls=stub_rolls(sizes))
        elapsed = time.monotonic() - started

        self.assertEqual(sum((take for _, take in plan), ZERO), D("4000.000"))
        self.assertEqual(len(plan), MAX_ROLLS_FOR_EXACT_FIT)
        self.assertLess(elapsed, 2.0, f"the exact search took {elapsed:.2f}s")

    def test_rolls_of_equal_size_come_out_the_same_either_way(self):
        # Guards the fallback against drifting from the exact answer: with every
        # roll the same size there is only one sensible plan, whichever path runs.
        sizes = [100] * (MAX_ROLLS_FOR_EXACT_FIT + 3)
        plan = plan_roll_consumption(self.tracked, D("1000"), rolls=stub_rolls(sizes))

        self.assertEqual([take for _, take in plan], [D("100.000")] * 10)

    def test_a_colour_with_no_rolls_cannot_be_selected_from(self):
        self.assertEqual(self.plan(D("100")), [])


class RollOverrideTests(RollTestBase):
    """The admin's own breakdown, and the server refusing a bad one."""

    def test_an_override_is_cut_and_recorded_rather_than_the_suggestion(self):
        first = self.receive(D("900"))
        second = self.receive(D("450"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("400"), variant=self.tracked)

        response = self.pack(
            order,
            line,
            400,
            rolls=[{"roll": first.pk, "metres": "400"}],
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Best fit would have suggested the 450 m roll, so this proves the
        # override is what was used.
        second.refresh_from_db()
        self.assertEqual(second.remaining_meters, D("450.000"))
        entry = RollAllocation.objects.get()
        self.assertEqual(entry.roll_id, first.pk)
        self.assertEqual(entry.metres, D("400.000"))
        self.assert_in_step()

    def test_an_override_spanning_two_rolls_is_recorded_as_two_rows(self):
        first = self.receive(D("900"))
        second = self.receive(D("450"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("700"), variant=self.tracked)

        response = self.pack(
            order,
            line,
            700,
            rolls=[{"roll": second.pk, "metres": "450"}, {"roll": first.pk, "metres": "250"}],
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        entries = RollAllocation.objects.order_by("sequence")
        # Recorded oldest roll first, whatever order the admin listed them in, so
        # the rows read the same way every time.
        self.assertEqual([e.roll_id for e in entries], [first.pk, second.pk])
        self.assertEqual([e.metres for e in entries], [D("250.000"), D("450.000")])
        self.assert_in_step()

    def test_cancelling_restores_the_override_not_the_suggestion(self):
        first = self.receive(D("900"))
        second = self.receive(D("450"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("400"), variant=self.tracked)
        self.pack(order, line, 400, rolls=[{"roll": first.pk, "metres": "400"}])

        packing_round = PackingRound.objects.get()
        cancel_round(packing_round, user=self.admin_user)

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.remaining_meters, D("900.000"))
        self.assertEqual(second.remaining_meters, D("450.000"))
        self.assert_in_step()
        self.assertEqual(self.tracked.stock_meters, D("1350.000"))
        self.assertTrue(all(e.is_reversed for e in RollAllocation.objects.all()))

    def test_a_pack_naming_no_roll_is_refused_rather_than_guessed(self):
        self.receive(D("900"))
        fitting = self.receive(D("450"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("400"), variant=self.tracked)

        response = self.pack(order, line, 400)

        # Which roll the metres come off is decided by scanning its label, not by
        # the server picking the convenient one, so no breakdown is a refusal.
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("scanning", response.data["error"])
        self.assertEqual(RollAllocation.objects.count(), 0)
        self.assertFalse(
            FabricRoll.objects.filter(pk=fitting.pk, remaining_meters=D("0")).exists()
        )
        self.assert_in_step()

    def test_an_override_that_does_not_add_up_is_refused(self):
        roll = self.receive(D("900"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("400"), variant=self.tracked)

        response = self.pack(order, line, 400, rolls=[{"roll": roll.pk, "metres": "300"}])

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("add up", response.data["error"])
        self.assertEqual(RollAllocation.objects.count(), 0)
        self.assert_in_step()

    def test_an_override_asking_more_than_a_roll_holds_is_refused(self):
        self.receive(D("900"))
        small = self.receive(D("450"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("700"), variant=self.tracked)

        # The total is right, but it asks 700 m off a 450 m roll.
        response = self.pack(
            order, line, 700, rolls=[{"roll": small.pk, "metres": "700"}]
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("left", response.data["error"])
        self.assertEqual(RollAllocation.objects.count(), 0)
        self.assert_in_step()

    def test_an_override_naming_another_colours_roll_is_refused(self):
        self.receive(D("900"))
        stray = FabricVariant.objects.create(
            fabric=self.fabric, display_order="Stray", stock_meters=D("600")
        )
        stray_roll = receive_roll(stray, D("600"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("400"), variant=self.tracked)

        response = self.pack(
            order, line, 400, rolls=[{"roll": stray_roll.pk, "metres": "400"}]
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(RollAllocation.objects.count(), 0)
        self.assert_in_step()

    def test_an_override_giving_a_roll_nothing_is_refused(self):
        roll = self.receive(D("900"))
        order = self.make_order(self.customer1)
        line = self.make_line(order, D("400"), variant=self.tracked)

        response = self.pack(order, line, 400, rolls=[{"roll": roll.pk, "metres": "0"}])

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(RollAllocation.objects.count(), 0)
        self.assert_in_step()

    def test_the_breakdown_is_rechecked_against_the_rolls_as_they_are_now(self):
        # The server is the source of truth: a breakdown that was fine when the
        # admin saw it is refused once the roll no longer holds that much.
        roll = self.receive(D("900"))

        with self.assertRaises(RollError):
            resolve_roll_plan(
                self.tracked,
                D("400"),
                rolls=[roll],
                roll_override=[{"roll": roll.pk, "metres": "399"}],
            )
