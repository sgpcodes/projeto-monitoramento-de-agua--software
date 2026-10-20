from django.db import models


class Coleta(models.Model):
    data_coleta = models.DateField(unique=True)
    criada_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-data_coleta"]
        verbose_name = "coleta"
        verbose_name_plural = "coletas"

    def __str__(self):
        return self.data_coleta.strftime("%d/%m/%Y")


class Leitura(models.Model):
    collection = models.ForeignKey(
        Coleta, on_delete=models.CASCADE, related_name="leituras"
    )
    tipo = models.CharField(max_length=16)
    amostra = models.CharField(max_length=20, default="sem_nome")
    led = models.CharField(max_length=16)
    replica = models.PositiveSmallIntegerField()
    medido_em = models.DateTimeField(db_index=True)
    recebido_em = models.DateTimeField(auto_now_add=True)
    ganho = models.IntegerField()
    atime = models.IntegerField()
    astep = models.IntegerField()
    n = models.PositiveIntegerField()
    saturado = models.BooleanField()
    media = models.JSONField()
    desvio = models.JSONField()
    turbidez_mv = models.FloatField(null=True, blank=True)
    dp_turbidez_mv = models.FloatField(null=True, blank=True)
    turbidez = models.JSONField(null=True, blank=True)
    cores = models.JSONField(null=True, blank=True)
    diagnostico = models.JSONField(null=True, blank=True)
    dados_originais = models.JSONField()

    class Meta:
        ordering = ["-medido_em"]
        constraints = [
            models.UniqueConstraint(
                fields=["medido_em", "tipo", "amostra", "led", "replica"],
                name="unique_sensor_reading",
            )
        ]
        indexes = [
            models.Index(
                fields=["collection", "medido_em"],
                name="aquamonito_collect_944dd9_idx",
            ),
            models.Index(
                fields=["collection", "amostra", "tipo"],
                name="aquamonito_collect_75c33c_idx",
            ),
        ]
        verbose_name = "leitura"
        verbose_name_plural = "leituras"

    def __str__(self):
        return f"{self.amostra} · {self.medido_em:%d/%m/%Y %H:%M}"
