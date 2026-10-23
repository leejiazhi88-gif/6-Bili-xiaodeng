import bisect
import json
import re
import ssl
import urllib.request
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path.home() / ".codex" / "config.toml"
OUTPUT = ROOT / "work" / "valuation_data.json"
START_YEAR = 2006
END_YEAR = datetime.now().year
END_DATE = datetime.now().strftime("%Y%m%d")


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
    with urllib.request.urlopen(request, timeout=60, context=context) as response:
        result = json.loads(response.read().decode("utf-8"))
    if result.get("code") != 0:
        raise RuntimeError(f"{api_name}: {result.get('msg')}")
    data = result["data"]
    return [dict(zip(data["fields"], row)) for row in data["items"]]


def fetch_by_year(token, api_name, base_params, fields):
    rows = []
    for year in range(START_YEAR, END_YEAR + 1):
        params = {
            **base_params,
            "start_date": f"{year}0101",
            "end_date": min(f"{year}1231", END_DATE),
        }
        rows.extend(call_api(token, api_name, params, fields))
    unique = {row["trade_date"]: row for row in rows}
    return [unique[date] for date in sorted(unique)]


def last_by_week(rows):
    result = []
    current_key = None
    for row in rows:
        date = datetime.strptime(row["trade_date"], "%Y%m%d")
        key = (date.isocalendar().year, date.isocalendar().week)
        if key != current_key:
            result.append(row)
            current_key = key
        else:
            result[-1] = row
    return result


def percentile(values, value):
    return bisect.bisect_right(values, value) / len(values) * 100


def build_index_series(rows, bond_dates, bond_by_date):
    valid = [row for row in rows if row.get("pb") and row.get("pe_ttm", 0) > 0]
    if not valid:
        return []
    pb_values = sorted(float(row["pb"]) for row in valid)
    result = []
    for row in last_by_week(valid):
        date = row["trade_date"]
        bond_index = bisect.bisect_right(bond_dates, date) - 1
        bond_yield = bond_by_date[bond_dates[bond_index]] if bond_index >= 0 else None
        pe = float(row["pe_ttm"])
        pb = float(row["pb"])
        result.append(
            {
                "date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
                "pb": round(pb, 4),
                "pbPercentile": round(percentile(pb_values, pb), 4),
                "bond10y": round(bond_yield, 4) if bond_yield is not None else None,
                "equityBondSpread": round(100 / pe - bond_yield, 4)
                if bond_yield is not None
                else None,
            }
        )
    return result


def main():
    token = get_token()
    fields = "ts_code,trade_date,pe_ttm,pb"
    sh_rows = fetch_by_year(
        token, "index_dailybasic", {"ts_code": "399006.SZ"}, fields
    )
    sz_rows = fetch_by_year(
        token, "index_dailybasic", {"ts_code": "000680.SH"}, fields
    )
    try:
        bond_rows = fetch_by_year(
            token,
            "yc_cb",
            {"ts_code": "1001.CB", "curve_type": "0", "curve_term": 10},
            "trade_date,yield",
        )
    except RuntimeError as error:
        print(f"Bond yield refresh failed; equity-bond spread will be empty. {error}")
        bond_rows = []
    bond_by_date = {
        row["trade_date"]: float(row["yield"])
        for row in bond_rows
        if row.get("yield") is not None
    }
    bond_dates = sorted(bond_by_date)
    result = {
        "meta": {
            "start": f"{START_YEAR}-01-01",
            "end": datetime.strptime(END_DATE, "%Y%m%d").strftime("%Y-%m-%d"),
            "bond": "中债国债收益率曲线 10年期到期收益率",
            "spread": "100 / PE(TTM) - 10年期国债收益率",
            "indices": "创业板指(399006.SZ) / 科创综指(000680.SH)",
        },
        "sh": build_index_series(sh_rows, bond_dates, bond_by_date),
        "sz": build_index_series(sz_rows, bond_dates, bond_by_date),
    }
    OUTPUT.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(OUTPUT),
                "sh_points": len(result["sh"]),
                "sz_points": len(result["sz"]),
                "bond_days": len(bond_dates),
                "latest_sh": result["sh"][-1] if result["sh"] else None,
                "latest_sz": result["sz"][-1] if result["sz"] else None,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
