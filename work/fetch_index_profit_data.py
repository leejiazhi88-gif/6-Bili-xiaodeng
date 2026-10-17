import bisect
import json
import re
import time
import ssl
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path.home() / ".codex" / "config.toml"
OUTPUT = ROOT / "work" / "index_profit_data.json"
CACHE = ROOT / "work" / "income_cache.json"
START_YEAR = 2010
END_DATE = "20261016"
INDICES = {
    "sh": {"code": "399006.SZ", "name": "创业板指"},
    "sz": {"code": "000680.SH", "name": "科创综指"},
}
QUARTER_MONTH_DAYS = ("0331", "0630", "0930", "1231")


def get_token():
    text = CONFIG.read_text(encoding="utf-8")
    match = re.search(r"https://api\.tushare\.pro/mcp/\?token=([^'\"&\s]+)", text)
    if not match:
        raise RuntimeError("Tushare token was not found.")
    return match.group(1)


def call_api(token, api_name, params, fields, timeout=90):
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
    with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
        result = json.loads(response.read().decode("utf-8"))
    if result.get("code") != 0:
        raise RuntimeError(f"{api_name}: {result.get('msg')}")
    data = result.get("data") or {}
    return [dict(zip(data.get("fields", []), row)) for row in data.get("items", [])]


def fetch_weights(token, index_code):
    rows = []
    end_year = int(END_DATE[:4])
    for year in range(START_YEAR, end_year + 1):
        end_date = END_DATE if year == end_year else f"{year}1231"
        rows.extend(
            call_api(
                token,
                "index_weight",
                {
                    "index_code": index_code,
                    "start_date": f"{year}0101",
                    "end_date": end_date,
                },
                "index_code,con_code,trade_date,weight",
            )
        )
    by_date = {}
    for row in rows:
        by_date.setdefault(row["trade_date"], set()).add(row["con_code"])
    return {date: sorted(codes) for date, codes in sorted(by_date.items())}


def load_cache():
    if not CACHE.exists():
        return {"meta": {}, "income": {}}
    return json.loads(CACHE.read_text(encoding="utf-8"))


def save_cache(cache):
    cache["meta"] = {"end_date": END_DATE, "source": "Tushare income"}
    CACHE.write_text(
        json.dumps(cache, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def fetch_income_rows(token, ts_code):
    return call_api(
        token,
        "income",
        {"ts_code": ts_code, "start_date": f"{START_YEAR}0101", "end_date": END_DATE},
        "ts_code,ann_date,f_ann_date,end_date,report_type,comp_type,n_income_attr_p",
    )


def ensure_income_cache(token, codes):
    cache = load_cache()
    income = cache.setdefault("income", {})
    missing = [code for code in sorted(codes) if code not in income]
    for index, code in enumerate(missing, 1):
        try:
            rows = fetch_income_rows(token, code)
        except Exception as error:
            print(f"income fetch failed for {code}: {error}")
            rows = []
        cleaned = []
        for row in rows:
            if row.get("report_type") != "1":
                continue
            value = row.get("n_income_attr_p")
            if value is None:
                continue
            cleaned.append(
                {
                    "ann_date": row.get("ann_date"),
                    "end_date": row["end_date"],
                    "n_income_attr_p": float(value),
                }
            )
        income[code] = cleaned
        if index % 25 == 0:
            save_cache(cache)
            print(f"income cache progress: {index}/{len(missing)} new codes")
        time.sleep(0.08)
    save_cache(cache)
    return cache


def stock_ttm_by_period(rows):
    latest_by_period = {}
    for row in rows:
        period = row["end_date"]
        current = latest_by_period.get(period)
        if current is None or str(row.get("ann_date") or "") >= str(current.get("ann_date") or ""):
            latest_by_period[period] = row
    periods = sorted(latest_by_period)
    cumulative = {period: latest_by_period[period]["n_income_attr_p"] for period in periods}
    single_quarter = {}
    for period in periods:
        year = period[:4]
        month_day = period[4:]
        if month_day not in QUARTER_MONTH_DAYS:
            continue
        if month_day == "0331":
            single_quarter[period] = cumulative[period]
        else:
            previous_month_day = QUARTER_MONTH_DAYS[QUARTER_MONTH_DAYS.index(month_day) - 1]
            previous_period = f"{year}{previous_month_day}"
            if previous_period in cumulative:
                single_quarter[period] = cumulative[period] - cumulative[previous_period]
    ttm = {}
    for period in periods:
        if period[4:] not in QUARTER_MONTH_DAYS:
            continue
        position = quarter_index(period)
        needed = [period_from_quarter_index(position - offset) for offset in range(4)]
        if all(item in single_quarter for item in needed):
            ttm[period] = sum(single_quarter[item] for item in needed)
    return ttm


def quarter_index(period):
    year = int(period[:4])
    quarter = QUARTER_MONTH_DAYS.index(period[4:])
    return year * 4 + quarter


def period_from_quarter_index(index):
    year, quarter = divmod(index, 4)
    return f"{year}{QUARTER_MONTH_DAYS[quarter]}"


def quarter_periods():
    end_year = int(END_DATE[:4])
    result = []
    for year in range(START_YEAR, end_year + 1):
        for month_day in QUARTER_MONTH_DAYS:
            period = f"{year}{month_day}"
            if period <= END_DATE:
                result.append(period)
    return result


def build_index_profit(weight_by_date, income_cache):
    weight_dates = sorted(weight_by_date)
    if not weight_dates:
        return []
    stock_ttm = {
        code: stock_ttm_by_period(rows)
        for code, rows in income_cache.get("income", {}).items()
    }
    result = []
    for period in quarter_periods():
        weight_pos = bisect.bisect_right(weight_dates, period) - 1
        if weight_pos < 0:
            continue
        codes = weight_by_date[weight_dates[weight_pos]]
        values = [stock_ttm.get(code, {}).get(period) for code in codes]
        valid_values = [value for value in values if value is not None]
        if not valid_values:
            continue
        total_profit = sum(valid_values)
        result.append(
            {
                "date": f"{period[:4]}-{period[4:6]}-{period[6:]}",
                "period": period,
                "profitCny": round(total_profit, 2),
                "profitYi": round(total_profit / 100000000, 4),
                "memberCount": len(codes),
                "coveredCount": len(valid_values),
                "coverage": round(len(valid_values) / len(codes) * 100, 4),
                "weightDate": f"{weight_dates[weight_pos][:4]}-{weight_dates[weight_pos][4:6]}-{weight_dates[weight_pos][6:]}",
            }
        )
    return result


def main():
    token = get_token()
    weights = {
        key: fetch_weights(token, info["code"])
        for key, info in INDICES.items()
    }
    all_codes = {
        code
        for index_weights in weights.values()
        for codes in index_weights.values()
        for code in codes
    }
    cache = ensure_income_cache(token, all_codes)
    result = {
        "meta": {
            "end": f"{END_DATE[:4]}-{END_DATE[4:6]}-{END_DATE[6:]}",
            "unit": "亿元",
            "profit": "指数成分股归母净利润TTM汇总",
            "source": "Tushare index_weight + income",
        },
        "sh": build_index_profit(weights["sh"], cache),
        "sz": build_index_profit(weights["sz"], cache),
    }
    OUTPUT.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(OUTPUT),
                "codes": len(all_codes),
                "sh_points": len(result["sh"]),
                "sz_points": len(result["sz"]),
                "latest_sh": result["sh"][-1] if result["sh"] else None,
                "latest_sz": result["sz"][-1] if result["sz"] else None,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
