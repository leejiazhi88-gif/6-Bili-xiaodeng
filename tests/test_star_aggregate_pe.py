import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "work"))
from fetch_star_aggregate_pe import members_on, stock_profit  # noqa: E402


class StarAggregateMembershipTests(unittest.TestCase):
    def test_verified_midmonth_events_apply_only_until_next_snapshot(self):
        events = json.loads((ROOT / "work" / "star_constituent_events.json").read_text(encoding="utf-8"))["events"]
        snapshots = {
            "20260529": {"688022.SH", "688033.SH", "688066.SH", "BASE"},
            "20260630": {"BASE"},
            "20260930": {"BASE"},
            "20261030": {"BASE", "688825.SH", "688759.SH", "688765.SH", "688783.SH"},
        }
        snapshots["20260227"] = {"BASE"}
        snapshots["20260331"] = {"BASE", "688795.SH", "688802.SH", "688757.SH"}
        dates = sorted(snapshots)
        self.assertEqual(members_on("20260304", snapshots, dates, events), {"BASE"})
        self.assertEqual(members_on("20260305", snapshots, dates, events), {"BASE", "688795.SH"})
        self.assertEqual(len(members_on("20260317", snapshots, dates, events)), 3)
        self.assertEqual(len(members_on("20260325", snapshots, dates, events)), 4)
        self.assertIn("688033.SH", members_on("20260612", snapshots, dates, events))
        self.assertEqual(members_on("20260615", snapshots, dates, events), {"BASE"})
        self.assertEqual(members_on("20260630", snapshots, dates, events), {"BASE"})
        self.assertEqual(members_on("20261026", snapshots, dates, events), {"BASE"})
        self.assertEqual(members_on("20261027", snapshots, dates, events), {"BASE", "688825.SH"})
        self.assertEqual(len(members_on("20261028", snapshots, dates, events)), 5)
        self.assertEqual(len(members_on("20261030", snapshots, dates, events)), 5)
        self.assertEqual(len(snapshots["20260930"]), 1)

    def test_annual_flash_precedes_formal_report_only_after_announcement(self):
        records = [
            {"ann_date": "20250401", "end_date": "20240331", "n_income_attr_p": 1},
            {"ann_date": "20250401", "end_date": "20240630", "n_income_attr_p": 4},
            {"ann_date": "20250401", "end_date": "20240930", "n_income_attr_p": 7},
            {"ann_date": "20250401", "end_date": "20241231", "n_income_attr_p": 10},
            {"ann_date": "20250401", "end_date": "20250331", "n_income_attr_p": 3},
            {"ann_date": "20250801", "end_date": "20250630", "n_income_attr_p": 7},
            {"ann_date": "20251030", "end_date": "20250930", "n_income_attr_p": 10},
            {"ann_date": "20260430", "end_date": "20251231", "n_income_attr_p": 20},
        ]
        flashes = [{"ann_date": "20260227", "end_date": "20251231", "n_income": 25}]
        self.assertEqual(stock_profit(records, "20260226", flashes), 13)
        self.assertEqual(stock_profit(records, "20260227", flashes), 25)
        self.assertEqual(stock_profit(records, "20260430", flashes), 20)

    def test_quarterly_flash_converts_cumulative_profit_to_ttm(self):
        records = [
            {"ann_date": "20250401", "end_date": "20250331", "n_income_attr_p": 3},
            {"ann_date": "20250801", "end_date": "20250630", "n_income_attr_p": 7},
            {"ann_date": "20251030", "end_date": "20250930", "n_income_attr_p": 10},
            {"ann_date": "20260430", "end_date": "20251231", "n_income_attr_p": 20},
            {"ann_date": "20260520", "end_date": "20260331", "n_income_attr_p": 5},
        ]
        flashes = [{"ann_date": "20260507", "end_date": "20260331", "n_income": 6}]
        self.assertEqual(stock_profit(records, "20260506", flashes), 20)
        self.assertEqual(stock_profit(records, "20260507", flashes), 23)
        self.assertEqual(stock_profit(records, "20260520", flashes), 22)

    def test_formal_annual_profit_works_without_four_prior_quarters(self):
        records = [{"ann_date": "20260430", "end_date": "20251231", "n_income_attr_p": -9}]
        flashes = [{"ann_date": "20260227", "end_date": "20251231", "n_income": -8}]
        self.assertEqual(stock_profit(records, "20260227", flashes), -8)
        self.assertEqual(stock_profit(records, "20260430", flashes), -9)


if __name__ == "__main__":
    unittest.main()
