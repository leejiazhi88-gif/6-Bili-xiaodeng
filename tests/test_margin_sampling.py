import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work'))
import fetch_retail_index_metrics as metrics


class LatestMarginSamplingTests(unittest.TestCase):
    def test_unpublished_friday_keeps_thursday_actual_date(self):
        rows = [{'ts_code': 'A', 'rzye': 10}]
        with patch.object(metrics, 'request', side_effect=[[], rows]) as call:
            day, cache = metrics.current_week_margin('token', '2026-11-20')
        self.assertEqual(day, '2026-11-19')
        self.assertEqual(cache, {'2026-11-20': [], '2026-11-19': rows})
        self.assertEqual(call.call_args.args[2]['trade_date'], '20261119')

    def test_published_friday_does_not_add_extra_sample(self):
        with patch.object(metrics, 'request', return_value=[{'rzye': 10}]) as call:
            day, _ = metrics.current_week_margin('token', '2026-11-20')
        self.assertEqual(day, '2026-11-20')
        self.assertEqual(call.call_count, 1)

    def test_never_relabels_prior_week_data_as_current_week(self):
        with patch.object(metrics, 'request', return_value=[]) as call:
            day, cache = metrics.current_week_margin('token', '2026-11-16')
        self.assertIsNone(day)
        self.assertEqual(list(cache), ['2026-11-16'])
        self.assertEqual(call.call_count, 1)
