const fs = require("fs");
const path = require("path");
const { spawn, spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
// Long jobs start first. Dependencies protect the files reused downstream.
const TASKS = [
  { id: "profit", file: "fetch_index_profit_data.py" },
  { id: "starAggregatePe", file: "fetch_star_aggregate_pe.py", after: ["profit", "market"] },
  { id: "largeMoney", file: "fetch_large_money_sentiment_data.py" },
  { id: "retail", file: "fetch_retail_sentiment_data.py" },
  { id: "market", file: "fetch_market_overview_data.py" },
  { id: "starSnapshot", file: "fetch_star_official_valuation.py" },
  { id: "starHistory", file: "fetch_star_official_history.py", after: ["starSnapshot"] },
  { id: "retailWeeklyMeans", file: "fetch_retail_weekly_averages.py", after: ["market", "retailIndices"] },
  { id: "retailIndices", file: "fetch_retail_index_metrics.py", after: ["retail"] },
  { id: "etf", file: "fetch_large_money_etf_assets.py", after: ["largeMoney"] },
  { id: "valuation", file: "fetch_valuation_data.py", after: ["market"] },
  { id: "refinancing", file: "fetch_refinancing_data.py" },
  { id: "official", file: "fetch_official_sentiment_data.py" },
  { id: "northHoldings", file: "fetch_northbound_index_holdings.py" },
];
const FUND_TASK = { id: "fundReports", file: "fetch_large_money_fund_reports.py" };

function refreshMode(args = process.argv.slice(2)) {
  const modes = ["cached", "reports", "full"].filter(mode => args.includes(`--${mode}`));
  if (modes.length > 1) throw new Error("Use only one of --cached, --reports or --full");
  return modes[0] || (process.env.XIAODENG_REFRESH_FULL === "1" ? "full" : "daily");
}

function tasksFor(mode) {
  if (mode === "cached") return [];
  if (mode === "reports") return [FUND_TASK];
  if (mode === "full") return [FUND_TASK, ...TASKS];
  if (mode === "daily") return [FUND_TASK, ...TASKS];
  throw new Error(`Unknown refresh mode: ${mode}`);
}

async function runTasks(tasks, run, { concurrency = 2, log = console.log, records = [] } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Invalid concurrency");
  const pending = new Map(tasks.map(task => [task.id, task]));
  if (pending.size !== tasks.length) throw new Error("Duplicate refresh task");
  for (const task of tasks) {
    if ((task.after || []).some(id => !pending.has(id))) throw new Error(`Missing dependency: ${task.id}`);
  }
  const complete = new Set();
  const active = new Map();
  let failure;
  function start(task) {
    pending.delete(task.id);
    const began = performance.now();
    log(`[refresh] ${task.id}: started`);
    const promise = Promise.resolve().then(() => run(task)).then(result => {
      complete.add(task.id);
      records.push({ id: task.id, status: "complete", ...result, seconds: +((performance.now() - began) / 1000).toFixed(2) });
      log(`[refresh] ${task.id}: completed in ${records.at(-1).seconds}s`);
    }, error => {
      failure ||= new Error(`Data refresh failed: ${task.id}`, { cause: error });
      records.push({ id: task.id, status: "failed", seconds: +((performance.now() - began) / 1000).toFixed(2) });
      log(`[refresh] ${task.id}: failed`);
    }).finally(() => active.delete(task.id));
    active.set(task.id, promise);
  }
  while (pending.size || active.size) {
    if (!failure) {
      for (const task of pending.values()) {
        if (active.size >= concurrency) break;
        if ((task.after || []).every(id => complete.has(id))) start(task);
      }
    }
    if (!active.size) {
      if (failure) break;
      throw new Error("Cycle in refresh dependencies");
    }
    await Promise.race(active.values());
  }
  if (failure) throw failure;
  return records;
}

function findPython() {
  const local = path.join(ROOT, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const candidates = [process.env.CODEX_PYTHON, process.env.PYTHON, local, "python3", "python"].filter(Boolean);
  const python = candidates.find(cmd => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0);
  if (!python) throw new Error("Unable to find a usable Python interpreter");
  return python;
}

function runPython(python, task, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-u", path.join(__dirname, task.file)], { cwd: ROOT, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${task.file}: ${signal || code}`)));
  });
}

async function runRefresh(mode) {
  if (mode === "cached") return;
  const python = findPython();
  const env = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", XIAODENG_REFRESH_FULL: mode === "full" ? "1" : "0" };
  // Python.org builds on macOS may lack a CA bundle. Use the system's trusted
  // roots, preserving verification; explicit user-provided CA settings win.
  if (process.platform === "darwin" && !env.SSL_CERT_FILE) {
    const target = path.join(__dirname, ".refresh-cache", "system-ca.pem");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const roots = execFileSync("security", ["find-certificate", "-a", "-p", "/System/Library/Keychains/SystemRootCertificates.keychain"]);
    const system = execFileSync("security", ["find-certificate", "-a", "-p", "/Library/Keychains/System.keychain"]);
    fs.writeFileSync(target, Buffer.concat([roots, system]));
    env.SSL_CERT_FILE = target;
  }
  const target = path.join(__dirname, ".refresh-cache", "last-refresh.json");
  const save = () => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(summary, null, 2));
    fs.renameSync(temporary, target);
  };
  let previous;
  try { previous = JSON.parse(fs.readFileSync(target, "utf8")); } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  const summary = { mode, startedAt: new Date().toISOString(), status: "running", tasks: [], checkpoints: {}, baselines: {} };
  try {
    console.log("[refresh] preflight: checking dependencies, credentials, TLS and exchange calendar");
    const context = JSON.parse(execFileSync(python, [path.join(__dirname, "refresh_preflight.py")], { env, encoding: "utf8", timeout: 60000 }));
    summary.context = context;
    summary.fundReports = context.fundReports;
    console.log(`[refresh] expected closing session: ${context.expectedSession}; fund report ${context.fundReports.latestReportDate}; due: ${context.fundReports.duePeriods.join(", ") || "none"}`);
    await require("./refresh_execution").executeVerifiedTasks({ root: ROOT, tasks: tasksFor(mode), mode, context,
      summary, previous, runTasks, run: task => runPython(python, task, env), save });
    // A fresh process with an unchanged source is a successful check, not
    // proof of a new observation. Publish those distinctions explicitly.
    const checks = Object.values(summary.checkpoints).flatMap(item => item.checks);
    summary.warnings = checks.filter(item => item.status !== "current" || item.missingAtLatestRow);
    fs.mkdirSync(path.join(ROOT, "outputs"), { recursive: true });
    const health = { checkedAt: new Date().toISOString(), mode, expectedSession: context.expectedSession,
      note: "checkedAt validates task output, not a new disclosure date. Source/report dates and fund checkedAt remain in data_freshness.json. executed tasks may reuse source caches; resumed outputs retain their original validation time.",
      status: summary.warnings.length ? "complete_with_source_lags" : "current",
      marginDetailRowsAtExpectedSession: context.marginDetailRowsAtExpectedSession,
      tasks: Object.entries(summary.checkpoints).map(([id,item]) => ({id, checkedAt:item.checkedAt, execution:item.execution, contentChanged:item.contentChanged})),
      checks, warnings: summary.warnings };
    const temporary = path.join(ROOT, "outputs", `refresh_health.${process.pid}.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(health, null, 2));
    fs.renameSync(temporary, path.join(ROOT, "outputs", "refresh_health.json"));
    summary.status = "complete";
    console.log(`[refresh] validation: ${checks.length} field checks; ${summary.warnings.length} source/period lag notices (see outputs/refresh_health.json)`);
  } catch (error) {
    summary.status = "failed";
    summary.error = error.message;
    throw error;
  } finally {
    summary.finishedAt = new Date().toISOString();
    summary.seconds = (Date.parse(summary.finishedAt) - Date.parse(summary.startedAt)) / 1000;
    save();
    console.log(`[refresh] ${mode}: ${summary.status}, ${summary.seconds}s; task timings saved in work/.refresh-cache/last-refresh.json`);
  }
}

async function withRefreshLock(operation, root = ROOT) {
  const lock = path.join(root, "work", ".refresh-cache", "dashboard.lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (;;) {
    try {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: "wx" });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Serialize stale-lock recovery so two new runs cannot both remove an
      // abandoned lock and accidentally remove the other's replacement.
      const recovery = `${lock}.recovery`;
      try { fs.mkdirSync(recovery); }
      catch (busy) {
        if (busy.code === "EEXIST") throw new Error("Another process is acquiring the dashboard lock");
        throw busy;
      }
      try {
        if (!fs.existsSync(lock)) continue;
        const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error("Invalid dashboard lock; inspect work/.refresh-cache/dashboard.lock");
        try { process.kill(owner.pid, 0); }
        catch (probe) {
          if (probe.code === "ESRCH") { fs.unlinkSync(lock); continue; }
        }
        throw new Error(`Dashboard refresh already running (PID ${owner.pid})`);
      } finally { fs.rmdirSync(recovery); }
    }
  }
  try { return await operation(); }
  finally { fs.unlinkSync(lock); }
}

module.exports = { refreshMode, tasksFor, runTasks, runRefresh, withRefreshLock };
if (require.main === module) {
  const mode = refreshMode();
  if (process.argv.includes("--plan")) console.log(JSON.stringify({ mode, concurrency: 2, tasks: tasksFor(mode) }, null, 2));
  else withRefreshLock(() => runRefresh(mode)).catch(error => { console.error(error); process.exitCode = 1; });
}
