from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from unittest import mock

from apps.agents.models import Agent
from apps.business.models import Brand
from apps.customers.models import Customer
from apps.orders.models import Order

User = get_user_model()

LIST_URL = "/api/customers/"


def get_auth_header(user):
    refresh = RefreshToken.for_user(user)
    return {"HTTP_AUTHORIZATION": f"Bearer {refresh.access_token}"}


class CustomerListAdminTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.brand = Brand.objects.create(
            name="Test Brand",
            phone="1234567890",
            email="brand@test.com",
            address_line1="123 St",
        )

        self.admin_user = User.objects.create_user(
            username="admin1",
            email="admin1@test.com",
            password="pass1234",
            role="ADMIN",
            business="gents",
            brand=self.brand,
        )

        self.agent_user = User.objects.create_user(
            username="agent1",
            email="agent1@test.com",
            password="pass1234",
            role="AGENT",
        )
        self.agent = Agent.objects.create(
            user=self.agent_user, contact="1111111111"
        )

        self.customer = Customer.objects.create(
            name="ABC Fashions", contact="2222222222", agent=self.agent
        )

    def test_admin_list_includes_agent_id_and_name(self):
        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(LIST_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = response.data["results"][0]
        self.assertEqual(row["agent"], self.agent.id)
        self.assertEqual(row["agent_name"], self.agent_user.username)

    def test_admin_list_supports_search(self):
        Customer.objects.create(
            name="XYZ Garments", contact="3333333333", agent=self.agent
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(LIST_URL, {"search": "XYZ"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "XYZ Garments")

    def test_admin_list_supports_pagination(self):
        for i in range(3):
            Customer.objects.create(
                name=f"Customer {i}", contact="4444444444", agent=self.agent
            )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(LIST_URL, {"page_size": 2})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 4)
        self.assertEqual(len(response.data["results"]), 2)

    def test_admin_list_excludes_inactive_customers(self):
        Customer.objects.create(
            name="Closed Shop",
            contact="5555555555",
            agent=self.agent,
            is_active=False,
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(LIST_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)

    def test_total_orders_excludes_drafts(self):
        Order.objects.create(
            customer=self.customer, agent=self.agent, status="PENDING"
        )
        Order.objects.create(
            customer=self.customer, agent=self.agent, status="DRAFT"
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(LIST_URL)

        self.assertEqual(response.data["results"][0]["total_orders"], 1)

    def test_delete_info_excludes_drafts(self):
        Order.objects.create(
            customer=self.customer, agent=self.agent, status="PENDING"
        )
        Order.objects.create(
            customer=self.customer, agent=self.agent, status="DRAFT"
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(f"{LIST_URL}{self.customer.id}/delete_info/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["orders_count"], 1)

    def test_agent_name_is_null_safe(self):
        Customer.objects.create(
            name="No Agent Shop", contact="6666666666", agent=None
        )

        self.client.credentials(**get_auth_header(self.admin_user))
        response = self.client.get(LIST_URL, {"search": "No Agent Shop"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["results"][0]["agent_name"])


class CustomerCreateNotifyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin_user = User.objects.create_user(
            username="admin1",
            email="admin1@test.com",
            password="pass1234",
            role="ADMIN",
        )
        self.agent_user = User.objects.create_user(
            username="agent1",
            email="agent1@test.com",
            password="pass1234",
            role="AGENT",
        )
        self.agent = Agent.objects.create(
            user=self.agent_user, contact="1111111111"
        )

    def test_agent_customer_create_notifies_admins(self):
        with mock.patch("apps.notification.utils.send_fcm_to_user") as fcm, mock.patch(
            "apps.notification.utils.send_push_to_user"
        ) as web:
            self.client.credentials(**get_auth_header(self.agent_user))
            response = self.client.post(
                LIST_URL,
                {"name": "New Shop", "contact": "7777777777"},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        titles = [
            call.kwargs["args"][1]
            for call in web.apply_async.call_args_list
        ]
        self.assertIn("New Customer", titles)
        bodies = " ".join(
            call.kwargs["args"][2]
            for call in web.apply_async.call_args_list
        )
        self.assertIn("New Shop", bodies)
        self.assertIn("agent1", bodies)
        self.assertTrue(fcm.apply_async.called)

    def test_admin_customer_create_does_not_notify(self):
        with mock.patch("apps.notification.utils.send_fcm_to_user") as fcm, mock.patch(
            "apps.notification.utils.send_push_to_user"
        ) as web:
            self.client.credentials(**get_auth_header(self.admin_user))
            response = self.client.post(
                LIST_URL,
                {"name": "Admin Shop", "contact": "8888888888"},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        self.assertFalse(web.apply_async.called)
        self.assertFalse(fcm.apply_async.called)
