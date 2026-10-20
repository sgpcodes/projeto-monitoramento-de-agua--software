from datetime import date

from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone

from .models import Coleta
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
    }
    return render(request, "aquamonitor/dashboard.html", context)


def health(request):
    return JsonResponse({"status": "ok"})


def _numero(valor):
    return round(valor, 4) if valor is not None else None
