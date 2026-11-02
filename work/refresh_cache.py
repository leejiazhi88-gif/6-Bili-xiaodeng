"""Cache immutable request windows; recent windows always hit the source.

No credentials are serialized. Full audits bypass the cache. Historical
windows are revalidated after 30 days; failed requests never replace a cache.
"""
import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parent / '.refresh-cache'


def full_refresh():
    return '--full' in sys.argv or os.environ.get('XIAODENG_REFRESH_FULL') == '1'


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=path.name + '.', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump(value, output, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def merge_rows(old, fresh, keys):
    rows = {tuple(row.get(k) for k in keys): row for row in old}
    rows.update({tuple(row.get(k) for k in keys): row for row in fresh})
    return sorted(rows.values(), key=lambda row: tuple(str(row.get(k) or '') for k in keys))


def lookback(last_date, days=90):
    return (datetime.strptime(last_date.replace('-', ''), '%Y%m%d') - timedelta(days=days)).strftime('%Y%m%d')


def historical_cache(function):
    @wraps(function)
    def request(token, api_name, params, fields, *args, **kwargs):
        end = params.get('end_date') or params.get('trade_date')
        # Never cache pagination or unbounded requests independently: their
        # page boundaries may move when the source adds or revises records.
        historical = (isinstance(end, str) and len(end) == 8
                      and end < (datetime.now() - timedelta(days=90)).strftime('%Y%m%d')
                      and 'offset' not in params)
        if not historical:
            return function(token, api_name, params, fields, *args, **kwargs)
        identity = json.dumps([api_name, params, fields], sort_keys=True)
        path = CACHE_DIR / (hashlib.sha256(identity.encode()).hexdigest() + '.json')
        if not full_refresh() and path.exists():
            cached = json.loads(path.read_text())
            if datetime.now() - datetime.fromisoformat(cached['fetchedAt']) < timedelta(days=30):
                return cached['rows']
        rows = function(token, api_name, params, fields, *args, **kwargs)
        atomic_json(path, {'fetchedAt': datetime.now().isoformat(), 'rows': rows})
        return rows
    return request
