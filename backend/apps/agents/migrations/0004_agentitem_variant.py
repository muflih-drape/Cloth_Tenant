from django.db import migrations, models
import django.db.models.deletion


def backfill_variants(apps, schema_editor):
    AgentItem = apps.get_model("agents", "AgentItem")
    ItemVariant = apps.get_model("items", "ItemVariant")

    for ai in AgentItem.objects.filter(variant__isnull=True).iterator():
        variants = ItemVariant.objects.filter(item_id=ai.item_id)
        for variant in variants:
            AgentItem.objects.get_or_create(
                agent=ai.agent,
                variant=variant,
                defaults={"created_at": ai.created_at},
            )


class Migration(migrations.Migration):
    dependencies = [
        ("items", "0008_alter_item_brand"),
        ("agents", "0003_agent_deactivated_at_agent_is_active"),
    ]

    operations = [
        # ── Phase 1: Bring Django state in sync so the data migration can use ORM ──
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AlterUniqueTogether(
                    name="agentitem",
                    unique_together=set(),
                ),
                migrations.AddField(
                    model_name="agentitem",
                    name="variant",
                    field=models.ForeignKey(
                        null=True,
                        blank=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="assigned_agents",
                        to="items.itemvariant",
                    ),
                ),
            ],
            database_operations=[],
        ),
        # ── Phase 2: DB schema changes ──
        # Drop old unique constraint
        migrations.RunSQL(
            "SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE agents_agentitem DROP CONSTRAINT agents_agentitem_agent_id_item_id_3bd286f7_uniq;",
            migrations.RunSQL.noop,
        ),
        # Add variant_id column (nullable) with FK
        migrations.RunSQL(
            "SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE agents_agentitem ADD COLUMN variant_id bigint NULL REFERENCES items_itemvariant(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;",
            "ALTER TABLE agents_agentitem DROP COLUMN variant_id;",
        ),
        # Make item_id nullable so backfill can create rows without it
        migrations.RunSQL(
            "SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE agents_agentitem ALTER COLUMN item_id DROP NOT NULL;",
            "ALTER TABLE agents_agentitem ALTER COLUMN item_id SET NOT NULL;",
        ),
        # ── Phase 3: Data migration ──
        migrations.RunPython(backfill_variants, migrations.RunPython.noop),
        migrations.RunSQL(
            "DELETE FROM agents_agentitem WHERE variant_id IS NULL;",
            migrations.RunSQL.noop,
        ),
        # ── Phase 4: Finalise DB schema ──
        # Make variant_id non-nullable
        migrations.RunSQL(
            "SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE agents_agentitem ALTER COLUMN variant_id SET NOT NULL;",
            "ALTER TABLE agents_agentitem ALTER COLUMN variant_id DROP NOT NULL;",
        ),
        # Drop item_id column (CASCADE removes its FK too)
        migrations.RunSQL(
            "SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE agents_agentitem DROP COLUMN item_id CASCADE;",
            migrations.RunSQL.noop,
        ),
        # Add unique index on (agent_id, variant_id)
        migrations.RunSQL(
            "SET CONSTRAINTS ALL IMMEDIATE; CREATE UNIQUE INDEX agents_agentitem_agent_id_variant_id_uniq ON agents_agentitem (agent_id, variant_id);",
            "DROP INDEX IF EXISTS agents_agentitem_agent_id_variant_id_uniq;",
        ),
        # ── Phase 5: Finalise Django state ──
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(
                    model_name="agentitem",
                    name="item",
                ),
                migrations.AlterField(
                    model_name="agentitem",
                    name="variant",
                    field=models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="assigned_agents",
                        to="items.itemvariant",
                    ),
                ),
                migrations.AlterUniqueTogether(
                    name="agentitem",
                    unique_together={("agent", "variant")},
                ),
            ],
            database_operations=[],
        ),
    ]
