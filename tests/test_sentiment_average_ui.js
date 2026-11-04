const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the deployed scripts and their real HTML controls without a browser.
// This checks interactions and chart options, not canvas rendering or CSS layout.
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const scripts = Object.fromEntries(Array.from(html.matchAll(/<script id="([^"]+)">([\s\S]*?)<\/script>/g),
  match => [match[1], match[2]]));
function jsonConstant(source, name) {
  const match = source.match(new RegExp("^\\s*const " + name + " = (.+);$", "m"));
  assert.ok(match, "Missing embedded data: " + name);
  return JSON.parse(match[1]);
}
const marketData = jsonConstant(html, "DATA");
const dataKeys = ["sh", "k50", "sz"];
const indexNames = ["创业板指", "科创50", "科创综指"];
const definitions = [
  { prefix: "retail", script: "retail-sentiment-script", chart: "retailSentimentChart",
    metrics: ["amount", "volume", "turnover"], unsupported: ["marginBalance", "marginFloatRatio"] },
  { prefix: "largeMoney", script: "large-money-sentiment-script", chart: "largeMoneyChart",
    metrics: ["blockAmount", "institutionBlockNet", "holderNetShares"],
    unsupported: ["northHoldings", "fundPosition", "institutionConcentration", "etfShares"] }
];

function attributes(text) {
  return Object.fromEntries(Array.from(text.matchAll(/([\w-]+)="([^"]*)"/g), m => [m[1], m[2]]));
}
function element(attrs = {}) {
  const classes = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
  const listeners = new Map();
  return {
    id: attrs.id, attrs, style: {}, hidden: false, innerHTML: "", textContent: "", children: [],
    lastChild: { textContent: "" },
    dataset: Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith("data-"))
      .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase()), value])),
    classList: {
      add: value => classes.add(value), remove: value => classes.delete(value),
      contains: value => classes.has(value),
      toggle(value, enabled = !classes.has(value)) { enabled ? classes.add(value) : classes.delete(value); }
    },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) { return this.attrs[key] ?? null; },
    addEventListener(name, fn) { listeners.set(name, fn); },
    click() { assert.ok(listeners.has("click"), "Control has no click handler"); listeners.get("click")(); },
    querySelectorAll(selector) {
      const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      assert.ok(match, "Unexpected selector: " + selector);
      return this.children.filter(child => Object.hasOwn(child.attrs, match[1]) &&
        (match[2] === undefined || child.attrs[match[1]] === match[2]));
    }
  };
}
function mount(def) {
  const nodes = new Map();
  for (const match of html.matchAll(/<[a-z][\w-]*\b([^>]*\bid="[^"]+"[^>]*)>/g)) {
    const attrs = attributes(match[1]);
    nodes.set(attrs.id, element(attrs));
  }
  for (const suffix of ["AverageModes", "MetricTabs", "SeriesControls", "RangeTabs", "HoldingModes"]) {
    const id = def.prefix + suffix;
    if (!nodes.has(id)) continue;
    const body = html.match(new RegExp('<div[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)<\\/div>'));
    assert.ok(body, "Missing controls: " + id);
    nodes.get(id).children = Array.from(body[1].matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g), match => {
      const button = element(attributes(match[1]));
      button.textContent = match[2].replace(/<[^>]*>/g, "");
      return button;
    });
  }
  const document = {
    getElementById(id) { assert.ok(nodes.has(id), "Missing element: " + id); return nodes.get(id); },
    querySelectorAll(selector) {
      const match = selector.match(/^#([^ ]+) (.+)$/);
      assert.ok(match, "Unexpected document selector: " + selector);
      return this.getElementById(match[1]).querySelectorAll(match[2]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  const chart = {
    option: {}, renders: 0, resize() {},
    getOption() { return this.option; },
    setOption(option) { this.option = option; this.renders++; }
  };
  const sandbox = {
    DATA: marketData,
    COLORS: { sh: "#ff5d73", k50: "#7ddc82", sz: "#36c2ff" },
    document, window: { addEventListener() {} },
    echarts: { init(node) { assert.equal(node.id, def.chart); return chart; } }
  };
  assert.ok(scripts[def.script], "Build the dashboard before running this test");
  vm.runInNewContext(scripts[def.script], sandbox, { filename: def.script, timeout: 10000 });
  return {
    chart, nodes,
    controls: nodes.get(def.prefix + "AverageModes"),
    buttons(suffix) { return nodes.get(def.prefix + suffix).children; },
    click(suffix, attribute, value) {
      const button = this.buttons(suffix).find(item => item.attrs[attribute] === String(value));
      assert.ok(button, "Missing button: " + suffix + " " + value);
      button.click();
    },
    average(value) { this.click("AverageModes", "data-average", value); },
    metric(value) { this.click("MetricTabs", "data-metric", value); },
    series() { return plain(chart.option.series.map(({ name, data }) => ({ name, data }))); }
  };
}
function expectedRaw(def, metric) {
  const source = scripts[def.script];
  if (def.prefix === "retail") {
    const market = jsonConstant(source, "retailData").series;
    const index = jsonConstant(source, "indexData");
    const marketField = metric === "volume" ? "volumeProxy" : metric;
    const field = { amount: "amountYi", volume: "volumeYiShou", turnover: "turnover" }[metric];
    return [{ name: "沪深两市", data: market.map(row => [row.date, row[marketField]]) },
      ...dataKeys.map((key, i) => ({ name: indexNames[i],
        data: (metric === "turnover" ? index : marketData)[key].map(row => [row.date, row[field]]) }))];
  }
  const market = jsonConstant(source, "largeMoneyData").series;
  const index = jsonConstant(source, "indexMoneyData");
  const field = metric === "holderNetShares" ? "holderNetAmount" : metric;
  return [{ name: "全市场资金", data: market.map(row => [row.date, row[field]]) },
    ...dataKeys.map((key, i) => {
      const values = new Map(index[key].map(row => [row.date, row[field]]));
      return { name: indexNames[i], data: market.map(row => [row.date, values.get(row.date)]) };
    })];
}
function selectedMode(ui, value) {
  for (const button of ui.buttons("AverageModes")) {
    const selected = button.dataset.average === String(value);
    assert.equal(button.classList.contains("active"), selected);
    assert.equal(button.getAttribute("aria-pressed"), String(selected));
  }
}
function close(actual, expected, label) {
  assert.ok(Number.isFinite(actual), label + " is missing");
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), label + " differs");
}
function checkSample(raw, rendered, windowSize, position) {
  const points = raw.data.slice(position - windowSize + 1, position + 1);
  assert.equal(points.length, windowSize);
  assert.ok(points.every(point => Number.isFinite(point[1])));
  // Independently sum one actual disclosed window; do not call the production helper.
  const average = points.reduce((sum, point) => sum + point[1], 0) / windowSize;
  const actual = rendered.data.find(point => point[0] === raw.data[position][0]);
  assert.ok(actual, "Missing expected date " + raw.data[position][0]);
  close(actual[1], average, raw.name + " " + actual[0] + " MA" + windowSize);
}

for (const def of definitions) {
  test(def.prefix + ": defaults, 3 metrics × 3 modes, raw values and disclosed moving-average windows", () => {
    const ui = mount(def);
    selectedMode(ui, 1);
    assert.equal(ui.controls.hidden, false);
    for (const metric of def.metrics) {
      ui.metric(metric);
      const raw = expectedRaw(def, metric);
      for (const windowSize of [1, 7, 30]) {
        ui.average(windowSize);
        selectedMode(ui, windowSize);
        const rendered = ui.series();
        assert.equal(rendered.length, 4);
        for (const expected of raw) {
          const line = rendered.find(item => item.name === expected.name);
          assert.ok(line);
          assert.deepEqual(line.data.map(point => point[0]), expected.data.map(point => point[0]));
          if (windowSize === 1) {
            assert.deepEqual(line.data.filter(point => Number.isFinite(point[1])),
              expected.data.filter(point => Number.isFinite(point[1])));
          } else {
            assert.ok(line.data.slice(0, windowSize - 1).every(point => point[1] === null));
            let lastComplete = -1;
            for (let i = windowSize - 1; i < expected.data.length; i++) {
              if (expected.data.slice(i - windowSize + 1, i + 1).every(point => Number.isFinite(point[1]))) {
                lastComplete = i;
              } else {
                assert.equal(line.data[i][1], null, expected.name + " must not bridge a missing sample");
              }
            }
            assert.ok(lastComplete >= 0, "No complete disclosed window");
            checkSample(expected, line, windowSize, lastComplete);
          }
        }
        const tooltip = ui.chart.option.tooltip.formatter([{ marker: "", seriesName: "测试曲线",
          value: ["2026-01-01", null], axisValueLabel: "2026-01-01" }]);
        assert.ok(tooltip.includes(windowSize === 1 ? "原数据" : windowSize + "点均线"));
        assert.doesNotMatch(tooltip, /测试曲线：<b>0(?:[.,]0+)?/);
        assert.match(tooltip, /--|暂无数据|缺失值/);
      }
    }
  });

  test(def.prefix + ": unrelated tabs remain raw, hide controls, and restore the selected average", () => {
    const ui = mount(def);
    const unrelated = new Map();
    for (const metric of def.unsupported) {
      ui.metric(metric);
      unrelated.set(metric, ui.series());
    }
    ui.metric(def.metrics[0]);
    ui.average(30);
    for (const metric of def.unsupported) {
      ui.metric(metric);
      assert.equal(ui.controls.hidden, true);
      assert.deepEqual(ui.series(), unrelated.get(metric));
    }
    ui.metric(def.metrics[0]);
    assert.equal(ui.controls.hidden, false);
    selectedMode(ui, 30);
    const raw = expectedRaw(def, def.metrics[0])[0];
    checkSample(raw, ui.series()[0], 30, raw.data.length - 1);
  });

  test(def.prefix + ": time-range boundary averages use earlier history; selecting one curve retains averages", () => {
    const ui = mount(def);
    for (const metric of def.metrics) {
      ui.metric(metric);
      const raw = expectedRaw(def, metric);
      for (const windowSize of [7, 30]) {
        ui.click("RangeTabs", "data-years", 0);
        ui.average(windowSize);
        ui.click("RangeTabs", "data-years", 3);
        const rendered = ui.series();
        let checkedBoundaries = 0;
        for (const line of rendered) {
          const source = raw.find(item => item.name === line.name);
          const position = source.data.findIndex(point => point[0] === line.data[0][0]);
          if (position < windowSize - 1) continue; // Newly launched index has no prior history.
          if (!source.data.slice(position - windowSize + 1, position + 1).every(point => Number.isFinite(point[1]))) continue;
          assert.ok(source.data[position - 1][0] < line.data[0][0]);
          checkSample(source, line, windowSize, position);
          checkedBoundaries++;
        }
        assert.ok(checkedBoundaries > 0, "Must test a range boundary with earlier history");
      }
    }
    const before = ui.series();
    for (const button of ui.buttons("SeriesControls").slice(0, 3)) button.click();
    assert.equal(ui.series().length, 1);
    const remaining = ui.series()[0];
    assert.deepEqual(remaining, before.find(line => line.name === remaining.name));
    selectedMode(ui, 30);
    const last = ui.buttons("SeriesControls").at(-1);
    last.click();
    assert.equal(ui.series().length, 1, "Must keep at least one visible curve");
    assert.equal(last.getAttribute("aria-pressed"), "true");
    assert.equal(ui.chart.option.dataZoom.length, 2);
  });
}

for (const def of definitions) {
  test(def.prefix + ": changing average and visible curves preserves zoom; choosing a range resets zoom", () => {
    const ui = mount(def);
    ui.chart.option.dataZoom.forEach(zoom => { zoom.start = 35; zoom.end = 80; });
    ui.average(7);
    assert.equal(ui.chart.option.dataZoom[0].start, 35);
    assert.equal(ui.chart.option.dataZoom[0].end, 80);
    ui.buttons("SeriesControls")[0].click();
    assert.equal(ui.chart.option.dataZoom[0].start, 35);
    assert.equal(ui.chart.option.dataZoom[0].end, 80);
    ui.click("RangeTabs", "data-years", 3);
    assert.equal(ui.chart.option.dataZoom[0].start, 0);
    assert.equal(ui.chart.option.dataZoom[0].end, 100);
  });
}

const officialDef = { prefix: 'official', script: 'official-sentiment-script', chart: 'officialSentimentChart' };
const officialFields = ['ipoFund', 'refinanceFund', 'holderNetReductionAmount'];

test('official: three financing tabs use named source amounts on one axis, with no market-price dependency', () => {
  const ui = mount(officialDef);
  const data = jsonConstant(scripts[officialDef.script], 'officialData');
  const refinance = jsonConstant(scripts[officialDef.script], 'refinancingData');
  assert.doesNotMatch(scripts[officialDef.script], /\bDATA\b|baseClose|baselineDate|yAxisIndex: 1|相对价格|官方指标/);
  for (const metric of officialFields) {
    ui.metric(metric);
    const rows = metric === 'refinanceFund' ? refinance.series : data.series;
    const option = ui.chart.option;
    const expectedUnit = '亿元';
    assert.equal(option.yAxis.name, expectedUnit);
    assert.equal(Array.isArray(option.yAxis), false);
    assert.equal(option.legend.show, false);
    const market = option.series.find(line => line.id === 'market');
    assert.ok(market);
    assert.notEqual(market.name, '官方指标');
    assert.equal(market.connectNulls, false);
    assert.deepEqual(plain(market.data.filter(p => Number.isFinite(p[1]))),
      rows.filter(row => Number.isFinite(row[metric])).map(row => [row.date, row[metric]]));
    assert.equal(option.series.length, 3);
    const sourceRow = rows.findLast(row => Number.isFinite(row[metric]));
    const tooltip = option.tooltip.formatter([{ marker: '', seriesName: market.name, seriesId: 'market',
      value: [sourceRow.date, sourceRow[metric]] }]);
    assert.ok(tooltip.includes(expectedUnit));
    assert.ok(tooltip.includes(market.name));
    const absent = option.tooltip.formatter([{ marker: '', seriesName: market.name, value: [sourceRow.date, null] }]);
    assert.ok(absent.includes('--' + expectedUnit));
    assert.doesNotMatch(ui.nodes.get('officialMethodology').innerHTML, /基准为100|右轴|收盘价/);
  }
});

test('official: shared board selection survives every tab and zoom persists', () => {
  const ui = mount(officialDef);
  ui.click('SeriesControls', 'data-series', 'market');
  for (const metric of officialFields) {
    ui.metric(metric);
    assert.ok(!ui.chart.option.series.some(line => line.id === 'market'));
    assert.equal(ui.buttons('SeriesControls')[0].getAttribute('aria-pressed'), 'false');
    assert.deepEqual(ui.buttons('SeriesControls').map(b => b.dataset.series), ['market', 'chinext', 'star']);
    assert.ok(ui.buttons('SeriesControls').every(b => !b.disabled && !b.hidden));

  }
  ui.metric('holderNetReductionAmount');
  ui.chart.option.dataZoom[0] = { start: 35, end: 73 };
  ui.click('SeriesControls', 'data-series', 'chinext');
  assert.equal(ui.chart.option.dataZoom[0].start, 35);
  assert.equal(ui.chart.option.dataZoom[0].end, 73);
  ui.metric('ipoFund');
  ui.metric('holderNetReductionAmount');
  assert.ok(!ui.chart.option.series.some(line => line.id === 'chinext'));
  ui.click('SeriesControls', 'data-series', 'market');
  for (const metric of officialFields) {
    ui.metric(metric);
    assert.ok(ui.chart.option.series.some(line => line.id === 'market'));
  }
});

test('official: whole-board series are disclosed monthly money; missing points and current-month labels survive', () => {
  const ui = mount(officialDef);
  const data = jsonConstant(scripts[officialDef.script], 'officialData');
  ui.metric('holderNetReductionAmount');
  for (const key of ['chinext', 'star']) {
    const line = ui.chart.option.series.find(item => item.id === key);
    const expected = data.series.filter(row => Number.isFinite(row.holderBoards?.[key]?.holderNetReductionAmount));
    assert.ok(expected.length > 0);
    assert.deepEqual(plain(line.data.filter(point => Number.isFinite(point[1]))),
      expected.map(row => [row.date, row.holderBoards[key].holderNetReductionAmount]));
  }
  assert.match(ui.nodes.get('officialLatestReading').textContent, /可计价/);
  if (data.series.at(-1).partialMonth) {
    for (const metric of ['ipoFund', 'holderNetReductionAmount']) {
      ui.metric(metric);
      assert.match(ui.nodes.get('officialLatestReading').textContent, /非完整月/);
    }
  }
  const section = html.match(/<section class="module-shell" id="official-sentiment">([\s\S]*?)<\/section>/)[1];
  assert.deepEqual(ui.buttons('MetricTabs').map(button => button.dataset.metric), officialFields);
  assert.ok(section.indexOf('id="officialSeriesControls"') < section.indexOf('<article class="valuation-panel">'));
  assert.doesNotMatch(section, /科创50|data-series="(?:sh|k50|sz)"/);
  assert.match(section, /<details class="metric-method">/);
  assert.doesNotMatch(section, /<details[^>]*\bopen\b/);
});


test('official: all three tabs share the outer listing-board controls', () => {
  const ui = mount(officialDef);
  for (const metric of officialFields) {
    ui.metric(metric);
    const visible = ui.buttons('SeriesControls').filter(b => !b.hidden).map(b => b.dataset.series);
    assert.deepEqual(visible, ['market', 'chinext', 'star']);
    assert.deepEqual(plain(ui.chart.option.series.map(s => s.id)), visible);
    assert.doesNotMatch(ui.nodes.get('officialMetricGuide').innerHTML, /现有成分股|回溯|名单日期/);
    for (const line of ui.chart.option.series) {
      assert.doesNotMatch(line.name, /成分股|科创50|回溯/);
      const tooltip = ui.chart.option.tooltip.formatter([{ seriesId: line.id, seriesName: line.name,
        value: line.data.find(p => Number.isFinite(p[1])), marker: '' }]);
      assert.doesNotMatch(tooltip, /回溯|名单|已匹配/);
    }
  }
  ui.click('SeriesControls', 'data-series', 'chinext');
  ui.metric('ipoFund');
  assert.ok(!ui.chart.option.series.some(s => s.id === 'chinext'));
  ui.metric('holderNetReductionAmount');
  assert.deepEqual(ui.buttons('SeriesControls').filter(b => !b.hidden).map(b => b.dataset.series), ['market', 'chinext', 'star']);
  assert.ok(!ui.chart.option.series.some(s => s.id === 'chinext'));
  ui.metric('refinanceFund');
  assert.ok(!ui.chart.option.series.some(s => s.id === 'chinext'));
  ui.click('SeriesControls', 'data-series', 'chinext');
  assert.ok(ui.chart.option.series.some(s => s.id === 'chinext'));
});

test('official board amounts reconcile independently to issuance records, including companies absent from current indices', () => {
  const ui = mount(officialDef);
  const ipo = JSON.parse(fs.readFileSync(path.join(__dirname, '../work/ipo_issuance_records.json')));
  const refinance = JSON.parse(fs.readFileSync(path.join(__dirname, '../work/refinancing_issuance_records.json')));
  const board = code => /^(300|301|302)[0-9]{3}\.SZ$/.test(code) ? 'chinext' : /^(688|689)[0-9]{3}\.SH$/.test(code) ? 'star' : 'other';
  for (const metric of ['ipoFund', 'refinanceFund']) {
    ui.metric(metric);
    for (const key of ['chinext', 'star']) {
      const line = ui.chart.option.series.find(s => s.id === key);
      const months = new Map(), identities = new Set();
      for (const r of metric === 'ipoFund' ? ipo.records : refinance.records) {
        const rawDate = metric === 'ipoFund' ? r.ipo_date || r.issue_date : r.date;
        if (!rawDate) continue;
        const date = rawDate.replaceAll('-', '');
        if (metric === 'ipoFund' && date > ipo.meta.end) continue;
        if (metric === 'refinanceFund' && r.date > refinance.meta.end) continue;
        if (board(r.ts_code || r.code) !== key) continue;
        const id = metric === 'ipoFund' ? r.ts_code + date : r.type + r.id;
        if (identities.has(id)) continue;
        identities.add(id);
        const month = date.slice(0, 4) + '-' + date.slice(4, 6);
        const entry = months.get(month) || { sum: 0, missing: false };
        const yuan = metric === 'ipoFund' ? (r.amount > 0 && r.price > 0 ? r.amount * 10000 * r.price : null) : r.amountYuan;
        if (yuan == null) entry.missing = true; else entry.sum += yuan;
        months.set(month, entry);
      }
      assert.ok(months.size > 0);
      for (const [month, entry] of months) {
        const point = line.data.find(p => p[0].startsWith(month));
        assert.ok(point, metric + ' missing month ' + month);
        if (entry.missing) assert.equal(point[1], null);
        else assert.ok(Math.abs(point[1] - entry.sum / 1e8) <= .005001, metric + ' ' + key + ' ' + month);
      }
    }
  }
  ui.metric('ipoFund');
  assert.equal(ui.chart.option.series.find(s => s.id === 'chinext').data.find(p => p[0] === '2021-07-31')[1], 95.31);
});
