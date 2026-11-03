const fs = require("fs");
const path = require("path");
const { guideCss, explanationScript } = require("./sentiment_explanations");
const explanationMethods = require("./sentiment_methodology.json");

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
    ${guideCss("official-sentiment")}
    #refinanceSourceLink { color: #f6c85f; }
    #officialSeriesControls { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 12px 16px 4px; }
    #officialSeriesControls button { display: inline-flex; align-items: center; gap: 7px; border: 0;
      background: transparent; color: #b8c8db; font-size: 12px; padding: 6px 0; cursor: pointer; }
    #officialSeriesControls button[aria-pressed="false"] { opacity: .4; }
    #officialSeriesControls button:disabled { opacity: .35; cursor: not-allowed; }
    #officialSeriesControls button:focus-visible { outline: 2px solid #f6c85f; outline-offset: 3px; }
    .official-series-mark { width: 22px; border-top: 3px solid var(--series-color); }
    #officialEmptyState { padding: 16px; color: #c6d3e3; text-align: center; }
    #officialEmptyState[hidden] { display: none; }
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
          <div class="panel-title">融资与货币环境</div>
          <div class="panel-subtitle" id="officialMetricSubtitle">全市场IPO发行金额 · 亿元 / 月</div>
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
      <div id="officialSeriesControls" role="group" aria-label="显示范围，选择对七个页签生效">
        <button type="button" data-series="market" aria-pressed="true" style="--series-color:#f6c85f"><span class="official-series-mark"></span><span id="officialMarketLabel">全市场IPO发行金额</span></button>
        <button type="button" data-series="sh" aria-pressed="true" style="--series-color:#ff5d73"><span class="official-series-mark"></span><span id="officialScopeLabel-sh">创业板指成分股</span></button>
        <button type="button" data-series="k50" aria-pressed="true" style="--series-color:#7ddc82"><span class="official-series-mark"></span><span id="officialScopeLabel-k50">科创50成分股</span></button>
        <button type="button" data-series="sz" aria-pressed="true" style="--series-color:#36c2ff"><span class="official-series-mark"></span><span id="officialScopeLabel-sz">科创综指成分股</span></button>
      </div>
      <div class="metric-tabs" id="officialMetricTabs">
        <button class="metric-tab active" data-metric="ipoFund">IPO融资额</button>
        <button class="metric-tab" data-metric="refinanceFund">再融资额</button>
        <button class="metric-tab" data-metric="holderNetReductionAmount">重要股东净减持额</button>
        <button class="metric-tab" data-metric="stampDutyRate">印花税率</button>
        <button class="metric-tab" data-metric="lpr1y">1年期LPR</button>
        <button class="metric-tab" data-metric="socialFinancing">社融增量</button>
        <button class="metric-tab" data-metric="m2Yoy">M2增速</button>
      </div>
      <div class="metric-note">
        <a id="refinanceSourceLink" href="https://data.10jqka.com.cn/macro/finance/" target="_blank" rel="noopener" hidden>查看再融资数据来源</a>
        <span class="metric-reading" id="officialLatestReading"></span>
      </div>
      <div id="officialEmptyState" role="status" hidden></div>
      <div id="officialSentimentChart"></div>
    </article>

    <div class="valuation-foot">
      <details class="metric-method">
        <summary>指标含义、统计口径与数据来源</summary>
        <div class="metric-guide" id="officialMetricGuide" aria-live="polite"></div>
        <div id="officialMethodology"></div>
        <div id="officialIpoCoverage" hidden></div>
      </details>
    </div>
  </section>
`;

const script = `
  <script id="official-sentiment-script">
  (() => {
    const officialData = __OFFICIAL_DATA__;
    const refinancingData = __REFINANCING_DATA__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const metrics = {
      ipoFund: { title: "IPO发行金额", market: "全市场IPO发行金额", unit: "亿元", digits: 2,
        subtitle: "IPO发行总额 · 月度合计 · 成分股按最新可得名单回溯", partial: true },
      refinanceFund: { title: "股票再融资额", market: "全市场股票再融资额", unit: "亿元", digits: 2,
        subtitle: "增发、配股募集资金 · 月度合计 · 不含可转债" },
      holderNetReductionAmount: { title: "重要股东净减持额", market: "全市场重要股东净减持额", unit: "亿元", digits: 2,
        subtitle: "减持金额 − 增持金额 · 月度公告合计 · 仅含可按披露均价计算的记录", partial: true },
      stampDutyRate: { title: "证券交易印花税卖出端税率", market: "证券交易印花税卖出端税率", unit: "%", digits: 2,
        subtitle: "统一税率 · 月末有效值", step: "end" },
      lpr1y: { title: "1年期LPR", market: "全国1年期LPR", unit: "%", digits: 2,
        subtitle: "贷款市场报价利率 · 月末有效报价", step: "end" },
      socialFinancing: { title: "社融增量", market: "全国社融增量", unit: "亿元", digits: 0,
        subtitle: "实体经济获得的新增融资 · 月度合计" },
      m2Yoy: { title: "M2同比增速", market: "全国M2同比增速", unit: "%", digits: 1,
        subtitle: "广义货币余额与上年同月相比的增幅" }
    };
    ${explanationScript(["ipoFund", "refinanceFund", "holderNetReductionAmount", "stampDutyRate", "lpr1y", "socialFinancing", "m2Yoy"], "official", explanationMethods)}
    const scopes = [
      { key: "market", color: "#f6c85f" },
      { key: "sh", name: "创业板指成分股", color: "#ff5d73" },
      { key: "k50", name: "科创50成分股", color: "#7ddc82" },
      { key: "sz", name: "科创综指成分股", color: "#36c2ff" }
    ];
    // Scope identity, rather than a metric's changing label, persists across all seven tabs.
    const selected = new Set(scopes.map(scope => scope.key));
    let activeMetric = "ipoFund";
    let activeYears = 0;
    const chart = echarts.init(document.getElementById("officialSentimentChart"), null, { renderer: "canvas" });
    document.getElementById("officialDataStatus").textContent = "数据核对至 " + officialData.meta.updated;

    function renderChart(preserveZoom = false) {
      const cfg = metrics[activeMetric];
      const holderMetric = activeMetric === "holderNetReductionAmount";
      const ipoMetric = activeMetric === "ipoFund";
      const breakdownField = ipoMetric ? "ipoIndices" : "holderIndices";
      const canSelect = key => key === "market" || holderMetric ||
        (ipoMetric && officialData.meta.ipoConstituents[key]?.available);
      const lineName = scope => scope.key === "market" ? cfg.market :
        scope.name + (ipoMetric ? "（现有成分股回溯）" : "") + " · " + cfg.title +
        (ipoMetric && scope.key !== "market" && (officialData.meta.ipoConstituents[scope.key]?.missingMembers?.length ||
          officialData.meta.ipoConstituents[scope.key]?.pricedMembers < officialData.meta.ipoConstituents[scope.key]?.matchedMembers) ? "（仅可核实记录）" : "");
      const oldZoom = preserveZoom ? chart.getOption().dataZoom?.[0] : null;
      const zoom = oldZoom ? Object.fromEntries(["start", "end", "startValue", "endValue"]
        .filter(key => oldZoom[key] != null).map(key => [key, oldZoom[key]])) : { start: 0, end: 100 };
      document.getElementById("refinanceSourceLink").hidden = activeMetric !== "refinanceFund";
      const rows = activeMetric === "refinanceFund" ? refinancingData.series : officialData.series;
      const availableRows = rows.filter(row => Number.isFinite(row[activeMetric]));
      const last = availableRows[availableRows.length - 1];
      const first = availableRows[0];
      const cutoff = new Date((last?.date || officialData.meta.end) + "T00:00:00Z");
      if (activeYears) cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      const minDate = activeYears ? cutoff.toISOString().slice(0, 10) : "";
      // Keep missing months as nulls so a line cannot bridge unpublished observations.
      const visibleRows = rows.filter(row => row.date >= minDate && (!first || row.date >= first.date));
      const byDate = new Map(rows.map(row => [row.date, row]));
      document.getElementById("officialMarketLabel").textContent = cfg.market;
      document.getElementById("officialMetricSubtitle").textContent = cfg.subtitle;
      const reason = officialData.meta.constituentAvailability[activeMetric];
      document.querySelectorAll("#officialSeriesControls [data-series]").forEach(button => {
        const enabled = canSelect(button.dataset.series);
        button.disabled = !enabled;
        button.setAttribute("aria-pressed", String(selected.has(button.dataset.series)));
        button.title = enabled ? "切换显示；选择对所有页签生效" : reason;
      });
      scopes.filter(scope => scope.key !== "market").forEach(scope => {
        document.getElementById("officialScopeLabel-" + scope.key).textContent = scope.name + (ipoMetric ? "（IPO回溯）" : "");
      });
      renderExplanation("official", activeMetric);
      const coverageBox = document.getElementById("officialIpoCoverage");
      coverageBox.hidden = !ipoMetric;
      if (ipoMetric) {
        coverageBox.innerHTML = '<ol start="8">' + scopes.filter(scope => scope.key !== "market").map(scope => {
          const cover = officialData.meta.ipoConstituents[scope.key];
          const detail = cover?.available
            ? "名单日期 " + cover.snapshotDate + "；共 " + cover.totalMembers + " 家，匹配IPO记录 " + cover.matchedMembers +
              " 家，其中有发行股数和发行价 " + cover.pricedMembers + " 家；经公告核对的换股上市 " + Object.keys(cover.nonCashListings).length +
              " 家不计作现金IPO；尚未匹配 " + cover.missingMembers.length + " 家。名单调整会改变回溯结果。"
            : "暂无可核实的成分股IPO数据。";
          return "<li><strong>" + scope.name + "回溯范围：</strong>" + explanationEscape(detail) + "</li>";
        }).join("") + "</ol>";
      }
      const latestRows = visibleRows.filter(row => Number.isFinite(row[activeMetric]));
      const latest = latestRows[latestRows.length - 1];
      let reading = latest ? cfg.market + " · " + latest.date + " · " + fmt(latest[activeMetric], cfg.digits) + cfg.unit
        : cfg.market + " · 当前范围暂无数据";
      if (latest && cfg.partial && latest.partialMonth) reading += "（本月截至当日累计，非完整月）";
      if (latest && activeMetric === "lpr1y" && latest.lprSourceDate) reading += " · 报价日期 " + [latest.lprSourceDate.slice(0, 4), latest.lprSourceDate.slice(4, 6), latest.lprSourceDate.slice(6, 8)].join("-");
      if (latest && holderMetric) {
        const coverage = latest.holderCoverage?.market;
        if (coverage) reading += " · 可计价 " + coverage.pricedRecords + "/" + coverage.records + " 条公告记录";
      }
      document.getElementById("officialLatestReading").textContent = reading;
      const series = scopes.filter(scope => selected.has(scope.key) && canSelect(scope.key)).map(scope => ({
        id: scope.key, name: lineName(scope),
        type: "line", step: cfg.step || false, connectNulls: false,
        data: visibleRows.map(row => [row.date, (scope.key === "market" ? row[activeMetric] : row[breakdownField]?.[scope.key]) ?? null]),
        showSymbol: false,
        lineStyle: { width: 2, color: scope.color }, itemStyle: { color: scope.color }
      }));
      const hasData = series.some(line => line.data.some(point => Number.isFinite(point[1])));
      const empty = document.getElementById("officialEmptyState");
      empty.hidden = hasData;
      empty.textContent = series.length ? "当前范围暂无所选曲线的可核实数据" : "曲线已关闭，点击上方开关显示";
      chart.setOption({
        animation: false, backgroundColor: "transparent",
        grid: { left: 92, right: 30, top: 28, bottom: 66 },
        legend: { show: false },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f", textStyle: { color: "#edf4ff" },
          formatter(params) {
            const date = params[0]?.value?.[0];
            const row = byDate.get(date);
            const lines = params.map(item => {
              let text = item.marker + item.seriesName + "：<b>" + fmt(item.value[1], cfg.digits) + cfg.unit + "</b>";
              const scope = scopes.find(s => s.key === item.seriesId || lineName(s) === item.seriesName);
              if (holderMetric) {
                const count = row?.holderCoverage?.[scope?.key];
                if (count && count.records != null) text += "（可计价 " + count.pricedRecords + "/" + count.records + " 条）";
              }
              if (ipoMetric && scope && scope.key !== "market") {
                const cover = officialData.meta.ipoConstituents[scope.key];
                text += "（按 " + cover.snapshotDate + " 成分名单回溯，已匹配IPO " + cover.matchedMembers + "/" + cover.totalMembers + " 家）";
              }
              return text;
            });
            const partial = cfg.partial && row?.partialMonth ? " · 截至当日累计，非完整月" : "";
            return "<b>" + (date || "") + partial + "</b><br>" + lines.join("<br>");
          }
        },
        xAxis: { type: "time", axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false } },
        yAxis: { type: "value", scale: true, name: cfg.unit, nameTextStyle: { color: "#8fa5bf" },
          axisLabel: { color: "#8fa5bf", formatter(value) {
            return cfg.unit === "亿元" && Math.abs(value) >= 10000
              ? fmt(value / 10000, 1) + "万亿元" : fmt(value, cfg.unit === "%" ? cfg.digits : 0) + cfg.unit;
          } }, splitLine: { lineStyle: { color: "#17283d" } } },
        dataZoom: [
          { type: "inside", filterMode: "none", ...zoom },
          { type: "slider", bottom: 12, height: 22, ...zoom,
            borderColor: "#263b58", backgroundColor: "#0d1929", fillerColor: "rgba(255,93,115,.15)",
            handleStyle: { color: "#ff5d73" }, textStyle: { color: "#8fa5bf" } }
        ],
        series
      }, true);
    }

    document.querySelectorAll("#officialSeriesControls [data-series]").forEach(button => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        const key = button.dataset.series;
        if (selected.has(key)) selected.delete(key); else selected.add(key);
        renderChart(true);
      });
    });

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
const refinancing = JSON.parse(fs.readFileSync(path.join(ROOT, "work", "refinancing_data.json"), "utf8"));
const officialScript = script.replace("__OFFICIAL_DATA__", JSON.stringify(data))
  .replace("__REFINANCING_DATA__", JSON.stringify(refinancing));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", officialScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
