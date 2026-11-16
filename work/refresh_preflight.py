"""Fail before expensive jobs if credentials, TLS, dependencies or calendar fail."""
import json
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pdfplumber  # noqa: F401 -- required by the official factsheet task
from fetch_retail_sentiment_data import call_api, get_token
from fetch_large_money_fund_reports import OUTPUT, refresh_plan


def main():
    now = datetime.now(ZoneInfo('Asia/Shanghai'))
    # Daily closing data normally become available after the close. Before
    # 18:00 only require the previous session; show today's data if returned.
    cutoff = now.date() if now.hour >= 18 else now.date() - timedelta(days=1)
    rows = call_api(get_token(), 'trade_cal', {
        'exchange': 'SSE', 'start_date': f'{now.year - 1}0101',
        'end_date': now.strftime('%Y%m%d'), 'is_open': '1',
    }, 'cal_date,is_open')
    days = sorted({r['cal_date'] for r in rows if str(r.get('is_open')) == '1'})
    eligible = [day for day in days if day <= cutoff.strftime('%Y%m%d')]
    if not eligible:
        raise RuntimeError('No recent exchange trading sessions returned')
    # Exercise the verified TLS path used by both CSI requests. Do not disable
    # certificate checks or wait for hundreds of income calls before failure.
    request = urllib.request.Request('https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/000680factsheet.pdf',
                                     headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.read(5) != b'%PDF-':
            raise RuntimeError('Official factsheet did not return a PDF')
    cached = json.loads(OUTPUT.read_text(encoding='utf-8')) if OUTPUT.exists() else {'series': []}
    margin = call_api(get_token(), 'margin_detail', {'trade_date': eligible[-1]}, 'ts_code,rzye')
    print(json.dumps({'today': now.strftime('%Y-%m-%d'), 'expectedSession': eligible[-1],
                      'sessions': days, 'marginDetailRowsAtExpectedSession': len(margin),
                      'fundReports': refresh_plan(cached, now=now.replace(tzinfo=None))}))


if __name__ == '__main__':
    main()
