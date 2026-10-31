"""Fetch the STAR Composite's published historical rolling PE from CSI."""
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "work" / "star_official_history.json"
SNAPSHOTS = ROOT / "work" / "star_official_valuation.json"
BASE_URL = "https://www.csindex.com.cn/csindex-home/perf/index-perf"
INDEX_CODE = "000680"
START_DATE = "20191231"


def parse_history(payload, snapshots):
    if str(payload.get("code")) != "200" or payload.get("success") is not True:
        raise ValueError(f"CSI history request failed: {payload.get('msg')}")
    raw_rows = payload.get("data")
    if not isinstance(raw_rows, list) or not raw_rows:
        raise ValueError("CSI history returned no rows")

    rows = {}
    for raw in raw_rows:
        if raw.get("indexCode") != INDEX_CODE:
            raise ValueError("Unexpected index code in CSI history")
        date = datetime.strptime(str(raw["tradeDate"]), "%Y%m%d").date().isoformat()
        value = raw.get("peg")
        if value is None or value == "":
            continue
        pe = float(value)
        if not 0 < pe < 10000:
            raise ValueError(f"Invalid rolling PE on {date}: {pe}")
        if date in rows and rows[date] != pe:
            raise ValueError(f"Conflicting rolling PE on {date}")
        rows[date] = pe
    if not rows:
        raise ValueError("CSI history returned no rolling PE values")

    for snapshot in snapshots:
        date = snapshot["date"]
        if date in rows and abs(rows[date] - snapshot["pe"]) > 0.05:
            raise ValueError(f"CSI history disagrees with archived factsheet on {date}")
    return [{"date": date, "pe": rows[date]} for date in sorted(rows)]


def main():
    end_date = datetime.now().strftime("%Y%m%d")
    query = urllib.parse.urlencode({"indexCode": INDEX_CODE, "startDate": START_DATE,
                                    "endDate": end_date})
    url = f"{BASE_URL}?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        payload = json.load(response)
    snapshots = json.loads(SNAPSHOTS.read_text(encoding="utf-8"))["snapshots"]
    rows = parse_history(payload, snapshots)
    result = {
        "meta": {"tsCode": "000680.SH", "source": "中证指数官方历史行情",
                 "sourceUrl": url, "field": "peg（官网历史行情的滚动市盈率）",
                 "startDate": START_DATE, "endDate": end_date,
                 "fetchedAt": datetime.now(timezone.utc).isoformat()},
        "rows": rows,
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"count": len(rows), "first": rows[0], "latest": rows[-1]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
