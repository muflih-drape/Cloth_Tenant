from pathlib import Path
from django.core.management.base import BaseCommand
from django.core.files import File
from apps.business.models import Brand


BRANDS = [
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


class Command(BaseCommand):
    help = "Seed initial brand data"

    def handle(self, *args, **kwargs):
        base_dir = Path(__file__).resolve().parent.parent.parent.parent.parent
        created_count = 0
        for brand_data in BRANDS:
            name = brand_data["name"]
            if Brand.objects.filter(name=name).exists():
                self.stdout.write(self.style.WARNING(f"Brand already exists: {name}"))
                continue

            logo_path = brand_data.pop("logo_path", None)
            brand = Brand(**brand_data)

            if logo_path:
                full_path = base_dir / logo_path
                if full_path.exists():
                    with open(full_path, "rb") as f:
                        brand.logo.save(full_path.name, File(f), save=False)
                else:
                    self.stdout.write(self.style.WARNING(f"Logo not found: {full_path}"))

            brand.save()
            self.stdout.write(self.style.SUCCESS(f"Created brand: {name}"))
            created_count += 1

        self.stdout.write(self.style.SUCCESS(f"\nDone. {created_count} brand(s) created."))
