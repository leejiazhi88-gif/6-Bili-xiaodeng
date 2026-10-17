import json
import re
import ssl
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path.home() / ".codex" / "config.toml"
OUTPUT = ROOT / "work" / "retail_sentiment_data.json"
START_YEAR = 2016
END_YEAR = 2026
END_DATE = "20261016"


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


def yearly(token, api_name, base_params, fields, start_year=START_YEAR):
    rows = []
    for year in range(start_year, END_YEAR + 1):
        end_date = END_DATE if year == END_YEAR else f"{year}1231"
        rows.extend(
            call_api(
                token,
                api_name,
                {
                    **base_params,
                    "start_date": f"{year}0101",
                    "end_date": end_date,
                },
                fields,
            )
        )
    return rows


def monthly_limit_counts(token):
    counts = defaultdict(int)
    for year in range(2020, END_YEAR + 1):
        for month in range(1, 13):
            if f"{year}{month:02d}01" > END_DATE:
                break
            start = f"{year}{month:02d}01"
            next_year = year + (month == 12)
            next_month = 1 if month == 12 else month + 1
            end = min(datetime(next_year, next_month, 1).strftime("%Y%m%d"), END_DATE)
            rows = call_api(
                token,
                "limit_list_d",
                {"start_date": start, "end_date": end, "limit_type": "U"},
                "trade_date,ts_code",
            )
            for row in rows:
                counts[row["trade_date"]] += 1
    return counts


def last_by_week(rows):
    result = []
    current = None
    for row in rows:
        date = datetime.strptime(row["date"], "%Y-%m-%d")
        key = (date.isocalendar().year, date.isocalendar().week)
        if key != current:
            result.append(row)
            current = key
        else:
            result[-1] = row
    return result


def main():
    token = get_token()
    market_rows = []
    for exchange, market_code in (("SH", "SH_MARKET"), ("SZ", "SZ_MARKET")):
        rows = yearly(
            token,
            "daily_info",
            {"exchange": exchange},
            "trade_date,ts_code,float_mv,amount,tr,exchange",
        )
        market_rows.extend(row for row in rows if row.get("ts_code") == market_code)

    margins = []
    for exchange in ("SSE", "SZSE"):
        margins.extend(
            yearly(
                token,
                "margin",
                {"exchange_id": exchange},
                "trade_date,exchange_id,rzye,rzmre",
            )
        )

    limit_counts = monthly_limit_counts(token)
    market_by_date = defaultdict(list)
    margin_by_date = defaultdict(list)
    for row in market_rows:
        market_by_date[row["trade_date"]].append(row)
    for row in margins:
        margin_by_date[row["trade_date"]].append(row)

    series = []
    latest_margin = {}
    for date in sorted(market_by_date):
        for row in margin_by_date.get(date, []):
            latest_margin[row["exchange_id"]] = row
        markets = market_by_date[date]
        if len(markets) < 2:
            continue
        amount = sum(float(row.get("amount") or 0) for row in markets)
        float_mv = sum(float(row.get("float_mv") or 0) for row in markets)
        turnover = (
            sum(
                float(row.get("tr") or 0) * float(row.get("float_mv") or 0)
                for row in markets
            )
            / float_mv
            if float_mv
            else None
        )
        margin_rows = [
            latest_margin[exchange]
            for exchange in ("SSE", "SZSE")
            if exchange in latest_margin
        ]
        margin_balance = sum(float(row.get("rzye") or 0) for row in margin_rows) / 1e8
        margin_buy = sum(float(row.get("rzmre") or 0) for row in margin_rows) / 1e8
        series.append(
            {
                "date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
                "amount": round(amount, 2),
                "turnover": round(turnover, 4) if turnover is not None else None,
                "marginBalance": round(margin_balance, 2) if margin_rows else None,
                "marginFloatRatio": (
                    round(margin_balance / float_mv * 100, 4)
                    if margin_rows and float_mv
                    else None
                ),
                "marginBuyRatio": (
                    round(margin_buy / amount * 100, 4)
                    if margin_rows and amount
                    else None
                ),
                "limitUpCount": limit_counts.get(date),
            }
        )

    result = {
        "meta": {
            "updated": datetime.now().strftime("%Y-%m-%d"),
            "start": series[0]["date"],
            "end": series[-1]["date"],
            "frequency": "weekly",
            "sources": {
                "market": "Tushare daily_info",
                "margin": "Tushare margin",
                "limit": "Tushare limit_list_d (available since 2020)",
            },
        },
        "series": last_by_week(series),
    }
    OUTPUT.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(OUTPUT),
                "points": len(result["series"]),
                "start": result["meta"]["start"],
                "end": result["meta"]["end"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
