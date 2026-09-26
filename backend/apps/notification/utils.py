"""Best-effort notification dispatch.

Push notifications are a side effect: a broker outage must never turn a
successful business operation into a 500, block the request, or stop later
``transaction.on_commit`` hooks from running. All Celery dispatch for
notifications should go through :func:`notify_user_safely`.
"""
import logging

from django.db.models import Q

from apps.notification.tasks import send_fcm_to_user, send_push_to_user

logger = logging.getLogger(__name__)


def queue_safely(sender, args, kwargs):
    """Queue a Celery task without ever raising to the caller."""
    try:
        sender.apply_async(args=args, kwargs=kwargs, retry=False)
    except Exception:
        logger.exception(
            "Failed to queue notification task %s (best-effort)", sender.name
        )


def notify_user_safely(user_id, title, body, urgency="high", ttl=86400, task=None, data=None):
    """Queue web push + FCM push to ``user_id`` without ever raising.

    ``retry=False`` disables kombu's publish retry so an unreachable broker
    fails fast instead of holding the request open. ``data`` is extra
    key/value metadata (strings) carried in both payloads so clients can
    deep-link off a notification.
    """
    sender = task or send_push_to_user
    queue_safely(
        sender,
        (user_id, title, body),
        {"urgency": urgency, "ttl": ttl, "data": data},
    )
    queue_safely(send_fcm_to_user, (user_id, title, body), {"data": data})


def admin_user_ids():
    """All active ADMIN-role users plus superusers."""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    return list(
        User.objects.filter(is_active=True)
        .filter(Q(role="ADMIN") | Q(is_superuser=True))
        .values_list("id", flat=True)
    )