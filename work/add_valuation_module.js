const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "growth_indices_dashboard.html");
const VALUATION_DATA_FILE = path.join(ROOT, "work", "valuation_data.json");
const START_MARKER = "<!-- VALUATION_MODULE_START -->";
const END_MARKER = "<!-- VALUATION_MODULE_END -->";

function stripExistingModule(html) {
  return html
    .replace(/\s*<!-- VALUATION_MODULE_(?:START|END) -->/g, "")
    .replace(/\s*<nav class="page-nav"[\s\S]*?<\/nav>/g, "")
    .replace(/\s*<section class="module-shell" id="valuation">[\s\S]*?<\/section>/g, "")
    .replace(/\s*<style id="valuation-module-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="valuation-module-script">[\s\S]*?<\/script>/g, "")
    .replace('<main class="wrap" id="overview">', '<main class="wrap">');
}

const css = `
  <style id="valuation-module-style">
    .page-nav {
      position: sticky; top: 0; z-index: 20; display: flex; gap: 8px;
      width: fit-content; margin: 0 0 20px; padding: 6px;
      border: 1px solid var(--line); border-radius: 12px;
      background: rgba(7,17,31,.92); backdrop-filter: blur(12px);
    }
    .page-nav a {
      color: var(--muted); padding: 8px 14px; border-radius: 8px;
      text-decoration: none; font-size: 13px; font-weight: 700;
    }
    .page-nav a:hover, .page-nav a.active { color: #07111f; background: var(--accent); }
    .module-shell { margin-top: 54px; scroll-margin-top: 72px; }
    .module-head {
      display: flex; justify-content: space-between; align-items: flex-end;
      gap: 18px; margin-bottom: 16px;
    }
    .module-kicker {
      color: var(--accent); font-size: 12px; font-weight: 800;
      letter-spacing: .16em; text-transform: uppercase;
    }
    .module-head h2 { margin: 7px 0 5px; font-size: 30px; }
    .module-head p { margin: 0; color: var(--muted); font-size: 13px; }
    .module-status {
      color: var(--muted); border: 1px solid var(--line); border-radius: 999px;
      padding: 7px 11px; font-size: 11px; white-space: nowrap;
    }
    .valuation-panel {
      min-width: 0; overflow: hidden; border: 1px solid var(--line);
      border-radius: 15px; background: rgba(9,20,34,.94);
    }
    .panel-head {
      min-height: 70px; display: flex; justify-content: space-between;
      align-items: center; gap: 14px; padding: 14px 16px;
      border-bottom: 1px solid var(--line); background: rgba(13,25,41,.9);
    }
    .panel-title { font-size: 15px; font-weight: 800; }
    .panel-subtitle { color: var(--muted); font-size: 11px; margin-top: 4px; }
    .metric-tabs, .range-tabs { display: flex; gap: 7px; flex-wrap: wrap; }
    .metric-tabs { padding: 13px 15px 0; }
    .metric-tab, .range-tab { padding: 7px 10px; font-size: 12px; }
    .range-tab { padding: 5px 8px; }
    .metric-tab[disabled] {
      cursor: not-allowed; opacity: .42; color: var(--muted);
      background: #101c2d; border-color: #203149;
    }
    .metric-note {
      display: flex; justify-content: space-between; gap: 12px; align-items: center;
      color: var(--muted); font-size: 11px; padding: 9px 16px 0;
    }
    .board-chart-block { border-top: 1px solid var(--line); margin-top: 12px; }
    .board-chart-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; padding: 14px 16px 0; }
    .board-chart-head strong { font-size: 14px; }
    .board-chart-head span { color: var(--muted); font-size: 11px; text-align: right; }
    #valuationChartChinext, #valuationChartStar { height: 310px; width: 100%; }
    .board-empty { display: none; color: var(--muted); padding: 28px 16px 40px; font-size: 12px; }
    .valuation-foot { margin-top: 15px; }
    @media (max-width: 620px) {
      .page-nav { position: static; width: 100%; justify-content: space-between; gap: 0; }
      .page-nav a { padding: 7px 8px; font-size: 11px; text-align: center; }
      .module-head, .panel-head, .metric-note { align-items: flex-start; flex-direction: column; }
      .board-chart-head { align-items: flex-start; flex-direction: column; gap: 5px; }
      #valuationChartChinext, #valuationChartStar { height: 280px; }
    }
  </style>
`;

const nav = `
${START_MARKER}
  <nav class="page-nav" aria-label="研究模块导航">
    <a href="#overview" class="active">总览</a>
    <a href="#valuation">估值</a>
  </nav>
`;

const moduleHtml = `
  <section class="module-shell" id="valuation">
    <div class="module-head">
      <div>
        <div class="module-kicker">Module 01 / Valuation</div>
        <h2>估值</h2>
        <p>连续数据观察创业板与科创板的估值位置。</p>
      </div>
      <div class="module-status">PE 20年 / PB与股债收益差 10年</div>
    </div>

    <article class="valuation-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">创业板与科创板估值</div>
            <div class="panel-subtitle" id="valuationMetricSubtitle">PE(TTM)</div>
          </div>
          <div class="range-tabs" id="valuationRangeTabs">
            <button class="range-tab" data-years="3">3年</button>
            <button class="range-tab" data-years="5">5年</button>
            <button class="range-tab" data-years="10">10年</button>
            <button class="range-tab active" data-years="0">全部</button>
          </div>
        </div>
        <div class="metric-tabs" id="valuationMetricTabs">
          <button class="metric-tab active" data-metric="pe">PE(TTM)</button>
          <button class="metric-tab" data-metric="pePercentile">PE历史分位</button>
          <button class="metric-tab" data-metric="pbPercentile">PB历史分位</button>
          <button class="metric-tab" data-metric="equityBondSpread">股债收益差</button>
          <button class="metric-tab" disabled title="需要全市场个股与行业截面数据">行业分位 / 高估值占比</button>
        </div>
        <div class="metric-note">
          <span id="valuationMetricNote">PE越高，市场对未来盈利增长的要求越高。</span>
        </div>
        <div class="board-chart-block">
          <div class="board-chart-head"><strong class="sh">创业板指</strong><span id="valuationLatestChinext"></span></div>
          <div id="valuationChartChinext"></div>
        </div>
        <div class="board-chart-block">
          <div class="board-chart-head"><strong class="sz">科创板</strong><span id="valuationLatestStar"></span></div>
          <div id="valuationChartStar"></div>
          <div class="board-empty" id="valuationStarEmpty">暂无同口径连续数据</div>
        </div>
    </article>

    <div class="valuation-foot">
      <div class="note"><strong>连续数据口径：</strong>PE(TTM)为指数动态市盈率；PE与PB分位均按当前选择的3年、5年、10年或全部可用样本动态重算。PB来自指数每日指标，股债收益差为100/PE减10年期国债收益率，两者共同可得区间为2016年6月以来。</div>
    </div>
  </section>
${END_MARKER}
`;

const js = `
  <script id="valuation-module-script">
  (() => {
    const valuationExtra = __VALUATION_EXTRA__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";

    const valuationData = { sh: DATA.sh, sz: DATA.officialHistory.rows, k50: DATA.k50 };
    valuationExtra.k50 = DATA.k50;
    valuationExtra.sz = DATA.official.snapshots;

    const metricConfig = {
      pe: {
        title: "PE(TTM)", unit: "倍", subtitle: "创业板、科创50：Tushare周频；科创综指：中证指数日频",
        note: "科创综指官方PE从2024-10-23开始；与Tushare估值口径不同，不直接比较绝对倍数。"
      },
      pePercentile: {
        title: "PE历史分位", unit: "%", subtitle: "各时点相对当前所选时间跨度的位置",
        note: "80%以上通常属于样本高位，20%以下通常属于样本低位。", fixedRange: true
      },
      pbPercentile: {
        title: "PB历史分位", unit: "%", subtitle: "指数市净率相对当前所选时间跨度的位置",
        note: "PB更适合观察金融、周期及资产密集型指数的估值位置。", fixedRange: true, extra: true
      },
      equityBondSpread: {
        title: "股债收益差", unit: "%", subtitle: "盈利收益率减10年期国债收益率",
        note: "数值越低，股票相对债券的估值补偿越薄。", extra: true, inverseRisk: true
      }
    };

    function metricRows(market, field) {
      return metricConfig[field].extra ? valuationExtra[market] : valuationData[market];
    }

    const chinextChart = echarts.init(document.getElementById("valuationChartChinext"), null, { renderer: "canvas" });
    const starChart = echarts.init(document.getElementById("valuationChartStar"), null, { renderer: "canvas" });
    let activeMetric = "pe";
    let activeYears = 0;

    function rowsForActiveRange(market, field) {
      const sourceField = field === "pePercentile" ? "pe"
        : field === "pbPercentile" ? "pb" : field;
      const rows = metricRows(market, field).filter(row => Number.isFinite(row[sourceField]));
      if (!activeYears || !rows.length) return rows;
      const end = new Date(rows[rows.length - 1].date + "T00:00:00Z");
      const cutoff = new Date(end);
      cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      return rows.filter(row => new Date(row.date + "T00:00:00Z") >= cutoff);
    }

    function percentileRank(sorted, value) {
      let low = 0, high = sorted.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (sorted[mid] <= value) low = mid + 1; else high = mid;
      }
      return sorted.length ? low / sorted.length * 100 : NaN;
    }

    function valuationPoints(market, field) {
      if (market === "sz" && field !== "pe") return [];
      const rows = rowsForActiveRange(market, field);
      if (field === "pePercentile" || field === "pbPercentile") {
        const sourceField = field === "pePercentile" ? "pe" : "pb";
        const sorted = rows.map(row => row[sourceField]).sort((a, b) => a - b);
        return rows.map(row => [row.date, percentileRank(sorted, row[sourceField])]);
      }
      return rows.map(row => [row.date, row[field]]);
    }

    function renderValuationChart() {
      const cfg = metricConfig[activeMetric];
      const shPoints = valuationPoints("sh", activeMetric);
      const szPoints = valuationPoints("sz", activeMetric);
      const k50Points = valuationPoints("k50", activeMetric);
      const shLatest = shPoints[shPoints.length - 1]?.[1];
      const szLatest = szPoints[szPoints.length - 1]?.[1];
      const k50Latest = k50Points[k50Points.length - 1]?.[1];
      const rangeLabel = activeYears ? activeYears + "年" : "全部可用";
      document.getElementById("valuationMetricSubtitle").textContent =
        cfg.fixedRange ? cfg.subtitle + "（" + rangeLabel + "样本动态计算）" : cfg.subtitle;
      document.getElementById("valuationMetricNote").textContent = cfg.note;
      document.getElementById("valuationLatestChinext").textContent =
        "最新 " + fmt(shLatest, 2) + cfg.unit;
      document.getElementById("valuationLatestStar").textContent =
        "科创50 " + (Number.isFinite(k50Latest) ? fmt(k50Latest, 2) + cfg.unit : "暂无数据") +
        " · 科创综指 " + (Number.isFinite(szLatest) ? fmt(szLatest, 2) + cfg.unit : "暂无数据");

      const riskArea = cfg.fixedRange ? {
        silent: true,
        data: [
          [{ yAxis: 80, itemStyle: { color: "rgba(255,93,115,.07)" } }, { yAxis: 100 }],
          [{ yAxis: 0, itemStyle: { color: "rgba(54,194,255,.05)" } }, { yAxis: 20 }]
        ]
      } : undefined;

      const chartOption = {
        animation: false,
        backgroundColor: "transparent",
        grid: { left: 66, right: 28, top: 42, bottom: 64 },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter(params) {
            const lines = params.map(item => item.marker + item.seriesName + "：<b>" +
              fmt(Number(item.value[1]), 2) + cfg.unit + "</b>");
            return "<b>" + (params[0]?.axisValueLabel || "") + "</b><br>" + lines.join("<br>");
          }
        },
        legend: { show: false },
        xAxis: {
          type: "time", axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false }
        },
        yAxis: {
          type: "value", scale: !cfg.fixedRange,
          min: cfg.fixedRange ? 0 : undefined,
          max: cfg.fixedRange ? 100 : undefined,
          axisLabel: { color: "#7890aa", formatter: "{value}" + cfg.unit },
          splitLine: { lineStyle: { color: "#17283d" } }
        },
        dataZoom: [
          { type: "inside", filterMode: "none", start: 0, end: 100 },
          { type: "slider", bottom: 12, height: 22, start: 0, end: 100, borderColor: "#263b58",
            backgroundColor: "#0d1929", fillerColor: "rgba(246,200,95,.18)",
            handleStyle: { color: "#f6c85f" }, textStyle: { color: "#8fa5bf" } }
        ],
      };
      const line = (name, data, color) => ({
        name, type: "line", data, showSymbol: false, sampling: "lttb",
        lineStyle: { width: 2, color }, itemStyle: { color }, emphasis: { focus: "series" }
      });
      chinextChart.setOption({ ...chartOption, series: [
        { ...line("创业板指" + cfg.title, shPoints, COLORS.sh), markArea: riskArea }
      ] }, true);
      const starSeries = [
        line("科创50" + cfg.title, k50Points, COLORS.k50),
        line("科创综指官方" + cfg.title, szPoints, COLORS.sz)
      ].filter(item => item.data.length);
      const starVisible = starSeries.length > 0;
      document.getElementById("valuationChartStar").style.display = starVisible ? "block" : "none";
      document.getElementById("valuationStarEmpty").style.display = starVisible ? "none" : "block";
      if (starVisible) {
        starChart.resize();
        starChart.setOption({ ...chartOption, legend: { show: starSeries.length > 1, top: 7,
          textStyle: { color: "#8fa5bf", fontSize: 11 } }, series: starSeries }, true);
      }
    }

    document.querySelectorAll("#valuationMetricTabs [data-metric]").forEach(button => {
      button.addEventListener("click", () => {
        activeMetric = button.dataset.metric;
        document.querySelectorAll("#valuationMetricTabs [data-metric]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderValuationChart();
      });
    });
    document.querySelectorAll("#valuationRangeTabs [data-years]").forEach(button => {
      button.addEventListener("click", () => {
        activeYears = Number(button.dataset.years);
        document.querySelectorAll("#valuationRangeTabs [data-years]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderValuationChart();
      });
    });

    const navLinks = document.querySelectorAll(".page-nav a");
    navLinks.forEach(link => link.addEventListener("click", () => {
      navLinks.forEach(item => item.classList.remove("active"));
      link.classList.add("active");
    }));
    window.addEventListener("resize", () => { chinextChart.resize(); starChart.resize(); });
    renderValuationChart();
  })();
  </script>
`;

if (!fs.existsSync(VALUATION_DATA_FILE)) {
  throw new Error("Missing valuation_data.json. Run fetch_valuation_data.py first.");
}
const valuationExtra = JSON.parse(fs.readFileSync(VALUATION_DATA_FILE, "utf8"));
const valuationJs = js.replace("__VALUATION_EXTRA__", JSON.stringify(valuationExtra));
let html = stripExistingModule(fs.readFileSync(OUTPUT, "utf8"));

function insertBeforeLast(source, marker, content) {
  const index = source.lastIndexOf(marker);
  if (index === -1) throw new Error(`Marker not found: ${marker}`);
  return source.slice(0, index) + content + source.slice(index);
}

html = insertBeforeLast(html, "</head>", css + "\n");
html = html.replace('<main class="wrap">', '<main class="wrap" id="overview">' + nav);
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", valuationJs + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");

console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
