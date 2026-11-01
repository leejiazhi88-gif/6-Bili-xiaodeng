import calendar
import json
import re
import ssl
import sys
import urllib.request
from bisect import bisect_right
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path.home() / ".codex" / "config.toml"
OUTPUT = ROOT / "work" / "large_money_sentiment_data.json"
INDEX_OUTPUT = ROOT / "work" / "large_money_index_data.json"
START_YEAR = 2002
END_YEAR = datetime.now().year
END_DATE = datetime.now().strftime("%Y%m%d")
STOCK_CODE = re.compile(
    r"^(?:(?:600|601|603|605|688|689)\d{3}\.SH|"
    r"(?:000|001|002|003|300|301)\d{3}\.SZ|"
    r"(?:43|83|87|88|92)\d{4}\.BJ)$"
)
INDEX_CODES = {"sh": "399006.SZ", "k50": "000688.SH", "sz": "000680.SH"}


def get_token():
    text = CONFIG.read_text(encoding="utf-8")
    match = re.search(r"https://api\.tushare\.pro/mcp/\?token=([^'\"&\s]+)", text)
    if not match:
        raise RuntimeError("Tushare token was not found.")
    return match.group(1)


def call_api(token, api_name, params, fields):
    payload = json.dumps(
        {"api_name": api_name, "token": token, "params": params, "fields": fields}
    ).encode("utf-8")
    request = urllib.request.Request(
        "https://api.tushare.pro",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    context = ssl._create_unverified_context()
    with urllib.request.urlopen(request, timeout=90, context=context) as response:
        result = json.loads(response.read().decode("utf-8"))
    if result.get("code") != 0:
        raise RuntimeError(f"{api_name}: {result.get('msg')}")
    data = result.get("data") or {}
    return [dict(zip(data.get("fields", []), row)) for row in data.get("items", [])]


def month_ranges():
    for year in range(START_YEAR, END_YEAR + 1):
        for month in range(1, 13):
            if year == END_YEAR and month > int(END_DATE[4:6]):
                return
            last = calendar.monthrange(year, month)[1]
            end = f"{year}{month:02d}{last:02d}"
            if year == END_YEAR and month == int(END_DATE[4:6]):
                end = END_DATE
            yield f"{year}{month:02d}01", end


def week_key(date):
    dt = datetime.strptime(date, "%Y%m%d")
    iso = dt.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def week_end_date(dates):
    day = datetime.strptime(dates[0], "%Y%m%d")
    return (day + timedelta(days=5 - day.weekday())).strftime("%Y%m%d")


def complete_window(token, api_name, start, end, fields, limit):
    rows = call_api(token, api_name, {"start_date": start, "end_date": end}, fields)
    if len(rows) < limit or start == end:
        return rows
    midpoint = datetime.strptime(start, "%Y%m%d") + (datetime.strptime(end, "%Y%m%d") - datetime.strptime(start, "%Y%m%d")) / 2
    left_end = midpoint.strftime("%Y%m%d")
    right_start = (midpoint + timedelta(days=1)).strftime("%Y%m%d")
    return (complete_window(token, api_name, start, left_end, fields, limit)
            + complete_window(token, api_name, right_start, end, fields, limit))


def index_memberships(token):
    memberships = {}
    for key, code in INDEX_CODES.items():
        by_date = defaultdict(set)
        first_year = 2010 if key == "sh" else 2019
        for year in range(first_year, END_YEAR + 1):
            for month in range(1, 13):
                start = f"{year}{month:02d}01"
                if start > END_DATE:
                    break
                end = min(f"{year}{month:02d}{calendar.monthrange(year, month)[1]:02d}", END_DATE)
                rows = call_api(token, "index_weight",
                                {"index_code": code, "start_date": start, "end_date": end},
                                "trade_date,con_code")
                for row in rows:
                    by_date[row["trade_date"]].add(row["con_code"])
        memberships[key] = (sorted(by_date), by_date)
    return memberships


def main():
    token = get_token()
    previous = (json.loads(OUTPUT.read_text(encoding="utf-8"))
                if OUTPUT.exists() and INDEX_OUTPUT.exists() and "--full" not in sys.argv else None)
    previous_indices = (json.loads(INDEX_OUTPUT.read_text(encoding="utf-8"))
                        if previous else None)
    memberships = index_memberships(token)
    previous_start = previous["series"][0]["date"].replace("-", "") if previous else None
    refresh_start = None
    if previous:
        last = datetime.strptime(previous["meta"]["end"], "%Y-%m-%d")
        refresh_start = (last - timedelta(days=last.weekday())).strftime("%Y%m%d")
    north = []
    for year in range(2014, 2025):
        north.extend(complete_window(token, "moneyflow_hsgt", f"{year}0101",
                                     min(f"{year}1231", "20240816"),
                                     "trade_date,north_money", 300))
    blocks = []
    holder_trades = []
    ranges = []
    for start, end in month_ranges():
        if previous and start >= previous_start and end < refresh_start:
            continue
        ranges.append((start, end))

    def fetch_month(window):
        start, end = window
        block_rows = complete_window(token, "block_trade", start, end,
                                     "ts_code,trade_date,amount,buyer,seller", 1000)
        holder_rows = complete_window(token, "stk_holdertrade", start, end,
                                      "ts_code,ann_date,holder_name,in_de,change_vol,change_ratio,avg_price", 2000)
        return ([row for row in block_rows if STOCK_CODE.fullmatch(row.get("ts_code") or "")],
                [row for row in holder_rows if STOCK_CODE.fullmatch(row.get("ts_code") or "")
                 and row.get("avg_price") is not None and float(row["avg_price"]) > 0])

    with ThreadPoolExecutor(max_workers=3) as executor:
        for index, (month_blocks, month_holders) in enumerate(executor.map(fetch_month, ranges), 1):
            blocks.extend(month_blocks)
            holder_trades.extend(month_holders)
            if index % 24 == 0:
                print(f"large money refresh: {index}/{len(ranges)} months", flush=True)

    block_weeks = defaultdict(lambda: {"dates": [], "amount": 0.0, "instNet": 0.0})
    index_weeks = {key: defaultdict(lambda: {"blockAmount": 0.0,
                                             "institutionBlockNet": 0.0,
                                             "holderNetAmount": 0.0}) for key in INDEX_CODES}

    def member_indices(code, date):
        for key, (dates, by_date) in memberships.items():
            position = bisect_right(dates, date) - 1
            if position >= 0 and code in by_date[dates[position]]:
                yield key

    for row in blocks:
        key = week_key(row["trade_date"])
        amount = float(row.get("amount") or 0) / 10000
        item = block_weeks[key]
        item["dates"].append(row["trade_date"])
        item["amount"] += amount
        buyer_inst = "机构专用" in str(row.get("buyer") or "")
        seller_inst = "机构专用" in str(row.get("seller") or "")
        if buyer_inst and not seller_inst:
            item["instNet"] += amount
        elif seller_inst and not buyer_inst:
            item["instNet"] -= amount
        for key_name in member_indices(row["ts_code"], row["trade_date"]):
            index_weeks[key_name][key]["blockAmount"] += amount
            if buyer_inst and not seller_inst:
                index_weeks[key_name][key]["institutionBlockNet"] += amount
            elif seller_inst and not buyer_inst:
                index_weeks[key_name][key]["institutionBlockNet"] -= amount

    unique_holder_rows = {}
    for row in holder_trades:
        identity = (
            row.get("ts_code"),
            row.get("ann_date"),
            row.get("holder_name"),
            row.get("in_de"),
            row.get("change_vol"),
            row.get("change_ratio"),
        )
        unique_holder_rows[identity] = row
    holder_weeks = defaultdict(lambda: {"dates": [], "netShares": 0.0, "netAmount": 0.0})
    for row in unique_holder_rows.values():
        date = row.get("ann_date")
        if not date:
            continue
        key = week_key(date)
        shares = float(row.get("change_vol") or 0) / 1e8
        signed = shares if row.get("in_de") == "IN" else -shares
        holder_weeks[key]["dates"].append(date)
        holder_weeks[key]["netShares"] += signed
        amount = signed * float(row["avg_price"])
        holder_weeks[key]["netAmount"] += amount
        for key_name in member_indices(row["ts_code"], date):
            index_weeks[key_name][key]["holderNetAmount"] += amount

    north_weeks = {}
    for row in sorted(north, key=lambda item: item["trade_date"]):
        key = week_key(row["trade_date"])
        north_weeks[key] = {
            "date": row["trade_date"],
            "northMoney": float(row.get("north_money") or 0) / 100,
        }

    keys = sorted(set(block_weeks) | set(holder_weeks) | set(north_weeks))
    series = []
    for key in keys:
        dates = []
        if key in block_weeks:
            dates.extend(block_weeks[key]["dates"])
        if key in holder_weeks:
            dates.extend(holder_weeks[key]["dates"])
        if key in north_weeks:
            dates.append(north_weeks[key]["date"])
        date = week_end_date(dates)
        block = block_weeks.get(key, {})
        holder = holder_weeks.get(key, {})
        north_row = north_weeks.get(key, {})
        series.append(
            {
                "date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
                "northMoney": round(north_row["northMoney"], 2)
                if "northMoney" in north_row
                else None,
                "blockAmount": round(block["amount"], 2) if block else None,
                "institutionBlockNet": round(block["instNet"], 2) if block else None,
                "holderNetShares": round(holder["netShares"], 4) if holder else None,
                "holderNetAmount": round(holder["netAmount"], 4) if holder else None,
            }
        )

    # Preserve published history; refresh the previous latest week and newer weeks.
    # Historical API windows can return fewer records on subsequent requests.
    if previous:
        refresh_start = f"{refresh_start[:4]}-{refresh_start[4:6]}-{refresh_start[6:]}"
        first = previous["series"][0]["date"]
        fresh_by_week = {week_key(row["date"].replace("-", "")): row for row in series}
        preserved = []
        for row in previous["series"]:
            if not first <= row["date"] < refresh_start:
                continue
            fresh = fresh_by_week.get(week_key(row["date"].replace("-", "")))
            if fresh and fresh["northMoney"] is not None:
                row["northMoney"] = fresh["northMoney"]
            preserved.append(row)
        series = ([row for row in series if row["date"] < first]
                  + preserved + [row for row in series if row["date"] >= refresh_start])

    for row in series:
        date = week_end_date([row["date"].replace("-", "")])
        row["date"] = f"{date[:4]}-{date[4:6]}-{date[6:]}"

    week_dates = {week_key(row["date"].replace("-", "")): row["date"] for row in series}
    index_series = {}
    for key, (snapshot_dates, _) in memberships.items():
        fresh = []
        if snapshot_dates:
            first_week = week_key(snapshot_dates[0])
            for week in keys:
                if week < first_week:
                    continue
                date = week_dates[week]
                values = index_weeks[key][week]
                fresh.append({"date": date,
                              **{field: round(value, 4) for field, value in values.items()}})
        if previous_indices:
            start = refresh_start
            fresh = ([row for row in previous_indices[key] if row["date"] < start]
                     + [row for row in fresh if row["date"] >= start])
        index_series[key] = fresh

    result = {
        "meta": {
            "updated": datetime.now().strftime("%Y-%m-%d"),
            "start": series[0]["date"],
            "end": series[-1]["date"],
            "northEnd": "2024-08-16",
            "sources": {
                "north": "Tushare moneyflow_hsgt",
                "block": "Tushare block_trade",
                "holder": "Tushare stk_holdertrade (priced A-share trades only)",
            },
        },
        "series": series,
    }
    OUTPUT.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    INDEX_OUTPUT.write_text(
        json.dumps({"meta": {"updated": datetime.now().strftime("%Y-%m-%d"),
                             "source": "Tushare index_weight, block_trade, stk_holdertrade",
                             "holderAmountUnit": "100 million yuan"},
                    **index_series}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(json.dumps({"output": str(OUTPUT), "points": len(series)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
