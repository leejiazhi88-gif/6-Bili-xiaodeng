from refresh_cache import full_refresh
from refresh_cache import historical_cache, atomic_json
from official_metrics import complete_window, aggregate_ipo, aggregate_holders, aggregate_current_ipo, IPO_FIELDS, HOLDER_FIELDS
from fetch_large_money_sentiment_data import index_memberships, STOCK_CODE
import calendar
import json
import re
import ssl
import urllib.request
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path.home() / ".codex" / "config.toml"
OUTPUT = ROOT / "work" / "official_sentiment_data.json"
START_YEAR = 1991
START_MONTH = "199112"
END_YEAR = datetime.now().year
END_DATE = datetime.now().strftime("%Y%m%d")

STAMP_DUTY_EVENTS = [
    ("20080101", 0.3),
    ("20080424", 0.1),
    ("20080919", 0.1),
    ("20230828", 0.05),
]


def get_token():
    text = CONFIG.read_text(encoding="utf-8")
    match = re.search(r"https://api\.tushare\.pro/mcp/\?token=([^'\"&\s]+)", text)
    if not match:
        raise RuntimeError("Tushare token was not found.")
    return match.group(1)


@historical_cache
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
    if month < "200801":
        return None
    date = month_end(month).replace("-", "")
    rate = STAMP_DUTY_EVENTS[0][1]
    for event_date, event_rate in STAMP_DUTY_EVENTS:
        if date >= event_date:
            rate = event_rate
    return rate


def main():
    token = get_token()
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() and not full_refresh() else None
    refresh_year = int(previous["meta"]["end"][:4]) if previous and previous["meta"].get("schemaVersion") in (2, 3) else 2008
    ipos = []
    holder_trades = []
    for year in range(refresh_year, END_YEAR + 1):
        start, end = f"{year}0101", min(f"{year}1231", END_DATE)
        ipos.extend(complete_window(call_api, token, "new_share", start, end, IPO_FIELDS, 2000))
    for i, (start, end) in enumerate(month_ranges(max(2018, refresh_year)), 1):
        # Split conservatively at 2000 too: historical cached responses may use the older cap.
        holder_trades.extend(complete_window(call_api, token, "stk_holdertrade", start, end, HOLDER_FIELDS, 3000))
        if i % 24 == 0:
            print(f"official: checked {i} months of shareholder disclosures", flush=True)
    if previous:
        prior_year = [r for r in previous["series"] if r["date"] >= f"{refresh_year}-01-01"]
        if not ipos and any((r.get("ipoCount") or 0) > 0 for r in prior_year):
            raise ValueError("IPO source unexpectedly empty; retain existing data")
        if not holder_trades and any(r.get("holderNetReductionAmount") for r in prior_year):
            raise ValueError("Shareholder source unexpectedly empty; retain existing data")
    memberships = index_memberships(token)
    money = call_api(
        token,
        "cn_m",
        {"start_m": START_MONTH, "end_m": END_DATE[:6]},
        "month,m2,m2_yoy,m1,m1_yoy",
    )
    social = call_api(
        token,
        "sf_month",
        {"start_m": START_MONTH, "end_m": END_DATE[:6]},
        "month,inc_month",
    )
    lpr = complete_window(call_api, token, "shibor_lpr", f"{START_YEAR}0101", END_DATE, "date,1y,5y", 4000)
    if not money or not social or not lpr:
        raise ValueError("Macro source unexpectedly empty; retain existing data")
    # A new snapshot changes the retrospective sample, so rebuild the IPO history
    # from cached annual source records instead of merging old constituent totals.
    for year in range(2008, refresh_year):
        ipos.extend(complete_window(call_api, token, "new_share", f"{year}0101", f"{year}1231", IPO_FIELDS, 2000))
    ipo_months = [start[:6] for start, _ in month_ranges(2008)]
    overrides = json.loads((ROOT / "work/ipo_listing_overrides.json").read_text())
    ipo_indices, ipo_coverage = aggregate_current_ipo(ipos, ipo_months, memberships, END_DATE, overrides)
    holder_months = [start[:6] for start, _ in month_ranges(max(2018, refresh_year))]
    ipo_by_month = aggregate_ipo([r for r in ipos if (r.get("ipo_date") or r.get("issue_date") or "") <= END_DATE], ipo_months)
    holder_by_month = aggregate_holders(holder_trades, holder_months, memberships, STOCK_CODE, END_DATE)
    money_by_month = {row["month"]: row for row in money}
    social_by_month = {row["month"]: row for row in social}
    lpr_by_month = {}
    for row in sorted(lpr, key=lambda item: item["date"]):
        lpr_by_month[month_key_from_date(row["date"])] = row

    months = sorted(m for m in (
        set(ipo_by_month)
        | set(holder_by_month)
        | set(money_by_month)
        | set(social_by_month)
        | set(lpr_by_month)
    ) if m <= END_DATE[:6])
    series = []
    latest_lpr = None
    for month in months:
        if month in lpr_by_month:
            latest_lpr = lpr_by_month[month]
        ipo = ipo_by_month.get(month, {})
        holder_groups = holder_by_month.get(month, {})
        holder = holder_groups.get("market", {})
        money_row = money_by_month.get(month, {})
        social_row = social_by_month.get(month, {})
        series.append(
            {
                "date": month_end(month),
                "ipoFund": ipo.get("ipoFund"),
                "ipoCount": ipo.get("ipoCount"),
                "ipoMissingFunds": ipo.get("ipoMissingFunds"),
                "holderReductionAmount": holder.get("holderReductionAmount"),
                "holderNetReductionAmount": holder.get("holderNetReductionAmount"),
                "holderCoverage": {key: {k: v for k, v in r.items() if not k.startswith("holder")} for key, r in holder_groups.items()},
                "holderIndices": {key: r["holderNetReductionAmount"] for key, r in holder_groups.items() if key != "market"},
                "stampDutyRate": active_stamp_rate(month),
                "lprSourceDate": latest_lpr["date"] if latest_lpr else None,
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
            }
        )

    if previous:
        cutoff = f"{refresh_year}-01-01"
        first = previous["series"][0]["date"]
        series = ([row for row in series if row["date"] < first]
                  + [row for row in previous["series"] if first <= row["date"] < cutoff]
                  + [row for row in series if row["date"] >= cutoff])
    for row in series:
        month = row["date"][:7].replace("-", "")
        ipo = ipo_by_month.get(month, {})
        row.update(ipoFund=ipo.get("ipoFund"), ipoCount=ipo.get("ipoCount"), ipoMissingFunds=ipo.get("ipoMissingFunds"))
        row["ipoIndices"] = {key: values.get(month) for key, values in ipo_indices.items()}
        row["stampDutyRate"] = active_stamp_rate(row["date"][:7].replace("-", ""))
        row["partialMonth"] = row["date"][:7].replace("-", "") == END_DATE[:6] and int(END_DATE[6:]) < calendar.monthrange(END_YEAR, int(END_DATE[4:6]))[1]
        if row["date"] < "2018-01-01":
            row["holderReductionAmount"] = None
            row["holderNetReductionAmount"] = None

    result = {
        "meta": {
            "updated": datetime.now().strftime("%Y-%m-%d"),
            "schemaVersion": 3,
            "ipoDefinition": "IPO发行总额：发行总量（万股）×发行价格（元/股）÷10000，单位亿元，未扣发行费用；若含老股转让不等于公司实际净募集资金。",
            "ipoConstituents": ipo_coverage,
            "ipoAmountEvidence": overrides["amountEvidence"],
            "holderDefinition": "沪深京A股重要股东公告中可按变动股数×披露均价计算的金额，减持减增持；非完整市场净流出。",
            "membershipDefinition": "公告当日或此前最近月度成分名单；不使用未来名单，超过62天无快照或月内覆盖不全留空。",
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
            "constituentAvailability": {
                "ipoFund": "按最新可得成分股名单追溯各公司历史IPO发行金额；不是发行当时的指数成分统计，名单变化会改变回溯历史。",
                "refinanceFund": "现有可核实来源为全市场月表，暂无同口径成分股拆分。",
                "holderNetReductionAmount": "按历史成分名单归集同一批重要股东公告金额。",
                "stampDutyRate": "统一税率，不存在成分股税率分项。",
                "lpr1y": "全国统一报价，不存在成分股LPR分项。",
                "socialFinancing": "全国实体经济融资，无法按股票指数成分拆分。",
                "m2Yoy": "全国货币供应量同比，无法按股票指数成分拆分。"
            },
        },
        "series": series,
    }
    atomic_json(OUTPUT, result)
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
