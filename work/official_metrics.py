"""Amounts from disclosed records; never infer funds from market prices."""
import calendar
import math
import re
from bisect import bisect_right
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

IPO_FIELDS = 'ts_code,ipo_date,issue_date,amount,price,funds'
HOLDER_FIELDS = 'ts_code,ann_date,holder_name,in_de,change_vol,avg_price'


def complete_window(request, token, api, start, end, fields, limit):
    rows = request(token, api, {'start_date': start, 'end_date': end}, fields)
    if len(rows) < limit and not (api == "stk_holdertrade" and len(rows) == 2000):
        return rows
    if start == end:
        raise ValueError(f'{api}: {start} reached row limit; retain existing published data')
    first, last = (datetime.strptime(d, '%Y%m%d') for d in (start, end))
    middle = first + timedelta(days=(last - first).days // 2)
    return (complete_window(request, token, api, start, middle.strftime('%Y%m%d'), fields, limit)
            + complete_window(request, token, api, (middle + timedelta(days=1)).strftime('%Y%m%d'), end, fields, limit))


def number(value, positive=False):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) and (value > 0 if positive else value >= 0) else None


def aggregate_ipo(rows, months):
    result = {m: {'funds': Decimal(0), 'count': 0, 'missing': 0} for m in months}
    unique = {}
    for row in rows:
        date = row.get('ipo_date') or row.get('issue_date')
        if not date or date[:6] not in result:
            continue
        identity = (row['ts_code'], date)
        if identity in unique and any(unique[identity].get(k) != row.get(k) for k in ('amount', 'price')):
            raise ValueError(f'Conflicting IPO funds: {identity}')
        unique[identity] = row
    for (_, date), row in unique.items():
        item = result[date[:6]]
        volume, price = number(row.get('amount'), positive=True), number(row.get('price'), positive=True)
        value = None if volume is None or price is None else Decimal(str(volume)) * Decimal(str(price)) / 10000
        item['count'] += 1
        if value is None:
            item['missing'] += 1
        else:
            item['funds'] += value  # 万股 × 元/股 / 10000 = 亿元发行总额
    return {m: {'ipoFund': None if r['missing'] else float(r['funds'].quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)),
                'ipoCount': r['count'], 'ipoMissingFunds': r['missing']} for m, r in result.items()}


def listing_board(code):
    """Use the exchange/code on the issuance record, never today's index members."""
    if re.fullmatch(r"(?:300|301|302)\d{3}\.SZ", code or ""):
        return 'chinext'
    if re.fullmatch(r"(?:688|689)\d{3}\.SH", code or ""):
        return 'star'
    return 'other'


def aggregate_board_ipo(rows, months, end_date):
    eligible = [row for row in rows if (row.get('ipo_date') or row.get('issue_date') or '')
                and (row.get('ipo_date') or row.get('issue_date')) <= end_date]
    output, coverage = {}, {}
    for key, name in [('chinext', '创业板'), ('star', '科创板')]:
        selected = [row for row in eligible if listing_board(row.get('ts_code')) == key]
        first = min(((row.get('ipo_date') or row['issue_date'])[:6] for row in selected), default=None)
        sums = aggregate_ipo(selected, months)
        output[key] = {month: row if first and month >= first else
                       {'ipoFund': None, 'ipoCount': None, 'ipoMissingFunds': None}
                       for month, row in sums.items()}
        coverage[key] = {'name': name, 'startMonth': first,
                         'records': sum(row['ipoCount'] for row in sums.values()),
                         'missingAmountRecords': sum(row['ipoMissingFunds'] for row in sums.values())}
    return output, coverage


def snapshot(membership, date):
    dates, members = membership
    pos = bisect_right(dates, date) - 1
    if pos < 0:
        return None
    # Monthly snapshots cannot establish membership indefinitely after a source gap.
    age = datetime.strptime(date, '%Y%m%d') - datetime.strptime(dates[pos], '%Y%m%d')
    return members[dates[pos]] if age.days <= 62 else None


def aggregate_holders(rows, months, memberships, stock_code, end_date):
    def bucket():
        return {'reduction': Decimal(0), 'increase': Decimal(0), 'records': 0, 'pricedRecords': 0}
    groups = {'market': {m: bucket() for m in months},
              **{key: {m: bucket() for m in months} for key in memberships}}
    unique = {tuple(row.get(k) for k in HOLDER_FIELDS.split(',')): row for row in rows}
    for row in unique.values():
        code, date = row.get('ts_code') or '', row.get('ann_date') or ''
        if not stock_code.fullmatch(code) or date[:6] not in groups['market'] or date > end_date:
            continue
        targets = ['market'] + [key for key, member in memberships.items()
                                if code in (snapshot(member, date) or set())]
        volume, price = number(row.get('change_vol')), number(row.get('avg_price'), positive=True)
        valid = volume is not None and price is not None and row.get('in_de') in ('IN', 'DE')
        for key in targets:
            item = groups[key][date[:6]]
            item['records'] += 1
            if valid:
                item['pricedRecords'] += 1
                amount = Decimal(str(volume)) * Decimal(str(price)) / Decimal(100000000)
                item['increase' if row['in_de'] == 'IN' else 'reduction'] += amount
    result = {}
    for month in months:
        month_result = {}
        for key, values in groups.items():
            r = values[month]
            complete_membership = True
            if key != 'market':
                start = datetime.strptime(month + '01', '%Y%m%d')
                last = min(month + str(calendar.monthrange(start.year, start.month)[1]), end_date)
                day = start
                while day.strftime('%Y%m%d') <= last:
                    if snapshot(memberships[key], day.strftime('%Y%m%d')) is None:
                        complete_membership = False
                        break
                    day += timedelta(days=1)
            available = complete_membership and (r['pricedRecords'] > 0 or r['records'] == 0)
            month_result[key] = {
                'holderNetReductionAmount': round(float(r['reduction'] - r['increase']), 4) if available else None,
                'holderReductionAmount': round(float(r['reduction']), 4) if available else None,
                'records': r['records'] if complete_membership else None,
                'pricedRecords': r['pricedRecords'] if complete_membership else None,
                'missingRecords': r['records'] - r['pricedRecords'] if complete_membership else None,
                'membershipAvailable': complete_membership,
            }
        result[month] = month_result
    return result
