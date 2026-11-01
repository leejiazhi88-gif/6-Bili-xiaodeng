import json
from collections import defaultdict
from datetime import datetime

from fetch_retail_sentiment_data import ROOT, call_api, get_token


OUTPUT = ROOT / "work" / "northbound_index_holdings.json"
INDEX_CODES = {"sh": "399006.SZ", "k50": "000688.SH", "sz": "000680.SH"}


def quarter_dates(token):
    today = datetime.now().strftime("%Y%m%d")
    dates = []
    for year in range(2016, datetime.now().year + 1):
        calendar = call_api(token, "trade_cal", {
            "exchange": "SSE", "start_date": f"{year}0101", "end_date": f"{year}1231",
            "is_open": "1",
        }, "cal_date,is_open")
        opened = sorted(row["cal_date"] for row in calendar)
        for month in (3, 6, 9, 12):
            end = f"{year}{month:02d}31" if month in (3, 12) else f"{year}{month:02d}30"
            eligible = [day for day in opened if day <= end]
            if eligible and end <= today:
                dates.append(eligible[-1])
    return dates


def constituents(token, code, date):
    year, month = int(date[:4]), int(date[4:6])
    for offset in range(7):
        candidate = year * 12 + month - offset
        first = f"{(candidate - 1) // 12}{(candidate - 1) % 12 + 1:02d}01"
        rows = call_api(token, "index_weight", {
            "index_code": code, "start_date": first, "end_date": date,
        }, "trade_date,con_code")
        snapshots = defaultdict(set)
        for row in rows:
            snapshots[row["trade_date"]].add(row["con_code"])
        if snapshots:
            return snapshots[max(snapshots)]
    return set()


def fetch_period(token, date):
    holdings = {}
    for exchange in ("SH", "SZ"):
        for row in call_api(token, "hk_hold", {
            "trade_date": date, "exchange": exchange,
        }, "ts_code,vol"):
            if row.get("vol") is not None:
                holdings[row["ts_code"]] = float(row["vol"])
    if not holdings:
        return None
    closes = {row["ts_code"]: float(row["close"]) for row in call_api(
        token, "daily", {"trade_date": date}, "ts_code,close"
    ) if row.get("close") is not None}
    market_values = {row["ts_code"]: float(row["total_mv"]) / 10000 for row in call_api(
        token, "daily_basic", {"trade_date": date}, "ts_code,total_mv"
    ) if row.get("total_mv") is not None}
    values = {"date": f"{date[:4]}-{date[4:6]}-{date[6:]}"}
    for key, code in INDEX_CODES.items():
        members = constituents(token, code, date)
        eligible = members & market_values.keys()
        north_value = sum(holdings.get(stock, 0) * closes.get(stock, 0) / 1e8 for stock in eligible)
        index_value = sum(market_values[stock] for stock in eligible)
        values[key] = {
            "value": round(north_value, 2) if members and index_value else None,
            "ratio": round(north_value / index_value * 100, 3) if members and index_value else None,
            "members": len(members), "pricedMembers": len(eligible),
        }
    return values


def main():
    token = get_token()
    cached = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {"series": []}
    by_date = {row["date"].replace("-", ""): row for row in cached["series"]}
    dates = quarter_dates(token)
    for date in dates:
        if date in by_date:
            continue
        row = fetch_period(token, date)
        if row is None:
            continue
        by_date[date] = row
        print(date, *(row[key]["value"] for key in INDEX_CODES), flush=True)
        OUTPUT.write_text(json.dumps({"meta": {
            "source": "Tushare hk_hold + daily + daily_basic + index_weight",
            "frequency": "quarterly", "valueUnit": "100 million CNY",
            "ratioDenominator": "sum of constituent total market capitalizations",
        }, "series": [by_date[key] for key in sorted(by_date)]},
            ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if not by_date:
        raise RuntimeError("No northbound holdings were available")


if __name__ == "__main__":
    main()
