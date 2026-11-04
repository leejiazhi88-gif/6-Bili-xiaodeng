"""Aggregate completed equity issuances by their listing board, in CNY 100m."""
import calendar
from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from official_metrics import listing_board


def date_only(value):
    return str(value)[:10] if value else None


def positive(value):
    try:
        result = Decimal(str(value))
        return result if result.is_finite() and result > 0 else None
    except (InvalidOperation, TypeError, ValueError):
        return None


def normalize_issuances(additional, rights, listing_dates, end_date):
    records, excluded = [], []
    seen = set()
    for kind, rows, date_field in [('additional', additional, 'ISSUE_DATE'), ('rights', rights, 'PAY_END_DATE')]:
        for row in rows:
            day = date_only(row.get(date_field))
            if not day or day < '2008-01-01' or day > end_date:
                continue
            code = row.get('SECUCODE')
            identity = (kind, str(row.get('FINANCE_CODE')))
            if identity in seen:
                raise ValueError(f'Duplicate issuance record: {identity}')
            seen.add(identity)
            listing = listing_dates.get(code)
            if not listing:
                raise ValueError(f'Initial listing date missing: {code}; cannot distinguish IPO from refinancing')
            listing = f'{listing[:4]}-{listing[4:6]}-{listing[6:]}' if '-' not in listing else listing
            if day <= listing:
                excluded.append({'type': kind, 'id': identity[1], 'code': code, 'date': day,
                                 'initialListingDate': listing, 'reason': '首次上市前或当日发行，不计再融资'})
                continue
            total = positive(row.get('TOTAL_RAISE_FUNDS'))
            qty, price = positive(row.get('ISSUE_NUM')), positive(row.get('ISSUE_PRICE'))
            amount = total if total is not None else qty * price if qty is not None and price is not None else None
            # Never infer a plan amount or a market-value proxy.
            records.append({
                'id': identity[1], 'type': kind, 'code': code, 'name': row.get('SECURITY_NAME_ABBR'),
                'date': day, 'initialListingDate': listing, 'board': listing_board(code),
                'amountYuan': float(amount) if amount is not None else None,
                'amountSource': 'TOTAL_RAISE_FUNDS' if total is not None else 'ISSUE_NUM * ISSUE_PRICE' if amount is not None else None,
                'reportedAmountYuan': row.get('TOTAL_RAISE_FUNDS'), 'issueShares': row.get('ISSUE_NUM'),
                'issuePrice': row.get('ISSUE_PRICE'),
                'listingDate': date_only(row.get('ISSUE_LISTING_DATE') or row.get('LISTING_DATE')),
                'issueWay': row.get('ISSUE_WAY') or '配股',
            })
    return sorted(records, key=lambda r: (r['date'], r['type'], r['id'])), excluded


def aggregate_refinancing(records, current_month, start_month='2008-01'):
    buckets = defaultdict(lambda: {'additional': Decimal(0), 'rights': Decimal(0), 'count': 0, 'missing': 0})
    for row in records:
        month = row['date'][:7]
        if month < start_month or month >= current_month:
            continue
        for scope in ('market', row['board']):
            if scope == 'other':
                continue
            bucket = buckets[(month, scope)]
            bucket['count'] += 1
            amount = positive(row['amountYuan'])
            if amount is None:
                bucket['missing'] += 1
            else:
                bucket[row['type']] += amount
    def value(bucket, key):
        if bucket['missing']:
            return None
        yuan = bucket['additional'] + bucket['rights'] if key == 'refinanceFund' else bucket[key]
        return float((yuan / Decimal(100000000)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
    rows = []
    year, month = map(int, start_month.split('-'))
    while f'{year}-{month:02d}' < current_month:
        key = f'{year}-{month:02d}'
        row = {'date': f'{key}-{calendar.monthrange(year, month)[1]}', 'refinanceBoards': {}, 'coverage': {}}
        for scope in ('market', 'chinext', 'star'):
            bucket = buckets[(key, scope)]
            # Board creation precedes its first possible refinancing, not today's membership.
            available = scope == 'market' or (scope == 'chinext' and key >= '2009-10') or (scope == 'star' and key >= '2019-07')
            values = {'refinanceFund': value(bucket, 'refinanceFund') if available else None,
                      'additionalFund': value(bucket, 'additional') if available else None,
                      'rightsFund': value(bucket, 'rights') if available else None}
            if scope == 'market':
                row.update(values)
            else:
                row['refinanceBoards'][scope] = values
            row['coverage'][scope] = {'records': bucket['count'], 'missingAmounts': bucket['missing']} if available else None
        rows.append(row)
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return rows
