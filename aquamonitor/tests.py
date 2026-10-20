from datetime import date, datetime

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Coleta, Leitura
from .serializers import CHANNELS


class DashboardDataTests(TestCase):
    def test_returns_empty_payload_for_a_date_without_readings(self):
        response = self.client.get(
            reverse("dashboard_data"), {"data": "2026-10-20"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertEqual(response.json()["total_leituras"], 0)
        self.assertEqual(response.json()["leituras"], [])
        self.assertEqual(response.json()["chart_data"], [])

    def test_returns_sensor_readings_and_chart_values(self):
        collection = Coleta.objects.create(data_coleta=date(2026, 10, 20))
        timestamp = timezone.make_aware(datetime(2026, 10, 20, 10, 0))
        common = {
            "collection": collection,
            "amostra": "lagoa",
            "led": "frente",
            "replica": 1,
            "medido_em": timestamp,
            "ganho": 1,
            "atime": 100,
            "astep": 100,
            "n": 1,
            "saturado": False,
            "desvio": {channel: 1 for channel in CHANNELS},
            "turbidez_mv": None,
            "dp_turbidez_mv": None,
            "dados_originais": {},
        }
        Leitura.objects.create(
            **common,
            tipo="branco",
            media={channel: 100 for channel in CHANNELS},
        )
        Leitura.objects.create(
            **{
                **common,
                "medido_em": timezone.make_aware(datetime(2026, 10, 20, 10, 1)),
            },
            tipo="amostra",
            media={channel: 50 for channel in CHANNELS},
        )

        response = self.client.get(
            reverse("dashboard_data"), {"data": "2026-10-20"}
        )
        payload = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["total_leituras"], 2)
        self.assertEqual(len(payload["leituras"]), 2)
        self.assertAlmostEqual(payload["chart_data"][0]["turbidez"], 0.5)
        self.assertEqual(len(payload["espectro"]["semanas"][0]["valores"]), 8)
        self.assertEqual(len(payload["live"]["valores"]), 8)

    def test_rejects_an_invalid_date(self):
        response = self.client.get(reverse("dashboard_data"), {"data": "not-a-date"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("erro", response.json())
