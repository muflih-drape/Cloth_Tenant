from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('items', '0002_alter_itemvariant_size'),
    ]

    operations = [
        migrations.AddField(
            model_name='itemvariant',
            name='color_order',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.CreateModel(
            name='ItemVariantSize',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('size', models.CharField(choices=[('20-24', '20-24'), ('26-30', '26-30'), ('32-36', '32-36'), ('38', '38'), ('S', 'S'), ('M', 'M'), ('L', 'L'), ('XL', 'XL'), ('XXL', 'XXL'), ('M,L,XL', 'M,L,XL')], max_length=10)),
                ('stock', models.PositiveIntegerField(default=0)),
                ('item_variant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sizes', to='items.itemvariant')),
            ],
            options={
                'unique_together': {('item_variant', 'size')},
            },
        ),
        migrations.AlterField(
            model_name='itemvariant',
            name='qr_code',
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
    ]
