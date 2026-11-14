"""Compute a stock-market-cap, loss-inclusive TTM PE for the STAR Composite."""
import bisect
import json
import time
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fetch_index_profit_data import call_api, get_token, stock_ttm_by_period
from refresh_cache import atomic_json, full_refresh


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "work" / "star_aggregate_pe.json"
INDEX_CODE = "000680.SH"


def fetch(token, api_name, params, fields):
    for attempt in range(4):
        try:
            return call_api(token, api_name, params, fields)
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def weight_snapshots(token, end_date):
    snapshots = {}
    for year in range(2025, int(end_date[:4]) + 1):
        rows = fetch(token, "index_weight", {
            "index_code": INDEX_CODE, "start_date": f"{year}0101",
            "end_date": min(f"{year}1231", end_date),
        }, "trade_date,con_code")
        for row in rows:
            snapshots.setdefault(row["trade_date"], set()).add(row["con_code"])
    if not snapshots:
        raise RuntimeError("No STAR Composite constituents")
    return snapshots


def stock_caps(token, date, members, last_caps):
    rows = fetch(token, "daily_basic", {"trade_date": date},
                    "ts_code,trade_date,total_mv")
    if len(rows) >= 6000:
        raise RuntimeError(f"Possible daily_basic truncation on {date}")
    caps = {row["ts_code"]: float(row["total_mv"]) for row in rows
            if row.get("total_mv") is not None and float(row["total_mv"]) > 0}
    carried = {}
    for code in members - caps.keys():
        if code in last_caps:
            caps[code] = last_caps[code][1]
            carried[code] = last_caps[code][0]
            continue
        start = (datetime.strptime(date, "%Y%m%d") - timedelta(days=45)).strftime("%Y%m%d")
        history = fetch(token, "daily_basic", {
            "ts_code": code, "start_date": start, "end_date": date,
        }, "ts_code,trade_date,total_mv")
        history = [row for row in history if row["trade_date"] < date and row.get("total_mv")]
        if history:
            latest = max(history, key=lambda row: row["trade_date"])
            caps[code] = float(latest["total_mv"])
            carried[code] = latest["trade_date"]
    if members - caps.keys():
        raise RuntimeError(f"Missing market caps on {date}: {sorted(members - caps.keys())}")
    for code in members:
        if code not in carried:
            last_caps[code] = (date, caps[code])
    return caps, carried


def stock_profit(records, date):
    eligible = [row for row in records if row.get("ann_date") and row["ann_date"] <= date]
    periods = stock_ttm_by_period(eligible)
    return periods[max(periods)] if periods else None


def main():
    overview = json.loads((ROOT / "work" / "market_overview_data.json").read_text(encoding="utf-8"))
    income = json.loads((ROOT / "work" / "income_cache.json").read_text(encoding="utf-8"))
    end_date = overview["sz"][-1]["date"].replace("-", "")
    snapshots = weight_snapshots(get_token(), end_date)
    weight_dates = sorted(snapshots)
    dates = [row["date"].replace("-", "") for row in overview["sz"]
             if row["date"].replace("-", "") >= weight_dates[0]]
    existing = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {"rows": []}
    by_date = {row["date"].replace("-", ""): row for row in existing["rows"]}
    refresh_from = (datetime.strptime(end_date, "%Y%m%d") - timedelta(days=35)).strftime("%Y%m%d")
    last_caps = {}
    token = get_token()
    for date in dates:
        if not full_refresh() and date in by_date and date < refresh_from:
            continue
        index = bisect.bisect_right(weight_dates, date) - 1
        members = snapshots[weight_dates[index]]
        caps, carried = stock_caps(token, date, members, last_caps)
        profits = {code: stock_profit(income["income"].get(code, []), date) for code in members}
        matched = {code for code, value in profits.items() if value is not None}
        coverage = len(matched) / len(members)
        if coverage < 0.99:
            raise RuntimeError(f"Incomplete TTM profit coverage on {date}: {coverage:.1%}")
        total_profit = sum(profits[code] for code in matched)
        if total_profit <= 0:
            raise RuntimeError(f"Nonpositive aggregate TTM profit on {date}")
        market_cap = sum(caps[code] for code in matched) * 10000
        by_date[date] = {
            "date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
            "pe": round(market_cap / total_profit, 4),
            "members": len(members), "profitCoverage": round(coverage * 100, 2),
            "carriedPrices": carried,
        }
        if len(by_date) % 20 == 0 or date == dates[-1]:
            atomic_json(OUTPUT, {"meta": {
                "source": "Tushare index_weight + daily_basic + income",
                "method": "sum constituent total market caps / sum available TTM attributable profit, including losses",
                "frequency": "daily", "fetchedAt": datetime.now(timezone.utc).isoformat(),
            }, "rows": [by_date[key] for key in sorted(by_date)]})
            print(date, len(by_date), by_date[date]["pe"], flush=True)


if __name__ == "__main__":
    main()
