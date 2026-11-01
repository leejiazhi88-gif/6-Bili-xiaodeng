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
  <title>成长指数：创业板指、科创50、科创综指与估值</title>
  <style>
    :root {
      --bg: #07111f;
      --panel: #0d1929;
      --panel-2: #101f32;
      --line: #203149;
      --text: #edf4ff;
      --muted: #8fa5bf;
      --sh: #ff5d73;
      --sz: #36c2ff;
      --k50: #7ddc82;
      --accent: #f6c85f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--text);
      background:
        radial-gradient(circle at 15% 0%, rgba(54,194,255,.11), transparent 34%),
        radial-gradient(circle at 90% 8%, rgba(255,93,115,.10), transparent 31%),
        var(--bg);
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    .wrap { max-width: 1540px; margin: 0 auto; padding: 28px 30px 34px; }
    header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; }
    .eyebrow { color: var(--accent); font-size: 12px; letter-spacing: .18em; font-weight: 700; }
    h1 { margin: 7px 0 6px; font-size: 30px; line-height: 1.3; }
    .subtitle { color: var(--muted); font-size: 14px; }
    .asof { color: var(--muted); text-align: right; font-size: 13px; line-height: 1.7; }
    .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 24px 0 16px; }
    .card {
      background: linear-gradient(145deg, rgba(16,31,50,.98), rgba(10,22,37,.98));
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 15px 16px;
      min-height: 92px;
    }
    .card .label { color: var(--muted); font-size: 12px; margin-bottom: 9px; }
    .card .value { font-size: 24px; font-weight: 750; letter-spacing: 0; }
    .card .meta { color: var(--muted); font-size: 11px; margin-top: 5px; }
    .sh { color: var(--sh); } .sz { color: var(--sz); }
    .k50 { color: var(--k50); }
    .source-summary { color: var(--muted); font-size: 12px; line-height: 1.8; margin: 0 0 16px; overflow-wrap: anywhere; }
    .timeline-summary { color: var(--muted); font-size: 12px; line-height: 1.8; margin: 0 0 12px; }
    .timeline-summary strong { color: var(--text); }
    .timeline-summary a { color: var(--sz); }
    .source-summary a { color: var(--sz); }
    .toolbar {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      background: rgba(13,25,41,.86); border: 1px solid var(--line);
      border-radius: 14px 14px 0 0; padding: 12px 15px;
    }
    .ranges { display: flex; gap: 7px; flex-wrap: wrap; }
    button {
      color: var(--muted); background: #132239; border: 1px solid #263b58;
      border-radius: 8px; padding: 7px 12px; cursor: pointer; font-weight: 650;
    }
    button:hover, button.active { color: #07111f; background: var(--accent); border-color: var(--accent); }
    .legend { display: flex; flex-wrap: wrap; gap: 17px; color: var(--muted); font-size: 12px; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; }
    .index-charts {
      background: rgba(9,20,34,.94);
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
    .note { border: 1px solid var(--line); background: rgba(13,25,41,.75); border-radius: 12px; padding: 13px 15px; }
    .note strong { color: var(--text); }
    @media (max-width: 1000px) {
      .cards { grid-template-columns: repeat(3, 1fr); }
      header { align-items: flex-start; flex-direction: column; }
      .asof { text-align: left; }
      .volume-charts { grid-template-columns: 1fr; }
    }
    @media (max-width: 620px) {
      .wrap { padding: 20px 12px 26px; }
      .cards { grid-template-columns: repeat(2, 1fr); }
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
  <section class="cards" id="cards"></section>
  <div class="source-summary">
    科创50估值：<a href="https://tushare.pro/document/2?doc_id=128" target="_blank" rel="noopener">Tushare</a> · ${data.stats.k50.date}。
    科创综指估值：<a href="${data.officialHistory.meta.sourceUrl}" target="_blank" rel="noopener">中证指数官方历史行情</a> · ${data.officialHistory.rows[0].date} 起有 PE(TTM)，最新 ${data.officialHistory.rows.at(-1).date}；与 Tushare 估值口径不同，不直接横向比较。<a href="${data.official.meta.sourceUrl}" target="_blank" rel="noopener">官方单张</a>用于交叉核对。
  </div>
  <div class="timeline-summary">
    <strong>板块起点与指数起点：</strong>
    <a href="https://www.szse.cn/aboutus/trends/news/t20091102_517893.html" target="_blank" rel="noopener">创业板开市</a> ${BOARD_START.sh}，创业板指行情始于 ${data.sh[0].date}；
    <a href="https://www.sse.com.cn/aboutus/mediacenter/hotandd/c/c_20190705_4858654.shtml" target="_blank" rel="noopener">科创板开市</a> ${BOARD_START.k50}，科创50、科创综指行情始于 ${data.k50[0].date}。开市日至指数基日期间没有这三个指数的价格数据。
  </div>
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
    <div class="note"><strong>利润口径：</strong>真实利润为指数成分股归母净利润 TTM 汇总，单位为亿元；按 Tushare 指数权重表识别当期成分，再汇总这些成分股最近四个季度的归母净利润。最新报告期可能尚未披露完整：创业板覆盖率 ${data.stats.sh.profitCoverage ?? "—"}%，科创综指覆盖率 ${data.stats.sz.profitCoverage ?? "—"}%；未完整披露的汇总不可直接与完整报告期比较。</div>
    <div class="note"><strong>阅读方法：</strong>价格上涨若主要由真实利润上升推动，质量更扎实；若价格快速上涨、利润横盘而PE显著抬升，则主要是估值扩张。虚线标记历史典型顶部窗口，仅用于辅助复盘。</div>
  </section>
</main>
<script>${echartsSource}</script>
<script>
const DATA = ${dataJson};
const COLORS = { sh: "#ff5d73", sz: "#36c2ff", k50: "#7ddc82", volume: "#f6c85f", amount: "#7ddc82" };
const fmt = (n, digits = 2) => n != null && Number.isFinite(Number(n)) ? Number(n).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "--";
const signed = (n) => Number.isFinite(Number(n)) ? (n >= 0 ? "+" : "") + fmt(n, 1) + "%" : "--";
const cards = [
  ["创业板指", fmt(DATA.stats.sh.close), "近1年 " + signed(DATA.stats.sh.yearChange), "sh"],
  ["创业板PE(TTM)", fmt(DATA.stats.sh.pe), "样本分位 " + fmt(DATA.stats.sh.pePercentile, 0) + "%", "sh"],
  ["创业板真实利润", fmt(DATA.stats.sh.profitYi), "归母净利润TTM，亿元", "sh"],
  ["科创50", fmt(DATA.stats.k50.close), "Tushare · " + DATA.stats.k50.date, "k50"],
  ["科创50 PE(TTM)", fmt(DATA.stats.k50.pe), "Tushare · " + DATA.stats.k50.date, "k50"],
  ["科创综指", fmt(DATA.stats.sz.close), "近1年 " + signed(DATA.stats.sz.yearChange), "sz"],
  ["科创综指PE(TTM)", fmt(DATA.officialHistory.rows.at(-1).pe), "中证指数 · " + DATA.officialHistory.rows.at(-1).date, "sz"],
  ["科创综指真实利润", fmt(DATA.stats.sz.profitYi), "归母净利润TTM，亿元", "sz"],
];
document.getElementById("cards").innerHTML = cards.map(([label, value, meta, cls]) =>
  '<article class="card"><div class="label">' + label + '</div><div class="value ' + cls + '">' + value +
  '</div><div class="meta">' + meta + '</div></article>'
).join("");

const topDates = [
  { xAxis: "2007-10-16", name: "2007顶" },
  { xAxis: "2009-08-04", name: "2009顶" },
  { xAxis: "2015-06-12", name: "2015顶" },
  { xAxis: "2018-01-29", name: "2018顶" },
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
      label: { color: "#8fa5bf", fontSize: 10, formatter: p => p.name },
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
  axisLabel: { color: "#7890aa", hideOverlap: true },
  splitLine: { show: false }, axisPointer: { show: true }
};
function chartOption(lines, { volume = false, title = "", unit = "" } = {}) {
  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: volume ? 54 : 72, right: volume ? 58 : 32, top: volume ? 50 : 55, bottom: 58 },
    title: title ? { text: title, left: 20, top: 12, textStyle: { color: "#edf4ff", fontSize: 13 } } : undefined,
    tooltip: {
      trigger: "axis", axisPointer: { type: "cross" },
      backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f", textStyle: { color: "#edf4ff" },
      formatter(params) {
        const date = params[0]?.axisValueLabel || "";
        return "<b>" + date + "</b><br>" + params.filter(p => p.value?.[1] != null)
          .map(p => p.marker + p.seriesName + "：<b>" + fmt(p.value[1]) + "</b>").join("<br>");
      }
    },
    legend: volume ? { top: 13, right: 12, textStyle: { color: "#8fa5bf" }, data: lines.map(line => line.name) }
      : { top: 12, left: 20, type: "scroll", textStyle: { color: "#8fa5bf" }, data: lines.map(line => line.name) },
    xAxis: { ...commonAxis, min: "${BOARD_START.sh}" },
    yAxis: volume ? [
      { type: "value", scale: true, name: "亿手", axisLabel: { color: "#7890aa" }, splitLine: { lineStyle: { color: "#17283d" } } },
      { type: "value", scale: true, name: "亿元", opposite: true, axisLabel: { color: "#7890aa" }, splitLine: { show: false } }
    ] : { type: "value", scale: true, name: unit, axisLabel: { color: "#7890aa" }, splitLine: { lineStyle: { color: "#17283d" } } },
    dataZoom: [
      { type: "inside", filterMode: "none", start: 0, end: 100 },
      { type: "slider", bottom: 8, height: 20, borderColor: "#263b58", backgroundColor: "#0d1929",
        fillerColor: "rgba(246,200,95,.18)", handleStyle: { color: "#f6c85f" },
        textStyle: { color: "#8fa5bf" }, start: 0, end: 100 }
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
  ], { unit: "点" }],
  ["chart-pe", [
    { name: "创业板指 PE", rows: DATA.sh, field: "pe", color: COLORS.sh },
    { name: "科创50 PE", rows: DATA.k50, field: "pe", color: COLORS.k50 },
    { name: "科创综指 PE · 中证指数", rows: DATA.officialHistory.rows, field: "pe", color: COLORS.sz }
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
  if (!process.argv.includes("--cached")) {
  const { execFileSync, spawnSync } = require("child_process");
  const candidates = [
    process.env.CODEX_PYTHON,
    process.env.PYTHON,
    "python3",
    "python",
  ].filter(Boolean);
  const python = candidates.find((cmd) =>
    spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0
  );
  if (!python) {
    throw new Error("Unable to find a usable Python interpreter");
  }
  try {
    execFileSync(python, [path.join(ROOT, "work", "fetch_market_overview_data.py")], {
      stdio: "inherit",
    });
    execFileSync(python, [path.join(ROOT, "work", "fetch_star_official_valuation.py")], {
      stdio: "inherit",
    });
    execFileSync(python, [path.join(ROOT, "work", "fetch_star_official_history.py")], {
      stdio: "inherit",
    });
    execFileSync(python, [path.join(ROOT, "work", "fetch_index_profit_data.py")], {
      stdio: "inherit",
    });
    execFileSync(python, [path.join(ROOT, "work", "fetch_official_sentiment_data.py")], {
      stdio: "inherit",
    });
    execFileSync(python, [path.join(ROOT, "work", "fetch_retail_sentiment_data.py")], {
      stdio: "inherit",
    });
    execFileSync(python, [path.join(ROOT, "work", "fetch_retail_index_metrics.py")], {
      stdio: "inherit",
    });
    execFileSync(python, [path.join(ROOT, "work", "fetch_large_money_sentiment_data.py")], {
      stdio: "inherit",
    });
    execFileSync(python, [path.join(ROOT, "work", "fetch_valuation_data.py")], {
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error("Data refresh failed; page generation stopped. Use --cached explicitly to rebuild cached data.", { cause: error });
  }
  }
  const overview = readMarketOverview();
  END = overview.meta.end;
  const profit = readIndexProfit();
  const sh = lastByWeek(attachProfit(overview.sh, profit.sh));
  const sz = lastByWeek(attachProfit(overview.sz, profit.sz));
  const k50 = lastByWeek(overview.k50);
  const official = JSON.parse(fs.readFileSync(path.join(ROOT, "work", "star_official_valuation.json"), "utf8"));
  const officialHistory = JSON.parse(fs.readFileSync(path.join(ROOT, "work", "star_official_history.json"), "utf8"));
  const echartsSource = fs.readFileSync(path.join(ROOT, "work", "echarts.min.js"), "utf8");
  const data = { sh, sz, k50, official, officialHistory, stats: { sh: stats(sh), sz: stats(sz), k50: stats(k50) } };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, htmlTemplate(data, echartsSource), "utf8");
  require("./add_valuation_module");
  require("./add_retail_sentiment_module");
  require("./add_large_money_sentiment_module");
  require("./add_official_sentiment_module");
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
