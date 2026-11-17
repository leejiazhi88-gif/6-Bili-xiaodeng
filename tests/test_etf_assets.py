import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'work'))
from fetch_large_money_etf_assets import matched_assets, aggregate

class ETFAssetsTests(unittest.TestCase):
    def test_same_date_raw_nav_and_shares_and_announcement_cutoff(self):
        points=matched_assets({'20261113':2,'20261116':3},[
            {'nav_date':'20261113','ann_date':'20261113','unit_nav':1.5},
            {'nav_date':'20261116','ann_date':'20261117','unit_nav':2},
            {'nav_date':'20261112','ann_date':'20261112','unit_nav':9}])
        self.assertEqual([p['assets'] for p in points],[3,6])
        fund={'ts_code':'A','index_code':'399006.SZ','list_date':'20200101'}
        rows=aggregate([(fund,points)],['2026-11-16','2026-11-17'])
        self.assertEqual([r['total'] for r in rows],[3,6])
        self.assertEqual(rows[0]['observationDates']['A'],'20261113')

    def test_missing_group_prevents_misleading_total_and_stale_data_not_zero(self):
        a={'ts_code':'A','index_code':'399006.SZ','list_date':'20200101'}
        b={'ts_code':'B','index_code':'000688.SH','list_date':'20200101'}
        points=[{'date':'20261116','available':'20261116','assets':10}]
        rows=aggregate([(a,points),(b,[])],['2026-11-17'])
        self.assertEqual(rows[0]['sh'],10)
        self.assertIsNone(rows[0]['k50'])
        self.assertIsNone(rows[0]['total'])
        self.assertEqual(aggregate([(a,points)],['2026-12-02']),[])

    def test_distinct_funds_add_even_when_holdings_overlap_and_delisted_exit(self):
        funds=[{'ts_code':'A','index_code':'000688.SH','list_date':'20200101','delist_date':'20261116'},
               {'ts_code':'B','index_code':'000680.SH','list_date':'20200101'}]
        histories=[(f,[{'date':'20261116','available':'20261116','assets':v}]) for f,v in zip(funds,[20,30])]
        rows=aggregate(histories,['2026-11-16','2026-11-17'])
        self.assertEqual([r['total'] for r in rows],[50,30])

if __name__=='__main__':unittest.main()
