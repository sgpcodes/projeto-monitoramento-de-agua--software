"""Laudo de laboratorio em TXT: modelo para preencher, leitura do arquivo e
comparacao com o que o aparelho mediu na mesma amostra.

O aparelho e o laboratorio nao medem nas mesmas unidades (o aparelho da indices
de absorbancia; o laboratorio da ug/L, celulas/mL...). Por isso a comparacao e
feita por NIVEL (baixo / moderado / alto), usando as faixas da CONAMA 357/2005
para agua doce. Turbidez (NTU) e pH tem a mesma unidade e sao comparados direto.
"""
import re
import unicodedata
from datetime import date, datetime

from django.utils import timezone

TAMANHO_MAXIMO = 20_000  # bytes: um laudo preenchido tem menos de 1 KB

# campo: (nome na tela, unidade, faixas (ate_baixo, ate_moderado) ou None)
CAMPOS = {
    "turbidez_ntu": ("Turbidez", "NTU", (40, 100)),  # CONAMA: classe 1 ate 40, classes 2/3 ate 100
    "ph": ("pH", "", None),
    "clorofila_a_ug_l": ("Algas (clorofila-a)", "µg/L", (10, 30)),  # classe 1 ate 10, classe 2 ate 30
    "cianobacterias_cel_ml": ("Cianobactérias", "células/mL", (20_000, 50_000)),  # classe 1 / classe 2
    "cor_verdadeira_mg_pt_l": ("Matéria orgânica (cor verdadeira)", "mg Pt/L", (15, 75)),  # potavel 15; classe 2 ate 75
    "solidos_suspensos_mg_l": ("Sedimentos (sólidos suspensos)", "mg/L", None),  # sem faixa na CONAMA
}

# Outros nomes que o laboratorio pode usar no TXT.
APELIDOS = {
    "data": "data_coleta", "data_da_coleta": "data_coleta", "laboratorio": "laboratorio", "lab": "laboratorio",
    "turbidez": "turbidez_ntu", "clorofila": "clorofila_a_ug_l", "clorofila_a": "clorofila_a_ug_l",
    "cianobacterias": "cianobacterias_cel_ml", "cianobacteria": "cianobacterias_cel_ml",
    "cor": "cor_verdadeira_mg_pt_l", "cor_verdadeira": "cor_verdadeira_mg_pt_l",
    "sst": "solidos_suspensos_mg_l", "solidos_suspensos": "solidos_suspensos_mg_l",
    "solidos_suspensos_totais": "solidos_suspensos_mg_l", "observacao": "observacoes", "obs": "observacoes",
}
TEXTO = {"amostra", "data_coleta", "laboratorio", "observacoes"}


def modelo(amostra="", hoje=None):
    hoje = hoje or timezone.localdate()
    return (
        "# AquaMonitor · laudo de laboratório\n"
        "# Preencha depois do \"=\". Deixe vazio o que o laboratório não mediu.\n"
        "# Números com vírgula ou ponto (ex.: 12,5). Linhas que começam com # são ignoradas.\n"
        "# \"amostra\" é o mesmo nome usado no aparelho (ex.: lagoa_p1).\n"
        "\n"
        f"amostra = {amostra}\n"
        f"data_coleta = {hoje:%d/%m/%Y}\n"
        "laboratorio = \n"
        "\n"
        "# Turbidez, em NTU (turbidímetro)\n"
        "turbidez_ntu = \n"
        "\n"
        "# pH\n"
        "ph = \n"
        "\n"
        "# Clorofila-a, em µg/L (algas)\n"
        "clorofila_a_ug_l = \n"
        "\n"
        "# Cianobactérias, em células/mL\n"
        "cianobacterias_cel_ml = \n"
        "\n"
        "# Cor verdadeira, em mg Pt/L (matéria orgânica dissolvida)\n"
        "cor_verdadeira_mg_pt_l = \n"
        "\n"
        "# Sólidos suspensos totais, em mg/L (sedimentos)\n"
        "solidos_suspensos_mg_l = \n"
        "\n"
        "observacoes = \n"
    )


def _chave(texto):
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    chave = re.sub(r"[^a-z0-9]+", "_", sem_acento.lower()).strip("_")
    return APELIDOS.get(chave, chave)


def _numero(texto, campo):
    m = re.search(r"[-+]?\d[\d.,]*(?:[eE][-+]?\d+)?", texto)
    if not m:
        raise ValueError(f"\"{texto}\" não é um número")
    n = m.group()
    if "," in n and "." in n:  # 1.234,5 ou 1,234.5: o ultimo separador e o decimal
        n = n.replace(".", "").replace(",", ".") if n.rfind(",") > n.rfind(".") else n.replace(",", "")
    elif "," in n:
        n = n.replace(",", ".") if n.count(",") == 1 else n.replace(",", "")
    elif n.count(".") > 1 or (campo == "cianobacterias_cel_ml" and re.fullmatch(r"\d{1,3}\.\d{3}", n)):
        n = n.replace(".", "")  # 50.000 celulas/mL = cinquenta mil
    return float(n)


def _data(texto):
    for formato in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(texto.strip(), formato).date()
        except ValueError:
            continue
    raise ValueError(f"data \"{texto}\" inválida (use dd/mm/aaaa)")


def ler(conteudo, amostra_padrao=""):
    """Le o TXT. Devolve (campos, avisos). Erro de preenchimento vira ValueError
    com a linha, para a pessoa saber o que corrigir."""
    dados, avisos = {}, []
    for numero, linha in enumerate(conteudo.splitlines(), 1):
        linha = linha.strip()
        if not linha or linha.startswith("#"):
            continue
        sep = re.search(r"[=:]", linha)
        if not sep:
            avisos.append(f"Linha {numero} ignorada (sem \"=\"): {linha[:60]}")
            continue
        chave, valor = _chave(linha[:sep.start()]), linha[sep.end():].strip()
        if chave not in CAMPOS and chave not in TEXTO:
            avisos.append(f"Linha {numero}: campo \"{linha[:sep.start()].strip()}\" não reconhecido (ignorado).")
            continue
        if not valor:
            continue
        try:
            if chave == "data_coleta":
                dados[chave] = _data(valor)
            elif chave in CAMPOS:
                dados[chave] = _numero(valor, chave)
            else:
                dados[chave] = valor
        except ValueError as erro:
            raise ValueError(f"Linha {numero} ({chave}): {erro}.") from None
    amostra = (dados.get("amostra") or amostra_padrao or "").strip().lower().replace(" ", "_")
    if not amostra:
        raise ValueError("Falta o nome da amostra (linha \"amostra = lagoa_p1\").")
    if not re.fullmatch(r"[a-z0-9_]{1,20}", amostra):
        raise ValueError("Nome da amostra inválido: use só letras, números e _ (até 20 caracteres), como no aparelho.")
    dados["amostra"] = amostra
    if not any(dados.get(c) is not None for c in CAMPOS):
        raise ValueError("Nenhum resultado preenchido: coloque pelo menos um valor (ex.: turbidez_ntu = 12,5).")
    if dados.get("ph") is not None and not 0 <= dados["ph"] <= 14:
        raise ValueError("pH fora da escala de 0 a 14.")
    for campo in CAMPOS:
        if dados.get(campo) is not None and dados[campo] < 0 and campo != "ph":
            raise ValueError(f"{CAMPOS[campo][0]} não pode ser negativo.")
    dados["laboratorio"] = dados.get("laboratorio", "")[:120]
    return dados, avisos


def _br(valor, casas):
    return f"{valor:.{casas}f}".replace(".", ",")


def _nivel(valor, faixas):
    if valor is None or faixas is None:
        return None
    return "baixo" if valor <= faixas[0] else "moderado" if valor <= faixas[1] else "alto"


def _faixa_ph(v):
    return None if v is None else "ácida" if v < 6 else "alcalina" if v > 9 else "normal"


def comparar(analise, a):
    """Linhas lado a lado: laboratorio x aparelho, para a amostra resumida "a"
    (o dicionario da pagina Amostras)."""
    linhas = []

    def linha(campo, aparelho, unidade_aparelho, nivel_aparelho, concorda, nota):
        nome, unidade, faixas = CAMPOS[campo]
        lab = getattr(analise, campo)
        if lab is None:
            return
        linhas.append({
            "id": campo, "parametro": nome, "unidade": unidade,
            "laboratorio": lab, "nivel_laboratorio": _faixa_ph(lab) if campo == "ph" else _nivel(lab, faixas),
            "aparelho": aparelho, "unidade_aparelho": unidade_aparelho, "nivel_aparelho": nivel_aparelho,
            "concorda": concorda, "nota": nota,
        })

    # Turbidez: mesma unidade (NTU). Usa o NTU calibrado; sem ele, a estimativa da curva do fabricante.
    sensor = a.get("sensor") or {}
    ntu, estimado = a.get("turbidez_ntu"), False
    if ntu is None and sensor.get("estado_leitura") != "invalida" and sensor.get("ntu_experimental") is not None:
        ntu, estimado = sensor["ntu_experimental"], True
    lab = analise.turbidez_ntu
    if lab is not None:
        nivel_ap = _nivel(ntu, CAMPOS["turbidez_ntu"][2])
        if ntu is None:
            nota = "O sensor de turbidez não tem leitura válida desta amostra."
        else:
            dif = ntu - lab
            nota = (f"Aparelho {'acima' if dif > 0 else 'abaixo'} do laboratório em {_br(abs(dif), 1)} NTU"
                    + (f" ({abs(dif) / lab * 100:.0f}%)" if lab > 0 else "") + "."
                    + (" Valor do aparelho estimado pela curva do fabricante (sem calibração): este laudo serve "
                       "como ponto de calibração." if estimado else ""))
        linha("turbidez_ntu", ntu, "NTU (estimado)" if estimado else "NTU", nivel_ap,
              None if ntu is None else nivel_ap == _nivel(lab, CAMPOS["turbidez_ntu"][2]), nota)

    # pH: mesma escala. Diferenca de ate 0,5 e o esperado para sensor de baixo custo.
    if analise.ph is not None:
        ph = a.get("ph")
        if ph is None:
            linha("ph", None, "", None, None, "O sensor de pH não tem leitura válida desta amostra.")
        else:
            dif = abs(ph - analise.ph)
            linha("ph", ph, "", _faixa_ph(ph), dif <= 0.5,
                  f"Diferença de {_br(dif, 2)}. Até 0,5 é aceitável para um sensor de baixo custo"
                  + ("." if dif <= 0.5 else ": recalibre o sensor de pH com as soluções padrão."))

    # Demais: unidades diferentes; compara o nivel.
    for campo, indice, explicacao in (
        ("clorofila_a_ug_l", "clorofila", "CONAMA: até 10 µg/L classe 1, até 30 µg/L classe 2"),
        ("cianobacterias_cel_ml", "cianobacterias", "CONAMA: até 20.000 cél/mL classe 1, até 50.000 classe 2"),
        ("cor_verdadeira_mg_pt_l", "materia_organica", "até 15 mg Pt/L potável, até 75 mg Pt/L classe 2"),
        ("solidos_suspensos_mg_l", "sedimentos", "sem faixa oficial: fica só como registro"),
    ):
        nivel_ap = (a.get("niveis") or {}).get(indice)
        nivel_lab = _nivel(getattr(analise, campo), CAMPOS[campo][2])
        concorda = None if nivel_ap is None or nivel_lab is None else nivel_ap == nivel_lab
        nota = ("O aparelho não tem sinal para este indicador nesta amostra." if a.get(indice) is None
                else f"Unidades diferentes: compara o nível ({explicacao}).")
        linha(campo, a.get(indice), "índice", nivel_ap, concorda, nota)

    avaliados = [l for l in linhas if l["concorda"] is not None]
    iguais = sum(l["concorda"] for l in avaliados)
    leitura_dia = None
    try:
        leitura_dia = datetime.strptime(a.get("leitura", "")[:10], "%d/%m/%Y").date()
    except ValueError:
        pass
    aviso_data = None
    if analise.data_coleta and leitura_dia and analise.data_coleta != leitura_dia:
        aviso_data = (f"Atenção: a coleta do laboratório é de {analise.data_coleta:%d/%m/%Y} e a leitura do aparelho, "
                      f"de {leitura_dia:%d/%m/%Y}. A água pode ter mudado entre um dia e outro.")
    return {
        "id": analise.pk,
        "laboratorio": analise.laboratorio,
        "data_coleta": analise.data_coleta.strftime("%d/%m/%Y") if analise.data_coleta else None,
        "enviado_em": timezone.localtime(analise.enviado_em).strftime("%d/%m/%Y %H:%M") if analise.enviado_em else None,
        "observacoes": analise.observacoes,
        "linhas": linhas,
        "resumo": (f"{iguais} de {len(avaliados)} parâmetros com o mesmo resultado do laboratório."
                   if avaliados else "Nenhum parâmetro pôde ser comparado (o aparelho não tem leitura válida deles)."),
        "aviso_data": aviso_data,
    }
