import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work'))
from fetch_large_money_sentiment_data import aggregate_northbound


class NorthboundTests(unittest.TestCase):
    def test_weekly_sum_not_last_day_and_dedup(self):
        rows = [{'trade_date': d, 'north_money': v} for d, v in [
            ('20240812', -772.99), ('20240813', -2527.39), ('20240814', -7166.44),
            ('20240815', 12205.84), ('20240816', -6774.99)]]
        result = aggregate_northbound(rows + [rows[0]])['2024-W33']
        self.assertAlmostEqual(result['northMoney'], -50.3597)
        self.assertEqual(result['date'], '20240816')

    def test_null_is_not_zero_and_cutoff(self):
        result = aggregate_northbound([
            {'trade_date': '20240815', 'north_money': None},
            {'trade_date': '20240816', 'north_money': 100},
            {'trade_date': '20240819', 'north_money': 999999},
        ])
        self.assertEqual(len(result), 1)
        self.assertIsNone(result['2024-W33']['northMoney'])

    def test_iso_week_across_year_boundary(self):
        result = aggregate_northbound([
            {'trade_date': '20201231', 'north_money': 100},
            {'trade_date': '20210101', 'north_money': 200},
        ])
        self.assertEqual(result['2020-W53']['northMoney'], 3)

    def test_conflicting_duplicate_rejected(self):
        with self.assertRaises(ValueError):
            aggregate_northbound([{'trade_date': '20240816', 'north_money': x} for x in [1, 2]])


if __name__ == '__main__':
    unittest.main()
