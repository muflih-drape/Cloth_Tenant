from pathlib import Path
from datetime import timedelta
from django.core.management.base import BaseCommand
from django.core.files import File
from django.contrib.auth import get_user_model
from django.utils import timezone
from apps.business.models import Brand
from apps.agents.models import Agent, AgentItem
from apps.customers.models import Customer
from apps.items.models import Item, ItemVariant, ItemVariantSize
from apps.orders.models import Order, OrderItem
import random

from apps.orders.utils import SIZE_MAPPING, get_piece_count
from django.db.models.signals import post_save
from apps.items.signals import update_item_stock_status

User = get_user_model()


class Command(BaseCommand):
    help = "Seed comprehensive test data for admins, agents, customers, items, and orders"

    def handle(self, *args, **kwargs):
        base_dir = Path(__file__).resolve().parent.parent.parent.parent.parent

        # ---- Brands ----
        brands_data = [
            {
                "name": "XL TOWER",
                "phone": "9447447369, 9447744369",
                "email": "xicalicut@gmail.com",
                "address_line1": "Muttanchery",
                "address_line2": "Narikkuni, Calicut - 673585",
                "gst": "",
                "logo_path": "seed_data/xl-tower.png",
            },
            {
                "name": "BN CLOTHING",
                "phone": "",
                "email": "bnclothingclt@gmail.com",
                "address_line1": "Muttancheri (P.O), Narikuni",
                "address_line2": "Kozhikode, Kerala - 673585",
                "gst": "",
                "logo_path": "seed_data/bn-clothing.png",
            },
        ]

        brands = {}
        for brand_data in brands_data:
            name = brand_data["name"]
            if Brand.objects.filter(name=name).exists():
                brands[name] = Brand.objects.get(name=name)
                self.stdout.write(self.style.WARNING(f"Brand already exists: {name}"))
            else:
                logo_path = brand_data.pop("logo_path", None)
                brand = Brand(**brand_data)
                if logo_path:
                    full_path = base_dir / logo_path
                    if full_path.exists():
                        with open(full_path, "rb") as f:
                            brand.logo.save(full_path.name, File(f), save=False)
                brand.save()
                brands[name] = brand
                self.stdout.write(self.style.SUCCESS(f"Created brand: {name}"))

        # ---- Admins ----
        admins_data = [
            {
                "username": "kidsadmin",
                "email": "kidsadmin@example.com",
                "password": "password123",
                "first_name": "Kids",
                "last_name": "Admin",
                "role": "ADMIN",
                "business": "kids",
            },
            {
                "username": "gentsadmin",
                "email": "gentsadmin@example.com",
                "password": "password123",
                "first_name": "Gents",
                "last_name": "Admin",
                "role": "ADMIN",
                "business": "gents",
            },
        ]

        for admin_data in admins_data:
            email = admin_data["email"]
            if User.objects.filter(email=email).exists():
                self.stdout.write(self.style.WARNING(f"Admin already exists: {email}"))
                continue
            password = admin_data.pop("password")
            user = User(**admin_data)
            user.set_password(password)
            user.save()
            # Assign brand based on business type
            if admin_data["business"] == "kids":
                user.brand = brands["XL TOWER"]
            else:
                user.brand = brands["BN CLOTHING"]
            user.save()
            self.stdout.write(self.style.SUCCESS(f"Created admin: {email}"))

        # ---- Agent ----
        agent_email = "agent@example.com"
        if User.objects.filter(email=agent_email).exists():
            self.stdout.write(self.style.WARNING(f"Agent already exists: {agent_email}"))
            agent_user = User.objects.get(email=agent_email)
            agent = agent_user.agent if hasattr(agent_user, 'agent') else None
        else:
            agent_user = User.objects.create_user(
                username="agent",
                email=agent_email,
                password="password123",
                first_name="Test",
                last_name="Agent",
                role="AGENT",
                business="gents",
                brand=brands["BN CLOTHING"],
            )
            agent = Agent.objects.create(user=agent_user, contact="1234567890")
            self.stdout.write(self.style.SUCCESS(f"Created agent: {agent_email}"))

        # ---- Customers ----
        customers_data = [
            {
                "name": "Customer One",
                "address": "123 Main St, Calicut",
                "contact": "9876543210",
                "agent": agent,
            },
            {
                "name": "Customer Two",
                "address": "456 Oak Ave, Calicut",
                "contact": "9876543211",
                "agent": agent,
            },
        ]

        customers = []
        for cust_data in customers_data:
            name = cust_data["name"]
            if Customer.objects.filter(name=name, agent=agent).exists():
                self.stdout.write(self.style.WARNING(f"Customer already exists: {name}"))
                customers.append(Customer.objects.get(name=name, agent=agent))
            else:
                customer = Customer.objects.create(**cust_data)
                customers.append(customer)
                self.stdout.write(self.style.SUCCESS(f"Created customer: {name}"))

        # ---- Items with Variants and Sizes ----
        items_data = []

        for i in range(20):  # create 20 unique items
            items_data.append({
                "name": f"Gents Item {i}",
                "description": "Auto generated",
                "price": random.randint(500, 3000),
                "type": "gents",
                "brand": brands["BN CLOTHING"],
                "num_variants": random.randint(2, 4),
                "image_paths": ["seed_data/test_data/green-shirt.jpg", "seed_data/test_data/pink-shirt.jpg", "seed_data/test_data/white-shirt.jpg"],
            })

        for i in range(20):
            items_data.append({
                "name": f"Kids Item {i}",
                "description": "Auto generated",
                "price": random.randint(300, 2000),
                "type": "kids",
                "brand": brands["XL TOWER"],
                "num_variants": random.randint(2, 3),
                "image_paths": ["seed_data/test_data/white-shirt.jpg", "seed_data/test_data/green-shirt.jpg", "seed_data/test_data/pink-shirt.jpg" ],
            })

        items = []
        for item_data in items_data:
            name = item_data["name"]
            if Item.objects.filter(name=name).exists():
                self.stdout.write(self.style.WARNING(f"Item already exists: {name}"))
                items.append(Item.objects.get(name=name))
                continue

            num_variants = item_data.pop("num_variants")
            image_paths = item_data.pop("image_paths")
            item = Item.objects.create(**item_data)
            items.append(item)
            self.stdout.write(self.style.SUCCESS(f"Created item: {name}"))

            for i in range(num_variants):
                variant = ItemVariant.objects.create(item=item)
                if i < len(image_paths) and image_paths[i]:
                    full_path = base_dir / image_paths[i]
                    if full_path.exists():
                        with open(full_path, "rb") as f:
                            variant.image.save(full_path.name, File(f), save=False)
                            variant.save()

                # Get all individual sizes from SIZE_MAPPING for this item type
                size_groups = SIZE_MAPPING.get(item.type, {})
                individual_sizes = set()
                for size_list in size_groups.values():
                    individual_sizes.update(size_list)

                for size in individual_sizes:
                    ItemVariantSize.objects.create(
                        item_variant=variant,
                        size=size,
                        stock=100
                    )

                self.stdout.write(
                    self.style.SUCCESS(f"  Created variant {i+1} for {name} with {len(individual_sizes)} sizes")
                )

        # ---- Create Archived Items (out of stock for 30+ days) ----
        self.stdout.write(self.style.WARNING("\nCreating archived items..."))

        # Temporarily disable signal to avoid interference
        post_save.disconnect(update_item_stock_status, sender=ItemVariantSize)

        archived_items_data = [
            {"name": "Archived Gents Item 1", "type": "gents", "brand": brands["BN CLOTHING"], "price": 1500, "description": "Archived item - out of stock"},
            {"name": "Archived Gents Item 2", "type": "gents", "brand": brands["BN CLOTHING"], "price": 2000, "description": "Archived item - out of stock"},
            {"name": "Archived Kids Item 1", "type": "kids", "brand": brands["XL TOWER"], "price": 1000, "description": "Archived item - out of stock"},
        ]

        for item_data in archived_items_data:
            name = item_data["name"]
            item = Item.objects.filter(name=name).first()
            
            if item:
                # Update existing item
                item.out_of_stock_since = timezone.now() - timedelta(days=45)
                item.save(update_fields=['out_of_stock_since'])
                # Set stock to 0 for all variants
                for variant in item.variants.all():
                    variant.sizes.update(stock=0)
                self.stdout.write(self.style.WARNING(f"Updated archived item: {name}"))
            else:
                item = Item.objects.create(**item_data)
                
                # Create variant with 0 stock
                variant = ItemVariant.objects.create(item=item)
                
                # Add sizes with 0 stock (use get_or_create to avoid duplicates)
                size_groups = SIZE_MAPPING.get(item.type, {})
                for size_list in size_groups.values():
                    for size in size_list:
                        ItemVariantSize.objects.get_or_create(
                            item_variant=variant,
                            size=size,
                            defaults={'stock': 0}
                        )
                
                # Set out_of_stock_since to 45 days ago (triggers archive)
                item.out_of_stock_since = timezone.now() - timedelta(days=45)
                item.save(update_fields=['out_of_stock_since'])
                
                self.stdout.write(self.style.SUCCESS(f"Created archived item: {item.name}"))

        # Re-enable signal
        post_save.connect(update_item_stock_status, sender=ItemVariantSize)

        # ---- Assign Items to Agent ----
        # Only assign gents items since agent's business is "gents"
        for item in items:
            if item.type != "gents":
                continue
            for variant in item.variants.all():
                AgentItem.objects.get_or_create(agent=agent, variant=variant)
                self.stdout.write(self.style.SUCCESS(f"Assigned item '{item.name}' to agent"))
            else:
                self.stdout.write(self.style.WARNING(f"Item '{item.name}' already assigned to agent"))

        # ---- Orders with Past Dates ----
        if Order.objects.filter(agent=agent).exists():
            self.stdout.write(self.style.WARNING("Orders already exist for agent, skipping order creation"))
        else:
            gents_size_groups = list(SIZE_MAPPING["gents"].keys())

            # Preload everything (IMPORTANT)
            items = list(Item.objects.prefetch_related("variants"))
            customers = list(Customer.objects.filter(agent=agent))

            gents_items = [item for item in items if item.type == "gents"]

            # Cache variants to avoid repeated queries
            item_variants_map = {
                item.id: list(item.variants.all())
                for item in items
            }

            # ---- Create Orders in Bulk ----
            NUM_ORDERS = 100

            # Create orders with dates ranging from 60 days ago to now
            orders_to_create = []
            base_date = timezone.now() - timedelta(days=60)

            for i in range(NUM_ORDERS):
                # Spread orders across 60 days
                days_ago = random.randint(0, 60)
                created_at = base_date + timedelta(days=days_ago, hours=random.randint(0, 23))

                status = random.choices(
                    ["PENDING", "PACKED", "DISPATCHED"],
                    weights=[30, 30, 40]
                )[0]

                order = Order(
                    customer=random.choice(customers),
                    agent=agent,
                    status=status,
                )
                orders_to_create.append(order)

            orders = Order.objects.bulk_create(orders_to_create)

            # Now update created_at for each order (bypass auto_now_add)
            for i, order in enumerate(orders):
                days_ago = random.randint(0, 60)
                created_at = base_date + timedelta(days=days_ago, hours=random.randint(0, 23))
                Order.objects.filter(id=order.id).update(created_at=created_at)

            # Refresh orders to get updated timestamps
            orders = list(Order.objects.filter(agent=agent))

            # ---- Create OrderItems in Bulk ----
            order_items_to_create = []

            for order in orders:
                num_items = random.randint(1, 5)

                # Only use gents items since agent is gents business
                selected_items = random.choices(gents_items, k=num_items)

                for item in selected_items:
                    variants = item_variants_map.get(item.id, [])
                    if not variants:
                        continue

                    variant = random.choice(variants)

                    size_group = random.choice(gents_size_groups)
                    available_sizes = SIZE_MAPPING["gents"][size_group]
                    size = random.choice(available_sizes)

                    quantity = random.randint(1, 5)
                    # packed_quantity should be in pieces (sets * piece_count)
                    piece_count = get_piece_count(size_group, item.type)

                    packed_quantity = 0
                    if order.status in ["PACKED", "DISPATCHED"]:
                        packed_quantity = quantity * piece_count

                    order_items_to_create.append(
                        OrderItem(
                            order=order,
                            item=item,
                            variant=variant,
                            item_type=item.type,
                            item_name=item.name,
                            item_price=item.price,
                            variant_image=variant.image.url if variant.image else "",
                            size_group=size_group,
                            size=size,
                            quantity=quantity,
                            packed_quantity=packed_quantity,
                        )
                    )

            # ---- Bulk Insert in Chunks (VERY IMPORTANT) ----
            BATCH_SIZE = 500

            for i in range(0, len(order_items_to_create), BATCH_SIZE):
                OrderItem.objects.bulk_create(order_items_to_create[i:i + BATCH_SIZE])

            # ---- Set dispatched_at for DISPATCHED orders ----
            dispatched_orders = [o for o in orders if o.status == "DISPATCHED"]

            for order in dispatched_orders:
                # Set dispatched_at after created_at (1-3 days later)
                days_after_creation = random.randint(1, 3)
                dispatched_at = order.created_at + timedelta(days=days_after_creation)
                Order.objects.filter(id=order.id).update(dispatched_at=dispatched_at)

            self.stdout.write(
                self.style.SUCCESS(f"Created {len(orders)} orders with {len(order_items_to_create)} items")
            )
        self.stdout.write(self.style.SUCCESS("\n" + "=" * 50))
        self.stdout.write(self.style.SUCCESS("Seed data creation complete!"))
        self.stdout.write(self.style.SUCCESS("=" * 50))