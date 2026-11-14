const { test } = require("node:test");
const assert = require("node:assert/strict");
const { inspect } = require("../work/audit_dashboard_freshness");

test("freshness checks each numeric field, preserving zeros and ignoring later missing values", () => {
  const report = inspect({ series: [
    { date: "2026-11-13", a: null, index: { amount: null } },
    { date: "2026-11-06", a: 0, index: { amount: -2 } },
  ] });
  assert.equal(report.series.series.lastDate, "2026-11-13");
  assert.equal(report.series.series.latestValidDate.a, "2026-11-06");
  assert.equal(report.series.series.latestValidDate["index.amount"], "2026-11-06");
});
