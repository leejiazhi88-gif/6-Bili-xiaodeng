from refresh_cache import CACHE_DIR, atomic_json, full_refresh, lookback, merge_rows
import json
import time
from bisect import bisect_right
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from fetch_retail_sentiment_data import ROOT, call_api, get_token


OUTPUT = ROOT / "work" / "large_money_etf_shares.json"
WEEKS = ROOT / "work" / "large_money_sentiment_data.json"
INDEX_CODES = {"sh": "399006.SZ", "k50": "000688.SH", "sz": "000680.SH"}


def request(token, api, params, fields):
    for attempt in range(3):
        try:
            return call_api(token, api, params, fields)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def fund_history(token, fund):
    cache_path = CACHE_DIR / ("etf-" + fund["ts_code"] + ".json")
    cached = json.loads(cache_path.read_text()) if cache_path.exists() and not full_refresh() else {}
    old = cached.get("rows", [])
    today = datetime.now().strftime("%Y%m%d")
    start = lookback(cached["checkedThrough"]) if cached else None
    params = {"end_date": today}
    if start:
        params["start_date"] = start
    rows = []
    offset = 0
    while True:
        page = request(token, "fund_share",
                       {"ts_code": fund["ts_code"], "limit": 2000, "offset": offset, **params},
                       "ts_code,trade_date,fd_share")
        rows.extend(row for row in page if row.get("fd_share") is not None)
        offset += len(page)
        if len(page) < 2000:
            break
    if any(not row.get("trade_date") or row["trade_date"] > today for row in rows):
        raise ValueError("Invalid ETF observation date")
    if not cached and not rows:
        raise ValueError("Empty initial ETF history; refusing to publish an incomplete cache")
    rows = merge_rows(old, rows, ("trade_date",))
    atomic_json(cache_path, {"checkedThrough": today, "rows": rows})
    by_date = {row["trade_date"]: float(row["fd_share"]) / 10000 for row in rows}
    return fund, sorted(by_date), by_date


def main():
    token = get_token()
    funds = {}
    for status in ("L", "D"):
        for fund in request(token, "etf_basic", {"list_status": status},
                            "ts_code,index_code,list_date,delist_date,list_status"):
            if fund.get("index_code") in INDEX_CODES.values():
                funds[fund["ts_code"]] = fund
    if not funds:
        raise RuntimeError("No ETFs tracking the three indices were returned")
    with ThreadPoolExecutor(max_workers=3) as pool:
        histories = list(pool.map(lambda fund: fund_history(token, fund), funds.values()))
    today = datetime.now().strftime("%Y-%m-%d")
    weeks = [row["date"] for row in json.loads(WEEKS.read_text(encoding="utf-8"))["series"]]
    result = []
    for week_label in weeks:
        date = min(week_label, today)
        compact = date.replace("-", "")
        day = datetime.strptime(compact, "%Y%m%d")
        sums = {key: 0.0 for key in INDEX_CODES}
        eligible = {key: 0 for key in INDEX_CODES}
        reported = {key: 0 for key in INDEX_CODES}
        for fund, dates, values in histories:
            key = next(key for key, code in INDEX_CODES.items() if code == fund["index_code"])
            if (not fund.get("list_date") or fund["list_date"] > compact or
                    fund.get("delist_date") and fund["delist_date"] < compact):
                continue
            eligible[key] += 1
            position = bisect_right(dates, compact) - 1
            if position < 0 or (day - datetime.strptime(dates[position], "%Y%m%d")).days > 15:
                continue
            reported[key] += 1
            sums[key] += values[dates[position]]
        if not any(reported.values()):
            continue
        # The source series uses Saturday as a completed-week label. For the
        # still-open current week, use the actual as-of date instead of a
        # future Saturday that could be mistaken for an observed date.
        label = date
        row = {"date": label, "funds": sum(reported.values()),
               "coverage": round(sum(reported.values()) / sum(eligible.values()) * 100, 1)}
        for key in INDEX_CODES:
            row[key] = (round(sums[key], 4) if eligible[key] and
                        reported[key] / eligible[key] >= 0.9 else None)
        row["total"] = (round(sum(sums.values()), 4)
                        if row["coverage"] >= 90 else None)
        result.append(row)
    atomic_json(OUTPUT, {"meta": {
        "source": "Tushare etf_basic + fund_share",
        "scope": "ETF funds tracking 399006.SZ, 000688.SH or 000680.SH; includes delisted funds",
        "unit": "100 million shares", "coverageThreshold": 90,
        "updated": today,
        "dateSemantics": "completed weeks use Saturday labels; the current incomplete week uses the actual as-of date",
    }, "series": result})
    print(json.dumps({"funds": len(funds), "weeks": len(result),
                      "start": result[0]["date"], "end": result[-1]["date"]}))


if __name__ == "__main__":
    main()
