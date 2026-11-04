import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work'))
from refinancing_metrics import normalize_issuances, aggregate_refinancing
from fetch_refinancing_data import fetch_complete


class RefinancingBoardTests(unittest.TestCase):
    def test_implemented_dates_amount_units_board_and_primary_offering_exclusion(self):
        additional = [
            dict(SECUCODE='300001.SZ', FINANCE_CODE='1', ISSUE_DATE='2026-01-05', ISSUE_LISTING_DATE='2026-02-01',
                 TOTAL_RAISE_FUNDS=200000000, ISSUE_NUM=10000000, ISSUE_PRICE=20, ISSUE_WAY='网下询价配售'),
            dict(SECUCODE='688001.SH', FINANCE_CODE='2', ISSUE_DATE='2026-01-06', ISSUE_NUM=5000000, ISSUE_PRICE=20),
            dict(SECUCODE='920001.BJ', FINANCE_CODE='3', ISSUE_DATE='2026-01-07', TOTAL_RAISE_FUNDS=500000000),
            dict(SECUCODE='300001.SZ', FINANCE_CODE='4', ISSUE_DATE='2026-02-28', TOTAL_RAISE_FUNDS=500000000),
        ]
        rights = [dict(SECUCODE='300001.SZ', FINANCE_CODE='5', PAY_END_DATE='2026-01-31',
                       LISTING_DATE='2026-02-20', TOTAL_RAISE_FUNDS=300000000)]
        records, excluded = normalize_issuances(additional, rights,
            {'300001.SZ': '20091030', '688001.SH': '20190722', '920001.BJ': '20260120'}, '2026-02-03')
        self.assertEqual(len(records), 3)
        self.assertEqual(excluded[0]['id'], '3')
        self.assertEqual(records[1]['amountSource'], 'ISSUE_NUM * ISSUE_PRICE')
        rows = aggregate_refinancing(records, '2026-02', '2026-01')
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row['refinanceFund'], 6)
        self.assertEqual(row['refinanceBoards']['chinext']['refinanceFund'], 5)
        self.assertEqual(row['refinanceBoards']['star']['refinanceFund'], 1)
        self.assertEqual(row['rightsFund'], 3)  # payment month, not February listing month

    def test_missing_amount_is_not_zero_and_empty_completed_month_is_zero(self):
        records, _ = normalize_issuances([
            dict(SECUCODE='300001.SZ', FINANCE_CODE='1', ISSUE_DATE='2026-01-05'),
            dict(SECUCODE='688001.SH', FINANCE_CODE='2', ISSUE_DATE='2026-01-06', TOTAL_RAISE_FUNDS=100000000)
        ], [], {'300001.SZ': '20091030', '688001.SH': '20190722'}, '2026-03-01')
        rows = aggregate_refinancing(records, '2026-03', '2026-01')
        self.assertIsNone(rows[0]['refinanceFund'])
        self.assertIsNone(rows[0]['refinanceBoards']['chinext']['refinanceFund'])
        self.assertEqual(rows[0]['refinanceBoards']['star']['refinanceFund'], 1)
        self.assertEqual(rows[1]['refinanceFund'], 0)
        self.assertEqual(rows[0]['coverage']['market']['missingAmounts'], 1)

    def test_unknown_listing_metadata_and_duplicate_events_stop_publication(self):
        row = dict(SECUCODE='300001.SZ', FINANCE_CODE='1', ISSUE_DATE='2026-01-05', TOTAL_RAISE_FUNDS=100)
        with self.assertRaisesRegex(ValueError, 'Initial listing'):
            normalize_issuances([row], [], {}, '2026-02-01')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            normalize_issuances([row, row], [], {'300001.SZ': '20091030'}, '2026-02-01')

    def test_pagination_is_complete_stable_and_unique(self):
        def request(*args):
            page = args[-1]
            return {'count': 3, 'pages': 2, 'data': [{'FINANCE_CODE': '1'}, {'FINANCE_CODE': '2'}] if page == 1 else [{'FINANCE_CODE': '3'}]}
        self.assertEqual(len(fetch_complete('report', 'date', 'columns', '2008-01-01', request)), 3)
        for mode in ('duplicate', 'short', 'changed'):
            def bad(*args):
                result = request(*args)
                if args[-1] == 2:
                    if mode == 'duplicate': result['data'] = [{'FINANCE_CODE': '1'}]
                    if mode == 'short': result['data'] = []
                    if mode == 'changed': result['count'] = 4
                return result
            with self.assertRaises(ValueError):
                fetch_complete('report', 'date', 'columns', '2008-01-01', bad)


if __name__ == '__main__':
    unittest.main()
