from django.db import models


class Brand(models.Model):
    """The mill's company profile, used on invoices.

    StockFlow is single-tenant, so there is exactly one of these rows. The table
    name stays ``brand`` because it is the customer's own legal/trading name on
    paperwork, not a tenancy boundary.
    """

    name = models.CharField(max_length=200)
    phone = models.TextField(blank=True)
    email = models.EmailField(blank=True)
    address_line1 = models.TextField(blank=True)
    address_line2 = models.TextField(blank=True, null=True)
    logo = models.ImageField(upload_to="brand/", blank=True, null=True)
    gst = models.CharField(max_length=20, blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "company profile"
        verbose_name_plural = "company profile"

    def save(self, *args, **kwargs):
        # Keep it a singleton: a second save() edits the existing row rather than
        # creating another company.
        if not self.pk and Brand.objects.exists():
            existing = Brand.objects.first()
            self.pk = existing.pk
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        """The company profile is required for invoicing and cannot be removed."""
        raise ValueError("The company profile cannot be deleted.")

    def __str__(self):
        return self.name

    @classmethod
    def load(cls):
        """Fetch the profile, creating an empty one on first use."""
        return cls.objects.first() or cls.objects.create(name="")
