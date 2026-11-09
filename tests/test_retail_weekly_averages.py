import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work'))
import fetch_retail_weekly_averages as weekly


class WeeklyMeanTests(unittest.TestCase):
    def test_holiday_week_uses_trading_days_not_seven_or_last_day(self):
        result = weekly.weekly_means([
            {'date': '2026-10-09', 'amount': 300, 'turnover': 3},
            {'date': '2026-10-08', 'amount': 100, 'turnover': 1},
            {'date': '2026-10-12', 'amount': 450, 'turnover': 4}], ['amount', 'turnover'])
        self.assertEqual(result[0], {'date': '2026-10-09', 'periodStart': '2026-10-08',
                                     'tradingDays': 2, 'amount': 200, 'turnover': 2})
        self.assertEqual(result[1]['amount'], 450)
        self.assertEqual(result[1]['tradingDays'], 1)

    def test_iso_week_crosses_calendar_year_and_missing_is_not_zero(self):
        result = weekly.weekly_means([
            {'date': '2025-12-31', 'amount': 0, 'volume': 2},
            {'date': '2026-01-02', 'amount': 100, 'volume': None},
            {'date': '2026-01-05', 'amount': 90, 'volume': 4}], ['amount', 'volume'])
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['amount'], 50)
        self.assertIsNone(result[0]['volume'])
        self.assertEqual(result[1]['volume'], 4)

    def test_constituents_are_as_of_day_and_turnover_is_daily_cap_weighted(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder) / 'daily.json'
            def daily(_token, _api, params, _fields):
                return [{'ts_code': 'A', 'circ_mv': 100, 'turnover_rate': 1},
                        {'ts_code': 'B', 'circ_mv': 300, 'turnover_rate': 5},
                        {'ts_code': 'C', 'circ_mv': 100, 'turnover_rate': 9}]
            with patch.object(weekly, 'DAILY_CACHE', cache), patch.object(weekly, 'snapshots',
                    return_value=(['20261103', '20261105'], {'20261103': {'A', 'B'}, '20261105': {'C'}})), \
                    patch.object(weekly, 'request', side_effect=daily):
                values = weekly.star_turnover('unused', ['2026-11-02', '2026-11-03', '2026-11-05'], 2026)
            self.assertIsNone(values['2026-11-02'])
            self.assertEqual(values['2026-11-03'], 4)
            self.assertEqual(values['2026-11-05'], 9)

    def test_incremental_refresh_only_fetches_recent_trading_days(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder) / 'daily.json'
            days = [f'2026-11-{i:02}' for i in range(2, 14)]
            cache.write_text(json.dumps({d: 8 for d in days}))
            calls = []
            def daily(_token, _api, params, _fields):
                calls.append(params['trade_date'])
                return [{'ts_code': 'A', 'circ_mv': 100, 'turnover_rate': 1}]
            with patch.object(weekly, 'DAILY_CACHE', cache), patch.object(weekly, 'full_refresh', return_value=False), \
                    patch.object(weekly, 'snapshots', return_value=(['20260101'], {'20260101': {'A'}})), \
                    patch.object(weekly, 'request', side_effect=daily):
                values = weekly.star_turnover('unused', days, 2026)
            self.assertEqual(len(calls), 8)
            self.assertEqual(values[days[0]], 8)
            self.assertEqual(values[days[-1]], 1)


if __name__ == '__main__':
    unittest.main()
