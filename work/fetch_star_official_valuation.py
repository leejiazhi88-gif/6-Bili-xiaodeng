"""Collect dated CSI factsheet snapshots without interpolating daily valuations."""
import hashlib
import io
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "work" / "star_official_valuation.json"
SOURCE_URL = "https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/000680factsheet.pdf"


def parse_factsheet(content):
    with pdfplumber.open(io.BytesIO(content)) as document:
        page = document.pages[0]
        text = page.extract_text() or ""
        if "000680" not in text or "科创综指" not in text:
            raise ValueError("Unexpected index in CSI factsheet")
        words = page.extract_words()
        heading = "".join(word["text"] for word in words if word["top"] < 100)
        match = re.search(r"(20\d{2})年(\d{1,2})月(\d{1,2})日", heading)
        if not match:
            raise ValueError("Factsheet as-of date is missing")
        report_date = datetime(*map(int, match.groups())).date()
        if report_date > datetime.now().date():
            raise ValueError("Factsheet has a future as-of date")

        def metric(label):
            labels = [word for word in words if word["text"] == label]
            if len(labels) != 1:
                raise ValueError(f"Missing or ambiguous {label}")
            anchor = labels[0]
            values = [word for word in words
                      if word["x0"] > anchor["x1"]
                      and abs(word["top"] - anchor["top"]) < 3
                      and re.fullmatch(r"\d+(?:\.\d+)?", word["text"])]
            if len(values) != 1:
                raise ValueError(f"Missing or ambiguous value for {label}")
            value = float(values[0]["text"])
            if not 0 < value < 10000:
                raise ValueError(f"Invalid {label}")
            return value

        return {"date": report_date.isoformat(), "pe": metric("滚动市盈率"),
                "pb": metric("市净率")}


def main():
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        content = response.read()
    snapshot = parse_factsheet(content)
    archive = ROOT / "work" / "sources" / f"000680-{snapshot['date']}.pdf"
    archive.parent.mkdir(parents=True, exist_ok=True)
    archive.write_bytes(content)
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    snapshots = {row["date"]: row for row in previous.get("snapshots", [])}
    snapshots[snapshot["date"]] = snapshot
    result = {
        "meta": {"tsCode": "000680.SH", "source": "中证指数官方单张", "sourceUrl": SOURCE_URL,
                 "method": "滚动市盈率；指数指标采用个股计算用股本计算",
                 "frequency": "官方月末快照", "fetchedAt": datetime.now(timezone.utc).isoformat(),
                 "sha256": hashlib.sha256(content).hexdigest(), "archive": archive.relative_to(ROOT).as_posix()},
        "snapshots": [snapshots[date] for date in sorted(snapshots)],
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"source": result["meta"]["source"], "latest": result["snapshots"][-1]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
