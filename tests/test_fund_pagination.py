import io
import json
import os
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "work"))
import fetch_large_money_fund_reports as funds


class FundPaginationTests(unittest.TestCase):
    def test_out_of_order_completion_keeps_source_order_and_two_request_limit(self):
        source = [{"row": index} for index in range(7)]
        second_finished = threading.Event()
        lock = threading.Lock()
        active = peak = 0
        completed = []

        def fetch(token, api, params, fields):
            nonlocal active, peak
            offset = params["offset"]
            with lock:
                active += 1
                peak = max(peak, active)
            if offset == 0:
                if not second_finished.wait(timeout=2):
                    raise AssertionError("Second page did not run concurrently")
            with lock:
                completed.append(offset)
                active -= 1
            if offset == 2:
                second_finished.set()
            return source[offset:offset + params["limit"]]

        with patch.object(funds, "request", side_effect=fetch):
            result = list(funds.portfolio_pages("", {"period": "20260630"}, "row", size=2))
        self.assertEqual(result, source)
        self.assertEqual(completed[:2], [2, 0])
        self.assertEqual(peak, 2)

    def test_short_empty_and_exact_multiple_endings(self):
        for count in (0, 1, 3, 8, 12):
            with self.subTest(count=count):
                source = [{"row": index} for index in range(count)]
                requested = []

                def fetch(token, api, params, fields):
                    requested.append(params["offset"])
                    return source[params["offset"]:params["offset"] + params["limit"]]

                with patch.object(funds, "request", side_effect=fetch):
                    result = list(funds.portfolio_pages("", {}, "row", size=3))
                self.assertEqual(result, source)
                terminal_offset = count // 3 * 3
                self.assertTrue(set(range(0, terminal_offset + 1, 3)).issubset(requested))
                self.assertTrue(set(requested).issubset(range(0, terminal_offset + 4, 3)))

    def test_first_short_page_ignores_later_prefetch_failure(self):
        later_started = threading.Event()

        def fetch(token, api, params, fields):
            if params["offset"] == 0:
                self.assertTrue(later_started.wait(timeout=2))
                return [{"row": 1}]
            later_started.set()
            raise RuntimeError("Unneeded page is unavailable")

        with patch.object(funds, "request", side_effect=fetch):
            self.assertEqual(list(funds.portfolio_pages("", {}, "row", size=2)), [{"row": 1}])

    def test_repeated_complete_page_raises(self):
        repeated = [{"row": 1}, {"row": 2}]
        with patch.object(funds, "request", return_value=repeated):
            with self.assertRaisesRegex(RuntimeError, "Repeated full fund_portfolio page at offset 2"):
                list(funds.portfolio_pages("", {}, "row", size=2))

    def test_oversized_page_raises_before_yielding_rows(self):
        with patch.object(funds, "request", return_value=[{"row": index} for index in range(3)]):
            pages = funds.portfolio_pages("", {}, "row", size=2)
            with self.assertRaisesRegex(RuntimeError, "Oversized fund_portfolio page at offset 0: 3 rows exceeds limit 2"):
                next(pages)

    def test_revised_holdings_are_not_mistaken_for_duplicate_pages(self):
        source = [{"ts_code": "fund", "symbol": "stock", "ann_date": f"2026090{day}"}
                  for day in range(1, 5)]

        def fetch(token, api, params, fields):
            return source[params["offset"]:params["offset"] + params["limit"]]

        with patch.object(funds, "request", side_effect=fetch):
            self.assertEqual(list(funds.portfolio_pages("", {}, "", size=2)), source)

    def test_progress_includes_cumulative_rows_and_elapsed_time(self):
        source = [{"row": index} for index in range(21)]

        def fetch(token, api, params, fields):
            return source[params["offset"]:params["offset"] + params["limit"]]

        with patch.object(funds, "request", side_effect=fetch), patch("builtins.print") as progress:
            self.assertEqual(list(funds.portfolio_pages("", {"period": "20260630"}, "", size=2)), source)
        progress.assert_called_once()
        self.assertRegex(progress.call_args.args[0], r"20260630: 10 pages, 20 holdings, \d+\.\ds")

    def test_request_retries_are_preserved(self):
        with patch.object(funds, "call_api", side_effect=[RuntimeError("temporary"), RuntimeError("temporary"), []]) as fetch, patch.object(funds.time, "sleep") as pause:
            self.assertEqual(funds.request("", "fund_portfolio", {}, ""), [])
        self.assertEqual(fetch.call_count, 3)
        self.assertEqual([call.args[0] for call in pause.call_args_list], [1, 2])

    def test_page_failure_preserves_report_and_checked_at_on_disk(self):
        now = datetime.now()
        periods = [f"{year}{end}" for year in range(2005, now.year + 1)
                   for end in ("0630", "1231") if f"{year}{end}" <= now.strftime("%Y%m%d")]
        period = periods[-1]
        state = {
            "meta": {"checkedAt": {p: now.isoformat() for p in periods}},
            "series": [{"date": f"{p[:4]}-{p[4:6]}-{p[6:]}", "funds": 10, "coverage": 90} for p in periods],
        }
        state["meta"]["checkedAt"][period] = (now - timedelta(days=8)).isoformat()

        def fetch(token, api, params, fields):
            if api == "fund_nav":
                return [{"ts_code": "fund", "net_asset": 100}]
            if api == "fund_portfolio" and params["offset"] == 0:
                return [{"ts_code": "fund", "end_date": period, "symbol": f"stock-{index}",
                         "mkv": 1, "stk_mkv_ratio": 1} for index in range(5000)]
            raise RuntimeError("Holdings page unavailable")

        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "funds.json"
            output.write_text(json.dumps(state), encoding="utf-8")
            before = output.read_bytes()
            with patch.dict(os.environ, {"XIAODENG_REFRESH_FULL": "0"}), patch.object(funds, "OUTPUT", output), patch.object(funds, "get_token", return_value=""), patch.object(funds, "active_funds", return_value={"fund": {}}), patch.object(funds, "request", side_effect=fetch), patch.object(funds, "atomic_json") as save, patch("builtins.print"):
                with self.assertRaisesRegex(RuntimeError, "Holdings page unavailable"):
                    funds.main()
            save.assert_not_called()
            self.assertEqual(output.read_bytes(), before)

    def test_status_reads_cache_without_credentials_network_or_writes(self):
        state = {"meta": {"checkedAt": {"20260630": "2026-11-03T20:30:00"}},
                 "series": [{"date": "2026-06-30", "funds": 10}]}
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "funds.json"
            output.write_text(json.dumps(state), encoding="utf-8")
            before = output.read_bytes()
            with patch.object(funds, "OUTPUT", output), patch.object(funds, "get_token") as credentials, patch.object(funds, "call_api") as network, patch.object(funds, "atomic_json") as save, patch("sys.stdout", new_callable=io.StringIO) as stdout:
                funds.main(["--status"])
            status = json.loads(stdout.getvalue())
            self.assertEqual(set(status), {"duePeriods", "missingPeriods", "latestReportDate", "checkedAt"})
            self.assertEqual(status["latestReportDate"], "2026-06-30")
            self.assertEqual(status["checkedAt"], state["meta"]["checkedAt"])
            self.assertIn("20050630", status["missingPeriods"])
            credentials.assert_not_called()
            network.assert_not_called()
            save.assert_not_called()
            self.assertEqual(output.read_bytes(), before)

    def test_refresh_plan_respects_disclosure_and_audit_intervals(self):
        now = datetime(2026, 11, 3)
        periods = [f"{year}{end}" for year in range(2005, 2027)
                   for end in ("0630", "1231") if f"{year}{end}" <= now.strftime("%Y%m%d")]
        state = {"meta": {"checkedAt": {p: now.isoformat() for p in periods}},
                 "series": [{"date": f"{p[:4]}-{p[4:6]}-{p[6:]}"} for p in periods]}
        checks = state["meta"]["checkedAt"]
        checks["20260630"] = (now - timedelta(days=7)).isoformat()
        checks["20251231"] = (now - timedelta(days=6)).isoformat()
        checks["20250630"] = (now - timedelta(days=30)).isoformat()
        checks["20241231"] = (now - timedelta(days=29)).isoformat()
        with patch.dict(os.environ, {"XIAODENG_REFRESH_FULL": "0"}):
            self.assertEqual(funds.refresh_plan(state, now)["duePeriods"], ["20250630", "20260630"])
            self.assertEqual(funds.refresh_plan(state, now, force=True)["duePeriods"], periods)
        self.assertEqual(funds.refresh_plan({"series": []}, now)["latestReportDate"], None)


if __name__ == "__main__":
    unittest.main()
