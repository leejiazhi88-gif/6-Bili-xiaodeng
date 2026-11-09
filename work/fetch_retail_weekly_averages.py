"""True trading-day means for retail activity; financing snapshots stay separate."""
import json
import math
from bisect import bisect_right
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from fetch_retail_sentiment_data import ROOT, get_token, yearly
from fetch_retail_index_metrics import snapshots, index_turnover, request
from refresh_cache import atomic_json, full_refresh

OUTPUT = ROOT / 'work/retail_weekly_averages.json'
DAILY_CACHE = ROOT / 'work/.refresh-cache/retail-star-daily-turnover.json'


def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def weekly_means(rows, fields):
    groups = defaultdict(list)
    for row in sorted(rows, key=lambda r: r['date']):
        iso = datetime.strptime(row['date'], '%Y-%m-%d').isocalendar()
        groups[(iso.year, iso.week)].append(row)
    result = []
    for points in groups.values():
        point = {'date': points[-1]['date'], 'periodStart': points[0]['date'], 'tradingDays': len(points)}
        for field in fields:
            values = [r.get(field) for r in points]
            # Missing trading-day observations never become zero or a last-day fallback.
            point[field] = sum(values) / len(values) if all(map(finite, values)) else None
        result.append(point)
    return result


def star_turnover(token, days, end_year):
    dates, members = snapshots(token, '000680.SH', 2019, end_year)
    old = json.loads(DAILY_CACHE.read_text()) if DAILY_CACHE.exists() and not full_refresh() else {}
    cutoff = days[-8] if len(days) >= 8 else days[0]
    values = {date: value for date, value in old.items() if date < cutoff}
    pending = [day for day in days if day not in values]

    def calculate(day):
        compact = day.replace('-', '')
        position = bisect_right(dates, compact) - 1
        if position < 0:
            return day, None
        codes = members[dates[position]]
        rows = request(token, 'daily_basic', {'trade_date': compact}, 'ts_code,circ_mv,turnover_rate')
        known = [row for row in rows if row['ts_code'] in codes and finite(row.get('circ_mv'))]
        usable = [row for row in known if finite(row.get('turnover_rate'))]
        cap = sum(row['circ_mv'] for row in usable)
        value = sum(row['circ_mv'] * row['turnover_rate'] for row in usable) / cap \
            if cap and len(known) >= .95 * len(codes) else None
        return day, value

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(calculate, day) for day in pending]
        for count, future in enumerate(as_completed(futures), 1):
            day, value = future.result()
            values[day] = value
            if count % 100 == 0:
                atomic_json(DAILY_CACHE, values)
                print(f'Star daily turnover {count}/{len(pending)}', flush=True)
    atomic_json(DAILY_CACHE, values)
    return values


def main():
    token = get_token()
    prices = json.loads((ROOT / 'work/market_overview_data.json').read_text())
    end = prices['meta']['end']
    end_year = int(end[:4])
    market = defaultdict(dict)
    for exchange, code in [('SH', 'SH_A'), ('SH', 'SH_MARKET'), ('SZ', 'SZ_MARKET')]:
        rows = yearly(token, 'daily_info', {'exchange': exchange, 'ts_code': code},
                      'trade_date,ts_code,float_mv,amount,tr,exchange', start_year=2019 if code == 'SH_MARKET' else 2005)
        for row in rows:
            if code.startswith('SH') and ((row['trade_date'] < '20190101') != (code == 'SH_A')):
                continue
            market[row['trade_date']][exchange] = row
    volumes = defaultdict(dict)
    for code, exchange in [('000001.SH', 'SH'), ('399106.SZ', 'SZ')]:
        for row in yearly(token, 'index_daily', {'ts_code': code}, 'trade_date,vol'):
            volumes[row['trade_date']][exchange] = row.get('vol')
    daily = []
    for compact, markets in sorted(market.items()):
        date = f'{compact[:4]}-{compact[4:6]}-{compact[6:]}'
        if date > end:
            continue
        entries = list(markets.values())
        complete = len(entries) == 2
        caps = [r.get('float_mv') for r in entries]
        cap = sum(caps) if complete and all(map(finite, caps)) else 0
        day_volumes = list(volumes[compact].values())
        daily.append({'date': date,
                      'amount': sum(r['amount'] for r in entries) if complete and all(finite(r.get('amount')) for r in entries) else None,
                      'volume': sum(day_volumes) / 1e8 if len(day_volumes) == 2 and all(map(finite, day_volumes)) else None,
                      'turnover': sum(r['tr'] * r['float_mv'] for r in entries) / cap if cap and all(finite(r.get('tr')) for r in entries) else None})
    result = {'meta': {'updated': datetime.now().isoformat(timespec='seconds'), 'end': end,
                      'sampling': 'ISO calendar week; arithmetic mean of all trading days, labelled last observed trading day; missing day values leave a null week',
                      'starTurnover': 'As-of index constituents, daily circ_mv-weighted turnover, >=95% cap-row coverage; then arithmetic daily mean'},
              'market': weekly_means(daily, ['amount', 'volume', 'turnover'])}
    print('Market daily means ready', flush=True)
    for key, code in [('sh', '399006.SZ'), ('k50', '000688.SH'), ('sz', '000680.SH')]:
        rows = prices[key]
        if key == 'sz':
            turnover = star_turnover(token, [r['date'] for r in rows], end_year)
        else:
            raw = index_turnover(token, code, int(rows[0]['date'][:4]), end_year)
            turnover = {f'{d[:4]}-{d[4:6]}-{d[6:]}': value for d, value in raw.items()}
        result[key] = weekly_means([{'date': r['date'], 'amount': r.get('amountYi'),
                                    'volume': r.get('volumeYiShou'), 'turnover': turnover.get(r['date'])} for r in rows],
                                  ['amount', 'volume', 'turnover'])
    atomic_json(OUTPUT, result)
    print(json.dumps({key: len(result[key]) for key in ['market', 'sh', 'k50', 'sz']}), flush=True)


if __name__ == '__main__':
    main()
