(() => {
  "use strict";

  const rows = [...document.querySelectorAll("#readings-body tr")];
  const searchInput = document.getElementById("reading-search");
  const sampleFilter = document.getElementById("sample-filter");
  const typeFilter = document.getElementById("type-filter");
  const visibleCount = document.getElementById("visible-count");
  const noResults = document.getElementById("no-results");
  const exportButton = document.getElementById("export-csv");
  const applicationShell = document.querySelector(".app-shell");
  const healthIndicator = document.getElementById("health-indicator");
  const healthLabel = document.getElementById("health-label");
  const liveClock = document.getElementById("live-clock");

  function filterReadings() {
    const search = searchInput?.value.trim().toLocaleLowerCase("pt-BR") ?? "";
    const sample = sampleFilter?.value.toLocaleLowerCase("pt-BR") ?? "";
    const type = typeFilter?.value ?? "";
    let visible = 0;

    for (const row of rows) {
      const matches =
        row.dataset.sample.includes(search) &&
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
    const date = applicationShell?.dataset.selectedDate ?? "leituras";

    link.href = downloadUrl;
    link.download = `aquamonitor-${date}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  exportButton?.addEventListener("click", exportVisibleReadings);

  function updateClock() {
    if (!liveClock) return;
    liveClock.textContent = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date());
  }

  async function checkApplicationHealth() {
    const healthUrl = applicationShell?.dataset.healthUrl;
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

  function renderChart() {
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
      (point) => Number.isFinite(point.turbidez) && typeof point.hora === "string",
    );
    if (!points.length) return;

    const namespace = "http://www.w3.org/2000/svg";
    const width = 900;
    const height = 215;
    const margin = { top: 15, right: 17, bottom: 32, left: 48 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const values = points.map((point) => point.turbidez);
    let minimum = Math.min(...values);
    let maximum = Math.max(...values);
    if (minimum === maximum) {
      minimum -= 0.1;
      maximum += 0.1;
    }
    const padding = (maximum - minimum) * 0.15;
    minimum -= padding;
    maximum += padding;

    const x = (index) =>
      margin.left +
      (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
    const y = (value) =>
      margin.top + ((maximum - value) / (maximum - minimum)) * plotHeight;
    const add = (tag, attributes, parent = chart) => {
      const element = document.createElementNS(namespace, tag);
      for (const [key, value] of Object.entries(attributes)) {
        element.setAttribute(key, String(value));
      }
      parent.append(element);
      return element;
    };

    chart.replaceChildren();
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    chart.setAttribute("preserveAspectRatio", "none");

    for (let index = 0; index <= 4; index += 1) {
      const value = maximum - ((maximum - minimum) * index) / 4;
      const lineY = y(value);
      add("line", {
        x1: margin.left,
        y1: lineY,
        x2: width - margin.right,
        y2: lineY,
        stroke: "#edf2f3",
        "stroke-width": 1,
      });
      const label = add("text", {
        x: margin.left - 9,
        y: lineY + 3,
        fill: "#94a2a8",
        "font-size": 9,
        "text-anchor": "end",
      });
      label.textContent = value.toFixed(2);
    }

    const line = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.turbidez)}`)
      .join(" ");
    const area = `${line} L ${x(points.length - 1)} ${height - margin.bottom} L ${x(0)} ${height - margin.bottom} Z`;
    add("path", { d: area, fill: "#12a4a0", opacity: ".09" });
    add("path", {
      d: line,
      fill: "none",
      stroke: "#12a4a0",
      "stroke-width": 2.5,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });

    points.forEach((point, index) => {
      const circle = add("circle", {
        cx: x(index),
        cy: y(point.turbidez),
        r: points.length > 24 ? 3 : 4,
        fill: "#fff",
        stroke: "#12a4a0",
        "stroke-width": 2,
      });
      const title = add("title", {}, circle);
      title.textContent = `${point.hora} · ${point.amostra}: ${point.turbidez.toFixed(3)}`;
    });

    const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    for (const index of labelIndexes) {
      const label = add("text", {
        x: x(index),
        y: height - 8,
        fill: "#94a2a8",
        "font-size": 9,
        "text-anchor": index === 0 ? "start" : index === points.length - 1 ? "end" : "middle",
      });
      label.textContent = points[index].hora;
    }
  }

  filterReadings();
  updateClock();
  window.setInterval(updateClock, 1000);
  checkApplicationHealth();
  window.setInterval(checkApplicationHealth, 30000);
  renderChart();
})();
