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
    led = serializers.ChoiceField(choices=("nenhum", "frente", "lado"))
    replica = serializers.IntegerField(min_value=1, max_value=255)
    ganho = serializers.IntegerField()
    atime = serializers.IntegerField(min_value=0)
    astep = serializers.IntegerField(min_value=0)
    n = serializers.IntegerField(min_value=1)
    saturado = serializers.BooleanField()
    media = ChannelMapField()
    desvio = ChannelMapField()
    turbidez_mv = serializers.FloatField(allow_null=True)
    dp_turbidez_mv = serializers.FloatField(allow_null=True)
