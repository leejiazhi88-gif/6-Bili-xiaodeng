from refresh_cache import atomic_json, full_refresh
import json
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta

from fetch_retail_sentiment_data import ROOT, call_api, get_token


OUTPUT = ROOT / "work" / "large_money_fund_reports.json"
INDEX_CODES = {"sh": "399006.SZ", "k50": "000688.SH", "sz": "000680.SH"}
FIELDS = ("ts_code,name,fund_type,invest_type,type,found_date,due_date")


def request(token, api, params, fields):
    for attempt in range(3):
        try:
            return call_api(token, api, params, fields)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def pages(token, api, params, fields, size=5000):
    offset = 0
    while True:
        rows = request(token, api, {**params, "limit": size, "offset": offset}, fields)
        yield from rows
        offset += len(rows)
        if len(rows) < size:
            break


def active_funds(token):
    selected = {}
    for market in ("E", "O"):
        for status in ("L", "D"):
            for row in pages(token, "fund_basic", {"market": market, "status": status}, FIELDS):
                name = row.get("name") or ""
                if (row.get("fund_type") not in ("股票型", "混合型") or
                        row.get("invest_type") in ("被动指数型", "增强指数型") or
                        re.search(r"ETF|指数|联接|FOF|QDII", name, re.I)):
                    continue
                selected[row["ts_code"]] = row
    return selected


def index_members(token, period):
    start = period[:4] + period[4:6] + "01"
    members = {}
    for key, code in INDEX_CODES.items():
        rows = request(token, "index_weight",
                       {"index_code": code, "start_date": start, "end_date": period},
                       "trade_date,con_code")
        snapshots = defaultdict(set)
        for row in rows:
            snapshots[row["trade_date"]].add(row["con_code"])
        members[key] = snapshots[max(snapshots)] if snapshots else set()
    return members


def report(token, period, funds):
    nav = {}
    for market in ("E", "O"):
        for row in pages(token, "fund_nav", {"nav_date": period, "market": market},
                         "ts_code,nav_date,net_asset"):
            if row["ts_code"] in funds and row.get("net_asset"):
                nav[row["ts_code"]] = float(row["net_asset"])
    holdings = defaultdict(dict)
    for row in pages(token, "fund_portfolio", {"period": period},
                     "ts_code,ann_date,end_date,symbol,mkv,stk_mkv_ratio"):
        code = row["ts_code"]
        if (code not in nav or row.get("end_date") != period or not row.get("symbol") or
                row.get("mkv") is None or row.get("stk_mkv_ratio") is None):
            continue
        previous = holdings[code].get(row["symbol"])
        if previous is None or (row.get("ann_date") or "") >= (previous.get("ann_date") or ""):
            holdings[code][row["symbol"]] = row
    members = index_members(token, period)
    stock_values = {"total": defaultdict(float), **{key: defaultdict(float) for key in INDEX_CODES}}
    total_assets = 0.0
    included = 0
    for code, positions in holdings.items():
        ratio = sum(float(row["stk_mkv_ratio"]) for row in positions.values())
        stock = sum(float(row["mkv"]) for row in positions.values())
        if not 90 <= ratio <= 110 or not 0 < stock <= nav[code] * 1.2:
            continue
        included += 1
        total_assets += nav[code]
        for symbol, row in positions.items():
            value = float(row["mkv"])
            stock_values["total"][symbol] += value
            for key in INDEX_CODES:
                if symbol in members[key]:
                    stock_values[key][symbol] += value
    values = {"date": f"{period[:4]}-{period[4:6]}-{period[6:]}",
              "funds": included, "navFunds": len(nav),
              "coverage": round(included / len(nav) * 100, 1) if nav else 0}
    for key, stocks in stock_values.items():
        amount = sum(stocks.values())
        values[key] = {
            "position": round(amount / total_assets * 100, 2) if amount and total_assets else None,
            "concentration": round(sum(sorted(stocks.values(), reverse=True)[:10]) / amount * 100, 2)
            if amount else None,
        }
    return values


def main():
    token = get_token()
    cached = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {"series": []}
    by_date = {row["date"].replace("-", ""): row for row in cached["series"]}
    today = datetime.now().strftime("%Y%m%d")
    periods = [f"{year}{end}" for year in range(2005, datetime.now().year + 1)
               for end in ("0630", "1231") if f"{year}{end}" <= today]
    checks = cached.get("meta", {}).get("checkedAt", {})
    today_date = datetime.now()
    baseline = cached.get("meta", {}).get("incrementalBaseline", today_date.isoformat())
    recent = set(periods[-2:])
    due = []
    for period in periods:
        age = (today_date - datetime.strptime(period, "%Y%m%d")).days
        # During the disclosure window check daily; afterwards weekly. Older
        # reports get a monthly audit, rather than being frozen forever.
        interval = 1 if age <= 90 else (7 if period in recent else 30)
        checked = datetime.fromisoformat(checks[period]) if period in checks else None
        due_unchecked = checked is None and (period in recent or today_date - datetime.fromisoformat(baseline) >= timedelta(days=30))
        if full_refresh() or period not in by_date or due_unchecked or (checked is not None and today_date - checked >= timedelta(days=interval)):
            due.append(period)
    if not due:
        print("Fund reports already checked within disclosure-aware refresh interval")
        return
    funds = active_funds(token)
    for period in due:
        print(f"Checking fund report {period}", flush=True)
        values = report(token, period, funds)
        if not values["funds"] and by_date.get(period, {}).get("funds"):
            raise RuntimeError(f"No complete fund holdings for {period}; previous output retained")
        if not values["funds"] and period not in by_date:
            print(f"{period}: complete holdings not yet available; no point added", flush=True)
            continue
        by_date[period] = values
        checks[period] = datetime.now().isoformat()
        print(period, values["funds"], values["coverage"], flush=True)
        atomic_json(OUTPUT, {"meta": {
            "source": "Tushare fund_basic + fund_portfolio + fund_nav + index_weight",
            "frequency": "semiannual", "coverageThreshold": 90,
            "checkedAt": checks, "incrementalBaseline": baseline,
            "scope": "active stock/mixed fund sample with >=90% disclosed stock holdings",
        }, "series": [by_date[key] for key in sorted(by_date)]})
    if not by_date:
        raise RuntimeError("No complete fund reports were available")


if __name__ == "__main__":
    main()
