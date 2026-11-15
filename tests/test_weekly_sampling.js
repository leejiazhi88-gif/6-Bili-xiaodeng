const { test } = require("node:test");
const assert = require("node:assert/strict");
const { lastByWeek } = require("../work/weekly_sampling");

test("natural weeks pick Friday, holiday last session, and latest partial week without date relabeling", () => {
  const rows = ["2026-10-19", "2026-10-21", "2026-10-23", "2026-10-26", "2026-10-28", "2026-10-30", "2026-11-02"]
    .map((date, value) => ({ date, value }));
  assert.deepEqual(lastByWeek(rows).map(row => row.date), ["2026-10-23", "2026-10-30", "2026-11-02"]);
  assert.deepEqual(lastByWeek([{ date: "2026-10-01" }, { date: "2026-09-30" }]).map(row => row.date), ["2026-10-01"]);
  assert.deepEqual(lastByWeek([{ date: "2025-12-31" }, { date: "2026-01-02" }]).map(row => row.date), ["2026-01-02"]);
  assert.deepEqual(lastByWeek([]), []);
});
