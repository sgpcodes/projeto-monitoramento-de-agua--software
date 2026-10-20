import math
from datetime import date

from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.cache import never_cache

from .models import Coleta
from .serializers import CHANNELS
from .services import calcular_metricas


def dashboard(request):
    hoje = timezone.localdate()
    try:
        data_selecionada = date.fromisoformat(request.GET.get("data", hoje.isoformat()))
    except ValueError:
        data_selecionada = hoje

    coleta = Coleta.objects.filter(data_coleta=data_selecionada).first()
    leituras = list(coleta.leituras.order_by("medido_em", "pk")) if coleta else []
    metricas = calcular_metricas(leituras)
    painel = _dados_painel(data_selecionada, leituras, metricas)
    context = {
        "data_selecionada": data_selecionada,
        "coleta": coleta,
        "leituras": painel["leituras"],
        "amostras": sorted({leitura["amostra"] for leitura in painel["leituras"]}),
        "total_leituras": painel["total_leituras"],
        "total_amostras": painel["total_amostras"],
        "suspeitas": painel["suspeitas"],
        "ultima_leitura": leituras[-1] if leituras else None,
        "dashboard_data": painel,
    }
    return render(request, "aquamonitor/dashboard.html", context)


@never_cache
def dashboard_data(request):
    hoje = timezone.localdate()
    try:
        data_selecionada = date.fromisoformat(request.GET.get("data", hoje.isoformat()))
    except ValueError:
        return JsonResponse({"erro": "Data inválida."}, status=400)

    coleta = Coleta.objects.filter(data_coleta=data_selecionada).first()
    leituras = list(coleta.leituras.order_by("medido_em", "pk")) if coleta else []
    metricas = calcular_metricas(leituras)
    return JsonResponse(_dados_painel(data_selecionada, leituras, metricas))


def health(request):
    return JsonResponse({"status": "ok"})


# Referencias gravadas pelo ESP32: nao sao a agua da lagoa, ficam fora das series.
REFERENCIAS = {"agua_limpa", "agua_podre"}
NOMES_CORES = ["Violeta", "Azul", "Ciano", "Verde", "Verde-amarelo", "Amarelo", "Laranja", "Vermelho"]
INTERVALO_MIN = 10  # graficos do dia: media a cada 10 minutos
OFFLINE_MIN = 3  # sem leitura nova ha mais que isso: aparelho parado
SUSPEITA_PCT = 110  # mais luz que na agua limpa: luz de fora ou lanterna mexida
LUZ_FRACA = 1000  # canal CLEAR abaixo disso: sinal fraco demais (mesmo limite do ESP32)


def _porcentagens(leitura, metricas):
    """% de luz que passou em cada uma das 8 cores (100% = agua limpa)."""
    if leitura.cores:
        return [cor.get("porcentagem") for cor in leitura.cores[:8]]
    transmissao = metricas.get("transmissao") or {}
    return [
        None if transmissao.get(canal) is None else transmissao[canal] * 100
        for canal in CHANNELS[:8]
    ]


def _absorbancia(porcentagem):
    if porcentagem is None:
        return None
    return -math.log10(max(porcentagem, 0.1) / 100)


def _indices(leitura, metricas):
    """Os numeros que contam a historia da agua, nas mesmas contas do ESP32."""
    porcentagens = _porcentagens(leitura, metricas)
    absorb = [_absorbancia(p) for p in porcentagens]
    diagnostico = leitura.diagnostico or {}
    turbidez = leitura.turbidez or {}

    pouca_luz = (leitura.media or {}).get("clear") is not None and leitura.media["clear"] < LUZ_FRACA
    luz_bloqueada = turbidez.get("luz_bloqueada_pct")
    # So calcula pelas cores se o ESP32 nao mandou o campo (firmware antigo) e tem luz.
    if ("luz_bloqueada_pct" not in turbidez and not pouca_luz
            and porcentagens[5] is not None and porcentagens[6] is not None):
        # Mesma conta do ESP32: luz bloqueada no amarelo 590 e laranja 630 nm.
        fracao = math.sqrt(max(porcentagens[5], 0) / 100 * max(porcentagens[6], 0) / 100)
        luz_bloqueada = min(100.0, max(0.0, (1 - fracao) * 100))
    contaminacao = diagnostico.get("contaminacao_pct")
    if contaminacao is None and metricas.get("contaminacao") is not None:
        contaminacao = metricas["contaminacao"] * 100
    return {
        "porcentagens": porcentagens,
        "contaminacao": contaminacao,
        "turbidez": luz_bloqueada,
        "ntu": turbidez.get("ntu"),
        "absorbancia": absorb,
        "algas": _diferenca(absorb[7], absorb[5]),  # 680 - 590 nm: clorofila
        "cor": _diferenca(absorb[0], absorb[4]),  # 415 - 555 nm: materia organica
        # 630 nm: ficocianina (cianobacterias), descontando a media de 590 e 680 nm.
        "cianobacterias": (
            None
            if None in (absorb[5], absorb[6], absorb[7])
            else absorb[6] - (absorb[5] + absorb[7]) / 2
        ),
        "pouca_luz": pouca_luz,
        "suspeita": bool(leitura.saturado)
        or pouca_luz
        or any(p is not None and p > SUSPEITA_PCT for p in porcentagens),
    }


def _diferenca(a, b):
    return None if a is None or b is None else a - b


def _media(valores):
    valores = [v for v in valores if v is not None]
    return sum(valores) / len(valores) if valores else None


def _desvio(valores):
    valores = [v for v in valores if v is not None]
    if len(valores) < 2:
        return None
    media = sum(valores) / len(valores)
    return math.sqrt(sum((v - media) ** 2 for v in valores) / (len(valores) - 1))


def _estado(leitura, indices):
    if leitura.saturado:
        return "Saturada"
    if indices["pouca_luz"]:
        return "Pouca luz"
    return "Suspeita" if indices["suspeita"] else "Normal"


def _serie(lagoa):
    """Medias a cada 10 minutos das leituras validas da lagoa."""
    blocos = {}
    for leitura, indices in lagoa:
        if indices["suspeita"]:
            continue
        hora = timezone.localtime(leitura.medido_em)
        chave = hora.replace(minute=hora.minute - hora.minute % INTERVALO_MIN, second=0, microsecond=0)
        blocos.setdefault(chave, []).append(indices)
    return [
        {
            "hora": chave.strftime("%H:%M"),
            "medicoes": len(grupo),
            **{
                campo: _numero(_media([i[campo] for i in grupo]))
                for campo in ("contaminacao", "turbidez", "ntu", "algas", "cor")
            },
            "porcentagens": [
                _numero(_media([i["porcentagens"][c] for i in grupo])) for c in range(8)
            ],
        }
        for chave, grupo in sorted(blocos.items())
    ]


# Faixas dos indicadores (as mesmas do ESP32; cianobacterias e estimativa inicial).
FAIXAS = {
    "particulas": (15, 35),
    "materia_organica": (0.03, 0.10),
    "algas": (0.02, 0.08),
    "cianobacterias": (0.02, 0.06),
}


def _nivel(valor, faixa):
    if valor is None:
        return None
    return "Baixo" if valor < faixa[0] else "Moderado" if valor < faixa[1] else "Alto"


def _componentes(indices):
    valores = {
        "particulas": indices["turbidez"],
        "materia_organica": indices["cor"],
        "algas": indices["algas"],
        "cianobacterias": indices["cianobacterias"],
    }
    textos = {
        "particulas": ("Partículas suspensas (turbidez)", "luz bloqueada em 590–630 nm", "%"),
        "materia_organica": ("Matéria orgânica dissolvida", "absorção extra no violeta 415 nm (vs. 555 nm)", ""),
        "algas": ("Pigmentos de algas (clorofila)", "absorção extra no vermelho 680 nm (vs. 590 nm)", ""),
        "cianobacterias": ("Pigmentos de cianobactérias", "absorção extra no laranja 630 nm (ficocianina)", ""),
    }
    return [
        {
            "id": chave,
            "nome": textos[chave][0],
            "como": textos[chave][1],
            "unidade": textos[chave][2],
            "valor": _numero(valores[chave]),
            "nivel": _nivel(valores[chave], FAIXAS[chave]),
        }
        for chave in ("particulas", "materia_organica", "algas", "cianobacterias")
    ]


def _observacoes(serie, atual_indices, suspeitas, minutos_sem_enviar):
    """Frases tiradas dos dados (regras simples, sem chute)."""
    obs = []
    if minutos_sem_enviar is not None and minutos_sem_enviar > OFFLINE_MIN:
        obs.append(f"O aparelho está sem enviar há {minutos_sem_enviar} minutos: confira energia e Wi-Fi.")
    if atual_indices:
        pct = [p for p in atual_indices["porcentagens"] if p is not None]
        contam = atual_indices["contaminacao"]
        if pct and max(pct) < 5:
            obs.append("Quase não passa luz em nenhuma cor (menos de 5%): confira se a lanterna está acesa "
                       "e alinhada, ou regrave a água limpa. As análises abaixo não valem até isso ser resolvido.")
        elif contam is not None and contam > 100:
            obs.append(f"Contaminação acima de 100% ({contam:.0f}%): a amostra bloqueia mais luz que a água suja "
                       "de referência. Confira a lanterna ou regrave as referências.")
    com_contam = [p for p in serie if p["contaminacao"] is not None]
    if len(com_contam) >= 2:
        recente = com_contam[-1]
        alvo = recente["hora"]
        h, m = map(int, alvo.split(":"))
        limite = h * 60 + m - 360  # 6 horas antes
        antigo = next((p for p in com_contam if int(p["hora"][:2]) * 60 + int(p["hora"][3:]) >= limite), com_contam[0])
        delta = recente["contaminacao"] - antigo["contaminacao"]
        if abs(delta) >= 5:
            sentido = "subiu" if delta > 0 else "caiu"
            obs.append(f"A contaminação {sentido} {abs(delta):.0f} pontos desde as {antigo['hora']} "
                       f"(de {antigo['contaminacao']:.0f}% para {recente['contaminacao']:.0f}%).")
        else:
            obs.append(f"A contaminação está estável em torno de {recente['contaminacao']:.0f}% desde as {antigo['hora']}.")
    if atual_indices:
        for comp in _componentes(atual_indices):
            if comp["nivel"] in ("Moderado", "Alto") and comp["id"] != "particulas":
                obs.append(f"{comp['nome']}: nível {comp['nivel'].lower()}, pela {comp['como']}.")
        turb = atual_indices["turbidez"]
        if turb is not None:
            obs.append(f"Turbidez: {turb:.0f}% da luz bloqueada pelas partículas "
                       f"(nível {_nivel(turb, FAIXAS['particulas']).lower()}).")
    if suspeitas:
        obs.append(f"{suspeitas} leituras suspeitas hoje (pouca luz no sensor, sensor estourado ou luz de fora) ficaram fora dos gráficos.")
    return obs


def _dados_painel(data_selecionada, leituras, metricas):
    indices = {leitura.pk: _indices(leitura, metricas[leitura.pk]) for leitura in leituras}
    amostras = [leitura for leitura in leituras if leitura.tipo == "amostra"]
    lagoa = [
        (leitura, indices[leitura.pk])
        for leitura in amostras
        if leitura.amostra not in REFERENCIAS
    ]
    serie = _serie(lagoa)

    # Ultima leitura valida da lagoa: e ela que aparece no diagnostico e no espectro.
    validas = [(leitura, i) for leitura, i in lagoa if not i["suspeita"]]
    atual, atual_indices = (validas or lagoa or [(None, None)])[-1]

    espectro = None
    live = None
    diagnostico = None
    turbidez = None
    amostra_atual = None
    if atual:
        porcentagens = atual_indices["porcentagens"]
        rotulos = [str(int(canal.split("_")[1])) for canal in CHANNELS[:8]]
        etiquetas = [c.get("nome") for c in atual.cores[:8]] if atual.cores else NOMES_CORES
        if all(p is not None for p in porcentagens):
            espectro = {
                "rotulos": rotulos,
                "etiquetas": etiquetas,
                "unidade": "% de luz que passou",
                "semanas": [
                    {
                        "data": data_selecionada.isoformat(),
                        "valores": [_numero(p) for p in porcentagens],
                        "porcentagens": [_numero(p) for p in porcentagens],
                    }
                ],
                "contagens": [_numero(atual.media[canal]) for canal in CHANNELS[:8]],
                "absorbancia": [_numero(a) for a in atual_indices["absorbancia"]],
            }
        live = {
            "rotulos": rotulos,
            "valores": [_numero(atual.media[canal]) for canal in CHANNELS[:8]],
            "porcentagens": [None if p is None else round(p) for p in porcentagens],
        }
        diagnostico = atual.diagnostico
        turbidez = {
            **(atual.turbidez or {}),
            "luz_bloqueada_pct": _numero(atual_indices["turbidez"]),
        }
        amostra_atual = {
            "nome": atual.amostra,
            "hora": timezone.localtime(atual.medido_em).strftime("%H:%M:%S"),
            "suspeita": atual_indices["suspeita"],
        }

    # Comparativo de canais: leitura atual x media do dia (lagoa, leituras validas).
    canais = None
    if atual:
        nomes = list(CHANNELS[:8]) + ["nir"]
        canais = {
            "rotulos": [str(int(c.split("_")[1])) for c in CHANNELS[:8]] + ["NIR"],
            "atual": [_numero(atual.media.get(c)) for c in nomes],
            "desvio": [_numero((atual.desvio or {}).get(c)) for c in nomes],
            "media_dia": [_numero(_media([l.media.get(c) for l, _ in validas])) for c in nomes],
            "desvio_dia": [_numero(_desvio([l.media.get(c) for l, _ in validas])) for c in nomes],
            "medicoes_dia": len(validas),
        }

    minutos_sem_enviar = None
    if leituras and data_selecionada == timezone.localdate():
        minutos_sem_enviar = int((timezone.now() - leituras[-1].medido_em).total_seconds() // 60)

    return {
        "data": data_selecionada.isoformat(),
        "atualizado_em": timezone.localtime().isoformat(),
        "total_leituras": len(leituras),
        "total_amostras": len({leitura.amostra for leitura in amostras}),
        "suspeitas": sum(indices[leitura.pk]["suspeita"] for leitura in leituras),
        "estouradas": sum(leitura.saturado for leitura in leituras),
        "ultima_leitura": (
            timezone.localtime(leituras[-1].medido_em).strftime("%H:%M")
            if leituras
            else None
        ),
        "minutos_sem_enviar": minutos_sem_enviar,
        "aparelho_parado": minutos_sem_enviar is not None and minutos_sem_enviar > OFFLINE_MIN,
        "leituras": [
            {
                "hora": timezone.localtime(leitura.medido_em).strftime("%H:%M:%S"),
                "amostra": leitura.amostra,
                "tipo": leitura.tipo,
                "tipo_display": leitura.tipo,
                "contaminacao": _numero(indices[leitura.pk]["contaminacao"]),
                "turbidez": _numero(indices[leitura.pk]["turbidez"]),
                "turbidez_classe": (leitura.diagnostico or {}).get("turbidez"),
                "estado": _estado(leitura, indices[leitura.pk]),
                "saturado": leitura.saturado,
            }
            for leitura in reversed(leituras[-60:])
        ],
        # Turbidez do dia (sensor de cor, % de luz bloqueada em 590-630 nm).
        "chart_data": [
            {"hora": ponto["hora"], "amostra": "lagoa", "turbidez": ponto["turbidez"]}
            for ponto in serie
            if ponto["turbidez"] is not None
        ],
        "serie": serie,
        # Validacao: sensor de cor x sensor de turbidez, leitura a leitura.
        "comparacao": [
            {
                "hora": timezone.localtime(leitura.medido_em).strftime("%H:%M"),
                "turbidez": _numero(i["turbidez"]),
                "ntu": _numero(i["ntu"]),
            }
            for leitura, i in validas[-300:]
            if i["turbidez"] is not None and i["ntu"] is not None
        ],
        "amostra_atual": amostra_atual,
        "canais": canais,
        "componentes": _componentes(atual_indices) if atual else [],
        "observacoes": _observacoes(
            serie,
            atual_indices if atual else None,
            sum(indices[leitura.pk]["suspeita"] for leitura in leituras),
            minutos_sem_enviar,
        ),
        "diagnostico": diagnostico,
        "turbidez": turbidez,
        "espectro": espectro,
        "live": live,
    }


def _numero(valor):
    return round(valor, 4) if valor is not None else None
