const fs = require("fs");
const path = require("path");

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
    .official-grid { display: grid; grid-template-columns: minmax(0, 1fr); }
    #officialSentimentChart { height: 500px; width: 100%; }
    .official-index-chart { height: 280px; width: 100%; }
    @media (max-width: 980px) {
      #officialSentimentChart { height: 450px; }
      .official-index-chart { height: 250px; }
    }
  </style>
`;

const moduleHtml = `
  <section class="module-shell" id="official-sentiment">
    <div class="module-head">
      <div>
        <div class="module-kicker">Module 04 / Official Sentiment</div>
        <h2>情绪-官方</h2>
        <p>观察政策层面的融资供给、交易成本、货币环境和监管信号，识别官方对市场温度的调节。</p>
      </div>
      <div class="module-status" id="officialDataStatus"></div>
    </div>

    <div class="official-grid">
      <article class="valuation-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">三个指数对照</div>
            <div class="panel-subtitle">所选政策指标为共同环境；右轴为各指数自身走势</div>
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
          <button class="metric-tab" disabled title="缺少稳定可自动更新的全市场再融资金额接口">再融资额</button>
          <button class="metric-tab" data-metric="holderNetReductionAmount">产业资本净减持额</button>
          <button class="metric-tab" data-metric="stampDutyRate">印花税率</button>
          <button class="metric-tab" data-metric="lpr1y">政策利率</button>
          <button class="metric-tab" data-metric="socialFinancing">社融增量</button>
          <button class="metric-tab" data-metric="m2Yoy">M2增速</button>
          <button class="metric-tab" disabled title="国家队持仓规模没有统一官方连续披露口径">国家队持仓规模</button>
        </div>
        <div class="board-chart-block">
          <div class="board-chart-head"><strong class="sh">创业板指</strong><span id="officialIndexLatestSh"></span></div>
          <div class="official-index-chart" id="officialIndexChartSh"></div>
        </div>
        <div class="board-chart-block">
          <div class="board-chart-head"><strong class="k50">科创50</strong><span id="officialIndexLatestK50"></span></div>
          <div class="official-index-chart" id="officialIndexChartK50"></div>
        </div>
        <div class="board-chart-block">
          <div class="board-chart-head"><strong class="sz">科创综指</strong><span id="officialIndexLatestSz"></span></div>
          <div class="official-index-chart" id="officialIndexChartSz"></div>
        </div>
      </article>
      <article class="valuation-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">全市场完整历史</div>
            <div class="panel-subtitle" id="officialMetricSubtitle">IPO月度融资额</div>
          </div>
        </div>
        <div class="metric-note">
          <span id="officialMetricNote">IPO融资额反映一级市场供给压力，阶段性收紧通常对应官方稳定市场取向。</span>
          <span class="metric-reading" id="officialLatestReading"></span>
        </div>
        <div id="officialSentimentChart"></div>
      </article>

    </div>

    <div class="valuation-foot">
      <div class="note"><strong>连续数据口径：</strong>IPO融资额来自新股上市募集资金；产业资本净减持额用重要股东增减持公告和均价估算，正值为净减持；LPR、社融、M2为月频宏观数据。</div>
      <div class="note"><strong>指数对照：</strong>上方三图的政策指标相同，均非指数专属数据；指数线各自不同。它们展示同期关系，不代表政策值已按指数拆分。</div>
      <div class="note"><strong>缺口说明：</strong>再融资额与国家队持仓规模缺少稳定、统一、可自动更新的官方连续口径，当前暂不绘制。</div>
    </div>
  </section>
`;

const script = `
  <script id="official-sentiment-script">
  (() => {
    const officialData = __OFFICIAL_DATA__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const metrics = {
      ipoFund: {
        title: "IPO融资额", unit: "亿元", digits: 1,
        subtitle: "新股上市月度募集资金合计",
        note: "IPO融资额反映一级市场供给压力，阶段性收紧通常对应官方稳定市场取向。"
      },
      holderNetReductionAmount: {
        title: "产业资本净减持额", unit: "亿元", digits: 1,
        subtitle: "重要股东公告口径的月度净减持金额估算",
        note: "正值为净减持，负值为净增持；仅统计有成交均价的增减持记录。"
      },
      stampDutyRate: {
        title: "印花税率", unit: "%", digits: 2,
        subtitle: "证券交易印花税卖出端税率",
        note: "印花税率下降是官方降低交易成本、活跃资本市场的直接信号。"
      },
      lpr1y: {
        title: "1年期LPR", unit: "%", digits: 2,
        subtitle: "1年期贷款市场报价利率",
        note: "政策利率下行降低折现率，并常与稳增长政策组合一起影响风险偏好。"
      },
      socialFinancing: {
        title: "社融增量", unit: "亿元", digits: 0,
        subtitle: "社会融资规模月度增量",
        note: "社融增量反映信用扩张力度，持续改善通常有利于盈利预期和风险偏好。"
      },
      m2Yoy: {
        title: "M2同比增速", unit: "%", digits: 1,
        subtitle: "货币供应量M2同比增速",
        note: "M2增速体现广义流动性环境，需要与社融和政策利率结合观察。"
      }
    };
    let activeMetric = "ipoFund";
    let activeYears = 0;
    const chart = echarts.init(document.getElementById("officialSentimentChart"), null, { renderer: "canvas" });
    const indexMarkets = [
      { key: "Sh", label: "创业板指", rows: DATA.sh, color: COLORS.sh },
      { key: "K50", label: "科创50", rows: DATA.k50, color: COLORS.k50 },
      { key: "Sz", label: "科创综指", rows: DATA.sz, color: COLORS.sz }
    ];
    const indexCharts = indexMarkets.map(market => echarts.init(
      document.getElementById("officialIndexChart" + market.key), null, { renderer: "canvas" }));
    document.getElementById("officialDataStatus").textContent =
      "官方月度数据 " + officialData.series[0].date + " 起";

    function renderIndexCharts() {
      const cfg = metrics[activeMetric];
      indexMarkets.forEach((market, index) => {
        const first = market.rows[0].date;
        const end = new Date(market.rows[market.rows.length - 1].date + "T00:00:00Z");
        const cutoff = new Date(end);
        if (activeYears) cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
        const minDate = activeYears ? cutoff.toISOString().slice(0, 10) : first;
        const indexRows = market.rows.filter(row => row.date >= minDate && Number.isFinite(row.close));
        const indexPoints = indexRows.map(row => [row.date, row.close]);
        const metricPoints = officialData.series
          .filter(row => row.date >= minDate && Number.isFinite(row[activeMetric]))
          .map(row => [row.date, row[activeMetric]]);
        document.getElementById("officialIndexLatest" + market.key).textContent =
          "指数始于 " + first + " · 图内指标起于 " + (metricPoints[0]?.[0] || "暂无数据");
        indexCharts[index].setOption({
          animation: false, backgroundColor: "transparent",
          grid: { left: 70, right: 70, top: 42, bottom: 60 },
          legend: { top: 4, textStyle: { color: "#8fa5bf", fontSize: 10 } },
          tooltip: { trigger: "axis", axisPointer: { type: "cross" },
            backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
            textStyle: { color: "#edf4ff" } },
          xAxis: { type: "time", axisLine: { lineStyle: { color: "#344760" } },
            axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false } },
          yAxis: [
            { type: "value", scale: true, axisLabel: { color: "#8fa5bf", formatter: "{value}" + cfg.unit },
              splitLine: { lineStyle: { color: "#17283d" } } },
            { type: "value", scale: true, axisLabel: { color: market.color }, splitLine: { show: false } }
          ],
          dataZoom: [
            { type: "inside", filterMode: "none", start: 0, end: 100 },
            { type: "slider", bottom: 10, height: 20, start: 0, end: 100,
              borderColor: "#263b58", backgroundColor: "#0d1929",
              fillerColor: "rgba(255,93,115,.15)", handleStyle: { color: "#ff5d73" },
              textStyle: { color: "#8fa5bf" } }
          ],
          series: [
            { name: cfg.title + "（共同环境）", type: "line", data: metricPoints,
              yAxisIndex: 0, showSymbol: false, sampling: "lttb",
              lineStyle: { width: 1.7, color: "#f6c85f" }, itemStyle: { color: "#f6c85f" } },
            { name: market.label + "点位", type: "line", data: indexPoints,
              yAxisIndex: 1, showSymbol: false, sampling: "lttb",
              lineStyle: { width: 2, color: market.color }, itemStyle: { color: market.color } }
          ]
        }, true);
      });
    }

    function activeRows() {
      const rows = officialData.series.filter(row => Number.isFinite(row[activeMetric]));
      if (!activeYears || !rows.length) return rows;
      const end = new Date(rows[rows.length - 1].date + "T00:00:00Z");
      const cutoff = new Date(end);
      cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      return rows.filter(row => new Date(row.date + "T00:00:00Z") >= cutoff);
    }
    function renderChart() {
      const cfg = metrics[activeMetric];
      const rows = activeRows();
      const points = rows.map(row => [row.date, row[activeMetric]]);
      const latest = points[points.length - 1]?.[1];
      document.getElementById("officialMetricSubtitle").textContent = cfg.subtitle;
      document.getElementById("officialMetricNote").textContent = cfg.note;
      document.getElementById("officialLatestReading").textContent =
        "最新：" + fmt(latest, cfg.digits) + cfg.unit + (points.length ? " · 起于 " + points[0][0] : "");
      chart.setOption({
        animation: false, backgroundColor: "transparent",
        grid: { left: 72, right: 28, top: 42, bottom: 64 },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter(params) {
            const item = params[0];
            return "<b>" + (item?.axisValueLabel || "") + "</b><br>" +
              item.marker + cfg.title + "：<b>" + fmt(Number(item.value[1]), cfg.digits) + cfg.unit + "</b>";
          }
        },
        xAxis: {
          type: "time", axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false }
        },
        yAxis: {
          type: "value", scale: true,
          axisLabel: { color: "#7890aa", formatter: "{value}" + cfg.unit },
          splitLine: { lineStyle: { color: "#17283d" } }
        },
        dataZoom: [
          { type: "inside", filterMode: "none", start: 0, end: 100 },
          { type: "slider", bottom: 12, height: 22, start: 0, end: 100,
            borderColor: "#263b58", backgroundColor: "#0d1929",
            fillerColor: "rgba(255,93,115,.15)", handleStyle: { color: "#ff5d73" },
            textStyle: { color: "#8fa5bf" } }
        ],
        series: [{
          name: cfg.title, type: "line", data: points, showSymbol: false,
          sampling: "lttb", lineStyle: { width: 2.2, color: "#ff5d73" },
          areaStyle: { color: "rgba(255,93,115,.07)" }, itemStyle: { color: "#ff5d73" }
        }]
      }, true);
      renderIndexCharts();
    }
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

    window.addEventListener("resize", () => { chart.resize(); indexCharts.forEach(item => item.resize()); });
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
const officialScript = script.replace("__OFFICIAL_DATA__", JSON.stringify(data));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", officialScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
