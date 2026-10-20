(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const shell = document.querySelector(".app-shell");
  const healthIndicator = document.getElementById("health-indicator");
  const healthLabel = document.getElementById("health-label");
  const liveClock = document.getElementById("live-clock");
  const updatedLabel = document.getElementById("data-updated");
  const SVG_NS = "http://www.w3.org/2000/svg";
  const channelColors = ["#7952c7", "#4c78ed", "#18a6d5", "#21b98a", "#94bf36", "#e8a926", "#ed7845", "#e34e5a"];
  const presentationSample = {
    data: "2026-10-20",
    atualizado_em: "2026-10-20T14:02:10-03:00",
    total_leituras: 1,
    total_amostras: 1,
    estouradas: 0,
    ultima_leitura: "14:02",
    demo: true,
    turbidez: {
      ntu: 18.4,
      tensao_v: 4.12,
      classificacao: "LEVEMENTE TURVA",
    },
    diagnostico: {
      turbidez: "LEVEMENTE TURVA",
      algas: "SINAL FRACO",
      cor: "NORMAL",
      contaminacao_pct: 20,
      contaminacao: "LEVEMENTE CONTAMINADA",
      resumo: "Água levemente turva, com sinal fraco de algas e cor normal.",
    },
    cores: [
      { nome: "Violeta", comprimento_onda_nm: 415, valor: 2394, porcentagem: 57.0 },
      { nome: "Azul", comprimento_onda_nm: 445, valor: 4802, porcentagem: 49.0 },
      { nome: "Ciano", comprimento_onda_nm: 480, valor: 4576, porcentagem: 52.0 },
      { nome: "Verde", comprimento_onda_nm: 515, valor: 4860, porcentagem: 54.0 },
      { nome: "Verde-amarelo", comprimento_onda_nm: 555, valor: 5225, porcentagem: 55.0 },
      { nome: "Amarelo", comprimento_onda_nm: 590, valor: 4920, porcentagem: 60.0 },
      { nome: "Laranja", comprimento_onda_nm: 630, valor: 3965, porcentagem: 65.0 },
      { nome: "Vermelho", comprimento_onda_nm: 680, valor: 1404, porcentagem: 54.0 },
    ],
    leituras: [{
      hora: "14:02:10",
      amostra: "lagoa",
      tipo: "amostra",
      tipo_display: "Amostra",
      led: "—",
      replica: "—",
      turbidez: 18.4,
      turbidez_unidade: "NTU",
      saturado: false,
    }],
    chart_data: [{ hora: "14:02", amostra: "lagoa", turbidez: 18.4 }],
    espectro: {
      rotulos: [],
      etiquetas: ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"],
      unidade: "Contagem digital",
      semanas: [{
        data: "2026-10-20",
        valores: [],
        porcentagens: [],
      }],
    },
    live: {
      rotulos: [],
      valores: [],
      porcentagens: [],
    },
  };
  presentationSample.espectro.rotulos = presentationSample.cores.map((color) => String(color.comprimento_onda_nm));
  presentationSample.espectro.semanas[0].valores = presentationSample.cores.map((color) => color.valor);
  presentationSample.espectro.semanas[0].porcentagens = presentationSample.cores.map((color) => color.porcentagem);
  presentationSample.live.rotulos = presentationSample.cores.map((color) => String(color.comprimento_onda_nm));
  presentationSample.live.valores = presentationSample.cores.map((color) => color.valor);
  presentationSample.live.porcentagens = presentationSample.cores.map((color) => color.porcentagem);
  let rows = [];

  const readJSON = (id) => {
    const element = document.getElementById(id);
    if (!element) return null;
    try {
      return JSON.parse(element.textContent);
    } catch {
      return null;
    }
  };

  const addSVG = (parent, tag, attrs = {}) => {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
    parent.append(element);
    return element;
  };

  const svgText = (parent, x, y, text, attrs = {}) => {
    const element = addSVG(parent, "text", { x, y, ...attrs });
    element.textContent = text;
    return element;
  };

  function setChartState(wrapId, emptyId, hasData) {
    const wrap = document.getElementById(wrapId);
    const empty = document.getElementById(emptyId);
    if (wrap) wrap.hidden = !hasData;
    if (empty) empty.hidden = hasData;
  }

  function renderTurbidityChart(points = []) {
    const chart = document.getElementById("turbidity-chart");
    const validPoints = points.filter((point) => Number.isFinite(point.turbidez));
    setChartState("turbidity-wrap", "turbidity-empty", validPoints.length > 0);
    if (!chart || !validPoints.length) return;

    const width = 900;
    const height = 215;
    const margin = { top: 15, right: 18, bottom: 32, left: 54 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const values = validPoints.map((point) => point.turbidez);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      min -= Math.max(Math.abs(min) * 0.1, 0.1);
      max += Math.max(Math.abs(max) * 0.1, 0.1);
    }
    const padding = (max - min) * 0.15;
    min -= padding;
    max += padding;
    const x = (index) => margin.left + (validPoints.length === 1 ? plotWidth / 2 : (index / (validPoints.length - 1)) * plotWidth);
    const y = (value) => margin.top + ((max - value) / (max - min)) * plotHeight;

    chart.replaceChildren();
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    chart.setAttribute("preserveAspectRatio", "none");
    for (let index = 0; index <= 4; index += 1) {
      const value = max - ((max - min) * index) / 4;
      const lineY = y(value);
      addSVG(chart, "line", { x1: margin.left, y1: lineY, x2: width - margin.right, y2: lineY, class: "grid-line" });
      svgText(chart, margin.left - 10, lineY + 3, value.toFixed(2), { class: "axis-text", "text-anchor": "end" });
    }

    const line = validPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.turbidez)}`).join(" ");
    const area = `${line} L ${x(validPoints.length - 1)} ${height - margin.bottom} L ${x(0)} ${height - margin.bottom} Z`;
    const defs = addSVG(chart, "defs");
    const gradient = addSVG(defs, "linearGradient", { id: "turbidity-fill", x1: "0", y1: "0", x2: "0", y2: "1" });
    addSVG(gradient, "stop", { offset: "0%", "stop-color": "#11a9b6", "stop-opacity": "0.25" });
    addSVG(gradient, "stop", { offset: "100%", "stop-color": "#11a9b6", "stop-opacity": "0" });
    addSVG(chart, "path", { d: area, fill: "url(#turbidity-fill)" });
    addSVG(chart, "path", { d: line, class: "series-line", stroke: "#0799a9" });

    validPoints.forEach((point, index) => {
      const dot = addSVG(chart, "circle", {
        cx: x(index), cy: y(point.turbidez), r: 4.5, fill: "#fff",
        stroke: "#0799a9", class: "series-dot",
      });
      addSVG(dot, "title").textContent = `${point.hora} · ${point.amostra}: ${point.turbidez.toFixed(4)}`;
    });
  }

  function renderSpectrumChart(data) {
    const chart = document.getElementById("spectrum-chart");
    const spectrum = data?.espectro;
    const values = spectrum?.semanas?.[0]?.valores;
    const labels = spectrum?.rotulos;
    const hasData = Array.isArray(values) && values.length > 0 && values.every(Number.isFinite);
    setChartState("spectrum-wrap", "spectrum-empty", hasData);
    if (!chart || !hasData) return;

    const width = 900;
    const height = 300;
    const margin = { top: 24, right: 22, bottom: 56, left: 64 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) max += Math.max(Math.abs(max) * 0.1, 0.1);
    const padding = Math.max((max - min) * 0.12, max * 0.04);
    min = Math.max(0, min - padding);
    max += padding;
    const x = (index) => margin.left + (values.length === 1 ? plotWidth / 2 : (index / (values.length - 1)) * plotWidth);
    const y = (value) => margin.top + ((max - value) / (max - min)) * plotHeight;
    const description = document.getElementById("spectrum-description");
    if (description) {
      description.textContent = `${spectrum.unidade || "Absorbância (u.a.)"} por comprimento de onda (nm)${data.demo ? " · valores fornecidos para demonstração" : ""}.`;
    }

    chart.replaceChildren();
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    chart.setAttribute("preserveAspectRatio", "none");
    for (let index = 0; index <= 4; index += 1) {
      const value = max - ((max - min) * index) / 4;
      const lineY = y(value);
      addSVG(chart, "line", { x1: margin.left, y1: lineY, x2: width - margin.right, y2: lineY, class: "grid-line" });
      const tick = spectrum.unidade === "Contagem digital"
        ? Math.round(value).toLocaleString("pt-BR")
        : value.toFixed(2);
      svgText(chart, margin.left - 10, lineY + 3, tick, { class: "axis-text", "text-anchor": "end" });
    }
    svgText(chart, 15, margin.top + plotHeight / 2, "Absorbância (u.a.)", {
      class: "axis-label",
      "text-anchor": "middle",
      transform: `rotate(-90 15 ${margin.top + plotHeight / 2})`,
    });
    const pathPoints = values.map((value, index) => ({ x: x(index), y: y(value) }));
    const fillPath = `${pathPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")} L ${x(values.length - 1)} ${height - margin.bottom} L ${x(0)} ${height - margin.bottom} Z`;
    const defs = addSVG(chart, "defs");
    const gradient = addSVG(defs, "linearGradient", { id: "spectrum-fill", x1: "0", y1: "0", x2: "0", y2: "1" });
    addSVG(gradient, "stop", { offset: "0%", "stop-color": "#21b98a", "stop-opacity": "0.2" });
    addSVG(gradient, "stop", { offset: "100%", "stop-color": "#21b98a", "stop-opacity": "0" });
    addSVG(chart, "path", { d: fillPath, fill: "url(#spectrum-fill)" });
    pathPoints.slice(0, -1).forEach((point, index) => {
      const next = pathPoints[index + 1];
      const middle = (point.x + next.x) / 2;
      const segment = `M ${point.x} ${point.y} C ${middle} ${point.y}, ${middle} ${next.y}, ${next.x} ${next.y}`;
      addSVG(chart, "path", {
        d: segment,
        fill: "none",
        stroke: channelColors[index],
        class: "series-line spectrum-segment",
      });
    });
    values.forEach((value, index) => {
      const channelLabel = spectrum.etiquetas?.[index] || labels[index];
      svgText(chart, x(index), height - 29, channelLabel, { class: "axis-text", "text-anchor": "middle" });
      svgText(chart, x(index), height - 10, labels[index], { class: "axis-text", "text-anchor": "middle" });
      const dot = addSVG(chart, "circle", {
        cx: x(index), cy: y(value), r: 4.5, fill: "#fff",
        stroke: channelColors[index % channelColors.length], class: "series-dot",
      });
      const percentage = spectrum.semanas[0].porcentagens?.[index];
      const reading = spectrum.unidade === "Contagem digital"
        ? `${value.toLocaleString("pt-BR")} contagens${percentage == null ? "" : ` · ${percentage}%`}`
        : `absorbância ${value.toFixed(4)}`;
      addSVG(dot, "title").textContent = `${presentationSample.cores[index]?.nome || "Canal"} · ${labels[index]} nm · ${reading}`;
    });
  }

  function renderLiveChart(data) {
    const chart = document.getElementById("live-chart");
    const live = data?.live;
    const values = live?.valores;
    const labels = live?.rotulos;
    const hasData = Array.isArray(values) && values.length > 0 && values.every(Number.isFinite);
    setChartState("live-wrap", "live-empty", hasData);
    if (!chart || !hasData) return;

    const width = 900;
    const height = 260;
    const margin = { top: 20, right: 20, bottom: 42, left: 58 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const maxValue = Math.max(...values, 1) * 1.12;
    const gap = 8;
    const barWidth = (plotWidth - gap * (values.length - 1)) / values.length;
    chart.replaceChildren();
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    chart.setAttribute("preserveAspectRatio", "none");
    for (let index = 0; index <= 4; index += 1) {
      const value = maxValue - (maxValue * index) / 4;
      const lineY = margin.top + (plotHeight * index) / 4;
      addSVG(chart, "line", { x1: margin.left, y1: lineY, x2: width - margin.right, y2: lineY, class: "grid-line" });
      svgText(chart, margin.left - 10, lineY + 3, Math.round(value), { class: "axis-text", "text-anchor": "end" });
    }
    values.forEach((value, index) => {
      const barHeight = (value / maxValue) * plotHeight;
      const barX = margin.left + index * (barWidth + gap);
      const barY = margin.top + plotHeight - barHeight;
      const bar = addSVG(chart, "rect", {
        x: barX, y: barY, width: barWidth, height: barHeight, rx: 5,
        fill: channelColors[index % channelColors.length], class: "bar-live",
      });
      const percentage = live.porcentagens?.[index];
      addSVG(bar, "title").textContent = `${presentationSample.cores[index]?.nome || "Canal"} · ${labels[index]} nm · ${value.toLocaleString("pt-BR")} contagens${percentage == null ? "" : ` · ${percentage}%`}`;
      svgText(chart, barX + barWidth / 2, height - 18, labels[index], { class: "axis-text", "text-anchor": "middle" });
    });
  }

  function renderReadings(data) {
    const body = document.getElementById("readings-body");
    if (!body) return;
    body.replaceChildren();
    const readings = data.leituras || [];
    readings.forEach((reading) => {
      const row = document.createElement("tr");
      row.dataset.sample = reading.amostra.toLocaleLowerCase("pt-BR");
      row.dataset.type = reading.tipo;
      const cells = [
        ["time-cell", reading.hora],
        ["sample-cell", reading.amostra],
        ["", reading.tipo_display],
        ["", reading.led],
        ["", String(reading.replica)],
        ["numeric-cell", reading.turbidez == null
          ? "—"
          : reading.turbidez_unidade
            ? `${Number(reading.turbidez).toLocaleString("pt-BR")} ${reading.turbidez_unidade}`
            : Number(reading.turbidez).toFixed(3)],
      ];
      cells.forEach(([className, text], index) => {
        const cell = row.insertCell();
        if (className) cell.className = className;
        if (index === 2) {
          const badge = document.createElement("span");
          badge.className = `type-badge type-${reading.tipo}`;
          badge.textContent = text;
          cell.append(badge);
        } else {
          cell.textContent = text;
        }
      });
      const stateCell = row.insertCell();
      const state = document.createElement("span");
      state.className = `state-badge ${reading.saturado ? "state-warning" : "state-ok"}`;
      const indicator = document.createElement("i");
      indicator.setAttribute("aria-hidden", "true");
      state.append(indicator, document.createTextNode(reading.saturado ? "Saturada" : "Normal"));
      stateCell.append(state);
      body.append(row);
    });
    if (!readings.length) {
      const row = body.insertRow();
      row.dataset.empty = "true";
      const cell = row.insertCell();
      cell.colSpan = 7;
      cell.className = "empty-row";
      cell.textContent = "Nenhuma leitura recebida para esta data.";
    }
    rows = [...body.querySelectorAll("tr:not([data-empty])")];
    filterReadings();
  }

  function filterReadings() {
    const search = document.getElementById("reading-search")?.value.trim().toLocaleLowerCase("pt-BR") ?? "";
    const sample = document.getElementById("sample-filter")?.value.toLocaleLowerCase("pt-BR") ?? "";
    const type = document.getElementById("type-filter")?.value ?? "";
    let visible = 0;
    rows.forEach((row) => {
      const matches = (row.dataset.sample || "").includes(search)
        && (!sample || row.dataset.sample === sample)
        && (!type || row.dataset.type === type);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    const count = document.getElementById("visible-count");
    const noResults = document.getElementById("no-results");
    if (count) count.textContent = String(visible);
    if (noResults) noResults.hidden = visible !== 0 || rows.length === 0;
  }

  function updateSampleFilter(readings) {
    const select = document.getElementById("sample-filter");
    if (!select) return;
    const selected = select.value;
    const samples = [...new Set(readings.map((reading) => reading.amostra))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    select.replaceChildren(new Option("Todas as amostras", ""));
    samples.forEach((sample) => select.add(new Option(sample, sample.toLocaleLowerCase("pt-BR"))));
    select.value = samples.some((sample) => sample.toLocaleLowerCase("pt-BR") === selected) ? selected : "";
  }

  function renderColetasTable() {
    const body = document.getElementById("coletas-body");
    const count = document.getElementById("coletas-count");
    if (!body) return;
    body.replaceChildren();
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 7;
    cell.className = "empty-row";
    cell.textContent = "O cadastro de campo (Secchi, chuva, temperatura e fotos) ainda não está conectado a este painel.";
    if (count) count.textContent = "0";
  }

  function renderDashboard(data) {
    if (!data || data.data !== shell?.dataset.selectedDate) return;
    const sampleAnalysis = document.getElementById("sample-analysis");
    const diagnosis = data.diagnostico;
    if (sampleAnalysis) sampleAnalysis.hidden = !diagnosis;
    if (diagnosis) {
      const latestSample = data.leituras?.find((reading) => reading.tipo === "amostra");
      const fields = {
        "sample-name": latestSample?.amostra || "—",
        "sample-time": latestSample?.hora || data.ultima_leitura || "—",
        "sample-turbidity": data.turbidez?.ntu == null ? "—" : `${data.turbidez.ntu.toLocaleString("pt-BR")} NTU`,
        "sample-turbidity-class": diagnosis.turbidez || "—",
        "sample-voltage": data.turbidez?.tensao_v == null
          ? "—"
          : `${data.turbidez.tensao_v.toLocaleString("pt-BR")} V`,
        "sample-algae": diagnosis.algas || "—",
        "sample-color": diagnosis.cor || "—",
        "sample-contamination": `${diagnosis.contaminacao_pct}%`,
        "sample-contamination-class": diagnosis.contaminacao || "—",
        "sample-summary": diagnosis.resumo || "",
      };
      Object.entries(fields).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
      });
    }
    const syncBadge = document.getElementById("sync-badge");
    const syncMessage = document.getElementById("sync-message");
    if (syncBadge) syncBadge.textContent = data.demo ? "DADOS DE DEMONSTRAÇÃO" : "SINCRONIZAÇÃO";
    if (syncMessage) {
      syncMessage.textContent = data.demo
        ? "Valores informados como exemplo; não foram enviados pelo Arduino nem gravados no banco."
        : "Leituras reais recebidas pelo ESP32 aparecem automaticamente aqui.";
    }
    const kpis = document.querySelectorAll(".kpi-card [data-count]");
    [data.total_leituras, data.total_amostras, data.estouradas].forEach((value, index) => {
      const element = kpis[index];
      if (element) {
        element.dataset.count = String(value);
        element.textContent = String(value);
      }
    });
    const latest = document.querySelector(".kpi-value-time");
    if (latest) latest.textContent = data.ultima_leitura || "—";
    const contamination = document.getElementById("kpi-contaminacao");
    const contaminationBadge = document.getElementById("kpi-contaminacao-badge");
    if (contamination) contamination.textContent = diagnosis ? `${diagnosis.contaminacao_pct}%` : "—";
    if (contaminationBadge) contaminationBadge.textContent = diagnosis?.contaminacao || "—";
    const updateTime = document.getElementById("data-updated");
    if (updateTime) {
      const timestamp = data.atualizado_em ? new Date(data.atualizado_em) : new Date();
      updateTime.textContent = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      }).format(timestamp);
    }

    const readings = data.leituras || [];
    updateSampleFilter(readings);
    renderReadings(data);
    renderTurbidityChart(data.chart_data || []);
    renderSpectrumChart(data);
    renderLiveChart(data);
    renderColetasTable();
  }

  setChartState("series-wrap", "series-empty", false);
  setChartState("scatter-wrap", "scatter-empty", false);
  const seriesControls = document.querySelector(".segmented");
  if (seriesControls) seriesControls.hidden = true;

  document.getElementById("reading-search")?.addEventListener("input", filterReadings);
  document.getElementById("sample-filter")?.addEventListener("change", filterReadings);
  document.getElementById("type-filter")?.addEventListener("change", filterReadings);

  function exportVisibleReadings() {
    const visibleRows = rows.filter((row) => !row.hidden);
    if (!visibleRows.length) return;
    const table = document.querySelector("#readings .readings-table");
    const headers = [...table.querySelectorAll("thead th")].map((cell) => cell.textContent.trim());
    const values = visibleRows.map((row) => [...row.cells].map((cell) => cell.textContent.trim()));
    const escapeCsv = (value) => `"${value.replaceAll('"', '""')}"`;
    const csv = [headers, ...values].map((record) => record.map(escapeCsv).join(",")).join("\r\n");
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(file);
    link.href = url;
    link.download = `aquamonitor-${shell?.dataset.selectedDate ?? "leituras"}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  document.getElementById("export-csv")?.addEventListener("click", exportVisibleReadings);

  const themeToggle = document.getElementById("theme-toggle");
  const themeColor = document.getElementById("theme-color");

  function applyTheme(theme, persist = false) {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    if (themeToggle) {
      themeToggle.setAttribute("aria-pressed", String(isDark));
      themeToggle.setAttribute("aria-label", isDark ? "Ativar tema claro" : "Ativar tema escuro");
      const label = themeToggle.querySelector(".theme-toggle-label");
      if (label) label.textContent = isDark ? "Tema claro" : "Tema escuro";
    }
    if (themeColor) themeColor.setAttribute("content", isDark ? "#07131b" : "#f3fbfc");
    if (!persist) return;
    try {
      localStorage.setItem("aquamonitor-theme", isDark ? "dark" : "light");
    } catch (error) {
      console.error("Não foi possível salvar a preferência de tema.", error);
    }
  }

  applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  themeToggle?.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
  });

  function updateClock() {
    if (!liveClock) return;
    liveClock.textContent = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(new Date());
  }
  updateClock();
  window.setInterval(updateClock, 1000);

  async function checkApplicationHealth() {
    const url = shell?.dataset.healthUrl;
    if (!url || !healthIndicator || !healthLabel) return;
    try {
      const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      const health = response.ok ? await response.json() : null;
      const online = health?.status === "ok";
      healthIndicator.classList.toggle("is-online", online);
      healthIndicator.classList.toggle("is-offline", !online);
      healthLabel.textContent = online ? "API disponível" : "API indisponível";
    } catch {
      healthIndicator.classList.remove("is-online");
      healthIndicator.classList.add("is-offline");
      healthLabel.textContent = "API indisponível";
    }
  }
  checkApplicationHealth();
  window.setInterval(checkApplicationHealth, 30000);

  async function refreshDashboard() {
    const endpoint = shell?.dataset.dashboardUrl;
    if (!endpoint || document.hidden) return;
    const url = new URL(endpoint, window.location.href);
    url.searchParams.set("data", shell.dataset.selectedDate);
    try {
      const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderDashboard(dashboardDataWithSample(await response.json()));
    } catch (error) {
      if (updatedLabel) updatedLabel.textContent = "falha na sincronização; tentando novamente";
      console.error("Não foi possível atualizar os dados do painel.", error);
    }
  }

  function dashboardDataWithSample(data) {
    if (
      data?.data === presentationSample.data
      && data.total_leituras === 0
      && shell?.dataset.selectedDate === presentationSample.data
    ) {
      return { ...presentationSample, atualizado_em: data.atualizado_em };
    }
    return data;
  }

  renderDashboard(dashboardDataWithSample(readJSON("dashboard-data")));
  window.setInterval(refreshDashboard, 15000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshDashboard();
  });

  document.querySelectorAll("[data-reveal]").forEach((element) => {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      element.classList.add("is-revealed");
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -36px 0px" });
    observer.observe(element);
  });

  const sections = [...document.querySelectorAll(".page-content section[id], .page-content > div[id]")];
  if ("IntersectionObserver" in window) {
    const navObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        document.querySelectorAll(".nav-link").forEach((link) => {
          link.classList.toggle("is-active", link.getAttribute("href") === `#${entry.target.id}`);
        });
      });
    }, { rootMargin: "-25% 0px -65% 0px" });
    sections.forEach((section) => navObserver.observe(section));
  }
})();
