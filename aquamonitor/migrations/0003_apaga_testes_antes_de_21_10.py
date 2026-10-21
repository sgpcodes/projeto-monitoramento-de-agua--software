"""Limpeza unica: apaga as leituras de teste anteriores a 21/10/2026.

O estudo conta a partir de 21/10/2026 (horario de Brasilia). Leituras de
testes e dados de exemplo dos dias anteriores saem do banco; coletas que
ficarem vazias tambem. Roda uma vez so (como toda migracao).
"""
from datetime import datetime, timedelta, timezone

from django.db import migrations

INICIO_DO_ESTUDO = datetime(2026, 10, 21, tzinfo=timezone(timedelta(hours=-3)))


def apagar_testes(apps, schema_editor):
    Coleta = apps.get_model("aquamonitor", "Coleta")
    Leitura = apps.get_model("aquamonitor", "Leitura")
    Leitura.objects.filter(medido_em__lt=INICIO_DO_ESTUDO).delete()
    Coleta.objects.filter(leituras__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [("aquamonitor", "0002_leitura_turbidez_cores_diagnostico")]
    operations = [migrations.RunPython(apagar_testes, migrations.RunPython.noop)]
