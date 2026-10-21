from django.urls import path

from . import api, views

urlpatterns = [
    path("", views.dashboard, name="dashboard"),
    path("amostras/", views.pagina_amostras, name="pagina_amostras"),
    path("historico/", views.pagina_historico, name="pagina_historico"),
    path("guia/", views.pagina_guia, name="pagina_guia"),
    path("health/", views.health, name="health"),
    path("api/dashboard/", views.dashboard_data, name="dashboard_data"),
    path("api/historico/", views.historico, name="historico"),
    path("api/amostras/", views.amostras, name="amostras"),
    path("api/leituras/", api.receber_leitura, name="receber_leitura"),
]
