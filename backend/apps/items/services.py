"""Item lifecycle helpers shared by the API, the purge command and Celery."""

import logging
import os
from dataclasses import dataclass, field
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from apps.orders.models import OrderItem

from .models import Item, ItemVariantSize

logger = logging.getLogger(__name__)

# Orders in these states still "own" stock for order fulfilment; items
# referenced by them must never be purged. Dispatched orders are terminal and
# only carry snapshots, so they are safe.
OPEN_ORDER_STATUSES = ("DRAFT", "PENDING", "EDITING", "PACKED")


def touch_catalog(item):
    """Bump an item's ``catalog_updated_at``.

    Call only when the item's *catalog* changes (name, price, type, brand,
    description, variant set). Never call it for stock changes: stock edits
    bump ``ItemVariantSize.stock_updated_at`` and ``out_of_stock_since``.
    """
    if item is None or item.pk is None:
        return
    from django.utils import timezone

    from .models import Item

    Item.objects.filter(pk=item.pk).update(catalog_updated_at=timezone.now())


def delete_item_keep_history(item):
    """Soft-delete an item exactly like the manual admin DELETE endpoint.

    Keeps every Order/OrderItem/OrderLog row intact; removes on-disk variant
    images only when no OrderItem references the variant.
    """
    for variant in item.variants.all():
        if variant.image:
            is_referenced = OrderItem.objects.filter(variant=variant).exists()
            if not is_referenced:
                if variant.image.path and os.path.exists(variant.image.path):
                    os.remove(variant.image.path)

    touch_catalog(item)
    item.is_deleted = True
    item.save()
    touch_catalog(item)


def purge_threshold(days=None):
    """Cutoff for ``out_of_stock_since`` beyond which an archived item is purged.

    ``days`` optionally overrides the retention window (defaults to
    ``ARCHIVED_ITEM_RETENTION_DAYS``). Total = ARCHIVE_AFTER_DAYS + retention.
    """
    retention = (
        days if days is not None else settings.ARCHIVED_ITEM_RETENTION_DAYS
    )
    total = settings.ARCHIVE_AFTER_DAYS + retention
    return timezone.now() - timedelta(days=total)


@dataclass
class ArchivedItemRecord:
    item_id: int
    name: str
    out_of_stock_since: object
    days_out_of_stock: int
    action: str  # "delete" | "skip"
    reason: str | None = None


@dataclass
class PurgeResult:
    deleted: int = 0
    skipped_open_orders: int = 0
    skipped_restocked: int = 0
    failed: int = 0
    records: list = field(default_factory=list)


def _purge_eligibility(item, threshold):
    """Re-check the purge eligibility of a (locked) item row.

    Returns ``(eligible, reason)`` where reason is one of
    ``{"already_deleted", "restocked", "open_order"}`` when not eligible.
    """
    if item.is_deleted:
        return False, "already_deleted"

    if item.out_of_stock_since is None or item.out_of_stock_since > threshold:
        return False, "restocked"

    total_stock = ItemVariantSize.objects.filter(
        item_variant__item=item
    ).aggregate(total=Sum("stock"))["total"] or 0
    if total_stock != 0:
        # Restocked between selection and this check.
        return False, "restocked"

    in_open_order = OrderItem.objects.filter(
        order__status__in=OPEN_ORDER_STATUSES,
    ).filter(Q(item=item) | Q(variant__item=item))
    if in_open_order.exists():
        return False, "open_order"

    return True, None


def purge_archived_items(*, days=None, limit=None, dry_run=False):
    """Purge archived items that are past their retention window.

    Order-independent and idempotent: every item is re-checked inside its own
    transaction (with a row lock), so a restock or a new open order between
    selection and deletion protects the item. Returns a :class:`PurgeResult`.
    """
    result = PurgeResult()
    threshold = purge_threshold(days)

    candidates = (
        Item.objects.filter(
            is_deleted=False,
            out_of_stock_since__isnull=False,
            out_of_stock_since__lte=threshold,
        ).order_by("out_of_stock_since")
    )
    if limit is not None:
        candidates = candidates[:limit]

    for item in candidates.iterator():
        try:
            with transaction.atomic():
                locked = Item.objects.select_for_update().get(pk=item.pk)
                eligible, reason = _purge_eligibility(locked, threshold)
                days_out = (timezone.now() - locked.out_of_stock_since).days

                if not eligible:
                    result.records.append(
                        ArchivedItemRecord(
                            item_id=locked.id,
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
                    ArchivedItemRecord(
                        item_id=locked.id,
                        name=locked.name,
                        out_of_stock_since=locked.out_of_stock_since,
                        days_out_of_stock=days_out,
                        action="delete",
                    )
                )
                if dry_run:
                    continue

                delete_item_keep_history(locked)
                result.deleted += 1
                logger.info(
                    "Purged archived item id=%s name=%r out_of_stock_since=%s",
                    locked.id,
                    locked.name,
                    locked.out_of_stock_since.isoformat(),
                )
        except Item.DoesNotExist:
            continue  # deleted concurrently; nothing to do
        except Exception:
            logger.exception("Failed to purge archived item id=%s", item.pk)
            result.failed += 1

    return result