const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "growth_indices_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "retail_sentiment_data.json");
const INDEX_DATA_FILE = path.join(ROOT, "work", "retail_index_metrics.json");
const MONTHLY_DATA_FILE = path.join(ROOT, "work", "retail_monthly_trends.json");

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
    .retail-monthly-heading { margin: 28px 0 12px; font-size: 20px; }
    .retail-monthly-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .retail-monthly-chart { height: 330px; width: 100%; }
    .retail-monthly-grid .metric-note { padding: 0 16px 14px; }
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
      .retail-monthly-grid { grid-template-columns: 1fr; }
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
      <div class="note"><strong>数据口径：</strong>成交额和成交量展示两市对照与三个指数的实际交易值，成交额使用从零开始的等距刻度；两市成交量使用上证综指、深证综指成交量之和作为宽基代理。换手率均为周频：创业板指、科创50取 Tushare 指数每日换手率，科创综指按当期成分股流通市值加权；指数融资余额为成分股融资余额之和，融资占比再除以成分股流通市值。所有可选指标均按每周最后一个交易日取点，缺失数据不补造。</div>
    </div>
    <h3 class="retail-monthly-heading">月度入场趋势</h3>
    <div class="retail-monthly-grid">
      <article class="valuation-panel">
        <div class="panel-head"><div><div class="panel-title">上交所 A 股新开户</div><div class="panel-subtitle">月度 · 万户</div></div></div>
        <div id="retailAccountsChart" class="retail-monthly-chart"></div>
        <div class="metric-note"><span>上交所开户口径，非沪深两市新增投资者人数。</span><span class="metric-reading" id="retailAccountsCoverage"></span></div>
      </article>
      <article class="valuation-panel">
        <div class="panel-head"><div><div class="panel-title">已披露新基金发行份额</div><div class="panel-subtitle">月度 · 亿份</div></div></div>
        <div id="retailFundsChart" class="retail-monthly-chart"></div>
        <div class="metric-note"><span>淡色月份披露不足 90%；均线仅使用连续三个覆盖达标月份。</span><span class="metric-reading" id="retailFundsCoverage"></span></div>
      </article>
    </div>
    <div class="valuation-foot"><div class="note"><strong>来源：</strong><a href="https://star.sse.com.cn/aboutus/publication/monthly/investor/" target="_blank" rel="noopener">上交所统计月报</a>；<a href="https://tushare.pro/document/1?doc_id=19" target="_blank" rel="noopener">Tushare 公募基金列表</a>。基金数据按成立月份和基金代码汇总发行份额，含股票、混合、债券等类型，不等同于募集金额；未披露份额不估算。</div></div>
  </section>
`;

const script = `
  <script id="retail-sentiment-script">
  (() => {
    const retailData = __RETAIL_DATA__;
    const indexData = __INDEX_DATA__;
    const monthlyData = __MONTHLY_DATA__;
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

    function movingAverage(values, valid = () => true) {
      return values.map((_, index) => index >= 2 && [index - 2, index - 1, index].every(valid)
        ? Number(((values[index - 2] + values[index - 1] + values[index]) / 3).toFixed(2))
        : null);
    }

    function monthlyOption(rows, field, unit, color, fund = false) {
      const values = rows.map(row => row[field]);
      const average = movingAverage(values, index => !fund || rows[index].coverage >= 90);
      return {
        animation: false,
        grid: { left: 64, right: 20, top: 48, bottom: 58 },
        legend: { top: 10, right: 18, textStyle: { color: "#8fa5bf", fontSize: 11 },
          data: [fund ? "已披露份额" : "新开户", "3月均线"] },
        tooltip: { trigger: "axis", backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" }, formatter(params) {
            const row = rows[params[0]?.dataIndex];
            if (!row) return "";
            const lines = params.filter(item => item.value != null).map(item =>
              item.marker + item.seriesName + "：<b>" + fmt(Number(item.value), 1) + unit + "</b>");
            if (fund) lines.push("发行份额披露：" + row.reported + "/" + row.funds + "（" + row.coverage + "%）");
            return "<b>" + row.month + "</b><br>" + lines.join("<br>");
          } },
        xAxis: { type: "category", data: rows.map(row => row.month), boundaryGap: true,
          axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", interval: 0, formatter(value, index) {
            return window.innerWidth <= 620
              ? (value.endsWith("-01") ? value.slice(0, 4) : "")
              : (index % 6 === 0 ? value : "");
          } } },
        yAxis: { type: "value", min: 0, axisLabel: { color: "#7890aa", formatter: "{value}" + unit },
          splitLine: { lineStyle: { color: "#17283d" } } },
        dataZoom: [{ type: "inside", filterMode: "none" },
          { type: "slider", bottom: 8, height: 18, borderColor: "#263b58",
            backgroundColor: "#0d1929", fillerColor: "rgba(246,200,95,.18)",
            handleStyle: { color: "#f6c85f" }, textStyle: { color: "#8fa5bf" } }],
        series: [
          { name: fund ? "已披露份额" : "新开户", type: "bar", barMaxWidth: 16,
            itemStyle: { color },
            data: rows.map(row => ({ value: row[field],
              itemStyle: { opacity: fund && row.coverage < 90 ? .3 : .85 } })) },
          { name: "3月均线", type: "line", data: average, showSymbol: false, connectNulls: false,
            lineStyle: { color: fund ? "#36c2ff" : "#edf4ff", width: 2 },
            itemStyle: { color: fund ? "#36c2ff" : "#edf4ff" } }
        ]
      };
    }

    const accountsChart = echarts.init(document.getElementById("retailAccountsChart"), null, { renderer: "canvas" });
    const fundsChart = echarts.init(document.getElementById("retailFundsChart"), null, { renderer: "canvas" });
    accountsChart.setOption(monthlyOption(monthlyData.accounts, "accountsWan", "万户", "#f6c85f"));
    fundsChart.setOption(monthlyOption(monthlyData.funds, "sharesYi", "亿份", "#7ddc82", true));
    const latestAccounts = monthlyData.accounts.at(-1);
    const latestFunds = monthlyData.funds.at(-1);
    document.getElementById("retailAccountsCoverage").textContent = "最新 " + latestAccounts.month;
    document.getElementById("retailFundsCoverage").textContent =
      "最新 " + latestFunds.month + " · 披露 " + latestFunds.coverage + "%";
    window.addEventListener("resize", () => {
      chart.resize(); accountsChart.resize(); fundsChart.resize();
    });
    renderChart();
  })();
  </script>
`;

if (!fs.existsSync(DATA_FILE)) throw new Error("Missing retail_sentiment_data.json.");
if (!fs.existsSync(INDEX_DATA_FILE)) throw new Error("Missing retail_index_metrics.json.");
if (!fs.existsSync(MONTHLY_DATA_FILE)) throw new Error("Missing retail_monthly_trends.json.");
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const indexData = JSON.parse(fs.readFileSync(INDEX_DATA_FILE, "utf8"));
const monthlyData = JSON.parse(fs.readFileSync(MONTHLY_DATA_FILE, "utf8"));
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
  .replace("__INDEX_DATA__", JSON.stringify(indexData))
  .replace("__MONTHLY_DATA__", JSON.stringify(monthlyData));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", retailScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
