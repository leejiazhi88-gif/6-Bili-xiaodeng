import json
import re
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime

from fetch_retail_sentiment_data import ROOT, call_api, get_token


OUTPUT = ROOT / "work" / "retail_monthly_trends.json"
SSE_SOURCE = "https://star.sse.com.cn/aboutus/publication/monthly/investor/"
SSE_QUERY = "https://query.sse.com.cn/commonQuery.do"


def sse_year(year, current_year, current_month):
    months = range(current_month, 0, -1) if year == current_year else (12,)
    for month in months:
        params = urllib.parse.urlencode({
            "sqlId": "COMMON_SSE_TZZ_M_ALL_ACCT_C",
            "isPagination": "false",
            "MDATE": f"{year}{month:02d}",
            "jsonCallBack": "monthlyCallback",
        })
        request = urllib.request.Request(
            f"{SSE_QUERY}?{params}",
            headers={"Referer": SSE_SOURCE, "User-Agent": "Mozilla/5.0"},
        )
        for attempt in range(3):
            try:
                opener = urllib.request.build_opener(
                    urllib.request.ProxyHandler() if attempt < 2
                    else urllib.request.ProxyHandler({}),
                )
                with opener.open(request, timeout=20) as response:
                    body = response.read().decode("utf-8")
                break
            except (OSError, TimeoutError):
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
        match = re.fullmatch(r"monthlyCallback\((.*)\)\s*", body, re.S)
        if not match:
            raise ValueError("Unexpected SSE response format")
        rows = json.loads(match.group(1)).get("result") or []
        if rows:
            return [
                {"month": row["TERM"].replace(".", "-"), "accountsWan": float(row["A_ACCT"])}
                for row in rows if re.fullmatch(r"\d{4}\.\d{2}", row.get("TERM", ""))
                and float(row.get("A_ACCT") or 0) > 0
            ]
    return []


def fund_months(token, current_month):
    funds = {}
    for market in ("E", "O"):
        for status in ("L", "D"):
            rows = call_api(
                token, "fund_basic", {"market": market, "status": status},
                "ts_code,found_date,issue_amount,fund_type,p_value",
            )
            for row in rows:
                funds[row["ts_code"]] = row
    months = defaultdict(lambda: {"funds": 0, "reported": 0, "sharesYi": 0.0,
                                  "equitySharesYi": 0.0})
    for row in funds.values():
        founded = row.get("found_date") or ""
        if not re.fullmatch(r"\d{8}", founded):
            continue
        month = f"{founded[:4]}-{founded[4:6]}"
        if month < "2022-01" or month > current_month:
            continue
        item = months[month]
        item["funds"] += 1
        amount = row.get("issue_amount")
        if amount is None or float(amount) < 0:
            continue
        item["reported"] += 1
        item["sharesYi"] += float(amount)
        if row.get("fund_type") in ("股票型", "混合型"):
            item["equitySharesYi"] += float(amount)
    return [
        {"month": month, "sharesYi": round(item["sharesYi"], 2),
         "equitySharesYi": round(item["equitySharesYi"], 2),
         "funds": item["funds"], "reported": item["reported"],
         "coverage": round(item["reported"] / item["funds"] * 100, 1)}
        for month, item in sorted(months.items())
    ]


def main():
    today = datetime.now()
    current_month = today.strftime("%Y-%m")
    accounts = []
    for year in range(2021, today.year + 1):
        accounts.extend(sse_year(year, today.year, today.month))
    if not accounts:
        raise RuntimeError("SSE account data is unavailable")
    accounts.sort(key=lambda row: row["month"])
    funds = fund_months(get_token(), current_month)
    if not funds:
        raise RuntimeError("Fund issuance data is unavailable")
    payload = {
        "meta": {
            "accountsSource": SSE_SOURCE,
            "fundsSource": "https://tushare.pro/document/1?doc_id=19",
            "accountsScope": "SSE monthly A-share new accounts, not unique national investors",
            "fundsScope": "Sum of reported fund-code initial issuance shares; unit 100 million shares",
            "fundCoverageThreshold": 90,
        },
        "accounts": accounts,
        "funds": funds,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "accounts": [len(accounts), accounts[0]["month"], accounts[-1]["month"]],
        "funds": [len(funds), funds[0]["month"], funds[-1]["month"]],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
