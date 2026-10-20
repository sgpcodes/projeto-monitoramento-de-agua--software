(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  const shell = document.querySelector(".app-shell");
  const themeToggle = $("theme-toggle");
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  function setTheme(theme, persist = false) {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    if (themeToggle) {
      themeToggle.textContent = isDark ? "Claro" : "Escuro";
      themeToggle.setAttribute("aria-label", `Ativar modo ${isDark ? "claro" : "escuro"}`);
      themeToggle.setAttribute("aria-pressed", String(isDark));
    }
    if (themeMeta) themeMeta.content = isDark ? "#0b171d" : "#eefbfd";
    if (persist) {
      try {
        localStorage.setItem("aquamonitor-theme", isDark ? "dark" : "light");
      } catch (error) {
        console.error("Não foi possível salvar a preferência de tema.", error);
      }
    }
  }
  let savedTheme = "light";
  try {
    const storedTheme = localStorage.getItem("aquamonitor-theme");
    if (storedTheme === "dark" || storedTheme === "light") savedTheme = storedTheme;
  } catch (error) {
    console.error("Não foi possível carregar a preferência de tema.", error);
  }
  setTheme(savedTheme);
  themeToggle?.addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
  });
  const SVG_NS = "http://www.w3.org/2000/svg";
  const colors = ["#7952c7", "#4c78ed", "#18a6d5", "#21b98a", "#94bf36", "#e8a926", "#ed7845", "#e34e5a"];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const fmt = (n, d) => Number(n).toLocaleString("pt-BR", d == null ? {} : { maximumFractionDigits: d });
  const NOMES_CORES = ["Violeta", "Azul", "Ciano", "Verde", "Verde-amarelo", "Amarelo", "Laranja", "Vermelho"];
  // Rotulos de hora sem embolar: no maximo ~8 no eixo.
  const passoRotulo = (n) => Math.max(1, Math.ceil(n / 8));
  // Teto "redondo" para o eixo: as 4 divisoes caem em numeros inteiros (ex.: 0, 15, 30, 45, 60).
  const tetoRedondo = (v, passo) => Math.ceil(v / passo) * passo;

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
    // Escala fixa a partir de 0%: uma variacao pequena nao parece um desastre.
    const min = 0, max = tetoRedondo(Math.max(40, Math.max(...pts.map((p) => p.turbidez)) * 1.15), 20);
    const x = (i) => m.l + (pts.length === 1 ? pw / 2 : (i / (pts.length - 1)) * pw);
    const y = (v) => m.t + ((max - v) / (max - min)) * ph;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    for (let i = 0; i <= 4; i++) {
      const v = max - ((max - min) * i) / 4, ly = y(v);
      addSVG(chart, "line", { x1: m.l, y1: ly, x2: W - m.r, y2: ly, class: "grid-line" });
      svgText(chart, m.l - 10, ly + 4, `${Math.round(v)}%`, { class: "axis-text", "text-anchor": "end" });
    }
    const passo = passoRotulo(pts.length);
    pts.forEach((p, i) => { if (i % passo === 0) svgText(chart, x(i), H - 10, p.hora, { class: "axis-text", "text-anchor": "middle" }); });
    const line = pts.map((p, i) => `${i ? "L" : "M"} ${x(i)} ${y(p.turbidez)}`).join(" ");
    const defs = addSVG(chart, "defs");
    const g = addSVG(defs, "linearGradient", { id: "tf", x1: 0, y1: 0, x2: 0, y2: 1 });
    addSVG(g, "stop", { offset: "0%", "stop-color": "#19b5c8", "stop-opacity": ".35" });
    addSVG(g, "stop", { offset: "100%", "stop-color": "#19b5c8", "stop-opacity": "0" });
    addSVG(chart, "path", { d: `${line} L ${x(pts.length - 1)} ${H - m.b} L ${x(0)} ${H - m.b} Z`, fill: "url(#tf)", class: animClass("t", "anim-fade") });
    addSVG(chart, "path", { d: line, class: `series-line ${animClass("t", "anim-line")}`, stroke: "#0a8fa8", pathLength: 1 });
    pts.forEach((p, i) => addSVG(chart, "circle", { cx: x(i), cy: y(p.turbidez), r: pts.length > 40 ? 3 : 5, fill: "#fff", stroke: "#0a8fa8", class: `series-dot ${animClass("t", "anim-fade")}`, "data-tip": `${p.hora} · ${p.amostra}: ${fmt(p.turbidez, 1)}% da luz bloqueada` }));
    markDrawn("t");
  }

  let modoEspectro = "pct";
  const descricaoEspectro = $("spectrum-description")?.textContent;
  function renderSpectrumChart(data) {
    let sp = data?.espectro;
    if (sp && modoEspectro === "contagem" && Array.isArray(sp.contagens)) {
      sp = { ...sp, unidade: "Contagem digital", semanas: [{ ...sp.semanas[0], valores: sp.contagens }] };
      if ($("spectrum-description")) $("spectrum-description").textContent = "Contagem crua de cada canal (sem comparar com a água limpa): mostra principalmente a cor da lanterna. Use para conferir a iluminação; para analisar a água, use % de luz.";
    } else if ($("spectrum-description") && descricaoEspectro) {
      $("spectrum-description").textContent = descricaoEspectro;
    }
    const chart = $("spectrum-chart");
    const values = sp?.semanas?.[0]?.valores, labels = sp?.rotulos;
    const ok = Array.isArray(values) && values.length > 0 && values.every(Number.isFinite);
    setChartState("spectrum-wrap", "spectrum-empty", ok);
    if (!chart || !ok) return;
    const W = 900, H = 320, m = { t: 24, r: 24, b: 58, l: 66 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const counts = sp.unidade === "Contagem digital", pct = sp.unidade === "% de luz que passou";
    let min = Math.min(...values), max = Math.max(...values);
    if (pct) { min = 0; max = tetoRedondo(Math.max(100, max + 5), 25); } // 0 a 125%: a agua limpa e a linha dos 100%
    else if (counts) { min = 0; max = Math.max(max, 1) * 1.12; } // contagem: eixo comeca em 0
    else {
      if (min === max) max += Math.max(Math.abs(max) * 0.1, 0.1);
      const pad = Math.max((max - min) * 0.12, max * 0.04); min = Math.max(0, min - pad); max += pad;
      if ($("spectrum-description")) $("spectrum-description").textContent = `${sp.unidade || "Absorbância (u.a.)"} por comprimento de onda (nm).`;
    }
    const x = (i) => m.l + (values.length === 1 ? pw / 2 : (i / (values.length - 1)) * pw);
    const y = (v) => m.t + ((max - v) / (max - min)) * ph;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    for (let i = 0; i <= 4; i++) {
      const v = max - ((max - min) * i) / 4, ly = y(v);
      addSVG(chart, "line", { x1: m.l, y1: ly, x2: W - m.r, y2: ly, class: "grid-line" });
      svgText(chart, m.l - 10, ly + 4, counts ? Math.round(v).toLocaleString("pt-BR") : pct ? `${Math.round(v)}%` : v.toFixed(2), { class: "axis-text", "text-anchor": "end" });
    }
    if (pct) {
      addSVG(chart, "line", { x1: m.l, y1: y(100), x2: W - m.r, y2: y(100), class: "grid-line", stroke: "#1f9d74", "stroke-dasharray": "6 5" });
      svgText(chart, W - m.r, y(100) - 6, "água limpa (100%)", { class: "axis-text", "text-anchor": "end" });
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
      const txt = pct ? `${fmt(v, 1)}% da luz passou` : counts ? `${fmt(v)} contagens${pc == null ? "" : ` · ${pc}%`}` : `absorbância ${v.toFixed(4)}`;
      addSVG(chart, "circle", { cx: x(i), cy: y(v), r: 6, fill: "#fff", stroke: colors[i], class: `series-dot ${animClass("s", "anim-fade")}`, "data-tip": `${sp.etiquetas?.[i] || NOMES_CORES[i]} · ${labels[i]} nm · ${txt}` });
    });
    markDrawn("s");
  }

  let modoCanais = "atual";
  function renderLiveChart(data) {
    const chart = $("live-chart"), cn = data?.canais;
    const values = cn ? (modoCanais === "dia" ? cn.media_dia : cn.atual) : data?.live?.valores;
    const erros = cn ? (modoCanais === "dia" ? cn.desvio_dia : cn.desvio) : [];
    const labels = cn ? cn.rotulos : data?.live?.rotulos;
    const ok = Array.isArray(values) && values.length > 0 && values.every(Number.isFinite);
    setChartState("live-wrap", "live-empty", ok);
    if ($("canais-description")) $("canais-description").textContent = modoCanais === "dia"
      ? `Média de cada canal nas ${cn?.medicoes_dia ?? 0} leituras válidas da lagoa hoje; a barrinha mostra o quanto variou ao longo do dia.`
      : "Contagem crua de cada canal na última leitura; a barrinha é o desvio padrão das 20 leituras. Serve para conferir a lanterna e o sensor.";
    if (!chart || !ok) return;
    const W = 900, H = 270, m = { t: 20, r: 20, b: 44, l: 58 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const maxV = Math.max(...values.map((v, i) => v + (erros?.[i] || 0)), 1) * 1.12, gap = 10, bw = (pw - gap * (values.length - 1)) / values.length;
    const y = (v) => m.t + ph - (v / maxV) * ph;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    for (let i = 0; i <= 4; i++) {
      const ly = m.t + (ph * i) / 4;
      addSVG(chart, "line", { x1: m.l, y1: ly, x2: W - m.r, y2: ly, class: "grid-line" });
      svgText(chart, m.l - 10, ly + 4, Math.round(maxV - (maxV * i) / 4).toLocaleString("pt-BR"), { class: "axis-text", "text-anchor": "end" });
    }
    values.forEach((v, i) => {
      const bh = (v / maxV) * ph, bx = m.l + i * (bw + gap), e = erros?.[i], nir = labels[i] === "NIR";
      const nome = nir ? "Infravermelho" : NOMES_CORES[i] || "Canal";
      addSVG(chart, "rect", { x: bx, y: m.t + ph - bh, width: bw, height: bh, rx: 7, fill: nir ? "#9aa5ad" : colors[i % 8], opacity: 0.9,
        class: `bar-live ${animClass("l", "anim-bar")}`, style: `animation-delay:${i * 0.07}s`,
        "data-tip": `${nome} · ${labels[i]}${nir ? "" : " nm"} · ${fmt(Math.round(v))}${Number.isFinite(e) ? ` ± ${fmt(Math.round(e))}` : ""} contagens` });
      if (Number.isFinite(e) && e > 0) {
        const cx = bx + bw / 2;
        addSVG(chart, "line", { x1: cx, y1: y(v + e), x2: cx, y2: y(Math.max(0, v - e)), stroke: "#23414d", "stroke-width": 1.6 });
        addSVG(chart, "line", { x1: cx - 6, y1: y(v + e), x2: cx + 6, y2: y(v + e), stroke: "#23414d", "stroke-width": 1.6 });
      }
      svgText(chart, bx + bw / 2, H - 20, labels[i], { class: "axis-text", "text-anchor": "middle" });
    });
    markDrawn("l");
  }

  /* ---------- analise espectral ---------- */
  function renderAbsorbChart(data) {
    const chart = $("absorb-chart"), sp = data?.espectro, a = sp?.absorbancia, labels = sp?.rotulos;
    const ok = Array.isArray(a) && a.length === 8 && a.every(Number.isFinite);
    setChartState("absorb-wrap", "absorb-empty", ok);
    if (!chart || !ok) return;
    const W = 900, H = 260, m = { t: 18, r: 24, b: 44, l: 58 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const max = Math.max(0.5, Math.ceil(Math.max(...a) * 1.2 * 10) / 10);
    const x = (i) => m.l + (i / 7) * pw, y = (v) => m.t + ((max - Math.max(0, v)) / max) * ph;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    for (let i = 0; i <= 4; i++) {
      const v = max - (max * i) / 4;
      addSVG(chart, "line", { x1: m.l, y1: y(v), x2: W - m.r, y2: y(v), class: "grid-line" });
      svgText(chart, m.l - 10, y(v) + 4, v.toFixed(2), { class: "axis-text", "text-anchor": "end" });
    }
    const line = a.map((v, i) => `${i ? "L" : "M"} ${x(i)} ${y(v)}`).join(" ");
    addSVG(chart, "path", { d: `${line} L ${x(7)} ${H - m.b} L ${x(0)} ${H - m.b} Z`, fill: "#19b5c8", "fill-opacity": 0.14 });
    addSVG(chart, "path", { d: line, class: "series-line", stroke: "#0a8fa8", pathLength: 1 });
    a.forEach((v, i) => {
      svgText(chart, x(i), H - 24, `${labels[i]} nm`, { class: "axis-text", "text-anchor": "middle" });
      addSVG(chart, "circle", { cx: x(i), cy: y(v), r: 6, fill: "#fff", stroke: colors[i], class: "series-dot",
        "data-tip": `${sp.etiquetas?.[i] || NOMES_CORES[i]} · ${labels[i]} nm · absorbância ${v.toFixed(3)} (${fmt(sp.semanas?.[0]?.porcentagens?.[i], 1)}% da luz passou)` });
    });
    svgText(chart, m.l + pw / 2, H - 6, "comprimento de onda", { class: "axis-label", "text-anchor": "middle" });
  }

  function renderComponentes(data) {
    const body = $("componentes-body"); if (!body) return;
    body.replaceChildren();
    const lista = data?.componentes || [];
    lista.forEach((c) => {
      const tr = body.insertRow();
      const nome = tr.insertCell(); nome.style.whiteSpace = "normal"; // texto longo quebra a linha
      const como = document.createElement("small"); como.textContent = c.como;
      nome.append(document.createTextNode(c.nome), document.createElement("br"), como);
      const valor = tr.insertCell(); valor.className = "numeric-cell";
      valor.textContent = c.valor == null ? "—" : c.unidade === "%" ? `${fmt(c.valor, 0)}%` : Number(c.valor).toFixed(3);
      const badge = document.createElement("span");
      badge.className = `state-badge ${c.nivel === "Baixo" ? "state-ok" : "state-warning"}`;
      badge.append(document.createElement("i"), document.createTextNode(c.nivel || "—"));
      tr.insertCell().append(badge);
    });
    if (!lista.length) {
      const td = body.insertRow().insertCell(); td.colSpan = 3; td.className = "empty-row"; td.textContent = "Aguardando uma leitura válida da lagoa.";
    }
  }

  function renderObservacoes(data) {
    const body = $("observacoes-body"); if (!body) return;
    body.replaceChildren();
    const lista = data?.observacoes || [];
    lista.forEach((o) => { const td = body.insertRow().insertCell(); td.style.whiteSpace = "normal"; td.textContent = o; });
    if (!lista.length) {
      const td = body.insertRow().insertCell(); td.className = "empty-row"; td.textContent = "Sem observações: ainda não há medições da lagoa hoje.";
    }
  }

  let horasEspectro = 24, ultimaSerieEspectral = [];
  const minutos = (hora) => { const [h, mm] = hora.split(":").map(Number); return h * 60 + mm; };
  function renderSpectralTime(serie = ultimaSerieEspectral) {
    ultimaSerieEspectral = serie;
    const chart = $("spectral-time-chart");
    const fim = serie.length ? minutos(serie.at(-1).hora) : 0;
    const pts = serie.filter((p) => Array.isArray(p.porcentagens) && fim - minutos(p.hora) <= horasEspectro * 60);
    setChartState("spectral-time-wrap", "spectral-time-empty", pts.length > 1);
    if (!chart || pts.length < 2) return;
    const W = 900, H = 320, m = { t: 20, r: 24, b: 34, l: 58 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const todos = pts.flatMap((p) => p.porcentagens).filter(Number.isFinite);
    const max = tetoRedondo(Math.max(100, ...todos), 25);
    const x = (i) => m.l + (i / (pts.length - 1)) * pw, y = (v) => m.t + ((max - clamp(v, 0, max)) / max) * ph;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    for (let i = 0; i <= 4; i++) {
      const v = max - (max * i) / 4;
      addSVG(chart, "line", { x1: m.l, y1: y(v), x2: W - m.r, y2: y(v), class: "grid-line" });
      svgText(chart, m.l - 10, y(v) + 4, `${Math.round(v)}%`, { class: "axis-text", "text-anchor": "end" });
    }
    addSVG(chart, "line", { x1: m.l, y1: y(100), x2: W - m.r, y2: y(100), class: "grid-line", stroke: "#1f9d74", "stroke-dasharray": "6 5" });
    svgText(chart, W - m.r, y(100) - 6, "água limpa (100%)", { class: "axis-text", "text-anchor": "end" });
    const passo = passoRotulo(pts.length);
    pts.forEach((p, i) => { if (i % passo === 0) svgText(chart, x(i), H - 10, p.hora, { class: "axis-text", "text-anchor": "middle" }); });
    for (let c = 0; c < 8; c++) {
      const seg = pts.map((p, i) => [i, p.porcentagens[c]]).filter(([, v]) => Number.isFinite(v));
      if (seg.length < 2) continue;
      addSVG(chart, "path", { d: seg.map(([i, v], k) => `${k ? "L" : "M"} ${x(i)} ${y(v)}`).join(" "), class: "series-line", stroke: colors[c], style: "stroke-width:2.2" });
      const [iu, vu] = seg.at(-1);
      addSVG(chart, "circle", { cx: x(iu), cy: y(vu), r: 4, fill: "#fff", stroke: colors[c], class: "series-dot",
        "data-tip": `${NOMES_CORES[c]} · ${pts[iu].hora}: ${fmt(vu, 1)}% da luz passou` });
    }
  }
  abas("#periodo-espectral", (btn) => { horasEspectro = Number(btn.dataset.horas); renderSpectralTime(); });

  /* ---------- evolucao ao longo do dia (abas) ---------- */
  // Faixas iguais as do ESP32: a linha tracejada marca onde a palavra muda.
  const INDICES = {
    contaminacao: { nome: "Contaminação", unidade: "%", casas: 0, teto: 100, faixas: [[10, "levemente contaminada"], [30, "contaminada"], [60, "muito contaminada"]],
      texto: "Onde a lagoa está entre a água limpa (0%) e a água suja de referência (100%)." },
    turbidez: { nome: "Turbidez", unidade: "% luz bloqueada", casas: 0, teto: 40, faixas: [[5, "levemente turva"], [15, "turva"], [35, "muito turva"]],
      texto: "Luz bloqueada pelas partículas em 590–630 nm (sensor de cor)." },
    algas: { nome: "Algas", unidade: "", casas: 3, teto: 0.1, faixas: [[0.02, "sinal fraco"], [0.08, "algas presentes"]],
      texto: "Absorção extra no vermelho 680 nm (clorofila) em relação ao amarelo 590 nm." },
    cor: { nome: "Cor", unidade: "", casas: 3, teto: 0.12, faixas: [[0.03, "levemente amarelada"], [0.1, "cor de chá"]],
      texto: "Absorção extra no violeta 415 nm (matéria orgânica dissolvida) em relação ao verde 555 nm." },
  };
  let indiceAtual = "contaminacao", ultimaSerie = [];
  function renderSeriesChart(serie = ultimaSerie) {
    ultimaSerie = serie;
    const chart = $("series-chart"), cfg = INDICES[indiceAtual];
    const pts = serie.filter((p) => Number.isFinite(p[indiceAtual]));
    setChartState("series-wrap", "series-empty", pts.length > 1);
    if ($("series-description")) $("series-description").textContent = `${cfg.texto} Água da lagoa, média a cada 10 minutos.`;
    if (!chart || pts.length < 2) return;
    const W = 900, H = 260, m = { t: 18, r: 24, b: 34, l: 58 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const maior = Math.max(cfg.teto, Math.max(...pts.map((p) => p[indiceAtual])) * 1.15);
    const min = 0, max = cfg.casas ? maior : tetoRedondo(maior, 20);
    const x = (i) => m.l + (i / (pts.length - 1)) * pw;
    const y = (v) => m.t + ((max - clamp(v, min, max)) / (max - min)) * ph;
    const rotulo = (v) => (cfg.unidade === "%" || cfg.unidade.startsWith("%") ? `${Math.round(v)}%` : v.toFixed(cfg.casas));
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    for (let i = 0; i <= 4; i++) {
      const v = max - ((max - min) * i) / 4, ly = y(v);
      addSVG(chart, "line", { x1: m.l, y1: ly, x2: W - m.r, y2: ly, class: "grid-line" });
      svgText(chart, m.l - 10, ly + 4, rotulo(v), { class: "axis-text", "text-anchor": "end" });
    }
    cfg.faixas.filter(([v]) => v < max).forEach(([v, nome]) => {
      addSVG(chart, "line", { x1: m.l, y1: y(v), x2: W - m.r, y2: y(v), class: "grid-line", stroke: "#d19a2b", "stroke-dasharray": "6 5" });
      svgText(chart, W - m.r, y(v) - 5, nome, { class: "axis-text", "text-anchor": "end" });
    });
    const passo = passoRotulo(pts.length);
    pts.forEach((p, i) => { if (i % passo === 0) svgText(chart, x(i), H - 10, p.hora, { class: "axis-text", "text-anchor": "middle" }); });
    const line = pts.map((p, i) => `${i ? "L" : "M"} ${x(i)} ${y(p[indiceAtual])}`).join(" ");
    addSVG(chart, "path", { d: line, class: "series-line", stroke: "#0a8fa8", pathLength: 1 });
    pts.forEach((p, i) => addSVG(chart, "circle", { cx: x(i), cy: y(p[indiceAtual]), r: pts.length > 40 ? 3 : 5, fill: "#fff", stroke: "#0a8fa8", class: "series-dot",
      "data-tip": `${p.hora} · ${cfg.nome}: ${rotulo(p[indiceAtual])}${cfg.unidade && cfg.unidade !== "%" ? ` ${cfg.unidade.replace("% ", "")}` : ""} · ${p.medicoes} medições` }));
  }
  // Liga um grupo de abas (so dentro do proprio grupo) e chama "aoTrocar" com o botao clicado.
  function abas(seletor, aoTrocar) {
    const botoes = [...document.querySelectorAll(`${seletor} .seg-btn`)];
    botoes.forEach((btn) => btn.addEventListener("click", () => {
      botoes.forEach((b) => { b.classList.toggle("is-active", b === btn); b.setAttribute("aria-selected", String(b === btn)); });
      aoTrocar(btn);
    }));
  }
  abas("#evolucao", (btn) => { indiceAtual = btn.dataset.index; renderSeriesChart(); });
  let ultimosDados = null;
  abas("#spectrum-mode", (btn) => { modoEspectro = btn.dataset.modo; drawn.delete("s"); renderSpectrumChart(ultimosDados); });
  abas("#canais-mode", (btn) => { modoCanais = btn.dataset.canais; renderLiveChart(ultimosDados); });

  /* ---------- validacao: sensor de cor x sensor de turbidez ---------- */
  function renderScatterChart(pares = []) {
    const chart = $("scatter-chart");
    const pts = pares.filter((p) => Number.isFinite(p.turbidez) && Number.isFinite(p.ntu));
    setChartState("scatter-wrap", "scatter-empty", pts.length > 1);
    if (!chart || pts.length < 2) return;
    const W = 900, H = 260, m = { t: 18, r: 24, b: 44, l: 58 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const maxX = tetoRedondo(Math.max(40, ...pts.map((p) => p.turbidez)) * 1.1, 20), maxY = tetoRedondo(Math.max(20, ...pts.map((p) => p.ntu)) * 1.1, 20);
    const x = (v) => m.l + (v / maxX) * pw, y = (v) => m.t + ((maxY - v) / maxY) * ph;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    for (let i = 0; i <= 4; i++) {
      const vy = (maxY * i) / 4, vx = (maxX * i) / 4;
      addSVG(chart, "line", { x1: m.l, y1: y(vy), x2: W - m.r, y2: y(vy), class: "grid-line" });
      svgText(chart, m.l - 10, y(vy) + 4, `${Math.round(vy)}`, { class: "axis-text", "text-anchor": "end" });
      svgText(chart, x(vx), H - 24, `${Math.round(vx)}%`, { class: "axis-text", "text-anchor": "middle" });
    }
    svgText(chart, m.l + pw / 2, H - 6, "luz bloqueada (sensor de cor)  →", { class: "axis-label", "text-anchor": "middle" });
    svgText(chart, m.l + 6, m.t + 10, "NTU (sensor de turbidez)", { class: "axis-label" });
    pts.forEach((p) => addSVG(chart, "circle", { cx: x(p.turbidez), cy: y(p.ntu), r: 4, fill: "#19b5c8", "fill-opacity": 0.55, stroke: "#0a8fa8", class: "series-dot",
      "data-tip": `${p.hora} · ${fmt(p.turbidez, 1)}% luz bloqueada · ${fmt(p.ntu, 1)} NTU` }));
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
      const contam = r.contaminacao == null ? "—" : `${Math.round(r.contaminacao)}%`;
      const turb = r.turbidez == null ? "—" : `${Math.round(r.turbidez)}%${r.turbidez_classe ? ` · ${r.turbidez_classe}` : ""}`;
      [["time-cell", r.hora], ["sample-cell", r.amostra], ["", r.tipo_display], ["numeric-cell", contam], ["numeric-cell", turb]].forEach(([cls, text], i) => {
        const td = tr.insertCell(); if (cls) td.className = cls;
        if (i === 2) { const b = document.createElement("span"); b.className = `type-badge type-${r.tipo}`; b.textContent = text; td.append(b); }
        else td.textContent = text;
      });
      const st = document.createElement("span");
      const estado = r.estado || (r.saturado ? "Saturada" : "Normal");
      st.className = `state-badge ${estado === "Normal" ? "state-ok" : "state-warning"}`;
      st.append(document.createElement("i"), document.createTextNode(estado));
      tr.insertCell().append(st); body.append(tr);
    });
    if (!list.length) {
      const tr = body.insertRow(); tr.dataset.empty = "true";
      const td = tr.insertCell(); td.colSpan = 6; td.className = "empty-row"; td.textContent = "Nenhuma leitura recebida para esta data.";
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
      const atual = data.amostra_atual, tb = data.turbidez || {};
      const luz = tb.luz_bloqueada_pct == null ? null : `${fmt(tb.luz_bloqueada_pct, 0)}% da luz bloqueada`;
      Object.entries({
        "sample-name": atual?.nome || "—", "sample-time": atual?.hora || data.ultima_leitura || "—",
        "sample-turbidity": tb.ntu != null ? `${fmt(tb.ntu, 1)} NTU` : tb.luz_bloqueada_pct != null ? `${fmt(tb.luz_bloqueada_pct, 0)}%` : "—",
        "sample-turbidity-class": [dg.turbidez, tb.ntu != null ? luz : luz && "luz bloqueada (sensor de cor)"].filter(Boolean).join(" · ") || "—",
        "sample-voltage": tb.tensao_v == null ? "—" : `${fmt(tb.tensao_v)} V`,
        "sample-algae": dg.algas || "—", "sample-color": dg.cor || "—",
        "sample-contamination": dg.contaminacao_pct == null ? "—" : `${dg.contaminacao_pct}%`,
        "sample-contamination-class": dg.contaminacao || "falta gravar a água suja de referência",
        "sample-summary": dg.resumo || "",
      }).forEach(([id, v]) => setText(id, v));
    }
    if ($("sync-badge")) $("sync-badge").textContent = data.demo ? "Dados de demonstração" : "Sincronização";
    if ($("sync-message")) $("sync-message").textContent = data.demo
      ? "Valores de exemplo; não foram enviados pelo Arduino nem gravados no banco."
      : "Leituras reais do ESP32 aparecem automaticamente aqui.";
    const kpis = document.querySelectorAll(".kpi-card [data-count]");
    [data.total_leituras, data.total_amostras, data.suspeitas ?? data.estouradas].forEach((v, i) => setNumber(kpis[i], Number(v) || 0, firstRender));
    setText("kpi-contaminacao", dg?.contaminacao_pct == null ? "—" : `${dg.contaminacao_pct}%`);
    if ($("kpi-contaminacao-badge")) $("kpi-contaminacao-badge").textContent = dg?.contaminacao || "—";
    const latest = document.querySelector(".kpi-value-time"); if (latest) latest.textContent = data.ultima_leitura || "—";
    if ($("kpi-ultima-nota")) $("kpi-ultima-nota").textContent = !data.ultima_leitura ? "sem medições nesta data"
      : data.aparelho_parado ? `aparelho sem enviar há ${data.minutos_sem_enviar} min` : "medição mais recente";
    if ($("data-updated")) $("data-updated").textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(data.atualizado_em ? new Date(data.atualizado_em) : new Date());
    updateSampleFilter(data.leituras || []);
    renderReadings(data); renderTurbidityChart(data.chart_data || []); renderSpectrumChart(data); renderLiveChart(data);
    renderSeriesChart(data.serie || []); renderScatterChart(data.comparacao || []); renderColetasTable();
    renderAbsorbChart(data); renderComponentes(data); renderObservacoes(data); renderSpectralTime(data.serie || []);
    ultimosDados = data;
    firstRender = false;
  }
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

  let refreshing = false;
  async function refresh() {
    const endpoint = shell?.dataset.dashboardUrl;
    if (!endpoint || document.hidden || refreshing) return;
    refreshing = true;
    try {
      const url = new URL(endpoint, location.href); url.searchParams.set("data", shell.dataset.selectedDate);
      const r = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      renderDashboard(await r.json());
    } catch (e) {
      if ($("data-updated")) $("data-updated").textContent = "falha na sincronização; tentando novamente";
      console.error("Não foi possível atualizar o painel.", e);
    } finally {
      refreshing = false;
    }
  }
  renderDashboard(readJSON("dashboard-data"));
  refresh();
  setInterval(refresh, 5000);
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