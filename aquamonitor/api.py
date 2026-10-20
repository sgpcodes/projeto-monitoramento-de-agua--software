import hmac
import os

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Coleta, Leitura
from .serializers import LeituraSerializer


@api_view(["POST"])
@parser_classes([JSONParser])
@permission_classes([AllowAny])
def receber_leitura(request):
    chave_configurada = os.environ.get("ESP32_API_KEY", "")
    chave_recebida = request.headers.get("X-API-Key", "")
    if not chave_configurada or not hmac.compare_digest(
        chave_recebida.encode("utf-8"), chave_configurada.encode("utf-8")
    ):
        return Response(
            {"erro": "Chave de API inválida ou ausente."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    serializer = LeituraSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(
            {"erro": _mensagem_curta(serializer.errors)},
            status=status.HTTP_400_BAD_REQUEST,
        )

    dados = serializer.validated_data
    medido_em = dados.pop("medido_em", timezone.now())
    data_coleta = dados.pop("data_coleta")
    identificador = {
        "medido_em": medido_em,
        "tipo": dados["tipo"],
        "amostra": dados["amostra"],
        "led": dados["led"],
        "replica": dados["replica"],
    }
    with transaction.atomic():
        coleta, _ = Coleta.objects.get_or_create(data_coleta=data_coleta)
        try:
            with transaction.atomic():
                leitura = Leitura.objects.create(
                    collection=coleta,
                    medido_em=medido_em,
                    dados_originais=request.data,
                    **dados,
                )
        except IntegrityError:
            duplicada = Leitura.objects.filter(**identificador).first()
            if duplicada is None:
                raise
            return Response(
                {"status": "duplicada", "id": duplicada.pk},
                status=status.HTTP_200_OK,
            )
    return Response(
        {"status": "salva", "id": leitura.pk},
        status=status.HTTP_201_CREATED,
    )


def _mensagem_curta(erros):
    for campo, mensagens in erros.items():
        mensagem = mensagens[0] if isinstance(mensagens, list) else mensagens
        return f"{campo}: {mensagem}"[:300]
    return "JSON inválido ou campos ausentes."
