const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "growth_indices_dashboard.html");
const ROOT_INDEX = path.join(ROOT, "index.html");
const BOARD_START = { sh: "2009-10-30", k50: "2019-07-22", sz: "2019-07-22" };
let END;

function readMarketOverview() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "work", "market_overview_data.json"), "utf8"));
}

function readIndexProfit() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "work", "index_profit_data.json"), "utf8"));
}

function lastByWeek(rows) {
  const result = [];
  let key = "";
  for (const row of rows) {
    const date = new Date(`${row.date}T00:00:00Z`);
    const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.floor((date - first) / 604800000);
    const nextKey = `${date.getUTCFullYear()}-${week}`;
    if (nextKey !== key) {
      result.push(row);
      key = nextKey;
    } else {
      result[result.length - 1] = row;
    }
  }
  if (rows.length && result[0].date !== rows[0].date) result.unshift(rows[0]);
  return result;
}

function attachProfit(rows, profitRows) {
  const result = [];
  let profitIndex = -1;
  for (const row of rows) {
    while (
      profitIndex + 1 < profitRows.length &&
      profitRows[profitIndex + 1].date <= row.date
    ) {
      profitIndex += 1;
    }
    const profit = profitIndex >= 0 ? profitRows[profitIndex] : null;
    result.push({
      ...row,
      profitYi: profit?.profitYi ?? null,
      profitPeriod: profit?.date ?? null,
      profitCoverage: profit?.coverage ?? null,
    });
  }
  return result;
}

function stats(rows) {
  const latest = rows[rows.length - 1];
  const oneYearAgoDate = new Date(`${END}T00:00:00Z`);
  oneYearAgoDate.setUTCFullYear(oneYearAgoDate.getUTCFullYear() - 1);
  const oneYearAgo = rows.find((row) => row.date >= oneYearAgoDate.toISOString().slice(0, 10)) || rows[0];
  const peSorted = rows.map((row) => row.pe).filter(Number.isFinite).sort((a, b) => a - b);
  const rank = Number.isFinite(latest.pe) && peSorted.length
    ? peSorted.filter((value) => value <= latest.pe).length / peSorted.length
    : NaN;
  return {
    ...latest,
    yearChange: (latest.close / oneYearAgo.close - 1) * 100,
    pePercentile: rank * 100,
  };
}

function htmlTemplate(data, echartsSource) {
  const dataJson = JSON.stringify(data);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>XiaoDeng</title>
  <style>
    :root {
      --bg: #081416;
      --panel: #0e2022;
      --panel-2: #13282a;
      --line: #274247;
      --text: #eaf4f2;
      --muted: #91aaa8;
      --sh: #ef7180;
      --sz: #43d6cf;
      --k50: #8bd6a3;
      --accent: #f5c96a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--text);
      background:
        radial-gradient(circle at 15% 0%, rgba(67,214,207,.10), transparent 34%),
        radial-gradient(circle at 90% 8%, rgba(239,113,128,.09), transparent 31%),
        var(--bg);
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    .wrap { max-width: 1540px; margin: 0 auto; padding: 28px 30px 34px; }
    header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; margin-bottom: 24px; }
    .eyebrow { color: var(--accent); font-size: 12px; letter-spacing: .18em; font-weight: 700; }
    h1 { margin: 7px 0 6px; font-size: 30px; line-height: 1.3; }
    .subtitle { color: var(--muted); font-size: 14px; }
    .asof { color: var(--muted); text-align: right; font-size: 13px; line-height: 1.7; }
    .toolbar {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      background: rgba(14,32,34,.88); border: 1px solid var(--line);
      border-radius: 14px 14px 0 0; padding: 12px 15px;
    }
    .ranges { display: flex; gap: 7px; flex-wrap: wrap; }
    button {
      color: var(--muted); background: #183033; border: 1px solid #35545a;
      border-radius: 8px; padding: 7px 12px; cursor: pointer; font-weight: 650;
    }
    button:hover, button.active { color: #081416; background: var(--accent); border-color: var(--accent); }
    .legend { display: flex; flex-wrap: wrap; gap: 17px; color: var(--muted); font-size: 12px; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; }
    .index-charts {
      background: rgba(9,25,27,.95);
      border: 1px solid var(--line); border-top: 0; border-radius: 0 0 14px 14px;
      padding: 0 0 10px;
    }
    .index-chart { height: 390px; }
    .index-chart.volume-chart { height: 290px; }
    .chart-heading { color: var(--text); font-size: 15px; font-weight: 700; margin: 22px 22px 0; }
    .volume-charts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .notes {
      display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; margin-top: 15px;
      color: var(--muted); font-size: 12px; line-height: 1.7;
    }
    .note { border: 1px solid var(--line); background: rgba(14,32,34,.78); border-radius: 12px; padding: 13px 15px; }
    .note strong { color: var(--text); }
    @media (max-width: 1000px) {
      header { align-items: flex-start; flex-direction: column; }
      .asof { text-align: left; }
      .volume-charts { grid-template-columns: 1fr; }
    }
    @media (max-width: 620px) {
      .wrap { padding: 20px 12px 26px; }
      .toolbar { align-items: flex-start; flex-direction: column; }
      .notes { grid-template-columns: 1fr; }
      h1 { font-size: 25px; }
    }
  </style>
</head>
<body>
<main class="wrap">
  <header>
    <div>
      <div class="eyebrow">GROWTH INDICES DASHBOARD</div>
      <h1>成长指数：创业板指、科创50、科创综指</h1>
      <div class="subtitle">创业板指 × 科创50 × 科创综指</div>
    </div>
    <div class="asof">截至 ${END}<br>周频展示，底层数据为交易日数据</div>
  </header>
  <section>
    <div class="toolbar">
      <div class="ranges" aria-label="三个指数共同时间范围">
        <button data-years="1">1年</button>
        <button data-years="3">3年</button>
        <button data-years="5">5年</button>
        <button data-years="10">10年</button>
        <button class="active" data-years="0">全部</button>
      </div>
      <div class="legend">
        <span><i class="dot" style="background:var(--sh)"></i>创业板指</span>
        <span><i class="dot" style="background:var(--k50)"></i>科创50</span>
        <span><i class="dot" style="background:var(--sz)"></i>科创综指</span>
      </div>
    </div>
    <div class="index-charts">
      <h2 class="chart-heading">指数价格</h2>
      <div id="chart-price" class="index-chart"></div>
      <h2 class="chart-heading">交易规模</h2>
      <div class="volume-charts">
        <div id="chart-volume-sh" class="index-chart volume-chart"></div>
        <div id="chart-volume-k50" class="index-chart volume-chart"></div>
        <div id="chart-volume-sz" class="index-chart volume-chart"></div>
      </div>
      <h2 class="chart-heading">市盈率 PE(TTM)</h2><div id="chart-pe" class="index-chart"></div>
      <h2 class="chart-heading">归母净利润 TTM（亿元）</h2><div id="chart-profit" class="index-chart"></div>
    </div>
  </section>
  <section class="notes">
    <div class="note"><strong>采样口径：</strong>价格、交易规模和总览PE按每年1月1日起每7个自然日分组，取组内最后有效交易日，并保留历史起点；并非固定周五。价格是当天收盘价，成交额/成交量是当天单日量，均不是周合计或周平均。科创综指PE按最近一期月度成分快照的总市值/合计TTM归母利润（含亏损）逐日复算，自2025-01-27起有数据；接近Choice口径，但不是Choice原始值。利润底层为季度报告期TTM，按报告期末映射到价格采样点并沿用至下一期；重复展示不代表每周重新披露。报告期末不等于公告日，该历史汇总不是严格按当时已知信息构建的回测序列。</div>
    <div class="note"><strong>利润口径：</strong>真实利润为指数成分股归母净利润 TTM 汇总，单位为亿元；按 Tushare 指数权重表识别当期成分，再汇总这些成分股最近四个季度的归母净利润。最新报告期可能尚未披露完整：创业板覆盖率 ${data.stats.sh.profitCoverage ?? "—"}%，科创综指覆盖率 ${data.stats.sz.profitCoverage ?? "—"}%；未完整披露的汇总不可直接与完整报告期比较。</div>
    <div class="note"><strong>阅读方法：</strong>价格上涨若主要由真实利润上升推动，质量更扎实；若价格快速上涨、利润横盘而PE显著抬升，则主要是估值扩张。虚线标记历史典型顶部窗口，仅用于辅助复盘。</div>
  </section>
</main>
<script>${echartsSource}</script>
<script>
const DATA = ${dataJson};
const COLORS = { sh: "#ef7180", sz: "#43d6cf", k50: "#8bd6a3", volume: "#f5c96a", amount: "#8bd6a3" };
const fmt = (n, digits = 2) => n != null && Number.isFinite(Number(n)) ? Number(n).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "--";
const topDates = [
  { xAxis: "2007-10-16", name: "2007顶" },
  { xAxis: "2009-08-04", name: "2009顶" },
  { xAxis: "2015-06-12", name: "2015顶" },
  { xAxis: "2021-02-18", name: "2021顶" },
];
function points(rows, field) { return rows.map(r => [r.date, r[field] != null && Number.isFinite(Number(r[field])) ? r[field] : null]); }
function series(name, rows, field, xAxisIndex, yAxisIndex, color, withMarks = false) {
  return {
    name, type: "line", xAxisIndex, yAxisIndex, data: points(rows, field),
    showSymbol: false, sampling: "lttb", smooth: false,
    lineStyle: { width: 1.8, color }, itemStyle: { color },
    emphasis: { focus: "series", lineStyle: { width: 3 } },
    markLine: withMarks ? {
      symbol: ["none", "none"], silent: true,
      label: { color: "#91aaa8", fontSize: 10, formatter: p => p.name },
      lineStyle: { color: "#53657d", type: "dashed", width: 1 },
      data: topDates
    } : undefined
  };
}
function scaleSeries(name, rows, field, xAxisIndex, yAxisIndex, color) {
  return {
    name, type: "line", xAxisIndex, yAxisIndex, data: points(rows, field),
    showSymbol: false, sampling: "lttb", smooth: false,
    lineStyle: { width: 1.7, color }, itemStyle: { color },
    emphasis: { focus: "series", lineStyle: { width: 2.8 } }
  };
}
const commonAxis = {
  type: "time", axisLine: { lineStyle: { color: "#344760" } },
  axisLabel: { color: "#789b98", hideOverlap: true },
  splitLine: { show: false }, axisPointer: { show: true }
};
function chartOption(lines, { volume = false, title = "", unit = "", disableInside = false } = {}) {
  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: volume ? 54 : 72, right: volume ? 58 : 32, top: volume ? 50 : 55, bottom: 58 },
    title: title ? { text: title, left: 20, top: 12, textStyle: { color: "#eaf4f2", fontSize: 13 } } : undefined,
    tooltip: {
      trigger: "axis", axisPointer: { type: "cross" },
      backgroundColor: "rgba(8,20,22,.96)", borderColor: "#3c625f", textStyle: { color: "#eaf4f2" },
      formatter(params) {
        const date = params[0]?.axisValueLabel || "";
        return "<b>" + date + "</b><br>" + params.filter(p => p.value?.[1] != null)
          .map(p => p.marker + p.seriesName + "：<b>" + fmt(p.value[1]) + "</b>").join("<br>");
      }
    },
    legend: volume ? { top: 13, right: 12, textStyle: { color: "#91aaa8" }, data: lines.map(line => line.name) }
      : { top: 12, left: 20, type: "scroll", textStyle: { color: "#91aaa8" }, data: lines.map(line => line.name) },
    xAxis: { ...commonAxis, min: "${BOARD_START.sh}" },
    yAxis: volume ? [
      { type: "value", scale: true, name: "亿手", axisLabel: { color: "#789b98" }, splitLine: { lineStyle: { color: "#1b3737" } } },
      { type: "value", scale: true, name: "亿元", opposite: true, axisLabel: { color: "#789b98" }, splitLine: { show: false } }
    ] : { type: "value", scale: true, name: unit, axisLabel: { color: "#789b98" }, splitLine: { lineStyle: { color: "#1b3737" } } },
    dataZoom: [
      { type: "slider", bottom: 8, height: 20, borderColor: "#35545a", backgroundColor: "#0e2022",
        fillerColor: "rgba(246,200,95,.18)", handleStyle: { color: "#f5c96a" },
        textStyle: { color: "#91aaa8" }, start: 0, end: 100 }
    ],
    series: lines.map(line => ({ ...series(line.name, line.rows, line.field, 0, line.axis || 0, line.color),
      markLine: line.marks ? series(line.name, line.rows, line.field, 0, 0, line.color, true).markLine : undefined }))
  };
}

const chartConfigs = [
  ["chart-price", [
    { name: "创业板指", rows: DATA.sh, field: "close", color: COLORS.sh, marks: true },
    { name: "科创50", rows: DATA.k50, field: "close", color: COLORS.k50 },
    { name: "科创综指", rows: DATA.sz, field: "close", color: COLORS.sz }
  ], { unit: "点", disableInside: true }],
  ["chart-pe", [
    { name: "创业板指 PE", rows: DATA.sh, field: "pe", color: COLORS.sh },
    { name: "科创50 PE", rows: DATA.k50, field: "pe", color: COLORS.k50 },
    { name: "科创综指 PE · 整体法", rows: DATA.overviewPe.sz, field: "pe", color: COLORS.sz }
  ], { unit: "倍" }],
  ["chart-profit", [
    { name: "创业板指利润", rows: DATA.sh, field: "profitYi", color: COLORS.sh },
    { name: "科创综指利润", rows: DATA.sz, field: "profitYi", color: COLORS.sz }
  ], { unit: "亿元" }]
];
for (const [key, name, rows] of [
  ["sh", "创业板指", DATA.sh], ["k50", "科创50", DATA.k50], ["sz", "科创综指", DATA.sz]
]) {
  chartConfigs.push(["chart-volume-" + key, [
    { name: "成交量", rows, field: "volumeYiShou", color: COLORS.volume },
    { name: "成交额", rows, field: "amountYi", color: COLORS.amount, axis: 1 }
  ], { volume: true, title: name }]);
}
const charts = chartConfigs.map(([id, lines, options]) => {
  const chart = echarts.init(document.getElementById(id), null, { renderer: "canvas" });
  chart.setOption(chartOption(lines, options));
  return chart;
});

function applySharedRange(years) {
  const end = new Date("${END}T00:00:00Z");
  const start = new Date(end);
  if (years) start.setUTCFullYear(start.getUTCFullYear() - years);
  const startValue = years ? start.toISOString().slice(0, 10) : "${BOARD_START.sh}";
  const endValue = "${END}";
  charts.forEach(chart => {
    chart.dispatchAction({
      type: "dataZoom",
      dataZoomIndex: 0,
      startValue,
      endValue
    });
    chart.dispatchAction({
      type: "dataZoom",
      dataZoomIndex: 1,
      startValue,
      endValue
    });
  });
}

document.querySelectorAll(".ranges [data-years]").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".ranges [data-years]").forEach(b => b.classList.toggle("active", b === btn));
  applySharedRange(Number(btn.dataset.years));
}));
applySharedRange(0);
window.addEventListener("resize", () => charts.forEach(chart => chart.resize()));
</script>
</body>
</html>`;
}

async function main() {
  const { refreshMode, runRefresh } = require("./refresh_dashboard_data");
  await runRefresh(refreshMode());
  const overview = readMarketOverview();
  END = overview.meta.end;
  const profit = readIndexProfit();
  const sh = lastByWeek(attachProfit(overview.sh, profit.sh));
  const sz = lastByWeek(attachProfit(overview.sz, profit.sz));
  const k50 = lastByWeek(overview.k50);
  const official = JSON.parse(fs.readFileSync(path.join(ROOT, "work", "star_official_valuation.json"), "utf8"));
  const officialHistory = JSON.parse(fs.readFileSync(path.join(ROOT, "work", "star_official_history.json"), "utf8"));
  const starAggregate = JSON.parse(fs.readFileSync(path.join(ROOT, "work", "star_aggregate_pe.json"), "utf8"));
  const echartsSource = fs.readFileSync(path.join(ROOT, "work", "echarts.min.js"), "utf8");
  const data = { sh, sz, k50, official, officialHistory, starAggregate,
    overviewPe: { sz: lastByWeek(starAggregate.rows) },
    officialOverviewPe: { sz: lastByWeek(officialHistory.rows) },
    valuationPeDaily: { sh: overview.sh, k50: overview.k50, sz: starAggregate.rows },
    stats: { sh: stats(sh), sz: stats(sz), k50: stats(k50) } };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, htmlTemplate(data, echartsSource), "utf8");
  require("./add_valuation_module");
  require("./add_retail_sentiment_module");
  require("./add_large_money_sentiment_module");
  require("./add_official_sentiment_module");
  fs.writeFileSync(OUTPUT, require("./dashboard_interactions").enhance(fs.readFileSync(OUTPUT, "utf8")));
  fs.copyFileSync(OUTPUT, ROOT_INDEX);
  console.log(JSON.stringify({
    output: OUTPUT,
    rootIndex: ROOT_INDEX,
    bytes: fs.statSync(OUTPUT).size,
    shPoints: sh.length,
    szPoints: sz.length,
    shLatest: data.stats.sh,
    szLatest: data.stats.sz,
  }, null, 2));
}

require("./refresh_dashboard_data").withRefreshLock(main).catch((error) => {
  console.error(error);
  process.exit(1);
});
