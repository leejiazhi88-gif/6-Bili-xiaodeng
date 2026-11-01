import json
import time
from bisect import bisect_right
from collections import defaultdict
from pathlib import Path

from fetch_retail_sentiment_data import ROOT, call_api, get_token


OUTPUT = ROOT / "work" / "retail_index_metrics.json"
MARKET = ROOT / "work" / "retail_sentiment_data.json"
INDEXES = {"sh": "399006.SZ", "k50": "000688.SH", "sz": "000680.SH"}


def request(token, api, params, fields):
    for attempt in range(3):
        try:
            return call_api(token, api, params, fields)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def snapshots(token, code, first_year, last_year):
    by_date = defaultdict(set)
    for year in range(first_year, last_year + 1):
        rows = request(
            token, "index_weight",
            {"index_code": code, "start_date": f"{year}0101", "end_date": f"{year}1231"},
            "trade_date,con_code",
        )
        for row in rows:
            by_date[row["trade_date"]].add(row["con_code"])
    dates = sorted(by_date)
    return dates, by_date


def index_turnover(token, code, first_year, last_year):
    values = {}
    for year in range(first_year, last_year + 1):
        for row in request(
            token, "index_dailybasic",
            {"ts_code": code, "start_date": f"{year}0101", "end_date": f"{year}1231"},
            "trade_date,turnover_rate",
        ):
            if row.get("turnover_rate") is not None:
                values[row["trade_date"]] = float(row["turnover_rate"])
    return values


def main():
    token = get_token()
    weekly = json.loads(MARKET.read_text(encoding="utf-8"))["series"]
    by_month = {row["date"][:7]: row["date"] for row in weekly}
    month_dates = set(by_month.values())
    dates_to_process = [row["date"] for row in weekly]
    last_year = int(dates_to_process[-1][:4])
    latest_month = dates_to_process[-1][:7]
    cached = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    cached_by_date = {
        key: {row["date"]: row for row in cached.get(key, [])} for key in INDEXES
    }
    memberships = {
        key: snapshots(token, code, 2010 if key == "sh" else 2019, last_year)
        for key, code in INDEXES.items()
    }
    direct_turnover = {
        "sh": index_turnover(token, INDEXES["sh"], 2010, last_year),
        "k50": index_turnover(token, INDEXES["k50"], 2019, last_year),
    }
    result = {key: [] for key in INDEXES}
    for date in dates_to_process:
        compact = date.replace("-", "")
        members = {}
        for key, (dates, by_date) in memberships.items():
            position = bisect_right(dates, compact) - 1
            if position >= 0:
                members[key] = by_date[dates[position]]
        for key, values in direct_turnover.items():
            if compact in values and key not in members:
                members[key] = set()
        if not members:
            continue
        if date[:7] != latest_month and all(
            date in cached_by_date[key] and
            (cached_by_date[key][date].get("marginChecked") or date in month_dates)
            for key in members
        ):
            limit_codes = None
            if compact >= "20200101" and any(
                not cached_by_date[key][date].get("limitChecked") and date not in month_dates
                for key in members
            ):
                limit_codes = {row["ts_code"] for row in request(
                    token, "limit_list_d", {"trade_date": compact, "limit_type": "U"},
                    "ts_code")}
            for key in members:
                row = dict(cached_by_date[key][date])
                row["marginChecked"] = True
                row["limitChecked"] = True
                if limit_codes is not None:
                    row["limitUpCount"] = sum(
                        code in limit_codes for code in members[key])
                if compact in direct_turnover.get(key, {}):
                    row["turnover"] = direct_turnover[key][compact]
                result[key].append(row)
            continue
        monthly = date in month_dates
        basic_rows = request(token, "daily_basic", {"trade_date": compact},
                             "ts_code,circ_mv,turnover_rate")
        margin_rows = request(token, "margin_detail", {"trade_date": compact},
                              "ts_code,rzye")
        limit_codes = None
        if compact >= "20200101":
            limit_codes = {row["ts_code"] for row in request(
                token, "limit_list_d", {"trade_date": compact, "limit_type": "U"},
                "ts_code")}
        basics = {row["ts_code"]: row for row in basic_rows}
        margins = {row["ts_code"]: float(row["rzye"])
                   for row in margin_rows if row.get("rzye") is not None}
        for key, codes in members.items():
            known = [basics[code] for code in codes if code in basics
                     and basics[code].get("circ_mv") is not None]
            cap = sum(float(row["circ_mv"]) for row in known)
            turnover_rows = [row for row in known if row.get("turnover_rate") is not None]
            turnover_cap = sum(float(row["circ_mv"]) for row in turnover_rows)
            margin = sum(margins[code] for code in codes if code in margins)
            derived_turnover = round(sum(float(row["turnover_rate"]) * float(row["circ_mv"])
                                     for row in turnover_rows) / turnover_cap, 4) \
                if turnover_cap and codes and len(known) >= len(codes) * 0.95 else None
            result[key].append({
                "date": date,
                "turnover": direct_turnover.get(key, {}).get(compact, derived_turnover),
                "marginBalance": round(margin / 1e8, 2) if margin > 0 else None,
                "marginFloatRatio": round(margin / (cap * 1e4) * 100, 4)
                                    if margin > 0 and cap and len(known) >= len(codes) * 0.95 else None,
                "limitUpCount": sum(code in limit_codes for code in codes)
                                if limit_codes is not None else None,
                "memberCount": len(codes),
                "capCoverage": round(len(known) / len(codes) * 100, 2) if codes else None,
                "marginMatched": sum(code in margins for code in codes),
                "marginChecked": True,
                "limitChecked": True,
            })
        if len(result["sh"]) % 50 == 0 and len(result["sh"]) > 0:
            print(date, flush=True)
    payload = {
        "meta": {
            "frequency": {"turnover": "weekly", "marginBalance": "weekly",
                          "marginFloatRatio": "weekly", "limitUpCount": "weekly"},
            "sources": "Tushare index_weight + daily_basic + margin_detail",
            "turnover": "Tushare index_dailybasic turnover_rate for sh/k50; constituent turnover_rate weighted by circ_mv for sz",
            "marginBalance": "Sum of constituent rzye; non-margin-eligible stocks contribute zero",
            "marginFloatRatio": "Constituent rzye / sum(circ_mv) * 100",
            "limitUpCount": "Count of current constituents in Tushare limit_list_d limit_type U",
        },
        **result,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({key: {"points": len(rows), "first": rows[0]["date"] if rows else None,
                            "last": rows[-1]["date"] if rows else None}
                      for key, rows in result.items()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
