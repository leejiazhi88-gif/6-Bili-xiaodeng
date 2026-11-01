const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "growth_indices_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "large_money_sentiment_data.json");
const INDEX_DATA_FILE = path.join(ROOT, "work", "large_money_index_data.json");
const FUND_REPORTS_FILE = path.join(ROOT, "work", "large_money_fund_reports.json");
const ETF_SHARES_FILE = path.join(ROOT, "work", "large_money_etf_shares.json");

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
        <button class="metric-tab" data-metric="fundPosition">主动权益基金仓位</button>
        <button class="metric-tab" data-metric="institutionConcentration">机构持仓集中度</button>
        <button class="metric-tab" data-metric="etfShares">ETF份额</button>
      </div>
      <div class="metric-note">
        <span id="largeMoneyMetricNote"></span>
        <span class="metric-reading" id="largeMoneyLatestReading"></span>
      </div>
      <div id="largeMoneyChart"></div>
    </article>

    <div class="valuation-foot">
      <div class="note"><strong>图表口径：</strong>前三个页签的四条线均为真实金额（亿元），三个指数按交易或公告当期最近一次公布的成分股名单归集，不按指数权重折算；同一股票可能同时属于多个指数。北向资金页签仍为全市场净流入金额与三个指数价格相对走势的双轴对照。所有曲线按周六标记所属周，周六不代表当天交易。</div>
      <div class="note"><strong>数据口径：</strong>大宗交易仅统计 A 股股票，排除债券等其他证券；机构净买入仅识别买卖方标记为“机构专用”的席位。产业资本净增减持按公告日汇总有成交均价的增减持股数乘以均价；正值为净增持金额，负值为净减持金额。指数成分名单未公布的历史不补造。</div>
      <div class="note"><strong>北向口径提示：</strong>北向净流入序列保留至2024年8月16日。此后披露机制发生变化，页面不把新口径成交数据与旧口径净流入强行拼接。</div>
      <div class="note"><strong>基金与ETF口径：</strong>基金仓位、集中度取半年报及年报中股票持仓披露不少于90%的主动股票/混合基金样本；样本覆盖不足40%的报告期不展示。仓位为样本股票市值/样本净资产；三个指数分别表示样本净资产配置到相应成分股的比例。集中度为样本在相应股票范围内持仓金额前10名股票占该范围持仓总额的比例。ETF份额为跟踪这三个指数的ETF存量份额，首条线仅为三组ETF合计，不是全市场所有ETF；定期报告与ETF周度份额不可当作实时资金流。</div>
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
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const metrics = {
      blockAmount: {
        title: "大宗交易额", field: "blockAmount", unit: "亿元", digits: 1,
        subtitle: "全市场与三个指数成分股的周大宗交易额",
        note: "大宗交易放量代表大额筹码交换活跃，需要结合机构席位净方向判断。"
      },
      institutionBlockNet: {
        title: "机构大宗净买入", field: "institutionBlockNet", unit: "亿元", digits: 1,
        subtitle: "全市场与三个指数成分股的机构席位周净买入额",
        note: "正值表示机构席位净买入，负值表示净卖出。"
      },
      holderNetShares: {
        title: "产业资本净增减持", field: "holderNetAmount", unit: "亿元", digits: 2,
        subtitle: "全市场与三个指数成分股的周净增减持金额",
        note: "按公告日汇总股数×披露均价；正值为净增持，负值为净减持。"
      },
      northMoney: {
        title: "北向资金净流入", field: "northMoney", unit: "亿元", digits: 1,
        subtitle: "全市场北向净流入与三个指数价格走势（右轴），资金止于2024-08-16",
        note: "披露机制变化后不再与旧口径拼接，指数线仍延伸至最新交易日。"
      },
      fundPosition: {
        title: "主动权益基金仓位", field: "position", unit: "%", digits: 2,
        subtitle: "主动股票/混合基金半年报样本股票仓位与指数成分配置",
        note: "半年报/年报实际披露点；指数线是样本净资产投向该指数成分股的比例，并非指数本身的仓位。",
        totalLabel: "主动基金样本"
      },
      institutionConcentration: {
        title: "机构持仓集中度", field: "concentration", unit: "%", digits: 2,
        subtitle: "主动基金样本在各股票范围内的前10名持仓集中度",
        note: "半年报/年报实际披露点；前10名股票持仓额/该范围全部样本持仓额。",
        totalLabel: "主动基金样本"
      },
      etfShares: {
        title: "ETF份额", field: "total", unit: "亿份", digits: 2,
        subtitle: "跟踪三个指数的ETF期末存量份额",
        note: "周度实际份额存量；首条线仅为三组跟踪ETF合计，不等同于全市场ETF。",
        totalLabel: "三指数ETF合计"
      }
    };
    const baselineDate = "2020-01-07";
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
      const priceMode = activeMetric === "northMoney";
      const fundMode = activeMetric === "fundPosition" || activeMetric === "institutionConcentration";
      const etfMode = activeMetric === "etfShares";
      const moneyName = cfg.totalLabel || "全市场资金";
      const sourceRows = fundMode ? fundReports.series : etfMode ? etfShares.series : largeMoneyData.series;
      const valueOf = (row, key) => fundMode ? row[key]?.[cfg.field]
        : etfMode ? row[key === "total" ? "total" : key] : row[cfg.field];
      const available = row => !fundMode || row.coverage >= 40;
      const moneyPoints = sourceRows
        .filter(row => row.date >= minDate && available(row) && Number.isFinite(valueOf(row, "total")))
        .map(row => [row.date, valueOf(row, "total")]);
      const latestReport = fundMode && moneyPoints.length
        ? sourceRows.find(row => row.date === moneyPoints[moneyPoints.length - 1][0]) : null;
      const weekDates = largeMoneyData.series.filter(row => row.date >= minDate).map(row => row.date);
      const indexSeries = indices.filter(index => selectedSeries.has(index.name)).map(index => {
        let values;
        if (priceMode) {
          const baseline = index.rows.find(row => row.date >= baselineDate && Number.isFinite(row.close));
          const baseClose = baseline?.close;
          const closes = new Map(index.rows.filter(row => Number.isFinite(row.close))
            .map(row => [weekEnd(row.date), row.close]));
          values = weekDates.map(date => [date, baseClose && closes.has(date)
            ? closes.get(date) / baseClose * 100 : null]);
        } else if (fundMode || etfMode) {
          values = sourceRows.filter(row => row.date >= minDate)
            .map(row => [row.date, available(row) && Number.isFinite(valueOf(row, index.key))
              ? valueOf(row, index.key) : null]);
        } else {
          const amounts = new Map(indexMoneyData[index.key].map(row => [row.date, row[cfg.field]]));
          values = weekDates.map(date => [date, amounts.has(date) ? amounts.get(date) : null]);
        }
        return {
          name: index.name, type: "line", yAxisIndex: priceMode ? 1 : 0,
          data: values,
          showSymbol: fundMode, symbolSize: 5, sampling: "lttb",
          lineStyle: { width: 2, color: index.color }, itemStyle: { color: index.color }
        };
      });
      document.getElementById("largeMoneyMetricSubtitle").textContent = cfg.subtitle;
      document.getElementById("largeMoneyMetricNote").textContent = cfg.note;
      const totalButton = document.querySelector('#largeMoneySeriesControls [data-series="全市场资金"]');
      totalButton.lastChild.textContent = moneyName;
      totalButton.setAttribute("aria-label", moneyName);
      document.getElementById("largeMoneyLatestReading").textContent = moneyPoints.length
        ? (fundMode ? "报告期 " : "周标签 ") + moneyPoints[0][0] + " 至 " + moneyPoints[moneyPoints.length - 1][0] +
          " · 最新 " + fmt(moneyPoints[moneyPoints.length - 1][1], cfg.digits) + cfg.unit +
          (latestReport ? " · 样本 " + latestReport.funds + " 只 / 覆盖 " + latestReport.coverage + "%" : "")
        : "当前范围暂无资金数据";
      chart.setOption({
        animation: false, backgroundColor: "transparent",
        grid: { left: 80, right: priceMode ? 66 : 28, top: 26, bottom: 66 },
        legend: { show: false },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter(params) {
            const lines = params.filter(item => item.value?.[1] != null).map(item => item.marker + item.seriesName + "：<b>" +
              fmt(Number(item.value[1]), priceMode && item.seriesName !== moneyName ? 1 : cfg.digits) +
              (priceMode && item.seriesName !== moneyName ? "（基准=100）" : cfg.unit) + "</b>");
            if (fundMode) {
              const reportDate = params.find(item => item.value?.[0])?.value[0];
              const report = sourceRows.find(row => row.date === reportDate);
              if (report) lines.push("样本 " + report.funds + " 只 / 覆盖 " + report.coverage + "%");
            }
            return "<b>" + (params[0]?.axisValueLabel || "") + "</b><br>" + lines.join("<br>");
          }
        },
        xAxis: { type: "time", axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false } },
        yAxis: [
          { type: "value", scale: true, axisLabel: { color: priceMode ? "#f6c85f" : "#8fa5bf", formatter: "{value}" + cfg.unit },
            splitLine: { lineStyle: { color: "#17283d" } } },
          { type: "value", scale: true, show: priceMode, axisLabel: { color: "#8fa5bf", formatter: "{value}" },
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
          ...(selectedSeries.has("全市场资金") ? [{ name: moneyName, type: "line", yAxisIndex: 0, data: moneyPoints,
            showSymbol: fundMode, symbolSize: 5, sampling: "lttb",
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
if (!fs.existsSync(INDEX_DATA_FILE)) throw new Error("Missing large_money_index_data.json.");
if (!fs.existsSync(FUND_REPORTS_FILE)) throw new Error("Missing large_money_fund_reports.json.");
if (!fs.existsSync(ETF_SHARES_FILE)) throw new Error("Missing large_money_etf_shares.json.");
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const indexData = JSON.parse(fs.readFileSync(INDEX_DATA_FILE, "utf8"));
const fundReports = JSON.parse(fs.readFileSync(FUND_REPORTS_FILE, "utf8"));
const etfShares = JSON.parse(fs.readFileSync(ETF_SHARES_FILE, "utf8"));
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
  .replace("__ETF_SHARES__", JSON.stringify(etfShares));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", largeMoneyScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
