from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import DeviceToken, PushSubscription


class SaveSubscriptionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = request.data
        endpoint = data.get("endpoint")
        keys = data.get("keys", {})
        p256dh = keys.get("p256dh")
        auth = keys.get("auth")

        if not all([endpoint, p256dh, auth]):
            return Response(
                {"error": "Missing required fields: endpoint, keys.p256dh, keys.auth"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        subscription, created = PushSubscription.objects.update_or_create(
            endpoint=data["endpoint"],
            defaults={
                "user": request.user,
                "p256dh": data["keys"]["p256dh"],
                "auth": data["keys"]["auth"],
            },
        )
        return Response(
            {"message": "created" if created else "updated"},
            status=status.HTTP_200_OK,
        )


class RegisterDeviceTokenView(APIView):
    """Register (or re-assign) a Firebase device token for push delivery."""

    permission_classes = [IsAuthenticated]
    VALID_PLATFORMS = {"android", "ios"}

    def post(self, request):
        token = (request.data.get("token") or "").strip()
        platform = (request.data.get("platform") or "android").strip().lower()

        if not token:
            return Response(
                {"error": "Missing required field: token"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if platform not in self.VALID_PLATFORMS:
            return Response(
                {"error": f"platform must be one of: {', '.join(sorted(self.VALID_PLATFORMS))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            DeviceToken.objects.update_or_create(
                token=token,
                defaults={"user": request.user, "platform": platform},
            )
        except Exception:
            return Response(
                {"error": "Invalid token"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({"registered": True}, status=status.HTTP_200_OK)


class UnregisterDeviceTokenView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        token = (request.data.get("token") or "").strip()
        if not token:
            return Response(
                {"error": "Missing required field: token"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        DeviceToken.objects.filter(token=token, user=request.user).delete()
        return Response({"unregistered": True}, status=status.HTTP_200_OK)
