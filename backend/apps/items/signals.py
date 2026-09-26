import os
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from django.db.models import Sum
from django.utils import timezone
from .models import ItemVariant, ItemVariantSize


@receiver(post_delete, sender=ItemVariant)
def delete_variant_image(sender, instance, **kwargs):
    if instance.image:
        if hasattr(instance.image, 'path') and instance.image.path:
            file_path = instance.image.path
            if os.path.isfile(file_path):
                os.remove(file_path)
    # Update item stock status after variant deletion
    item = instance.item
    total_stock = ItemVariantSize.objects.filter(
        item_variant__item=item
    ).aggregate(total=Sum('stock'))['total'] or 0

    if total_stock == 0 and not item.out_of_stock_since:
        item.out_of_stock_since = timezone.now()
        item.save(update_fields=['out_of_stock_since'])
    elif total_stock > 0 and item.out_of_stock_since:
        item.out_of_stock_since = None
        item.save(update_fields=['out_of_stock_since'])

    from .services import touch_catalog
    touch_catalog(item)


@receiver(post_save, sender=ItemVariantSize)
def update_item_stock_status(sender, instance, **kwargs):
    """Update item's out_of_stock_since when stock changes."""
    from .services import touch_catalog

    item = instance.item_variant.item
    total_stock = ItemVariantSize.objects.filter(
        item_variant__item=item
    ).aggregate(total=Sum('stock'))['total'] or 0

    if total_stock == 0 and not item.out_of_stock_since:
        item.out_of_stock_since = timezone.now()
        item.save(update_fields=['out_of_stock_since'])
        touch_catalog(item)
    elif total_stock > 0 and item.out_of_stock_since:
        item.out_of_stock_since = None
        item.save(update_fields=['out_of_stock_since'])
        touch_catalog(item)
