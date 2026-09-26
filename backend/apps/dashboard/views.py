from rest_framework.views import APIView
from rest_framework.response import Response
from django.db.models import Count, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from datetime import timedelta
from apps.orders.models import Order, OrderItem, OrderLog
from apps.orders.utils import get_piece_count
from apps.agents.models import Agent
from apps.accounts.permissions import IsAdmin, admin_business


class AdminDashboardView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        biz = request.user.business
        order_qs = Order.objects.filter(items__item_type=biz).distinct() if biz else Order.objects.all()
        data = {s.lower(): order_qs.filter(status=s).count() for s, _ in Order.STATUS_CHOICES}
        # D2: an admin only sees/counts their own drafts.
        data["draft"] = order_qs.filter(
            status="DRAFT", created_by=request.user
        ).count()

        agents = []
        for agent in Agent.objects.filter(is_active=True):
            customers_count = agent.customers.filter(order__items__item_type=biz).distinct().count() if biz else agent.customers.count()
            agents.append({
                "agent": agent.user.username,
                "customers": customers_count
            })

        return Response({
            "order_summary": data,
            "agents": agents
        })


class AdminAnalyticsView(APIView):
    permission_classes = [IsAdmin]

    @extend_schema(
        summary="Analytics KPIs, trend, top lists and dispatch time metrics",
        description=(
            "`kpis` total order value/sets/pieces are computed over placed "
            "(non-DRAFT) orders in the requested date range, using each order "
            "item's snapshotted `item_price`, `size_group` and `item_type` — "
            "never live item prices. Definitions: `total_sets` = sum of item "
            "quantities; `total_pieces` = sum(quantity × pieces-per-set); "
            "`total_value` = sum(item_price × quantity × pieces-per-set) "
            "before GST, matching the per-order invoice `total_price`."
        ),
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request):
        """Placed (non-DRAFT) order totals in range.

        `total_sets`  = Σ OrderItem.quantity
        `total_pieces` = Σ quantity × pieces-per-set
        `total_value` = Σ item_price × quantity × pieces-per-set (pre GST)

        Both use the snapshot fields stored on each OrderItem so editing the
        underlying Item (price change / soft delete) never rewrites history;
        rows whose Item hard-deleted and therefore lost its FK are skipped to
        stay consistent with the invoice total_price formula.
        """
        biz = admin_business(request.user)

        from_date = request.query_params.get('from')
        to_date = request.query_params.get('to')

        now = timezone.now()
        if not to_date:
            to_date = now.date().isoformat()
        if not from_date:
            from_date = (now - timedelta(days=30)).date().isoformat()

        order_qs = Order.objects.all()
        if biz:
            order_qs = order_qs.filter(items__item_type=biz).distinct()

        order_qs = order_qs.filter(
            created_at__date__gte=from_date,
            created_at__date__lte=to_date
        )

        # DRAFT orders are work-in-progress and must not distort analytics:
        # they are excluded from totals, trends and top lists, but the
        # dedicated `kpis.draft` counter is kept for the status donut.
        placed_qs = order_qs.exclude(status='DRAFT')

        # Order value / set totals — one aggregate query. Group items by their
        # snapshotted (price, size_group, item_type) rows so pieces-per-set can
        # be applied in Python over the few distinct groups; `item__isnull`
        # skips OrderItems whose Item was hard-deleted (mirrors invoice math).
        total_sets = 0
        total_pieces = 0
        total_value = 0.0
        item_rows = (
            OrderItem.objects
            .filter(order__in=placed_qs, item__isnull=False)
            .values('item_price', 'size_group', 'item_type')
            .annotate(qty=Sum('quantity'))
        )
        for row in item_rows:
            pcs = get_piece_count(row['size_group'], row['item_type'] or 'gents')
            qty = row['qty']
            total_sets += qty
            total_pieces += qty * pcs
            total_value += float(row['item_price']) * qty * pcs

        kpis = {
            'total': placed_qs.count(),
            'draft': order_qs.filter(status='DRAFT').count(),
            'pending': placed_qs.filter(status='PENDING').count(),
            'editing': placed_qs.filter(status='EDITING').count(),
            'packed': placed_qs.filter(status='PACKED').count(),
            'dispatched': placed_qs.filter(status='DISPATCHED').count(),
            'total_sets': total_sets,
            'total_pieces': total_pieces,
            'total_value': round(total_value, 2),
        }

        trend = (
            placed_qs
            .annotate(day=TruncDate('created_at'))
            .values('day')
            .annotate(count=Count('id', distinct=True))
            .order_by('day')
        )

        top_customers = (
            placed_qs
            .values('customer_id', 'customer__name')
            .annotate(count=Count('id', distinct=True))
            .order_by('-count')[:10]
        )

        top_agents = (
            placed_qs
            .values('agent_id', 'agent__user__username')
            .annotate(count=Count('id', distinct=True))
            .order_by('-count')[:10]
        )

        top_items = (
            OrderItem.objects
            .filter(order__in=placed_qs)
            .values('item_name')
            .annotate(qty=Sum('quantity'))
            .order_by('-qty')[:10]
        )

        dispatched_in_range = order_qs.filter(status='DISPATCHED')
        dispatch_times = []
        for order in dispatched_in_range:
            log = OrderLog.objects.filter(
                order=order,
                action='DISPATCHED'
            ).order_by('-created_at').first()
            if log:
                delta = log.created_at - order.created_at
                dispatch_times.append(delta.total_seconds() / 3600)

        if dispatch_times:
            avg_dispatch = sum(dispatch_times) / len(dispatch_times)
            sorted_times = sorted(dispatch_times)
            median_dispatch = sorted_times[len(sorted_times) // 2]
            within_24h = sum(1 for t in dispatch_times if t <= 24) / len(dispatch_times) * 100
        else:
            avg_dispatch = None
            median_dispatch = None
            within_24h = None

        time_metrics = {
            'avg_dispatch_hours': avg_dispatch,
            'median_dispatch_hours': median_dispatch,
            'dispatched_within_24h_pct': within_24h,
        }

        return Response({
            'kpis': kpis,
            'trend': list(trend),
            'top_customers': [
                {'id': c['customer_id'], 'name': c['customer__name'], 'count': c['count']}
                for c in top_customers
            ],
            'top_agents': [
                {'id': a['agent_id'], 'username': a['agent__user__username'], 'count': a['count']}
                for a in top_agents
            ],
            'top_items': [
                {'name': i['item_name'], 'qty': i['qty']}
                for i in top_items
            ],
            'time_metrics': time_metrics,
        })
