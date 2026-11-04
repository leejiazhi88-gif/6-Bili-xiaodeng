"""Monthly equity refinancing from the public THS stock-finance table.

No credentials required. Preserve earlier snapshots as the source rolls forward.
Missing cells are null, never zero; exclude the unfinished current month.
"""
import calendar
import hashlib
import json
import re
import subprocess
from datetime import datetime
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'work/sources/refinancing-ths-legacy-data.json'
URL = 'https://data.10jqka.com.cn/macro/finance/'
HEADERS = ['月份', '募集资金(亿元)', '首发募集资金(亿元)', '增发募集资金(亿元)', '配股募集资金(亿元)']


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            if self.row is not None:
                self.rows.append(self.row)
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = ''

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append(self.cell.strip())
            self.cell = None
        elif tag in ('tr', 'tbody', 'table') and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def parse(text, current_month):
    parser = TableParser()
    parser.feed(text)
    if HEADERS not in parser.rows:
        raise ValueError('Stock-finance table schema changed; cached data retained')
    result = {}
    for cells in parser.rows:
        if len(cells) != 5 or not re.fullmatch(r'\d{4}-\d{2}', cells[0]):
            continue
        month = cells[0]
        if month >= current_month:
            continue
        values = [None if x in ('--', '-', '') else Decimal(x.replace(',', '')) for x in cells[1:]]
        total, ipo, additional, rights = values
        if any(x is not None and (not x.is_finite() or x < 0) for x in values):
            raise ValueError(f'Invalid financial value: {month}')
        refinancing = total - ipo if total is not None and ipo is not None else None
        if refinancing is not None:
            known = sum((x for x in (additional, rights) if x is not None), Decimal(0))
            if refinancing < 0 or known - refinancing > Decimal('0.03'):
                raise ValueError(f'Inconsistent finance components: {month}')
            if additional is not None and rights is not None and abs(known - refinancing) > Decimal('0.03'):
                raise ValueError(f'Finance components do not reconcile: {month}')
        year, mon = map(int, month.split('-'))
        row = dict(zip(['totalFund', 'ipoFund', 'additionalFund', 'rightsFund'],
                       [float(x) if x is not None else None for x in values]))
        row.update(date=f'{month}-{calendar.monthrange(year, mon)[1]:02d}',
                   refinanceFund=float(refinancing) if refinancing is not None else None)
        if month in result:
            raise ValueError(f'Duplicate source month: {month}')
        result[month] = row
    if not result or not any(r['refinanceFund'] is not None for r in result.values()):
        raise ValueError('Empty source; cached data retained')
    return result


def main():
    raw = subprocess.check_output(['curl', '-fsSL', '--retry', '2', '--max-time', '45',
                                   '-A', 'Mozilla/5.0', URL])
    now = datetime.now()
    fresh = parse(raw.decode('gb18030'), now.strftime('%Y-%m'))
    previous = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {'series': []}
    rows = {r['date'][:7]: r for r in previous['series']}
    rows.update(fresh)
    series = [rows[key] for key in sorted(rows) if key < now.strftime('%Y-%m')]
    data = {'meta': {'updated': now.isoformat(timespec='seconds'), 'source': URL,
                    'provider': '同花顺数据中心', 'unit': '亿元', 'frequency': 'monthly',
                    'definition': '股票募集资金减首发募集资金（增发、配股口径）；不含可转债；未逐笔核验或剔除非现金资产认购。',
                    'currentMonthExcluded': True, 'sourceSha256': hashlib.sha256(raw).hexdigest(),
                    'start': series[0]['date'], 'end': series[-1]['date']}, 'series': series}
    archive = ROOT / 'work/sources' / f'refinancing-ths-{now:%Y-%m-%d}.html'
    archive.parent.mkdir(exist_ok=True)
    archive.write_bytes(raw)
    temporary = OUTPUT.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    temporary.replace(OUTPUT)
    print(json.dumps({'months': len(series), 'start': series[0]['date'], 'latest': series[-1]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
