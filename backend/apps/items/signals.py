"""Keep a fabric's out_of_stock_since flag in step with its cloth on hand.

Stock moves in several places (packing rounds, manual restocks, admin edits), so
the flag is recomputed from the variants after any change rather than being
incremented at each call site.
"""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import Fabric, FabricVariant
from .services import sync_out_of_stock, touch_catalog


@receiver(post_save, sender=FabricVariant)
def sync_fabric_after_variant_save(sender, instance, **kwargs):
    sync_out_of_stock(instance.fabric)


@receiver(post_delete, sender=FabricVariant)
def delete_variant_image(sender, instance, **kwargs):
    """Drop the variant's image file and re-check the parent fabric."""
    if instance.image and hasattr(instance.image, "path"):
        path = instance.image.path
        if path:
            try:
                import os

                if os.path.isfile(path):
                    os.remove(path)
            except OSError:
                # A missing or unreadable file must not block the delete.
                pass

    fabric = Fabric.objects.filter(pk=instance.fabric_id).first()
    if fabric is not None:
        sync_out_of_stock(fabric)
        touch_catalog(fabric)
