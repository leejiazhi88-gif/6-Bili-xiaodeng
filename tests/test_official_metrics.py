import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work'))
from official_metrics import complete_window, aggregate_ipo, aggregate_holders, aggregate_board_ipo, aggregate_board_holders
from fetch_large_money_sentiment_data import STOCK_CODE
import fetch_official_sentiment_data as official


class OfficialMetricsTests(unittest.TestCase):
    def test_split_limit_without_losing_boundary_dates(self):
        calls = []
        def fetch(token, api, params, fields):
            a, b = params['start_date'], params['end_date']
            calls.append((a, b))
            return ['truncated'] * 3 if a != b else [{'date': a}]
        rows = complete_window(fetch, '', 'source', '20260101', '20260104', '', 3)
        self.assertEqual([r['date'] for r in rows], ['20260101', '20260102', '20260103', '20260104'])
        self.assertIn(('20260103', '20260104'), calls)
        with self.assertRaisesRegex(ValueError, 'row limit'):
            complete_window(lambda *a: [1] * 3, '', 'source', '20260101', '20260101', '', 3)

    def test_legacy_holder_cap_is_not_treated_as_complete(self):
        calls = []
        def fetch(token, api, params, fields):
            calls.append(params)
            return [1] * 2000 if params['start_date'] != params['end_date'] else []
        self.assertEqual(complete_window(fetch, '', 'stk_holdertrade', '20260101', '20260102', '', 3000), [])
        self.assertEqual(len(calls), 3)
        rows = complete_window(lambda *a: [1] * 2172, '', 'stk_holdertrade', '20260101', '20260101', '', 3000)
        self.assertEqual(len(rows), 2172)

    def test_ipo_units_dedup_fallback_and_missing_are_not_zero(self):
        row = dict(ts_code='688001.SH', ipo_date='20260120', issue_date='20260201', amount=1713, price=45.37, funds=999)
        missing = dict(ts_code='300001.SZ', ipo_date=None, issue_date='20260201', amount=100, price=None, funds=5)
        result = aggregate_ipo([row, row, missing], ['202601', '202602', '202603'])
        self.assertEqual(result['202601'], {'ipoFund': 7.77, 'ipoCount': 1, 'ipoMissingFunds': 0})
        self.assertIsNone(result['202602']['ipoFund'])
        self.assertEqual(result['202603']['ipoFund'], 0)
        with self.assertRaisesRegex(ValueError, 'Conflicting IPO'):
            aggregate_ipo([row, dict(row, price=46)], ['202601'])

    def test_ipo_board_includes_all_issuers_without_membership_filter(self):
        rows = [dict(ts_code='300114.SZ', ipo_date='20100102', amount=10000, price=12),
                dict(ts_code='301001.SZ', ipo_date='20210703', amount=10000, price=20),
                dict(ts_code='688001.SH', ipo_date='20210704', amount=10000, price=30),
                dict(ts_code='600001.SH', ipo_date='20210705', amount=10000, price=40),
                dict(ts_code='300002.SZ', ipo_date='20270101', amount=10000, price=50)]
        values, coverage = aggregate_board_ipo(rows, ['200912', '201001', '202107', '202611'], '20261103')
        self.assertEqual(values['chinext']['201001']['ipoFund'], 12)
        self.assertEqual(values['chinext']['202107']['ipoFund'], 20)
        self.assertEqual(values['star']['202107']['ipoFund'], 30)
        self.assertEqual(values['chinext']['202611']['ipoFund'], 0)
        self.assertIsNone(values['star']['201001']['ipoFund'])
        self.assertEqual(coverage['chinext']['records'], 2)
        self.assertNotIn('k50', values)

    def test_ipo_missing_amount_affects_its_board_not_other_boards(self):
        rows = [dict(ts_code='300001.SZ', ipo_date='20200102', amount=100, price=None),
                dict(ts_code='688001.SH', ipo_date='20200102', amount=100, price=10)]
        values, cover = aggregate_board_ipo(rows, ['202001'], '20261103')
        self.assertIsNone(values['chinext']['202001']['ipoFund'])
        self.assertEqual(cover['chinext']['missingAmountRecords'], 1)
        self.assertEqual(values['star']['202001']['ipoFund'], .1)

    def test_holders_same_records_sign_units_historical_membership_and_coverage(self):
        def row(code, day, direction, volume, price):
            return dict(ts_code=code, ann_date=day, holder_name='holder', in_de=direction, change_vol=volume, avg_price=price)
        sale = row('300001.SZ', '20260105', 'DE', 10000000, 20)
        rows = [sale, sale, row('300001.SZ', '20260112', 'IN', 5000000, 10),
                row('688001.SH', '20260120', 'DE', 1000000, 30),
                row('300001.SZ', '20260121', 'DE', 10000, None),
                row('300001.SZ', '20260122', 'UNKNOWN', 10000, 10),
                row('000001.HK', '20260123', 'DE', 100000000, 100)]
        memberships = {
            'sh': (['20251231', '20260115'], {'20251231': {'300001.SZ'}, '20260115': {'688001.SH'}}),
            'future': (['20260110'], {'20260110': {'300001.SZ'}}),
            'stale': (['20251001'], {'20251001': {'300001.SZ'}}),
        }
        result = aggregate_holders(rows, ['202601', '202602'], memberships, STOCK_CODE, '20260228')
        market = result['202601']['market']
        self.assertEqual(market['holderNetReductionAmount'], 1.8)  # 2 - 0.5 + 0.3 亿元
        self.assertEqual((market['records'], market['pricedRecords'], market['missingRecords']), (5, 3, 2))
        self.assertEqual(result['202601']['sh']['holderNetReductionAmount'], 1.8)
        self.assertIsNone(result['202601']['future']['holderNetReductionAmount'])
        self.assertIsNone(result['202601']['stale']['holderNetReductionAmount'])
        self.assertEqual(result['202602']['market']['holderNetReductionAmount'], 0)

    def test_all_unpriced_is_missing_and_no_future_announcement(self):
        rows = [dict(ts_code='300001.SZ', ann_date='20261102', holder_name='x', in_de='DE', change_vol=100, avg_price=None),
                dict(ts_code='300001.SZ', ann_date='20261110', holder_name='y', in_de='DE', change_vol=100000000, avg_price=100)]
        result = aggregate_holders(rows, ['202611'], {}, STOCK_CODE, '20261103')['202611']['market']
        self.assertIsNone(result['holderNetReductionAmount'])
        self.assertEqual(result['records'], 1)

    def test_holder_boards_include_non_index_stocks_and_keep_missing_coverage(self):
        def row(code, direction, price):
            return dict(ts_code=code, ann_date='20260105', holder_name=code,
                        in_de=direction, change_vol=10000000, avg_price=price)
        rows = [row('302001.SZ', 'DE', 20), row('301999.SZ', 'IN', 5),
                row('688999.SH', 'DE', 30), row('689001.SH', 'DE', None),
                row('600001.SH', 'IN', 10), row('920001.BJ', 'DE', 10),
                row('000001.HK', 'DE', 100)]
        result = aggregate_board_holders(rows + [rows[0]], ['201901', '202601', '202602'], '20260228')
        january = result['202601']
        self.assertEqual(set(january), {'market', 'chinext', 'star'})
        self.assertEqual(january['market']['holderNetReductionAmount'], 4.5)
        self.assertEqual(january['chinext']['holderNetReductionAmount'], 1.5)
        self.assertEqual(january['star']['holderNetReductionAmount'], 3)
        self.assertEqual(january['star']['missingRecords'], 1)
        self.assertEqual(january['star']['records'], 2)
        self.assertIsNone(result['201901']['star']['holderNetReductionAmount'])
        self.assertEqual(result['202602']['star']['holderNetReductionAmount'], 0)
        missing = aggregate_board_holders([rows[3]], ['202601'], '20260131')
        self.assertIsNone(missing['202601']['star']['holderNetReductionAmount'])

    def test_policy_rate_uses_actual_cutoff_not_future_day_28(self):
        self.assertEqual(official.active_stamp_rate('200803'), .3)
        self.assertEqual(official.active_stamp_rate('200804'), .1)
        with patch.object(official, 'END_DATE', '20230815'):
            self.assertEqual(official.active_stamp_rate('202308'), .1)
        with patch.object(official, 'END_DATE', '20230828'):
            self.assertEqual(official.active_stamp_rate('202308'), .05)


if __name__ == '__main__':
    unittest.main()
