import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Coleta",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("data_coleta", models.DateField(unique=True)),
                ("criada_em", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name": "coleta",
                "verbose_name_plural": "coletas",
                "ordering": ["-data_coleta"],
            },
        ),
        migrations.CreateModel(
            name="Leitura",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("tipo", models.CharField(max_length=16)),
                ("amostra", models.CharField(default="sem_nome", max_length=20)),
                ("led", models.CharField(max_length=16)),
                ("replica", models.PositiveSmallIntegerField()),
                ("medido_em", models.DateTimeField(db_index=True)),
                ("recebido_em", models.DateTimeField(auto_now_add=True)),
                ("ganho", models.IntegerField()),
                ("atime", models.IntegerField()),
                ("astep", models.IntegerField()),
                ("n", models.PositiveIntegerField()),
                ("saturado", models.BooleanField()),
                ("media", models.JSONField()),
                ("desvio", models.JSONField()),
                ("turbidez_mv", models.FloatField(blank=True, null=True)),
                ("dp_turbidez_mv", models.FloatField(blank=True, null=True)),
                ("dados_originais", models.JSONField()),
                (
                    "collection",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="leituras",
                        to="aquamonitor.coleta",
                    ),
                ),
            ],
            options={
                "verbose_name": "leitura",
                "verbose_name_plural": "leituras",
                "ordering": ["-medido_em"],
                "indexes": [
                    models.Index(
                        fields=["collection", "medido_em"],
                        name="aquamonito_collect_944dd9_idx",
                    ),
                    models.Index(
                        fields=["collection", "amostra", "tipo"],
                        name="aquamonito_collect_75c33c_idx",
                    ),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("medido_em", "tipo", "amostra", "led", "replica"),
                        name="unique_sensor_reading",
                    )
                ],
            },
        ),
    ]
