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
      }
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      console.log("PASS valuation selection", width);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
