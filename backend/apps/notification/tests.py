import sys
import types
from unittest import mock
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.notification.models import DeviceToken
from apps.notification.utils import admin_user_ids, notify_user_safely

User = get_user_model()

REGISTER_URL = "/api/notification/register-token/"
UNREGISTER_URL = "/api/notification/unregister-token/"


def get_auth_header(user):
    refresh = RefreshToken.for_user(user)
    return {"HTTP_AUTHORIZATION": f"Bearer {refresh.access_token}"}


class DeviceTokenEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="admin1",
            email="admin1@test.com",
            password="pass1234",
            role="ADMIN",
        )
        self.other = User.objects.create_user(
            username="admin2",
            email="admin2@test.com",
            password="pass1234",
            role="ADMIN",
        )

    def test_register_requires_auth(self):
        response = self.client.post(REGISTER_URL, {"token": "abc"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_register_creates_token(self):
        self.client.credentials(**get_auth_header(self.user))
        response = self.client.post(
            REGISTER_URL, {"token": "tok-1", "platform": "android"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(DeviceToken.objects.filter(user=self.user, token="tok-1").exists())

    def test_register_reassigns_token_to_new_user(self):
        DeviceToken.objects.create(user=self.other, token="tok-1", platform="android")
        self.client.credentials(**get_auth_header(self.user))
        response = self.client.post(
            REGISTER_URL, {"token": "tok-1", "platform": "ios"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        token = DeviceToken.objects.get(token="tok-1")
        self.assertEqual(token.user, self.user)
        self.assertEqual(token.platform, "ios")

    def test_register_rejects_unsupported_platform(self):
        self.client.credentials(**get_auth_header(self.user))
        response = self.client.post(
            REGISTER_URL, {"token": "tok-1", "platform": "windows"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_requires_token(self):
        self.client.credentials(**get_auth_header(self.user))
        response = self.client.post(REGISTER_URL, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unregister_removes_token(self):
        DeviceToken.objects.create(user=self.user, token="tok-1", platform="android")
        self.client.credentials(**get_auth_header(self.user))
        response = self.client.post(UNREGISTER_URL, {"token": "tok-1"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(DeviceToken.objects.filter(token="tok-1").exists())

    def test_unregister_does_not_delete_other_users_token(self):
        DeviceToken.objects.create(user=self.other, token="tok-1", platform="android")
        self.client.credentials(**get_auth_header(self.user))
        self.client.post(UNREGISTER_URL, {"token": "tok-1"}, format="json")
        self.assertTrue(DeviceToken.objects.filter(token="tok-1", user=self.other).exists())


class NotifyDispatchTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="admin1",
            email="admin1@test.com",
            password="pass1234",
            role="ADMIN",
        )
        self.super = User.objects.create_superuser(
            username="super1", email="super1@test.com", password="pass1234"
        )
        self.agent = User.objects.create_user(
            username="agent1",
            email="agent1@test.com",
            password="pass1234",
            role="AGENT",
        )

    def test_admin_user_ids_excludes_agents(self):
        ids = admin_user_ids()
        self.assertIn(self.user.id, ids)
        self.assertIn(self.super.id, ids)
        self.assertNotIn(self.agent.id, ids)

    @mock.patch("apps.notification.utils.send_fcm_to_user")
    @mock.patch("apps.notification.utils.send_push_to_user")
    def test_notify_queues_web_and_fcm(self, web, fcm):
        notify_user_safely(self.user.id, "Title", "Body")
        web.apply_async.assert_called_once()
        fcm.apply_async.assert_called_once()

    @mock.patch("apps.notification.utils.send_fcm_to_user")
    @mock.patch("apps.notification.utils.send_push_to_user")
    def test_broker_web_failure_still_queues_fcm(self, web, fcm):
        web.apply_async.side_effect = RuntimeError("broker down")
        notify_user_safely(self.user.id, "Title", "Body")
        fcm.apply_async.assert_called_once()


class SendFcmTaskTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="admin1",
            email="admin1@test.com",
            password="pass1234",
            role="ADMIN",
        )

    @override_settings(FIREBASE_CREDENTIALS=None)
    def test_skips_when_not_configured(self):
        from apps.notification.tasks import send_fcm_to_user
        result = send_fcm_to_user.run(self.user.id, "T", "B")
        self.assertIsNone(result)

    def _fake_firebase(self, send_impl):
        class Message:
            def __init__(self, **kw):
                self.notification = kw.get("notification")
                self.token = None

        messaging = types.ModuleType("firebase_admin.messaging")
        messaging.Message = Message
        messaging.Notification = lambda title=None, body=None: {"title": title, "body": body}
        messaging.send = send_impl
        firebase_admin = types.ModuleType("firebase_admin")
        firebase_admin.messaging = messaging
        return firebase_admin

    def test_sends_to_each_device_and_deletes_stale(self):
        DeviceToken.objects.create(user=self.user, token="valid", platform="android")
        DeviceToken.objects.create(
            user=self.user, token="stale", platform="android"
        )

        sent = []

        def send_impl(message, app=None):
            sent.append(message.token)
            if message.token == "stale":
                err = Exception("not registered")
                err.code = "messaging/registration-token-not-registered"
                raise err
            return "1"

        firebase_admin = self._fake_firebase(send_impl)

        with mock.patch.dict(sys.modules, {"firebase_admin": firebase_admin}), mock.patch(
            "apps.notification.tasks._get_fcm_app", return_value=object()
        ):
            from apps.notification.tasks import send_fcm_to_user
            send_fcm_to_user.run(self.user.id, "Title", "Body")

        self.assertEqual(sorted(sent), ["stale", "valid"])
        self.assertEqual(
            list(DeviceToken.objects.values_list("token", flat=True)), ["valid"]
        )