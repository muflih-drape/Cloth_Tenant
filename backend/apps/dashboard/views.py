from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Sum
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAdmin
from apps.agents.models import Agent
from apps.orders.models import Order, OrderItem, OrderLog

ZERO = Decimal("0")


class AdminDashboardView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        order_qs = Order.objects.all()
        data = {
            status.lower(): order_qs.filter(status=status).count()
            for status, _ in Order.STATUS_CHOICES
        }
        # An admin only sees/counts their own drafts.
        data["draft"] = order_qs.filter(
            status="DRAFT", created_by=request.user
        ).count()

        agents = [
            {
                "agent": agent.user.username,
                "customers": agent.customers.count(),
                "pending_orders": Order.objects.filter(
                    agent=agent, status__in=("PENDING", "PACKED")
                ).count(),
            }
            for agent in Agent.objects.filter(is_active=True)
        ]

        return Response({"order_summary": data, "agents": agents})


class AdminAnalyticsView(APIView):
    permission_classes = [IsAdmin]

    @extend_schema(
        summary="Analytics KPIs, trend, top lists and dispatch time metrics",
        description=(
            "Computed over placed (non-DRAFT) orders in the requested date range. "
            "Money and metres both come from the snapshot fields stored on each "
            "OrderItem (`rate_per_meter`, `ordered_quantity`, `allocated_quantity`) "
            "rather than live fabric prices, so repricing a fabric never rewrites "
            "history. `total_metres_ordered` = Σ ordered_quantity; "
            "`total_metres_shipped` = Σ allocated_quantity on dispatched orders; "
            "`total_value` = Σ effective_total (so an admin's price override is "
            "reflected in revenue)."
        ),
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request):
        """Placed (non-DRAFT) order totals in range, in metres and rupees."""
        from_date = request.query_params.get("from")
        to_date = request.query_params.get("to")

        now = timezone.now()
        if not to_date:
            to_date = now.date().isoformat()
        if not from_date:
            from_date = (now - timedelta(days=30)).date().isoformat()

        order_qs = Order.objects.filter(
            created_at__date__gte=from_date, created_at__date__lte=to_date
        )

        # DRAFT orders are work-in-progress and must not distort analytics: they
        # are excluded from totals, trends and top lists, but the dedicated
        # `kpis.draft` counter is kept for the status donut.
        placed_qs = order_qs.exclude(status="DRAFT")

        ordered_metres = (
            OrderItem.objects.filter(order__in=placed_qs).aggregate(
                total=Sum("ordered_quantity")
            )["total"]
            or ZERO
        )
        shipped_metres = (
            OrderItem.objects.filter(order__in=placed_qs, order__status="DISPATCHED")
            .aggregate(total=Sum("allocated_quantity"))["total"]
            or ZERO
        )
        # Revenue is the billed figure, so an admin's override counts. COALESCE
        # keeps that in SQL instead of pulling every order into Python.
        total_value = (
            placed_qs.annotate(billed=Coalesce("final_total", "computed_total"))
            .aggregate(total=Sum("billed"))["total"]
            or ZERO
        )

        kpis = {
            "total": placed_qs.count(),
            "draft": order_qs.filter(status="DRAFT").count(),
            "pending": placed_qs.filter(status="PENDING").count(),
            "editing": placed_qs.filter(status="EDITING").count(),
            "packed": placed_qs.filter(status="PACKED").count(),
            "dispatched": placed_qs.filter(status="DISPATCHED").count(),
            "total_metres_ordered": str(ordered_metres),
            "total_metres_shipped": str(shipped_metres),
            "total_value": float(total_value),
        }

        trend = (
            placed_qs.annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(count=Count("id", distinct=True))
            .order_by("day")
        )

        top_customers = (
            placed_qs.values("customer_id", "customer__name")
            .annotate(
                count=Count("id", distinct=True),
                metres=Sum("items__allocated_quantity"),
            )
            .order_by("-metres")[:10]
        )

        top_agents = (
            placed_qs.values("agent_id", "agent__user__username")
            .annotate(
                count=Count("id", distinct=True),
                metres=Sum("items__allocated_quantity"),
            )
            .order_by("-metres")[:10]
        )

        top_fabrics = (
            OrderItem.objects.filter(order__in=placed_qs)
            .values("fabric_name")
            .annotate(
                metres_ordered=Sum("ordered_quantity"),
                metres_shipped=Sum("allocated_quantity"),
            )
            .order_by("-metres_ordered")[:10]
        )

        dispatch_times = []
        for order in order_qs.filter(status="DISPATCHED"):
            log = (
                OrderLog.objects.filter(
                    order_ref=order.id, action="DISPATCHED"
                )
                .order_by("-created_at")
                .first()
            )
            if log:
                delta = log.created_at - order.created_at
                dispatch_times.append(delta.total_seconds() / 3600)

        if dispatch_times:
            avg_dispatch = sum(dispatch_times) / len(dispatch_times)
            sorted_times = sorted(dispatch_times)
            median_dispatch = sorted_times[len(sorted_times) // 2]
            within_24h = (
                sum(1 for t in dispatch_times if t <= 24) / len(dispatch_times) * 100
            )
        else:
            avg_dispatch = None
            median_dispatch = None
            within_24h = None

        time_metrics = {
            "avg_dispatch_hours": avg_dispatch,
            "median_dispatch_hours": median_dispatch,
            "dispatched_within_24h_pct": within_24h,
        }

        return Response(
            {
                "kpis": kpis,
                "trend": list(trend),
                "top_customers": [
                    {
                        "id": row["customer_id"],
                        "name": row["customer__name"],
                        "count": row["count"],
                        "metres": str(row["metres"] or 0),
                    }
                    for row in top_customers
                ],
                "top_agents": [
                    {
                        "id": row["agent_id"],
                        "username": row["agent__user__username"],
                        "count": row["count"],
                        "metres": str(row["metres"] or 0),
                    }
                    for row in top_agents
                ],
                "top_fabrics": [
                    {
                        "name": row["fabric_name"],
                        "metres_ordered": str(row["metres_ordered"] or 0),
                        "metres_shipped": str(row["metres_shipped"] or 0),
                    }
                    for row in top_fabrics
                ],
                "time_metrics": time_metrics,
            }
        )
