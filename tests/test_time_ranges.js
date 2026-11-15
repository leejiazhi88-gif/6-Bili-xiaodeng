const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("all five dashboard sections use the same six time ranges", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const groups = [html.match(/<div class="ranges"[^>]*>([\s\S]*?)<\/div>/)[1],
    ...["valuation", "retail", "largeMoney", "official"].map(prefix =>
      html.match(new RegExp('<div[^>]*id="' + prefix + 'RangeTabs"[^>]*>([\\s\\S]*?)<\\/div>'))[1])];
  for (const group of groups) {
    assert.deepEqual([...group.matchAll(/data-years="(\d+)"/g)].map(match => Number(match[1])), [1, 3, 5, 10, 20, 0]);
  }
});
