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
  const heroDrop = document.querySelector(".drop");
  const dropBody = heroDrop?.querySelector(".drop-body");
  const dropGlow = heroDrop?.querySelector("#dropGlow");
  if (heroDrop && dropBody && dropGlow && !reduce) {
    heroDrop.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      const bounds = heroDrop.getBoundingClientRect();
      const x = clamp((event.clientX - bounds.left) / bounds.width);
      const y = clamp((event.clientY - bounds.top) / bounds.height);
      dropBody.style.setProperty("--tilt-x", `${(0.5 - y) * 16}deg`);
      dropBody.style.setProperty("--tilt-y", `${(x - 0.5) * 16}deg`);
      dropGlow.setAttribute("cx", `${20 + x * 60}%`);
      dropGlow.setAttribute("cy", `${12 + y * 58}%`);
    });
    heroDrop.addEventListener("pointerleave", () => {
      dropBody.style.removeProperty("--tilt-x");
      dropBody.style.removeProperty("--tilt-y");
      dropGlow.setAttribute("cx", "35%");
      dropGlow.setAttribute("cy", "28%");
    });
  }
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
    const W = chart.clientWidth || 900, H = chart.clientHeight || 230, m = { t: 16, r: 20, b: 34, l: 54 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
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
      if ($("spectrum-description")) $("spectrum-description").textContent = "Para que serve: conferir a lanterna. Mostra a luz que chega em cada cor sem comparar com a água limpa; para analisar a água, volte para % de luz.";
    } else if ($("spectrum-description") && descricaoEspectro) {
      $("spectrum-description").textContent = descricaoEspectro;
    }
    const chart = $("spectrum-chart");
    const values = sp?.semanas?.[0]?.valores, labels = sp?.rotulos;
    const ok = Array.isArray(values) && values.length > 0 && values.every(Number.isFinite);
    setChartState("spectrum-wrap", "spectrum-empty", ok);
    if (!chart || !ok) return;
    const W = chart.clientWidth || 900, H = chart.clientHeight || 320, m = { t: 24, r: 24, b: 58, l: 66 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
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
      ? `Para que serve: ver se a luz ficou estável durante o dia (média de ${cn?.medicoes_dia ?? 0} leituras). Não mostra a qualidade da água, mostra se o aparelho mediu direito.`
      : "Para que serve: verificar se a lanterna e o sensor estão funcionando, antes de confiar nas análises. Este gráfico não mostra a qualidade da água, mostra se o aparelho está medindo direito.";
    // Veredito em uma frase: quem bate o olho ja sabe se esta tudo certo.
    const LUZ_MINIMA = 1000;
    if ($("canais-status") && ok) {
      const fracas = values.slice(0, 8).map((v, i) => [v, NOMES_CORES[i]]).filter(([v]) => v < LUZ_MINIMA);
      $("canais-status").textContent = fracas.length === 0 ? "✓ Luz suficiente em todas as cores: o aparelho está medindo bem."
        : fracas.length >= 6 ? "⚠ Pouca luz em quase todas as cores: confira se a lanterna está acesa, alinhada e com a caixa fechada."
        : `⚠ Pouca luz em ${fracas.map(([, n]) => n.toLowerCase()).join(", ")}: essas cores podem dar resultado impreciso.`;
    }
    if (!chart || !ok) return;
    const W = chart.clientWidth || 900, H = chart.clientHeight || 270, m = { t: 40, r: 20, b: 52, l: 70 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const maxV = Math.max(1200, ...values.map((v, i) => v + (erros?.[i] || 0))) * 1.12, gap = 10, bw = (pw - gap * (values.length - 1)) / values.length;
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
      svgText(chart, bx + bw / 2, H - 30, nir ? "Infraverm." : NOMES_CORES[i].replace("Verde-amarelo", "Verde-am."), { class: "axis-text", "text-anchor": "middle" });
      svgText(chart, bx + bw / 2, H - 12, nir ? "~910 nm" : `${labels[i]} nm`, { class: "axis-text", "text-anchor": "middle" });
    });
    // Linha da luz minima para medir bem.
    addSVG(chart, "line", { x1: m.l, y1: y(1000), x2: W - m.r, y2: y(1000), stroke: "#d2504a", "stroke-width": 1.6, "stroke-dasharray": "6 5" });
    svgText(chart, 4, 16, "luz captada", { class: "axis-label" });
    markDrawn("l");
  }

  /* ---------- analise espectral ---------- */
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
    const W = chart.clientWidth || 900, H = chart.clientHeight || 320, m = { t: 20, r: 24, b: 34, l: 58 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
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
      texto: "Para que serve: ver se a lagoa piorou ou melhorou durante o dia. 0% = igual à água limpa; 100% = igual à água podre." },
    turbidez: { nome: "Turbidez", unidade: "% luz bloqueada", casas: 0, teto: 40, faixas: [[5, "levemente turva"], [15, "turva"], [35, "muito turva"]],
      texto: "Para que serve: acompanhar o quanto a água está turva (barro, sujeira). Quanto mais alto, mais turva." },
    algas: { nome: "Algas", unidade: "", casas: 3, teto: 0.25, faixas: [[0.05, "moderado"], [0.2, "alto"]],
      texto: "Para que serve: acompanhar as algas. Subir à tarde é normal (sol); subir dia após dia é sinal de alerta." },
    cor: { nome: "Cor", unidade: "", casas: 3, teto: 0.25, faixas: [[0.05, "moderado"], [0.2, "alto"]],
      texto: "Para que serve: acompanhar a cor da água (amarelada por folhas ou esgoto). Quanto mais alto, mais amarelada." },
  };
  let indiceAtual = "contaminacao", ultimaSerie = [];
  function renderSeriesChart(serie = ultimaSerie) {
    ultimaSerie = serie;
    const chart = $("series-chart"), cfg = INDICES[indiceAtual];
    const pts = serie.filter((p) => Number.isFinite(p[indiceAtual]));
    setChartState("series-wrap", "series-empty", pts.length > 1);
    if ($("series-description")) $("series-description").textContent = `${cfg.texto} As linhas tracejadas mostram onde a água muda de nível.`;
    if (!chart || pts.length < 2) return;
    const W = chart.clientWidth || 900, H = chart.clientHeight || 260, m = { t: 18, r: 24, b: 34, l: 58 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
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
    const W = chart.clientWidth || 900, H = chart.clientHeight || 260, m = { t: 18, r: 24, b: 44, l: 58 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
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

  /* ---------- pagina Agora: turbidez e indice geral da ultima leitura ---------- */
  function renderQualidadeAgora(data) {
    if (!$("agora-qualidade")) return;
    const q = data?.qualidade, tb = data?.turbidez || {};
    setText("ag-hora", data?.amostra_atual?.hora || data?.ultima_leitura || "—");
    if (!q?.valida) {
      cartoesQualidade("ag", { valida: false, alerta: q?.alerta || "Ainda não há leitura válida da lagoa hoje." });
      setText("ag-conclusao", "Para que serve: saber de relance se a água da lagoa está boa, em atenção ou em alerta.");
      return;
    }
    cartoesQualidade("ag", { ntu: q.ntu, luz: tb.luz_bloqueada_pct, iq: q.indice_geral, status: q.status, cor: q.cor, alerta: q.alerta });
    setText("ag-conclusao", q.conclusao || "");
  }


  /* ---------- amostras (como no design: media de 3 repeticoes por amostra) ---------- */
  const VERDE = "#1f9d74", AMBAR = "#d19a2b", VERMELHO = "#d2504a";
  const fx = (v, d) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const COR_SEL = "#0a8fa8", COR_BOA = "#1f9d74", COR_PODRE = "#a26a2a";
  const IND = [
    { k: "clorofila", nome: "Algas / clorofila", cor: "#2f6fd0", curto: "Algas",
      alto: "Alta presença de algas, possível eutrofização (excesso de nutrientes).", moderado: "Presença moderada de algas. Acompanhar a tendência nos próximos dias.", baixo: "Pouca clorofila detectada." },
    { k: "cianobacterias", nome: "Cianobactérias", cor: "#ed7845", curto: "Cianobactérias",
      alto: "Assinatura compatível com cianobactérias, risco potencial de toxinas. Recomenda-se análise laboratorial.", moderado: "Sinal moderado de ficocianina. Possível presença de cianobactérias; confirmar em laboratório.", baixo: "Sem sinal relevante de cianobactérias." },
    { k: "materia_organica", nome: "Matéria orgânica", cor: "#21b98a", curto: "Matéria orgânica",
      alto: "Matéria orgânica dissolvida elevada, possível decomposição ou esgoto.", moderado: "Matéria orgânica dissolvida moderada.", baixo: "Pouca matéria orgânica dissolvida." },
    { k: "sedimentos", nome: "Sedimentos", cor: "#8452c6", curto: "Sedimentos",
      alto: "Partículas em suspensão elevadas, possível erosão ou revolvimento do fundo.", moderado: "Partículas em suspensão moderadas.", baixo: "Poucas partículas em suspensão." },
  ];
  const ONDAS = [415, 445, 480, 515, 555, 590, 630, 680];
  let amostrasDados = null, selecionada = null, historicoDados = null;
  const amostraSel = () => amostrasDados?.amostras.find((a) => a.id === selecionada);
  const curto = (nome) => nome.replace("Lagoa – ", "").replace(" (padrão)", "");
  const nivelCor = (n) => (n === "baixo" ? VERDE : n === "alto" ? VERMELHO : AMBAR);
  const statusClasse = (st) => (st === "bom" ? "state-ok" : "state-warning");
  function badge(el, texto, ok) {
    if (!el) return;
    el.className = `state-badge ${ok ? "state-ok" : "state-warning"}`;
    el.replaceChildren(document.createElement("i"), document.createTextNode(texto));
  }
  // Cor aproximada de cada comprimento de onda (fundo do grafico).
  function corNm(l) {
    let r = 0, g = 0, b = 0;
    if (l < 440) { r = -(l - 440) / 60; b = 1; } else if (l < 490) { g = (l - 440) / 50; b = 1; } else if (l < 510) { g = 1; b = -(l - 510) / 20; }
    else if (l < 580) { r = (l - 510) / 70; g = 1; } else if (l < 645) { r = 1; g = -(l - 645) / 65; } else { r = 1; }
    const f = l > 700 ? 0.3 + 0.7 * (780 - l) / 80 : 1, c = (v) => Math.round(255 * Math.pow(Math.max(0, v) * f, 0.8));
    return `rgb(${c(r)},${c(g)},${c(b)})`;
  }

  function preencherSelect() {
    const sel = $("am-select"); if (!sel || !amostrasDados) return;
    const atual = sel.value || selecionada;
    sel.replaceChildren(...amostrasDados.amostras.map((a) => new Option(a.nome, a.id)));
    selecionada = amostrasDados.amostras.some((a) => a.id === atual) ? atual : amostrasDados.padrao;
    sel.value = selecionada || "";
  }

  function renderGaugeAmostra(ntu, id = "am-gauge") {
    const svg = $(id); if (!svg) return;
    svg.replaceChildren(); svg.style.display = Number.isFinite(ntu) ? "" : "none";
    if (!Number.isFinite(ntu)) return;
    const MAX = 200, cx = 100, cy = 100, R = 80;
    const pt = (v, r) => { const a = Math.PI * (1 - Math.min(v, MAX) / MAX); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
    [[0, 40, VERDE], [40, 100, AMBAR], [100, MAX, VERMELHO]].forEach(([a, b, c]) => {
      const [x0, y0] = pt(a + 0.6, R), [x1, y1] = pt(b - 0.6, R);
      addSVG(svg, "path", { d: `M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}`, stroke: c, "stroke-width": 16, fill: "none", opacity: 0.85 });
    });
    [0, 40, 100, 200].forEach((v) => { const [x, y] = pt(v, R + 14); svgText(svg, x, y + 3, String(v), { class: "axis-text", "text-anchor": "middle" }); });
    const [nx, ny] = pt(ntu, R - 6);
    addSVG(svg, "line", { x1: cx, y1: cy, x2: nx, y2: ny, stroke: "#23414d", "stroke-width": 3, "stroke-linecap": "round" });
    addSVG(svg, "circle", { cx, cy, r: 6, fill: "#23414d" });
  }

  const COR_STATUS = { bom: VERDE, "atenção": AMBAR, alerta: VERMELHO };
  // Os 4 cartoes do design (turbidez, indice geral, cor, alerta) com prefixo am- ou ag-.
  function cartoesQualidade(p, d) {
    const ntu = d?.ntu;
    setText(`${p}-ntu`, ntu != null ? fx(ntu, 1) : d?.luz != null ? `${fx(d.luz, 0)}%` : "—");
    setText(`${p}-ntu-un`, ntu != null ? "NTU" : d?.luz != null ? "luz bloqueada" : "");
    renderGaugeAmostra(ntu, `${p}-gauge`);
    const classe = d?.valida === false ? "sem leitura válida" : ntu == null ? "Sem leitura de NTU (sensor de cor)" : ntu <= 40 ? "Compatível com classe 1" : ntu <= 100 ? "Compatível com classes 2 e 3" : "Fora dos limites CONAMA";
    badge($(`${p}-classe`), classe, ntu != null && ntu <= 40);
    const iq = $(`${p}-iq`);
    if (iq) { iq.textContent = d?.iq == null ? "—" : String(d.iq); iq.style.color = COR_STATUS[d?.status] || ""; }
    const sem = $(`${p}-sem`);
    if (sem) { sem.replaceChildren(); [["alerta", VERMELHO], ["atenção", AMBAR], ["bom", VERDE]].forEach(([n, c], i) => addSVG(sem, "circle", { cx: 12 + i * 30, cy: 10, r: 8, fill: c, opacity: d?.status === n ? 1 : 0.18 })); }
    badge($(`${p}-status`), d?.status || "sem leitura válida", d?.status === "bom");
    const sw = $(`${p}-swatch`);
    if (sw) { sw.replaceChildren(); addSVG(sw, "rect", { x: 1, y: 1, width: 86, height: 86, rx: 16, fill: d?.cor?.hex || "#e6eef1", stroke: "#c9d3dc" }); }
    setText(`${p}-cor`, d?.cor?.nome || "—");
    setText(`${p}-cor-hex`, d?.cor ? `Cor medida ${d.cor.hex}` : "—");
    setText(`${p}-cor-lambda`, d?.cor?.lambda_dom_nm ? `λ dominante ${d.cor.lambda_dom_nm} nm` : "");
    setText(`${p}-alerta`, d?.alerta || "—");
    const card = $(`${p}-card-alerta`); if (card) card.style.borderLeftColor = COR_STATUS[d?.status] || "var(--line)";
  }

  function renderAmostra() {
    const a = amostraSel(); if (!a) return;
    setText("am-nome", a.nome);
    setText("am-leitura", a.padrao ? `padrão gravado em ${a.leitura}` : `${a.leitura} · ${a.repeticoes} repetiç${a.repeticoes === 1 ? "ão" : "ões"}`);
    setText("am-conclusao", a.conclusao || "");
    cartoesQualidade("am", { ntu: a.turbidez_ntu, luz: a.luz_bloqueada_pct, iq: a.indice_geral, status: a.status, cor: a.cor, alerta: a.alerta });
  }


  function renderAssinatura() {
    const chart = $("assin-chart"), lista = amostrasDados?.amostras || [];
    const a = amostraSel(), boa = lista.find((x) => x.id === "agua_boa"), podre = lista.find((x) => x.id === "agua_podre");
    const series = [];
    if (a) series.push({ nome: a.nome, cor: COR_SEL, v: a.absorbancia, w: 3.2, sel: true, nir: a.sedimentos });
    if (boa && a?.id !== "agua_boa") series.push({ nome: "Água boa", cor: COR_BOA, v: boa.absorbancia, w: 2.2, nir: boa.sedimentos });
    if (podre && a?.id !== "agua_podre") series.push({ nome: "Água podre", cor: COR_PODRE, v: podre.absorbancia, w: 2.2, nir: podre.sedimentos });
    const ok = series.length > 0 && series[0].v.every(Number.isFinite);
    setChartState("assin-wrap", "assin-empty", ok);
    const leg = $("assin-legenda");
    if (leg) leg.replaceChildren(...series.map((s) => { const sp = document.createElement("span"); const i = document.createElement("i"); i.style.setProperty("--c", s.cor); sp.append(i, s.nome); return sp; }));
    if (!chart || !ok) return;
    const comNir = series.some((s) => Number.isFinite(s.nir));
    const W = chart.clientWidth || 900, H = chart.clientHeight || 340, m = { t: 52, r: 24, b: 40, l: 58 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xmax = comNir ? 930 : 700, x = (nm) => m.l + ((nm - 400) / (xmax - 400)) * pw;
    const todos = series.flatMap((s) => [...s.v, s.nir]).filter(Number.isFinite);
    const ymin = Math.min(0, ...todos), ymax = Math.max(0.3, ...todos) * 1.1;
    const y = (v) => m.t + ((ymax - v) / (ymax - ymin)) * ph;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    const defs = addSVG(chart, "defs"), g = addSVG(defs, "linearGradient", { id: "assin-grad", x1: 0, x2: 1, y1: 0, y2: 0 });
    for (let l = 400; l <= 700; l += 15) addSVG(g, "stop", { offset: (l - 400) / 300, "stop-color": corNm(l) });
    addSVG(chart, "rect", { x: x(400), y: m.t, width: x(700) - x(400), height: ph, fill: "url(#assin-grad)", opacity: 0.16 });
    if (comNir) {
      addSVG(chart, "rect", { x: x(700), y: m.t, width: x(930) - x(700), height: ph, fill: "#7f8c8d", opacity: 0.1 });
      svgText(chart, (x(700) + x(930)) / 2, H - m.b - 8, "infravermelho", { class: "axis-text", "text-anchor": "middle" });
    }
    for (let i = 0; i <= 4; i++) {
      const v = ymax - ((ymax - ymin) * i) / 4;
      addSVG(chart, "line", { x1: m.l, y1: y(v), x2: W - m.r, y2: y(v), class: "grid-line" });
      svgText(chart, m.l - 10, y(v) + 4, fx(v, 2), { class: "axis-text", "text-anchor": "end" });
    }
    if (ymin < 0) addSVG(chart, "line", { x1: m.l, y1: y(0), x2: W - m.r, y2: y(0), stroke: "#7f8c8d" });
    [...ONDAS, ...(comNir ? [910] : [])].forEach((nm) => svgText(chart, x(nm), H - 22, String(nm), { class: "axis-text", "text-anchor": "middle" }));
    svgText(chart, W - m.r, H - 4, "comprimento de onda (nm)", { class: "axis-text", "text-anchor": "end" });
    svgText(chart, m.l - 50, m.t - 40, "absorbância", { class: "axis-text" });
    // Regioes adaptadas aos canais do AS7341.
    [{ a: 410, b: 485, t: "Matéria orgânica", row: 0 }, { a: 440, b: 450, t: "Clorofila", row: 1 }, { a: 585, b: 635, t: "Cianobactérias", row: 0 },
      { a: 675, b: 685, t: "Clorofila", row: 1 }, ...(comNir ? [{ a: 900, b: 920, t: "Partículas", row: 0, fim: true }] : [])].forEach((r) => {
      const ry = m.t - 32 + r.row * 16;
      addSVG(chart, "rect", { x: x(r.a), y: ry + 4, width: Math.max(4, x(r.b) - x(r.a)), height: H - m.b - ry - 4, fill: "#23414d", opacity: 0.05 });
      addSVG(chart, "line", { x1: x(r.a), x2: x(r.b), y1: ry + 4, y2: ry + 4, stroke: "#5f6b75", "stroke-width": 2, "stroke-linecap": "round" });
      svgText(chart, r.fim ? x(r.b) : x(r.a), ry, r.t, { class: "axis-label", "text-anchor": r.fim ? "end" : "start" });
    });
    series.slice().reverse().forEach((s) => {
      const pts = ONDAS.map((nm, i) => [nm, s.v[i]]).concat(comNir && Number.isFinite(s.nir) ? [[910, s.nir]] : []);
      addSVG(chart, "path", { d: pts.map(([nm, v], i) => `${i ? "L" : "M"} ${x(nm)} ${y(v)}`).join(" "), stroke: s.cor, "stroke-width": s.w, fill: "none", "stroke-linejoin": "round", opacity: s.sel ? 1 : 0.8 });
      pts.forEach(([nm, v]) => addSVG(chart, "circle", { cx: x(nm), cy: y(v), r: s.sel ? 4.5 : 3.5, fill: s.cor, stroke: "#fff", "stroke-width": 1.5, class: "series-dot",
        "data-tip": `${s.nome} · ${nm} nm · A = ${fx(v, 3)}` }));
    });
  }

  const FOTOS = { clorofila: "alg", cianobacterias: "cya", materia_organica: "org", sedimentos: "sed" };
  function renderIndicadoresAmostra() {
    const box = $("indicadores-body"), a = amostraSel(); if (!box) return;
    box.replaceChildren();
    if (!a) return;
    const pasta = shell?.dataset.imgUrl || "/static/aquamonitor/img/";
    IND.forEach((d) => {
      const v = a[d.k], nv = a.niveis?.[d.k];
      const card = document.createElement("article"); card.className = "sample-metric";
      card.style.padding = "0"; card.style.overflow = "hidden"; card.style.gap = "0"; card.style.display = "flex"; card.style.flexDirection = "column"; card.style.justifyContent = "flex-start";
      const foto = document.createElement("div"); foto.setAttribute("role", "img"); foto.setAttribute("aria-label", `Foto: ${d.nome}`);
      Object.assign(foto.style, { height: "150px", backgroundImage: `url(${pasta}indicador-${FOTOS[d.k]}.jpg)`, backgroundSize: "cover", backgroundPosition: "center" });
      const corpo = document.createElement("div"); Object.assign(corpo.style, { display: "flex", flexDirection: "column", gap: "12px", padding: "18px 22px 22px" });
      const topo = document.createElement("div"); Object.assign(topo.style, { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" });
      const nome = document.createElement("strong"); nome.textContent = d.nome; nome.style.fontSize = "21px";
      const b = document.createElement("span"); badge(b, nv || "sem dado", nv === "baixo");
      topo.append(nome, b);
      const barra = document.createElementNS(SVG_NS, "svg"); barra.setAttribute("viewBox", "0 0 100 8"); barra.setAttribute("preserveAspectRatio", "none");
      barra.style.width = "100%"; barra.style.height = "10px";
      addSVG(barra, "rect", { x: 0, y: 0, width: 100, height: 8, rx: 4, fill: "rgba(16,110,135,.12)" });
      if (Number.isFinite(v)) addSVG(barra, "rect", { x: 0, y: 0, width: Math.max(2, clamp(v / 0.4) * 100), height: 8, rx: 4, fill: nivelCor(nv) });
      const valor = document.createElement("small"); valor.textContent = Number.isFinite(v) ? `Índice ${fx(v, 3)}` : "Sem sinal (a lanterna emite pouco infravermelho)";
      const texto = document.createElement("p"); Object.assign(texto.style, { margin: "0", fontSize: "17px", lineHeight: "1.5" });
      texto.textContent = nv ? d[nv] : "—";
      corpo.append(topo, barra, valor, texto); card.append(foto, corpo); box.append(card);
    });
  }

  function renderComparacaoAmostras() {
    const chart = $("cmp-chart"), lista = (amostrasDados?.comparacao || []).map((id) => amostrasDados.amostras.find((a) => a.id === id)).filter(Boolean);
    setChartState("cmp-wrap", "cmp-empty", lista.length > 1);
    if (!chart || lista.length < 2) return;
    const inds = [...IND.map((d) => [d.k, d.curto, d.cor]), ["turbidez", "Turbidez", "#d6a417"]];
    const W = chart.clientWidth || 600, H = chart.clientHeight || 300, m = { t: 14, r: 10, b: 40, l: 44 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const grupo = pw / lista.length, bw = (grupo - 26) / inds.length, y = (v) => m.t + (1 - clamp(v ?? 0)) * ph;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    for (let i = 0; i <= 5; i++) {
      const v = 1 - i / 5;
      addSVG(chart, "line", { x1: m.l, y1: y(v), x2: W - m.r, y2: y(v), class: "grid-line" });
      svgText(chart, m.l - 10, y(v) + 4, fx(v, 2), { class: "axis-text", "text-anchor": "end" });
    }
    lista.forEach((a, j) => {
      const x0 = m.l + j * grupo + 13;
      if (a.id === selecionada) addSVG(chart, "rect", { x: x0 - 8, y: m.t, width: grupo - 10, height: ph, rx: 8, fill: "#19b5c8", opacity: 0.1 });
      inds.forEach(([k, nome, cor], i) => {
        const v = a.intensidades?.[k];
        addSVG(chart, "rect", { x: x0 + i * bw, y: y(v), width: Math.max(2, bw - 3), height: Math.max(1, m.t + ph - y(v)), rx: 3, fill: cor,
          class: "bar-live", "data-tip": `${a.nome} · ${nome}: ${v == null ? "sem dado" : fx(v, 2)}` });
      });
      svgText(chart, m.l + j * grupo + grupo / 2, H - 16, curto(a.nome), { class: a.id === selecionada ? "axis-label" : "axis-text", "text-anchor": "middle" });
    });
  }

  function renderSemelhancaAmostra() {
    const chart = $("sim-chart"), a = amostraSel(), lista = a?.semelhanca || [];
    setChartState("sim-wrap", "sim-empty", lista.length > 0);
    const concl = $("sim-concl");
    if (concl) {
      concl.replaceChildren();
      if (a && lista.length) { const b = document.createElement("strong"); b.textContent = a.referencia_mais_semelhante.toLowerCase(); concl.append(`${a.nome} é mais semelhante a: `, b, "."); }
    }
    if (!chart || !lista.length) return;
    const W = chart.clientWidth || 600, H = chart.clientHeight || 20 + lista.length * 40, row = Math.min(56, (H - 20) / lista.length);
    const m = { l: Math.min(300, W * 0.32), r: 70 }, pw = W - m.l - m.r;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    lista.forEach((r, i) => {
      const yy = 10 + i * row;
      svgText(chart, 6, yy + 22, r.referencia, { class: i === 0 ? "axis-label" : "axis-text" });
      addSVG(chart, "rect", { x: m.l, y: yy + 8, width: pw, height: 20, rx: 10, fill: "rgba(16,110,135,.1)" });
      addSVG(chart, "rect", { x: m.l, y: yy + 8, width: Math.max(4, (pw * r.semelhanca_pct) / 100), height: 20, rx: 10, fill: i === 0 ? "#0a8fa8" : "#7cc7d3",
        "data-tip": `${r.referencia}: ${fx(r.semelhanca_pct, 1)}%` });
      svgText(chart, W - 6, yy + 22, `${fx(r.semelhanca_pct, 1)}%`, { class: "axis-text", "text-anchor": "end" });
    });
  }

  function renderDiluicaoAmostras() {
    const chart = $("dil-chart"), series = amostrasDados?.diluicao || [];
    setChartState("dil-wrap", "dil-empty", series.length > 0);
    if (!chart || !series.length) return;
    const W = chart.clientWidth || 900, H = chart.clientHeight || 290, gap = 30, cw = (W - gap * (series.length - 1)) / series.length;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    series.forEach((s, k) => {
      const ox = k * (cw + gap), m = { t: 30, b: 56, l: 42, r: 8 }, pw = cw - m.l - m.r, ph = H - m.t - m.b, cor = colors[(k * 3 + 5) % 8];
      const maxC = Math.max(100, ...s.pontos.map((p) => p.c)), maxA = Math.max(0.2, ...s.pontos.map((p) => p.a)) * 1.12;
      const x = (c) => ox + m.l + (c / maxC) * pw, y = (v) => m.t + ((maxA - Math.max(0, v)) / maxA) * ph;
      svgText(chart, ox, 14, `Corante ${s.corante} · ${s.canal_nm} nm`, { class: "axis-label" });
      for (let i = 0; i <= 4; i++) {
        const v = (maxA * i) / 4, c = (maxC * i) / 4;
        addSVG(chart, "line", { x1: ox + m.l, y1: y(v), x2: ox + cw - m.r, y2: y(v), class: "grid-line" });
        svgText(chart, ox + m.l - 6, y(v) + 4, fx(v, 2), { class: "axis-text", "text-anchor": "end" });
        svgText(chart, x(c), H - m.b + 16, `${Math.round(c)}%`, { class: "axis-text", "text-anchor": "middle" });
      }
      addSVG(chart, "line", { x1: x(0), y1: y(s.intercepto), x2: x(maxC), y2: y(s.intercepto + s.inclinacao * maxC), stroke: cor, "stroke-width": 2, "stroke-dasharray": "6 5" });
      s.pontos.forEach((p) => addSVG(chart, "circle", { cx: x(p.c), cy: y(p.a), r: 6, fill: cor, class: "series-dot", "data-tip": `${fx(p.c, 0)}% · A = ${fx(p.a, 3)}` }));
      const sinal = s.intercepto < 0 ? "−" : "+";
      svgText(chart, ox, H - 10, `A = ${fx(s.inclinacao, 5)}·c ${sinal} ${fx(Math.abs(s.intercepto), 4)}`, { class: "axis-text" });
      svgText(chart, ox + cw, H - 10, `R² = ${s.r2 == null ? "—" : fx(s.r2, 3)}`, { class: "axis-label", "text-anchor": "end" });
    });
  }

  const CORES_PONTOS = ["#2f6fd0", "#ed7845", "#21b98a", "#8452c6", "#e8a926", "#e34e5a"];
  function linhasPorPonto(chartId, wrapId, emptyId, specs, max, limites, casas) {
    const chart = $(chartId), hist = historicoDados?.historico || [];
    const datas = [...new Set(hist.map((h) => h.data))].sort();
    const ok = datas.length > 1 && specs.some((s) => hist.filter((h) => h.ponto === s.ponto && Number.isFinite(h[s.campo])).length > 1);
    setChartState(wrapId, emptyId, ok);
    if (!chart || !ok) return;
    const W = chart.clientWidth || 600, H = chart.clientHeight || 280, m = { t: 14, r: 10, b: 30, l: 46 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const x = (d) => m.l + (datas.indexOf(d) / (datas.length - 1)) * pw, y = (v) => m.t + ((max - clamp(v, 0, max)) / max) * ph;
    chart.replaceChildren(); chart.setAttribute("viewBox", `0 0 ${W} ${H}`); chart.setAttribute("preserveAspectRatio", "none");
    for (let i = 0; i <= 4; i++) {
      const v = max - (max * i) / 4;
      addSVG(chart, "line", { x1: m.l, y1: y(v), x2: W - m.r, y2: y(v), class: "grid-line" });
      svgText(chart, m.l - 8, y(v) + 4, fx(v, casas), { class: "axis-text", "text-anchor": "end" });
    }
    limites.filter(([v]) => v <= max).forEach(([v, nome, cor]) => {
      addSVG(chart, "line", { x1: m.l, y1: y(v), x2: W - m.r, y2: y(v), stroke: cor, "stroke-width": 1.5, "stroke-dasharray": "5 4" });
      svgText(chart, m.l + 6, y(v) - 5, nome, { class: "axis-label" });
    });
    const passo = passoRotulo(datas.length);
    datas.forEach((d, i) => { if (i % passo === 0) svgText(chart, x(d), H - 8, `${d.slice(8, 10)}/${d.slice(5, 7)}`, { class: "axis-text", "text-anchor": "middle" }); });
    const destacar = selecionada?.startsWith("lagoa");
    specs.forEach((s) => {
      const pts = hist.filter((h) => h.ponto === s.ponto && Number.isFinite(h[s.campo]));
      if (pts.length < 2) return;
      addSVG(chart, "path", { d: pts.map((h, i) => `${i ? "L" : "M"} ${x(h.data)} ${y(h[s.campo])}`).join(" "), stroke: s.cor, fill: "none",
        "stroke-width": s.ponto === selecionada ? 2.8 : 1.8, "stroke-dasharray": s.tracejado ? "5 4" : null, opacity: destacar && s.ponto !== selecionada ? 0.45 : 1 });
      pts.forEach((h) => addSVG(chart, "circle", { cx: x(h.data), cy: y(h[s.campo]), r: 3, fill: s.cor, class: "series-dot",
        "data-tip": `${h.ponto_nome} · ${h.data.split("-").reverse().join("/")} · ${s.nome}: ${fx(h[s.campo], casas === 0 ? 1 : 3)}` }));
    });
  }
  function renderHistoricoPontos() {
    const pontos = historicoDados?.pontos || [], hist = historicoDados?.historico || [];
    const cor = (i) => CORES_PONTOS[i % CORES_PONTOS.length];
    const leg = $("hist-legenda");
    if (leg) leg.replaceChildren(...pontos.map((p, i) => { const sp = document.createElement("span"); const it = document.createElement("i"); it.style.setProperty("--c", cor(i)); sp.append(it, curto(p.nome)); return sp; }));
    const temNtu = hist.filter((h) => Number.isFinite(h.ntu)).length > 1;
    setText("hist-t-titulo", temNtu ? "Turbidez (NTU)" : "Turbidez (% de luz bloqueada, sem NTU)");
    const campoT = temNtu ? "ntu" : "turbidez";
    const maxT = tetoRedondo(Math.max(temNtu ? 110 : 40, ...hist.map((h) => h[campoT] ?? 0)) * 1.08, 20);
    linhasPorPonto("hist-t-chart", "hist-t-wrap", "hist-t-empty", pontos.map((p, i) => ({ ponto: p.id, campo: campoT, cor: cor(i), nome: "Turbidez" })), maxT,
      temNtu ? [[40, "Classe 1 · 40 NTU", "#7f8c8d"], [100, "Classes 2 e 3 · 100 NTU", VERMELHO]] : [], 0);
    const maxI = Math.max(0.3, ...hist.flatMap((h) => [h.clorofila, h.materia_organica]).filter(Number.isFinite)) * 1.08;
    linhasPorPonto("hist-i-chart", "hist-i-wrap", "hist-i-empty", pontos.flatMap((p, i) => [
      { ponto: p.id, campo: "clorofila", cor: cor(i), nome: "Clorofila" },
      { ponto: p.id, campo: "materia_organica", cor: cor(i), nome: "Matéria orgânica", tracejado: true },
    ]), maxI, [[0.05, "baixo/moderado 0,05", "#7f8c8d"], [0.2, "moderado/alto 0,20", "#7f8c8d"]], 2);
  }

  let ordemTabela = { k: null, dir: 1 };
  function renderTabelaAmostras() {
    const body = $("am-tabela-body"); if (!body || !amostrasDados) return;
    const busca = ($("am-busca")?.value || "").trim().toLocaleLowerCase("pt-BR");
    let lista = amostrasDados.amostras.filter((a) => !busca || `${a.nome} ${a.status}`.toLocaleLowerCase("pt-BR").includes(busca));
    if (ordemTabela.k) lista = lista.slice().sort((a, b) => {
      const va = a[ordemTabela.k], vb = b[ordemTabela.k];
      return (va == null) - (vb == null) || (typeof va === "string" ? va.localeCompare(vb, "pt-BR") : va - vb) * ordemTabela.dir;
    });
    body.replaceChildren();
    lista.forEach((a) => {
      const tr = body.insertRow(); tr.style.cursor = "pointer";
      if (a.id === selecionada) tr.style.background = "rgba(25,181,200,.1)";
      [[a.nome, "sample-cell"], [a.leitura, "time-cell"], [fx(a.turbidez_ntu, 1)], [fx(a.turbidez_dp, 2)], [fx(a.clorofila, 3)], [fx(a.cianobacterias, 3)],
        [fx(a.materia_organica, 3)], [fx(a.sedimentos, 3)], [fx(a.abs_dp, 4)], [a.indice_geral ?? "—"]].forEach(([t, cls], i) => {
        const td = tr.insertCell(); td.textContent = t; td.className = cls || (i > 1 ? "numeric-cell" : "");
      });
      const st = document.createElement("span"); badge(st, a.status || "—", a.status === "bom"); tr.insertCell().append(st);
      tr.addEventListener("click", () => selecionar(a.id));
    });
  }
  document.querySelectorAll("#am-tabela th[data-k]").forEach((th) => { th.style.cursor = "pointer"; th.addEventListener("click", () => {
    ordemTabela = { k: th.dataset.k, dir: ordemTabela.k === th.dataset.k ? -ordemTabela.dir : 1 }; renderTabelaAmostras();
  }); });
  $("am-busca")?.addEventListener("input", renderTabelaAmostras);

  function renderTudoAmostras() {
    renderAmostra(); renderAssinatura(); renderIndicadoresAmostra(); renderComparacaoAmostras(); renderSemelhancaAmostra();
    renderDiluicaoAmostras(); renderHistoricoPontos(); renderTabelaAmostras();
  }
  function selecionar(id) { selecionada = id; if ($("am-select")) $("am-select").value = id; renderTudoAmostras(); }
  $("am-select")?.addEventListener("change", (e) => selecionar(e.target.value));
  async function carregarAmostras() {
    const url = shell?.dataset.amostrasUrl; if (!url || document.hidden || !$("am-select")) return; // so na pagina Amostras
    try {
      const r = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      amostrasDados = await r.json(); preencherSelect();
      if (!amostrasDados.amostras.length) setText("am-conclusao", "Nenhuma amostra válida ainda: grave a água limpa (BOOT → 1) e meça amostras com nome (n lagoa_p1, n agua_boa...).");
      renderTudoAmostras();
    } catch (e) { console.error("Não foi possível carregar as amostras.", e); }
  }
  async function carregarHistorico() {
    const url = shell?.dataset.historicoUrl; if (!url || document.hidden || !$("hist-t-chart")) return; // so na pagina Historico
    try {
      const r = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (r.ok) { historicoDados = await r.json(); renderHistoricoPontos(); }
    } catch (e) { console.error("Não foi possível carregar o histórico.", e); }
  }
  let redimensionar = null;
  addEventListener("resize", () => {
    clearTimeout(redimensionar);
    redimensionar = setTimeout(() => { renderTudoAmostras(); if (ultimosDados) renderDashboard(ultimosDados); }, 250);
  });
  carregarAmostras(); setInterval(carregarAmostras, 60 * 1000);
  carregarHistorico(); setInterval(carregarHistorico, 10 * 60 * 1000);

  // Pagina Historico: registros recebidos no dia escolhido.
  async function carregarRegistros(resetPage = false) {
    const campo = $("registros-data"), url = shell?.dataset.dashboardUrl;
    if (!campo || !url || document.hidden) return;
    if (resetPage) currentReadingsPage = 1;
    try {
      const u = new URL(url, location.href); u.searchParams.set("data", campo.value);
      const r = await fetch(u, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json(); updateSampleFilter(d.leituras || []); renderReadings(d);
    } catch (e) { console.error("Não foi possível carregar os registros.", e); }
  }
  $("registros-data")?.addEventListener("change", () => carregarRegistros(true));

  /* ---------- tabelas ---------- */
  const READINGS_PER_PAGE = 10;
  let rows = [];
  let filteredRows = [];
  let currentReadingsPage = 1;
  carregarRegistros(); setInterval(carregarRegistros, 60 * 1000);
  function renderReadings(data) {
    const body = $("readings-body"); if (!body) return;
    body.replaceChildren();
    const list = data.leituras || [];
    list.forEach((r) => {
      const tr = document.createElement("tr");
      tr.dataset.sample = r.amostra.toLocaleLowerCase("pt-BR"); tr.dataset.type = r.tipo;
      const contam = r.contaminacao == null ? "—" : `${Math.round(r.contaminacao)}%`;
      const turb = r.turbidez == null ? "—" : `${Math.round(r.turbidez)}%${r.turbidez_classe ? ` · ${r.turbidez_classe}` : ""}`;
      const num = (v, casas) => (v == null ? "—" : Number(v).toFixed(casas));
      [["time-cell", r.hora], ["sample-cell", r.amostra], ["", r.tipo_display], ["numeric-cell", contam], ["numeric-cell", turb],
        ["numeric-cell", num(r.ntu, 1)], ["numeric-cell", num(r.clorofila, 3)], ["numeric-cell", num(r.cianobacterias, 3)],
        ["numeric-cell", num(r.materia_organica, 3)], ["numeric-cell", num(r.sedimentos, 3)], ["numeric-cell", r.indice_geral ?? "—"], ["", r.status || "—"]].forEach(([cls, text], i) => {
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
      const td = tr.insertCell(); td.colSpan = 13; td.className = "empty-row"; td.textContent = "Nenhuma leitura recebida para esta data.";
    }
    rows = [...body.querySelectorAll("tr:not([data-empty])")];
    filterReadings();
  }
  function filterReadings(resetPage = false) {
    if (resetPage) currentReadingsPage = 1;
    const s = $("reading-search")?.value.trim().toLocaleLowerCase("pt-BR") ?? "";
    const sm = $("sample-filter")?.value.toLocaleLowerCase("pt-BR") ?? "", ty = $("type-filter")?.value ?? "";
    filteredRows = rows.filter((r) => {
      const ok = (r.dataset.sample || "").includes(s) && (!sm || r.dataset.sample === sm) && (!ty || r.dataset.type === ty);
      return ok;
    });
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / READINGS_PER_PAGE));
    currentReadingsPage = Math.min(currentReadingsPage, totalPages);
    rows.forEach((r) => { r.hidden = true; });
    const start = (currentReadingsPage - 1) * READINGS_PER_PAGE;
    filteredRows.slice(start, start + READINGS_PER_PAGE).forEach((r) => { r.hidden = false; });
    if ($("visible-count")) $("visible-count").textContent = String(filteredRows.length);
    if ($("no-results")) $("no-results").hidden = filteredRows.length !== 0 || rows.length === 0;
    if ($("readings-page")) $("readings-page").textContent = `Página ${currentReadingsPage} de ${totalPages}`;
    if ($("readings-prev")) $("readings-prev").disabled = currentReadingsPage <= 1;
    if ($("readings-next")) $("readings-next").disabled = currentReadingsPage >= totalPages;
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
    renderQualidadeAgora(data);
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
    renderObservacoes(data); renderSpectralTime(data.serie || []);
    ultimosDados = data;
    firstRender = false;
  }
  $("reading-search")?.addEventListener("input", () => filterReadings(true));
  $("sample-filter")?.addEventListener("change", () => filterReadings(true));
  $("type-filter")?.addEventListener("change", () => filterReadings(true));
  $("readings-prev")?.addEventListener("click", () => {
    if (currentReadingsPage > 1) { currentReadingsPage--; filterReadings(); }
  });
  $("readings-next")?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / READINGS_PER_PAGE));
    if (currentReadingsPage < totalPages) { currentReadingsPage++; filterReadings(); }
  });
  $("export-csv")?.addEventListener("click", () => {
    if (!filteredRows.length) return;
    const heads = [...document.querySelectorAll("#readings thead th")].map((c) => c.textContent.trim());
    const esc = (v) => `"${v.replaceAll('"', '""')}"`;
    const csv = [heads, ...filteredRows.map((r) => [...r.cells].map((c) => c.textContent.trim()))].map((l) => l.map(esc).join(",")).join("\r\n");
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
    if (!endpoint || document.hidden || refreshing || !document.querySelector(".kpi-grid")) return; // so na pagina Agora
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
      const box = el.getBoundingClientRect();
      // Inteiro na tela (ou fim da pagina) = nitido: o ultimo painel nunca sobe o bastante.
      const r = reduce || (box.top >= 0 && box.bottom <= vh) || scrollY >= max - 4 ? 1 : clamp((vh * 0.98 - box.top) / (vh * 0.38));
      el.style.setProperty("--r", r.toFixed(3));
      el.classList.toggle("is-in", r > 0.55);
    });
    // seção ativa no menu
    let current = "overview";
    secs.forEach((s) => { if (s.id && s.getBoundingClientRect().top < vh * 0.4) current = s.id; });
    if (current === "validacao" || current === "chart-section") current = "evolucao";
    // Menu com paginas separadas: so os links "#secao" acompanham a rolagem.
    links.forEach((l) => { if (l.getAttribute("href").startsWith("#")) l.classList.toggle("is-active", l.getAttribute("href") === `#${current}`); });
    velocity = scrollY - lastY; lastY = scrollY; ticking = false;
  }
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener("resize", onScroll);
  onScroll();

  /* ---------- bolhas subindo (mais rápidas ao rolar) ---------- */
  const cv = $("bubbles");
  if (cv && !reduce) {
    const ctx = cv.getContext("2d"); let w, h, dpr;
    const bubbles = Array.from({ length: 38 }, () => ({ x: Math.random(), y: Math.random(), r: 2 + Math.random() * 9, s: 0.15 + Math.random() * 0.45, ph: Math.random() * 6.3, opacity: 0.55 + Math.random() * 0.35 }));
    const size = () => { dpr = Math.min(devicePixelRatio || 1, 2); w = cv.width = innerWidth * dpr; h = cv.height = innerHeight * dpr; };
    size(); addEventListener("resize", size);
    (function loop(t) {
      ctx.clearRect(0, 0, w, h);
      const boost = 1 + Math.min(Math.abs(velocity), 80) * 0.12;
      bubbles.forEach((b) => {
        b.y -= (b.s * boost * dpr) / innerHeight * 0.6; if (b.y < -0.05) { b.y = 1.05; b.x = Math.random(); }
        const drift = Math.sin(t / 1100 + b.ph) * 0.018 + Math.sin(t / 2300 + b.ph * 1.7) * 0.006;
        const px = (b.x + drift) * w, py = b.y * h, r = b.r * dpr;
        const fill = ctx.createRadialGradient(px - r * 0.36, py - r * 0.4, r * 0.04, px, py, r * 1.15);
        fill.addColorStop(0, `rgba(255,255,255,${b.opacity})`);
        fill.addColorStop(0.28, `rgba(219,250,255,${b.opacity * 0.48})`);
        fill.addColorStop(0.72, `rgba(57,177,204,${b.opacity * 0.12})`);
        fill.addColorStop(1, `rgba(255,255,255,${b.opacity * 0.42})`);
        ctx.beginPath(); ctx.arc(px, py, r, 0, 6.283);
        ctx.fillStyle = fill; ctx.fill();
        const rim = ctx.createLinearGradient(px - r, py - r, px + r, py + r);
        rim.addColorStop(0, `rgba(255,255,255,${b.opacity * 0.9})`);
        rim.addColorStop(0.55, `rgba(34,150,180,${b.opacity * 0.35})`);
        rim.addColorStop(1, `rgba(255,255,255,${b.opacity * 0.72})`);
        ctx.strokeStyle = rim; ctx.lineWidth = Math.max(0.7 * dpr, r * 0.12); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(px - r * 0.28, py - r * 0.34, r * 0.24, r * 0.13, -0.6, 0, 6.283);
        ctx.fillStyle = `rgba(255,255,255,${b.opacity})`; ctx.fill();
        ctx.beginPath(); ctx.ellipse(px + r * 0.12, py + r * 0.28, r * 0.48, r * 0.18, 0.7, 0.2, 2.1);
        ctx.strokeStyle = `rgba(255,255,255,${b.opacity * 0.38})`; ctx.lineWidth = Math.max(0.5 * dpr, r * 0.07); ctx.stroke();
      });
      velocity *= 0.92; requestAnimationFrame(loop);
    })(0);
  }
})();