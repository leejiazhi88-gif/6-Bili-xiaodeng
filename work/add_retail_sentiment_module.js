const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "growth_indices_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "retail_sentiment_data.json");

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
        <p>比较三个指数与全市场的交易热度。</p>
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
      <div class="metric-tabs" id="retailMetricTabs">
        <button class="metric-tab active" data-metric="amount">成交额</button>
        <button class="metric-tab" data-metric="volume">成交量</button>
        <button class="metric-tab" data-metric="turnover">换手率</button>
        <button class="metric-tab" data-metric="marginBalance">融资余额</button>
        <button class="metric-tab" data-metric="marginFloatRatio">融资余额/流通市值</button>
        <button class="metric-tab" data-metric="limitUpCount">涨停数量</button>
        <button class="metric-tab" disabled title="股票开户周度数据已停止更新">新增开户数</button>
        <button class="metric-tab" disabled title="待接公募基金发行规模数据源">新基金发行规模</button>
        <button class="metric-tab" disabled title="需要全市场个股历史行情截面计算">创新高股票占比</button>
        <button class="metric-tab" disabled title="需要全市场个股历史行情截面计算">年线以上股票比例</button>
      </div>
      <div class="metric-note">
        <span id="retailMetricNote"></span>
        <span class="metric-reading" id="retailLatestReading"></span>
      </div>
      <div id="retailSentimentChart"></div>
    </article>

    <div class="valuation-foot">
      <div class="note"><strong>数据口径：</strong>成交额四条线共用亿元纵轴；为同时看清指数和全市场的量级，成交额使用对数刻度。成交量只含三个指数，其他指标只含全市场，切换指标时仍共用同一张图。指数成交不等于散户独占成交；各线从实际有数据的日期起显示。</div>
    </div>
  </section>
`;

const script = `
  <script id="retail-sentiment-script">
  (() => {
    const retailData = __RETAIL_DATA__;
    const market = { name: "沪深两市", rows: retailData.series, color: "#f6c85f" };
    const indices = [
      { name: "创业板指", rows: DATA.sh, color: COLORS.sh },
      { name: "科创50", rows: DATA.k50, color: COLORS.k50 },
      { name: "科创综指", rows: DATA.sz, color: COLORS.sz }
    ];
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const metrics = {
      amount: {
        unit: "亿元", digits: 0, log: true,
        subtitle: "沪深两市与三个指数成交额，周频展示",
        note: "四条线共用亿元纵轴；对数刻度可同时看清全市场和指数的不同量级。",
        sources: [{ ...market, field: "amount" }, ...indices.map(item => ({ ...item, field: "amountYi" }))]
      },
      volume: {
        unit: "亿手", digits: 2,
        subtitle: "三个指数的成交量，周频展示",
        note: "此处只有指数成交量，没有同口径的两市成交量序列。",
        sources: indices.map(item => ({ ...item, field: "volumeYiShou" }))
      },
      turnover: {
        unit: "%", digits: 2,
        subtitle: "按沪深流通市值加权的市场换手率",
        note: "换手率越高，筹码交换越快；高位持续高换手通常意味着分歧扩大。",
        sources: [{ ...market, field: "turnover" }]
      },
      marginBalance: {
        unit: "亿元", digits: 0,
        subtitle: "沪深交易所融资余额合计",
        note: "融资余额持续抬升表示杠杆资金扩张。",
        sources: [{ ...market, field: "marginBalance" }]
      },
      marginFloatRatio: {
        unit: "%", digits: 2,
        subtitle: "融资余额占沪深市场流通市值比例",
        note: "比例比融资余额绝对值更适合跨年份比较市场杠杆拥挤度。",
        sources: [{ ...market, field: "marginFloatRatio" }]
      },
      limitUpCount: {
        unit: "家", digits: 0,
        subtitle: "当日非ST股票涨停数量，数据自2020年起",
        note: "涨停家数反映短线风险偏好，极高值也可能意味着情绪亢奋。",
        sources: [{ ...market, field: "limitUpCount" }]
      }
    };

    let activeMetric = "amount";
    let activeYears = 0;
    const chart = echarts.init(document.getElementById("retailSentimentChart"), null, { renderer: "canvas" });
    document.getElementById("retailDataStatus").textContent =
      "市场数据 " + retailData.series[0].date + " 起 / 涨停数据 2020 年起";

    function renderChart() {
      const cfg = metrics[activeMetric];
      const end = new Date(retailData.series[retailData.series.length - 1].date + "T00:00:00Z");
      const cutoff = new Date(end);
      if (activeYears) cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      const minDate = activeYears ? cutoff.toISOString().slice(0, 10) : "";
      const series = cfg.sources.map(source => ({
        name: source.name,
        type: "line",
        data: source.rows.filter(row => row.date >= minDate && Number.isFinite(row[source.field]) && (!cfg.log || row[source.field] > 0))
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
        dates.length ? dates[0] + " 至 " + dates[dates.length - 1] : "暂无数据";
      chart.setOption({
        animation: false,
        backgroundColor: "transparent",
        grid: { left: 72, right: 28, top: cfg.sources.length > 1 ? 65 : 42, bottom: 64 },
        legend: { show: cfg.sources.length > 1, type: "scroll", top: 12,
          textStyle: { color: "#8fa5bf", fontSize: 11 } },
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
          type: "time", axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false }
        },
        yAxis: {
          type: cfg.log ? "log" : "value", scale: true,
          axisLabel: { color: "#7890aa", formatter(value) {
            return cfg.unit === "亿元" && value >= 10000
              ? fmt(value / 10000, 0) + "万亿元"
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
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
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

const retailScript = script.replace("__RETAIL_DATA__", JSON.stringify(data));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", retailScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
