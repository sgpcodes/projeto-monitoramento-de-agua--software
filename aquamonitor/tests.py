from datetime import date, datetime, timedelta

from django.test import TestCase, override_settings
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
        self.assertEqual(niveis["turbidez"], "Alto")  # 40% bloqueada (acima de 35%)
        self.assertEqual(niveis["clorofila"], "Moderado")  # indice 0,079 (entre 0,05 e 0,20)
        self.assertEqual(len(payload["componentes"]), 5)
        q = payload["qualidade"]
        self.assertTrue(q["valida"])
        self.assertTrue(0 <= q["indice_geral"] <= 100)
        self.assertIn(q["status"], ("bom", "atenção", "alerta"))
        self.assertTrue(q["cor"]["hex"].startswith("#"))
        self.assertEqual(payload["leituras"][1]["indice_geral"], q["indice_geral"])
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

    def test_dilution_series_and_history(self):
        collection = Coleta.objects.create(data_coleta=timezone.localdate())
        for i, (conc, pct) in enumerate([(25, 80), (50, 64), (100, 41)]):
            Leitura.objects.create(
                collection=collection, tipo="amostra", amostra=f"dil_cafe_{conc}", led="frente", replica=1,
                medido_em=timezone.now() - timedelta(minutes=10 - i), ganho=64, atime=0, astep=0, n=1,
                saturado=False, media={channel: 20000 for channel in CHANNELS}, desvio={}, dados_originais={},
                turbidez={}, cores=[{"porcentagem": pct} for _ in range(8)], diagnostico={},
            )
        Leitura.objects.create(
            collection=collection, tipo="amostra", amostra="lagoa", led="frente", replica=1,
            medido_em=timezone.now(), ganho=64, atime=0, astep=0, n=1, saturado=False,
            media={channel: 20000 for channel in CHANNELS}, desvio={}, dados_originais={},
            turbidez={"ntu": 12.0, "tensao_v": 4.0}, cores=[{"porcentagem": 70} for _ in range(8)], diagnostico={},
        )

        payload = self.client.get(reverse("dashboard_data")).json()
        dil = payload["diluicao"][0]
        self.assertEqual(dil["corante"], "cafe")
        self.assertGreater(dil["r2"], 0.95)  # A = -log10(T) cresce quase em linha reta

        hist = self.client.get(reverse("historico")).json()["historico"]
        self.assertEqual(hist[-1]["medicoes"], 1)  # so a lagoa (diluicoes ficam fora)
        self.assertEqual(hist[-1]["ntu"], 12.0)

    def test_samples_like_the_design(self):
        collection = Coleta.objects.create(data_coleta=timezone.localdate())
        def medir(nome, pct, tipo="amostra", ntu=10.0, minutos=0):
            Leitura.objects.create(
                collection=collection, tipo=tipo, amostra=nome, led="frente", replica=1,
                medido_em=timezone.now() - timedelta(minutes=minutos), ganho=64, atime=0, astep=0, n=1, saturado=False,
                media={channel: 20000 for channel in CHANNELS}, desvio={}, dados_originais={},
                turbidez={"ntu": ntu, "tensao_v": 4.0}, cores=[{"porcentagem": p} for p in pct], diagnostico={},
            )
        medir("agua_limpa", [100] * 8, tipo="branco", ntu=0.2)
        for i in range(3):
            medir("lagoa_p2", [40, 35, 60, 75, 76, 62, 58, 52], ntu=68.0 + i, minutos=i)
        medir("agua_podre", [8, 10, 13, 16, 20, 24, 29, 31], ntu=145.0)
        medir("ref_algas", [45, 38, 62, 74, 75, 64, 60, 48], ntu=35.0)

        d = self.client.get(reverse("amostras")).json()
        ids = [a["id"] for a in d["amostras"]]
        self.assertEqual(ids[0], "agua_limpa")  # o branco vem primeiro
        p2 = next(a for a in d["amostras"] if a["id"] == "lagoa_p2")
        self.assertEqual(p2["nome"], "Lagoa – Ponto 2")
        self.assertEqual(p2["repeticoes"], 3)
        self.assertAlmostEqual(p2["turbidez_ntu"], 69.0)
        self.assertEqual(p2["referencia_mais_semelhante"], "Água esverdeada (algas)")
        self.assertIn("Status:", p2["conclusao"])
        self.assertEqual(d["padrao"], "lagoa_p2")
        self.assertIn("agua_podre", d["comparacao"])

    @override_settings(STORAGES={
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    })
    def test_pages_open(self):
        for nome, texto in [("dashboard", "Assinatura espectral atual"), ("pagina_amostras", "Semelhança com as referências"),
                            ("pagina_historico", "Registros recebidos"), ("pagina_guia", "Como interpretar")]:
            resposta = self.client.get(reverse(nome))
            self.assertEqual(resposta.status_code, 200, nome)
            self.assertContains(resposta, texto)
            self.assertContains(resposta, 'class="nav-link is-active"')

    def test_rejects_an_invalid_date(self):
        response = self.client.get(reverse("dashboard_data"), {"data": "not-a-date"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("erro", response.json())
