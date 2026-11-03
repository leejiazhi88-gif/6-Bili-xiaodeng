const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pointMovingAverage, movingAverageScript } = require("../work/point_moving_average");

test("7 and 30 mean sampling points, with full trailing windows", () => {
  const points = Array.from({ length: 35 }, (_, i) => [`sample-${i + 1}`, i + 1]);
  const seven = pointMovingAverage(points, 7);
  const thirty = pointMovingAverage(points, 30);
  assert.ok(seven.slice(0, 6).every(point => point[1] === null));
  assert.deepEqual(seven[6], ["sample-7", 4]);
  assert.deepEqual(seven[34], ["sample-35", 32]);
  assert.ok(thirty.slice(0, 29).every(point => point[1] === null));
  assert.deepEqual(thirty[29], ["sample-30", 15.5]);
  assert.deepEqual(thirty[34], ["sample-35", 20.5]);
});

test("zero and negative values are real observations; missing data never become zero", () => {
  const points = [-3, -2, -1, 0, 1, 2, 3].map((value, i) => [String(i), value]);
  assert.equal(pointMovingAverage(points, 7).at(-1)[1], 0);
  for (const missing of [null, undefined, NaN, Infinity, "0"]) {
    const withGap = [...points, ["gap", missing], ...points];
    const result = pointMovingAverage(withGap, 7);
    assert.ok(result.slice(7, 14).every(point => point[1] === null));
    assert.equal(result[14][1], 0);
  }
});

test("dates are preserved even across irregular calendar intervals and future data are not used", () => {
  const points = ["2001-01-02", "2001-01-07", "2001-01-15", "2001-02-11", "2002-01-01", "2003-03-01", "2006-04-06", "2006-05-01"]
    .map((date, i) => [date, i + 1]);
  const before = pointMovingAverage(points, 7);
  assert.deepEqual(before.map(point => point[0]), points.map(point => point[0]));
  assert.equal(before[6][1], 4);
  points[7][1] = 100000;
  assert.deepEqual(pointMovingAverage(points, 7).slice(0, 7), before.slice(0, 7));
});

test("raw mode preserves data without mutating the source; the browser receives the tested implementation", () => {
  const points = Object.freeze([Object.freeze(["2026-10-30", -2.31]), Object.freeze(["2026-11-03", 0])]);
  assert.deepEqual(pointMovingAverage(points, 1), points);
  assert.deepEqual(pointMovingAverage(points, 30), [["2026-10-30", null], ["2026-11-03", null]]);
  const browserFunction = require("node:vm").runInNewContext(`(${movingAverageScript()})`);
  assert.equal(JSON.stringify(browserFunction(points, 1)), JSON.stringify(points));
  assert.throws(() => pointMovingAverage(points, 0));
});
