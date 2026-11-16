const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {snapshot, validateTask, fingerprint, reusable, codeFingerprint, inputFingerprint} = require('../work/refresh_validation');
const context = {today:'2026-11-16', expectedSession:'20261116', sessions:['20261111','20261112','20261113','20261116']};
function fixture(fn) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xd-validate-')); fs.mkdirSync(path.join(root,'work'));
  const write=(name,value)=>fs.writeFileSync(path.join(root,'work',name+'.json'),JSON.stringify(value));
  try { fn(root,write); } finally { fs.rmSync(root,{recursive:true,force:true}); }
}
const valid = () => ({rows:[{date:'2026-11-13',pe:50},{date:'2026-11-16',pe:48}],meta:{updated:'2026-11-16'}});
test('silent empty results, historical loss, regression and duplicate dates fail even if process exited zero',()=>fixture((root,write)=>{
  const task={id:'starAggregatePe'}; write('star_aggregate_pe',valid()); const baseline=snapshot(root,task);
  for(const rows of [[],[{date:'2026-11-16',pe:48}],[{date:'2026-11-13',pe:50}],
    [{date:'2026-11-13',pe:50},{date:'2026-11-13',pe:48}],
    [{date:'2026-11-13',pe:50},{date:'2026-11-17',pe:48}],
    [{date:'2026-11-13',pe:50},{date:'2026-11-16',pe:'48'}],
    [{date:'2026-11-13',pe:50},{date:'2026-11-16',pe:null}]]){
    write('star_aggregate_pe',{rows});assert.throws(()=>validateTask(root,task,baseline,context),/Output validation failed/);
  }
  // The original baseline survives failed writes and catches repeated retries.
  write('star_aggregate_pe',{rows:[{date:'2026-11-16',pe:48}]});
  assert.throws(()=>validateTask(root,task,baseline,context),/shrank/);
}));
test('stamping metadata does not count as changed data; correcting a value does',()=>fixture((root,write)=>{
  const task={id:'starAggregatePe'};write('star_aggregate_pe',valid());const first=snapshot(root,task);
  const data=valid();data.meta.updated='2026-11-17';write('star_aggregate_pe',data);
  assert.equal(snapshot(root,task).star_aggregate_pe.contentHash,first.star_aggregate_pe.contentHash);
  data.rows[1].pe=47;write('star_aggregate_pe',data);
  assert.notEqual(snapshot(root,task).star_aggregate_pe.contentHash,first.star_aggregate_pe.contentHash);
}));
test('official source lag is explicit, three sessions allowed; longer lag blocks release',()=>fixture((root,write)=>{
  const task={id:'starHistory'};write('star_official_history',{rows:[{date:'2026-11-11',pe:37}]});
  const baseline=snapshot(root,task);
  assert.equal(validateTask(root,task,baseline,context)[0].status,'source_lag');
  write('star_official_history',{rows:[{date:'2026-11-10',pe:37}]});
  assert.throws(()=>validateTask(root,task,{}, {...context,sessions:['20261111','20261112','20261113','20261116']}),/3 trading sessions/);
}));
test('real zero and negative flows pass, quarter period is not mistaken for daily data',()=>fixture((root,write)=>{
  write('northbound_index_holdings',{series:[{date:'2026-09-30',sh:{value:0,ratio:0},k50:{value:1,ratio:2},sz:{value:1,ratio:2}}]});
  assert.ok(validateTask(root,{id:'northHoldings'},{},context).every(x=>x.status==='current'));
}));
test('each lagged field is checked independently, never covered up by a later row label',()=>fixture((root,write)=>{
  write('retail_sentiment_data',{series:[
    {date:'2026-11-13',amount:1,volumeProxy:1,turnover:1,marginBalance:2,marginFloatRatio:.1},
    {date:'2026-11-16',amount:1,volumeProxy:1,turnover:1,marginBalance:null,marginFloatRatio:null}]});
  const checks=validateTask(root,{id:'retail'},{},context);
  assert.equal(checks.find(x=>x.field==='marginBalance').latestValidDate,'2026-11-13');
  assert.equal(checks.find(x=>x.field==='marginBalance').status,'source_lag');
}));
test('due fund verification cannot be skipped or inferred from the report date',()=>fixture((root,write)=>{
  const row={date:'2026-06-30',coverage:80,...Object.fromEntries(['total','sh','k50','sz'].map(k=>[k,{position:50,concentration:30}]))};
  const data={meta:{checkedAt:{20260630:'2026-11-09T12:00:00'}},series:[row]};
  write('large_money_fund_reports',data);
  const ctx={...context,fundReports:{duePeriods:['20260630']}};
  assert.throws(()=>validateTask(root,{id:'fundReports'},{},ctx),/not verified/);
  data.meta.checkedAt[20260630]='2026-11-16T12:00:00';write('large_money_fund_reports',data);
  assert.ok(validateTask(root,{id:'fundReports'},{},ctx).every(x=>x.status==='current'));
}));
test('retry resume needs same date, target, inputs, outputs and a recent receipt; full audit never skips',()=>{
  const now=Date.parse('2026-11-16T14:00:00Z');
  const receipt={today:context.today,expectedSession:context.expectedSession,input:'i',output:'o',checkedAt:new Date(now-60000).toISOString()};
  const options={...context,now,mode:'daily',input:'i',output:'o'};
  assert.ok(reusable(receipt,options));
  for(const change of [{mode:'full'},{today:'2026-11-17'},{expectedSession:'20261117'},{input:'changed'},{output:null},{now:now+4*3600000},{now:now-120000}])
    assert.ok(!reusable(receipt,{...options,...change}));
});
test('code edits and changed dependency outputs invalidate downstream resume',()=>fixture((root,write)=>{
  fs.writeFileSync(path.join(root,'work','example.py'),'print(1)');
  write('market_overview_data',{rows:[{date:context.today,close:3}]});
  const task={id:'valuation',after:['market']},tasks=[task,{id:'market'}];
  const first=codeFingerprint(root),input=inputFingerprint(root,task,tasks,first);
  write('market_overview_data',{rows:[{date:context.today,close:4}]});
  assert.notEqual(inputFingerprint(root,task,tasks,first),input);
  fs.writeFileSync(path.join(root,'work','example.py'),'print(2)');
  assert.notEqual(codeFingerprint(root),first);
  assert.equal(fingerprint(root,['missing']),null);
}));

const {executeVerifiedTasks}=require('../work/refresh_execution');
const {runTasks}=require('../work/refresh_dashboard_data');
test('failed retry resumes verified prerequisites, but successful runs always recheck sources',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xd-resume-'));fs.mkdirSync(path.join(root,'work'));
  const write=(name,value)=>fs.writeFileSync(path.join(root,'work',name+'.json'),JSON.stringify(value));
  const market=()=>Object.fromEntries(['sh','k50','sz'].map(key=>[key,[{date:'2026-11-16',close:1,amountYi:2,volumeYiShou:3,pe:4}]]));
  const tasks=[{id:'market'},{id:'starAggregatePe',after:['market']}],calls=[];
  const now=()=>Date.parse('2026-11-16T14:00:00Z');
  const fresh=()=>({mode:'daily',context,startedAt:new Date(now()).toISOString(),status:'running',tasks:[],checkpoints:{}});
  const execute=(summary,previous,fail)=>executeVerifiedTasks({root,tasks,mode:'daily',context,summary,previous,runTasks,now,save(){},log(){},
    run:async task=>{calls.push(task.id);if(fail&&task.id==='starAggregatePe')throw Error('transient API failure');
      if(task.id==='market')write('market_overview_data',market());else write('star_aggregate_pe',valid());}});
  try{
    write('market_overview_data',market());write('star_aggregate_pe',valid());
    const first=fresh();await assert.rejects(execute(first,null,true),/starAggregatePe/);first.status='failed';
    assert.deepEqual(calls,['market','starAggregatePe']);calls.length=0;
    const second=fresh();await execute(second,first,false);second.status='complete';
    assert.deepEqual(calls,['starAggregatePe']);
    assert.equal(second.checkpoints.market.execution,'resumed_verified_output');
    assert.equal(second.checkpoints.market.checkedAt,first.checkpoints.market.checkedAt);
    calls.length=0;await execute(fresh(),second,false);assert.deepEqual(calls,['market','starAggregatePe']);
    // Editing a dependency output invalidates its receipt and downstream work.
    const changed=market();changed.sh[0].close=99;write('market_overview_data',changed);
    calls.length=0;await execute(fresh(),first,false);assert.deepEqual(calls,['market','starAggregatePe']);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('lagged publication tolerates two sessions, then blocks a silent stale success',()=>fixture((root,write)=>{
  write('retail_sentiment_data',{series:[{date:'2026-11-11',amount:0,volumeProxy:0,turnover:0,marginBalance:0,marginFloatRatio:0}]});
  assert.throws(()=>validateTask(root,{id:'retail'},{},context),/2 trading sessions/);
}));
test('monthly factsheets use prior month last trading session, not a Saturday month end',()=>fixture((root,write)=>{
  write('star_official_valuation',{snapshots:[{date:'2026-10-30',pe:45,pb:5}]});
  assert.ok(validateTask(root,{id:'starSnapshot'},{},{...context,sessions:['20261030',...context.sessions]}).every(x=>x.status==='current'));
}));
