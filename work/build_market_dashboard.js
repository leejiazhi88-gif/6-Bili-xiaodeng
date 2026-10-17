const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "growth_indices_dashboard.html");
const ROOT_INDEX = path.join(ROOT, "index.html");
const START = "2010-06-01";
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
  <title>成长指数：创业板指、科创综指与估值</title>
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
    h1 { margin: 7px 0 6px; font-size: clamp(25px, 3vw, 42px); line-height: 1.1; }
    .subtitle { color: var(--muted); font-size: 14px; }
    .asof { color: var(--muted); text-align: right; font-size: 13px; line-height: 1.7; }
    .cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin: 24px 0 16px; }
    .card {
      background: linear-gradient(145deg, rgba(16,31,50,.98), rgba(10,22,37,.98));
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 15px 16px;
      min-height: 92px;
    }
    .card .label { color: var(--muted); font-size: 12px; margin-bottom: 9px; }
    .card .value { font-size: 24px; font-weight: 750; letter-spacing: -.02em; }
    .card .meta { color: var(--muted); font-size: 11px; margin-top: 5px; }
    .sh { color: var(--sh); } .sz { color: var(--sz); }
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
    .legend { display: flex; gap: 17px; color: var(--muted); font-size: 12px; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; }
    .index-charts {
      background: rgba(9,20,34,.94);
      border: 1px solid var(--line); border-top: 0; border-radius: 0 0 14px 14px;
      padding: 0 0 10px;
    }
    .index-chart {
      height: min(760px, calc(100vh - 210px));
      min-height: 620px;
    }
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
      .index-chart { height: 720px; }
    }
    @media (max-width: 620px) {
      .wrap { padding: 20px 12px 26px; }
      .cards { grid-template-columns: repeat(2, 1fr); }
      .toolbar { align-items: flex-start; flex-direction: column; }
      .notes { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
<main class="wrap">
  <header>
    <div>
      <div class="eyebrow">GROWTH INDICES DASHBOARD</div>
      <h1>成长指数：创业板指、科创综指与估值</h1>
      <div class="subtitle">创业板指 × 科创综指，共享同一时间横轴</div>
    </div>
    <div class="asof">数据区间：${START} 至 ${END}<br>周频展示，底层数据为交易日数据</div>
  </header>
  <section class="cards" id="cards"></section>
  <section>
    <div class="toolbar">
      <div class="ranges" aria-label="创业板指与科创综指共同时间范围">
        <button data-years="1">1年</button>
        <button data-years="3">3年</button>
        <button data-years="5">5年</button>
        <button data-years="10">10年</button>
        <button class="active" data-years="20">20年</button>
      </div>
      <div class="legend">
        <span><i class="dot" style="background:var(--sh)"></i>创业板指</span>
        <span><i class="dot" style="background:var(--sz)"></i>科创综指</span>
      </div>
    </div>
    <div class="index-charts">
      <div id="chart-sh" class="index-chart"></div>
      <div id="chart-sz" class="index-chart"></div>
    </div>
  </section>
  <section class="notes">
    <div class="note"><strong>利润口径：</strong>真实利润为指数成分股归母净利润 TTM 汇总，单位为亿元；按 Tushare 指数权重表识别当期成分，再汇总这些成分股最近四个季度的归母净利润。</div>
    <div class="note"><strong>阅读方法：</strong>价格上涨若主要由真实利润上升推动，质量更扎实；若价格快速上涨、利润横盘而PE显著抬升，则主要是估值扩张。虚线标记历史典型顶部窗口，仅用于辅助复盘。</div>
  </section>
</main>
<script>${echartsSource}</script>
<script>
const DATA = ${dataJson};
const COLORS = { sh: "#ff5d73", sz: "#36c2ff", volume: "#f6c85f", amount: "#7ddc82" };
const fmt = (n, digits = 2) => Number.isFinite(Number(n)) ? Number(n).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "--";
const signed = (n) => Number.isFinite(Number(n)) ? (n >= 0 ? "+" : "") + fmt(n, 1) + "%" : "--";
const cards = [
  ["创业板指", fmt(DATA.stats.sh.close), "近1年 " + signed(DATA.stats.sh.yearChange), "sh"],
  ["创业板PE(TTM)", fmt(DATA.stats.sh.pe), "样本分位 " + fmt(DATA.stats.sh.pePercentile, 0) + "%", "sh"],
  ["创业板真实利润", fmt(DATA.stats.sh.profitYi), "归母净利润TTM，亿元", "sh"],
  ["科创综指", fmt(DATA.stats.sz.close), "近1年 " + signed(DATA.stats.sz.yearChange), "sz"],
  ["科创综指PE(TTM)", fmt(DATA.stats.sz.pe), "Tushare暂无序列", "sz"],
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
function points(rows, field) { return rows.map(r => [r.date, Number.isFinite(Number(r[field])) ? r[field] : null]); }
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
function chartOption(title, rows, color) {
  return {
    animation: false,
    backgroundColor: "transparent",
    grid: [
      { left: 72, right: 78, top: 58, height: "21%" },
      { left: 72, right: 78, top: "33%", height: "18%" },
      { left: 72, right: 78, top: "57%", height: "16%" },
      { left: 72, right: 78, top: "80%", height: "12%" }
    ],
    title: [
      { text: title, left: 20, top: 12, textStyle: { color, fontSize: 16, fontWeight: 750 } },
      { text: "指数价格", left: 20, top: 36, textStyle: { color: "#edf4ff", fontSize: 12 } },
      { text: "交易规模", left: 20, top: "30%", textStyle: { color: "#edf4ff", fontSize: 12 } },
      { text: "市盈率 PE(TTM)", left: 20, top: "54%", textStyle: { color: "#edf4ff", fontSize: 12 } },
      { text: "归母净利润TTM（亿元）", left: 20, top: "77%", textStyle: { color: "#edf4ff", fontSize: 12 } }
    ],
    tooltip: {
      trigger: "axis", axisPointer: { type: "cross", link: [{ xAxisIndex: "all" }] },
      backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f", textStyle: { color: "#edf4ff" },
      formatter(params) {
        const date = params[0]?.axisValueLabel || "";
        const lines = params.map(p => p.marker + p.seriesName + "：<b>" + fmt(p.value[1]) + "</b>");
        return "<b>" + date + "</b><br>" + lines.join("<br>");
      }
    },
    legend: {
      right: 22, top: "29%", textStyle: { color: "#8fa5bf", fontSize: 11 },
      itemWidth: 14, itemHeight: 8,
      data: ["交易量（亿手）", "交易额（亿元）"]
    },
    axisPointer: { link: [{ xAxisIndex: "all" }], label: { backgroundColor: "#263b58" } },
    xAxis: [
      { ...commonAxis, gridIndex: 0, axisLabel: { show: false } },
      { ...commonAxis, gridIndex: 1, axisLabel: { show: false } },
      { ...commonAxis, gridIndex: 2, axisLabel: { show: false } },
      { ...commonAxis, gridIndex: 3 }
    ],
    yAxis: [
      { type: "value", gridIndex: 0, scale: true, axisLabel: { color: "#7890aa" }, splitLine: { lineStyle: { color: "#17283d" } } },
      { type: "value", gridIndex: 1, scale: true, name: "亿手", nameTextStyle: { color: "#7890aa" }, axisLabel: { color: "#7890aa" }, splitLine: { lineStyle: { color: "#17283d" } } },
      { type: "value", gridIndex: 1, scale: true, name: "亿元", nameTextStyle: { color: "#7890aa" }, axisLabel: { color: "#7890aa" }, splitLine: { show: false }, opposite: true },
      { type: "value", gridIndex: 2, scale: true, axisLabel: { color: "#7890aa", formatter: "{value}x" }, splitLine: { lineStyle: { color: "#17283d" } } },
      { type: "value", gridIndex: 3, scale: true, axisLabel: { color: "#7890aa" }, splitLine: { lineStyle: { color: "#17283d" } } }
    ],
    dataZoom: [
      { type: "inside", xAxisIndex: [0,1,2,3], filterMode: "none", start: 0, end: 100 },
      { type: "slider", xAxisIndex: [0,1,2,3], bottom: 10, height: 24, borderColor: "#263b58",
        backgroundColor: "#0d1929", fillerColor: "rgba(246,200,95,.18)", handleStyle: { color: "#f6c85f" },
        textStyle: { color: "#8fa5bf" }, start: 0, end: 100 }
    ],
    series: [
      series(title + "价格", rows, "close", 0, 0, color, true),
      scaleSeries("交易量（亿手）", rows, "volumeYiShou", 1, 1, COLORS.volume),
      scaleSeries("交易额（亿元）", rows, "amountYi", 1, 2, COLORS.amount),
      series(title + "PE(TTM)", rows, "pe", 2, 3, color),
      series(title + "真实利润", rows, "profitYi", 3, 4, color)
    ]
  };
}

const charts = [
  echarts.init(document.getElementById("chart-sh"), null, { renderer: "canvas" }),
  echarts.init(document.getElementById("chart-sz"), null, { renderer: "canvas" })
];
charts[0].setOption(chartOption("创业板指", DATA.sh, COLORS.sh));
charts[1].setOption(chartOption("科创综指", DATA.sz, COLORS.sz));

function applySharedRange(years) {
  const end = new Date("${END}T00:00:00Z");
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  const startValue = start.toISOString().slice(0, 10);
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
applySharedRange(20);
window.addEventListener("resize", () => charts.forEach(chart => chart.resize()));
</script>
</body>
</html>`;
}

async function main() {
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
    execFileSync(python, [path.join(ROOT, "work", "fetch_index_profit_data.py")], {
      stdio: "inherit",
    });
    execFileSync(python, [path.join(ROOT, "work", "fetch_official_sentiment_data.py")], {
      stdio: "inherit",
    });
    execFileSync(python, [path.join(ROOT, "work", "fetch_retail_sentiment_data.py")], {
      stdio: "inherit",
    });
    execFileSync(python, [path.join(ROOT, "work", "fetch_large_money_sentiment_data.py")], {
      stdio: "inherit",
    });
    execFileSync(python, [path.join(ROOT, "work", "fetch_valuation_data.py")], {
      stdio: "inherit",
    });
  } catch (error) {
    if (!fs.existsSync(path.join(ROOT, "work", "valuation_data.json"))) throw error;
    console.warn("Valuation refresh failed; using the existing valuation_data.json cache.");
  }
  const overview = readMarketOverview();
  END = overview.meta.end;
  const profit = readIndexProfit();
  const sh = lastByWeek(attachProfit(overview.sh, profit.sh));
  const sz = lastByWeek(attachProfit(overview.sz, profit.sz));
  const echartsSource = fs.readFileSync(path.join(ROOT, "work", "echarts.min.js"), "utf8");
  const data = { sh, sz, stats: { sh: stats(sh), sz: stats(sz) } };
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
