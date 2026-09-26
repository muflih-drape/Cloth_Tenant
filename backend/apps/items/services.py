"""Fabric lifecycle helpers shared by the API, the purge command and Celery."""

import logging
import os
from dataclasses import dataclass, field
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.orders.models import OrderItem

from .models import Fabric, FabricVariant

logger = logging.getLogger(__name__)

ZERO = 0

#: Orders in these states still hold cloth in the warehouse: lines reference the
#: variant, so it must never be purged. Dispatched orders are terminal and only
#: carry snapshots, so they are safe.
OPEN_ORDER_STATUSES = ("DRAFT", "PENDING", "EDITING", "PACKED")


def touch_catalog(fabric):
    """Bump a fabric's ``catalog_updated_at``.

    Call only when the fabric's *catalog* changes (name, price, description,
    variant set). Never call it for stock changes: those bump
    ``FabricVariant.stock_updated_at`` and ``Fabric.out_of_stock_since``.
    """
    if fabric is None or fabric.pk is None:
        return
    Fabric.objects.filter(pk=fabric.pk).update(catalog_updated_at=timezone.now())


def total_stock(fabric):
    """Cloth on hand across every variant of ``fabric``, in metres."""
    total = fabric.variants.aggregate(total=Sum("stock_meters"))["total"]
    return total or ZERO


def sync_out_of_stock(fabric):
    """Keep ``out_of_stock_since`` in step with the fabric's total stock.

    Set when the last metre leaves, cleared when any metre comes back. Saves only
    when the value actually flips, so it is cheap to call on every stock move.
    """
    on_hand = total_stock(fabric)
    if on_hand == ZERO and fabric.out_of_stock_since is None:
        fabric.out_of_stock_since = timezone.now()
        fabric.save(update_fields=["out_of_stock_since"])
        touch_catalog(fabric)
        return True
    if on_hand != ZERO and fabric.out_of_stock_since is not None:
        fabric.out_of_stock_since = None
        fabric.save(update_fields=["out_of_stock_since"])
        touch_catalog(fabric)
        return True
    return False


def delete_fabric_keep_history(fabric):
    """Soft-delete a fabric exactly like the manual admin DELETE endpoint.

    Keeps every Order/OrderItem/OrderLog row intact; removes on-disk variant
    images only when no OrderItem references the variant.
    """
    for variant in fabric.variants.all():
        if variant.image:
            is_referenced = OrderItem.objects.filter(variant=variant).exists()
            if not is_referenced:
                if variant.image.path and os.path.exists(variant.image.path):
                    os.remove(variant.image.path)

    fabric.is_deleted = True
    fabric.save()
    touch_catalog(fabric)


def purge_threshold(days=None):
    """Cutoff for ``out_of_stock_since`` beyond which an archived fabric is purged.

    ``days`` optionally overrides the retention window (defaults to
    ``ARCHIVED_FABRIC_RETENTION_DAYS``). Total = ARCHIVE_AFTER_DAYS + retention.
    """
    retention = (
        days if days is not None else settings.ARCHIVED_FABRIC_RETENTION_DAYS
    )
    total = settings.ARCHIVE_AFTER_DAYS + retention
    return timezone.now() - timedelta(days=total)


@dataclass
class ArchivedFabricRecord:
    fabric_id: int
    name: str
    out_of_stock_since: object
    days_out_of_stock: int
    action: str  # "delete" | "skip"
    reason: str | None = None


@dataclass
class PurgeResult:
    #: Number of fabrics purged -- or, with ``dry_run=True``, how many the run
    #: would have purged.
    deleted: int = 0
    skipped_open_orders: int = 0
    skipped_restocked: int = 0
    failed: int = 0
    records: list = field(default_factory=list)


def _purge_eligibility(fabric, threshold):
    """Re-check the purge eligibility of a (locked) fabric row.

    Returns ``(eligible, reason)`` where reason is one of
    ``{"already_deleted", "restocked", "open_order"}`` when not eligible.
    """
    if fabric.is_deleted:
        return False, "already_deleted"

    if fabric.out_of_stock_since is None or fabric.out_of_stock_since > threshold:
        return False, "restocked"

    if total_stock(fabric) != ZERO:
        # Restocked between selection and this check.
        return False, "restocked"

    if OrderItem.objects.filter(
        order__status__in=OPEN_ORDER_STATUSES,
        fabric=fabric,
    ).exists():
        return False, "open_order"

    return True, None


def purge_archived_fabrics(*, days=None, limit=None, dry_run=False):
    """Purge archived fabrics that are past their retention window.

    Order-independent and idempotent: every fabric is re-checked inside its own
    transaction (with a row lock), so a restock or a new open order between
    selection and deletion protects it. Returns a :class:`PurgeResult`.
    """
    result = PurgeResult()
    threshold = purge_threshold(days)

    candidates = Fabric.objects.filter(
        is_deleted=False,
        out_of_stock_since__isnull=False,
        out_of_stock_since__lte=threshold,
    ).order_by("out_of_stock_since")
    if limit is not None:
        candidates = candidates[:limit]

    for fabric in candidates.iterator():
        try:
            with transaction.atomic():
                locked = Fabric.objects.select_for_update().get(pk=fabric.pk)
                eligible, reason = _purge_eligibility(locked, threshold)
                days_out = (timezone.now() - locked.out_of_stock_since).days

                if not eligible:
                    result.records.append(
                        ArchivedFabricRecord(
                            fabric_id=locked.id,
                            name=locked.name,
                            out_of_stock_since=locked.out_of_stock_since,
                            days_out_of_stock=days_out,
                            action="skip",
                            reason=reason,
                        )
                    )
                    if reason == "open_order":
                        result.skipped_open_orders += 1
                    elif reason == "restocked":
                        result.skipped_restocked += 1
                    continue

                result.records.append(
                    ArchivedFabricRecord(
                        fabric_id=locked.id,
                        name=locked.name,
                        out_of_stock_since=locked.out_of_stock_since,
                        days_out_of_stock=days_out,
                        action="delete",
                    )
                )
                if dry_run:
                    # Count it so a preview can report how many fabrics the
                    # real run would remove, then stop before deleting.
                    result.deleted += 1
                    continue

                delete_fabric_keep_history(locked)
                result.deleted += 1
                logger.info(
                    "Purged archived fabric id=%s name=%r out_of_stock_since=%s",
                    locked.id,
                    locked.name,
                    locked.out_of_stock_since.isoformat(),
                )
        except Fabric.DoesNotExist:
            continue  # deleted concurrently; nothing to do
        except Exception:
            logger.exception("Failed to purge archived fabric id=%s", fabric.pk)
            result.failed += 1

    return result


def restock_variant(variant, metres, bump_catalog=True):
    """Add ``metres`` to a variant and keep the catalog's stock flag in step."""
    from decimal import Decimal

    metres = Decimal(str(metres))
    if metres <= 0:
        return variant
    FabricVariant.objects.filter(pk=variant.pk).update(
        stock_meters=variant.stock_meters + metres,
        stock_updated_at=timezone.now(),
    )
    variant.refresh_from_db()
    if bump_catalog:
        sync_out_of_stock(variant.fabric)
    return variant
