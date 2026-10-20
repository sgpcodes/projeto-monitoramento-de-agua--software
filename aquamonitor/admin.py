from django.contrib import admin

from .models import Coleta, Leitura


@admin.register(Coleta)
class ColetaAdmin(admin.ModelAdmin):
    list_display = ("data_coleta", "total_leituras")
    date_hierarchy = "data_coleta"

    @admin.display(description="Leituras")
    def total_leituras(self, obj):
        return obj.leituras.count()


@admin.register(Leitura)
class LeituraAdmin(admin.ModelAdmin):
    list_display = (
        "medido_em",
        "amostra",
        "tipo",
        "led",
        "replica",
        "ganho",
        "saturado",
    )
    list_filter = ("tipo", "led", "saturado", "ganho")
    search_fields = ("amostra",)
    date_hierarchy = "medido_em"
    readonly_fields = ("recebido_em", "dados_originais")
