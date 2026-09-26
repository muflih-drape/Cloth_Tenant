import os
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.items.models import ItemVariant


class Command(BaseCommand):
    help = "Delete media files not referenced by any ItemVariant"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report files that would be deleted without deleting them",
        )
        parser.add_argument(
            "--days-old",
            type=int,
            default=0,
            help="Only delete files modified more than N days ago (default: 0 = any age)",
        )
        parser.add_argument(
            "--verbose",
            action="store_true",
            help="Print every file checked",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        days_old = options["days_old"]
        verbose = options["verbose"]

        media_root = settings.MEDIA_ROOT
        items_dir = os.path.join(media_root, "items")

        if not os.path.isdir(items_dir):
            self.stdout.write(f"Directory not found: {items_dir}")
            return


        referenced = set(
            v.image.name
            for v in ItemVariant.objects.exclude(image="").filter(item__is_deleted=False)
            if v.image
        )

        # Also keep images referenced by order history
        order_referenced = set(
            ItemVariant.objects.filter(
                orderitem__isnull=False
            ).exclude(image="").values_list("image", flat=True)
        )

        referenced = referenced | order_referenced

        cutoff = None
        if days_old > 0:
            cutoff = timezone.now() - timedelta(days=days_old)

        deleted_count = 0
        skipped_count = 0
        total_size = 0

        for dirpath, _dirnames, filenames in os.walk(items_dir):
            for filename in filenames:
                filepath = os.path.join(dirpath, filename)
                relative = os.path.relpath(filepath, media_root)

                if relative in referenced:
                    if verbose:
                        self.stdout.write(f"  [KEEP] {relative}")
                    continue

                if cutoff is not None:
                    mtime = os.path.getmtime(filepath)
                    mtime_dt = timezone.datetime.fromtimestamp(mtime, tz=timezone.utc)
                    if mtime_dt > cutoff:
                        skipped_count += 1
                        if verbose:
                            self.stdout.write(f"  [SKIP] {relative} (too recent)")
                        continue

                size = os.path.getsize(filepath)
                total_size += size

                if dry_run:
                    self.stdout.write(
                        f"  [WOULD DELETE] {relative} ({self._format_size(size)})"
                    )
                else:
                    os.remove(filepath)
                    self.stdout.write(
                        f"  [DELETED] {relative} ({self._format_size(size)})"
                    )

                deleted_count += 1

        summary = (
            f"\nSummary: {deleted_count} file(s) deleted"
            f" ({self._format_size(total_size)})"
        )
        if skipped_count:
            summary += f", {skipped_count} skipped (too recent)"
        if dry_run:
            summary = summary.replace("deleted", "would delete")

        # Remove empty directories
        for dirpath, dirnames, filenames in os.walk(items_dir, topdown=False):
            if dirpath == items_dir:
                continue  # don't remove the root items/ folder
            if not os.listdir(dirpath):
                if dry_run:
                    self.stdout.write(f"  [WOULD DELETE FOLDER] {os.path.relpath(dirpath, media_root)}")
                else:
                    os.rmdir(dirpath)
                    self.stdout.write(f"  [DELETED FOLDER] {os.path.relpath(dirpath, media_root)}")

        self.stdout.write(summary)

    @staticmethod
    def _format_size(bytes_val):
        for unit in ("B", "KB", "MB"):
            if bytes_val < 1024:
                return f"{bytes_val:.1f} {unit}"
            bytes_val /= 1024
        return f"{bytes_val:.1f} GB"
