const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { tasksFor, refreshMode, runTasks, withRefreshLock } = require("../work/refresh_dashboard_data");
const quiet = { log: () => {} };

test("daily refresh excludes fund scans; reports and full retain explicit verification", () => {
  assert.equal(tasksFor("daily").length, 12);
  assert.ok(!tasksFor("daily").some(task => task.id === "fundReports"));
  assert.deepEqual(tasksFor("reports").map(task => task.id), ["fundReports"]);
  assert.equal(tasksFor("full").length, 13);
  assert.deepEqual(tasksFor("cached"), []);
  assert.equal(refreshMode(["--reports"]), "reports");
  assert.throws(() => refreshMode(["--cached", "--full"]));
  const after = Object.fromEntries(tasksFor("daily").map(task => [task.id, task.after]));
  assert.deepEqual(after.valuation, ["market"]);
  assert.deepEqual(after.starHistory, ["starSnapshot"]);
  assert.deepEqual(after.retailIndices, ["retail"]);
  assert.deepEqual(after.etf, ["largeMoney"]);
});

test("independent jobs overlap, downstream jobs see completed inputs, concurrency is bounded", async () => {
  const done = new Set();
  let active = 0, maximum = 0;
  const tasks = [{ id: "slow" }, { id: "fast" }, { id: "derived", after: ["fast"] }, { id: "last", after: ["slow", "derived"] }];
  const records = await runTasks(tasks, async task => {
    assert.ok((task.after || []).every(id => done.has(id)));
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, task.id === "slow" ? 30 : 2));
    done.add(task.id);
    active--;
  }, quiet);
  assert.equal(maximum, 2);
  assert.deepEqual(new Set(records.map(row => row.id)), new Set(tasks.map(task => task.id)));
  assert.ok(records.findIndex(row => row.id === "derived") < records.findIndex(row => row.id === "slow"));
});

test("failure stops new jobs, waits for active writers, and rejects before page generation", async () => {
  const started = [], records = [];
  let writerFinished = false;
  await assert.rejects(runTasks([{ id: "bad" }, { id: "writer" }, { id: "next" }, { id: "dependent", after: ["bad"] }], async task => {
    started.push(task.id);
    if (task.id === "bad") throw new Error("upstream down");
    await new Promise(resolve => setTimeout(resolve, 10));
    writerFinished = true;
  }, { ...quiet, records }), /bad/);
  assert.deepEqual(started, ["bad", "writer"]);
  assert.equal(writerFinished, true);
  assert.equal(records.find(row => row.id === "bad").status, "failed");
});

test("invalid dependency graphs fail instead of silently omitting refresh work", async () => {
  await assert.rejects(runTasks([{ id: "a", after: ["missing"] }], async () => {}, quiet), /Missing dependency/);
  await assert.rejects(runTasks([{ id: "a", after: ["b"] }, { id: "b", after: ["a"] }], async () => {}, quiet), /Cycle/);
});

test("only one refresh/build writes the deployment files and locks release on failure", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiaodeng-refresh-"));
  try {
    await assert.rejects(withRefreshLock(async () => {
      await assert.rejects(withRefreshLock(async () => {}, root), /already running/);
      throw new Error("failed refresh");
    }, root), /failed refresh/);
    await withRefreshLock(async () => {}, root);
    assert.ok(!fs.existsSync(path.join(root, "work", ".refresh-cache", "dashboard.lock")));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
