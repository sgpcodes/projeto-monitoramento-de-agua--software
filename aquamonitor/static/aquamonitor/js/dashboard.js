(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTouch = window.matchMedia("(hover: none)").matches;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const SHELL = document.querySelector(".app-shell");
  const healthIndicator = document.getElementById("health-indicator");
  const healthLabel = document.getElementById("health-label");
  const liveClock = document.getElementById("live-clock");

  let rows = []; // preenchido depois que injetamos os dados

  /* ============================================================
     0) HELPERS
     ============================================================ */
  const readJSON = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch { return null; }
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
        if (entry.isIntersecting) { cb(); io.unobserve(entry.target); }
      });
    }, { threshold });
    io.observe(el);
  };

  /* ============================================================
     1) DADOS REAIS DO USUÁRIO
     ============================================================ */
  const LEITURA = {
    data_coleta: "2026-10-20",
    medido_em: "2026-10-20T14:02:10-03:00",
    tipo: "amostra",
    amostra: "lagoa",
    turbidez: { ntu: 18.4, tensao_v: 4.12, classificacao: "LEVEMENTE TURVA" },
    cores: [
      { nome: "Violeta",       comprimento_onda_nm: 415, valor: 2394, porcentagem: 57.0 },
      { nome: "Azul",          comprimento_onda_nm: 445, valor: 4802, porcentagem: 49.0 },
      { nome: "Ciano",         comprimento_onda_nm: 480, valor: 4576, porcentagem: 52.0 },
      { nome: "Verde",         comprimento_onda_nm: 515, valor: 4860, porcentagem: 54.0 },
      { nome: "Verde-amarelo", comprimento_onda_nm: 555, valor: 5225, porcentagem: 55.0 },
      { nome: "Amarelo",       comprimento_onda_nm: 590, valor: 4920, porcentagem: 60.0 },
      { nome: "Laranja",       comprimento_onda_nm: 630, valor: 3965, porcentagem: 65.0 },
      { nome: "Vermelho",      comprimento_onda_nm: 680, valor: 1404, porcentagem: 54.0 },
    ],
    diagnostico: {
      turbidez: "LEVEMENTE TURVA",
      algas: "SINAL FRACO",
      cor: "NORMAL",
      contaminacao_pct: 20,
      contaminacao: "LEVEMENTE CONTAMINADA",
      resumo: "Água levemente turva, com sinal fraco de algas, cor normal.",
    },
  };

  const MOCKS = {
    leitura: LEITURA,
    espectro: {
      rotulos: LEITURA.cores.map((c) => String(c.comprimento_onda_nm)),
      canais:  LEITURA.cores.map((_, i) => `canal_${i}`),
      semanas: [{ data: LEITURA.data_coleta, valores: LEITURA.cores.map((c) => c.porcentagem / 100) }],
    },
    serie: { algas: [{ d: "2026-10-20", v: 0.0 }], turbidez: [{ d: "2026-10-20", v: 18.4 }], cor: [{ d: "2026-10-20", v: 0.0 }], secchi: [] },
    chuva: [],
    dispersao: [],
    live: {
      rotulos: LEITURA.cores.map((c) => String(c.comprimento_onda_nm)),
      cores:   ["#8b5cf6", "#6366f1", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#f97316", "#ef4444"],
      valores: LEITURA.cores.map((c) => c.valor),
    },
    coletas: [
      {
        data_coleta: "2026-10-20",
        ponto: null,
        secchi_cm: null,
        choveu_48h: false,
        temperatura_agua: null,
        observacao: "Água levemente turva, com sinal fraco de algas, cor normal.",
        foto: null,
      },
    ],
  };

  /* ============================================================
     2) INJETAR A LEITURA NA TABELA SE ESTIVER VAZIA
     ============================================================ */
  function injectMockReadingIfEmpty() {
    const tbody = document.getElementById("readings-body");
    if (!tbody) return;

    // Se a tabela já veio preenchida pela view, apenas capturamos
    if (tbody.children.length > 0 && !tbody.querySelector(".empty-row")) {
      rows = [...tbody.querySelectorAll("tr")];
      return;
    }

    // Se estiver vazia, montamos a linha
    const tr = document.createElement("tr");
    tr.dataset.sample = LEITURA.amostra.toLowerCase();
    tr.dataset.type = LEITURA.tipo;

    const horario = LEITURA.medido_em.split("T")[1].split("-")[0];
    const turbidezVal = LEITURA.turbidez.ntu.toFixed(3);

    tr.innerHTML = `
      <td class="time-cell">${horario}</td>
      <td class="sample-cell">${LEITURA.amostra}</td>
      <td><span class="type-badge type-${LEITURA.tipo}">Amostra</span></td>
      <td>Frente</td>
      <td>1</td>
      <td class="numeric-cell">${turbidezVal}</td>
      <td><span class="state-badge state-ok"><i aria-hidden="true"></i>Normal</span></td>
    `;

    const emptyState = document.querySelector(".table-empty");
    if (emptyState) emptyState.remove();

    // Se a barra de ferramentas não existir (porque o Django não renderizou por estar vazio), injetamos
    if (!document.getElementById("reading-search")) {
      const panel = document.getElementById("readings");
      const toolbarHTML = `
        <div class="table-toolbar">
          <label class="search-box" for="reading-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>
            <input id="reading-search" type="search" placeholder="Buscar amostra…" autocomplete="off">
          </label>
          <label class="select-label" for="sample-filter">Amostra
            <select id="sample-filter">
              <option value="">Todas as amostras</option>
              <option value="lagoa">lagoa</option>
            </select>
          </label>
          <label class="select-label" for="type-filter">Tipo
            <select id="type-filter">
              <option value="">Todos os tipos</option>
              <option value="amostra">Amostra</option>
              <option value="branco">Branco</option>
              <option value="escuro">Escuro</option>
            </select>
          </label>
          <button class="export-button" id="export-csv" type="button" data-magnetic>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v3h14v-3"/></svg>
            Exportar CSV
          </button>
        </div>
        <div class="table-scroll">
          <table class="readings-table">
            <thead>
              <tr>
                <th scope="col">Horário</th>
                <th scope="col">Amostra</th>
                <th scope="col">Tipo</th>
                <th scope="col">LED</th>
                <th scope="col">Réplica</th>
                <th scope="col">Turbidez</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody id="readings-body"></tbody>
          </table>
          <p class="no-results" id="no-results" hidden>Nenhuma leitura corresponde aos filtros selecionados.</p>
        </div>
      `;
      panel.insertAdjacentHTML("beforeend", toolbarHTML);
      document.getElementById("readings-body").append(tr);
    } else {
      const newTbody = document.getElementById("readings-body");
      if (newTbody) newTbody.append(tr);
    }

    // Atualiza referências e contador
    rows = [...document.querySelectorAll("#readings-body tr")];
    const vCount = document.getElementById("visible-count");
    if (vCount) vCount.textContent = rows.length;
  }

  injectMockReadingIfEmpty();

  // Captura os inputs que podem ter sido recém-criados
  const searchInput = document.getElementById("reading-search");
  const sampleFilter = document.getElementById("sample-filter");
  const typeFilter = document.getElementById("type-filter");
  const exportButton = document.getElementById("export-csv");
  const visibleCount = document.getElementById("visible-count");
  const noResults = document.getElementById("no-results");

  /* ============================================================
     3) FILTROS DA TABELA
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
     4) EXPORT CSV
     ============================================================ */
  function exportVisibleReadings() {
    const visibleRows = rows.filter((row) => !row.hidden);
    if (!visibleRows.length) return;
    const headers = [...document.querySelectorAll(".readings-table thead th")].map((c) => c.textContent.trim());
    const values = visibleRows.map((row) => [...row.cells].map((cell) => cell.textContent.trim()));
    const escapeCsv = (v) => `"${v.replaceAll('"', '""')}"`;
    const csv = [headers, ...values].map((rec) => rec.map(escapeCsv).join(",")).join("\r\n");
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(file);
    const date = SHELL?.dataset.selectedDate ?? "leituras";
    link.href = url;
    link.download = `aquamonitor-${date}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  exportButton?.addEventListener("click", exportVisibleReadings);

  /* ============================================================
     5) RELÓGIO E HEALTH CHECK
     ============================================================ */
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
    const url = SHELL?.dataset.healthUrl;
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

  /* ============================================================
     6) GRÁFICOS
     ============================================================ */
  function renderTurbidityChart() {
    const chart = document.getElementById("turbidity-chart");
    const dataElement = document.getElementById("chart-data");
    if (!chart || !dataElement) return;
    let points;
    try { points = JSON.parse(dataElement.textContent); } catch (e) { return; }
    points = points.filter((p) => Number.isFinite(p.turbidez) && typeof p.hora === "string");
    if (!points.length) return;
    
    const width = 900, height = 215;
    const margin = { top: 15, right: 17, bottom: 32, left: 48 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const values = points.map((p) => p.turbidez);
    let min = Math.min(...values), max = Math.max(...values);
    if (min === max) { min -= 0.1; max += 0.1; }
    const pad = (max - min) * 0.15; min -= pad; max += pad;
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
    addSVG(chart, "path", { d: line, class: "series-line", stroke: "#2fe0d0" });
    
    points.forEach((p, i) => {
      const dot = addSVG(chart, "circle", { cx: x(i), cy: y(p.turbidez), r: 4, fill: "#050b12", stroke: "#2fe0d0", class: "series-dot" });
      addSVG(dot, "title", {}).textContent = `${p.hora} · ${p.amostra}: ${p.turbidez.toFixed(3)}`;
    });
  }

  function renderSpectrumChart() {
    const chart = document.getElementById("spectrum-chart");
    if (!chart) return;
    const real = readJSON("espectro-data");
    const data = real && Array.isArray(real.semanas) && real.semanas.length ? real : MOCKS.espectro;
    const width = 900, height = 300;
    const margin = { top: 20, right: 20, bottom: 44, left: 50 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const labels = data.rotulos || data.canais;
    const n = labels.length;
    const allVals = data.semanas.flatMap((s) => s.valores);
    let min = Math.min(...allVals), max = Math.max(...allVals);
    if (min === max) { min -= 0.1; max += 0.1; }
    const pad = (max - min) * 0.1;
    min = Math.max(0, min - pad); max += pad;
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
    labels.forEach((label, i) => { svgText(chart, x(i), height - 22, label, { class: "axis-label", "text-anchor": "middle" }); });
    const total = data.semanas.length;
    data.semanas.forEach((sem, idx) => {
      const line = sem.valores.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
      addSVG(chart, "path", { d: line, fill: "none", stroke: "#2fe0d0", "stroke-width": 2.6, "stroke-linecap": "round" });
      sem.valores.forEach((v, i) => {
        addSVG(chart, "circle", { cx: x(i), cy: y(v), r: 3.2, fill: "#050b12", stroke: "#2fe0d0", class: "series-dot" });
      });
    });
  }

  function renderLiveChart() {
    const chart = document.getElementById("live-chart");
    if (!chart) return;
    const real = readJSON("live-data");
    const data = real && real.valores ? real : MOCKS.live;
    const width = 900, height = 260;
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
      addSVG(chart, "rect", { x: bx, y: by, width: barW, height: h, rx: 3, fill: data.cores[i], opacity: 0.85 });
      svgText(chart, bx + barW / 2, height - 22, data.rotulos[i], { class: "axis-text", "text-anchor": "middle" });
    });
  }

  function renderColetasTable() {
    const body = document.getElementById("coletas-body");
    const countEl = document.getElementById("coletas-count");
    if (!body) return;
    const real = readJSON("coletas-data");
    const data = Array.isArray(real) && real.length ? real : MOCKS.coletas;
    body.replaceChildren();
    data.forEach((c) => {
      const tr = document.createElement("tr");
      const cells = [formatDate(c.data_coleta), c.ponto || "—", c.secchi_cm != null ? `${c.secchi_cm} cm` : "—", null, c.temperatura_agua != null ? `${c.temperatura_agua} °C` : "—", c.observacao || "—", null];
      cells.forEach((value, i) => {
        const td = document.createElement("td");
        if (i === 3) {
          const badge = document.createElement("span");
          badge.className = `state-badge ${c.choveu_48h ? "state-warning" : "state-ok"}`;
          badge.innerHTML = `<i aria-hidden="true"></i>${c.choveu_48h ? "Sim" : "Não"}`;
          td.append(badge);
        } else if (i === 6) {
          td.textContent = c.foto ? "ver foto" : "—";
        } else {
          td.textContent = value;
        }
        tr.append(td);
      });
      body.append(tr);
    });
    if (countEl) countEl.textContent = String(data.length);
  }

  function formatDate(iso) {
    if (!iso || typeof iso !== "string") return "—";
    const p = iso.split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
  }

  /* ============================================================
     7) CONFIGURAÇÕES DE VISIBILIDADE E CONTAMINAÇÃO
     ============================================================ */
  function applyDataSufficiency() {
    const seriesWrap = document.getElementById("series-wrap");
    const seriesEmpty = document.getElementById("series-empty");
    if (seriesWrap && seriesEmpty) { seriesWrap.hidden = true; seriesEmpty.hidden = false; }
    const segmented = document.querySelector(".segmented");
    if (segmented) segmented.hidden = true;

    const scatterWrap = document.getElementById("scatter-wrap");
    const scatterEmpty = document.getElementById("scatter-empty");
    if (scatterWrap && scatterEmpty) { scatterWrap.hidden = true; scatterEmpty.hidden = false; }

    const kpiVal = document.getElementById("kpi-contaminacao");
    const kpiBadge = document.getElementById("kpi-contaminacao-badge");
    const diag = MOCKS.leitura.diagnostico;
    if (kpiVal) kpiVal.textContent = `${diag.contaminacao_pct}%`;
    if (kpiBadge) {
      kpiBadge.dataset.state = "warn";
      kpiBadge.textContent = diag.contaminacao;
    }
  }
  applyDataSufficiency();

  observeOnce(document.getElementById("spectrum-chart"), renderSpectrumChart);
  observeOnce(document.getElementById("live-chart"), renderLiveChart);
  observeOnce(document.getElementById("coletas-body"), renderColetasTable);
  renderTurbidityChart();

  /* ============================================================
     8) CURSOR CUSTOMIZADO
     ============================================================ */
  const cursorDot = document.querySelector(".cursor-dot");
  const cursorRing = document.querySelector(".cursor-ring");

  if (!isTouch && !reduceMotion && cursorDot && cursorRing) {
    let mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2;
    let ringX = mouseX, ringY = mouseY;

    document.addEventListener("mousemove", (event) => {
      mouseX = event.clientX; mouseY = event.clientY;
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
    document.addEventListener("mouseover", (e) => { if (e.target.closest(hoverTargets)) cursorRing.classList.add("is-hover"); });
    document.addEventListener("mouseout", (e) => { if (e.target.closest(hoverTargets)) cursorRing.classList.remove("is-hover"); });
  }

  /* ============================================================
     9) CANVAS DE FUNDO
     ============================================================ */
  const canvas = document.getElementById("bg-canvas");
  if (canvas && !reduceMotion) {
    const ctx = canvas.getContext("2d");
    let width = 0, height = 0, dpr = 1, t = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth; height = window.innerHeight;
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
        const y = offsetY + Math.sin(x * frequency + t * speed) * amplitude + Math.sin(x * frequency * 0.5 + t * speed * 0.7) * (amplitude * 0.4);
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke();
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
     10) SCROLL REVEAL E CONTADORES
     ============================================================ */
  const revealEls = document.querySelectorAll("[data-reveal]");
  if (revealEls.length) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      revealEls.forEach((el) => el.classList.add("is-revealed"));
    } else {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) { entry.target.classList.add("is-revealed"); observer.unobserve(entry.target); }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
      revealEls.forEach((el) => observer.observe(el));
    }
  }

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
        const t = Number(el.getAttribute("data-count"));
        if (Number.isFinite(t)) el.textContent = String(t);
      });
    } else {
      const counterObs = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) { animateCounter(entry.target); counterObs.unobserve(entry.target); }
        });
      }, { threshold: 0.4 });
      counters.forEach((el) => counterObs.observe(el));
    }
  }

  /* ============================================================
     11) TILT E MAGNETIC BUTTONS
     ============================================================ */
  if (!isTouch && !reduceMotion) {
    document.querySelectorAll("[data-tilt]").forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const r = card.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        const px = x / r.width, py = y / r.height;
        card.style.transform = `perspective(900px) rotateX(${(0.5 - py) * 6}deg) rotateY(${(px - 0.5) * 6}deg) translateY(-2px)`;
        card.style.setProperty("--mx", `${px * 100}%`);
        card.style.setProperty("--my", `${py * 100}%`);
      });
      card.addEventListener("mouseleave", () => { card.style.transform = ""; });
    });

    document.querySelectorAll("[data-magnetic]").forEach((el) => {
      el.addEventListener("mousemove", (e) => {
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        el.style.transform = `translate(${x * 0.15}px, ${y * 0.15}px)`;
      });
      el.addEventListener("mouseleave", () => { el.style.transform = ""; });
    });
  }

  /* ============================================================
     12) SCROLL SUAVE
     ============================================================ */
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const id = link.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  });
})();