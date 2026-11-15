const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(__dirname, "../index.html")).href);
      assert.equal(await page.locator('#valuationChart-latest [role="meter"]').count(), 3);
      const ranks = await page.evaluate(() => {
        const chart = echarts.getInstanceByDom(document.getElementById("valuationChart"));
        return ["sh", "k50", "sz"].map((key, index) => {
          const rows = DATA.valuationPeDaily[key].filter(row => Number.isFinite(row.pe));
          const latest = rows.at(-1);
          const cutoff = new Date(latest.date + "T00:00:00Z");
          cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 10);
          const sample = rows.filter(row => new Date(row.date + "T00:00:00Z") >= cutoff);
          return { actual: chart.valuationReading.items[index], pe: latest.pe,
            rank: sample.filter(row => row.pe <= latest.pe).length / sample.length * 100 };
        });
      });
      for (const row of ranks) {
        assert.equal(row.actual.pe, row.pe);
        assert.ok(Math.abs(row.actual.percentile - row.rank) < 1e-9);
      }
      assert.equal(await page.locator('#valuationMetricTabs [data-metric="pbPercentile"]').count(), 0);
      await page.evaluate(() => {
        const chart = echarts.getInstanceByDom(document.getElementById("valuationChart"));
        chart.dispatchAction({ type: "legendUnSelect", name: "创业板指" });
        chart.dispatchAction({ type: "legendUnSelect", name: "科创50" });
      });
      for (const selector of [
        '#valuationMetricTabs [data-metric="pePercentile"]',
        '#valuationPeModes [data-pe-mode="official"]',
        '#valuationRangeTabs [data-years="3"]',
        '#valuationMetricTabs [data-metric="pe"]',
        '#valuationPeModes [data-pe-mode="aggregate"]',
      ]) {
        await page.locator(selector).click();
        const selected = await page.evaluate(() =>
          echarts.getInstanceByDom(document.getElementById("valuationChart")).getOption().legend[0].selected);
        assert.equal(selected["创业板指"], false);
        assert.equal(selected["科创50"], false);
        assert.notEqual(selected["科创综指"], false);
        assert.equal(await page.locator('#valuationChart-latest [role="meter"]').count(), 1);
        assert.match(await page.locator('#valuationChart-latest').textContent(), /PE分位/);
      }
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      console.log("PASS valuation selection", width);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
