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
    amostras = sorted(
        {leitura.amostra for leitura in leituras if leitura.tipo == "amostra"}
    )
    ultimas = list(reversed(leituras[-12:]))
    for leitura in ultimas:
        leitura.metricas = metricas[leitura.pk]
    chart_data = [
        {
            "hora": timezone.localtime(leitura.medido_em).strftime("%H:%M"),
            "amostra": leitura.amostra,
            "turbidez": _numero(metricas[leitura.pk].get("turbidez")),
        }
        for leitura in leituras[-30:]
        if leitura.tipo == "amostra"
    ]
    context = {
        "data_selecionada": data_selecionada,
        "coleta": coleta,
        "leituras": ultimas,
        "metricas": metricas,
        "amostras": amostras,
        "total_leituras": len(leituras),
        "total_amostras": len(amostras),
        "ultima_leitura": leituras[-1] if leituras else None,
        "estouradas": sum(leitura.saturado for leitura in leituras),
        "chart_data": chart_data,
        "dashboard_data": _dados_painel(data_selecionada, leituras, metricas),
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


def _dados_painel(data_selecionada, leituras, metricas):
    amostras = [
        leitura for leitura in leituras if leitura.tipo == "amostra"
    ]
    pontos = [
        {
            "hora": timezone.localtime(leitura.medido_em).strftime("%H:%M"),
            "amostra": leitura.amostra,
            "turbidez": _numero(metricas[leitura.pk].get("turbidez")),
        }
        for leitura in amostras[-30:]
        if metricas[leitura.pk].get("turbidez") is not None
    ]
    ultima_amostra = amostras[-1] if amostras else None
    espectro = None
    live = None
    if ultima_amostra:
        absorbancia = metricas[ultima_amostra.pk].get("absorbancia", {})
        canais_espectro = CHANNELS[:8]
        valores_espectro = [absorbancia.get(canal) for canal in canais_espectro]
        if all(valor is not None for valor in valores_espectro):
            espectro = {
                "rotulos": [str(int(canal.split("_")[1])) for canal in canais_espectro],
                "semanas": [
                    {
                        "data": data_selecionada.isoformat(),
                        "valores": [_numero(valor) for valor in valores_espectro],
                    }
                ],
            }
        live = {
            "rotulos": [str(int(canal.split("_")[1])) for canal in canais_espectro],
            "valores": [_numero(ultima_amostra.media[canal]) for canal in canais_espectro],
        }

    return {
        "data": data_selecionada.isoformat(),
        "atualizado_em": timezone.localtime().isoformat(),
        "total_leituras": len(leituras),
        "total_amostras": len({leitura.amostra for leitura in amostras}),
        "estouradas": sum(leitura.saturado for leitura in leituras),
        "ultima_leitura": (
            timezone.localtime(leituras[-1].medido_em).strftime("%H:%M")
            if leituras
            else None
        ),
        "leituras": [
            {
                "hora": timezone.localtime(leitura.medido_em).strftime("%H:%M:%S"),
                "amostra": leitura.amostra,
                "tipo": leitura.tipo,
                "tipo_display": leitura.tipo,
                "led": leitura.led,
                "replica": leitura.replica,
                "turbidez": _numero(metricas[leitura.pk].get("turbidez")),
                "saturado": leitura.saturado,
            }
            for leitura in reversed(leituras[-12:])
        ],
        "chart_data": pontos,
        "espectro": espectro,
        "live": live,
    }


def _numero(valor):
    return round(valor, 4) if valor is not None else None
