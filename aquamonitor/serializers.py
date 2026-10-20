from rest_framework import serializers


CHANNELS = (
    "f1_415",
    "f2_445",
    "f3_480",
    "f4_515",
    "f5_555",
    "f6_590",
    "f7_630",
    "f8_680",
    "clear",
    "nir",
)


class ChannelMapField(serializers.DictField):
    child = serializers.FloatField()

    def to_internal_value(self, data):
        values = super().to_internal_value(data)
        missing = [channel for channel in CHANNELS if channel not in values]
        if missing:
            raise serializers.ValidationError(
                f"Campos ausentes: {', '.join(missing)}."
            )
        return {channel: values[channel] for channel in CHANNELS}


class LeituraSerializer(serializers.Serializer):
    data_coleta = serializers.DateField()
    medido_em = serializers.DateTimeField(required=False)
    tipo = serializers.ChoiceField(choices=("escuro", "branco", "amostra"))
    amostra = serializers.CharField(max_length=20, default="sem_nome", trim_whitespace=True)
    led = serializers.ChoiceField(choices=("nenhum", "frente", "lado"), default="frente")
    replica = serializers.IntegerField(min_value=1, max_value=255, default=1)
    ganho = serializers.IntegerField(default=0)
    atime = serializers.IntegerField(min_value=0, default=0)
    astep = serializers.IntegerField(min_value=0, default=0)
    n = serializers.IntegerField(min_value=1, default=1)
    saturado = serializers.BooleanField(default=False)
    media = ChannelMapField()
    desvio = ChannelMapField(default=dict)
    turbidez_mv = serializers.FloatField(allow_null=True, default=None)
    dp_turbidez_mv = serializers.FloatField(allow_null=True, default=None)
    turbidez = serializers.JSONField(required=False, allow_null=True, default=None)
    cores = serializers.JSONField(required=False, allow_null=True, default=None)
    diagnostico = serializers.JSONField(required=False, allow_null=True, default=None)
