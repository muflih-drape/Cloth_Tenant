"""Seed a realistic single-tenant mill: company profile, staff, fabrics, demand.

Everything is in metres. Stock is *on-hand* cloth, so seeded quantities are
generous on purpose: the interesting behaviour (backorders, priority
allocation) shows up in the packing tests, not in the demo data.
"""

import random
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files import File
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.agents.models import Agent, AgentItem
from apps.business.models import Brand
from apps.customers.models import Customer
from apps.items.models import Fabric, FabricVariant
from apps.orders.models import Order, OrderItem, OrderLog

User = get_user_model()

FABRIC_SEED = [
    ("Cotton Cambric 140 GSM", "Plain weave, mercerised", "9.00"),
    ("Cotton Poplin 120 GSM", "Fine poplin, office shirting", "8.25"),
    ("Linen Blend 180 GSM", "Linen/viscose, suiting", "14.50"),
    ("Poly Twill 240 GSM", "Workwear twill, snag resistant", "11.75"),
    ("Viscose Georgette", "Fluid georgette, linings", "7.40"),
    ("Denim 320 GSM", "Rigid selvedge denim", "18.90"),
    ("Cotton Jersey 180 GSM", "Single jersey, knit", "10.60"),
    ("Silk Blend Satin", "Duchesse satin, occasionwear", "26.00"),
    ("Hemp Canvas 280 GSM", "Hemp/cotton canvas, bags", "16.25"),
    ("Rayon Challis", "Printed challis, dresses", "6.90"),
]

COLOURS = [
    "Natural",
    "White",
    "Black",
    "Navy Blue",
    "Olive Green",
    "Maroon",
    "Mustard",
    "Slate Grey",
]

CUSTOMER_SEED = [
    ("Malabar Textiles", "NH 44, Calicut", "9447447369"),
    ("Kozhikode Cloth Mart", "MG Road, Kozhikode", "9846732911"),
    ("Wayanad Weaves", "Kalpetta, Wayanad", "9447085522"),
    ("Malappuram Fashions", "Tirur, Malappuram", "9387234561"),
    ("Thrissur Outfitters", "Thrissur", "9447102946"),
    ("Ernakulam Tailors", "Panampilly Nagar, Kochi", "9846712345"),
]

AGENT_SEED = [
    ("agent", "agent@example.com", "Test", "Agent", "1234567890"),
    ("priya", "priya@example.com", "Priya", "Nair", "9876543210"),
]


class Command(BaseCommand):
    help = "Seed test data: company profile, staff, customers, fabrics and orders"

    def add_arguments(self, parser):
        parser.add_argument(
            "--orders",
            type=int,
            default=100,
            help="How many historical orders to create (default: 100).",
        )
        parser.add_argument(
            "--flush-orders",
            action="store_true",
            help="Delete the seeded agent's existing orders first.",
        )

    def handle(self, *args, **options):
        random.seed(20260926)
        base_dir = Path(__file__).resolve().parent.parent.parent.parent.parent

        profile = self._seed_company_profile(base_dir)
        admins = self._seed_admins()
        agents = self._seed_agents()
        customers = self._seed_customers(agents)
        fabrics = self._seed_fabrics(base_dir)
        self._seed_assignments(agents, fabrics)
        self._seed_orders(agents, customers, fabrics, options)

        self.stdout.write(self.style.SUCCESS("\n" + "=" * 50))
        self.stdout.write(self.style.SUCCESS("Seed data creation complete!"))
        self.stdout.write(self.style.SUCCESS("=" * 50))

    # ------------------------------------------------------------------ #

    def _seed_company_profile(self, base_dir):
        existing = Brand.objects.first()
        if existing:
            self.stdout.write(self.style.WARNING(f"Company profile exists: {existing.name}"))
            return existing

        profile = Brand(
            name="Malabar Fabrics",
            phone="9447447369",
            email="orders@malabarfabrics.in",
            address_line1="Muttanchery, Narikkuni",
            address_line2="Calicut, Kerala - 673585",
            gst="",
        )
        logo = base_dir / "seed_data" / "xl-tower.png"
        if logo.exists():
            with open(logo, "rb") as handle:
                profile.logo.save(logo.name, File(handle), save=False)
        profile.save()
        self.stdout.write(self.style.SUCCESS(f"Created company profile: {profile.name}"))
        return profile

    def _seed_admins(self):
        created = []
        for username, email, first, last in [
            ("admin", "admin@example.com", "Mill", "Admin"),
            ("packing", "packing@example.com", "Pack", "Lead"),
        ]:
            if User.objects.filter(email=email).exists():
                self.stdout.write(self.style.WARNING(f"Admin exists: {email}"))
                created.append(User.objects.get(email=email))
                continue
            user = User(
                username=username,
                email=email,
                first_name=first,
                last_name=last,
                role="ADMIN",
                display_name=first,
            )
            user.set_password("password123")
            user.set_pin("1234")
            user.save()
            created.append(user)
            self.stdout.write(self.style.SUCCESS(f"Created admin: {email}"))
        return created

    def _seed_agents(self):
        created = []
        for username, email, first, last, contact in AGENT_SEED:
            if User.objects.filter(email=email).exists():
                self.stdout.write(self.style.WARNING(f"Agent exists: {email}"))
                user = User.objects.get(email=email)
                created.append(getattr(user, "agent", None))
                continue
            user = User.objects.create_user(
                username=username,
                email=email,
                password="password123",
                first_name=first,
                last_name=last,
                role="AGENT",
                display_name=first,
            )
            agent = Agent.objects.create(user=user, contact=contact)
            created.append(agent)
            self.stdout.write(self.style.SUCCESS(f"Created agent: {email}"))
        return [a for a in created if a is not None]

    def _seed_customers(self, agents):
        created = []
        for name, address, contact in CUSTOMER_SEED:
            existing = Customer.objects.filter(name=name).first()
            if existing:
                self.stdout.write(self.style.WARNING(f"Customer exists: {name}"))
                created.append(existing)
                continue
            customer = Customer.objects.create(
                name=name,
                address=address,
                contact=contact,
                agent=random.choice(agents) if agents else None,
            )
            created.append(customer)
            self.stdout.write(self.style.SUCCESS(f"Created customer: {name}"))
        return created

    def _seed_fabrics(self, base_dir):
        created = []
        for name, description, price in FABRIC_SEED:
            fabric = Fabric.objects.filter(name=name).first()
            if fabric:
                self.stdout.write(self.style.WARNING(f"Fabric exists: {name}"))
                created.append(fabric)
                continue

            fabric = Fabric.objects.create(
                name=name,
                description=description,
                price_per_meter=Decimal(price),
            )
            colours = random.sample(COLOURS, random.randint(2, 4))
            for colour in colours:
                FabricVariant.objects.create(
                    fabric=fabric,
                    display_order=colour,
                    # Thousands of metres so seeded orders are comfortably
                    # coverable; the allocation tests set their own numbers.
                    stock_meters=Decimal(random.randint(2000, 9000)),
                )
            created.append(fabric)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Created fabric: {name} @ {price}/m "
                    f"({len(colours)} colours)"
                )
            )
        return created

    def _seed_assignments(self, agents, fabrics):
        for agent in agents:
            for fabric in fabrics:
                for variant in fabric.variants.all():
                    AgentItem.objects.get_or_create(agent=agent, variant=variant)
        if agents:
            total = sum(agent.assigned_items.count() for agent in agents)
            self.stdout.write(
                self.style.SUCCESS(f"Assigned {total} variants across {len(agents)} agents")
            )

    def _seed_orders(self, agents, customers, fabrics, options):
        if not (agents and customers and fabrics):
            self.stdout.write(
                self.style.WARNING("Not enough agents/customers/fabrics; skipping orders.")
            )
            return

        agent = agents[0]

        if options["flush_orders"]:
            Order.objects.filter(agent=agent).delete()
            self.stdout.write(self.style.WARNING("Flushed existing orders"))

        if Order.objects.filter(agent=agent).exists():
            self.stdout.write(
                self.style.WARNING("Orders already exist for agent; skipping.")
            )
            return

        count = options["orders"]
        base_date = timezone.now() - timedelta(days=60)

        orders = Order.objects.bulk_create(
            [
                Order(
                    customer=random.choice(customers),
                    agent=agent,
                    created_by=agent.user,
                    status=random.choices(
                        ["PENDING", "PACKED", "DISPATCHED"], weights=[30, 30, 40]
                    )[0],
                )
                for _ in range(count)
            ]
        )

        # auto_now_add ignores the value passed to the constructor.
        for order in orders:
            Order.objects.filter(id=order.id).update(
                created_at=base_date + timedelta(
                    days=random.randint(0, 60), hours=random.randint(0, 23)
                )
            )

        orders = list(Order.objects.filter(id__in=[o.id for o in orders]))
        variants = [v for f in fabrics for v in f.variants.all()]
        if not variants:
            return

        lines = []
        for order in orders:
            for variant in random.sample(variants, random.randint(1, 4)):
                ordered = Decimal(random.randint(50, 900))
                # PACKED and DISPATCHED orders have had cloth handed over;
                # PENDING ones are still only demand.
                allocated = (
                    ordered
                    if order.status in ("PACKED", "DISPATCHED")
                    else Decimal("0")
                )
                lines.append(
                    OrderItem(
                        order=order,
                        fabric=variant.fabric,
                        variant=variant,
                        fabric_name=variant.fabric.name,
                        rate_per_meter=variant.fabric.price_per_meter,
                        variant_display_order=variant.display_order or "",
                        ordered_quantity=ordered,
                        allocated_quantity=allocated,
                    )
                )

        BATCH = 500
        for i in range(0, len(lines), BATCH):
            OrderItem.objects.bulk_create(lines[i : i + BATCH])

        for order in orders:
            if order.status != "DISPATCHED":
                continue
            dispatched_at = order.created_at + timedelta(
                days=random.randint(1, 3)
            )
            Order.objects.filter(id=order.id).update(dispatched_at=dispatched_at)
            OrderLog.objects.create(
                order_ref=order.id,
                order=order,
                action="DISPATCHED",
                details={"seeded": True},
                performed_by=agent.user,
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Created {len(orders)} orders with {len(lines)} metre-priced lines"
            )
        )
