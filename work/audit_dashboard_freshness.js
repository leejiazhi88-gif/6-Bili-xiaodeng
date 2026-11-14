const fs = require("node:fs");
const path = require("node:path");

const SOURCES = [
  "market_overview_data", "index_profit_data", "valuation_data", "star_aggregate_pe", "star_official_history", "star_official_valuation",
  "retail_sentiment_data", "retail_index_metrics", "retail_weekly_averages", "large_money_sentiment_data",
  "large_money_index_data", "large_money_fund_reports", "large_money_etf_shares",
  "northbound_index_holdings", "official_sentiment_data", "refinancing_data",
];

function inspect(data) {
  const series = {};
  function visit(value, key) {
    if (Array.isArray(value)) {
      const rows = value.filter(row => row && typeof row.date === "string").sort((a, b) => a.date.localeCompare(b.date));
      if (!rows.length) return;
      const latestValues = {};
      function fields(row, prefix, date) {
        for (const [name, item] of Object.entries(row)) {
          const field = prefix ? prefix + "." + name : name;
          if (typeof item === "number" && Number.isFinite(item)) latestValues[field] = date;
          else if (item && typeof item === "object" && !Array.isArray(item)) fields(item, field, date);
        }
      }
      rows.forEach(row => fields(row, "", row.date));
      series[key] = { rows: rows.length, firstDate: rows[0].date, lastDate: rows.at(-1).date, latestValidDate: latestValues };
    } else if (value && typeof value === "object") {
      for (const [name, item] of Object.entries(value)) if (name !== "meta") visit(item, key ? key + "." + name : name);
    }
  }
  visit(data, "");
  return { meta: data.meta || {}, series };
}

function audit(root = path.resolve(__dirname, "..")) {
  const sources = Object.fromEntries(SOURCES.map(name => [name,
    inspect(JSON.parse(fs.readFileSync(path.join(root, "work", name + ".json"), "utf8")))]));
  const report = { inspectedAt: new Date().toISOString(),
    note: "Dates are valid row/period labels and may be weekly or monthly labels, not actual observation dates. Read source meta for as-of/check dates. Compare daily, monthly, quarterly and semiannual disclosure schedules separately; this report alone does not prove source freshness.", sources };
  fs.writeFileSync(path.join(root, "outputs", "data_freshness.json"), JSON.stringify(report, null, 2));
  return report;
}

module.exports = { inspect, audit };
if (require.main === module) audit();
