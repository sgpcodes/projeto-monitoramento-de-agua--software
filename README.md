# AquaMonitor

Aplicação Django para receber e visualizar leituras de sensores de qualidade da água.

## Executar localmente (Windows)

No PowerShell, a partir da pasta do projeto:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Abra `http://127.0.0.1:8000/`. O ambiente local usa SQLite e inicia com `DEBUG=true`; as migrações criam as tabelas necessárias antes do primeiro acesso.

Para permitir o envio de leituras pelo dispositivo, configure a mesma chave que será enviada no cabeçalho `X-API-Key`:

```powershell
$env:ESP32_API_KEY = "sua-chave-local"
python manage.py runserver
```

## Configuração de produção

Configure no ambiente de produção:

- `DEBUG=false`
- `SECRET_KEY` com um segredo forte
- `DATABASE_URL` com a URL de conexão do PostgreSQL
- `ESP32_API_KEY` com uma chave forte compartilhada com o dispositivo

O blueprint de Render executa `collectstatic` na compilação, aplica as migrações na inicialização e verifica a aplicação em `/health/`. Configure `DATABASE_URL` no serviço com uma instância PostgreSQL antes do primeiro deploy.

## Rotas principais

- `/` — painel de monitoramento
- `/health/` — verificação de disponibilidade da aplicação
- `/api/leituras/` — endpoint autenticado para receber leituras
- `/api/dashboard/?data=AAAA-MM-DD` — dados reais da coleta selecionada para atualizar o painel
- `/admin/` — administração Django

O painel consulta `/api/dashboard/` a cada 15 segundos e atualiza indicadores, tabela e gráficos sem recarregar a página. Os gráficos só são preenchidos quando há medições reais; para os canais ópticos, a absorbância depende de uma leitura de calibração válida.

Na data `2026-10-20`, o painel pode apresentar os valores de demonstração fornecidos para a amostra “lagoa” quando ainda não houver leituras reais no banco. O aviso na tela identifica esses valores; eles não são enviados ao endpoint nem gravados como medições.

Execute os testes do painel com `python manage.py test aquamonitor.tests`.
