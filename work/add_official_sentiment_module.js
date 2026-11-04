const fs = require("fs");
const path = require("path");
const { guideCss, explanationScript } = require("./sentiment_explanations");
const { seriesMarkerCss } = require("./series_marker");
const explanationMethods = require("./sentiment_methodology.json");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "growth_indices_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "official_sentiment_data.json");

function stripExisting(html) {
  return html
    .replace(/\s*<section class="module-shell" id="official-sentiment">[\s\S]*?<\/section>/g, "")
    .replace(/\s*<style id="official-sentiment-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="official-sentiment-script">[\s\S]*?<\/script>/g, "")
    .replace(/\s*<a href="#official-sentiment"[^>]*>情绪-官方<\/a>/g, "");
}

const css = `
  <style id="official-sentiment-style">
    ${guideCss("official-sentiment")}
    #refinanceSourceLink { color: #f6c85f; }
    #officialSeriesControls { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 12px 16px 4px; }
    #officialSeriesControls button { display: inline-flex; align-items: center; gap: 7px; border: 0;
      background: transparent; color: #b8c8db; font-size: 12px; padding: 6px 0; cursor: pointer; }
    #officialSeriesControls button[aria-pressed="false"] { opacity: .4; }
    #officialSeriesControls button[hidden] { display: none; }
    #officialSeriesControls button:disabled { opacity: .35; cursor: not-allowed; }
    #officialSeriesControls button:focus-visible { outline: 2px solid #f6c85f; outline-offset: 3px; }
    ${seriesMarkerCss(".official-series-mark")}
    #officialEmptyState { padding: 16px; color: #c6d3e3; text-align: center; }
    #officialEmptyState[hidden] { display: none; }
    #officialSentimentChart { height: 560px; width: 100%; }
    @media (max-width: 980px) {
      #officialSentimentChart { height: 490px; }
    }
  </style>
`;

const moduleHtml = `
  <section class="module-shell" id="official-sentiment">
    <div class="module-head">
      <div>
        <div class="module-kicker">Module 04 / Official Sentiment</div>
        <h2>情绪-官方</h2>
        <p>观察IPO、再融资与重要股东增减持，了解市场融资供给与股东交易情况。</p>
      </div>
      <div class="module-status" id="officialDataStatus"></div>
    </div>

      <div id="officialSeriesControls" role="group" aria-label="官方模块全局范围筛选，对全部页签生效">
        <button type="button" data-series="market" aria-pressed="true" style="--series-color:#f6c85f"><span class="official-series-mark"></span><span id="officialMarketLabel">全市场</span></button>
        <button type="button" data-series="chinext" aria-pressed="true" style="--series-color:#ff5d73"><span class="official-series-mark"></span>创业板</button>
        <button type="button" data-series="star" aria-pressed="true" style="--series-color:#36c2ff"><span class="official-series-mark"></span>科创板</button>
      </div>

    <article class="valuation-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">融资与股东变动</div>
          <div class="panel-subtitle" id="officialMetricSubtitle">全市场IPO发行金额 · 亿元 / 月</div>
        </div>
        <div class="range-tabs" id="officialRangeTabs">
          <button class="range-tab" data-years="3">3年</button>
          <button class="range-tab" data-years="5">5年</button>
          <button class="range-tab" data-years="10">10年</button>
          <button class="range-tab" data-years="20">20年</button>
          <button class="range-tab" data-years="30">30年</button>
          <button class="range-tab active" data-years="0">全部</button>
        </div>
      </div>
      <div class="metric-tabs" id="officialMetricTabs">
        <button class="metric-tab active" data-metric="ipoFund">IPO融资额</button>
        <button class="metric-tab" data-metric="refinanceFund">再融资额</button>
        <button class="metric-tab" data-metric="holderNetReductionAmount">重要股东净减持额</button>
      </div>
      <div class="metric-note">
        <a id="refinanceSourceLink" href="https://data.eastmoney.com/other/qbzf.html" target="_blank" rel="noopener" hidden>查看再融资数据来源</a>
        <span class="metric-reading" id="officialLatestReading"></span>
      </div>
      <div id="officialEmptyState" role="status" hidden></div>
      <div id="officialSentimentChart"></div>
    </article>

    <div class="valuation-foot">
      <details class="metric-method">
        <summary>指标含义、统计口径与数据来源</summary>
        <div class="metric-guide" id="officialMetricGuide" aria-live="polite"></div>
        <div id="officialMethodology"></div>
      </details>
    </div>
  </section>
`;

const script = `
  <script id="official-sentiment-script">
  (() => {
    const officialData = __OFFICIAL_DATA__;
    const refinancingData = __REFINANCING_DATA__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const metrics = {
      ipoFund: { title: "IPO发行金额", market: "全市场IPO发行金额", unit: "亿元", digits: 2,
        subtitle: "全市场、创业板、科创板 · IPO发行金额月度合计", partial: true },
      refinanceFund: { title: "再融资发行金额", market: "全市场再融资发行金额", unit: "亿元", digits: 2,
        subtitle: "已实施增发、配股发行金额 · 含非现金认购 · 不含可转债" },
      holderNetReductionAmount: { title: "重要股东净减持额", market: "全市场重要股东净减持额", unit: "亿元", digits: 2,
        subtitle: "减持金额 − 增持金额 · 月度公告合计 · 仅含可按披露均价计算的记录", partial: true },

    };
    ${explanationScript(["ipoFund", "refinanceFund", "holderNetReductionAmount"], "official", explanationMethods)}
    const scopes = [
      { key: "market", color: "#f6c85f" },
      { key: "chinext", name: "创业板", color: "#ff5d73" },
      { key: "star", name: "科创板", color: "#36c2ff" }
    ];
    // One global board selection applies to every official metric.
    const selected = new Set(scopes.map(scope => scope.key));
    let activeMetric = "ipoFund";
    let activeYears = 0;
    const chart = echarts.init(document.getElementById("officialSentimentChart"), null, { renderer: "canvas" });
    document.getElementById("officialDataStatus").textContent = "数据核对至 " + officialData.meta.updated;

    function renderChart(preserveZoom = false) {
      const cfg = metrics[activeMetric];
      document.getElementById("officialDataStatus").textContent = "数据核对至 " +
        (activeMetric === "refinanceFund" ? refinancingData.meta.updated.slice(0, 10) : officialData.meta.updated);
      const holderMetric = activeMetric === "holderNetReductionAmount";
      const ipoMetric = activeMetric === "ipoFund";
      const breakdownField = ipoMetric ? "ipoBoards" : holderMetric ? "holderBoards" : "refinanceBoards";
      const canSelect = key => scopes.some(scope => scope.key === key);
      const lineName = scope => scope.key === "market" ? cfg.market : scope.name + " · " + cfg.title;
      const oldZoom = preserveZoom ? chart.getOption().dataZoom?.[0] : null;
      const zoom = oldZoom ? Object.fromEntries(["start", "end", "startValue", "endValue"]
        .filter(key => oldZoom[key] != null).map(key => [key, oldZoom[key]])) : { start: 0, end: 100 };
      document.getElementById("refinanceSourceLink").hidden = activeMetric !== "refinanceFund";
      const rows = activeMetric === "refinanceFund" ? refinancingData.series : officialData.series;
      const availableRows = rows.filter(row => Number.isFinite(row[activeMetric]));
      const last = availableRows[availableRows.length - 1];
      const first = availableRows[0];
      const cutoff = new Date((last?.date || officialData.meta.end) + "T00:00:00Z");
      if (activeYears) cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      const minDate = activeYears ? cutoff.toISOString().slice(0, 10) : "";
      // Keep missing months as nulls so a line cannot bridge unpublished observations.
      const visibleRows = rows.filter(row => row.date >= minDate && (!first || row.date >= first.date));
      const byDate = new Map(rows.map(row => [row.date, row]));
      document.getElementById("officialMarketLabel").textContent = "全市场";
      document.getElementById("officialMetricSubtitle").textContent = cfg.subtitle;
      const reason = officialData.meta.constituentAvailability[activeMetric];
      document.querySelectorAll("#officialSeriesControls [data-series]").forEach(button => {
        const key = button.dataset.series;
        button.hidden = false;
        const enabled = canSelect(key);
        button.disabled = !enabled;
        button.setAttribute("aria-pressed", String(selected.has(button.dataset.series)));
        button.title = enabled ? "切换显示；对官方模块全部页签生效" : reason;
      });
      renderExplanation("official", activeMetric);
      const latestRows = visibleRows.filter(row => Number.isFinite(row[activeMetric]));
      const latest = latestRows[latestRows.length - 1];
      let reading = latest ? cfg.market + " · " + latest.date + " · " + fmt(latest[activeMetric], cfg.digits) + cfg.unit
        : cfg.market + " · 当前范围暂无数据";
      if (latest && cfg.partial && latest.partialMonth) reading += "（本月截至当日累计，非完整月）";
      if (latest && holderMetric) {
        const coverage = latest.holderCoverage?.market;
        if (coverage) reading += " · 可计价 " + coverage.pricedRecords + "/" + coverage.records + " 条公告记录";
      }
      document.getElementById("officialLatestReading").textContent = reading;
      const series = scopes.filter(scope => selected.has(scope.key) && canSelect(scope.key)).map(scope => ({
        id: scope.key, name: lineName(scope),
        type: "line", step: cfg.step || false, connectNulls: false,
        data: visibleRows.map(row => [row.date, (scope.key === "market" ? row[activeMetric] : row[breakdownField]?.[scope.key]?.[activeMetric]) ?? null]),
        showSymbol: false,
        lineStyle: { width: 2, color: scope.color }, itemStyle: { color: scope.color }
      }));
      const hasData = series.some(line => line.data.some(point => Number.isFinite(point[1])));
      const empty = document.getElementById("officialEmptyState");
      empty.hidden = hasData;
      empty.textContent = series.length ? "当前范围暂无所选曲线的可核实数据" : "曲线已关闭，点击上方开关显示";
      chart.setOption({
        animation: false, backgroundColor: "transparent",
        grid: { left: 92, right: 30, top: 28, bottom: 66 },
        legend: { show: false },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f", textStyle: { color: "#edf4ff" },
          formatter(params) {
            const date = params[0]?.value?.[0];
            const row = byDate.get(date);
            const lines = params.map(item => {
              let text = item.marker + item.seriesName + "：<b>" + fmt(item.value[1], cfg.digits) + cfg.unit + "</b>";
              const scope = scopes.find(s => s.key === item.seriesId || lineName(s) === item.seriesName);
              if (holderMetric) {
                const count = row?.holderCoverage?.[scope?.key];
                if (count && count.records != null) text += "（可计价 " + count.pricedRecords + "/" + count.records + " 条）";
              }
              return text;
            });
            const partial = cfg.partial && row?.partialMonth ? " · 截至当日累计，非完整月" : "";
            return "<b>" + (date || "") + partial + "</b><br>" + lines.join("<br>");
          }
        },
        xAxis: { type: "time", axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false } },
        yAxis: { type: "value", scale: true, name: cfg.unit, nameTextStyle: { color: "#8fa5bf" },
          axisLabel: { color: "#8fa5bf", formatter(value) {
            return cfg.unit === "亿元" && Math.abs(value) >= 10000
              ? fmt(value / 10000, 1) + "万亿元" : fmt(value, cfg.unit === "%" ? cfg.digits : 0) + cfg.unit;
          } }, splitLine: { lineStyle: { color: "#17283d" } } },
        dataZoom: [
          { type: "inside", filterMode: "none", ...zoom },
          { type: "slider", bottom: 12, height: 22, ...zoom,
            borderColor: "#263b58", backgroundColor: "#0d1929", fillerColor: "rgba(255,93,115,.15)",
            handleStyle: { color: "#ff5d73" }, textStyle: { color: "#8fa5bf" } }
        ],
        series
      }, true);
    }

    document.querySelectorAll("#officialSeriesControls [data-series]").forEach(button => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        const key = button.dataset.series;
        if (selected.has(key)) selected.delete(key); else selected.add(key);
        renderChart(true);
      });
    });

    document.querySelectorAll("#officialMetricTabs [data-metric]").forEach(button => {
      button.addEventListener("click", () => {
        activeMetric = button.dataset.metric;
        document.querySelectorAll("#officialMetricTabs [data-metric]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });
    document.querySelectorAll("#officialRangeTabs [data-years]").forEach(button => {
      button.addEventListener("click", () => {
        activeYears = Number(button.dataset.years);
        document.querySelectorAll("#officialRangeTabs [data-years]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });

    window.addEventListener("resize", () => chart.resize());
    renderChart();
  })();
  </script>
`;

if (!fs.existsSync(DATA_FILE)) throw new Error("Missing official_sentiment_data.json.");
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
let html = stripExisting(fs.readFileSync(OUTPUT, "utf8"));
html = html.replace(
  '<a href="#large-money-sentiment">情绪-大资金</a>',
  '<a href="#large-money-sentiment">情绪-大资金</a><a href="#official-sentiment">情绪-官方</a>'
);
function insertBeforeLast(source, marker, content) {
  const index = source.lastIndexOf(marker);
  if (index === -1) throw new Error(`Marker not found: ${marker}`);
  return source.slice(0, index) + content + source.slice(index);
}
const refinancing = JSON.parse(fs.readFileSync(path.join(ROOT, "work", "refinancing_data.json"), "utf8"));
const officialScript = script.replace("__OFFICIAL_DATA__", JSON.stringify(data))
  .replace("__REFINANCING_DATA__", JSON.stringify(refinancing));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", officialScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
