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
        <p>观察政策层面的融资供给、交易成本、货币环境和监管信号，识别官方对市场温度的调节。</p>
      </div>
      <div class="module-status" id="officialDataStatus"></div>
    </div>

    <article class="valuation-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">官方指标与三个指数</div>
          <div class="panel-subtitle" id="officialMetricSubtitle">IPO月度融资额与指数走势</div>
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
      <div class="metric-note">
        <span id="officialMetricNote"></span>
        <span class="metric-reading" id="officialLatestReading"></span>
      </div>
      <div id="officialSentimentChart"></div>
    </article>

    <div class="valuation-foot">
      <div class="note"><strong>统计口径：</strong><span id="officialMethodology"></span></div>
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
        subtitle: "新股上市月度募集资金与三个指数走势",
        note: "IPO融资额反映一级市场供给压力，阶段性收紧通常对应官方稳定市场取向。"
      },
      holderNetReductionAmount: {
        title: "产业资本净减持额", unit: "亿元", digits: 1,
        subtitle: "重要股东公告口径月度净减持金额与三个指数走势",
        note: "正值为净减持，负值为净增持；仅统计有成交均价的记录。"
      },
      stampDutyRate: {
        title: "印花税率", unit: "%", digits: 2,
        subtitle: "证券交易印花税卖出端税率与三个指数走势",
        note: "印花税率下降降低交易成本，但不是指数专属政策。"
      },
      lpr1y: {
        title: "1年期LPR", unit: "%", digits: 2,
        subtitle: "1年期贷款市场报价利率与三个指数走势",
        note: "利率下行降低折现率，需结合其他政策和盈利预期观察。"
      },
      socialFinancing: {
        title: "社融增量", unit: "亿元", digits: 0,
        subtitle: "社会融资规模月度增量与三个指数走势",
        note: "社融增量反映信用扩张力度，需结合融资结构和季节性观察。"
      },
      m2Yoy: {
        title: "M2同比增速", unit: "%", digits: 1,
        subtitle: "广义货币M2同比增速与三个指数走势",
        note: "M2增速体现广义流动性环境，需与社融和利率结合观察。"
      }
    };
    const methodology = {
      ipoFund: "按新股上市月份汇总实际募集资金（亿元），代表全市场 IPO 融资供给，不按指数拆分。三个指数为右轴价格相对走势。",
      holderNetReductionAmount: "按公告月份汇总重要股东增减持股数 × 披露均价（亿元）；正值为净减持，缺少均价的不计入。三个指数为右轴价格相对走势。",
      stampDutyRate: "证券交易印花税卖出端适用税率（%），按政策生效日变化；是全市场共同税率，不按指数拆分。三个指数为右轴价格相对走势。",
      lpr1y: "1 年期贷款市场报价利率（LPR，%），按公布月份取值；并非股票市场专属利率。三个指数为右轴价格相对走势。",
      socialFinancing: "当月社会融资规模增量（亿元），表示全社会新增融资，不等于流入股市的资金。三个指数为右轴价格相对走势。",
      m2Yoy: "广义货币 M2 余额相对上年同月的增速（%），反映货币环境，不等于股市资金流入。三个指数为右轴价格相对走势。"
    };
    const baselineDate = "2020-01-07";
    const indices = [
      { name: "创业板指", rows: DATA.sh, color: COLORS.sh },
      { name: "科创50", rows: DATA.k50, color: COLORS.k50 },
      { name: "科创综指", rows: DATA.sz, color: COLORS.sz }
    ];
    let activeMetric = "ipoFund";
    let activeYears = 0;
    const chart = echarts.init(document.getElementById("officialSentimentChart"), null, { renderer: "canvas" });
    document.getElementById("officialDataStatus").textContent =
      "官方月度数据 " + officialData.series[0].date + " 起";

    function renderChart() {
      const cfg = metrics[activeMetric];
      const end = new Date(officialData.series[officialData.series.length - 1].date + "T00:00:00Z");
      const cutoff = new Date(end);
      if (activeYears) cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      const minDate = activeYears ? cutoff.toISOString().slice(0, 10) : "";
      const policyPoints = officialData.series
        .filter(row => row.date >= minDate && Number.isFinite(row[activeMetric]))
        .map(row => [row.date, row[activeMetric]]);
      const indexSeries = indices.map(index => {
        const baseline = index.rows.find(row => row.date >= baselineDate && Number.isFinite(row.close));
        const baseClose = baseline?.close;
        return {
          name: index.name, type: "line", yAxisIndex: 1,
          data: index.rows.filter(row => row.date >= minDate && Number.isFinite(row.close) && baseClose)
            .map(row => [row.date, row.close / baseClose * 100]),
          showSymbol: false, sampling: "lttb",
          lineStyle: { width: 2, color: index.color }, itemStyle: { color: index.color }
        };
      });
      document.getElementById("officialMetricSubtitle").textContent = cfg.subtitle;
      document.getElementById("officialMetricNote").textContent = cfg.note;
      document.getElementById("officialMethodology").textContent = methodology[activeMetric] +
        " 指数以 2020-01-07 或其后首个可用点为 100，左右轴不能直接比较数值。";
      document.getElementById("officialLatestReading").textContent = policyPoints.length
        ? "官方指标 " + policyPoints[0][0] + " 至 " + policyPoints[policyPoints.length - 1][0] +
          " · 最新 " + fmt(policyPoints[policyPoints.length - 1][1], cfg.digits) + cfg.unit
        : "当前范围暂无官方指标数据";
      chart.setOption({
        animation: false, backgroundColor: "transparent",
        grid: { left: 80, right: 66, top: 68, bottom: 66 },
        legend: { type: "scroll", top: 12, textStyle: { color: "#8fa5bf", fontSize: 11 } },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter(params) {
            const lines = params.map(item => item.marker + item.seriesName + "：<b>" +
              fmt(Number(item.value[1]), item.seriesName === "官方指标" ? cfg.digits : 1) +
              (item.seriesName === "官方指标" ? cfg.unit : "") + "</b>");
            return "<b>" + (params[0]?.axisValueLabel || "") + "</b><br>" + lines.join("<br>");
          }
        },
        xAxis: { type: "time", axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false } },
        yAxis: [
          { type: "value", scale: true, axisLabel: { color: "#f6c85f", formatter(value) {
            return cfg.unit === "亿元" && Math.abs(value) >= 10000
              ? fmt(value / 10000, 1) + "万亿元"
              : fmt(value, cfg.digits) + cfg.unit;
          } }, splitLine: { lineStyle: { color: "#17283d" } } },
          { type: "value", scale: true, axisLabel: { color: "#8fa5bf", formatter: "{value}" },
            splitLine: { show: false } }
        ],
        dataZoom: [
          { type: "inside", filterMode: "none", start: 0, end: 100 },
          { type: "slider", bottom: 12, height: 22, start: 0, end: 100,
            borderColor: "#263b58", backgroundColor: "#0d1929",
            fillerColor: "rgba(255,93,115,.15)", handleStyle: { color: "#ff5d73" },
            textStyle: { color: "#8fa5bf" } }
        ],
        series: [
          { name: "官方指标", type: "line", yAxisIndex: 0, data: policyPoints,
            showSymbol: false, sampling: "lttb",
            lineStyle: { width: 2, color: "#f6c85f" }, itemStyle: { color: "#f6c85f" } },
          ...indexSeries
        ]
      }, true);
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
const officialScript = script.replace("__OFFICIAL_DATA__", JSON.stringify(data));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", officialScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
