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
    .retail-grid { display: grid; grid-template-columns: minmax(0, 1fr); }
    .retail-grid + .valuation-foot { grid-template-columns: 1fr; }
    #retailSentimentChart { height: 500px; width: 100%; }
    @media (max-width: 980px) {
      #retailSentimentChart { height: 450px; }
    }
  </style>
`;

const moduleHtml = `
  <section class="module-shell" id="retail-sentiment">
    <div class="module-head">
      <div>
        <div class="module-kicker">Module 02 / Retail Sentiment</div>
        <h2>情绪-散户</h2>
        <p>连续数据观察交易热度与杠杆扩张。</p>
      </div>
      <div class="module-status">市场数据 2019年至今 / 涨停数据 2020年至今</div>
    </div>

    <div class="retail-grid">
      <article class="valuation-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">连续走势图</div>
            <div class="panel-subtitle" id="retailMetricSubtitle">沪深两市股票成交额，周频展示</div>
          </div>
          <div class="range-tabs" id="retailRangeTabs">
            <button class="range-tab" data-years="3">3年</button>
            <button class="range-tab" data-years="5">5年</button>
            <button class="range-tab active" data-years="0">全部</button>
          </div>
        </div>
        <div class="metric-tabs" id="retailMetricTabs">
          <button class="metric-tab active" data-metric="amount">两市成交额</button>
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
          <span id="retailMetricNote">成交额快速放大代表交易热度上升，需结合指数涨幅判断是否出现巨量滞涨。</span>
          <span class="metric-reading" id="retailLatestReading"></span>
        </div>
        <div id="retailSentimentChart"></div>
      </article>

    </div>

    <div class="valuation-foot">
      <div class="note"><strong>连续数据口径：</strong>成交额与换手率来自沪深交易统计；融资余额及其占流通市值比例来自两交易所融资汇总；涨停数量来自非ST股票涨停统计。所有图表按周频展示。</div>
    </div>
  </section>
`;

const script = `
  <script id="retail-sentiment-script">
  (() => {
    const retailData = __RETAIL_DATA__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";

    const metrics = {
      amount: {
        title: "两市成交额", unit: "亿元", digits: 0,
        subtitle: "沪深两市股票成交额，周频展示",
        note: "成交额快速放大代表交易热度上升，需结合指数涨幅判断是否出现巨量滞涨。"
      },
      turnover: {
        title: "市场换手率", unit: "%", digits: 2,
        subtitle: "按沪深流通市值加权的市场换手率",
        note: "换手率越高，筹码交换越快；高位持续高换手通常意味着分歧显著扩大。"
      },
      marginBalance: {
        title: "融资余额", unit: "亿元", digits: 0,
        subtitle: "沪深交易所融资余额合计",
        note: "融资余额持续抬升表示杠杆资金扩张，快速回落则常伴随去杠杆压力。"
      },
      marginFloatRatio: {
        title: "融资余额/流通市值", unit: "%", digits: 2,
        subtitle: "融资余额占沪深市场流通市值比例",
        note: "比例比融资余额绝对值更适合跨年份比较市场杠杆拥挤度。"
      },
      limitUpCount: {
        title: "涨停数量", unit: "家", digits: 0,
        subtitle: "当日非ST股票涨停数量，数据自2020年起",
        note: "涨停家数反映短线风险偏好，但极高值也可能意味着情绪进入亢奋区。"
      }
    };

    let activeMetric = "amount";
    let activeYears = 0;
    const chart = echarts.init(document.getElementById("retailSentimentChart"), null, { renderer: "canvas" });

    function activeRows() {
      const rows = retailData.series.filter(row => Number.isFinite(row[activeMetric]));
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
      document.getElementById("retailMetricSubtitle").textContent = cfg.subtitle;
      document.getElementById("retailMetricNote").textContent = cfg.note;
      document.getElementById("retailLatestReading").textContent =
        "最新：" + fmt(latest, cfg.digits) + cfg.unit;
      chart.setOption({
        animation: false,
        backgroundColor: "transparent",
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
            fillerColor: "rgba(246,200,95,.18)", handleStyle: { color: "#f6c85f" },
            textStyle: { color: "#8fa5bf" } }
        ],
        series: [{
          name: cfg.title, type: "line", data: points, showSymbol: false,
          sampling: "lttb", lineStyle: { width: 2.2, color: "#f6c85f" },
          areaStyle: { color: "rgba(246,200,95,.08)" },
          itemStyle: { color: "#f6c85f" }
        }]
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
