"""ETF net assets in CNY: match outstanding shares and unadjusted NAV dates."""
import json
import math
from bisect import bisect_right
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from fetch_large_money_etf_shares import INDEX_CODES, WEEKS, fund_history, request
from fetch_retail_sentiment_data import ROOT, get_token
from refresh_cache import CACHE_DIR, atomic_json, full_refresh, lookback, merge_rows
from weekly_dates import calendar_week_ends, week_key

OUTPUT = ROOT / 'work/large_money_etf_assets.json'


def nav_history(token, fund):
    file = CACHE_DIR / ('etf-nav-' + fund['ts_code'] + '.json')
    old = json.loads(file.read_text()) if file.exists() and not full_refresh() else {}
    today = datetime.now().strftime('%Y%m%d')
    start = lookback(old['checkedThrough']) if old else fund.get('list_date') or '20000101'
    rows = []
    for year in range(int(start[:4]), int(today[:4]) + 1):
        params = {'ts_code': fund['ts_code'], 'start_date': max(start, f'{year}0101'),
                  'end_date': min(today, f'{year}1231')}
        offset = 0
        while True:
            page = request(token, 'fund_nav', {**params, 'limit': 2000, 'offset': offset},
                           'ts_code,ann_date,nav_date,unit_nav')
            rows.extend(page)
            if len(page) < 2000:
                break
            offset += len(page)
    rows = merge_rows(old.get('rows', []), rows, ('nav_date', 'ann_date'))
    if not rows:
        raise RuntimeError('Empty initial ETF NAV: ' + fund['ts_code'])
    atomic_json(file, {'checkedThrough': today, 'rows': rows})
    return rows


def matched_assets(share_values, nav_rows):
    points = []
    for row in nav_rows:
        date, announcement, nav = row.get('nav_date'), row.get('ann_date'), row.get('unit_nav')
        shares = share_values.get(date)
        if not date or not announcement or not all(isinstance(v, (int,float)) and math.isfinite(v) and v > 0 for v in [nav, shares]):
            continue
        # fund_history has already converted shares to 100 million units.
        points.append({'date': date, 'available': max(date, announcement), 'assets': shares * nav})
    return sorted(points, key=lambda r: (r['available'], r['date']))


def aggregate(histories, labels):
    result = []
    for label in labels:
        compact = label.replace('-', '')
        eligible = {key: 0 for key in INDEX_CODES}
        reported = {key: 0 for key in INDEX_CODES}
        sums = {key: 0.0 for key in INDEX_CODES}
        observations = {}
        for fund, points in histories:
            if not fund.get('list_date') or fund['list_date'] > compact or fund.get('delist_date') and fund['delist_date'] < compact:
                continue
            key = next(k for k,c in INDEX_CODES.items() if c == fund['index_code'])
            eligible[key] += 1
            available = [p for p in points if p['available'] <= compact]
            if not available:
                continue
            latest = max(available, key=lambda p: (p['date'],p['available']))
            age = (datetime.strptime(compact,'%Y%m%d') - datetime.strptime(latest['date'],'%Y%m%d')).days
            if age > 15:
                continue
            reported[key] += 1
            sums[key] += latest['assets']
            observations[fund['ts_code']] = latest['date']
        if not any(reported.values()):
            continue
        coverage = {key: round(reported[key]/eligible[key]*100,2) if eligible[key] else None for key in INDEX_CODES}
        row = {'date': label, 'funds': sum(reported.values()), 'eligibleFunds': sum(eligible.values()),
               'coverage': round(sum(reported.values())/sum(eligible.values())*100,2),
               'groupCoverage': coverage, 'observationDates': observations}
        for key in INDEX_CODES:
            row[key] = round(sums[key],4) if eligible[key] and reported[key]/eligible[key] >= .9 else None
        # Require each active group to pass, so total always reconciles with
        # visible group values and a tiny missing group cannot hide in totals.
        row['total'] = round(sum(row[k] or 0 for k in INDEX_CODES),4) if all(not eligible[k] or row[k] is not None for k in INDEX_CODES) else None
        result.append(row)
    return result


def main():
    token = get_token()
    funds = {}
    for status in ['L','D']:
        for fund in request(token,'etf_basic',{'list_status':status},'ts_code,index_code,list_date,delist_date,list_status'):
            if fund.get('index_code') in INDEX_CODES.values():
                funds[fund['ts_code']] = fund
    if not funds:
        raise RuntimeError('Empty ETF universe')
    def history(fund):
        _, _, shares = fund_history(token, fund)
        return fund, matched_assets(shares, nav_history(token,fund))
    with ThreadPoolExecutor(max_workers=3) as pool:
        histories = list(pool.map(history, funds.values()))
    today = datetime.now().strftime('%Y%m%d')
    weeks = json.loads(WEEKS.read_text(encoding='utf-8'))['series']
    ends = calendar_week_ends(token, request, weeks, today)
    labels = sorted({f'{d[:4]}-{d[4:6]}-{d[6:]}' for row in weeks if (d:=ends.get(week_key(row['date'])))})
    series = aggregate(histories, labels)
    if not series or not any(row['total'] is not None for row in series):
        raise RuntimeError('No verifiable ETF assets; previous output retained')
    atomic_json(OUTPUT, {'meta': {'source':'Tushare etf_basic + fund_share + fund_nav unit_nav',
      'unit':'100 million CNY', 'definition':'same-date outstanding shares times unadjusted unit NAV; no market-price proxy',
      'coverageThreshold':90,'maxObservationAgeDays':15,'updated':datetime.now().strftime('%Y-%m-%d'),
      'scope':'unique ETFs tracking 399006.SZ, 000688.SH or 000680.SH, including delisted funds',
      'dateSemantics':'weekly exchange-session label; same-date shares and NAV, announced no later than label; see observationDates'},'series':series})
    print(json.dumps({'funds':len(funds),'points':len(series),'latest':series[-1]},ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
