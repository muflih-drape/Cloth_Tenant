import json
import logging
from celery import shared_task
from django.conf import settings
from pywebpush import WebPushException, webpush
from .models import DeviceToken, PushSubscription

logger = logging.getLogger(__name__)

@shared_task(bind=True)
def send_push_to_user(self, user_id, title, body, urgency="high", ttl=86400, data=None):
    subscribers = PushSubscription.objects.filter(user_id=user_id)

    if not subscribers.exists():
        logger.warning(f"[PushTask] No subscription for user {user_id} — skipping")
        return

    for sub in subscribers:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {
                        "p256dh": sub.p256dh,
                        "auth": sub.auth,
                    },
                },
                data=json.dumps({"title": title, "body": body, **(data or {})}),
                vapid_private_key=settings.PRIVATE_VAPID_KEY,
                vapid_claims={"sub": "mailto:muhammedmuflih9605@gmail.com"},
                ttl=ttl,
                headers={"Urgency": urgency},
            )
            logger.info(f"[PushTask] Sent push to user {user_id} sub={sub.id} (urgency={urgency})")
        except WebPushException as e:
            response = e.response
            if response is not None:
                logger.error(
                    f"[PushTask] Push rejected (user={user_id}, sub={sub.id}) "
                    f"status={response.status_code} body={response.text!r}"
                )
                if response.status_code in (404, 410):
                    logger.warning(
                        f"[PushTask] Expired subscription (user={user_id}, sub={sub.id}) — deleting"
                    )
                    sub.delete()
            else:
                logger.error(
                    f"[PushTask] WebPush failed (no response) for user {user_id} sub={sub.id}: {e}"
                )
        except Exception as e:
            logger.exception(f"[PushTask] Unexpected error for user {user_id} sub={sub.id}: {e}")


_FCM_APP = None


def _get_fcm_app():
    """Lazily initialise the Firebase Admin app.

    Returns None when FCM is not configured so dispatch stays best-effort.
    """
    global _FCM_APP
    if _FCM_APP is not None:
        return _FCM_APP

    credential_path = getattr(settings, "FIREBASE_CREDENTIALS", None)
    if not credential_path:
        logger.warning("[FCMTask] FIREBASE_CREDENTIALS not set — FCM disabled")
        return None

    try:
        import firebase_admin
        from firebase_admin import credentials

        _FCM_APP = firebase_admin.initialize_app(
            credentials.Certificate(credential_path),
            name="push-notifications",
        )
        logger.info("[FCMTask] Firebase Admin initialised")
    except Exception:
        logger.exception("[FCMTask] Failed to initialise Firebase Admin — FCM disabled")
        _FCM_APP = False
    return _FCM_APP or None


@shared_task(bind=True, autoretry_for=(), max_retries=0)
def send_fcm_to_user(self, user_id, title, body, data=None):
    """Send a push notification to every registered device of ``user_id``.

    Best-effort: when FCM is not configured or a token is stale/revoked we
    log and skip/delete rather than raising to the caller.
    """
    app = _get_fcm_app()
    if app is None:
        return

    tokens = list(
        DeviceToken.objects.filter(user_id=user_id).values_list("token", "id")
    )
    if not tokens:
        logger.info(f"[FCMTask] No device tokens for user {user_id} — skipping")
        return

    try:
        from firebase_admin import messaging
    except Exception:
        logger.exception("[FCMTask] firebase_admin unavailable — FCM disabled")
        return

    message = messaging.Message(
        notification=messaging.Notification(title=title, body=body),
        data=data or None,
    )

    for token, token_id in tokens:
        message.token = token
        try:
            messaging.send(message, app=app)
            logger.info(f"[FCMTask] Sent to user {user_id} token_id={token_id}")
        except Exception as e:
            code = getattr(e, "code", None)
            if code in ("messaging/registration-token-not-registered", "messaging/invalid-argument"):
                logger.warning(
                    f"[FCMTask] Stale device token (user={user_id}, token_id={token_id}) — deleting"
                )
                DeviceToken.objects.filter(id=token_id).delete()
            else:
                logger.exception(
                    f"[FCMTask] Send failed for user {user_id} token_id={token_id}: {e}"
                )
