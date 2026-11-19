from datetime import date, datetime, timedelta

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from django.core.files.uploadedfile import SimpleUploadedFile

from . import laboratorio
from .models import AnaliseLaboratorio, Coleta, Leitura
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
        leitura(5, [150, 40, 30, 25, 40, 36, 43, 150], saturado=True)  # luz de fora (no meio)

        payload = self.client.get(reverse("dashboard_data"), {"data": "2026-10-20"}).json()

        self.assertEqual(payload["diagnostico"]["contaminacao_pct"], 35)
        self.assertEqual(payload["turbidez"]["luz_bloqueada_pct"], 40.0)
        self.assertEqual(payload["amostra_atual"]["hora"], "10:15:00")
        self.assertEqual(payload["espectro"]["unidade"], "% de luz que passou")
        self.assertEqual(payload["espectro"]["semanas"][0]["valores"][0], 60)
        self.assertEqual(payload["suspeitas"], 1)
        self.assertEqual([p["hora"] for p in payload["serie"]], ["10:00", "10:10"])
        self.assertAlmostEqual(payload["serie"][0]["contaminacao"], 35)
        self.assertGreater(payload["serie"][0]["algas"], 0.07)  # A680 - A590 com 50% e 60%
        self.assertEqual(payload["leituras"][1]["estado"], "Saturada")
        niveis = {c["id"]: c["nivel"] for c in payload["componentes"]}
        self.assertEqual(niveis["turbidez"], "Alto")  # 40% bloqueada (acima de 35%)
        self.assertEqual(niveis["clorofila"], "Moderado")  # indice 0,079 (entre 0,05 e 0,20)
        self.assertEqual(len(payload["componentes"]), 5)
        q = payload["qualidade"]
        self.assertTrue(q["valida"])
        self.assertTrue(0 <= q["indice_geral"] <= 100)
        self.assertIn(q["status"], ("bom", "atenção", "alerta"))
        self.assertTrue(q["cor"]["hex"].startswith("#"))
        self.assertEqual(payload["leituras"][0]["indice_geral"], q["indice_geral"])
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
        for nome, texto in [("dashboard", "Quanta luz de cada cor atravessa a água"), ("pagina_amostras", "Aparelho × laboratório"),
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

    def _leitura_cores(self, pct, turbidez, minutos=0):
        collection, _ = Coleta.objects.get_or_create(data_coleta=timezone.localdate())
        return Leitura.objects.create(
            collection=collection, tipo="amostra", amostra="lagoa", led="frente", replica=1,
            medido_em=timezone.now() - timedelta(minutes=minutos), ganho=64, atime=0, astep=0, n=1, saturado=False,
            media={channel: 20000 for channel in CHANNELS}, desvio={}, dados_originais={},
            turbidez=turbidez, cores=[{"porcentagem": p} for p in pct], diagnostico={},
        )

    def test_sensors_disagreeing_flags_a_light_change(self):
        limpa = {"status": "fora_da_faixa_da_curva", "tensao_v": 4.22, "ntu": None, "ntu_experimental": None,
                 "calibracao_status": "pendente"}
        self._leitura_cores([67, 69, 69, 68, 68, 69, 67, 67], limpa)  # queda plana de ~32%
        d = self.client.get(reverse("dashboard_data")).json()
        self.assertIn("lanterna", d["qualidade"]["alerta"])
        self.assertIn("discordam", d["observacoes"][0])
        self.assertFalse(any(o.startswith(("Turbidez:", "Sedimentos:")) for o in d["observacoes"]))

    def test_strong_light_change_is_kept_out_of_the_charts(self):
        limpa = {"status": "ok", "tensao_v": 4.15, "ntu": None, "ntu_experimental": 200.0, "calibracao_status": "pendente"}
        self._leitura_cores([2, 2, 2, 2, 2, 2, 2, 2], limpa)  # 98% por igual com turbidez "limpa"
        d = self.client.get(reverse("dashboard_data")).json()
        self.assertEqual(d["suspeitas"], 1)
        self.assertEqual(d["leituras"][0]["estado"], "Luz mudou")
        self.assertEqual(d["serie"], [])

    def test_invalid_latest_reading_keeps_the_last_valid_one_with_a_warning(self):
        limpa = {"status": "ok", "tensao_v": 4.15, "ntu": None, "ntu_experimental": 200.0, "calibracao_status": "pendente"}
        self._leitura_cores([67, 69, 69, 68, 68, 69, 67, 67], limpa, minutos=2)
        self._leitura_cores([11, 11, 12, 11, 11, 12, 11, 11], limpa, minutos=1)  # amostra caiu: luz caiu ~89%
        self._leitura_cores([11, 11, 12, 11, 11, 12, 11, 11], limpa)
        d = self.client.get(reverse("dashboard_data")).json()
        self.assertFalse(d["amostra_atual"]["suspeita"])  # o painel nao esvazia
        self.assertTrue(d["qualidade"]["valida"])
        self.assertEqual(d["live"]["porcentagens"][0], 67)  # dados da ultima medicao valida
        self.assertEqual(d["congelada"]["motivo"], "luz mudou")
        self.assertIn("inválidas", d["aviso_congelado"])
        self.assertIn(d["congelada"]["desde"], d["aviso_congelado"])

    def test_disconnected_device_keeps_the_last_reading_on_screen(self):
        limpa = {"status": "ok", "tensao_v": 4.15, "ntu": None, "ntu_experimental": 200.0, "calibracao_status": "pendente"}
        self._leitura_cores([67, 69, 69, 68, 68, 69, 67, 67], limpa, minutos=90)
        d = self.client.get(reverse("dashboard_data")).json()
        self.assertTrue(d["aparelho_parado"])
        self.assertTrue(d["qualidade"]["valida"])
        self.assertIn("desconectado", d["aviso_congelado"])
        self.assertIn("1 h 30 min", d["aviso_congelado"])

    def test_new_day_without_readings_shows_the_last_collection(self):
        ontem = timezone.localdate() - timedelta(days=1)
        coleta = Coleta.objects.create(data_coleta=ontem)
        Leitura.objects.create(
            collection=coleta, tipo="amostra", amostra="lagoa", led="frente", replica=1,
            medido_em=timezone.now() - timedelta(days=1), ganho=64, atime=0, astep=0, n=1, saturado=False,
            media={channel: 20000 for channel in CHANNELS}, desvio={}, dados_originais={},
            turbidez={}, cores=[{"porcentagem": 70} for _ in range(8)], diagnostico={},
        )
        d = self.client.get(reverse("dashboard_data")).json()
        self.assertEqual(d["data"], timezone.localdate().isoformat())  # a pagina continua sendo a de hoje
        self.assertEqual(d["dados_de"], ontem.isoformat())
        self.assertEqual(d["total_leituras"], 1)
        self.assertIn("desconectado", d["aviso_congelado"])
        # Uma data antiga escolhida a mao continua mostrando so aquela data.
        vazia = self.client.get(reverse("dashboard_data"), {"data": "2026-01-01"}).json()
        self.assertEqual(vazia["total_leituras"], 0)

    def test_dissolved_color_is_not_mistaken_for_a_light_change(self):
        limpa = {"status": "ok", "tensao_v": 4.15, "ntu": None, "ntu_experimental": 200.0, "calibracao_status": "pendente"}
        self._leitura_cores([10, 25, 35, 45, 55, 62, 70, 75], limpa)  # cha: muito mais queda no violeta
        d = self.client.get(reverse("dashboard_data")).json()
        self.assertEqual(d["suspeitas"], 0)
        self.assertNotIn("lanterna", d["qualidade"]["alerta"])

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

    def test_esp32_payload_with_ph_is_saved_and_shown(self):
        payload = {
            "data_coleta": "2026-11-17", "medido_em": "2026-11-17T10:00:00-03:00", "tipo": "amostra",
            "amostra": "lagoa", "firmware_version": "2026.11.17-ph-v1", "ganho": 64, "saturado": False,
            "media": {channel: 20000 for channel in CHANNELS},
            "turbidez": {"status": "ok", "tensao_v": 3.69, "luz_bloqueada_pct": 12.0},
            "ph": {"status": "ok", "calibracao_status": "2_pontos", "adc_raw": 1480, "tensao_v": 2.536,
                   "desvio_mv": 4, "valor": 6.8, "classificacao": "NORMAL"},
            "cores": [{"nome": "x", "comprimento_onda_nm": nm, "valor": 1, "porcentagem": 70}
                      for nm in (415, 445, 480, 515, 555, 590, 630, 680)],
            "diagnostico": {"turbidez": "LEVEMENTE TURVA", "ph": "NORMAL"},
        }
        import os
        os.environ["ESP32_API_KEY"] = "chave-teste"
        r = self.client.post(reverse("receber_leitura"), payload, content_type="application/json",
                             HTTP_X_API_KEY="chave-teste")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Leitura.objects.get().ph["adc_raw"], 1480)
        d = self.client.get(reverse("dashboard_data"), {"data": "2026-11-17"}).json()
        self.assertEqual(d["ph"]["valor"], 6.8)
        self.assertEqual(d["ph"]["classificacao"], "NORMAL")
        self.assertEqual(d["leituras"][0]["ph"], 6.8)

    def test_invalid_ph_reading_is_not_shown_as_a_value(self):
        Leitura.objects.create(
            collection=Coleta.objects.create(data_coleta=timezone.localdate()), tipo="amostra", amostra="lagoa",
            led="frente", replica=1, medido_em=timezone.now(), ganho=64, atime=100, astep=999, n=20, saturado=False,
            media={c: 20000 for c in CHANNELS}, desvio={c: 1 for c in CHANNELS}, dados_originais={},
            ph={"status": "sem_sinal", "valor": None, "tensao_v": 0.1, "calibracao_status": "pendente"},
        )
        d = self.client.get(reverse("dashboard_data")).json()
        self.assertIsNone(d["ph"]["valor"])
        self.assertEqual(d["ph"]["status"], "sem_sinal")

    def test_rejects_an_invalid_date(self):
        response = self.client.get(reverse("dashboard_data"), {"data": "not-a-date"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("erro", response.json())


class LaboratorioTests(TestCase):
    """Laudo de laboratorio em TXT: modelo, leitura e comparacao com o aparelho."""

    def _medir(self, nome, pct, turbidez, ph=None, tipo="amostra"):
        coleta, _ = Coleta.objects.get_or_create(data_coleta=timezone.localdate())
        for i in range(1 if tipo == "branco" else 3):
            Leitura.objects.create(
                collection=coleta, tipo=tipo, amostra=nome, led="frente", replica=i + 1,
                medido_em=timezone.now() - timedelta(minutes=i + (10 if tipo == "branco" else 0)), ganho=64, atime=0, astep=0, n=1,
                saturado=False, media={c: 20000 for c in CHANNELS}, desvio={}, dados_originais={},
                turbidez=turbidez, ph=ph, cores=[{"porcentagem": p} for p in pct], diagnostico={},
            )

    def _enviar(self, texto, **extra):
        arquivo = SimpleUploadedFile("laudo.txt", texto.encode("utf-8"), content_type="text/plain")
        return self.client.post(reverse("enviar_laboratorio"), {"arquivo": arquivo, **extra})

    def test_template_is_filled_with_the_sample_and_reads_back(self):
        resposta = self.client.get(reverse("modelo_laboratorio"), {"amostra": "lagoa_p1"})
        self.assertEqual(resposta.status_code, 200)
        self.assertIn('filename="laudo-lagoa_p1.txt"', resposta["Content-Disposition"])
        texto = resposta.content.decode()
        self.assertIn("amostra = lagoa_p1", texto)
        with self.assertRaisesMessage(ValueError, "Nenhum resultado"):
            laboratorio.ler(texto)  # modelo em branco: falta preencher
        dados, avisos = laboratorio.ler(texto.replace("turbidez_ntu = ", "turbidez_ntu = 12,5 NTU")
                                        .replace("cianobacterias_cel_ml = ", "cianobacterias_cel_ml = 50.000"))
        self.assertEqual(dados["turbidez_ntu"], 12.5)
        self.assertEqual(dados["cianobacterias_cel_ml"], 50000)
        self.assertEqual(avisos, [])

    def test_errors_point_to_the_line(self):
        with self.assertRaisesMessage(ValueError, "Linha 2 (ph)"):
            laboratorio.ler("amostra = lagoa_p1\nph = abc")
        with self.assertRaisesMessage(ValueError, "Falta o nome da amostra"):
            laboratorio.ler("ph = 7")
        resposta = self._enviar("amostra = lagoa_p1\nph = 15")
        self.assertEqual(resposta.status_code, 400)
        self.assertIn("pH", resposta.json()["erro"])

    def test_upload_compares_with_the_device(self):
        self._medir("agua_limpa", [100] * 8, {"ntu": None}, tipo="branco")
        sensor = {"tensao_v": 4.0, "status": "ok", "calibracao_status": "pendente", "ntu_experimental": 30.0}
        self._medir("lagoa_p1", [40, 35, 60, 75, 76, 62, 58, 52], sensor, ph={"valor": 7.2, "status": "ok"})
        hoje = timezone.localdate().strftime("%d/%m/%Y")
        texto = (f"amostra = lagoa_p1\ndata_coleta = {hoje}\nlaboratorio = Lab Teste\nturbidez_ntu = 25\n"
                 "ph = 7,0\nclorofila_a_ug_l = 45\ncampo_estranho = 1\n")
        resposta = self._enviar(texto)
        self.assertEqual(resposta.status_code, 201, resposta.content)
        self.assertTrue(any("campo_estranho" in a for a in resposta.json()["avisos"]))
        self._enviar(texto.replace("turbidez_ntu = 25", "turbidez_ntu = 28"))  # mesmo dia: substitui
        self.assertEqual(AnaliseLaboratorio.objects.count(), 1)

        p1 = next(a for a in self.client.get(reverse("amostras")).json()["amostras"] if a["id"] == "lagoa_p1")
        self.assertAlmostEqual(p1["ph"], 7.2)
        self.assertEqual(len(p1["porcentagens"]), 8)
        lab = p1["laboratorio"]
        linhas = {l["id"]: l for l in lab["linhas"]}
        self.assertEqual(linhas["turbidez_ntu"]["laboratorio"], 28)
        self.assertEqual(linhas["turbidez_ntu"]["aparelho"], 30.0)  # estimativa da curva
        self.assertTrue(linhas["turbidez_ntu"]["concorda"])  # os dois ate 40 NTU (classe 1)
        self.assertIn("ponto de calibração", linhas["turbidez_ntu"]["nota"])
        self.assertTrue(linhas["ph"]["concorda"])  # 7,2 x 7,0
        self.assertEqual(linhas["clorofila_a_ug_l"]["nivel_laboratorio"], "alto")  # acima de 30 ug/L
        self.assertIsNone(lab["aviso_data"])
        self.assertIn("parâmetros com o mesmo resultado", lab["resumo"])

    def test_upload_for_unknown_sample_warns(self):
        resposta = self._enviar("ph = 7", amostra="lagoa_p9")  # sem "amostra =": usa a selecionada
        self.assertEqual(resposta.status_code, 201)
        self.assertEqual(resposta.json()["amostra"], "lagoa_p9")
        self.assertIn("Ainda não há medição", resposta.json()["avisos"][0])
