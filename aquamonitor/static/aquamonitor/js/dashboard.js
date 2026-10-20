(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  const shell = document.querySelector(".app-shell");
  const SVG_NS = "http://www.w3.org/2000/svg";
  const colors = ["#7952c7", "#4c78ed", "#18a6d5", "#21b98a", "#94bf36", "#e8a926", "#ed7845", "#e34e5a"];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const fmt = (n, d) => Number(n).toLocaleString("pt-BR", d == null ? {} : { maximumFractionDigits: d });

  /* ---------- utilitários SVG ---------- */
  const addSVG = (parent, tag, attrs = {}) => {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    parent.append(el);
    return el;
  };
  const svgText = (parent, x, y, text, attrs = {}) => { const el = addSVG(parent, "text", { x, y, ...attrs }); el.textContent = text; return el; };
  const readJSON = (id) => { try { return JSON.parse($(id)?.textContent); } catch { return null; } };
  function setChartState(wrapId, emptyId, hasData) {
    if ($(wrapId)) $(wrapId).hidden = !hasData;
    if ($(emptyId)) $(emptyId).hidden = hasData;
  }
  const drawn = new Set(); // só anima o desenho na primeira vez; depois atualiza sem "piscar"
  const animClass = (id, cls) => (drawn.has(id) ? "" : cls);
  const markDrawn = (id) => drawn.add(id);

  /* ---------- tooltip customizado ---------- */
  const tip = $("tip");
  document.addEventListener("pointermove", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip;
    tip.style.left = `${e.clientX}px`;
    tip.style.top = `${e.clientY - 8}px`;
    tip.hidden = false;
  });

  /* ---------- gráficos ---------- */
  function renderTurbidityChart(points = []) {
    const chart = $("turbidity-chart");
    const pts = points.filter((p) => Number.isFinite(p.turbidez));
    setChartState("turbidity-wrap", "turbidity-empty", pts.length > 0);
    if (!chart || !pts.length) return;
    const W = 900, H = 230, m = { t: 16, r: 20, b: 34, l: 54 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    let min = Math.min(...pts.map((p) => p.turbidez)), max = Math.max(...pts.map((p) => p.turbidez));
    if (min === max) { min -= Math.max(Math.abs(min) * 0.1, 0.1); max += Math.max(Math.abs(max) * 0.1, 0.1); }
    const pad = (max - min) * 0.15; min -= pad; max += pad;
    const x = (i) => m.l + (pts.length === 1 ? pw / 2 : (i / (pts.length - 1)) * pw);
    const y = (v) => m.t + ((max - v) / (max - min)) * ph;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    for (let i = 0; i <= 4; i++) {
      const v = max - ((max - min) * i) / 4, ly = y(v);
      addSVG(chart, "line", { x1: m.l, y1: ly, x2: W - m.r, y2: ly, class: "grid-line" });
      svgText(chart, m.l - 10, ly + 4, v.toFixed(2), { class: "axis-text", "text-anchor": "end" });
    }
    pts.forEach((p, i) => svgText(chart, x(i), H - 10, p.hora, { class: "axis-text", "text-anchor": "middle" }));
    const line = pts.map((p, i) => `${i ? "L" : "M"} ${x(i)} ${y(p.turbidez)}`).join(" ");
    const defs = addSVG(chart, "defs");
    const g = addSVG(defs, "linearGradient", { id: "tf", x1: 0, y1: 0, x2: 0, y2: 1 });
    addSVG(g, "stop", { offset: "0%", "stop-color": "#19b5c8", "stop-opacity": ".35" });
    addSVG(g, "stop", { offset: "100%", "stop-color": "#19b5c8", "stop-opacity": "0" });
    addSVG(chart, "path", { d: `${line} L ${x(pts.length - 1)} ${H - m.b} L ${x(0)} ${H - m.b} Z`, fill: "url(#tf)", class: animClass("t", "anim-fade") });
    addSVG(chart, "path", { d: line, class: `series-line ${animClass("t", "anim-line")}`, stroke: "#0a8fa8", pathLength: 1 });
    pts.forEach((p, i) => addSVG(chart, "circle", { cx: x(i), cy: y(p.turbidez), r: 5, fill: "#fff", stroke: "#0a8fa8", class: `series-dot ${animClass("t", "anim-fade")}`, "data-tip": `${p.hora} · ${p.amostra}: ${p.turbidez.toFixed(2)}` }));
    markDrawn("t");
  }

  function renderSpectrumChart(data) {
    const chart = $("spectrum-chart"), sp = data?.espectro;
    const values = sp?.semanas?.[0]?.valores, labels = sp?.rotulos;
    const ok = Array.isArray(values) && values.length > 0 && values.every(Number.isFinite);
    setChartState("spectrum-wrap", "spectrum-empty", ok);
    if (!chart || !ok) return;
    const W = 900, H = 320, m = { t: 24, r: 24, b: 58, l: 66 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    let min = Math.min(...values), max = Math.max(...values);
    if (min === max) max += Math.max(Math.abs(max) * 0.1, 0.1);
    const pad = Math.max((max - min) * 0.12, max * 0.04); min = Math.max(0, min - pad); max += pad;
    const x = (i) => m.l + (values.length === 1 ? pw / 2 : (i / (values.length - 1)) * pw);
    const y = (v) => m.t + ((max - v) / (max - min)) * ph;
    const counts = sp.unidade === "Contagem digital";
    if ($("spectrum-description")) $("spectrum-description").textContent = `${sp.unidade || "Absorbância (u.a.)"} por comprimento de onda (nm).`;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    for (let i = 0; i <= 4; i++) {
      const v = max - ((max - min) * i) / 4, ly = y(v);
      addSVG(chart, "line", { x1: m.l, y1: ly, x2: W - m.r, y2: ly, class: "grid-line" });
      svgText(chart, m.l - 10, ly + 4, counts ? Math.round(v).toLocaleString("pt-BR") : v.toFixed(2), { class: "axis-text", "text-anchor": "end" });
    }
    const P = values.map((v, i) => ({ x: x(i), y: y(v) }));
    const defs = addSVG(chart, "defs");
    const g = addSVG(defs, "linearGradient", { id: "sf", x1: 0, y1: 0, x2: 0, y2: 1 });
    addSVG(g, "stop", { offset: "0%", "stop-color": "#19b5c8", "stop-opacity": ".28" });
    addSVG(g, "stop", { offset: "100%", "stop-color": "#19b5c8", "stop-opacity": "0" });
    const area = P.slice(0, -1).map((p, i) => { const n = P[i + 1], mid = (p.x + n.x) / 2; return `${i ? "" : `M ${p.x} ${p.y}`} C ${mid} ${p.y}, ${mid} ${n.y}, ${n.x} ${n.y}`; }).join(" ");
    addSVG(chart, "path", { d: `${area} L ${P.at(-1).x} ${H - m.b} L ${P[0].x} ${H - m.b} Z`, fill: "url(#sf)", class: animClass("s", "anim-fade") });
    P.slice(0, -1).forEach((p, i) => {
      const n = P[i + 1], mid = (p.x + n.x) / 2;
      addSVG(chart, "path", { d: `M ${p.x} ${p.y} C ${mid} ${p.y}, ${mid} ${n.y}, ${n.x} ${n.y}`, stroke: colors[i], class: `series-line ${animClass("s", "anim-line")}`, pathLength: 1, style: `animation-delay:${i * 0.18}s` });
    });
    values.forEach((v, i) => {
      svgText(chart, x(i), H - 30, sp.etiquetas?.[i] || labels[i], { class: "axis-text", "text-anchor": "middle" });
      svgText(chart, x(i), H - 12, `${labels[i]} nm`, { class: "axis-text", "text-anchor": "middle" });
      const pc = sp.semanas[0].porcentagens?.[i];
      const txt = counts ? `${fmt(v)} contagens${pc == null ? "" : ` · ${pc}%`}` : `absorbância ${v.toFixed(4)}`;
      addSVG(chart, "circle", { cx: x(i), cy: y(v), r: 6, fill: "#fff", stroke: colors[i], class: `series-dot ${animClass("s", "anim-fade")}`, "data-tip": `${cores[i]?.nome || "Canal"} · ${labels[i]} nm · ${txt}` });
    });
    markDrawn("s");
  }

  function renderLiveChart(data) {
    const chart = $("live-chart"), live = data?.live, values = live?.valores, labels = live?.rotulos;
    const ok = Array.isArray(values) && values.length > 0 && values.every(Number.isFinite);
    setChartState("live-wrap", "live-empty", ok);
    if (!chart || !ok) return;
    const W = 900, H = 270, m = { t: 20, r: 20, b: 44, l: 58 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const maxV = Math.max(...values, 1) * 1.12, gap = 10, bw = (pw - gap * (values.length - 1)) / values.length;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    for (let i = 0; i <= 4; i++) {
      const ly = m.t + (ph * i) / 4;
      addSVG(chart, "line", { x1: m.l, y1: ly, x2: W - m.r, y2: ly, class: "grid-line" });
      svgText(chart, m.l - 10, ly + 4, Math.round(maxV - (maxV * i) / 4).toLocaleString("pt-BR"), { class: "axis-text", "text-anchor": "end" });
    }
    values.forEach((v, i) => {
      const bh = (v / maxV) * ph, bx = m.l + i * (bw + gap), pc = live.porcentagens?.[i];
      addSVG(chart, "rect", { x: bx, y: m.t + ph - bh, width: bw, height: bh, rx: 7, fill: colors[i % 8], opacity: 0.9,
        class: `bar-live ${animClass("l", "anim-bar")}`, style: `animation-delay:${i * 0.07}s`,
        "data-tip": `${cores[i]?.nome || "Canal"} · ${labels[i]} nm · ${fmt(v)} contagens${pc == null ? "" : ` · ${pc}%`}` });
      svgText(chart, bx + bw / 2, H - 20, labels[i], { class: "axis-text", "text-anchor": "middle" });
    });
    markDrawn("l");
  }

  /* ---------- tabelas ---------- */
  let rows = [];
  function renderReadings(data) {
    const body = $("readings-body"); if (!body) return;
    body.replaceChildren();
    const list = data.leituras || [];
    list.forEach((r) => {
      const tr = document.createElement("tr");
      tr.dataset.sample = r.amostra.toLocaleLowerCase("pt-BR"); tr.dataset.type = r.tipo;
      const turb = r.turbidez == null ? "—" : r.turbidez_unidade ? `${fmt(r.turbidez)} ${r.turbidez_unidade}` : Number(r.turbidez).toFixed(3);
      [["time-cell", r.hora], ["sample-cell", r.amostra], ["", r.tipo_display], ["", r.led], ["", String(r.replica)], ["numeric-cell", turb]].forEach(([cls, text], i) => {
        const td = tr.insertCell(); if (cls) td.className = cls;
        if (i === 2) { const b = document.createElement("span"); b.className = `type-badge type-${r.tipo}`; b.textContent = text; td.append(b); }
        else td.textContent = text;
      });
      const st = document.createElement("span");
      st.className = `state-badge ${r.saturado ? "state-warning" : "state-ok"}`;
      st.append(document.createElement("i"), document.createTextNode(r.saturado ? "Saturada" : "Normal"));
      tr.insertCell().append(st); body.append(tr);
    });
    if (!list.length) {
      const tr = body.insertRow(); tr.dataset.empty = "true";
      const td = tr.insertCell(); td.colSpan = 7; td.className = "empty-row"; td.textContent = "Nenhuma leitura recebida para esta data.";
    }
    rows = [...body.querySelectorAll("tr:not([data-empty])")];
    filterReadings();
  }
  function filterReadings() {
    const s = $("reading-search")?.value.trim().toLocaleLowerCase("pt-BR") ?? "";
    const sm = $("sample-filter")?.value.toLocaleLowerCase("pt-BR") ?? "", ty = $("type-filter")?.value ?? "";
    let n = 0;
    rows.forEach((r) => {
      const ok = (r.dataset.sample || "").includes(s) && (!sm || r.dataset.sample === sm) && (!ty || r.dataset.type === ty);
      r.hidden = !ok; if (ok) n++;
    });
    if ($("visible-count")) $("visible-count").textContent = String(n);
    if ($("no-results")) $("no-results").hidden = n !== 0 || rows.length === 0;
  }
  function updateSampleFilter(list) {
    const sel = $("sample-filter"); if (!sel) return;
    const cur = sel.value, names = [...new Set(list.map((r) => r.amostra))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    sel.replaceChildren(new Option("Todas as amostras", ""));
    names.forEach((n) => sel.add(new Option(n, n.toLocaleLowerCase("pt-BR"))));
    sel.value = names.some((n) => n.toLocaleLowerCase("pt-BR") === cur) ? cur : "";
  }
  function renderColetasTable() {
    const body = $("coletas-body"); if (!body) return;
    body.replaceChildren();
    const td = body.insertRow().insertCell(); td.colSpan = 7; td.className = "empty-row";
    td.textContent = "O cadastro de campo (Secchi, chuva, temperatura e fotos) ainda não está conectado a este painel.";
    if ($("coletas-count")) $("coletas-count").textContent = "0";
  }

  /* ---------- números que contam até o valor (e piscam ao receber dado novo) ---------- */
  function setNumber(el, to, first) {
    if (!el) return;
    const from = Number(el.dataset.shown ?? 0);
    el.dataset.shown = String(to);
    if (reduce || from === to) { el.textContent = String(to); return; }
    const t0 = performance.now(), dur = first ? 1400 : 700;
    const step = (t) => {
      const k = clamp((t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      el.textContent = String(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    if (!first) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
  }
  function setText(id, value) {
    const el = $(id); if (!el || el.textContent === value) return;
    const had = el.textContent && el.textContent !== "—";
    el.textContent = value;
    if (had && el.tagName === "STRONG") { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
  }

  let firstRender = true;
  function renderDashboard(data) {
    if (!data || data.data !== shell?.dataset.selectedDate) return;
    const dg = data.diagnostico;
    if ($("sample-analysis")) $("sample-analysis").hidden = !dg;
    if (dg) {
      const last = data.leituras?.find((r) => r.tipo === "amostra");
      Object.entries({
        "sample-name": last?.amostra || "—", "sample-time": last?.hora || data.ultima_leitura || "—",
        "sample-turbidity": data.turbidez?.ntu == null ? "—" : `${fmt(data.turbidez.ntu)} NTU`,
        "sample-turbidity-class": dg.turbidez || "—",
        "sample-voltage": data.turbidez?.tensao_v == null ? "—" : `${fmt(data.turbidez.tensao_v)} V`,
        "sample-algae": dg.algas || "—", "sample-color": dg.cor || "—",
        "sample-contamination": `${dg.contaminacao_pct}%`, "sample-contamination-class": dg.contaminacao || "—", "sample-summary": dg.resumo || "",
      }).forEach(([id, v]) => setText(id, v));
    }
    if ($("sync-badge")) $("sync-badge").textContent = data.demo ? "Dados de demonstração" : "Sincronização";
    if ($("sync-message")) $("sync-message").textContent = data.demo
      ? "Valores de exemplo; não foram enviados pelo Arduino nem gravados no banco."
      : "Leituras reais do ESP32 aparecem automaticamente aqui.";
    const kpis = document.querySelectorAll(".kpi-card [data-count]");
    [data.total_leituras, data.total_amostras, data.estouradas].forEach((v, i) => setNumber(kpis[i], Number(v) || 0, firstRender));
    setText("kpi-contaminacao", dg ? `${dg.contaminacao_pct}%` : "—");
    if ($("kpi-contaminacao-badge")) $("kpi-contaminacao-badge").textContent = dg?.contaminacao || "—";
    const latest = document.querySelector(".kpi-value-time"); if (latest) latest.textContent = data.ultima_leitura || "—";
    if ($("data-updated")) $("data-updated").textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(data.atualizado_em ? new Date(data.atualizado_em) : new Date());
    updateSampleFilter(data.leituras || []);
    renderReadings(data); renderTurbidityChart(data.chart_data || []); renderSpectrumChart(data); renderLiveChart(data); renderColetasTable();
    firstRender = false;
  }
  setChartState("series-wrap", "series-empty", false);
  setChartState("scatter-wrap", "scatter-empty", false);
  const seg = document.querySelector(".segmented"); if (seg) seg.hidden = true;
  $("reading-search")?.addEventListener("input", filterReadings);
  $("sample-filter")?.addEventListener("change", filterReadings);
  $("type-filter")?.addEventListener("change", filterReadings);
  $("export-csv")?.addEventListener("click", () => {
    const vis = rows.filter((r) => !r.hidden); if (!vis.length) return;
    const heads = [...document.querySelectorAll("#readings thead th")].map((c) => c.textContent.trim());
    const esc = (v) => `"${v.replaceAll('"', '""')}"`;
    const csv = [heads, ...vis.map((r) => [...r.cells].map((c) => c.textContent.trim()))].map((l) => l.map(esc).join(",")).join("\r\n");
    const a = document.createElement("a"), url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    a.href = url; a.download = `aquamonitor-${shell?.dataset.selectedDate ?? "leituras"}.csv`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  /* ---------- relógio, saúde da API e dados em tempo real ---------- */
  const clock = () => { if ($("live-clock")) $("live-clock").textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()); };
  clock(); setInterval(clock, 1000);

  async function checkHealth() {
    const url = shell?.dataset.healthUrl, dot = $("health-indicator"), label = $("health-label");
    if (!url || !dot || !label) return;
    let online = false;
    try { const r = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } }); online = r.ok && (await r.json())?.status === "ok"; } catch { /* offline */ }
    dot.classList.toggle("is-online", online); dot.classList.toggle("is-offline", !online);
    label.textContent = online ? "API disponível" : "API indisponível";
  }
  checkHealth(); setInterval(checkHealth, 30000);

  async function refresh() {
    const endpoint = shell?.dataset.dashboardUrl; if (!endpoint || document.hidden) return;
    const url = new URL(endpoint, location.href); url.searchParams.set("data", shell.dataset.selectedDate);
    try {
      const r = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      renderDashboard(await r.json());
    } catch (e) {
      if ($("data-updated")) $("data-updated").textContent = "falha na sincronização; tentando novamente";
      console.error("Não foi possível atualizar o painel.", e);
    }
  }
  renderDashboard(readJSON("dashboard-data"));
  setInterval(refresh, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

  /* ---------- mergulho: tudo reage à rolagem ---------- */
  const root = document.documentElement, reveals = [...document.querySelectorAll("[data-reveal]")];
  const gauge = $("gauge-m"), links = [...document.querySelectorAll(".nav-link")];
  const secs = [...document.querySelectorAll("main section[id], main#overview")];
  let ticking = false, lastY = scrollY, velocity = 0;
  function onScroll() {
    const vh = innerHeight, max = Math.max(1, document.documentElement.scrollHeight - vh);
    root.style.setProperty("--p", clamp(scrollY / max).toFixed(4));
    root.style.setProperty("--hp", clamp(scrollY / (vh * 0.8)).toFixed(4));
    if (gauge) gauge.textContent = `${Math.round(clamp(scrollY / max) * 30)} m`;
    reveals.forEach((el) => {
      const r = reduce ? 1 : clamp((vh * 0.98 - el.getBoundingClientRect().top) / (vh * 0.38));
      el.style.setProperty("--r", r.toFixed(3));
      el.classList.toggle("is-in", r > 0.55);
    });
    // seção ativa no menu
    let current = "overview";
    secs.forEach((s) => { if (s.id && s.getBoundingClientRect().top < vh * 0.4) current = s.id; });
    if (current === "validacao" || current === "chart-section") current = "evolucao";
    links.forEach((l) => l.classList.toggle("is-active", l.getAttribute("href") === `#${current}`));
    velocity = scrollY - lastY; lastY = scrollY; ticking = false;
  }
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener("resize", onScroll);
  onScroll();

  /* ---------- bolhas subindo (mais rápidas ao rolar) ---------- */
  const cv = $("bubbles");
  if (cv && !reduce) {
    const ctx = cv.getContext("2d"); let w, h, dpr;
    const bubbles = Array.from({ length: 38 }, () => ({ x: Math.random(), y: Math.random(), r: 2 + Math.random() * 9, s: 0.15 + Math.random() * 0.45, ph: Math.random() * 6.3 }));
    const size = () => { dpr = Math.min(devicePixelRatio || 1, 2); w = cv.width = innerWidth * dpr; h = cv.height = innerHeight * dpr; };
    size(); addEventListener("resize", size);
    (function loop(t) {
      ctx.clearRect(0, 0, w, h);
      const boost = 1 + Math.min(Math.abs(velocity), 80) * 0.12;
      bubbles.forEach((b) => {
        b.y -= (b.s * boost * dpr) / innerHeight * 0.6; if (b.y < -0.05) { b.y = 1.05; b.x = Math.random(); }
        const px = (b.x + Math.sin(t / 1500 + b.ph) * 0.012) * w, py = b.y * h, r = b.r * dpr;
        ctx.beginPath(); ctx.arc(px, py, r, 0, 6.283);
        ctx.fillStyle = "rgba(255,255,255,.28)"; ctx.fill();
        ctx.strokeStyle = "rgba(10,124,153,.28)"; ctx.lineWidth = dpr; ctx.stroke();
        ctx.beginPath(); ctx.arc(px - r * 0.3, py - r * 0.3, r * 0.22, 0, 6.283); ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fill();
      });
      velocity *= 0.92; requestAnimationFrame(loop);
    })(0);
  }
})();