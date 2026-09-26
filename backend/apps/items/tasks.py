import logging

from celery import shared_task
from django.conf import settings
from django.core.management import call_command

from .services import purge_archived_items

logger = logging.getLogger(__name__)


@shared_task
def cleanup_orphaned_media_task():
    logger.info("Starting orphaned media cleanup")
    call_command("cleanup_orphaned_media", days_old=1)
    logger.info("Orphaned media cleanup finished")


@shared_task
def purge_archived_items_task():
    if not settings.ARCHIVED_ITEM_PURGE_ENABLED:
        logger.info("Archived item purge disabled; nothing to do")
        return
    logger.info("Starting archived item purge")
    result = purge_archived_items(limit=settings.ARCHIVED_ITEM_PURGE_BATCH)
    logger.info(
        "Archived item purge finished: deleted=%s skipped_open_orders=%s "
        "skipped_restocked=%s failed=%s",
        result.deleted,
        result.skipped_open_orders,
        result.skipped_restocked,
        result.failed,
    )
