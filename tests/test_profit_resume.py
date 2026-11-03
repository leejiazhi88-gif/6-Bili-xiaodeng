import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from threading import Event
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "work"))
import fetch_index_profit_data as profit
from refresh_cache import atomic_json


class ProfitResumeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.cache = self.root / "income.json"
        self.staging = self.root / "income-pending"
        for patcher in (
            patch.object(profit, "CACHE", self.cache),
            patch.object(profit, "STAGING_DIR", self.staging),
            patch.object(profit, "END_DATE", "20261103"),
            patch.object(profit.time, "sleep", return_value=None),
            patch.dict(os.environ, {"XIAODENG_REFRESH_FULL": "0"}),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        atomic_json(self.cache, {
            "meta": {"end_date": "20261102"},
            "income": {code: [{"end_date": "20200331", "ann_date": "20200430",
                               "n_income_attr_p": 100}] for code in ("A", "B")},
        })

    @staticmethod
    def response(code):
        return [{"ts_code": code, "report_type": "1", "end_date": "20260930",
                 "ann_date": "20261103", "n_income_attr_p": 200}]

    def fail_after_second_stock_is_saved(self):
        before = self.cache.read_bytes()
        saved = Event()

        def write(path, value):
            atomic_json(path, value)
            if value.get("identity", {}).get("params", {}).get("ts_code") == "B":
                saved.set()

        def fetch(token, code, start):
            if code == "A":
                # The first ordered request cannot complete until B has been
                # saved. This catches collecting only executor.map results.
                self.assertTrue(saved.wait(3), "Completed worker was not saved immediately")
                raise RuntimeError("source unavailable for A")
            return self.response(code)

        with patch.object(profit, "fetch_income_rows", side_effect=fetch), \
                patch.object(profit, "atomic_json", side_effect=write):
            with self.assertRaisesRegex(RuntimeError, "source unavailable for A"):
                profit.ensure_income_cache("private-token", {"A", "B"})
        self.assertEqual(self.cache.read_bytes(), before)
        stages = list(self.staging.rglob("*.json"))
        self.assertEqual(len(stages), 1)
        staged = json.loads(stages[0].read_text())
        self.assertEqual(staged["rows"], self.response("B"))
        self.assertNotIn("private-token", stages[0].read_text())
        return stages[0]

    def finish(self):
        with patch.object(profit, "fetch_income_rows", side_effect=lambda _, code, start: self.response(code)) as fetch:
            result = profit.ensure_income_cache("private-token", {"A", "B"})
        return result, fetch.call_args_list

    def test_retry_requests_only_missing_stock_and_publishes_after_success(self):
        self.fail_after_second_stock_is_saved()
        result, calls = self.finish()
        self.assertEqual([call.args[1] for call in calls], ["A"])
        self.assertEqual(result["meta"]["end_date"], "20261103")
        for rows in result["income"].values():
            self.assertEqual([row["end_date"] for row in rows], ["20200331", "20260930"])
        self.assertEqual(json.loads(self.cache.read_text()), result)
        self.assertFalse(list(self.staging.rglob("*.json")))

    def test_new_date_fetches_again_and_removes_expired_stages(self):
        old_stage = self.fail_after_second_stock_is_saved()
        with patch.object(profit, "END_DATE", "20261104"):
            _, calls = self.finish()
        self.assertEqual({call.args[1] for call in calls}, {"A", "B"})
        self.assertFalse(old_stage.exists())

    def test_changed_query_window_cannot_reuse_saved_response(self):
        self.fail_after_second_stock_is_saved()
        baseline = json.loads(self.cache.read_text())
        baseline["meta"]["end_date"] = "20261101"
        atomic_json(self.cache, baseline)
        _, calls = self.finish()
        self.assertEqual({call.args[1] for call in calls}, {"A", "B"})
        self.assertEqual({call.args[2] for call in calls}, {profit.lookback("20261101")})

    def test_changed_fields_cannot_reuse_saved_response(self):
        self.fail_after_second_stock_is_saved()
        with patch.object(profit, "INCOME_FIELDS", profit.INCOME_FIELDS + ",basic_eps"):
            _, calls = self.finish()
        self.assertEqual({call.args[1] for call in calls}, {"A", "B"})

    def test_full_refresh_bypasses_stage_reads_and_writes(self):
        old_stage = self.fail_after_second_stock_is_saved()
        before = old_stage.read_bytes()
        with patch.dict(os.environ, {"XIAODENG_REFRESH_FULL": "1"}), \
                patch.object(profit, "atomic_json", wraps=atomic_json) as write:
            result, calls = self.finish()
        self.assertEqual({call.args[1] for call in calls}, {"A", "B"})
        self.assertEqual({call.args[2] for call in calls}, {None})
        self.assertEqual([call.args[0] for call in write.call_args_list], [self.cache])
        self.assertEqual(old_stage.read_bytes(), before)
        self.assertEqual(len(result["income"]["B"]), 1)

    def test_failed_official_publication_keeps_stages_for_retry(self):
        before = self.cache.read_bytes()
        with patch.object(profit, "fetch_income_rows", side_effect=lambda _, code, start: self.response(code)), \
                patch.object(profit, "save_cache", side_effect=OSError("disk unavailable")):
            with self.assertRaisesRegex(OSError, "disk unavailable"):
                profit.ensure_income_cache("private-token", {"A", "B"})
        self.assertEqual(self.cache.read_bytes(), before)
        self.assertEqual(len(list(self.staging.rglob("*.json"))), 2)
        _, calls = self.finish()
        self.assertEqual(calls, [])
        self.assertFalse(list(self.staging.rglob("*.json")))

    def test_corrupt_stage_is_refetched(self):
        stage = self.fail_after_second_stock_is_saved()
        stage.write_text("{incomplete", encoding="utf-8")
        _, calls = self.finish()
        self.assertEqual({call.args[1] for call in calls}, {"A", "B"})


if __name__ == "__main__":
    unittest.main()
