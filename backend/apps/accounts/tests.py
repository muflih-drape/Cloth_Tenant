from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()

URL = "/api/auth/verify-pin/"


def get_auth_header(user):
    refresh = RefreshToken.for_user(user)
    return {"HTTP_AUTHORIZATION": f"Bearer {refresh.access_token}"}


def make_admin(username, business="gents", pin=None):
    admin = User.objects.create_user(
        username=username,
        email=f"{username}@test.com",
        password="pass1234",
        role="ADMIN",
        business=business,
    )
    if pin is not None:
        admin.set_pin(pin)
        admin.save()
    return admin


class VerifyPinTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_correct_pin_returns_ok(self):
        admin = make_admin("vadmin", pin="1234")
        self.client.credentials(**get_auth_header(admin))
        resp = self.client.post(URL, {"pin": "1234"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data.get("ok"))

    def test_wrong_pin_rejected(self):
        admin = make_admin("vadmin2", pin="1234")
        self.client.credentials(**get_auth_header(admin))
        resp = self.client.post(URL, {"pin": "9999"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_missing_pin_rejected(self):
        admin = make_admin("vadmin3")
        self.client.credentials(**get_auth_header(admin))
        resp = self.client.post(URL, {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_superuser_skips_pin(self):
        admin = User.objects.create_superuser(
            username="vsuper", email="vsuper@test.com", password="pass1234"
        )
        self.client.credentials(**get_auth_header(admin))
        resp = self.client.post(URL, {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data.get("ok"))