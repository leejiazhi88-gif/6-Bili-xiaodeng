"""Completed stock issuance amounts, shared source for market/ChiNext/STAR.

Daily refresh replaces a 180-day window; --full retrieves the complete source.
Keep source records, enforce pagination completeness, exclude initial offerings.
"""
import json
import ssl
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
from refresh_cache import atomic_json, full_refresh
from fetch_official_sentiment_data import call_api, get_token
from refinancing_metrics import normalize_issuances, aggregate_refinancing

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'work/refinancing_data.json'
SOURCE = ROOT / 'work/refinancing_issuance_records.json'
CACHE = ROOT / 'work/.refresh-cache/refinancing-raw.json'
ENDPOINT = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
REPORTS = {
    'additional': ('RPT_SEO_DETAIL', 'ISSUE_DATE', 'SECUCODE,SECURITY_NAME_ABBR,FINANCE_CODE,ISSUE_DATE,ISSUE_LISTING_DATE,ISSUE_NUM,ISSUE_PRICE,TOTAL_RAISE_FUNDS,ISSUE_WAY,SEO_TYPE'),
    'rights': ('RPT_IPO_ALLOTMENT', 'PAY_END_DATE', 'SECUCODE,SECURITY_NAME_ABBR,FINANCE_CODE,PAY_END_DATE,LISTING_DATE,ISSUE_NUM,ISSUE_PRICE,TOTAL_RAISE_FUNDS'),
}


def request_page(report, date_field, columns, start, page):
    params = dict(reportName=report, columns=columns, sortColumns=date_field + ',FINANCE_CODE', sortTypes='-1,-1',
                  pageSize=500, pageNumber=page, source='WEB', client='WEB', filter=f'({date_field}>=\'{start}\')')
    request = urllib.request.Request(ENDPOINT + '?' + urlencode(params), headers={'User-Agent': 'Mozilla/5.0'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30, context=ssl._create_unverified_context()) as response:
                result = json.load(response)
            if not result.get('success') or not isinstance(result.get('result'), dict):
                raise ValueError('Invalid Eastmoney issuance response')
            return result['result']
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1)


def fetch_complete(report, date_field, columns, start, request=request_page):
    first = request(report, date_field, columns, start, 1)
    pages, count = first['pages'], first['count']
    if not 1 <= pages <= 100 or not count:
        raise ValueError(f'Empty or unexpectedly large issuance response: {report}')
    rows = list(first['data'])
    with ThreadPoolExecutor(max_workers=2) as pool:
        for page in pool.map(lambda n: request(report, date_field, columns, start, n), range(2, pages + 1)):
            if page['pages'] != pages or page['count'] != count:
                raise ValueError(f'Issuance source changed during pagination: {report}')
            rows.extend(page['data'])
    identities = [str(row['FINANCE_CODE']) for row in rows]
    if len(rows) != count or len(set(identities)) != count:
        raise ValueError(f'Truncated or duplicated issuance pages: {report}')
    if pages > 1:
        check = request(report, date_field, columns, start, 1)
        if check['count'] != count or check['data'] != first['data']:
            raise ValueError(f'Issuance source changed during pagination: {report}')
    return rows


def main():
    now = datetime.now(ZoneInfo('Asia/Shanghai'))
    cutoff = (now - timedelta(days=180)).strftime('%Y-%m-%d')
    previous = json.loads(CACHE.read_text()) if CACHE.exists() and not full_refresh() else None
    if previous and not previous.get('completeFrom2008'):
        previous = None
    raw = {}
    for kind, (report, field, columns) in REPORTS.items():
        # Rights issues are infrequent; retrieve their small complete history.
        start = cutoff if previous and kind == 'additional' else '2008-01-01'
        fresh = fetch_complete(report, field, columns, start)
        old = [r for r in previous[kind] if (r.get(field) or '')[:10] < start] if previous else []
        raw[kind] = old + fresh
    token = get_token()
    listing_dates = {}
    for status in ('L', 'D', 'P'):
        rows = call_api(token, 'stock_basic', {'list_status': status}, 'ts_code,name,list_date,list_status')
        if (status != 'P' and not rows) or len(rows) >= 10000:
            raise ValueError('Incomplete initial-listing metadata; existing data retained')
        listing_dates.update({r['ts_code']: r['list_date'] for r in rows if r.get('list_date')})
    records, excluded = normalize_issuances(raw['additional'], raw['rights'], listing_dates, now.strftime('%Y-%m-%d'))
    if not records:
        raise ValueError('Empty completed-issuance data; existing data retained')
    series = aggregate_refinancing(records, now.strftime('%Y-%m'))
    meta = {'updated': now.isoformat(timespec='seconds'), 'schemaVersion': 2, 'provider': '东方财富数据中心',
            'source': 'https://data.eastmoney.com/other/qbzf.html',
            'rightsSource': 'https://data.eastmoney.com/xg/pg/', 'unit': '亿元', 'frequency': 'monthly',
            'definition': '已实施增发、配股发行金额；含非现金资产认购及换股合并，不等于现金到账或二级市场流出；不含可转债和首次发行。',
            'dateDefinition': '增发按发行日期，配股按缴款截止日归月；仅展示已结束月，未用上市日或公告日替代。',
            'boardDefinition': '按发行记录的交易所和股票代码归属创业板、科创板；不按指数成分筛选。',
            'currentMonthExcluded': True, 'start': series[0]['date'], 'end': series[-1]['date'],
            'excludedInitialOfferings': len(excluded), 'sourceRecords': len(records)}
    atomic_json(SOURCE, {'meta': meta, 'records': records, 'excludedInitialOfferings': excluded})
    atomic_json(OUTPUT, {'meta': meta, 'series': series})
    atomic_json(CACHE, {**raw, 'completeFrom2008': True, 'updated': now.isoformat(timespec='seconds')})
    print(json.dumps({'records': len(records), 'excludedIPO': len(excluded), 'latest': series[-1]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
