from django.urls import path

from . import api, views

urlpatterns = [
    path("", views.dashboard, name="dashboard"),
    path("health/", views.health, name="health"),
    path("api/dashboard/", views.dashboard_data, name="dashboard_data"),
    path("api/leituras/", api.receber_leitura, name="receber_leitura"),
]
