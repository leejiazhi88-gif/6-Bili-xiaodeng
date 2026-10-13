import calendar
import json
import re
import ssl
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path.home() / ".codex" / "config.toml"
OUTPUT = ROOT / "work" / "official_sentiment_data.json"
START_YEAR = 2010
END_YEAR = 2026
END_DATE = "20261013"

STAMP_DUTY_EVENTS = [
    ("20080501", 0.3),
    ("20080919", 0.1),
    ("20230828", 0.05),
]


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


def year_ranges(start_year=START_YEAR):
    for year in range(start_year, END_YEAR + 1):
        end = END_DATE if year == END_YEAR else f"{year}1231"
        yield f"{year}0101", end


def month_ranges(start_year=START_YEAR):
    for year in range(start_year, END_YEAR + 1):
        for month in range(1, 13):
            start = f"{year}{month:02d}01"
            if start > END_DATE:
                return
            last = calendar.monthrange(year, month)[1]
            end = min(f"{year}{month:02d}{last:02d}", END_DATE)
            yield start, end


def month_key_from_date(date):
    return date[:6]


def month_end(month):
    year = int(month[:4])
    mon = int(month[4:])
    last = calendar.monthrange(year, mon)[1]
    raw = f"{year}{mon:02d}{last:02d}"
    date = min(raw, END_DATE)
    return f"{date[:4]}-{date[4:6]}-{date[6:]}"


def active_stamp_rate(month):
    date = f"{month}28"
    rate = STAMP_DUTY_EVENTS[0][1]
    for event_date, event_rate in STAMP_DUTY_EVENTS:
        if date >= event_date:
            rate = event_rate
    return rate


def main():
    token = get_token()
    ipos = []
    holder_trades = []
    for start, end in year_ranges():
        ipos.extend(
            call_api(
                token,
                "new_share",
                {"start_date": start, "end_date": end},
                "ts_code,ipo_date,issue_date,amount,price,funds",
            )
        )
    for start, end in month_ranges(2018):
        holder_trades.extend(
            call_api(
                token,
                "stk_holdertrade",
                {"start_date": start, "end_date": end},
                "ts_code,ann_date,holder_name,in_de,change_vol,avg_price",
            )
        )
    money = call_api(
        token,
        "cn_m",
        {"start_m": f"{START_YEAR}01", "end_m": END_DATE[:6]},
        "month,m2,m2_yoy,m1,m1_yoy",
    )
    social = call_api(
        token,
        "sf_month",
        {"start_m": f"{START_YEAR}01", "end_m": END_DATE[:6]},
        "month,inc_month",
    )
    lpr = call_api(
        token,
        "shibor_lpr",
        {"start_date": f"{START_YEAR}0101", "end_date": END_DATE},
        "date,1y,5y",
    )

    ipo_by_month = defaultdict(lambda: {"funds": 0.0, "count": 0})
    for row in ipos:
        date = row.get("ipo_date") or row.get("issue_date")
        if not date:
            continue
        item = ipo_by_month[month_key_from_date(date)]
        item["funds"] += float(row.get("funds") or 0)
        item["count"] += 1

    holder_by_month = defaultdict(lambda: {"reduction": 0.0, "increase": 0.0, "net": 0.0})
    unique_holder_rows = {}
    for row in holder_trades:
        identity = (
            row.get("ts_code"),
            row.get("ann_date"),
            row.get("holder_name"),
            row.get("in_de"),
            row.get("change_vol"),
            row.get("avg_price"),
        )
        unique_holder_rows[identity] = row
    for row in unique_holder_rows.values():
        date = row.get("ann_date")
        price = row.get("avg_price")
        if not date or price is None:
            continue
        amount_yi = float(row.get("change_vol") or 0) * float(price) / 100000000
        item = holder_by_month[month_key_from_date(date)]
        if row.get("in_de") == "IN":
            item["increase"] += amount_yi
            item["net"] -= amount_yi
        else:
            item["reduction"] += amount_yi
            item["net"] += amount_yi

    money_by_month = {row["month"]: row for row in money}
    social_by_month = {row["month"]: row for row in social}
    lpr_by_month = {}
    for row in sorted(lpr, key=lambda item: item["date"]):
        lpr_by_month[month_key_from_date(row["date"])] = row

    months = sorted(
        set(ipo_by_month)
        | set(holder_by_month)
        | set(money_by_month)
        | set(social_by_month)
        | set(lpr_by_month)
    )
    series = []
    latest_lpr = None
    for month in months:
        if month in lpr_by_month:
            latest_lpr = lpr_by_month[month]
        ipo = ipo_by_month.get(month, {})
        holder = holder_by_month.get(month, {})
        money_row = money_by_month.get(month, {})
        social_row = social_by_month.get(month, {})
        series.append(
            {
                "date": month_end(month),
                "ipoFund": round(ipo.get("funds", 0), 2),
                "ipoCount": ipo.get("count", 0),
                "refinanceFund": None,
                "holderReductionAmount": round(holder.get("reduction", 0), 2),
                "holderNetReductionAmount": round(holder.get("net", 0), 2),
                "stampDutyRate": active_stamp_rate(month),
                "lpr1y": float(latest_lpr["1y"])
                if latest_lpr and latest_lpr.get("1y") is not None
                else None,
                "lpr5y": float(latest_lpr["5y"])
                if latest_lpr and latest_lpr.get("5y") is not None
                else None,
                "socialFinancing": float(social_row["inc_month"])
                if social_row.get("inc_month") is not None
                else None,
                "m2Yoy": float(money_row["m2_yoy"])
                if money_row.get("m2_yoy") is not None
                else None,
                "m1Yoy": float(money_row["m1_yoy"])
                if money_row.get("m1_yoy") is not None
                else None,
                "nationalTeamHolding": None,
            }
        )

    result = {
        "meta": {
            "updated": datetime.now().strftime("%Y-%m-%d"),
            "start": series[0]["date"],
            "end": series[-1]["date"],
            "frequency": "monthly",
            "sources": {
                "ipo": "Tushare new_share",
                "holder": "Tushare stk_holdertrade",
                "money": "Tushare cn_m",
                "social": "Tushare sf_month",
                "lpr": "Tushare shibor_lpr",
                "stampDuty": "manual policy table",
            },
            "missing": {
                "refinanceFund": "未找到稳定可自动更新的再融资金额接口，先保留指标位。",
                "nationalTeamHolding": "国家队持仓规模缺少统一官方连续披露口径，先保留指标位。",
            },
        },
        "series": series,
    }
    OUTPUT.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(OUTPUT),
                "points": len(series),
                "start": result["meta"]["start"],
                "end": result["meta"]["end"],
                "latest": series[-1],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
