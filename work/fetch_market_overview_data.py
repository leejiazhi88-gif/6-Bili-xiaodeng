from refresh_cache import atomic_json, full_refresh, lookback, merge_rows
from refresh_cache import historical_cache
from datetime import datetime
import json
import re
import ssl
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path.home() / ".codex" / "config.toml"
OUTPUT = ROOT / "work" / "market_overview_data.json"
START_YEAR = 2006
END_DATE = datetime.now().strftime("%Y%m%d")


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


def fetch_by_year(token, api_name, ts_code, fields, start=None):
    end_year = int(END_DATE[:4])
    rows = []
    for year in range(int((start or str(START_YEAR))[:4]), end_year + 1):
        end_date = END_DATE if year == end_year else f"{year}1231"
        rows.extend(
            call_api(
                token,
                api_name,
                {
                    "ts_code": ts_code,
                    "start_date": max(f"{year}0101", start or f"{START_YEAR}0101"),
                    "end_date": end_date,
                },
                fields,
            )
        )
    unique = {row["trade_date"]: row for row in rows}
    return [unique[date] for date in sorted(unique)]


def build_market(token, ts_code, previous=()):
    start = lookback(previous[-1]["date"]) if previous else None
    prices = fetch_by_year(token, "index_daily", ts_code, "trade_date,close,vol,amount", start)
    basics = fetch_by_year(token, "index_dailybasic", ts_code, "trade_date,pe_ttm,pb", start)
    pb_by_date = {row["trade_date"]: row.get("pb") for row in basics}
    pe_by_date = {
        row["trade_date"]: float(row["pe_ttm"])
        for row in basics
        if row.get("pe_ttm") and float(row["pe_ttm"]) > 0
    }
    series = []
    for row in prices:
        date = row["trade_date"]
        pe = pe_by_date.get(date)
        close = float(row["close"])
        volume = float(row.get("vol") or 0)
        amount = float(row.get("amount") or 0)
        series.append(
            {
                "date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
                "close": close,
                "pe": pe,
                "pb": pb_by_date.get(date),
                "earnings": close / pe if pe else None,
                "volumeYiShou": round(volume / 100000000, 4),
                "amountYi": round(amount / 100000, 4),
            }
        )
    if not series:
        raise RuntimeError("Empty price response; previous cache retained")
    return merge_rows(previous, series, ("date",))


def main():
    token = get_token()
    previous = json.loads(OUTPUT.read_text()) if OUTPUT.exists() and not full_refresh() else {}
    result = {
        "meta": {"checkedThrough": END_DATE, "end": f"{END_DATE[:4]}-{END_DATE[4:6]}-{END_DATE[6:]}"},
        "sh": build_market(token, "399006.SZ", previous.get("sh", [])),
        "sz": build_market(token, "000680.SH", previous.get("sz", [])),
        "k50": build_market(token, "000688.SH", previous.get("k50", [])),
    }
    result["meta"]["end"] = max(result["sh"][-1]["date"], result["sz"][-1]["date"])
    atomic_json(OUTPUT, result)
    print(
        json.dumps(
            {
                "output": str(OUTPUT),
                "sh_points": len(result["sh"]),
                "sz_points": len(result["sz"]),
                "latest_sh": result["sh"][-1],
                "latest_sz": result["sz"][-1],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
