const fs = require("fs");
const path = require("path");
const { guideCss, explanationScript } = require("./sentiment_explanations");
const { seriesMarkerCss } = require("./series_marker");
const { movingAverageScript, movingAverageControls, movingAverageCss } = require("./point_moving_average");
const explanationMethods = require("./sentiment_methodology.json");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "growth_indices_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "large_money_sentiment_data.json");
const INDEX_DATA_FILE = path.join(ROOT, "work", "large_money_index_data.json");
const FUND_REPORTS_FILE = path.join(ROOT, "work", "large_money_fund_reports.json");
const ETF_SHARES_FILE = path.join(ROOT, "work", "large_money_etf_shares.json");
const NORTH_HOLDINGS_FILE = path.join(ROOT, "work", "northbound_index_holdings.json");

function stripExisting(html) {
  return html
    .replace(/\s*<section class="module-shell" id="large-money-sentiment">[\s\S]*?<\/section>/g, "")
    .replace(/\s*<style id="large-money-sentiment-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="large-money-sentiment-script">[\s\S]*?<\/script>/g, "")
    .replace(/\s*<a href="#large-money-sentiment"[^>]*>情绪-大资金<\/a>/g, "");
}

const css = `
  <style id="large-money-sentiment-style">
    ${guideCss("large-money-sentiment")}
    ${movingAverageCss("large-money-sentiment")}
    #largeMoneyChart { height: 560px; width: 100%; }
    #largeMoneySeriesControls { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 10px 16px 0; }
    #largeMoneySeriesControls button { display: inline-flex; align-items: center; gap: 6px; padding: 4px 0;
      border: 0; background: transparent; color: #8fa5bf; font-size: 12px; cursor: pointer; }
    #largeMoneySeriesControls button:hover { color: #eaf4f2; background: transparent; }
    #largeMoneySeriesControls button[aria-pressed="false"] { opacity: .4; }
    #largeMoneyHoldingModes { display: none; padding: 8px 16px 0; gap: 6px; }
    #largeMoneyHoldingModes.is-visible { display: flex; }
    ${seriesMarkerCss(".large-money-series-mark")}
    @media (max-width: 980px) {
      #largeMoneyChart { height: 490px; }
    }
  </style>
`;

const moduleHtml = `
  <section class="module-shell" id="large-money-sentiment">
    <div class="module-head">
      <div>
        <div class="module-kicker">Module 03 / Institutional Sentiment</div>
        <h2>情绪-大资金</h2>
        <p>观察机构交易、北向资金和产业资本行为，识别资金集中进入与撤退的阶段。</p>
      </div>
      <div class="module-status" id="largeMoneyDataStatus"></div>
    </div>

    <article class="valuation-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">大资金与三个指数</div>
          <div class="panel-subtitle" id="largeMoneyMetricSubtitle">全市场与三个指数成分股大宗交易额</div>
        </div>
        <div class="range-tabs" id="largeMoneyRangeTabs">
          <button class="range-tab" data-years="3">3年</button>
          <button class="range-tab" data-years="5">5年</button>
          <button class="range-tab" data-years="10">10年</button>
          <button class="range-tab" data-years="20">20年</button>
          <button class="range-tab active" data-years="0">全部</button>
        </div>
      </div>
      <div id="largeMoneySeriesControls" role="group" aria-label="选择对照曲线">
        <button type="button" data-series="全市场资金" aria-pressed="true" style="--series-color:#f5c96a"><span class="large-money-series-mark"></span>全市场资金</button>
        <button type="button" data-series="创业板指" aria-pressed="true" style="--series-color:#ef7180"><span class="large-money-series-mark"></span>创业板指</button>
        <button type="button" data-series="科创50" aria-pressed="true" style="--series-color:#8bd6a3"><span class="large-money-series-mark"></span>科创50</button>
        <button type="button" data-series="科创综指" aria-pressed="true" style="--series-color:#43d6cf"><span class="large-money-series-mark"></span>科创综指</button>
      </div>
      <div class="metric-tabs" id="largeMoneyMetricTabs">
        <button class="metric-tab active" data-metric="blockAmount">大宗交易额</button>
        <button class="metric-tab" data-metric="institutionBlockNet">机构大宗净买入</button>
        <button class="metric-tab" data-metric="holderNetShares">产业资本净增减持</button>
        <button class="metric-tab" data-metric="northHoldings">北向持仓分布</button>
        <button class="metric-tab" data-metric="fundPosition">主动权益基金仓位</button>
        <button class="metric-tab" data-metric="institutionConcentration">机构持仓集中度</button>
        <button class="metric-tab" data-metric="etfShares">ETF份额</button>
      </div>
      ${movingAverageControls("largeMoney")}
      <div class="metric-tabs" id="largeMoneyHoldingModes" role="group" aria-label="北向持仓统计口径">
        <button class="metric-tab active" type="button" data-holding-mode="value">持仓市值</button>
        <button class="metric-tab" type="button" data-holding-mode="ratio">占指数总市值</button>
      </div>
      <div class="metric-note">
        <span class="metric-reading" id="largeMoneyLatestReading"></span>
      </div>
      <div id="largeMoneyChart"></div>
    </article>

    <div class="valuation-foot">
      <details class="metric-method">
        <summary>指标含义、统计口径与数据来源</summary>
        <div class="metric-guide" id="largeMoneyMetricGuide" aria-live="polite"></div>
        <div id="largeMoneyMethodology"></div>
      </details>
    </div>
  </section>
`;

const script = `
  <script id="large-money-sentiment-script">
  (() => {
    const largeMoneyData = __LARGE_MONEY_DATA__;
    const indexMoneyData = __INDEX_MONEY_DATA__;
    const fundReports = __FUND_REPORTS__;
    const etfShares = __ETF_SHARES__;
    const northHoldings = __NORTH_HOLDINGS__;
    ${movingAverageScript()}
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const metrics = {
      blockAmount: {
        title: "大宗交易额", field: "blockAmount", unit: "亿元", digits: 1,
        subtitle: "全市场与三个指数成分股的周大宗交易额",
      },
      institutionBlockNet: {
        title: "机构大宗净买入", field: "institutionBlockNet", unit: "亿元", digits: 1,
        subtitle: "全市场与三个指数成分股的机构席位周净买入额",
      },
      holderNetShares: {
        title: "产业资本净增减持", field: "holderNetAmount", unit: "亿元", digits: 2,
        subtitle: "全市场与三个指数成分股的周净增减持金额",
      },
      northMoney: {
        title: "北向资金净流入", field: "northMoney", unit: "亿元", digits: 1, totalLabel: "北向周净流入",
        subtitle: "全市场北向每周净流入合计（亿元）· 历史截至2024-08-16",
      },
      northHoldings: {
        title: "北向持仓分布", field: "value", unit: "亿元", digits: 1,
        subtitle: "北向资金持有三个指数成分股的季度末市值",
      },
      fundPosition: {
        title: "主动权益基金仓位", field: "position", unit: "%", digits: 2,
        subtitle: "主动股票/混合基金半年报样本股票仓位与指数成分配置",
        totalLabel: "主动基金样本"
      },
      institutionConcentration: {
        title: "机构持仓集中度", field: "concentration", unit: "%", digits: 2,
        subtitle: "主动基金样本在各股票范围内的前10名持仓集中度",
        totalLabel: "主动基金样本"
      },
      etfShares: {
        title: "ETF份额", field: "total", unit: "亿份", digits: 2,
        subtitle: "跟踪三个指数的ETF期末存量份额",
        totalLabel: "三指数ETF合计"
      }
    };
    ${explanationScript(["blockAmount", "institutionBlockNet", "holderNetShares", "northHoldings_value", "northHoldings_ratio", "fundPosition", "institutionConcentration", "etfShares"], "largeMoney", explanationMethods)}
    const indices = [
      { key: "sh", name: "创业板指", rows: DATA.sh, color: COLORS.sh },
      { key: "k50", name: "科创50", rows: DATA.k50, color: COLORS.k50 },
      { key: "sz", name: "科创综指", rows: DATA.sz, color: COLORS.sz }
    ];
    function weekEnd(date) {
      const day = new Date(date + "T00:00:00Z");
      day.setUTCDate(day.getUTCDate() + (6 - day.getUTCDay()));
      return day.toISOString().slice(0, 10);
    }
    let activeMetric = "blockAmount";
    let averageWindow = 1;
    let holdingMode = "value";
    let activeYears = 0;
    const selectedSeries = new Set(["全市场资金", "创业板指", "科创50", "科创综指"]);
    const chart = echarts.init(document.getElementById("largeMoneyChart"), null, { renderer: "canvas" });
    document.getElementById("largeMoneyDataStatus").textContent =
      "大宗与增减持 " + largeMoneyData.series[0].date + " 起 / 北向持仓至 " +
      northHoldings.series[northHoldings.series.length - 1].date;

    function renderChart({ resetZoom = false } = {}) {
      const cfg = metrics[activeMetric];
      const previousZoom = resetZoom ? null : chart.getOption()?.dataZoom?.[0];
      const zoomStart = previousZoom?.start ?? 0;
      const zoomEnd = previousZoom?.end ?? 100;
      const supportsAverage = ["blockAmount", "institutionBlockNet", "holderNetShares"].includes(activeMetric);
      const effectiveAverageWindow = supportsAverage ? averageWindow : 1;
      const averageLabel = effectiveAverageWindow === 1 ? "原数据" : effectiveAverageWindow + "点均线";
      const northFlowMode = activeMetric === "northMoney";
      const maxDate = northFlowMode ? weekEnd(largeMoneyData.meta.northEnd) : largeMoneyData.series[largeMoneyData.series.length - 1].date;
      const end = new Date(maxDate + "T00:00:00Z");
      const cutoff = new Date(end);
      if (activeYears) cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      let minDate = activeYears ? cutoff.toISOString().slice(0, 10) : "";
      if (northFlowMode) {
        const first = largeMoneyData.series.find(row => Number.isFinite(row.northMoney));
        if (first && minDate < first.date) minDate = first.date;
      }
      const holdingView = activeMetric === "northHoldings";
      const fundMode = activeMetric === "fundPosition" || activeMetric === "institutionConcentration";
      const etfMode = activeMetric === "etfShares";
      const holdingUnit = holdingMode === "value" ? "亿元" : "%";
      const displayUnit = holdingView ? holdingUnit : cfg.unit;
      const moneyName = cfg.totalLabel || "全市场资金";
      const sourceRows = holdingView ? northHoldings.series : fundMode ? fundReports.series
        : etfMode ? etfShares.series : largeMoneyData.series;
      const valueOf = (row, key) => holdingView ? row[key]?.[holdingMode]
        : fundMode ? row[key]?.[cfg.field]
        : etfMode ? row[key === "total" ? "total" : key] : row[cfg.field];
      const latestIncomplete = sourceRows[sourceRows.length - 1]?.incompleteWeek;
      const available = row => !fundMode || row.coverage >= 40;
      // Average the complete sampling history before clipping the visible range.
      // Keep missing values in the window so gaps cannot silently be bridged.
      const allMoneyPoints = holdingView ? [] : sourceRows.map(row => [row.date,
        available(row) && Number.isFinite(valueOf(row, "total")) ? valueOf(row, "total") : null]);
      const moneyPoints = pointMovingAverage(allMoneyPoints, effectiveAverageWindow)
        .filter(point => point[0] >= minDate && point[0] <= maxDate && (supportsAverage || point[1] != null));
      const latestReport = fundMode && moneyPoints.length
        ? sourceRows.find(row => row.date === moneyPoints[moneyPoints.length - 1][0]) : null;
      const weekDates = largeMoneyData.series.map(row => row.date);
      const indexSeries = northFlowMode ? [] : indices.filter(index => selectedSeries.has(index.name)).map(index => {
        let values;
        if (fundMode || etfMode || holdingView) {
          values = sourceRows.filter(row => row.date >= minDate)
            .map(row => [row.date, available(row) && Number.isFinite(valueOf(row, index.key))
              ? valueOf(row, index.key) : null]);
        } else {
          const amounts = new Map(indexMoneyData[index.key].map(row => [row.date, row[cfg.field]]));
          values = pointMovingAverage(weekDates.map(date => [date,
            Number.isFinite(amounts.get(date)) ? amounts.get(date) : null]), effectiveAverageWindow)
            .filter(point => point[0] >= minDate && point[0] <= maxDate);
        }
        return {
          name: index.name, type: "line", yAxisIndex: 0,
          data: values,
          showSymbol: fundMode || holdingView, symbolSize: 5, sampling: "lttb", connectNulls: false,
          lineStyle: { width: 2, color: index.color }, itemStyle: { color: index.color }
        };
      });
      document.getElementById("largeMoneyMetricSubtitle").textContent = holdingView
        ? (holdingMode === "value" ? cfg.subtitle : "北向持仓市值占各指数成分股总市值的季度末比例")
        : cfg.subtitle;
      renderExplanation("largeMoney", holdingView ? "northHoldings_" + holdingMode : activeMetric);
      const totalButton = document.querySelector('#largeMoneySeriesControls [data-series="全市场资金"]');
      document.getElementById("largeMoneySeriesControls").style.display = northFlowMode ? "none" : "";
      totalButton.style.display = holdingView ? "none" : "";
      document.getElementById("largeMoneyHoldingModes").classList.toggle("is-visible", holdingView);
      document.getElementById("largeMoneyAverageModes").hidden = !supportsAverage;
      document.querySelectorAll("#largeMoneyAverageModes [data-average]").forEach(button => {
        const active = Number(button.dataset.average) === averageWindow;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      totalButton.lastChild.textContent = moneyName;
      totalButton.setAttribute("aria-label", moneyName);
      const holdingRows = holdingView ? sourceRows.filter(row => row.date >= minDate) : [];
      document.getElementById("largeMoneyLatestReading").textContent = holdingView
        ? (holdingRows.length ? "季度末 " + holdingRows[0].date + " 至 " + holdingRows[holdingRows.length - 1].date : "当前范围暂无持仓数据")
        : moneyPoints.length
        ? (fundMode ? "报告期 " : "周标签 ") + moneyPoints[0][0] + " 至 " + moneyPoints[moneyPoints.length - 1][0] +
          " · 最新" + (supportsAverage ? averageLabel : "") + " " + fmt(moneyPoints[moneyPoints.length - 1][1], cfg.digits) + displayUnit +
          (supportsAverage && moneyPoints[moneyPoints.length - 1][1] == null
            ? "（" + (effectiveAverageWindow > 1 ? "窗口点数不足或含缺失值" : "暂无数据") + "）" : "") +
          (latestIncomplete ? " · 本周未结束" + (etfMode ? "，份额取最近披露值" : "，仅含截至刷新日记录") : "") +
          (latestReport ? " · 样本 " + latestReport.funds + " 只 / 覆盖 " + latestReport.coverage + "%" : "")
        : "当前范围暂无资金数据";
      chart.setOption({
        animation: false, backgroundColor: "transparent",
        grid: { left: 80, right: 28, top: 26, bottom: 66 },
        legend: { show: false },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "rgba(8,20,22,.96)", borderColor: "#3c625f",
          textStyle: { color: "#eaf4f2" },
          formatter(params) {
            const lines = params.filter(item => Number.isFinite(item.value?.[1])).map(item => item.marker + item.seriesName + "：<b>" +
              fmt(Number(item.value[1]), holdingView && holdingMode === "ratio" ? 3 : cfg.digits) +
              displayUnit + "</b>");
            if (!lines.length) lines.push(effectiveAverageWindow > 1 ? "窗口点数不足或含缺失值" : "暂无数据");
            const pointDate = params.find(item => item.value?.[0])?.value[0];
            if (sourceRows.find(row => row.date === pointDate)?.incompleteWeek) {
              lines.push("本周未结束" + (etfMode ? "，份额取最近披露值" : "，仅含截至刷新日记录"));
            }
            if (fundMode) {
              const reportDate = params.find(item => item.value?.[0])?.value[0];
              const report = sourceRows.find(row => row.date === reportDate);
              if (report) lines.push("样本 " + report.funds + " 只 / 覆盖 " + report.coverage + "%");
            }
            return "<b>" + (params[0]?.axisValueLabel || "") + (supportsAverage ? " · " + averageLabel : "") + "</b><br>" + lines.join("<br>");
          }
        },
        xAxis: { type: "time", axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#789b98", hideOverlap: true }, splitLine: { show: false } },
        yAxis: [
          { type: "value", scale: true, axisLabel: { color: northFlowMode ? "#f5c96a" : "#8fa5bf", formatter: "{value}" + displayUnit },
            splitLine: { lineStyle: { color: "#1b3737" } } },
        ],
        dataZoom: [
          { type: "inside", filterMode: "none", start: zoomStart, end: zoomEnd },
          { type: "slider", bottom: 12, height: 22, start: zoomStart, end: zoomEnd,
            borderColor: "#35545a", backgroundColor: "#0e2022",
            fillerColor: "rgba(54,194,255,.17)", handleStyle: { color: "#43d6cf" },
            textStyle: { color: "#8fa5bf" } }
        ],
        series: [
          ...(!holdingView && (northFlowMode || selectedSeries.has("全市场资金")) ? [{ name: moneyName, type: "line", yAxisIndex: 0, data: moneyPoints,
            showSymbol: fundMode, symbolSize: 5, sampling: "lttb", connectNulls: false,
            lineStyle: { width: 2, color: "#f5c96a" }, itemStyle: { color: "#f5c96a" } }] : []),
          ...indexSeries
        ]
      }, true);
    }

    document.querySelectorAll("#largeMoneyMetricTabs [data-metric]").forEach(button => {
      button.addEventListener("click", () => {
        activeMetric = button.dataset.metric;
        if (activeMetric === "northHoldings" && !["创业板指", "科创50", "科创综指"]
          .some(name => selectedSeries.has(name))) {
          selectedSeries.add("创业板指");
          document.querySelector('#largeMoneySeriesControls [data-series="创业板指"]')
            .setAttribute("aria-pressed", "true");
        }
        document.querySelectorAll("#largeMoneyMetricTabs [data-metric]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });
    document.querySelectorAll("#largeMoneyHoldingModes [data-holding-mode]").forEach(button => {
      button.addEventListener("click", () => {
        holdingMode = button.dataset.holdingMode;
        document.querySelectorAll("#largeMoneyHoldingModes [data-holding-mode]")
          .forEach(item => item.classList.toggle("active", item === button));
        renderChart();
      });
    });
    document.querySelectorAll("#largeMoneyAverageModes [data-average]").forEach(button => {
      button.addEventListener("click", () => {
        averageWindow = Number(button.dataset.average);
        renderChart();
      });
    });
    document.querySelectorAll("#largeMoneySeriesControls [data-series]").forEach(button => {
      button.addEventListener("click", () => {
        const name = button.dataset.series;
        if (selectedSeries.has(name)) {
          if (activeMetric === "northHoldings") {
            if (["创业板指", "科创50", "科创综指"].filter(item => selectedSeries.has(item)).length === 1) return;
          } else if (selectedSeries.size === 1) return;
          selectedSeries.delete(name);
        } else {
          selectedSeries.add(name);
        }
        button.setAttribute("aria-pressed", selectedSeries.has(name) ? "true" : "false");
        renderChart();
      });
    });
    document.querySelectorAll("#largeMoneyRangeTabs [data-years]").forEach(button => {
      button.addEventListener("click", () => {
        activeYears = Number(button.dataset.years);
        document.querySelectorAll("#largeMoneyRangeTabs [data-years]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart({ resetZoom: true });
      });
    });

    window.addEventListener("resize", () => chart.resize());
    renderChart();
  })();
  </script>
`;

if (!fs.existsSync(DATA_FILE)) throw new Error("Missing large_money_sentiment_data.json.");
if (!fs.existsSync(INDEX_DATA_FILE)) throw new Error("Missing large_money_index_data.json.");
if (!fs.existsSync(FUND_REPORTS_FILE)) throw new Error("Missing large_money_fund_reports.json.");
if (!fs.existsSync(ETF_SHARES_FILE)) throw new Error("Missing large_money_etf_shares.json.");
if (!fs.existsSync(NORTH_HOLDINGS_FILE)) throw new Error("Missing northbound_index_holdings.json.");
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const indexData = JSON.parse(fs.readFileSync(INDEX_DATA_FILE, "utf8"));
const fundReports = JSON.parse(fs.readFileSync(FUND_REPORTS_FILE, "utf8"));
const etfShares = JSON.parse(fs.readFileSync(ETF_SHARES_FILE, "utf8"));
const northHoldings = JSON.parse(fs.readFileSync(NORTH_HOLDINGS_FILE, "utf8"));
// Keep historical grouping keys in source caches; render open weeks as of the
// recorded refresh cutoff, never the browser clock or a future Saturday.
function capWeeklyDates(rows, cutoff) {
  return rows.map(row => row.date > cutoff
    ? { ...row, date: cutoff, incompleteWeek: true } : row);
}
data.series = capWeeklyDates(data.series, data.meta.updated);
for (const key of Object.keys(indexData)) {
  if (Array.isArray(indexData[key])) indexData[key] = capWeeklyDates(indexData[key], data.meta.updated);
}
etfShares.series = capWeeklyDates(etfShares.series, etfShares.meta.updated);
for (const row of etfShares.series) {
  if (row.date === etfShares.meta.updated && new Date(row.date + "T00:00:00Z").getUTCDay() < 6) row.incompleteWeek = true;
}
let html = stripExisting(fs.readFileSync(OUTPUT, "utf8"));
html = html.replace(
  '<a href="#retail-sentiment">情绪-散户</a>',
  '<a href="#retail-sentiment">情绪-散户</a><a href="#large-money-sentiment">情绪-大资金</a>'
);
function insertBeforeLast(source, marker, content) {
  const index = source.lastIndexOf(marker);
  if (index === -1) throw new Error(`Marker not found: ${marker}`);
  return source.slice(0, index) + content + source.slice(index);
}
const largeMoneyScript = script.replace("__LARGE_MONEY_DATA__", JSON.stringify(data))
  .replace("__INDEX_MONEY_DATA__", JSON.stringify(indexData))
  .replace("__FUND_REPORTS__", JSON.stringify(fundReports))
  .replace("__ETF_SHARES__", JSON.stringify(etfShares))
  .replace("__NORTH_HOLDINGS__", JSON.stringify(northHoldings));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", largeMoneyScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
