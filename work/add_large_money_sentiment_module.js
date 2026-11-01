const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "growth_indices_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "large_money_sentiment_data.json");

function stripExisting(html) {
  return html
    .replace(/\s*<section class="module-shell" id="large-money-sentiment">[\s\S]*?<\/section>/g, "")
    .replace(/\s*<style id="large-money-sentiment-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="large-money-sentiment-script">[\s\S]*?<\/script>/g, "")
    .replace(/\s*<a href="#large-money-sentiment"[^>]*>情绪-大资金<\/a>/g, "");
}

const css = `
  <style id="large-money-sentiment-style">
    #largeMoneyChart { height: 560px; width: 100%; }
    #largeMoneySeriesControls { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 10px 16px 0; }
    #largeMoneySeriesControls button { display: inline-flex; align-items: center; gap: 6px; padding: 4px 0;
      border: 0; background: transparent; color: #8fa5bf; font-size: 12px; cursor: pointer; }
    #largeMoneySeriesControls button:hover { color: #edf4ff; background: transparent; }
    #largeMoneySeriesControls button[aria-pressed="false"] { opacity: .4; }
    .large-money-series-mark { position: relative; width: 22px; height: 12px; flex: none; }
    .large-money-series-mark::before { content: ""; position: absolute; left: 0; right: 0; top: 5px;
      border-top: 2px solid var(--series-color); }
    .large-money-series-mark::after { content: ""; position: absolute; left: 8px; top: 1px;
      width: 8px; height: 8px; border: 2px solid #edf4ff; border-radius: 50%; background: var(--series-color); }
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
          <div class="panel-subtitle" id="largeMoneyMetricSubtitle">全市场大宗交易额与指数走势</div>
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
        <button type="button" data-series="全市场资金" aria-pressed="true" style="--series-color:#f6c85f"><span class="large-money-series-mark"></span>全市场资金</button>
        <button type="button" data-series="创业板指" aria-pressed="true" style="--series-color:#ff5d73"><span class="large-money-series-mark"></span>创业板指</button>
        <button type="button" data-series="科创50" aria-pressed="true" style="--series-color:#7ddc82"><span class="large-money-series-mark"></span>科创50</button>
        <button type="button" data-series="科创综指" aria-pressed="true" style="--series-color:#36c2ff"><span class="large-money-series-mark"></span>科创综指</button>
      </div>
      <div class="metric-tabs" id="largeMoneyMetricTabs">
        <button class="metric-tab active" data-metric="blockAmount">大宗交易额</button>
        <button class="metric-tab" data-metric="institutionBlockNet">机构大宗净买入</button>
        <button class="metric-tab" data-metric="holderNetShares">产业资本净增减持</button>
        <button class="metric-tab" data-metric="northMoney">北向资金净流入</button>
        <button class="metric-tab" disabled title="基金持仓按季度披露，待完成统一仓位估算">主动权益基金仓位</button>
        <button class="metric-tab" disabled title="需要公募持仓全市场截面聚合">机构持仓集中度</button>
        <button class="metric-tab" disabled title="ETF全市场历史快照待接入">ETF份额变化</button>
      </div>
      <div class="metric-note">
        <span id="largeMoneyMetricNote"></span>
        <span class="metric-reading" id="largeMoneyLatestReading"></span>
      </div>
      <div id="largeMoneyChart"></div>
    </article>

    <div class="valuation-foot">
      <div class="note"><strong>图表口径：</strong>四条曲线统一按周六标记所属周，指数取同周最后一个可用收盘点；周六是周标签，不代表当天交易。黄色资金线为全市场所选指标，使用左轴原始单位；三条指数线使用右轴，以2020-01-07为100比较相对走势。资金没有按指数成分股拆分，左右轴数值不能直接相减。</div>
      <div class="note"><strong>数据口径：</strong>大宗交易仅统计 A 股股票，排除债券等其他证券；机构净买入仅识别买卖方标记为“机构专用”的席位。产业资本净增减持仅统计有成交均价的股票记录，排除无价格的大额股权划转；正值为净增持、负值为净减持。</div>
      <div class="note"><strong>北向口径提示：</strong>北向净流入序列保留至2024年8月16日。此后披露机制发生变化，页面不把新口径成交数据与旧口径净流入强行拼接。</div>
    </div>
  </section>
`;

const script = `
  <script id="large-money-sentiment-script">
  (() => {
    const largeMoneyData = __LARGE_MONEY_DATA__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const metrics = {
      blockAmount: {
        title: "大宗交易额", unit: "亿元", digits: 1,
        subtitle: "全市场大宗交易周成交额与三个指数走势",
        note: "大宗交易放量代表大额筹码交换活跃，需要结合机构席位净方向判断。"
      },
      institutionBlockNet: {
        title: "机构大宗净买入", unit: "亿元", digits: 1,
        subtitle: "机构专用席位大宗交易周净买入额与三个指数走势",
        note: "正值表示机构席位净买入，负值表示净卖出。"
      },
      holderNetShares: {
        title: "产业资本净增减持", unit: "亿股", digits: 2,
        subtitle: "重要股东公告口径周净增减持股数与三个指数走势",
        note: "正值为净增持，负值为净减持；按股数汇总，不等同于交易金额。"
      },
      northMoney: {
        title: "北向资金净流入", unit: "亿元", digits: 1,
        subtitle: "沪深股通日净流入周末值与三个指数走势，资金序列止于2024-08-16",
        note: "披露机制变化后不再与旧口径拼接，指数线仍延伸至最新交易日。"
      }
    };
    const baselineDate = "2020-01-07";
    const indices = [
      { name: "创业板指", rows: DATA.sh, color: COLORS.sh },
      { name: "科创50", rows: DATA.k50, color: COLORS.k50 },
      { name: "科创综指", rows: DATA.sz, color: COLORS.sz }
    ];
    function weekEnd(date) {
      const day = new Date(date + "T00:00:00Z");
      day.setUTCDate(day.getUTCDate() + (6 - day.getUTCDay()));
      return day.toISOString().slice(0, 10);
    }
    let activeMetric = "blockAmount";
    let activeYears = 0;
    const selectedSeries = new Set(["全市场资金", "创业板指", "科创50", "科创综指"]);
    const chart = echarts.init(document.getElementById("largeMoneyChart"), null, { renderer: "canvas" });
    document.getElementById("largeMoneyDataStatus").textContent =
      "大宗与增减持 " + largeMoneyData.series[0].date + " 起 / 北向至 2024-08-16";

    function renderChart() {
      const cfg = metrics[activeMetric];
      const end = new Date(largeMoneyData.series[largeMoneyData.series.length - 1].date + "T00:00:00Z");
      const cutoff = new Date(end);
      if (activeYears) cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      const minDate = activeYears ? cutoff.toISOString().slice(0, 10) : "";
      const moneyPoints = largeMoneyData.series
        .filter(row => row.date >= minDate && Number.isFinite(row[activeMetric]))
        .map(row => [row.date, row[activeMetric]]);
      const weekDates = largeMoneyData.series.filter(row => row.date >= minDate).map(row => row.date);
      const indexSeries = indices.filter(index => selectedSeries.has(index.name)).map(index => {
        const baseline = index.rows.find(row => row.date >= baselineDate && Number.isFinite(row.close));
        const baseClose = baseline?.close;
        const closes = new Map(index.rows.filter(row => Number.isFinite(row.close))
          .map(row => [weekEnd(row.date), row.close]));
        return {
          name: index.name, type: "line", yAxisIndex: 1,
          data: weekDates.map(date => [date, baseClose && closes.has(date)
            ? closes.get(date) / baseClose * 100 : null]),
          showSymbol: false, sampling: "lttb",
          lineStyle: { width: 2, color: index.color }, itemStyle: { color: index.color }
        };
      });
      document.getElementById("largeMoneyMetricSubtitle").textContent = cfg.subtitle;
      document.getElementById("largeMoneyMetricNote").textContent = cfg.note;
      document.getElementById("largeMoneyLatestReading").textContent = moneyPoints.length
        ? "资金周标签 " + moneyPoints[0][0] + " 至 " + moneyPoints[moneyPoints.length - 1][0] +
          " · 最新 " + fmt(moneyPoints[moneyPoints.length - 1][1], cfg.digits) + cfg.unit
        : "当前范围暂无资金数据";
      chart.setOption({
        animation: false, backgroundColor: "transparent",
        grid: { left: 80, right: 66, top: 68, bottom: 66 },
        legend: { show: false },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter(params) {
            const lines = params.filter(item => item.value?.[1] != null).map(item => item.marker + item.seriesName + "：<b>" +
              fmt(Number(item.value[1]), item.seriesName === "全市场资金" ? cfg.digits : 1) +
              (item.seriesName === "全市场资金" ? cfg.unit : "") + "</b>");
            return "<b>" + (params[0]?.axisValueLabel || "") + "</b><br>" + lines.join("<br>");
          }
        },
        xAxis: { type: "time", axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false } },
        yAxis: [
          { type: "value", scale: true, axisLabel: { color: "#f6c85f", formatter: "{value}" + cfg.unit },
            splitLine: { lineStyle: { color: "#17283d" } } },
          { type: "value", scale: true, axisLabel: { color: "#8fa5bf", formatter: "{value}" },
            splitLine: { show: false } }
        ],
        dataZoom: [
          { type: "inside", filterMode: "none", start: 0, end: 100 },
          { type: "slider", bottom: 12, height: 22, start: 0, end: 100,
            borderColor: "#263b58", backgroundColor: "#0d1929",
            fillerColor: "rgba(54,194,255,.17)", handleStyle: { color: "#36c2ff" },
            textStyle: { color: "#8fa5bf" } }
        ],
        series: [
          ...(selectedSeries.has("全市场资金") ? [{ name: "全市场资金", type: "line", yAxisIndex: 0, data: moneyPoints,
            showSymbol: false, sampling: "lttb",
            lineStyle: { width: 2, color: "#f6c85f" }, itemStyle: { color: "#f6c85f" } }] : []),
          ...indexSeries
        ]
      }, true);
    }

    document.querySelectorAll("#largeMoneyMetricTabs [data-metric]").forEach(button => {
      button.addEventListener("click", () => {
        activeMetric = button.dataset.metric;
        document.querySelectorAll("#largeMoneyMetricTabs [data-metric]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });
    document.querySelectorAll("#largeMoneySeriesControls [data-series]").forEach(button => {
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
    document.querySelectorAll("#largeMoneyRangeTabs [data-years]").forEach(button => {
      button.addEventListener("click", () => {
        activeYears = Number(button.dataset.years);
        document.querySelectorAll("#largeMoneyRangeTabs [data-years]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });

    window.addEventListener("resize", () => chart.resize());
    renderChart();
  })();
  </script>
`;

if (!fs.existsSync(DATA_FILE)) throw new Error("Missing large_money_sentiment_data.json.");
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
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
const largeMoneyScript = script.replace("__LARGE_MONEY_DATA__", JSON.stringify(data));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", largeMoneyScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
