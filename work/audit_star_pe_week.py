"""One-off audit; preserve raw responses and never overwrite production PE."""
import argparse
import csv
import json
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path
from fetch_market_overview_data import call_api, get_token
from fetch_index_profit_data import stock_ttm_by_period

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--end', default='20261104')
    args = parser.parse_args()
    output = ROOT / 'work' / 'audits' / ('star-pe-' + args.end)
    output.mkdir(parents=True, exist_ok=True)
    token = get_token()
    requests = []

    def request(api, params, fields):
        rows = call_api(token, api, params, fields)
        requests.append({'api': api, 'params': params, 'fields': fields, 'rows': rows})
        return rows

    start = (datetime.strptime(args.end, '%Y%m%d') - timedelta(days=45)).strftime('%Y%m%d')
    url = ('https://www.csindex.com.cn/csindex-home/perf/index-perf?'
           'indexCode=000680&startDate=' + start + '&endDate=' + args.end)
    official = json.loads(subprocess.check_output(['curl', '-fsSL', url]))
    if not official.get('success') or not official.get('data'):
        raise ValueError('CSI response unavailable')
    source = sorted([r for r in official['data'] if r.get('peg') is not None], key=lambda r: r['tradeDate'])[-5:]
    dates = [str(r['tradeDate']) for r in source]
    weights = request('index_weight', {'index_code': '000680.SH', 'start_date': start, 'end_date': args.end},
                      'index_code,con_code,trade_date,weight')
    snapshots = {}
    for r in weights:
        snapshots.setdefault(r['trade_date'], {})[r['con_code']] = float(r['weight'])
    direct = request('index_dailybasic', {'ts_code': '000680.SH', 'start_date': dates[0], 'end_date': dates[-1]},
                     'ts_code,trade_date,pe,pe_ttm,pb')
    cache = json.loads((ROOT / 'work/income_cache.json').read_text())
    results = []
    constituent_rows = []
    for date, official_row in zip(dates, source):
        eligible = [d for d in snapshots if d <= date]
        if not eligible:
            raise ValueError('No membership snapshot on or before ' + date)
        weight_date = max(eligible)
        members = snapshots[weight_date]
        basics = request('daily_basic', {'trade_date': date}, 'ts_code,trade_date,close,total_mv,pe_ttm,pb')
        if len(basics) >= 6000:
            raise ValueError('Possible daily_basic truncation')
        lookup = {r['ts_code']: r for r in basics}
        carried = {}
        for code in set(members) - set(lookup):
            prior = request('daily_basic', {'ts_code': code, 'start_date': start, 'end_date': date},
                            'ts_code,trade_date,close,total_mv,pe_ttm,pb')
            prior = [row for row in prior if row['trade_date'] < date and row.get('total_mv')]
            if prior:
                latest = max(prior, key=lambda row: row['trade_date'])
                lookup[code] = latest
                carried[code] = latest['trade_date']
        matched = {code: lookup[code] for code in members if code in lookup}
        if len(matched) != len(members):
            raise ValueError('Missing constituents: ' + str(set(members) - set(matched)))
        if any(not r.get('total_mv') or float(r['total_mv']) <= 0 for r in matched.values()):
            raise ValueError('Missing stock market cap')
        for code, row in matched.items():
            constituent_rows.append({'date': date, 'membership_date': weight_date,
                                     'code': code, 'snapshot_weight': members[code], **row})
        positive = {c:r for c,r in matched.items() if r.get('pe_ttm') is not None and float(r['pe_ttm']) > 0}
        total_mv = sum(float(r['total_mv']) for r in matched.values())
        positive_mv = sum(float(r['total_mv']) for r in positive.values())
        implied_profit = sum(float(r['total_mv']) / float(r['pe_ttm']) for r in positive.values())
        w_positive = sum(members[c] for c in positive)
        harmonic = sum(members[c] / float(r['pe_ttm']) for c,r in positive.items())
        # This is a sensitivity calculation with fixed monthly weights, not a daily official replica.
        ttm = {}
        for code in members:
            records = [r for r in cache['income'].get(code, []) if r.get('ann_date') and r['ann_date'] <= date]
            values = stock_ttm_by_period(records)
            if values:
                ttm[code] = values[max(values)]
        ttm_mv = sum(float(matched[c]['total_mv']) * 10000 for c in ttm)
        total_profit = sum(ttm.values())
        result = {
            'date': date, 'official_pe': float(official_row['peg']), 'membership_date': weight_date,
            'members': len(members), 'matched': len(matched), 'positive_pe_stocks': len(positive),
            'carried_price_codes': carried,
            'nonpositive_or_missing_pe_stocks': len(members)-len(positive),
            'snapshot_weight_sum': sum(members.values()),
            'positive_market_cap_pct': positive_mv/total_mv*100,
            'total_market_cap_yi': total_mv/10000,
            'positive_pe_total_cap_ratio': positive_mv/implied_profit,
            'snapshot_weight_positive_harmonic_pe': w_positive/harmonic,
            'all_cap_over_positive_profit_sensitivity': total_mv/implied_profit,
            'income_cache_matched': len(ttm),
            'income_including_losses_pe_sensitivity': ttm_mv/total_profit if total_profit>0 else None,
            'relative_gap_pct': (positive_mv/implied_profit/float(official_row['peg'])-1)*100,
        }
        results.append(result)
        print(json.dumps(result, ensure_ascii=False), flush=True)
    retained_codes = {r['con_code'] for r in weights}
    for item in requests:
        item['returnedRowCount'] = len(item['rows'])
        if item['api'] == 'daily_basic':
            item['rows'] = [r for r in item['rows'] if r['ts_code'] in retained_codes]
            item['retainedRowsScope'] = 'Only members present in queried index_weight snapshots'
    artifact = {'meta': {'fetchedAt': datetime.now(timezone.utc).isoformat(), 'officialUrl': url,
                         'incomeCacheEnd': cache['meta'].get('end_date'),
                         'caveat': 'Total stock market caps differ from CSI calculation shares. Monthly weights are fixed snapshots, not daily weights. Missing/negative stock PE is excluded only in explicitly labelled positive-PE calculations. Income-cache method includes losses where available and is an independent sensitivity calculation.'},
                'direct_index_dailybasic': direct, 'results': results, 'requests': requests, 'official': official}
    (output/'audit.json').write_text(json.dumps(artifact, ensure_ascii=False, separators=(',', ':')))
    with (output/'constituents.csv').open('w') as f:
        writer=csv.DictWriter(f,fieldnames=constituent_rows[0].keys());writer.writeheader();writer.writerows(constituent_rows)
    with (output/'comparison.csv').open('w') as f:
        writer=csv.DictWriter(f,fieldnames=results[0].keys());writer.writeheader();writer.writerows(results)


if __name__ == '__main__':
    main()
