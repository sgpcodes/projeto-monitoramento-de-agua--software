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
            turbidez={"ntu": 12.0, "tensao_v": 4.0, "status": "ok", "calibracao_status": "validada", "calibracao_id": "teste-v1"},
            cores=[{"porcentagem": 70} for _ in range(8)], diagnostico={},
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
        self.assertIsNone(p2["turbidez_ntu"])  # NTU de firmware antigo: estimativa, nao validado
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

    def test_rerecording_a_standard_replaces_it(self):
        collection = Coleta.objects.create(data_coleta=timezone.localdate())
        def gravar(nome, pct, tipo, minutos):
            Leitura.objects.create(
                collection=collection, tipo=tipo, amostra=nome, led="frente", replica=1,
                medido_em=timezone.now() - timedelta(minutes=minutos), ganho=64, atime=0, astep=0, n=1, saturado=False,
                media={channel: 20000 for channel in CHANNELS}, desvio={}, dados_originais={},
                turbidez={"ntu": None}, cores=[{"porcentagem": p} for p in pct], diagnostico={},
            )
        gravar("agua_limpa", [100] * 8, "branco", 30)
        gravar("agua_podre", [50] * 8, "amostra", 29)  # padrao antigo
        gravar("agua_limpa", [100] * 8, "branco", 5)
        gravar("agua_podre", [10] * 8, "amostra", 4)  # regravado: substitui
        gravar("lagoa", [70] * 8, "amostra", 1)

        d = self.client.get(reverse("amostras")).json()
        podre = next(a for a in d["amostras"] if a["id"] == "agua_podre")
        self.assertEqual(podre["repeticoes"], 1)
        self.assertAlmostEqual(podre["absorbancia"][0], 1.0)  # so a gravacao nova (10%)
        self.assertEqual(d["comparacao"], ["agua_limpa", "agua_podre", "lagoa"])

    def _leitura_turbidez(self, turbidez, minutos=0, extra=None):
        collection, _ = Coleta.objects.get_or_create(data_coleta=timezone.localdate())
        return Leitura.objects.create(
            collection=collection, tipo="amostra", amostra="lagoa", led="frente", replica=1,
            medido_em=timezone.now() - timedelta(minutes=minutos), ganho=64, atime=0, astep=0, n=1, saturado=False,
            media={channel: 20000 for channel in CHANNELS}, desvio={}, dados_originais=extra or {},
            turbidez=turbidez, cores=[{"porcentagem": 70} for _ in range(8)], diagnostico={},
        )

    def test_turbidity_ntu_only_counts_when_calibration_is_validated(self):
        pendente = {"ntu": None, "ntu_experimental": 1593.0, "tensao_v": 3.69, "adc_raw": 2290, "desvio_mv": 8,
                    "status": "ok", "calibracao_status": "pendente", "calibracao_id": "dfrobot-sen0189-fabricante-v1"}
        self._leitura_turbidez(pendente, extra={"firmware_version": "2026.10.21-turbidez-v2"})

        d = self.client.get(reverse("dashboard_data")).json()
        self.assertIsNone(d["qualidade"]["ntu"])  # nao vira NTU validado
        sensor = d["sensor_turbidez"]
        self.assertEqual(sensor["estado_leitura"], "experimental")
        self.assertEqual(sensor["calibracao_status"], "pendente")
        self.assertEqual(sensor["ntu_experimental"], 1593.0)
        self.assertEqual(sensor["adc_raw"], 2290)
        self.assertEqual(sensor["firmware_version"], "2026.10.21-turbidez-v2")
        self.assertEqual(d["leituras"][0]["tensao_v"], 3.69)
        self.assertEqual(d["serie"][0]["tensao_v"], 3.69)

    def test_invalid_turbidity_reading_is_not_turned_into_zero(self):
        self._leitura_turbidez({"ntu": None, "ntu_experimental": None, "tensao_v": 0.2, "status": "sem_sinal",
                                "calibracao_status": "pendente"})
        d = self.client.get(reverse("dashboard_data")).json()
        self.assertEqual(d["sensor_turbidez"]["estado_leitura"], "invalida")
        self.assertIsNone(d["qualidade"]["ntu"])
        self.assertIsNone(d["serie"][0]["tensao_v"])  # leitura com defeito nao entra na serie

    def test_voltage_beyond_the_curve_becomes_a_limit_not_a_gap(self):
        self._leitura_turbidez({"ntu": None, "ntu_experimental": None, "tensao_v": 4.24, "adc_raw": 2525, "desvio_mv": 34,
                                "status": "fora_da_faixa_da_curva", "calibracao_status": "pendente"})
        sensor = self.client.get(reverse("dashboard_data")).json()["sensor_turbidez"]
        self.assertEqual(sensor["estado_leitura"], "experimental")  # conta, nao some
        self.assertEqual(sensor["ntu_limite"], "<=")
        self.assertAlmostEqual(sensor["ntu_experimental"], 0.9, places=1)  # curva em 4,2 V
        self.assertIsNone(sensor["ntu"])  # continua sem NTU validado
        self.assertEqual(sensor["faixa_curva_ntu"], [0, 3000])

    def test_old_firmware_records_stay_readable_as_experimental(self):
        self._leitura_turbidez({"ntu": 868.0, "tensao_v": 3.94, "classificacao": "MUITO TURVA"})
        d = self.client.get(reverse("dashboard_data")).json()
        sensor = d["sensor_turbidez"]
        self.assertEqual(sensor["estado_leitura"], "experimental")
        self.assertEqual(sensor["ntu_experimental"], 868.0)
        self.assertIsNone(sensor["ntu"])
        self.assertIn("firmware antigo", sensor["firmware_version"])

    def test_esp32_payload_with_new_turbidity_fields_is_accepted(self):
        payload = {
            "data_coleta": "2026-10-21", "medido_em": "2026-10-21T12:30:00-03:00", "tipo": "amostra",
            "amostra": "lagoa", "firmware_version": "2026.10.21-turbidez-v2", "ganho": 64, "saturado": False,
            "media": {channel: 20000 for channel in CHANNELS},
            "turbidez": {"status": "ok", "calibracao_id": "dfrobot-sen0189-fabricante-v1", "calibracao_status": "pendente",
                         "adc_raw": 2290, "tensao_v": 3.69, "desvio_mv": 8, "ntu_experimental": 1593.0, "ntu": None,
                         "luz_bloqueada_pct": 12.0, "classificacao": "LEVEMENTE TURVA"},
            "cores": [{"nome": "x", "comprimento_onda_nm": 415, "valor": 1, "porcentagem": 70}],
            "diagnostico": {"turbidez": "LEVEMENTE TURVA"},
        }
        with self.settings():
            import os
            os.environ["ESP32_API_KEY"] = "chave-teste"
            r = self.client.post(reverse("receber_leitura"), payload, content_type="application/json",
                                 HTTP_X_API_KEY="chave-teste")
        self.assertEqual(r.status_code, 201)
        salva = Leitura.objects.get()
        self.assertEqual(salva.turbidez["adc_raw"], 2290)  # dado cru preservado
        self.assertEqual(salva.dados_originais["firmware_version"], "2026.10.21-turbidez-v2")

    def test_rejects_an_invalid_date(self):
        response = self.client.get(reverse("dashboard_data"), {"data": "not-a-date"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("erro", response.json())
