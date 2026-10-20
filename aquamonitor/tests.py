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
            media={channel: 10000 for channel in CHANNELS},
        )
        Leitura.objects.create(
            **{
                **common,
                "medido_em": timezone.make_aware(datetime(2026, 10, 20, 10, 1)),
            },
            tipo="amostra",
            media={channel: 5000 for channel in CHANNELS},
        )

        response = self.client.get(
            reverse("dashboard_data"), {"data": "2026-10-20"}
        )
        payload = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["total_leituras"], 2)
        self.assertEqual(len(payload["leituras"]), 2)
        self.assertAlmostEqual(payload["chart_data"][0]["turbidez"], 50.0)
        self.assertEqual(len(payload["espectro"]["semanas"][0]["valores"]), 8)
        self.assertEqual(len(payload["live"]["valores"]), 8)

    def test_uses_the_data_sent_by_the_esp32(self):
        collection = Coleta.objects.create(data_coleta=date(2026, 10, 20))
        nomes = ["Violeta", "Azul", "Ciano", "Verde", "Verde-amarelo", "Amarelo", "Laranja", "Vermelho"]
        ondas = [415, 445, 480, 515, 555, 590, 630, 680]

        def leitura(minuto, porcentagens, saturado=False):
            return Leitura.objects.create(
                collection=collection,
                tipo="amostra",
                amostra="lagoa",
                led="frente",
                replica=1,
                medido_em=timezone.make_aware(datetime(2026, 10, 20, 10, minuto)),
                ganho=64,
                atime=0,
                astep=0,
                n=1,
                saturado=saturado,
                media={channel: 20000 for channel in CHANNELS},
                desvio={},
                dados_originais={},
                turbidez={"ntu": None, "tensao_v": None, "luz_bloqueada_pct": 40.0, "classificacao": "MUITO TURVA"},
                cores=[
                    {"nome": n, "comprimento_onda_nm": w, "valor": 1000, "porcentagem": p}
                    for n, w, p in zip(nomes, ondas, porcentagens)
                ],
                diagnostico={
                    "turbidez": "MUITO TURVA",
                    "algas": "SINAL FRACO",
                    "cor": "NORMAL",
                    "contaminacao_pct": 35,
                    "contaminacao": "CONTAMINADA",
                    "resumo": "Agua muito turva.",
                },
            )

        leitura(0, [60, 58, 57, 56, 55, 60, 61, 50])
        leitura(15, [60, 58, 57, 56, 55, 60, 61, 50])
        leitura(16, [150, 40, 30, 25, 40, 36, 43, 150], saturado=True)  # luz de fora

        payload = self.client.get(reverse("dashboard_data"), {"data": "2026-10-20"}).json()

        self.assertEqual(payload["diagnostico"]["contaminacao_pct"], 35)
        self.assertEqual(payload["turbidez"]["luz_bloqueada_pct"], 40.0)
        self.assertEqual(payload["amostra_atual"]["hora"], "10:15:00")  # ignora a suspeita
        self.assertEqual(payload["espectro"]["unidade"], "% de luz que passou")
        self.assertEqual(payload["espectro"]["semanas"][0]["valores"][0], 60)
        self.assertEqual(payload["suspeitas"], 1)
        self.assertEqual([p["hora"] for p in payload["serie"]], ["10:00", "10:10"])
        self.assertAlmostEqual(payload["serie"][0]["contaminacao"], 35)
        self.assertGreater(payload["serie"][0]["algas"], 0.07)  # A680 - A590 com 50% e 60%
        self.assertEqual(payload["leituras"][0]["estado"], "Saturada")
        niveis = {c["id"]: c["nivel"] for c in payload["componentes"]}
        self.assertEqual(niveis["particulas"], "Alto")  # 40% bloqueada (acima de 35%)
        self.assertEqual(niveis["algas"], "Moderado")  # indice 0,079
        self.assertEqual(len(payload["espectro"]["absorbancia"]), 8)
        self.assertEqual(payload["canais"]["rotulos"][-1], "NIR")
        self.assertEqual(payload["canais"]["medicoes_dia"], 2)
        self.assertEqual(len(payload["serie"][0]["porcentagens"]), 8)
        self.assertTrue(any("suspeita" in o for o in payload["observacoes"]))

    def test_turbidity_from_colors_when_the_esp32_does_not_send_it(self):
        collection = Coleta.objects.create(data_coleta=date(2026, 10, 20))
        Leitura.objects.create(
            collection=collection, tipo="amostra", amostra="lagoa", led="frente", replica=1,
            medido_em=timezone.make_aware(datetime(2026, 10, 20, 10, 0)), ganho=64, atime=0, astep=0, n=1,
            saturado=False, media={channel: 20000 for channel in CHANNELS}, desvio={}, dados_originais={},
            turbidez={"ntu": None, "tensao_v": None, "classificacao": "TURVA"},
            cores=[{"nome": "x", "comprimento_onda_nm": 0, "valor": 0, "porcentagem": 64} for _ in range(8)],
            diagnostico={"contaminacao_pct": 20},
        )

        payload = self.client.get(reverse("dashboard_data"), {"data": "2026-10-20"}).json()

        self.assertAlmostEqual(payload["chart_data"][0]["turbidez"], 36.0)  # 1 - 0,64

    def test_low_light_readings_are_not_turbidity(self):
        collection = Coleta.objects.create(data_coleta=date(2026, 10, 20))
        Leitura.objects.create(
            collection=collection, tipo="amostra", amostra="lagoa", led="frente", replica=1,
            medido_em=timezone.make_aware(datetime(2026, 10, 20, 10, 0)), ganho=64, atime=0, astep=0, n=1,
            saturado=False, media={**{channel: 50 for channel in CHANNELS}, "clear": 300}, desvio={},
            dados_originais={}, turbidez={"ntu": None, "tensao_v": None, "luz_bloqueada_pct": None, "classificacao": "SEM LEITURA"},
            cores=[{"nome": "x", "comprimento_onda_nm": 0, "valor": 0, "porcentagem": 0.5} for _ in range(8)],
            diagnostico={"contaminacao_pct": 130},
        )

        payload = self.client.get(reverse("dashboard_data"), {"data": "2026-10-20"}).json()

        self.assertEqual(payload["suspeitas"], 1)
        self.assertEqual(payload["chart_data"], [])  # nao vira "99% de turbidez"
        self.assertEqual(payload["leituras"][0]["estado"], "Pouca luz")

    def test_rejects_an_invalid_date(self):
        response = self.client.get(reverse("dashboard_data"), {"data": "not-a-date"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("erro", response.json())
