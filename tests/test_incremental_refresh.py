import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work'))
import refresh_cache as cache
import fetch_market_overview_data as market
import fetch_large_money_etf_shares as etf
import fetch_large_money_fund_reports as funds
import fetch_index_profit_data as profit


class IncrementalRefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = patch.dict(os.environ, {'XIAODENG_REFRESH_FULL': '0'})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_historical_cache_expiry_full_and_failure(self):
        calls = []
        def fetch(token, api, params, fields):
            calls.append(params)
            return [{'value': len(calls)}]
        wrapped = cache.historical_cache(fetch)
        with patch.object(cache, 'CACHE_DIR', self.root):
            args = ('secret-token', 'daily', {'end_date': '20200101'}, 'value')
            self.assertEqual(wrapped(*args), wrapped(*args))
            self.assertEqual(len(calls), 1)
            file = next(self.root.glob('*.json'))
            self.assertNotIn('secret-token', file.read_text())
            with patch.dict(os.environ, {'XIAODENG_REFRESH_FULL': '1'}):
                wrapped(*args)
            self.assertEqual(len(calls), 2)
            data = json.loads(file.read_text())
            data['fetchedAt'] = (datetime.now() - timedelta(days=31)).isoformat()
            cache.atomic_json(file, data)
            before = file.read_bytes()
            def fail(*args):
                raise RuntimeError('source unavailable')
            with self.assertRaises(RuntimeError):
                cache.historical_cache(fail)(*args)
            self.assertEqual(file.read_bytes(), before)
            wrapped(*args)
            self.assertEqual(len(calls), 3)

    def test_recent_and_paginated_requests_never_use_stale_cache(self):
        calls = []
        @cache.historical_cache
        def fetch(*args):
            calls.append(args)
            return []
        with patch.object(cache, 'CACHE_DIR', self.root):
            for params in ({'end_date': datetime.now().strftime('%Y%m%d')},
                           {'end_date': '20200101', 'offset': 0}):
                fetch('', 'daily', params, '')
                fetch('', 'daily', params, '')
        self.assertEqual(len(calls), 4)
        self.assertFalse(list(self.root.iterdir()))

    def test_atomic_write_rejects_invalid_values_without_losing_cache(self):
        file = self.root / 'data.json'
        cache.atomic_json(file, {'value': 1})
        with self.assertRaises(ValueError):
            cache.atomic_json(file, {'value': float('nan')})
        self.assertEqual(json.loads(file.read_text()), {'value': 1})

    def test_market_lookback_preserves_old_rows_and_applies_revisions(self):
        old = [{'date': '2020-01-01', 'close': 10},
               {'date': '2026-10-30', 'close': 20}]
        requests = []
        def fetch(token, api, code, fields, start):
            requests.append(start)
            if api == 'index_daily':
                return [{'trade_date': '20261030', 'close': 21, 'vol': 1, 'amount': 1},
                        {'trade_date': '20261102', 'close': 22, 'vol': 1, 'amount': 1}]
            return [{'trade_date': '20261030', 'pe_ttm': 5, 'pb': 2}]
        with patch.object(market, 'fetch_by_year', side_effect=fetch):
            result = market.build_market('', 'index', old)
        self.assertEqual(requests, ['20260801', '20260801'])
        self.assertEqual(result[0], old[0])
        self.assertEqual(result[1]['close'], 21)
        self.assertEqual(len(result), 3)
        self.assertIsNone(result[-1]['pe'])
        with patch.object(market, 'fetch_by_year', return_value=[]):
            with self.assertRaises(RuntimeError):
                market.build_market('', 'index', old)

    def test_etf_incremental_requests_and_duplicate_revision(self):
        today = datetime.now().strftime('%Y%m%d')
        path = self.root / 'etf-test.SH.json'
        cache.atomic_json(path, {'checkedThrough': today, 'rows': [
            {'trade_date': '20200101', 'fd_share': 100},
            {'trade_date': today, 'fd_share': 200}]})
        requests = []
        def request(token, api, params, fields):
            requests.append(params)
            return [{'trade_date': today, 'fd_share': 300}]
        with patch.object(etf, 'CACHE_DIR', self.root), patch.object(etf, 'request', side_effect=request):
            _, dates, values = etf.fund_history('', {'ts_code': 'test.SH'})
        self.assertEqual(requests[0]['start_date'], cache.lookback(today))
        self.assertEqual(dates, ['20200101', today])
        self.assertEqual(values[today], .03)
        before = path.read_bytes()
        with patch.object(etf, 'CACHE_DIR', self.root), patch.object(etf, 'request', side_effect=RuntimeError('down')):
            with self.assertRaises(RuntimeError):
                etf.fund_history('', {'ts_code': 'test.SH'})
        self.assertEqual(path.read_bytes(), before)

    def test_etf_full_bypasses_incremental_start(self):
        requests = []
        def request(token, api, params, fields):
            requests.append(params)
            return [{'trade_date': '20200101', 'fd_share': 100}]
        with patch.object(etf, 'CACHE_DIR', self.root), patch.object(etf, 'request', side_effect=request), patch.dict(os.environ, {'XIAODENG_REFRESH_FULL': '1'}):
            etf.fund_history('', {'ts_code': 'test.SH'})
        self.assertNotIn('start_date', requests[0])

    def test_funds_recently_verified_skip_all_network(self):
        now = datetime.now()
        periods = [f'{y}{end}' for y in range(2005, now.year + 1)
                   for end in ('0630', '1231') if f'{y}{end}' <= now.strftime('%Y%m%d')]
        path = self.root / 'funds.json'
        cache.atomic_json(path, {'meta': {'checkedAt': {p: now.isoformat() for p in periods}},
                               'series': [{'date': f'{p[:4]}-{p[4:6]}-{p[6:]}', 'funds': 10} for p in periods]})
        with patch.object(funds, 'OUTPUT', path), patch.object(funds, 'get_token', return_value=''), patch.object(funds, 'active_funds') as network:
            funds.main()
            network.assert_not_called()

    def test_funds_expired_latest_and_full_audit(self):
        now = datetime.now()
        periods = [f'{y}{end}' for y in range(2005, now.year + 1)
                   for end in ('0630', '1231') if f'{y}{end}' <= now.strftime('%Y%m%d')]
        path = self.root / 'funds.json'
        state = {'meta': {'checkedAt': {p: now.isoformat() for p in periods}},
                 'series': [{'date': f'{p[:4]}-{p[4:6]}-{p[6:]}', 'funds': 10, 'coverage': 90} for p in periods]}
        state['meta']['checkedAt'][periods[-1]] = (now - timedelta(days=8)).isoformat()
        cache.atomic_json(path, state)
        def report(token, period, universe):
            return {'date': f'{period[:4]}-{period[4:6]}-{period[6:]}', 'funds': 10, 'coverage': 90}
        with patch.object(funds, 'OUTPUT', path), patch.object(funds, 'get_token', return_value=''), patch.object(funds, 'active_funds', return_value={}), patch.object(funds, 'report', side_effect=report) as fetch, patch('builtins.print'):
            funds.main()
            self.assertEqual([call.args[1] for call in fetch.call_args_list], [periods[-1]])
            fetch.reset_mock()
            with patch.dict(os.environ, {'XIAODENG_REFRESH_FULL': '1'}):
                funds.main()
            self.assertEqual([call.args[1] for call in fetch.call_args_list], periods)

    def test_profit_recent_announcements_keep_older_ttm_inputs(self):
        last = (datetime.strptime(profit.END_DATE, '%Y%m%d') - timedelta(days=1)).strftime('%Y%m%d')
        state = {'meta': {'end_date': last}, 'income': {'stock': [
            {'end_date': '20200331', 'ann_date': '20200430', 'n_income_attr_p': 100},
            {'end_date': '20260630', 'ann_date': '20260830', 'n_income_attr_p': 200}]}}
        recent = [{'report_type': '1', 'end_date': '20260630', 'ann_date': '20260830', 'n_income_attr_p': 210}]
        with patch.object(profit, 'load_cache', return_value=state), patch.object(profit, 'save_cache'), patch.object(profit, 'fetch_income_rows', return_value=recent) as fetch:
            result = profit.ensure_income_cache('', ['stock'])
        fetch.assert_called_once_with('', 'stock', cache.lookback(last))
        self.assertEqual(len(result['income']['stock']), 2)
        self.assertEqual(result['income']['stock'][0]['n_income_attr_p'], 100)
        self.assertEqual(result['income']['stock'][1]['n_income_attr_p'], 210)


if __name__ == '__main__':
    unittest.main()
