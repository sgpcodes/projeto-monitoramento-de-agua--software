import math
import re
from datetime import date, timedelta

from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.cache import never_cache

from . import qualidade
from .models import Coleta, Leitura
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


def _pagina(nome):
    """Paginas Amostras, Historico e Guia: os dados chegam pelo JavaScript."""
    def view(request):
        return render(request, f"aquamonitor/{nome}.html", {"data_selecionada": timezone.localdate()})
    return view


pagina_amostras = _pagina("amostras")
pagina_historico = _pagina("historico")
pagina_guia = _pagina("guia")


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


TENSAO_TRAVADA = 4.55  # V: acima disso o ADC do ESP32 travou no maximo (NTU nao vale)


def _ntu_valido(turbidez):
    """NTU so entra nas contas quando a calibracao do sensor foi VALIDADA e a leitura
    esta ok. Registros antigos (sem calibracao_status) tinham NTU pela curva do
    fabricante, nunca validada: continuam guardados, mas como estimativa experimental."""
    ntu, tensao = turbidez.get("ntu"), turbidez.get("tensao_v")
    if ntu is None or (tensao is not None and tensao >= TENSAO_TRAVADA):
        return None
    if turbidez.get("calibracao_status") != "validada" or turbidez.get("status", "ok") != "ok":
        return None
    return ntu


# Curva do fabricante usada no firmware (dfrobot-sen0189-fabricante-v1): NTU em funcao
# da tensao na saida do sensor (5 V). Vale de 2,5 V (~3000 NTU) a 4,2 V (~0 NTU).
CURVA_FABRICANTE = {"a": -1120.4, "b": 5742.3, "c": -4352.9, "min_v": 2.5, "max_v": 4.2}


def _ntu_da_curva(v):
    c = CURVA_FABRICANTE
    return max(0.0, c["a"] * v * v + c["b"] * v + c["c"])


def _sensor_turbidez(turbidez):
    """Estado do sensor de turbidez de uma leitura: dados crus, validacao e calibracao.
    estado_leitura: invalida (defeito/fora da faixa), experimental (calibracao pendente)
    ou calibrada. Firmware antigo nao mandava esses campos: vira "experimental"."""
    antigo = "calibracao_status" not in turbidez
    status = turbidez.get("status")
    if antigo:
        status = "ok" if turbidez.get("tensao_v") is not None else "sem_dado"
    validada = turbidez.get("calibracao_status") == "validada"
    tensao = turbidez.get("tensao_v")
    ntu_exp = turbidez.get("ntu_experimental", turbidez.get("ntu") if antigo else None)
    limite = turbidez.get("ntu_limite")
    # Fora da faixa da curva nao e defeito: e um valor alem do inicio/fim da curva.
    # Acima de 4,2 V a agua esta mais clara que o "0 NTU" da curva (<= ~1 NTU);
    # abaixo de 2,5 V esta mais turva que o fim da curva (>= ~3000 NTU).
    if status == "fora_da_faixa_da_curva" and tensao is not None:
        if tensao > CURVA_FABRICANTE["max_v"]:
            ntu_exp, limite = round(_ntu_da_curva(CURVA_FABRICANTE["max_v"]), 1), "<="
        elif tensao < CURVA_FABRICANTE["min_v"]:
            ntu_exp, limite = round(_ntu_da_curva(CURVA_FABRICANTE["min_v"]), 1), ">="
        status = "ok"
    if status != "ok":
        estado = "invalida"
    else:
        estado = "calibrada" if validada and turbidez.get("ntu") is not None else "experimental"
    return {
        "tensao_v": turbidez.get("tensao_v"),
        "adc_raw": turbidez.get("adc_raw"),
        "desvio_mv": turbidez.get("desvio_mv"),
        "status": status,
        "estado_leitura": estado,
        "calibracao_status": "validada" if validada else "pendente",
        "calibracao_id": turbidez.get("calibracao_id") or ("firmware antigo (curva do fabricante)" if antigo else None),
        # Firmware antigo mandava a estimativa no campo "ntu": aqui ela aparece como experimental.
        "ntu_experimental": ntu_exp,
        "ntu_limite": limite,  # "<=" ou ">=" quando passou do inicio/fim da curva
        "faixa_curva_ntu": [0, round(_ntu_da_curva(CURVA_FABRICANTE["min_v"]))],
        "ntu": turbidez.get("ntu") if validada else None,
    }


def _indices(leitura, metricas, branco=None):
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
        "ntu": _ntu_valido(turbidez),
        "sensor": _sensor_turbidez(turbidez),
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
        "qualidade": qualidade.indices(
            porcentagens, _ntu_valido(turbidez), qualidade.absorbancia_nir(leitura, branco)
        ),
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
            # Tensao do sensor de turbidez (so leituras sem defeito; nada inventado nas lacunas).
            "tensao_v": _numero(_media([
                i["sensor"]["tensao_v"] for i in grupo if i["sensor"]["estado_leitura"] != "invalida"
            ])),
        }
        for chave, grupo in sorted(blocos.items())
    ]


# Faixas dos indicadores (as mesmas do ESP32; cianobacterias e estimativa inicial).
FAIXAS = {"particulas": (15, 35)}  # % de luz bloqueada (sensor de cor), como no ESP32


def _nivel(valor, faixa):
    if valor is None:
        return None
    return "Baixo" if valor < faixa[0] else "Moderado" if valor < faixa[1] else "Alto"


COMO = {
    "turbidez": "partículas: luz bloqueada em 590–630 nm pelo sensor de cor",
    "clorofila": "absorção extra no vermelho 680 nm em relação ao amarelo 590 nm",
    "cianobacterias": "absorção extra no laranja 630 nm (ficocianina)",
    "materia_organica": "absorção extra no violeta 415 nm em relação ao verde 555 nm (cor de chá)",
    "sedimentos": "absorção no infravermelho (~910 nm): só partículas bloqueiam",
}


def _componentes(indices):
    """Os 5 indicadores do indice geral, com valor, intensidade (0-1) e nivel."""
    q = indices.get("qualidade")
    inten = qualidade.intensidades(q) or {}
    saida = []
    for chave in ("turbidez", "clorofila", "cianobacterias", "materia_organica", "sedimentos"):
        if chave == "turbidez":
            ntu = q["ntu"] if q else None
            valor, unidade = (ntu, "NTU") if ntu is not None else (indices["turbidez"], "%")
            nivel = qualidade.nivel(inten.get("turbidez"), "turbidez") if ntu is not None else _nivel(indices["turbidez"], FAIXAS["particulas"])
        else:
            valor, unidade = (q[chave] if q else None), ""
            nivel = qualidade.nivel(valor, chave)
        como = COMO[chave]
        if chave == "sedimentos" and valor is None:
            como += " — sem sinal: a lanterna emite pouco infravermelho"
        saida.append({
            "id": chave,
            "nome": qualidade.NOMES_INDICES[chave],
            "como": como,
            "unidade": unidade,
            "valor": _numero(valor),
            "intensidade": _numero(inten.get(chave)),
            "nivel": nivel,
            "peso": qualidade.PESOS[chave],
        })
    return saida


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
            if comp["nivel"] in ("Moderado", "Alto") and comp["id"] != "turbidez":
                obs.append(f"{comp['nome']}: nível {comp['nivel'].lower()}, pela {comp['como']}.")
        turb = atual_indices["turbidez"]
        if turb is not None:
            obs.append(f"Turbidez: {turb:.0f}% da luz bloqueada pelas partículas "
                       f"(nível {_nivel(turb, FAIXAS['particulas']).lower()}).")
    if suspeitas:
        obs.append(f"{suspeitas} leituras suspeitas hoje (pouca luz no sensor, sensor estourado ou luz de fora) ficaram fora dos gráficos.")
    return obs


def _referencias():
    """Ultima agua limpa (branco) e ultima agua suja gravadas, em qualquer dia."""
    branco = Leitura.objects.filter(tipo="branco").order_by("-medido_em").first()
    suja = Leitura.objects.filter(tipo="amostra", amostra="agua_podre").order_by("-medido_em").first()
    suja_q = None
    if suja and suja.cores:
        suja_q = qualidade.indices([c.get("porcentagem") for c in suja.cores[:8]], _ntu_valido(suja.turbidez or {}),
                                   qualidade.absorbancia_nir(suja, branco))
    return branco, suja, suja_q


def _qualidade_atual(atual, atual_indices, suja_q, observacoes):
    q = atual_indices["qualidade"]
    if q is None or atual_indices["suspeita"]:
        return {
            "valida": False,
            "alerta": observacoes[0] if observacoes else "Leitura inválida: confira a lanterna e regrave a água limpa.",
            "conclusao": "Sem leitura válida da lagoa agora: as análises voltam quando a luz no sensor estiver correta.",
        }
    geral = qualidade.indice_geral(q)
    st = qualidade.status(geral)
    sem_limpa = qualidade.semelhanca(q["absorbancia"], [0.0] * 8)
    sem_suja = qualidade.semelhanca(q["absorbancia"], suja_q["absorbancia"]) if suja_q else None
    inten = qualidade.intensidades(q)
    pior = max((k for k, v in inten.items() if v is not None), key=lambda k: inten[k])
    parecida = None
    if sem_suja is not None:
        parecida = "água limpa" if sem_limpa >= sem_suja else "água suja de referência"
    conclusao = (f"Índice geral {geral} de 100 ({st}). "
                 + (f"O espectro se parece mais com a {parecida}. " if parecida else "")
                 + f"Fator que mais pesa: {qualidade.NOMES_INDICES[pior].lower()}.")
    elevados = [c for c in _componentes(atual_indices) if c["nivel"] in ("Moderado", "Alto")]
    if elevados:
        c = max(elevados, key=lambda c: (c["nivel"] == "Alto", c["intensidade"] or 0))
        alerta = f"{c['nome']} em nível {c['nivel'].lower()} ({c['como']})."
    else:
        alerta = "Nenhum indicador acima do normal nesta leitura."
    return {
        "valida": True,
        "sensor": atual_indices["sensor"],
        "indice_geral": geral,
        "status": st,
        "ntu": _numero(q["ntu"]),
        "classe_conama": qualidade.classe_conama(q["ntu"]),
        "cor": qualidade.cor_amostra(atual_indices["porcentagens"]),
        "semelhanca": [
            {"nome": "Água limpa", "pct": sem_limpa},
            {"nome": "Água suja de referência", "pct": sem_suja},
        ],
        "mais_semelhante": parecida,
        "alerta": alerta,
        "conclusao": conclusao,
    }


def _comparacao_amostras(atual_indices, suja_q):
    nomes = [qualidade.NOMES_INDICES[k] for k in qualidade.PESOS]
    def linha(q):
        inten = qualidade.intensidades(q)
        return None if inten is None else [_numero(inten[k]) for k in qualidade.PESOS]
    amostras = [{"nome": "Água limpa", "valores": [0.0] * len(nomes)}]
    if atual_indices and not atual_indices["suspeita"] and atual_indices["qualidade"]:
        amostras.append({"nome": "Lagoa (agora)", "valores": linha(atual_indices["qualidade"])})
    if suja_q:
        amostras.append({"nome": "Água suja", "valores": linha(suja_q)})
    return {"indicadores": nomes, "amostras": amostras}


def _diluicao():
    recentes = Leitura.objects.filter(amostra__startswith="dil_").order_by("-medido_em")[:500]
    pares = []
    for leitura in recentes:
        if leitura.cores:
            q = qualidade.indices([c.get("porcentagem") for c in leitura.cores[:8]])
            pares.append((leitura.amostra, q["absorbancia"] if q else None))
    return qualidade.serie_diluicao(pares)


def _dados_painel(data_selecionada, leituras, metricas):
    branco_ref, suja_ref, suja_q = _referencias()
    indices = {leitura.pk: _indices(leitura, metricas[leitura.pk], branco_ref) for leitura in leituras}
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
    observacoes = _observacoes(
        serie,
        atual_indices if atual else None,
        sum(indices[leitura.pk]["suspeita"] for leitura in leituras),
        minutos_sem_enviar,
    )
    qualidade_atual = _qualidade_atual(atual, atual_indices, suja_q, observacoes) if atual else None

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
                **_colunas_qualidade(indices[leitura.pk]),
                "tensao_v": _numero(indices[leitura.pk]["sensor"]["tensao_v"]),
                "sensor_estado": indices[leitura.pk]["sensor"]["estado_leitura"],
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
        # Validacao: sensor de cor (luz bloqueada) x tensao do sensor de turbidez.
        "comparacao": [
            {
                "hora": timezone.localtime(leitura.medido_em).strftime("%H:%M"),
                "turbidez": _numero(i["turbidez"]),
                "tensao_v": _numero(i["sensor"]["tensao_v"]),
            }
            for leitura, i in validas[-300:]
            if i["turbidez"] is not None and i["sensor"]["tensao_v"] is not None
            and i["sensor"]["estado_leitura"] != "invalida"
        ],
        "sensor_turbidez": _diagnostico_sensor(leituras[-1], indices[leituras[-1].pk]) if leituras else None,
        "amostra_atual": amostra_atual,
        "qualidade": qualidade_atual,
        "comparacao_amostras": _comparacao_amostras(atual_indices if atual else None, suja_q),
        "referencia_suja": (
            {"hora": timezone.localtime(suja_ref.medido_em).strftime("%d/%m %H:%M"),
             "absorbancia": [_numero(v) for v in suja_q["absorbancia"]]}
            if suja_q else None
        ),
        "diluicao": _diluicao(),
        "canais": canais,
        "componentes": _componentes(atual_indices) if atual else [],
        "observacoes": observacoes,
        "diagnostico": diagnostico,
        "turbidez": turbidez,
        "espectro": espectro,
        "live": live,
    }


def _sensor_resumo(sensores):
    """Sensor de turbidez das repeticoes de uma amostra: medias das leituras sem defeito."""
    ok = [s for s in sensores if s["estado_leitura"] != "invalida"]
    if not ok:
        return {"estado_leitura": "invalida" if sensores else "sem_dado", "tensao_v": None, "ntu_experimental": None,
                "ntu_limite": None, "faixa_curva_ntu": sensores[0]["faixa_curva_ntu"] if sensores else None}
    limites = {s["ntu_limite"] for s in ok}
    return {
        "estado_leitura": ok[0]["estado_leitura"],
        "tensao_v": _numero(_media([s["tensao_v"] for s in ok])),
        "ntu_experimental": _numero(_media([s["ntu_experimental"] for s in ok])),
        "ntu_limite": limites.pop() if len(limites) == 1 else None,
        "faixa_curva_ntu": ok[0]["faixa_curva_ntu"],
    }


def _diagnostico_sensor(leitura, indices):
    """Painel "Diagnostico do sensor": ultima leitura recebida, como chegou."""
    return {
        **indices["sensor"],
        "hora": timezone.localtime(leitura.medido_em).strftime("%d/%m/%Y %H:%M:%S"),
        "firmware_version": (leitura.dados_originais or {}).get("firmware_version") or "não informado (firmware antigo)",
    }


def _colunas_qualidade(indices):
    q = indices["qualidade"]
    if q is None or indices["suspeita"]:
        return {"ntu": None, "clorofila": None, "cianobacterias": None, "materia_organica": None,
                "sedimentos": None, "indice_geral": None, "status": None}
    geral = qualidade.indice_geral(q)
    return {
        "ntu": _numero(q["ntu"]),
        "clorofila": _numero(q["clorofila"]),
        "cianobacterias": _numero(q["cianobacterias"]),
        "materia_organica": _numero(q["materia_organica"]),
        "sedimentos": _numero(q["sedimentos"]),
        "indice_geral": geral,
        "status": qualidade.status(geral),
    }


def historico(request):
    """Media por dia dos ultimos 30 dias (agua da lagoa, leituras validas)."""
    dias = max(1, min(90, int(request.GET.get("dias", 30) or 30)))
    inicio = timezone.localdate() - timedelta(days=dias - 1)
    branco = Leitura.objects.filter(tipo="branco").order_by("-medido_em").first()
    linhas = (
        Leitura.objects.filter(collection__data_coleta__gte=inicio, tipo="amostra")
        .exclude(amostra__in=REFERENCIAS)
        .filter(amostra__startswith="lagoa")
        .select_related("collection")
        .only("medido_em", "tipo", "amostra", "turbidez", "cores", "media", "saturado", "ganho", "collection__data_coleta")
    )
    por_dia = {}
    for leitura in linhas:
        if not leitura.cores:
            continue
        i = _indices(leitura, {}, branco)
        q = i["qualidade"]
        if i["suspeita"] or q is None:
            continue
        por_dia.setdefault((leitura.collection.data_coleta, leitura.amostra), []).append((i, q))
    saida = []
    for (dia, ponto), grupo in sorted(por_dia.items()):
        saida.append({
            "data": dia.isoformat(),
            "ponto": ponto,
            "ponto_nome": qualidade.nome_amostra(ponto, "amostra"),
            "medicoes": len(grupo),
            "ntu": _numero(_media([q["ntu"] for _, q in grupo])),
            "tensao_v": _numero(_media([
                i["sensor"]["tensao_v"] for i, _ in grupo if i["sensor"]["estado_leitura"] != "invalida"
            ])),
            "turbidez": _numero(_media([i["turbidez"] for i, _ in grupo])),
            "clorofila": _numero(_media([q["clorofila"] for _, q in grupo])),
            "cianobacterias": _numero(_media([q["cianobacterias"] for _, q in grupo])),
            "materia_organica": _numero(_media([q["materia_organica"] for _, q in grupo])),
            "indice_geral": _numero(_media([qualidade.indice_geral(q) for _, q in grupo])),
        })
    pontos = sorted({p["ponto"] for p in saida})
    return JsonResponse({"dias": dias, "pontos": [{"id": p, "nome": qualidade.nome_amostra(p, "amostra")} for p in pontos], "historico": saida})


REPETICOES = 3  # cada amostra = media das ultimas 3 medicoes validas com aquele nome
# Agua limpa e agua suja sao padroes: cada regravacao (BOOT -> 1 / BOOT -> 2) ja e a
# media de 3 leituras feita pelo ESP32 e SUBSTITUI a anterior. As antigas ficam no banco
# (Historico -> Registros recebidos), mas nao entram mais nas contas.
PADROES = {"agua_limpa", "agua_podre"}


def _resumo_amostra(id_, leituras, branco):
    """Media e desvio das ultimas 3 medicoes validas de uma amostra."""
    reps = []
    limite = 1 if id_ in PADROES or (leituras and leituras[0].tipo == "branco") else REPETICOES
    for leitura in leituras:
        i = _indices(leitura, {}, branco)
        if not i["suspeita"] and i["qualidade"] is not None:
            reps.append((leitura, i))
        if len(reps) == limite:
            break
    if not reps:
        return None
    tipo = qualidade.tipo_amostra(id_, reps[0][0].tipo)
    a = [[r[1]["qualidade"]["absorbancia"][c] for r in reps] for c in range(8)]
    absorb = [0.0] * 8 if tipo == "branco" else [_media(v) for v in a]
    abs_dp = _media([_desvio(v) or 0 for v in a]) if len(reps) > 1 else None
    ntus = [r[1]["qualidade"]["ntu"] for r in reps if r[1]["qualidade"]["ntu"] is not None]
    luz = _media([r[1]["turbidez"] for r in reps])
    nir = [r[1]["qualidade"]["sedimentos"] for r in reps if r[1]["qualidade"]["sedimentos"] is not None]
    porcentagens = [_media([r[1]["porcentagens"][c] for r in reps]) for c in range(8)]
    ntu = _media(ntus)
    ix = {
        "clorofila": absorb[7] - absorb[5],
        "cianobacterias": (absorb[5] + absorb[6]) / 2 - absorb[4],
        "materia_organica": absorb[0] - absorb[3],
        "sedimentos": _media(nir) if tipo != "branco" else (0.0 if nir else None),
    }
    q = {**ix, "absorbancia": absorb, "ntu": ntu, "turbidez_a": (absorb[5] + absorb[6]) / 2}
    geral = 100 if tipo == "branco" else qualidade.indice_geral(q)
    mais_recente = reps[0][0]
    return {
        "id": id_,
        "nome": qualidade.nome_amostra(id_, mais_recente.tipo),
        "tipo": tipo,
        "leitura": timezone.localtime(mais_recente.medido_em).strftime("%d/%m/%Y %H:%M"),
        "repeticoes": len(reps),
        "absorbancia": [_numero(v) for v in absorb],
        "abs_dp": _numero(abs_dp),
        "turbidez_ntu": _numero(ntu),
        "turbidez_dp": _numero(_desvio(ntus)),
        "luz_bloqueada_pct": _numero(luz),
        "classe_turbidez": qualidade.classe_texto(ntu),
        "sensor": _sensor_resumo([r[1]["sensor"] for r in reps]),
        **{k: _numero(v) for k, v in ix.items()},
        "niveis": {k: qualidade.nivel_texto(v) for k, v in ix.items()},
        "intensidades": (
            {k: 0.0 for k in qualidade.PESOS} if tipo == "branco"
            else {k: _numero(v) for k, v in (qualidade.intensidades(q) or {}).items()}
        ),
        "padrao": id_ in PADROES or tipo == "branco",
        "indice_geral": geral,
        "status": qualidade.status(geral),
        "cor": qualidade.cor_amostra(porcentagens) if tipo != "branco" else {"hex": "#fbfeff", "nome": "Incolor", "lambda_dom_nm": None},
    }


def amostras(request):
    """Todas as amostras com nome (como no design): indices, semelhanca, diluicao."""
    branco = Leitura.objects.filter(tipo="branco").order_by("-medido_em").first()
    nomes = (Leitura.objects.exclude(cores__isnull=True).values_list("amostra", flat=True).distinct())
    lista = []
    for id_ in sorted(set(nomes)):
        recentes = list(Leitura.objects.filter(amostra=id_).exclude(cores__isnull=True).order_by("-medido_em")[:15])
        resumo = _resumo_amostra(id_, recentes, branco)
        if resumo:
            lista.append(resumo)
    ordem = {"branco": 0, "controle": 1, "lagoa": 2, "referencia": 3, "corante": 4, "outra": 5}
    numerica = lambda t: [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", t)]  # dil_x_25 antes de dil_x_100
    lista.sort(key=lambda a: (ordem[a["tipo"]], numerica(a["id"])))

    # Referencias da semelhanca: agua boa (ou o branco), agua podre e as ref_/sim_.
    por_id = {a["id"]: a for a in lista}
    boa = por_id.get("agua_boa") or next((a for a in lista if a["tipo"] == "branco"), None)
    refs = [r for r in [boa, por_id.get("agua_podre")] if r] + [a for a in lista if a["tipo"] == "referencia"]
    for a in lista:
        if a["tipo"] == "branco":
            a["semelhanca"] = []
            continue
        sims = [
            {"referencia_id": r["id"], "referencia": r["nome"],
             "semelhanca_pct": qualidade.semelhanca(a["absorbancia"], r["absorbancia"])}
            for r in refs if r["id"] != a["id"]
        ]
        a["semelhanca"] = sorted(sims, key=lambda x: -x["semelhanca_pct"])
        ref = a["semelhanca"][0]["referencia"] if a["semelhanca"] else ""
        ix = {k: a[k] for k in qualidade.TEXTOS}
        a["referencia_mais_semelhante"] = ref
        a["conclusao"] = qualidade.conclusao_amostra(a["nome"], a["turbidez_ntu"], a["luz_bloqueada_pct"], ix, ref, a["status"])
        a["alerta"] = qualidade.alerta_amostra(a["turbidez_ntu"], ix)
    for a in lista:
        if a["tipo"] == "branco":
            a["conclusao"], a["alerta"], a["referencia_mais_semelhante"] = (
                "Referência do cálculo (absorbância zero por definição).", "Amostra de referência.", "")

    # Sem "agua_boa" medida, a agua limpa (padrao) entra no lugar dela.
    boa_id = "agua_boa" if "agua_boa" in por_id else next((a["id"] for a in lista if a["tipo"] == "branco"), None)
    comparar = [i for i in (boa_id, "agua_podre") if i in por_id] + [a["id"] for a in lista if a["tipo"] == "lagoa"]
    diluicao = qualidade.serie_diluicao([(a["id"], a["absorbancia"]) for a in lista if a["tipo"] == "corante"])
    padrao = next((a["id"] for a in lista if a["tipo"] == "lagoa"), lista[0]["id"] if lista else None)
    return JsonResponse({"amostras": lista, "comparacao": comparar, "diluicao": diluicao, "padrao": padrao})


def _numero(valor):
    return round(valor, 4) if valor is not None else None
