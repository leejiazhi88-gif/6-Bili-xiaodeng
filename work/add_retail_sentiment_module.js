const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "growth_indices_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "retail_sentiment_data.json");
const INDEX_DATA_FILE = path.join(ROOT, "work", "retail_index_metrics.json");

function stripExisting(html) {
  return html
    .replace(/\s*<section class="module-shell" id="retail-sentiment">[\s\S]*?<\/section>/g, "")
    .replace(/\s*<style id="retail-sentiment-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="retail-sentiment-script">[\s\S]*?<\/script>/g, "")
    .replace(/\s*<a href="#retail-sentiment"[^>]*>情绪-散户<\/a>/g, "");
}

const css = `
  <style id="retail-sentiment-style">
    #retailSentimentChart { height: 540px; width: 100%; }
    #retailSeriesControls { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 10px 16px 0; }
    #retailSeriesControls button { display: inline-flex; align-items: center; gap: 6px; padding: 4px 0;
      border: 0; background: transparent; color: #8fa5bf; font-size: 12px; cursor: pointer; }
    #retailSeriesControls button:hover { color: #edf4ff; background: transparent; }
    #retailSeriesControls button[aria-pressed="false"] { opacity: .4; }
    .retail-series-mark { position: relative; width: 22px; height: 12px; flex: none; }
    .retail-series-mark::before { content: ""; position: absolute; left: 0; right: 0; top: 5px;
      border-top: 2px solid var(--series-color); }
    .retail-series-mark::after { content: ""; position: absolute; left: 8px; top: 1px;
      width: 8px; height: 8px; border: 2px solid #edf4ff; border-radius: 50%; background: var(--series-color); }
    @media (max-width: 980px) {
      #retailSentimentChart { height: 470px; }
    }
  </style>
`;

const moduleHtml = `
  <section class="module-shell" id="retail-sentiment">
    <div class="module-head">
      <div>
        <div class="module-kicker">Module 02 / Retail Sentiment</div>
        <h2>情绪-散户</h2>
        <p>沪深两市与三个指数的交易、换手和融资数据。</p>
      </div>
      <div class="module-status" id="retailDataStatus"></div>
    </div>

    <article class="valuation-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">交易热度</div>
          <div class="panel-subtitle" id="retailMetricSubtitle">沪深两市与三个指数成交额，周频展示</div>
        </div>
        <div class="range-tabs" id="retailRangeTabs">
          <button class="range-tab" data-years="3">3年</button>
          <button class="range-tab" data-years="5">5年</button>
          <button class="range-tab" data-years="10">10年</button>
          <button class="range-tab" data-years="20">20年</button>
          <button class="range-tab active" data-years="0">全部</button>
        </div>
      </div>
      <div id="retailSeriesControls" role="group" aria-label="选择对照曲线">
        <button type="button" data-series="沪深两市" aria-pressed="true" style="--series-color:#f6c85f"><span class="retail-series-mark"></span>沪深两市</button>
        <button type="button" data-series="创业板指" aria-pressed="true" style="--series-color:#ff5d73"><span class="retail-series-mark"></span>创业板指</button>
        <button type="button" data-series="科创50" aria-pressed="true" style="--series-color:#7ddc82"><span class="retail-series-mark"></span>科创50</button>
        <button type="button" data-series="科创综指" aria-pressed="true" style="--series-color:#36c2ff"><span class="retail-series-mark"></span>科创综指</button>
      </div>
      <div class="metric-tabs" id="retailMetricTabs">
        <button class="metric-tab active" data-metric="amount">成交额</button>
        <button class="metric-tab" data-metric="volume">成交量</button>
        <button class="metric-tab" data-metric="turnover">换手率</button>
        <button class="metric-tab" data-metric="marginBalance">融资余额</button>
        <button class="metric-tab" data-metric="marginFloatRatio">融资余额/流通市值</button>
      </div>
      <div class="metric-note">
        <span id="retailMetricNote"></span>
        <span class="metric-reading" id="retailLatestReading"></span>
      </div>
      <div id="retailSentimentChart"></div>
    </article>

    <div class="valuation-foot">
      <div class="note"><strong>统计口径：</strong><span id="retailMethodology"></span></div>
    </div>
  </section>
`;

const script = `
  <script id="retail-sentiment-script">
  (() => {
    const retailData = __RETAIL_DATA__;
    const indexData = __INDEX_DATA__;
    const market = { name: "沪深两市", rows: retailData.series, color: "#f6c85f" };
    const indices = [
      { name: "创业板指", rows: DATA.sh, color: COLORS.sh },
      { name: "科创50", rows: DATA.k50, color: COLORS.k50 },
      { name: "科创综指", rows: DATA.sz, color: COLORS.sz }
    ];
    const indexMetrics = [
      { name: "创业板指", rows: indexData.sh, color: COLORS.sh },
      { name: "科创50", rows: indexData.k50, color: COLORS.k50 },
      { name: "科创综指", rows: indexData.sz, color: COLORS.sz }
    ];
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const metrics = {
      amount: {
        unit: "亿元", digits: 0,
        subtitle: "沪深两市与三个指数成交额，周频展示",
        note: "四条线共用从零开始的亿元等距纵轴；指数成交额因量级较小会靠近底部。",
        sources: [{ ...market, field: "amount" }, ...indices.map(item => ({ ...item, field: "amountYi" }))]
      },
      volume: {
        unit: "亿手", digits: 2,
        subtitle: "两市宽基代理与三个指数成交量，周频展示",
        note: "两市成交量为上证综指与深证综指之和，属于宽基代理。",
        sources: [{ ...market, field: "volumeProxy" },
          ...indices.map(item => ({ ...item, field: "volumeYiShou" }))]
      },
      turnover: {
        unit: "%", digits: 2,
        subtitle: "沪深两市与三个指数的实际换手率",
        note: "均为周频：创业板指、科创50取指数换手率原值；科创综指按成分股流通市值加权。",
        sources: [{ ...market, field: "turnover" }, ...indexMetrics.map(item => ({ ...item, field: "turnover" }))]
      },
      marginBalance: {
        unit: "亿元", digits: 0,
        subtitle: "沪深两市与三个指数成分股融资余额",
        note: "三个指数为当期成分股融资余额之和，未列入融资标的的成分股按零计；均为周频。",
        sources: [{ ...market, field: "marginBalance" }, ...indexMetrics.map(item => ({ ...item, field: "marginBalance" }))]
      },
      marginFloatRatio: {
        unit: "%", digits: 2,
        subtitle: "沪深两市与三个指数的融资余额/流通市值",
        note: "三个指数的融资余额除以当期成分股流通市值合计；均为周频。",
        sources: [{ ...market, field: "marginFloatRatio" }, ...indexMetrics.map(item => ({ ...item, field: "marginFloatRatio" }))]
      }
    };
    const methodology = {
      amount: "沪深两市与三个指数均为实际成交额（亿元），取每周最后一个交易日；纵轴从零开始、等距显示，不是对数刻度。",
      volume: "三个指数为实际成交量（亿手）；两市线以上证综指与深证综指成交量之和作宽基代理。均取每周最后一个交易日。",
      turnover: "创业板指、科创50采用指数换手率原值；科创综指按当期成分股流通市值加权。均取每周最后一个交易日的百分比，不是周累计。",
      marginBalance: "三个指数分别汇总当期成分股融资余额，两市线为沪深市场余额（亿元）；未列入融资标的的成分股按零计。取每周最后一个交易日。",
      marginFloatRatio: "指数成分股融资余额合计 ÷ 同期成分股流通市值合计；两市线按沪深市场整体口径计算。取每周最后一个交易日的百分比。"
    };

    let activeMetric = "amount";
    let activeYears = 0;
    const selectedSeries = new Set(["沪深两市", "创业板指", "科创50", "科创综指"]);
    const chart = echarts.init(document.getElementById("retailSentimentChart"), null, { renderer: "canvas" });
    document.getElementById("retailDataStatus").textContent =
      "市场数据 " + retailData.series[0].date + " 起 / 指数按实际起点显示";

    function renderChart() {
      const cfg = metrics[activeMetric];
      const end = new Date(retailData.series[retailData.series.length - 1].date + "T00:00:00Z");
      const cutoff = new Date(end);
      if (activeYears) cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      const minDate = activeYears ? cutoff.toISOString().slice(0, 10) : "";
      const axisStart = minDate || "2005-01-01";
      const series = cfg.sources.filter(source => selectedSeries.has(source.name)).map(source => ({
        name: source.name,
        type: "line",
        data: source.rows.filter(row => row.date >= minDate && Number.isFinite(row[source.field]))
          .map(row => [row.date, row[source.field]]),
        showSymbol: false,
        sampling: "lttb",
        lineStyle: { width: 2, color: source.color },
        itemStyle: { color: source.color }
      }));
      const dates = series.flatMap(item => item.data.map(point => point[0]));
      dates.sort();
      document.getElementById("retailMetricSubtitle").textContent = cfg.subtitle;
      document.getElementById("retailMetricNote").textContent = cfg.note;
      document.getElementById("retailMethodology").textContent = methodology[activeMetric];
      document.getElementById("retailLatestReading").textContent =
        dates.length ? "时间轴 " + axisStart + " 起；可用数据 " + dates[0] + " 至 " + dates[dates.length - 1] : "暂无数据";
      chart.setOption({
        animation: false,
        backgroundColor: "transparent",
        grid: { left: 72, right: 28, top: 26, bottom: 64 },
        legend: { show: false },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter(params) {
            const lines = params.map(item => item.marker + item.seriesName + "：<b>" +
              fmt(Number(item.value[1]), cfg.digits) + cfg.unit + "</b>");
            return "<b>" + (params[0]?.axisValueLabel || "") + "</b><br>" + lines.join("<br>");
          }
        },
        xAxis: {
          type: "time", min: axisStart, max: retailData.series[retailData.series.length - 1].date,
          axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false }
        },
        yAxis: {
          type: "value", scale: activeMetric !== "amount", min: activeMetric === "amount" ? 0 : undefined,
          axisLabel: { color: "#7890aa", formatter(value) {
            return cfg.unit === "亿元" && value >= 10000
              ? fmt(value / 10000, 1) + "万亿元"
              : fmt(value, cfg.digits) + cfg.unit;
          } },
          splitLine: { lineStyle: { color: "#17283d" } }
        },
        dataZoom: [
          { type: "inside", filterMode: "none", start: 0, end: 100 },
          { type: "slider", bottom: 12, height: 22, start: 0, end: 100,
            borderColor: "#263b58", backgroundColor: "#0d1929",
            fillerColor: "rgba(246,200,95,.18)", handleStyle: { color: "#f6c85f" },
            textStyle: { color: "#8fa5bf" } }
        ],
        series
      }, true);
    }

    document.querySelectorAll("#retailMetricTabs [data-metric]").forEach(button => {
      button.addEventListener("click", () => {
        activeMetric = button.dataset.metric;
        document.querySelectorAll("#retailMetricTabs [data-metric]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });
    document.querySelectorAll("#retailSeriesControls [data-series]").forEach(button => {
      button.addEventListener("click", () => {
        const name = button.dataset.series;
        if (selectedSeries.has(name)) {
          if (selectedSeries.size === 1) return;
          selectedSeries.delete(name);
        } else {
          selectedSeries.add(name);
        }
        button.setAttribute("aria-pressed", selectedSeries.has(name) ? "true" : "false");
        renderChart();
      });
    });
    document.querySelectorAll("#retailRangeTabs [data-years]").forEach(button => {
      button.addEventListener("click", () => {
        activeYears = Number(button.dataset.years);
        document.querySelectorAll("#retailRangeTabs [data-years]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });

    window.addEventListener("resize", () => chart.resize());
    renderChart();
  })();
  </script>
`;

if (!fs.existsSync(DATA_FILE)) throw new Error("Missing retail_sentiment_data.json.");
if (!fs.existsSync(INDEX_DATA_FILE)) throw new Error("Missing retail_index_metrics.json.");
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const indexData = JSON.parse(fs.readFileSync(INDEX_DATA_FILE, "utf8"));
let html = stripExisting(fs.readFileSync(OUTPUT, "utf8"));
html = html.replace(
  '<a href="#valuation">估值</a>',
  '<a href="#valuation">估值</a><a href="#retail-sentiment">情绪-散户</a>'
);

function insertBeforeLast(source, marker, content) {
  const index = source.lastIndexOf(marker);
  if (index === -1) throw new Error(`Marker not found: ${marker}`);
  return source.slice(0, index) + content + source.slice(index);
}

const retailScript = script.replace("__RETAIL_DATA__", JSON.stringify(data))
  .replace("__INDEX_DATA__", JSON.stringify(indexData));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", retailScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
