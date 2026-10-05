"""Physical roll tracking: the single place variant stock and rolls stay in step.

The invariant this module exists to protect::

    variant.stock_meters == SUM(roll.remaining_meters for the variant's active rolls)

for every colour that has any rolls at all. A colour with no rolls keeps the
original single-figure stock model and nothing here applies, which is why every
existing variant and every existing packing path carries on working untouched.

``FabricVariant.stock_meters`` stays the number the rest of the system reads --
packing, valuation, the allocation engine and the backorder report all keep
using it. Rolls are the *breakdown* of that figure, not a second source of truth,
so every metre received here or cut in packing moves both in the same
transaction. Nothing else in the codebase writes a roll's ``remaining_meters``,
and nothing else may write a roll-tracked variant's ``stock_meters`` directly
(the API refuses it and points here instead).

Roll selection is best-fit: an exact-size roll first, then the smallest roll that
has enough on it, then the combination of rolls that covers the metres with the
least cloth left over (see :func:`plan_roll_consumption`). An admin may override
that suggestion when packing a single order line, and the breakdown they confirm is
what gets written. Which roll each metre came off is recorded in
:class:`apps.orders.models.RollAllocation`, never recomputed afterwards, because
cancelling a round has to put the cloth back on the roll it was actually cut from.

All arithmetic is ``Decimal(14,3)``; no float ever touches cloth.
"""

import logging
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Max, Sum
from django.utils import timezone

from .models import FabricRoll, FabricVariant
from .services import sync_out_of_stock

logger = logging.getLogger(__name__)

ZERO = Decimal("0")

#: Mirrors ``MIN_ORDER_METERS`` in the orders app: below this it is a rounding
#: artefact, not cloth somebody cut.
MIN_ROLL_METERS = Decimal("0.001")

#: Highest number a ``Decimal(14,3)`` field can hold.
MAX_METERS = Decimal("99999999999.999")

ROLL_NUMBER_PREFIX = "R-"

#: Marks the roll a colour's pre-roll metre figure is recorded as, so the cloth
#: that was already on hand is still visible as a roll in the warehouse.
OPENING_STOCK_NOTE = "Opening stock"


class RollError(ValueError):
    """A roll operation that cannot go ahead, phrased for an admin to read."""


# --------------------------------------------------------------------------- #
# Reading
# --------------------------------------------------------------------------- #


def is_roll_tracked(variant):
    """Whether this colour's metres are broken down into rolls.

    Serialising a list of order lines calls this once per line, and an
    unsaved-or-bare variant would otherwise cost one round trip each. A variant
    fetched through ``variants_with_committed_demand()`` already carries the
    answer as ``_has_rolls``, so use it and keep the whole page to one query.
    """
    if variant is None or variant.pk is None:
        return False
    annotated = getattr(variant, "_has_rolls", None)
    if annotated is not None:
        return bool(annotated)
    return FabricRoll.objects.filter(variant=variant).exists()


def roll_stock(variant):
    """Metres still on the colour's rolls.

    Exhausted rolls are inactive but hold zero, so they add nothing here.
    """
    return (
        FabricRoll.objects.filter(variant=variant, is_active=True).aggregate(
            total=Sum("remaining_meters")
        )["total"]
        or ZERO
    )


def roll_summary(variant, rows=None):
    """Counts and totals the inventory screens show for one colour.

    Read from the variant's rolls in Python rather than as several aggregates: a
    colour holds tens of rolls, not thousands, and one query beats four.

    For a colour with no rolls -- every variant that predates roll tracking --
    the roll figures mirror the warehouse total, so a screen can show one number
    whichever shape the colour has.

    ``rows`` is the colour's already-read rolls, for a caller that has them: a
    screen listing a roll breaks down both from the same read, and asking again
    here would fetch the identical rows a second time.
    """
    rolls = list(FabricRoll.objects.filter(variant=variant) if rows is None else rows)
    tracked = bool(rolls)
    active = [r for r in rolls if r.is_active]
    remaining = sum((Decimal(str(r.remaining_meters or ZERO)) for r in active), ZERO)
    original = sum((Decimal(str(r.original_meters or ZERO)) for r in rolls), ZERO)
    sizes = [Decimal(str(r.original_meters or ZERO)) for r in rolls]

    if not tracked:
        remaining = Decimal(str(variant.stock_meters or ZERO))

    return {
        "is_roll_tracked": tracked,
        "roll_count": len(rolls),
        "active_roll_count": len(active),
        "exhausted_roll_count": sum(
            1 for r in rolls if Decimal(str(r.remaining_meters or ZERO)) <= ZERO
        ),
        "total_received_meters": original,
        "roll_stock_meters": remaining,
        "consumed_meters": original - remaining if tracked else ZERO,
        "largest_roll_meters": max(sizes) if sizes else ZERO,
        "smallest_roll_meters": min(sizes) if sizes else ZERO,
    }


def roll_payload(variant, rows=None):
    """:func:`roll_summary` as strings, ready for an API response.

    Every metre figure in this project crosses the wire as a string, so no
    float ever gets anywhere near cloth.
    """
    summary = roll_summary(variant, rows=rows)
    return {
        "is_roll_tracked": summary["is_roll_tracked"],
        "roll_count": summary["roll_count"],
        "active_roll_count": summary["active_roll_count"],
        "exhausted_roll_count": summary["exhausted_roll_count"],
        "total_received_meters": str(summary["total_received_meters"]),
        "roll_stock_meters": str(summary["roll_stock_meters"]),
        "consumed_meters": str(summary["consumed_meters"]),
        "largest_roll_meters": str(summary["largest_roll_meters"]),
        "smallest_roll_meters": str(summary["smallest_roll_meters"]),
    }


def variant_roll_info(variant):
    """``(is_roll_tracked, roll_count, roll_stock)`` for a variant.

    Uses a prefetched roll set when the caller asked for one, so listing a whole
    catalogue does not turn into a query per colour. An empty prefetch means the
    colour has no rolls, which is the common case and must not be mistaken for a
    tracked colour holding nothing.
    """
    cache = getattr(variant, "_prefetched_objects_cache", None)
    rolls = cache.get("rolls") if isinstance(cache, dict) else None
    if rolls is not None:
        if not rolls:
            return False, 0, Decimal(str(variant.stock_meters or ZERO))
        stock = sum(
            (
                Decimal(str(roll.remaining_meters or ZERO))
                for roll in rolls
                if roll.is_active
            ),
            ZERO,
        )
        return True, len(rolls), stock
    summary = roll_summary(variant)
    return (
        summary["is_roll_tracked"],
        summary["roll_count"],
        summary["roll_stock_meters"],
    )


def roll_invariant_holds(variant):
    """Whether ``stock_meters`` matches the rolls. Used by tests and repairs."""
    if not is_roll_tracked(variant):
        return True
    return Decimal(str(variant.stock_meters)) == roll_stock(variant)


def lock_variant(variant):
    """Re-read a variant under ``SELECT FOR UPDATE``.

    Every roll write starts here. Locking the colour, not just the rolls, means
    two admins receiving or packing the same cloth at the same moment queue up
    instead of both reading the same "before" figure and writing over each other.
    """
    return FabricVariant.objects.select_for_update().get(pk=variant.pk)


def locked_rolls(variant):
    """The colour's rolls, locked oldest-first.

    Locked in the same order by every caller (consume, return, adjust) so two
    transactions can never hold the same pair of rolls in opposite orders and
    deadlock.
    """
    return list(
        FabricRoll.objects.select_for_update()
        .filter(variant=variant)
        .order_by("created_at", "id")
    )


def move_variant_stock(variant, delta):
    """Add ``delta`` metres -- which may be negative -- to the warehouse total.

    :func:`apps.items.services.restock_variant` only ever adds, because it exists
    to record a delivery. Roll adjustments and returns take cloth away as well,
    so they go through here instead. The parent fabric's out-of-stock flag is
    re-synced by hand because ``QuerySet.update`` skips ``post_save``.

    Caller holds the variant's row lock, so this cannot interleave with another
    roll write for the same colour.
    """
    delta = Decimal(str(delta))
    if delta == ZERO:
        return variant

    new_total = Decimal(str(variant.stock_meters)) + delta
    if new_total < ZERO:
        raise RollError(
            f"That would take {variant.fabric.name} "
            f"({variant.display_order or 'unlabelled'}) below zero on hand."
        )

    FabricVariant.objects.filter(pk=variant.pk).update(
        stock_meters=new_total,
        stock_updated_at=timezone.now(),
    )
    variant.refresh_from_db(fields=["stock_meters", "stock_updated_at"])
    sync_out_of_stock(variant.fabric)
    return variant


# --------------------------------------------------------------------------- #
# Receiving stock
# --------------------------------------------------------------------------- #


def record_opening_stock_roll(variant):
    """Give a colour's pre-roll metre figure a roll of its own.

    A colour created with a plain metre figure holds cloth belonging to no roll.
    Receiving is additive, so that figure stays in the total -- and a figure that
    is in the total but on no roll breaks this module's invariant and, worse, is
    metres packing cannot cut: every cut is planned against rolls.

    So the figure is turned into a roll, noted as the opening stock, on the same
    transaction and under the same lock as the delivery that triggered it. The
    caller is adding the delivery's metres on top afterwards, which is what makes
    the colour's total right rather than merely consistent.

    Returns the figure's size, or zero when there is nothing to convert: no rolls
    yet is the only case that does any work, so this is a no-op for every later
    receive. Caller holds the variant lock and the transaction.
    """
    if variant.rolls.exists():
        return ZERO

    opening = Decimal(str(variant.stock_meters or ZERO))
    if opening <= ZERO:
        return ZERO

    _create_roll(variant, opening, None, OPENING_STOCK_NOTE)
    logger.info(
        "Recorded %s m of opening stock on variant %s as its own roll, so it can "
        "be cut and stays part of the roll total.",
        opening,
        variant.pk,
    )
    return opening


def next_roll_number():
    """The next human-readable roll number, e.g. ``R-000007``.

    Derived from the newest roll's id so it keeps climbing even after a roll is
    deleted, and stepped past anything already taken so a hand-typed number can
    never collide.
    """
    highest = FabricRoll.objects.aggregate(m=Max("id"))["m"] or 0
    candidate = highest + 1
    while True:
        number = f"{ROLL_NUMBER_PREFIX}{candidate:06d}"
        if not FabricRoll.objects.filter(roll_number=number).exists():
            return number
        candidate += 1


def clean_meters(raw, field="meters"):
    """Parse a metre figure, refusing anything that is not real cloth.

    Accepts the strings the API sends and rejects blank, non-numeric, zero,
    negative and out-of-range figures in one place, so no caller has to remember
    to check.
    """
    if raw is None or raw == "":
        raise RollError("Enter how many metres this roll holds.")
    try:
        metres = Decimal(str(raw))
    except (InvalidOperation, TypeError, ValueError):
        raise RollError("Metres must be a number, for example 250.000.")
    if not metres.is_finite():
        raise RollError("Metres must be a number, for example 250.000.")
    # Quantise before validating: 0.0004 m is below a millimetre, so it rounds to
    # nothing and would fail the model's own "original metres must be positive"
    # constraint with a database error instead of a sentence.
    metres = metres.quantize(Decimal("0.001"))
    if metres < MIN_ROLL_METERS:
        raise RollError(
            f"A roll must hold at least {MIN_ROLL_METERS.normalize()} m."
        )
    if metres > MAX_METERS:
        raise RollError(f"A roll cannot hold more than {MAX_METERS:,} m.")
    return metres


def receive_roll(variant, metres, *, roll_number=None, note=""):
    """Receive one physical roll, adding its metres to the colour's stock.

    The roll and the variant total move together inside one transaction and
    under the variant's row lock, so a colour can never show metres on its rolls
    that the warehouse total does not have (or the other way round).

    A roll only ever adds. A colour opened with a plain metre figure keeps that
    figure: the first delivery converts it into a roll of its own so it can be
    cut and counted, then adds the new metres on top.
    """
    metres = clean_meters(metres)

    with transaction.atomic():
        locked = lock_variant(variant)
        record_opening_stock_roll(locked)
        roll = _create_roll(locked, metres, roll_number, note)
        move_variant_stock(locked, metres)
        logger.info(
            "Received roll %s: %s m of variant %s (stock now %s)",
            roll.roll_number,
            metres,
            locked.pk,
            locked.stock_meters,
        )
    roll.refresh_from_db()
    return roll


def _create_roll(variant, metres, roll_number=None, note=""):
    """Create one roll row. Caller holds the variant lock and the transaction."""
    note = (note or "").strip()[:100]

    if roll_number:
        typed = str(roll_number).strip()
        if FabricRoll.objects.filter(roll_number=typed).exists():
            raise RollError(f"Roll {typed} already exists.")
        return _insert_roll(variant, typed, metres, note)

    generated = next_roll_number()
    for attempt in range(20):
        candidate = (
            generated
            if attempt == 0
            else f"{ROLL_NUMBER_PREFIX}{int(generated[2:]) + attempt:06d}"
        )
        try:
            # The nested atomic() is a savepoint. Without it, an IntegrityError
            # would poison the enclosing transaction and the next attempt would
            # fail with TransactionManagementError instead of simply trying
            # another number.
            with transaction.atomic():
                return _insert_roll(variant, candidate, metres, note)
        except IntegrityError:
            # Two admins receiving at the same moment can pick the same
            # generated number; step past it rather than failing the shipment.
            continue
    raise RollError("Could not allocate a roll number. Please try again.")


def _insert_roll(variant, roll_number, metres, note):
    return FabricRoll.objects.create(
        variant=variant,
        roll_number=roll_number,
        note=note,
        original_meters=metres,
        remaining_meters=metres,
        is_active=True,
    )


def receive_rolls(variant, lengths):
    """Receive a whole factory shipment as several rolls, atomically.

    Every roll is created and every metre added in one transaction, so a bad
    figure halfway down a delivery leaves the warehouse exactly as it was.

    As with a single roll, a delivery only adds to what the colour already holds.
    An entry may carry a note, which is kept on the roll it describes.
    """
    parsed = []
    for index, raw in enumerate(lengths or [], start=1):
        metres = raw.get("meters") if isinstance(raw, dict) else raw
        try:
            parsed.append(
                (
                    clean_meters(metres, field=f"rolls[{index - 1}].meters"),
                    (raw.get("note") if isinstance(raw, dict) else None) or "",
                )
            )
        except RollError as exc:
            raise RollError(f"Roll {index}: {exc}")

    if not parsed:
        raise RollError("Enter at least one roll length.")

    with transaction.atomic():
        locked = lock_variant(variant)
        record_opening_stock_roll(locked)
        total = sum((metres for metres, _ in parsed), ZERO)
        created = []
        for metres, note in parsed:
            roll = _create_roll(locked, metres, None, note)
            created.append(roll)
        move_variant_stock(locked, total)

    for roll in created:
        roll.refresh_from_db()
    return created, total, locked


def adjust_roll(roll, delta, *, reason=""):
    """Move a single roll's metres by ``delta``, keeping the variant in step.

    Used to correct a miscounted delivery (a negative delta) or to add cloth to a
    roll already on the shelf (positive). Refuses to leave a roll in a state the
    database would not accept, and never lets a roll take more back than it
    originally held.
    """
    delta = Decimal(str(delta))
    if delta == ZERO:
        raise RollError("Enter a different figure to adjust this roll.")

    with transaction.atomic():
        locked_variant = lock_variant(roll.variant)
        locked = FabricRoll.objects.select_for_update().get(pk=roll.pk)

        new_remaining = locked.remaining_meters + delta
        if new_remaining < ZERO:
            raise RollError(
                f"{locked.roll_number} only holds "
                f"{locked.remaining_meters.normalize()} m, so it cannot give up "
                f"{abs(delta).normalize()} m."
            )
        if new_remaining > MAX_METERS:
            raise RollError(f"A roll cannot hold more than {MAX_METERS:,} m.")
        if delta > ZERO:
            # Cloth added to a roll on the shelf raises what it has ever held,
            # which is what ``original_meters`` records. Cloth taken off never
            # lowers it: the roll was still that long when it arrived.
            locked.original_meters = locked.original_meters + delta

        locked.remaining_meters = new_remaining
        locked.is_active = new_remaining > ZERO
        locked.save(
            update_fields=[
                "remaining_meters",
                "original_meters",
                "is_active",
                "updated_at",
            ]
        )
        move_variant_stock(locked_variant, delta)

    roll.refresh_from_db()
    return roll


# --------------------------------------------------------------------------- #
# Consuming stock
# --------------------------------------------------------------------------- #


#: Active rolls beyond this many skip the exact combination search below and use
#: the greedy fallback instead. A variant is expected to hold tens of rolls, so
#: the exact path is what runs in practice; the bound only exists so a warehouse
#: with an absurd number of rolls gets an answer instead of a hung packing round.
MAX_ROLLS_FOR_EXACT_FIT = 40

#: Second guard on the same search: give up on it if the reachable-sum table
#: grows past this many entries. Same reasoning, different axis.
MAX_FIT_STATES = 250_000

#: ``Decimal(14,3)`` metres become exact integer millimetres for the search, so
#: the subset arithmetic is integer arithmetic and no float ever touches cloth.
_METRE_UNITS = 1000


def _metre_units(value):
    """``Decimal(14,3)`` metres as exact integer millimetres."""
    return int((Decimal(str(value)) * _METRE_UNITS).to_integral_value())


def _draw_from(chosen, metres):
    """Take ``metres`` off ``chosen`` in order, never asking a roll for too much."""
    left = metres
    plan = []
    for roll, size in chosen:
        if left <= ZERO:
            break
        take = min(size, left)
        plan.append((roll, take))
        left -= take
    return plan


def _greedy_combination(available, metres):
    """Largest roll first, until the metres are covered.

    **Documented fallback.** This is not optimal: it can leave more cloth on the
    rolls than the exact search would. It exists so that a variant holding more
    than :data:`MAX_ROLLS_FOR_EXACT_FIT` active rolls still packs, immediately and
    predictably, instead of spending unbounded time on a subset search. Exact fit
    is what runs for any realistic roll count.
    """
    return sorted(
        available, key=lambda pair: (-pair[1], pair[0].created_at, pair[0].pk)
    )


def _best_combination(available, metres):
    """The subset of ``available`` that covers ``metres`` with the least leftover.

    A 0/1 subset-sum over the exact millimetre totals, keeping the best subset for
    every reachable total. Ties are settled in the documented order: minimum
    leftover first, then fewest rolls, then oldest rolls -- which falls out of
    comparing the chosen indexes, because ``available`` is already oldest-first.
    """
    if len(available) > MAX_ROLLS_FOR_EXACT_FIT:
        return _greedy_combination(available, metres)

    target = _metre_units(metres)
    sizes = [_metre_units(size) for _, size in available]

    # Every subset worth comparing ends at or below this ceiling. Taking the rolls
    # largest-first already reaches the target with less than one roll's worth of
    # slack, so a subset above the ceiling cannot beat that on leftover.
    ceiling = target + max(sizes) - 1

    # reachable[total] -> (rolls used, chosen indexes), kept as the best option for
    # that total.
    reachable = {0: (0, ())}
    for index, size in enumerate(sizes):
        # Descending, so the totals this roll extends have already been passed and
        # the roll cannot be taken twice.
        for total, current in sorted(reachable.items(), reverse=True):
            new_total = total + size
            if new_total > ceiling:
                continue
            candidate = (current[0] + 1, current[1] + (index,))
            existing = reachable.get(new_total)
            if existing is None or candidate < existing:
                reachable[new_total] = candidate
        if len(reachable) > MAX_FIT_STATES:
            return _greedy_combination(available, metres)

    best = None
    for total, (used, picked) in reachable.items():
        if total < target:
            continue
        key = (total - target, used, picked)
        if best is None or key < best[0]:
            best = (key, picked)

    if best is None:
        return _greedy_combination(available, metres)
    return [available[i] for i in best[1]]


def plan_roll_consumption(variant, metres, rolls=None):
    """Which rolls ``metres`` would come off, by best fit rather than FIFO.

    In priority order:

    1. **Exact match** -- a single roll holding exactly ``metres`` is used alone,
       leaving the other rolls untouched.
    2. **Best single-roll fit** -- otherwise the *smallest* roll that has enough on
       it, which keeps the leftover on one roll instead of splitting the pack
       across several.
    3. **Best combination** -- otherwise the subset covering ``metres`` with the
       least cloth left over, via :func:`_best_combination`.

    Applied to whatever metres figure is being packed, whether that is less than,
    equal to, or more than the ordered amount: selection is only about which
    physical rolls the metres come off.

    Returns ``[(roll, metres_from_that_roll), ...]``, oldest roll first. Returns an
    empty list when even every roll together cannot cover ``metres``, which is the
    caller's "insufficient stock" case and unchanged. Writes nothing.
    """
    metres = Decimal(str(metres))
    if metres <= ZERO:
        return []

    if rolls is None:
        rolls = list(
            FabricRoll.objects.filter(variant=variant).order_by("created_at", "id")
        )

    # Oldest first, and skipping used-up rolls. This is also the order
    # ``locked_rolls()`` locked these rows in.
    available = [
        (roll, Decimal(str(roll.remaining_meters or ZERO))) for roll in rolls
    ]
    available = [pair for pair in available if pair[1] > ZERO]
    available.sort(key=lambda pair: (pair[0].created_at, pair[0].pk))

    if sum((size for _, size in available), ZERO) < metres:
        return []

    # 1. Exact match.
    for roll, size in available:
        if size == metres:
            return [(roll, metres)]

    # 2. Best single-roll fit: smallest roll that has enough on it.
    fits = [pair for pair in available if pair[1] >= metres]
    if fits:
        best = min(fits, key=lambda pair: (pair[1], pair[0].created_at, pair[0].pk))
        return [(best[0], metres)]

    # 3. Best combination across rolls.
    return _draw_from(_best_combination(available, metres), metres)


def preview_consumption(variant, metres):
    """JSON-safe preview of which rolls packing would cut, without touching stock."""
    plan = plan_roll_consumption(variant, metres)
    requested = Decimal(str(metres))
    available = roll_stock(variant)
    covered = sum((take for _, take in plan), ZERO)
    # :func:`plan_roll_consumption` returns no plan at all when even every roll
    # together fall short, so `covered` would read as zero and the shortfall would
    # be reported as the whole request. Report what the rolls could actually have
    # given instead, which is the figure the warehouse can act on.
    if requested > ZERO and not plan:
        covered = min(requested, available)
    return {
        "rolls": [
            {
                "roll": roll.pk,
                "roll_number": roll.roll_number,
                "metres": str(take),
                "remaining_before": str(roll.remaining_meters),
                "remaining_after": str(
                    Decimal(str(roll.remaining_meters)) - take
                ),
            }
            for roll, take in plan
        ],
        "requested_meters": str(requested),
        "covered_meters": str(covered),
        "shortfall_meters": str(max(requested - covered, ZERO)),
        "available_meters": str(available),
    }


def _validate_roll_override(variant, metres, override, rolls):
    """Re-check the admin's roll breakdown against the rolls as they are now.

    The client is never trusted. Its totals are recomputed here, the rolls are
    re-read under the caller's lock, and every figure is compared to what the
    server holds -- so an override cannot quietly change the metres being packed,
    take more off a roll than it holds, or name a roll from another colour.
    """
    requested = Decimal(str(metres))

    if rolls is None:
        rolls = list(FabricRoll.objects.filter(variant=variant))
    locked = {roll.pk: roll for roll in rolls}

    total = ZERO
    plan = []
    for index, row in enumerate(override, start=1):
        take = Decimal(str(row.get("metres", ZERO)))
        roll = locked.get(row.get("roll"))

        if roll is None or roll.variant_id != variant.pk:
            raise RollError(
                f"Roll in position {index} is not one of this colour's rolls."
            )
        if take <= ZERO:
            raise RollError(
                f"{roll.roll_number} was given no metres to give. Give every roll "
                f"at least {MIN_ROLL_METERS.normalize()} m, or leave it out."
            )
        remaining = Decimal(str(roll.remaining_meters))
        if take > remaining:
            raise RollError(
                f"{roll.roll_number} only has {remaining.normalize()} m left, "
                f"so {take.normalize()} m cannot be cut from it."
            )
        total += take
        plan.append((roll, take))

    if total != requested:
        raise RollError(
            f"Those rolls add up to {total.normalize()} m, but "
            f"{requested.normalize()} m is being packed. The total has to match."
        )

    plan.sort(key=lambda pair: (pair[0].created_at, pair[0].pk))
    return plan


def resolve_roll_plan(variant, metres, rolls=None, roll_override=None):
    """Which rolls ``metres`` comes off: the admin's breakdown, else best fit."""
    if roll_override:
        return _validate_roll_override(variant, metres, roll_override, rolls)
    return plan_roll_consumption(variant, metres, rolls=rolls)


def consume_for_allocation(variant, allocation, metres, roll_override=None):
    """Cut ``metres`` off the colour's rolls and record where they came from.

    Called from inside the packing transaction, which already locks the variant,
    so the rolls and the variant total move together or not at all. One
    :class:`RollAllocation` row is written per roll touched, which is what makes
    an exact cancellation possible later. A no-op for a colour with no rolls,
    which is how variants that predate roll tracking keep working.

    ``roll_override`` is required for a roll-tracked colour: which roll the metres
    come off is decided by the warehouse scanning that roll's label, not by the
    server guessing. A caller that has not been told which roll to cut is refused
    rather than silently handed whichever one the algorithm likes, so no pack can
    ever take cloth off a roll nobody scanned.
    """
    metres = Decimal(str(metres))
    if metres <= ZERO:
        return []

    if not is_roll_tracked(variant):
        return []

    if not roll_override:
        raise RollError(
            f"{variant.fabric.name} ({variant.display_order or 'unlabelled'}) is "
            f"tracked by physical rolls, so {metres.normalize()} m cannot be cut "
            f"from it without scanning the roll to take them off."
        )

    rolls = locked_rolls(variant)
    plan = _validate_roll_override(variant, metres, roll_override, rolls)
    covered = sum((take for _, take in plan), ZERO)
    if covered < metres:
        raise RollError(
            f"Only {covered.normalize()} m of "
            f"{variant.fabric.name} ({variant.display_order or 'unlabelled'}) "
            f"is on its rolls, so {metres.normalize()} m cannot be cut from it."
        )

    from apps.orders.models import RollAllocation

    entries = []
    for sequence, (roll, take) in enumerate(plan, start=1):
        remaining = Decimal(str(roll.remaining_meters)) - take
        roll.remaining_meters = remaining
        roll.is_active = remaining > ZERO
        roll.save(update_fields=["remaining_meters", "is_active", "updated_at"])
        entries.append(
            RollAllocation.objects.create(
                allocation=allocation,
                roll=roll,
                metres=take,
                sequence=sequence,
            )
        )
    return entries


def return_roll_allocations(entries):
    """Hand metres back to the exact rolls they were cut from.

    Takes :class:`RollAllocation` rows rather than a total, because "return 150 m"
    is not the same instruction as "return the 150 m that came off roll
    R-000002". Already-reversed rows are skipped, so cancelling the same round
    twice can never credit a roll twice.

    The rolls are locked in the same ``(created_at, id)`` order :func:`locked_rolls`
    uses. Locking a set of rows in whatever order the plan happens to produce is
    how two transactions end up holding the same two rolls in opposite orders and
    deadlocking; the caller is inside the packing transaction that already holds
    the variant's lock, so every other roll write serialises behind it.
    """
    entries = [e for e in entries or [] if not e.is_reversed]
    if not entries:
        return ZERO

    entries.sort(key=lambda e: (e.roll_id, e.sequence, e.pk))
    roll_ids = {entry.roll_id for entry in entries}
    locked = {
        roll.pk: roll
        for roll in FabricRoll.objects.select_for_update()
        .filter(pk__in=roll_ids)
        .order_by("created_at", "id")
    }

    returned = ZERO
    for entry in entries:
        roll = locked.get(entry.roll_id)
        if roll is None:
            continue
        metres = Decimal(str(entry.metres))
        roll.remaining_meters = Decimal(str(roll.remaining_meters)) + metres
        roll.is_active = True
        roll.save(update_fields=["remaining_meters", "is_active", "updated_at"])
        entry.is_reversed = True
        entry.save(update_fields=["is_reversed"])
        returned += metres
    return returned


def roll_entries_for_allocations(allocations):
    """The roll records behind some allocations, oldest first."""
    from apps.orders.models import RollAllocation

    ids = [a.pk for a in allocations if a.pk]
    if not ids:
        return []
    return list(
        RollAllocation.objects.filter(allocation_id__in=ids)
        .select_related("roll", "allocation")
        .order_by("allocation_id", "sequence", "id")
    )


def return_metres_for_allocations(allocations):
    """Reverse the rolls behind a set of allocations. Returns metres returned."""
    return return_roll_allocations(roll_entries_for_allocations(allocations))


def return_metres_for_lines(lines):
    """Reverse the rolls behind the cloth allocated to some order lines.

    Used when an order or line is deleted: the metres go back to the rolls they
    were cut from, found through that line's allocations. Lines allocated before
    rolls existed have no records, and the caller handles those totals itself.
    """
    from apps.orders.models import Allocation

    ids = [line.pk for line in lines if line.pk]
    if not ids:
        return ZERO
    return return_metres_for_allocations(
        list(Allocation.objects.filter(order_item_id__in=ids).select_related("order_item"))
    )


# --------------------------------------------------------------------------- #
# Repair
# --------------------------------------------------------------------------- #


def sync_variant_stock(variant, *, force=False):
    """Set the variant's stock to the roll total.

    Not normally needed: every roll write moves the variant with it. It exists so
    an operator can put a colour back in step after editing metres by hand, and
    so a check can assert the invariant. ``force`` writes even when the figures
    already agree, which is how the stock cursor is bumped for a repair.
    """
    if not is_roll_tracked(variant):
        return variant.stock_meters
    expected = roll_stock(variant)
    if not force and Decimal(str(variant.stock_meters)) == expected:
        return variant.stock_meters
    FabricVariant.objects.filter(pk=variant.pk).update(
        stock_meters=expected,
        stock_updated_at=timezone.now(),
    )
    variant.refresh_from_db(fields=["stock_meters", "stock_updated_at"])
    return expected