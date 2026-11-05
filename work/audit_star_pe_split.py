import sys,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'work'))
import os
os.chdir(ROOT)
from fetch_market_overview_data import call_api,get_token
from fetch_index_profit_data import stock_ttm_by_period
T=get_token();out=[]
requests=[]
api=call_api
def call_api(token,name,params,fields):
 rows=api(token,name,params,fields)
 requests.append({'api':name,'params':params,'fields':fields,'rows':rows})
 return rows
for start,end,day in [('20261001','20261104','20261104')]:
 ws={}
 for code in ['000680.SH','000688.SH']:
  rows=call_api(T,'index_weight',{'index_code':code,'trade_date':'20260630' if day=='20260708' else '20261030'},'index_code,con_code,trade_date,weight')
  last=max(r['trade_date'] for r in rows)
  ws[code]={r['con_code']:float(r['weight']) for r in rows if r['trade_date']==last}
  print(code,last,len(ws[code]),flush=True)
 b=call_api(T,'daily_basic',{'trade_date':day},'ts_code,total_mv,pe_ttm')
 bm={r['ts_code']:r for r in b}
 direct=call_api(T,'index_dailybasic',{'ts_code':'000688.SH','trade_date':day},'ts_code,trade_date,pe,pe_ttm,pb')
 groups={};members=ws['000680.SH'];fifty=set(ws['000688.SH']);cache=json.load(open('work/income_cache.json'))['income']
 for name,codes in [('all',set(members)),('k50',set(members)&fifty),('rest',set(members)-fifty)]:
  rows=[bm[c] for c in codes if c in bm];pos=[r for r in rows if r.get('pe_ttm') and r['pe_ttm']>0]; mv=sum(r['total_mv'] for r in rows);pmv=sum(r['total_mv'] for r in pos);prof=sum(r['total_mv']/r['pe_ttm'] for r in pos)
  profits=[]
  for c in codes:
   x=stock_ttm_by_period([r for r in cache.get(c,[]) if r.get('ann_date') and r['ann_date']<=day])
   if x:profits.append(x[max(x)])
  groups[name]={'count':len(codes),'matched':len(rows),'weight':sum(members[c] for c in codes),'mv_yi':mv/10000,'positive_count':len(pos),'positive_mv_yi':pmv/10000,'positive_profit_yi':prof/10000,'positive_pe':pmv/prof,'all_cap_positive_profit':mv/prof,'income_count':len(profits),'income_profit_yi':sum(profits)/1e8,'income_pe':mv*1e4/sum(profits) if sum(profits)>0 else None}
 top=[]
 for c in set(members)-fifty:
  z=stock_ttm_by_period([r for r in cache.get(c,[]) if r.get('ann_date') and r['ann_date']<=day])
  if z:top.append({'code':c,'profit_yi':z[max(z)]/1e8,'weight':members[c]})
 result={'top_rest_profit':sorted(top,key=lambda x:x['profit_yi'],reverse=True)[:10],'date':day,'direct_k50':direct,'groups':groups};out.append(result);print(json.dumps(result,ensure_ascii=False),flush=True)
dest=ROOT/'work/audits/star-pe-split-20261104'
dest.mkdir(parents=True,exist_ok=True)
for req in requests:
 if req['api']=='daily_basic':
  req['returnedRowCount']=len(req['rows'])
  req['rows']=[r for r in req['rows'] if r['ts_code'] in ws['000680.SH']]
raw={'results':out,'requests':requests,'incomeCacheEnd':'20261103','incomeRecords':{c:cache[c] for c in members if c in cache}}
(dest/'audit.json').write_text(json.dumps(raw,ensure_ascii=False,separators=(',',':')))
x=out[0]['groups']
assert x['all']['matched']==x['all']['count']
assert abs(x['all']['mv_yi']-x['k50']['mv_yi']-x['rest']['mv_yi'])<1e-6
assert abs(x['all']['income_profit_yi']-x['k50']['income_profit_yi']-x['rest']['income_profit_yi'])<1e-6
assert abs(x['k50']['income_pe']-out[0]['direct_k50'][0]['pe_ttm'])<0.001
