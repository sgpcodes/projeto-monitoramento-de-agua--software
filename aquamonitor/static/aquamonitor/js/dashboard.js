(() => {
  "use strict";

  /* ============================================================
     AquaMonitor · dashboard.js
     - Mantém: filtros, export CSV, relógio, health check, gráfico SVG
     - Adiciona: cursor, canvas de fundo, scroll reveal, contadores,
                 tilt 3D, magnetic buttons, hover do cursor,
                 espectro, evolução, dispersão, leitura ao vivo,
                 tabela de coletas (com mocks quando a view não passa).
     - Sem dependências externas.
     ============================================================ */

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTouch = window.matchMedia("(hover: none)").matches;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const SHELL = document.querySelector(".app-shell");
  const rows = [...document.querySelectorAll("#readings-body tr")];
  const searchInput = document.getElementById("reading-search");
  const sampleFilter = document.getElementById("sample-filter");
  const typeFilter = document.getElementById("type-filter");
  const visibleCount = document.getElementById("visible-count");
  const noResults = document.getElementById("no-results");
  const exportButton = document.getElementById("export-csv");
  const healthIndicator = document.getElementById("health-indicator");
  const healthLabel = document.getElementById("health-label");
  const liveClock = document.getElementById("live-clock");

  /* ============================================================
     0) HELPERS
     ============================================================ */
  const readJSON = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch {
      return null;
    }
  };

  const addSVG = (parent, tag, attrs = {}) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    parent.append(el);
    return el;
  };

  const svgText = (parent, x, y, text, attrs = {}) => {
    const el = addSVG(parent, "text", { x, y, ...attrs });
    el.textContent = text;
    return el;
  };

  const observeOnce = (el, cb, threshold = 0.3) => {
    if (!el) return;
    if (reduceMotion || !("IntersectionObserver" in window)) { cb(); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          cb();
          io.unobserve(entry.target);
        }
      });
    }, { threshold });
    io.observe(el);
  };

  /* ============================================================
     1) FILTROS DA TABELA
     ============================================================ */
  function filterReadings() {
    const search = searchInput?.value.trim().toLocaleLowerCase("pt-BR") ?? "";
    const sample = sampleFilter?.value.toLocaleLowerCase("pt-BR") ?? "";
    const type = typeFilter?.value ?? "";
    let visible = 0;

    for (const row of rows) {
      const matches =
        (row.dataset.sample || "").includes(search) &&
        (!sample || row.dataset.sample === sample) &&
        (!type || row.dataset.type === type);
      row.hidden = !matches;
      if (matches) visible += 1;
    }

    if (visibleCount) visibleCount.textContent = String(visible);
    if (noResults) noResults.hidden = visible !== 0;
  }

  searchInput?.addEventListener("input", filterReadings);
  sampleFilter?.addEventListener("change", filterReadings);
  typeFilter?.addEventListener("change", filterReadings);

  /* ============================================================
     2) EXPORT CSV
     ============================================================ */
  function exportVisibleReadings() {
    const visibleRows = rows.filter((row) => !row.hidden);
    if (!visibleRows.length) return;

    const headers = [...document.querySelectorAll(".readings-table thead th")].map(
      (cell) => cell.textContent.trim(),
    );
    const values = visibleRows.map((row) =>
      [...row.cells].map((cell) => cell.textContent.trim()),
    );
    const escapeCsv = (value) => `"${value.replaceAll('"', '""')}"`;
    const csv = [headers, ...values]
      .map((record) => record.map(escapeCsv).join(","))
      .join("\r\n");
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    const downloadUrl = URL.createObjectURL(file);
    const date = SHELL?.dataset.selectedDate ?? "leituras";

    link.href = downloadUrl;
    link.download = `aquamonitor-${date}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  exportButton?.addEventListener("click", exportVisibleReadings);

  /* ============================================================
     3) RELÓGIO AO VIVO
     ============================================================ */
  function updateClock() {
    if (!liveClock) return;
    liveClock.textContent = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date());
  }

  updateClock();
  window.setInterval(updateClock, 1000);

  /* ============================================================
     4) HEALTH CHECK
     ============================================================ */
  async function checkApplicationHealth() {
    const healthUrl = SHELL?.dataset.healthUrl;
    if (!healthUrl || !healthIndicator || !healthLabel) return;

    try {
      const response = await fetch(healthUrl, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
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

  /* ============================================================
     5) GRÁFICO TEMPORAL DE TURBIDEZ (dados reais da view)
     ============================================================ */
  function renderTurbidityChart() {
    const chart = document.getElementById("turbidity-chart");
    const dataElement = document.getElementById("chart-data");
    if (!chart || !dataElement) return;

    let points;
    try {
      points = JSON.parse(dataElement.textContent);
    } catch (error) {
      console.error("Não foi possível carregar os dados do gráfico.", error);
      return;
    }

    points = points.filter(
      (p) => Number.isFinite(p.turbidez) && typeof p.hora === "string",
    );
    if (!points.length) return;

    const width = 900;
    const height = 215;
    const margin = { top: 15, right: 17, bottom: 32, left: 48 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const values = points.map((p) => p.turbidez);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min -= 0.1; max += 0.1; }
    const pad = (max - min) * 0.15;
    min -= pad; max += pad;

    const x = (i) => margin.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const y = (v) => margin.top + ((max - v) / (max - min)) * plotH;

    chart.replaceChildren();
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    chart.setAttribute("preserveAspectRatio", "none");

    for (let i = 0; i <= 4; i += 1) {
      const value = max - ((max - min) * i) / 4;
      const ly = y(value);
      addSVG(chart, "line", { x1: margin.left, y1: ly, x2: width - margin.right, y2: ly, class: "grid-line" });
      svgText(chart, margin.left - 9, ly + 3, value.toFixed(2), { class: "axis-text", "text-anchor": "end" });
    }

    const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.turbidez)}`).join(" ");
    const area = `${line} L ${x(points.length - 1)} ${height - margin.bottom} L ${x(0)} ${height - margin.bottom} Z`;

    const defs = addSVG(chart, "defs", {});
    const grad = addSVG(defs, "linearGradient", { id: "grad-turb", x1: "0", y1: "0", x2: "0", y2: "1" });
    addSVG(grad, "stop", { offset: "0%", "stop-color": "#2fe0d0", "stop-opacity": "0.35" });
    addSVG(grad, "stop", { offset: "100%", "stop-color": "#2fe0d0", "stop-opacity": "0" });

    addSVG(chart, "path", { d: area, fill: "url(#grad-turb)" });
    const path = addSVG(chart, "path", {
      d: line, class: "series-line", stroke: "#2fe0d0",
    });

    if (!reduceMotion) {
      try {
        const total = path.getTotalLength();
        path.style.strokeDasharray = String(total);
        path.style.strokeDashoffset = String(total);
        path.style.transition = "stroke-dashoffset 1.4s cubic-bezier(.22,1,.36,1)";
        requestAnimationFrame(() => { path.style.strokeDashoffset = "0"; });
      } catch {}
    }

    points.forEach((p, i) => {
      const dot = addSVG(chart, "circle", {
        cx: x(i), cy: y(p.turbidez), r: points.length > 24 ? 3 : 4,
        fill: "#050b12", stroke: "#2fe0d0", class: "series-dot",
      });
      const title = addSVG(dot, "title", {});
      title.textContent = `${p.hora} · ${p.amostra}: ${p.turbidez.toFixed(3)}`;
    });

    const labelIdx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    labelIdx.forEach((i) => {
      svgText(chart, x(i), height - 8, points[i].hora, {
        class: "axis-text",
        "text-anchor": i === 0 ? "start" : i === points.length - 1 ? "end" : "middle",
      });
    });
  }

  /* ============================================================
     6) MOCKS (usados quando a view não passa os json_script)
     ============================================================ */
  const MOCKS = {
    espectro: {
      canais: ["f1_415", "f2_445", "f3_480", "f4_515", "f5_555", "f6_590", "f7_630", "f8_680"],
      rotulos: ["415", "445", "480", "515", "555", "590", "630", "680"],
      semanas: [
        { data: "2026-09-08", valores: [0.18, 0.22, 0.30, 0.26, 0.20, 0.17, 0.15, 0.13] },
        { data: "2026-09-15", valores: [0.22, 0.27, 0.34, 0.30, 0.24, 0.20, 0.18, 0.16] },
        { data: "2026-09-22", valores: [0.26, 0.32, 0.38, 0.33, 0.27, 0.23, 0.20, 0.19] },
        { data: "2026-09-29", valores: [0.31, 0.37, 0.44, 0.38, 0.31, 0.27, 0.24, 0.22] },
        { data: "2026-10-06", valores: [0.36, 0.43, 0.51, 0.44, 0.36, 0.31, 0.28, 0.26] },
        { data: "2026-10-13", valores: [0.42, 0.50, 0.58, 0.50, 0.41, 0.36, 0.32, 0.30] },
      ],
    },
    serie: {
      algas:    [{ d: "2026-09-08", v: 0.05 }, { d: "2026-09-15", v: 0.08 }, { d: "2026-09-22", v: 0.12 }, { d: "2026-09-29", v: 0.10 }, { d: "2026-10-06", v: 0.17 }, { d: "2026-10-13", v: 0.21 }],
      turbidez: [{ d: "2026-09-08", v: 0.10 }, { d: "2026-09-15", v: 0.14 }, { d: "2026-09-22", v: 0.19 }, { d: "2026-09-29", v: 0.17 }, { d: "2026-10-06", v: 0.26 }, { d: "2026-10-13", v: 0.31 }],
      cor:      [{ d: "2026-09-08", v: 0.04 }, { d: "2026-09-15", v: 0.06 }, { d: "2026-09-22", v: 0.09 }, { d: "2026-09-29", v: 0.08 }, { d: "2026-10-06", v: 0.13 }, { d: "2026-10-13", v: 0.15 }],
      secchi:   [{ d: "2026-09-08", v: 48 }, { d: "2026-09-15", v: 44 }, { d: "2026-09-22", v: 40 }, { d: "2026-09-29", v: 42 }, { d: "2026-10-06", v: 36 }, { d: "2026-10-13", v: 33 }],
    },
    chuva: ["2026-09-22", "2026-10-06"],
    dispersao: [
      { secchi: 48, turbidez: 0.10 }, { secchi: 44, turbidez: 0.14 },
      { secchi: 40, turbidez: 0.19 }, { secchi: 42, turbidez: 0.17 },
      { secchi: 36, turbidez: 0.26 }, { secchi: 33, turbidez: 0.31 },
    ],
    live: {
      rotulos: ["415", "445", "480", "515", "555", "590", "630", "680", "CLEAR", "NIR"],
      cores:   ["#8b5cf6", "#6366f1", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#f97316", "#ef4444", "#2fe0d0", "#94a3b8"],
      valores: [812, 1530, 1720, 1850, 1990, 1640, 1210, 541, 9100, 311],
    },
    coletas: [
      { data_coleta: "2026-10-13", ponto: "Ponto 1 – píer", secchi_cm: 33, choveu_48h: true,  temperatura_agua: 26.0, observacao: "água esverdeada", foto: null },
      { data_coleta: "2026-10-06", ponto: "Ponto 1 – píer", secchi_cm: 36, choveu_48h: true,  temperatura_agua: 24.0, observacao: "turva após chuva", foto: null },
      { data_coleta: "2026-09-29", ponto: "Ponto 1 – píer", secchi_cm: 42, choveu_48h: false, temperatura_agua: 25.0, observacao: "estável", foto: null },
      { data_coleta: "2026-09-22", ponto: "Ponto 1 – píer", secchi_cm: 40, choveu_48h: true,  temperatura_agua: 23.5, observacao: "leve espuma", foto: null },
      { data_coleta: "2026-09-15", ponto: "Ponto 1 – píer", secchi_cm: 44, choveu_48h: false, temperatura_agua: 24.5, observacao: "—", foto: null },
      { data_coleta: "2026-09-08", ponto: "Ponto 1 – píer", secchi_cm: 48, choveu_48h: false, temperatura_agua: 23.0, observacao: "—", foto: null },
    ],
  };

  /* ============================================================
     7) DEMO NOTICE (mostra se algum json_script obrigatório faltar)
     ============================================================ */
  const required = ["espectro-data", "serie-data", "scatter-data", "live-data", "coletas-data"];
  const missing = required.some((id) => !document.getElementById(id));
  const demoNotice = document.getElementById("demo-notice");
  if (demoNotice) demoNotice.hidden = !missing;

  /* ============================================================
     8) GRÁFICO DE ESPECTRO (absorbância por canal)
     ============================================================ */
  function renderSpectrumChart() {
    const chart = document.getElementById("spectrum-chart");
    if (!chart) return;

    const real = readJSON("espectro-data");
    const data = real && Array.isArray(real.semanas) && real.semanas.length ? real : MOCKS.espectro;

    const width = 900;
    const height = 300;
    const margin = { top: 20, right: 20, bottom: 44, left: 50 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const labels = data.rotulos || data.canais || data.semanas[0].valores.map((_, i) => String(i));
    const n = labels.length;

    const allVals = data.semanas.flatMap((s) => s.valores);
    let min = Math.min(...allVals);
    let max = Math.max(...allVals);
    if (min === max) { min -= 0.1; max += 0.1; }
    const pad = (max - min) * 0.1;
    min = Math.max(0, min - pad);
    max += pad;

    const x = (i) => margin.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => margin.top + ((max - v) / (max - min)) * plotH;

    chart.replaceChildren();
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    chart.setAttribute("preserveAspectRatio", "none");

    for (let i = 0; i <= 4; i += 1) {
      const value = max - ((max - min) * i) / 4;
      const ly = y(value);
      addSVG(chart, "line", { x1: margin.left, y1: ly, x2: width - margin.right, y2: ly, class: "grid-line" });
      svgText(chart, margin.left - 10, ly + 3, value.toFixed(2), { class: "axis-text", "text-anchor": "end" });
    }

    labels.forEach((label, i) => {
      svgText(chart, x(i), height - 22, label, { class: "axis-label", "text-anchor": "middle" });
    });
    svgText(chart, width / 2, height - 4, "comprimento de onda (nm)", {
      class: "axis-label", "text-anchor": "middle",
    });

    const total = data.semanas.length;
    data.semanas.forEach((sem, idx) => {
      const t = total <= 1 ? 1 : idx / (total - 1);
      const color = `rgba(${Math.round(120 + 40 * t)}, ${Math.round(200 - 40 * t)}, ${Math.round(220 - 20 * t)}, ${0.35 + 0.6 * t})`;
      const line = sem.valores.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
      const path = addSVG(chart, "path", {
        d: line, fill: "none", stroke: color,
        "stroke-width": idx === total - 1 ? 2.6 : 1.8,
        "stroke-linecap": "round", "stroke-linejoin": "round",
      });
      if (idx === total - 1 && !reduceMotion) {
        try {
          const len = path.getTotalLength();
          path.style.strokeDasharray = String(len);
          path.style.strokeDashoffset = String(len);
          path.style.transition = "stroke-dashoffset 1.6s cubic-bezier(.22,1,.36,1)";
          requestAnimationFrame(() => { path.style.strokeDashoffset = "0"; });
        } catch {}
      }
      sem.valores.forEach((v, i) => {
        const dot = addSVG(chart, "circle", {
          cx: x(i), cy: y(v), r: idx === total - 1 ? 3.2 : 2.2,
          fill: "#050b12", stroke: color, class: "series-dot",
        });
        const title = addSVG(dot, "title", {});
        title.textContent = `${sem.data} · ${labels[i]} nm: ${v.toFixed(3)}`;
      });
    });
  }

  /* ============================================================
     9) GRÁFICO DE EVOLUÇÃO (com seletor)
     ============================================================ */
  function renderSeriesChart(indexKey = "algas") {
    const chart = document.getElementById("series-chart");
    if (!chart) return;

    const real = readJSON("serie-data");
    const realData = real && real[indexKey] ? real : null;
    const data = realData ? realData[indexKey] : MOCKS.serie[indexKey] || MOCKS.serie.algas;
    const chuva = realData ? (realData.chuva || []) : MOCKS.chuva;

    const width = 900;
    const height = 260;
    const margin = { top: 24, right: 22, bottom: 40, left: 50 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const values = data.map((p) => p.v);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min -= 0.1; max += 0.1; }
    const pad = (max - min) * 0.18;
    min -= pad; max += pad;

    const x = (i) => margin.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const y = (v) => margin.top + ((max - v) / (max - min)) * plotH;

    chart.replaceChildren();
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    chart.setAttribute("preserveAspectRatio", "none");

    for (let i = 0; i <= 4; i += 1) {
      const value = max - ((max - min) * i) / 4;
      const ly = y(value);
      addSVG(chart, "line", { x1: margin.left, y1: ly, x2: width - margin.right, y2: ly, class: "grid-line" });
      svgText(chart, margin.left - 10, ly + 3, value.toFixed(indexKey === "secchi" ? 0 : 2), { class: "axis-text", "text-anchor": "end" });
    }

    const gradId = `grad-series-${indexKey}`;
    const defs = addSVG(chart, "defs", {});
    const grad = addSVG(defs, "linearGradient", { id: gradId, x1: "0", y1: "0", x2: "0", y2: "1" });
    addSVG(grad, "stop", { offset: "0%", "stop-color": "#2fe0d0", "stop-opacity": "0.3" });
    addSVG(grad, "stop", { offset: "100%", "stop-color": "#2fe0d0", "stop-opacity": "0" });

    const line = data.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.v)}`).join(" ");
    const area = `${line} L ${x(data.length - 1)} ${height - margin.bottom} L ${x(0)} ${height - margin.bottom} Z`;
    addSVG(chart, "path", { d: area, fill: `url(#${gradId})` });
    const path = addSVG(chart, "path", { d: line, class: "series-line", stroke: "#2fe0d0" });

    if (!reduceMotion) {
      try {
        const len = path.getTotalLength();
        path.style.strokeDasharray = String(len);
        path.style.strokeDashoffset = String(len);
        path.style.transition = "stroke-dashoffset 1.4s cubic-bezier(.22,1,.36,1)";
        requestAnimationFrame(() => { path.style.strokeDashoffset = "0"; });
      } catch {}
    }

    data.forEach((p, i) => {
      const isRain = chuva.includes(p.d);
      const dot = addSVG(chart, "circle", {
        cx: x(i), cy: y(p.v), r: isRain ? 4.2 : 3.6,
        fill: isRain ? "#93c5fd" : "#050b12",
        stroke: isRain ? "#93c5fd" : "#2fe0d0", class: "series-dot",
      });
      const title = addSVG(dot, "title", {});
      title.textContent = `${p.d}${isRain ? " · chuva" : ""}: ${p.v}`;
    });

    const step = Math.max(1, Math.ceil(data.length / 6));
    data.forEach((p, i) => {
      if (i % step !== 0 && i !== data.length - 1) return;
      const [, mm, dd] = p.d.split("-");
      svgText(chart, x(i), height - 10, `${dd}/${mm}`, { class: "axis-text", "text-anchor": "middle" });
    });
  }

  /* ============================================================
     10) GRÁFICO DE DISPERSÃO (turbidez × transparência)
     ============================================================ */
  function renderScatterChart() {
    const chart = document.getElementById("scatter-chart");
    if (!chart) return;

    const real = readJSON("scatter-data");
    const data = Array.isArray(real) && real.length ? real : MOCKS.dispersao;

    const width = 900;
    const height = 260;
    const margin = { top: 20, right: 22, bottom: 42, left: 54 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const xs = data.map((p) => p.secchi);
    const ys = data.map((p) => p.turbidez);
    const xMin = Math.min(...xs) - 2;
    const xMax = Math.max(...xs) + 2;
    const yMin = Math.min(...ys) * 0.8;
    const yMax = Math.max(...ys) * 1.2;

    const x = (v) => margin.left + ((v - xMin) / (xMax - xMin)) * plotW;
    const y = (v) => margin.top + ((yMax - v) / (yMax - yMin)) * plotH;

    chart.replaceChildren();
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    chart.setAttribute("preserveAspectRatio", "none");

    for (let i = 0; i <= 4; i += 1) {
      const value = yMax - ((yMax - yMin) * i) / 4;
      const ly = y(value);
      addSVG(chart, "line", { x1: margin.left, y1: ly, x2: width - margin.right, y2: ly, class: "grid-line" });
      svgText(chart, margin.left - 10, ly + 3, value.toFixed(2), { class: "axis-text", "text-anchor": "end" });
    }
    for (let i = 0; i <= 4; i += 1) {
      const value = xMin + ((xMax - xMin) * i) / 4;
      const lx = x(value);
      addSVG(chart, "line", { x1: lx, y1: margin.top, x2: lx, y2: height - margin.bottom, class: "grid-line" });
      svgText(chart, lx, height - 22, value.toFixed(0), { class: "axis-text", "text-anchor": "middle" });
    }
    svgText(chart, margin.left + plotW / 2, height - 4, "transparência (cm)", { class: "axis-label", "text-anchor": "middle" });
    svgText(chart, 12, margin.top + plotH / 2, "turbidez", {
      class: "axis-label", "text-anchor": "middle", transform: `rotate(-90 12 ${margin.top + plotH / 2})`,
    });

    data.forEach((p) => {
      const dot = addSVG(chart, "circle", {
        cx: x(p.secchi), cy: y(p.turbidez), r: 5,
        fill: "rgba(47,224,208,0.18)", stroke: "#2fe0d0", class: "scatter-dot",
      });
      const title = addSVG(dot, "title", {});
      title.textContent = `Secchi ${p.secchi} cm · turbidez ${p.turbidez}`;
    });
  }

  /* ============================================================
     11) GRÁFICO DE LEITURA AO VIVO (barras por canal)
     ============================================================ */
  function renderLiveChart() {
    const chart = document.getElementById("live-chart");
    if (!chart) return;

    const real = readJSON("live-data");
    const data = real && real.valores ? real : MOCKS.live;

    const width = 900;
    const height = 260;
    const margin = { top: 20, right: 20, bottom: 44, left: 54 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const n = data.valores.length;
    const maxV = Math.max(...data.valores) * 1.15;

    const barGap = 6;
    const barW = (plotW - barGap * (n - 1)) / n;

    chart.replaceChildren();
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    chart.setAttribute("preserveAspectRatio", "none");

    for (let i = 0; i <= 4; i += 1) {
      const value = maxV - (maxV * i) / 4;
      const ly = margin.top + (plotH * i) / 4;
      addSVG(chart, "line", { x1: margin.left, y1: ly, x2: width - margin.right, y2: ly, class: "grid-line" });
      svgText(chart, margin.left - 10, ly + 3, Math.round(value), { class: "axis-text", "text-anchor": "end" });
    }

    data.valores.forEach((v, i) => {
      const h = (v / maxV) * plotH;
      const bx = margin.left + i * (barW + barGap);
      const by = margin.top + plotH - h;
      const rect = addSVG(chart, "rect", {
        x: bx, y: by, width: barW, height: h, rx: 3,
        fill: data.cores[i] || "#2fe0d0", opacity: 0.85, class: "bar-live",
      });
      if (!reduceMotion) {
        rect.style.transformBox = "fill-box";
        rect.style.transformOrigin = "bottom";
        rect.style.transform = "scaleY(0)";
        rect.style.transition = "transform .9s cubic-bezier(.22,1,.36,1)";
        requestAnimationFrame(() => { rect.style.transform = "scaleY(1)"; });
      }
      const title = addSVG(rect, "title", {});
      title.textContent = `${data.rotulos[i]}: ${v}`;
      svgText(chart, bx + barW / 2, height - 22, data.rotulos[i], { class: "axis-text", "text-anchor": "middle" });
    });
  }

  /* ============================================================
     12) TABELA DE COLETAS
     ============================================================ */
  function renderColetasTable() {
    const body = document.getElementById("coletas-body");
    const countEl = document.getElementById("coletas-count");
    if (!body) return;

    const real = readJSON("coletas-data");
    const data = Array.isArray(real) && real.length ? real : MOCKS.coletas;

    body.replaceChildren();
    if (!data.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "empty-row";
      td.textContent = "Nenhuma coleta cadastrada ainda.";
      tr.append(td);
      body.append(tr);
    } else {
      data.forEach((c) => {
        const tr = document.createElement("tr");
        const cells = [
          formatDate(c.data_coleta),
          c.ponto || "—",
          c.secchi_cm != null ? `${c.secchi_cm} cm` : "—",
          null,
          c.temperatura_agua != null ? `${c.temperatura_agua} °C` : "—",
          c.observacao || "—",
          null,
        ];
        cells.forEach((value, i) => {
          const td = document.createElement("td");
          if (i === 2 || i === 4) td.className = "numeric-cell";
          if (i === 3) {
            const badge = document.createElement("span");
            badge.className = `state-badge ${c.choveu_48h ? "state-warning" : "state-ok"}`;
            const dot = document.createElement("i");
            dot.setAttribute("aria-hidden", "true");
            badge.append(dot, document.createTextNode(c.choveu_48h ? "Sim" : "Não"));
            td.append(badge);
          } else if (i === 6) {
            if (c.foto) {
              const a = document.createElement("a");
              a.className = "foto-link";
              a.href = c.foto;
              a.target = "_blank";
              a.rel = "noopener";
              a.textContent = "ver foto";
              td.append(a);
            } else {
              td.textContent = "—";
            }
          } else {
            td.textContent = value;
            if (i === 5) td.className = "obs-cell";
          }
          tr.append(td);
        });
        body.append(tr);
      });
    }
    if (countEl) countEl.textContent = String(data.length);
  }

  function formatDate(iso) {
    if (!iso || typeof iso !== "string") return "—";
    const parts = iso.split("-");
    if (parts.length !== 3) return iso;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  /* ============================================================
     13) SELETOR DO GRÁFICO DE EVOLUÇÃO
     ============================================================ */
  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      renderSeriesChart(btn.dataset.index);
    });
  });

  /* ============================================================
     14) RENDER DOS GRÁFICOS COM LAZY (quando entram na tela)
     ============================================================ */
  observeOnce(document.getElementById("spectrum-chart"), renderSpectrumChart);
  observeOnce(document.getElementById("series-chart"), () => renderSeriesChart("algas"));
  observeOnce(document.getElementById("scatter-chart"), renderScatterChart);
  observeOnce(document.getElementById("live-chart"), renderLiveChart);
  observeOnce(document.getElementById("coletas-body"), renderColetasTable);
  renderTurbidityChart();

  /* ============================================================
     15) CURSOR CUSTOMIZADO (mais rápido: lerp 0.35)
     ============================================================ */
  const cursorDot = document.querySelector(".cursor-dot");
  const cursorRing = document.querySelector(".cursor-ring");

  if (!isTouch && !reduceMotion && cursorDot && cursorRing) {
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let ringX = mouseX;
    let ringY = mouseY;

    document.addEventListener("mousemove", (event) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      cursorDot.style.transform = `translate(${mouseX}px, ${mouseY}px) translate(-50%, -50%)`;
    });

    const animateRing = () => {
      ringX += (mouseX - ringX) * 0.35;
      ringY += (mouseY - ringY) * 0.35;
      cursorRing.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%, -50%)`;
      requestAnimationFrame(animateRing);
    };
    animateRing();

    const hoverTargets = "a, button, input, select, [data-magnetic], [data-tilt]";
    document.addEventListener("mouseover", (event) => {
      if (event.target.closest(hoverTargets)) cursorRing.classList.add("is-hover");
    });
    document.addEventListener("mouseout", (event) => {
      if (event.target.closest(hoverTargets)) cursorRing.classList.remove("is-hover");
    });
  }

  /* ============================================================
     16) CANVAS DE FUNDO (ondas suaves)
     ============================================================ */
  const canvas = document.getElementById("bg-canvas");
  if (canvas && !reduceMotion) {
    const ctx = canvas.getContext("2d");
    let width = 0, height = 0, dpr = 1, t = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const drawWave = (offsetY, amplitude, frequency, speed, color) => {
      ctx.beginPath();
      ctx.moveTo(0, offsetY);
      for (let x = 0; x <= width; x += 6) {
        const y = offsetY
          + Math.sin(x * frequency + t * speed) * amplitude
          + Math.sin(x * frequency * 0.5 + t * speed * 0.7) * (amplitude * 0.4);
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };

    const loop = () => {
      ctx.clearRect(0, 0, width, height);
      t += 0.008;
      drawWave(height * 0.28, 22, 0.006, 1.0, "rgba(47, 224, 208, 0.10)");
      drawWave(height * 0.45, 18, 0.0045, 0.8, "rgba(167, 139, 250, 0.08)");
      drawWave(height * 0.62, 26, 0.0055, 1.2, "rgba(59, 130, 246, 0.08)");
      drawWave(height * 0.78, 16, 0.0038, 0.6, "rgba(47, 224, 208, 0.06)");
      requestAnimationFrame(loop);
    };
    loop();
  }

  /* ============================================================
     17) SCROLL REVEAL
     ============================================================ */
  const revealElements = document.querySelectorAll("[data-reveal]");
  if (revealElements.length) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      revealElements.forEach((el) => el.classList.add("is-revealed"));
    } else {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-revealed");
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
      );
      revealElements.forEach((el) => observer.observe(el));
    }
  }

  /* ============================================================
     18) CONTADORES ANIMADOS (KPI)
     ============================================================ */
  const counters = document.querySelectorAll("[data-count]");
  const animateCounter = (el) => {
    const target = Number(el.getAttribute("data-count"));
    if (!Number.isFinite(target)) return;
    if (reduceMotion) { el.textContent = String(target); return; }
    const duration = 1200;
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = String(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = String(target);
    };
    requestAnimationFrame(step);
  };

  if (counters.length) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      counters.forEach((el) => {
        const target = Number(el.getAttribute("data-count"));
        if (Number.isFinite(target)) el.textContent = String(target);
      });
    } else {
      const counterObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              animateCounter(entry.target);
              counterObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.4 },
      );
      counters.forEach((el) => counterObserver.observe(el));
    }
  }

  /* ============================================================
     19) TILT 3D NOS CARDS + GLOW QUE SEGUE O MOUSE
     ============================================================ */
  if (!isTouch && !reduceMotion) {
    document.querySelectorAll("[data-tilt]").forEach((card) => {
      card.addEventListener("mousemove", (event) => {
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const px = x / rect.width;
        const py = y / rect.height;
        card.style.transform = `perspective(900px) rotateX(${(0.5 - py) * 6}deg) rotateY(${(px - 0.5) * 6}deg) translateY(-2px)`;
        card.style.setProperty("--mx", `${px * 100}%`);
        card.style.setProperty("--my", `${py * 100}%`);
      });
      card.addEventListener("mouseleave", () => { card.style.transform = ""; });
    });
  }

  /* ============================================================
     20) MAGNETIC BUTTONS
     ============================================================ */
  if (!isTouch && !reduceMotion) {
    document.querySelectorAll("[data-magnetic]").forEach((el) => {
      el.addEventListener("mousemove", (event) => {
        const rect = el.getBoundingClientRect();
        const x = event.clientX - rect.left - rect.width / 2;
        const y = event.clientY - rect.top - rect.height / 2;
        el.style.transform = `translate(${x * 0.15}px, ${y * 0.15}px)`;
      });
      el.addEventListener("mouseleave", () => { el.style.transform = ""; });
    });
  }

  /* ============================================================
     21) SCROLL SUAVE PARA LINKS INTERNOS
     ============================================================ */
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const id = link.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  });
})();