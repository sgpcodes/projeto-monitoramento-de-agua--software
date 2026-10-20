import math
import statistics

from .serializers import CHANNELS


def calcular_metricas(leituras):
    ordered = sorted(leituras, key=lambda leitura: (leitura.medido_em, leitura.pk))
    calibracoes = {}
    metricas = {}
    medias_por_amostra = {}
    clear_por_amostra = {}

    for leitura in ordered:
        por_ganho = calibracoes.setdefault(leitura.ganho, {})
        if leitura.tipo in ("escuro", "branco"):
            por_ganho[leitura.tipo] = leitura
            metricas[leitura.pk] = {}
            continue

        branco = por_ganho.get("branco")
        escuro = por_ganho.get("escuro")
        absorbancia = {}
        transmissao = {}
        for canal in CHANNELS:
            if branco is None:
                transmissao[canal] = None
                absorbancia[canal] = None
                continue
            valor_escuro = escuro.media[canal] if escuro else 0
            amplitude = branco.media[canal] - valor_escuro
            if amplitude <= 0:
                transmissao[canal] = None
                absorbancia[canal] = None
                continue
            t = min(1.0, max(0.0, (leitura.media[canal] - valor_escuro) / amplitude))
            transmissao[canal] = t
            absorbancia[canal] = -math.log10(max(t, 1e-6))

        if (
            leitura.turbidez_mv is not None
            and leitura.turbidez_mv > 500
            and branco is not None
            and branco.turbidez_mv is not None
            and branco.turbidez_mv > 500
        ):
            turbidez = 1 - leitura.turbidez_mv / branco.turbidez_mv
        elif transmissao["f6_590"] is not None:
            turbidez = 1 - transmissao["f6_590"]
        else:
            turbidez = None

        entrada = {
            "transmissao": transmissao,
            "absorbancia": absorbancia,
            "turbidez": turbidez,
            "algas": _diferenca(absorbancia["f8_680"], absorbancia["f6_590"]),
            "cor": _diferenca(absorbancia["f1_415"], absorbancia["f5_555"]),
            "cianobacterias": _cianobacterias(absorbancia),
            "estabilidade_cv": None,
            "contaminacao": None,
        }
        metricas[leitura.pk] = entrada
        amostra = medias_por_amostra.setdefault(
            leitura.amostra, {canal: [] for canal in CHANNELS}
        )
        for canal, valor in absorbancia.items():
            if valor is not None:
                amostra[canal].append(valor)
        clear_por_amostra.setdefault(leitura.amostra, []).append(leitura.media["clear"])

    vetores_medios = {
        nome: {
            canal: statistics.fmean(valores) if valores else None
            for canal, valores in canais.items()
        }
        for nome, canais in medias_por_amostra.items()
    }
    referencia = vetores_medios.get("agua_podre")
    for leitura in ordered:
        dados = metricas[leitura.pk]
        if leitura.tipo != "amostra":
            continue
        clear_values = clear_por_amostra[leitura.amostra]
        if len(clear_values) > 1 and statistics.fmean(clear_values) != 0:
            dados["estabilidade_cv"] = (
                statistics.stdev(clear_values) / statistics.fmean(clear_values) * 100
            )
        vetor = vetores_medios[leitura.amostra]
        if referencia:
            canais_validos = [
                canal
                for canal in CHANNELS
                if vetor[canal] is not None and referencia[canal] is not None
            ]
            denominador = sum(referencia[canal] ** 2 for canal in canais_validos)
            if denominador > 0:
                nivel = sum(
                    vetor[canal] * referencia[canal] for canal in canais_validos
                ) / denominador
                dados["contaminacao"] = min(1.0, max(0.0, nivel))
    return metricas


def _diferenca(primeiro, segundo):
    if primeiro is None or segundo is None:
        return None
    return primeiro - segundo


def _cianobacterias(absorbancia):
    a630 = absorbancia["f7_630"]
    a590 = absorbancia["f6_590"]
    a680 = absorbancia["f8_680"]
    if a630 is None or a590 is None or a680 is None:
        return None
    return a630 - (a590 + a680) / 2
