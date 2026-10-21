"""Indicadores de qualidade da agua a partir das 8 cores do AS7341.

Tudo parte da absorbancia de cada cor, A = -log10(amostra / agua limpa):
  clorofila         A(680) - A(590)                  (o AS7341 nao tem 745 nm)
  cianobacterias    media(A(590), A(630)) - A(555)    (ficocianina, como no design)
  materia organica  A(415) - A(515)
  sedimentos        A(infravermelho ~910 nm)          (so particulas bloqueiam)
  turbidez          NTU do sensor de turbidez; sem ele, A media de 590 e 630 nm
Indice geral = 100 x (1 - penalidade), pesos 30/20/20/15/15 (turbidez, clorofila,
cianobacterias, materia organica, sedimentos). Indices divididos por 0,40 e
turbidez por 150 NTU para ficar de 0 a 1.
"""
import math
import re

ESCALA_INDICE = 0.40
ESCALA_NTU = 150.0
LIMITES = (0.05, 0.20)  # abaixo de 0,05 baixo; ate 0,20 moderado; acima alto
PESOS = {"turbidez": 0.30, "clorofila": 0.20, "cianobacterias": 0.20, "materia_organica": 0.15, "sedimentos": 0.15}
NIR_MINIMO = 200  # contagens do infravermelho na agua limpa; abaixo disso a lanterna nao emite o bastante
ONDAS = [415, 445, 480, 515, 555, 590, 630, 680]
NOMES_INDICES = {
    "turbidez": "Turbidez",
    "clorofila": "Clorofila (algas)",
    "cianobacterias": "Cianobactérias",
    "materia_organica": "Matéria orgânica",
    "sedimentos": "Sedimentos",
}


def _limitar(v, a=0.0, b=1.0):
    return max(a, min(b, v))


def absorbancia(porcentagem):
    if porcentagem is None:
        return None
    return -math.log10(max(porcentagem, 0.1) / 100)


def absorbancia_nir(leitura, branco):
    """Infravermelho comparado com a ultima agua limpa (mesmo ganho)."""
    if not branco or not leitura.media:
        return None
    nir, nir_ref = leitura.media.get("nir"), (branco.media or {}).get("nir")
    if nir is None or not nir_ref or nir_ref < NIR_MINIMO or leitura.ganho != branco.ganho:
        return None
    return -math.log10(max(nir, 0.1) / nir_ref)


def indices(porcentagens, ntu=None, a_nir=None):
    a = [absorbancia(p) for p in porcentagens]
    if any(v is None for v in a):
        return None
    return {
        "absorbancia": a,
        "clorofila": a[7] - a[5],
        "cianobacterias": (a[5] + a[6]) / 2 - a[4],
        "materia_organica": a[0] - a[3],
        "sedimentos": a_nir,
        "turbidez_a": (a[5] + a[6]) / 2,
        "ntu": ntu,
    }


def intensidades(ind):
    """Cada indicador de 0 (agua limpa) a 1 (muito alto)."""
    if ind is None:
        return None
    turb = ind["ntu"] / ESCALA_NTU if ind["ntu"] is not None else ind["turbidez_a"] / ESCALA_INDICE
    saida = {"turbidez": _limitar(turb)}
    for chave in ("clorofila", "cianobacterias", "materia_organica", "sedimentos"):
        v = ind[chave]
        saida[chave] = None if v is None else _limitar(v / ESCALA_INDICE)
    return saida


def indice_geral(ind):
    inten = intensidades(ind)
    if inten is None:
        return None
    soma = sum(PESOS[k] * v for k, v in inten.items() if v is not None)
    pesos = sum(PESOS[k] for k, v in inten.items() if v is not None)  # sem infravermelho: redistribui
    return round(100 * (1 - soma / pesos))


def status(geral):
    if geral is None:
        return None
    return "bom" if geral >= 80 else "atenção" if geral >= 50 else "alerta"


def nivel(valor, chave):
    if valor is None:
        return None
    if chave == "turbidez":  # intensidade 0-1; 40 e 100 NTU sao os limites da CONAMA 357/2005
        valor = valor * ESCALA_NTU
        return "Baixo" if valor <= 40 else "Moderado" if valor <= 100 else "Alto"
    return "Baixo" if valor < LIMITES[0] else "Moderado" if valor <= LIMITES[1] else "Alto"


def classe_conama(ntu):
    if ntu is None:
        return None
    if ntu <= 5:
        return "potável (até 5 NTU)"
    if ntu <= 40:
        return "classe 1 (até 40 NTU)"
    if ntu <= 100:
        return "classes 2 e 3 (até 100 NTU)"
    return "acima do limite das classes 2 e 3"


def cor_amostra(porcentagens):
    """Cor aproximada da agua vista contra a luz branca, a partir das 8 cores."""
    if not porcentagens or any(p is None for p in porcentagens):
        return None
    t = [_limitar(p / 100) for p in porcentagens]
    r = (t[6] + t[7]) / 2
    g = (t[3] + t[4] + t[5]) / 3
    b = (t[1] + t[2]) / 2
    hexa = "#{:02x}{:02x}{:02x}".format(*(round(255 * _limitar(c)) for c in (r, g, b)))
    claro = (r + g + b) / 3
    if claro > 0.85 and max(r, g, b) - min(r, g, b) < 0.08:
        nome = "Transparente"
    elif claro < 0.15:
        nome = "Muito escura"
    elif b < g * 0.8 and r >= g * 0.95:
        nome = "Amarelada / marrom"
    elif g > r * 1.05 and g > b * 1.05:
        nome = "Esverdeada"
    elif max(r, g, b) - min(r, g, b) < 0.08:
        nome = "Acinzentada (turva)"
    else:
        nome = "Levemente colorida"
    dominante = ONDAS[max(range(8), key=lambda i: porcentagens[i])]
    return {"hex": hexa, "nome": nome, "lambda_dom_nm": dominante}


def semelhanca(a, referencia):
    """100 x e^(-d/0,4), d = distancia euclidiana entre os 8 canais de absorbancia."""
    if a is None or referencia is None:
        return None
    d = math.sqrt(sum((x - y) ** 2 for x, y in zip(a, referencia)))
    return round(100 * math.exp(-d / 0.4))


DILUICAO = re.compile(r"^dil_([a-z0-9]+)_(\d+(?:[.,]\d+)?)$")


def serie_diluicao(amostras):
    """amostras: [(nome, absorbancia[8])]. Nome no formato dil_<corante>_<concentracao>."""
    grupos = {}
    for nome, a in amostras:
        m = DILUICAO.match(nome or "")
        if not m or a is None:
            continue
        conc = float(m.group(2).replace(",", "."))
        grupos.setdefault(m.group(1), {}).setdefault(conc, []).append(a)
    saida = []
    for corante, por_conc in sorted(grupos.items()):
        if len(por_conc) < 3:  # regressao precisa de pelo menos 3 concentracoes
            continue
        medias = {c: [sum(v[i] for v in lista) / len(lista) for i in range(8)] for c, lista in por_conc.items()}
        maior = max(medias)
        canal = max(range(8), key=lambda i: medias[maior][i])  # canal de maior absorcao do corante
        xs = sorted(medias)
        ys = [medias[c][canal] for c in xs]
        n, sx, sy = len(xs), sum(xs), sum(ys)
        sxx, sxy = sum(x * x for x in xs), sum(x * y for x, y in zip(xs, ys))
        den = n * sxx - sx * sx
        if den == 0:
            continue
        incl = (n * sxy - sx * sy) / den
        inter = (sy - incl * sx) / n
        ss_tot = sum((y - sy / n) ** 2 for y in ys)
        ss_res = sum((y - (incl * x + inter)) ** 2 for x, y in zip(xs, ys))
        r2 = 1 - ss_res / ss_tot if ss_tot > 0 else None
        saida.append({
            "corante": corante,
            "canal_nm": ONDAS[canal],
            "pontos": [{"c": x, "a": round(y, 4)} for x, y in zip(xs, ys)],
            "inclinacao": round(incl, 5),
            "intercepto": round(inter, 4),
            "r2": None if r2 is None else round(r2, 4),
        })
    return saida


# ---- Amostras (como no design: media de 3 repeticoes por amostra) ----
TEXTOS = {
    "clorofila": ("Algas / clorofila", {
        "alto": "Alta presença de algas, possível eutrofização (excesso de nutrientes).",
        "moderado": "Presença moderada de algas. Acompanhar a tendência nos próximos dias.",
        "baixo": "Pouca clorofila detectada."}),
    "cianobacterias": ("Cianobactérias", {
        "alto": "Assinatura compatível com cianobactérias, risco potencial de toxinas. Recomenda-se análise laboratorial.",
        "moderado": "Sinal moderado de ficocianina. Possível presença de cianobactérias; confirmar em laboratório.",
        "baixo": "Sem sinal relevante de cianobactérias."}),
    "materia_organica": ("Matéria orgânica", {
        "alto": "Matéria orgânica dissolvida elevada, possível decomposição ou esgoto.",
        "moderado": "Matéria orgânica dissolvida moderada.",
        "baixo": "Pouca matéria orgânica dissolvida."}),
    "sedimentos": ("Sedimentos", {
        "alto": "Partículas em suspensão elevadas, possível erosão ou revolvimento do fundo.",
        "moderado": "Partículas em suspensão moderadas.",
        "baixo": "Poucas partículas em suspensão."}),
}
NOMES_CURTOS = {"clorofila": "algas", "cianobacterias": "cianobactérias", "materia_organica": "matéria orgânica", "sedimentos": "sedimentos"}


def nivel_texto(v):
    if v is None:
        return None
    return "baixo" if v < LIMITES[0] else "moderado" if v <= LIMITES[1] else "alto"


def classe_texto(ntu):
    if ntu is None:
        return "Calibração em NTU pendente"
    return "Compatível com classe 1" if ntu <= 40 else "Compatível com classes 2 e 3" if ntu <= 100 else "Fora dos limites CONAMA"


def nome_amostra(id_, tipo):
    if tipo == "branco":
        return "Água limpa (padrão)"
    fixos = {"agua_boa": "Água boa", "agua_podre": "Água podre", "agua_limpa": "Água limpa", "lagoa": "Lagoa"}
    if id_ in fixos:
        return fixos[id_]
    m = re.match(r"^lagoa_?p?(\w+)$", id_)
    if m:
        return f"Lagoa – Ponto {m.group(1).upper() if not m.group(1).isdigit() else m.group(1)}"
    m = re.match(r"^(?:ref|sim)_(\w+)$", id_)
    if m:
        conhecidas = {"cha": "Chá (orgânico)", "terra": "Terra (sedimento)", "algas": "Água esverdeada (algas)"}
        return conhecidas.get(m.group(1), f"Referência – {m.group(1).replace('_', ' ')}")
    m = DILUICAO.match(id_)
    if m:
        return f"Corante {m.group(1)} {m.group(2)}%"
    return id_.replace("_", " ").capitalize()


def tipo_amostra(id_, tipo):
    if tipo == "branco":
        return "branco"
    if id_ in ("agua_boa", "agua_podre"):
        return "controle"
    if id_.startswith("lagoa"):
        return "lagoa"
    if id_.startswith(("ref_", "sim_")):
        return "referencia"
    if id_.startswith("dil_"):
        return "corante"
    return "outra"


def conclusao_amostra(nome, ntu, luz, ix, ref, st):
    ordem = sorted((k for k in TEXTOS if ix.get(k) is not None), key=lambda k: ix[k], reverse=True)
    if ntu is not None:
        turb = f"turbidez de {ntu:.1f} NTU ({classe_texto(ntu).lower()})".replace(".", ",")
    elif luz is not None:
        turb = f"turbidez de {luz:.0f}% de luz bloqueada pelo sensor de cor (NTU com calibração pendente)"
    else:
        turb = "turbidez sem leitura"
    forca = {"alto": "assinatura forte de", "moderado": "assinatura moderada de", "baixo": "assinatura fraca de"}
    partes = [turb]
    if ordem:
        partes.append(f"{forca[nivel_texto(ix[ordem[0]])]} {NOMES_CURTOS[ordem[0]]}")
    if len(ordem) > 1:
        partes.append(f"nível {nivel_texto(ix[ordem[1]])} de {NOMES_CURTOS[ordem[1]]}")
    frase = f"{nome}: " + ", ".join(partes[:-1]) + (" e " if len(partes) > 1 else "") + partes[-1] + "."
    if ref:
        frase += f" Espectro mais semelhante a: {ref.lower()}."
    return frase + f" Status: {st}."


def alerta_amostra(ntu, ix):
    if ntu is not None and ntu > 100:
        return "Turbidez acima de 100 NTU, fora dos limites da CONAMA 357/2005 para águas doces."
    validos = [k for k in TEXTOS if ix.get(k) is not None]
    if not validos:
        return "Sem dados suficientes nesta amostra."
    topo = max(validos, key=lambda k: ix[k])
    nv = nivel_texto(ix[topo])
    return TEXTOS[topo][1]["alto"] if nv == "alto" else TEXTOS[topo][1]["moderado"] if nv == "moderado" else "Nenhum indicador acima do nível baixo."
