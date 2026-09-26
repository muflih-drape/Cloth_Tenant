from django.conf import settings
from django.core.management.base import BaseCommand

from apps.items.services import purge_archived_items, purge_threshold


class Command(BaseCommand):
    help = (
        "Soft-delete archived items that have been out of stock for "
        "ARCHIVE_AFTER_DAYS + ARCHIVED_ITEM_RETENTION_DAYS days. Orders and "
        "order history are never modified."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            dest="dry_run",
            help="Report items that would be purged (and why others are skipped) without deleting anything",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Max items to process (default: settings.ARCHIVED_ITEM_PURGE_BATCH)",
        )
        parser.add_argument(
            "--days",
            type=int,
            default=None,
            help="Override the archived-retention window in days (default: settings.ARCHIVED_ITEM_RETENTION_DAYS)",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        limit = (
            options["limit"]
            if options["limit"] is not None
            else settings.ARCHIVED_ITEM_PURGE_BATCH
        )
        days = options["days"]

        if not dry_run and not settings.ARCHIVED_ITEM_PURGE_ENABLED:
            self.stdout.write(
                "Archived item purge is disabled "
                "(ARCHIVED_ITEM_PURGE_ENABLED=false); doing nothing."
            )
            return

        threshold = purge_threshold(days)
        self.stdout.write(
            self.style.WARNING(
                f"Cutoff: out_of_stock_since <= {threshold.isoformat()}"
            )
        )

        result = purge_archived_items(days=days, limit=limit, dry_run=dry_run)

        for rec in result.records:
            stamp = rec.out_of_stock_since.isoformat()
            if rec.action == "delete":
                verb = "WOULD DELETE" if dry_run else "DELETE"
                self.stdout.write(
                    f"  [{verb}] id={rec.item_id} name={rec.name!r} "
                    f"out_of_stock_since={stamp} days_out={rec.days_out_of_stock}"
                )
            else:
                self.stdout.write(
                    f"  [SKIP] id={rec.item_id} name={rec.name!r} "
                    f"days_out={rec.days_out_of_stock} reason={rec.reason}"
                )

        if dry_run:
            verb = "would delete"
        else:
            verb = "deleted"
        self.stdout.write(
            self.style.SUCCESS(
                f"\nSummary: {result.deleted} {verb}, "
                f"{result.skipped_open_orders} skipped (open orders), "
                f"{result.skipped_restocked} skipped (restocked), "
                f"{result.failed} failed"
            )
        )