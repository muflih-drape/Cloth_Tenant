from rest_framework import serializers
from django.contrib.auth import authenticate
from .models import User


class LoginRequestSerializer(serializers.Serializer):
    username = serializers.CharField(required=False)
    email = serializers.EmailField(required=False)
    password = serializers.CharField(write_only=True)

    def validate(self, data):
        username = data.get('username')
        email = data.get('email')
        password = data.get('password')

        if not (username or email):
            raise serializers.ValidationError(
                {"error": "Username or email is required"}
            )

        if email:
            try:
                user_obj = User.objects.get(email__iexact=email)
                username = user_obj.username
            except User.DoesNotExist:
                raise serializers.ValidationError(
                    {"error": "No account found for this email"}
                )

        user = authenticate(username=username, password=password)

        if user is None:
            raise serializers.ValidationError(
                {"error": "Invalid password"}
            )

        if not user.is_active:
            raise serializers.ValidationError(
                {"error": "This account has been deactivated"}
            )

        data['user'] = user
        return data


class LoginResponseSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField()
    role = serializers.ChoiceField(choices=User.ROLE_CHOICES)
    user_id = serializers.IntegerField()
    username = serializers.CharField(required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    business = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    is_superuser = serializers.BooleanField()


class VerifyPinRequestSerializer(serializers.Serializer):
    pin = serializers.CharField(write_only=True, required=True, allow_blank=True)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'role', 'business', 'is_superuser', 'display_name')


class UserCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('username', 'email', 'password', 'role', 'display_name')
        extra_kwargs = {
            'password': {'write_only': True}
        }

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Email already exists")
        return value
