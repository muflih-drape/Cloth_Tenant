from django.urls import path
from .views import AdminDashboardView, AdminAnalyticsView

urlpatterns = [
    path('', AdminDashboardView.as_view()),
    path('analytics/', AdminAnalyticsView.as_view(), name='admin-analytics'),
]
