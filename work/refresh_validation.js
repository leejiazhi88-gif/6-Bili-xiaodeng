const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspect } = require('./audit_dashboard_freshness');

// Only visible metrics are freshness requirements. Hidden legacy fields (e.g.
// northbound flow and bond spread) cannot make a good refresh look broken.
const CONTRACTS = {
  market: { files: ['market_overview_data'], series: ['sh','k50','sz'].map(key =>
    [key, ['close','amountYi','volumeYiShou', ...(key === 'sz' ? [] : ['pe'])], 'session']) },
  profit: { files: ['index_profit_data','income_cache'], series: ['sh','sz'].map(key => [key,['profitYi'], 'quarter']) },
  starAggregatePe: { files: ['star_aggregate_pe'], series: [['rows',['pe'], 'session']] },
  largeMoney: { files: ['large_money_sentiment_data','large_money_index_data','northbound_daily_data'],
    series: [['series',['blockAmount','institutionBlockNet','holderNetShares'], 'session']],
    extra: { large_money_index_data: ['sh','k50','sz'].map(key => [key,['blockAmount','institutionBlockNet','holderNetAmount'], 'session']) } },
  retail: { files: ['retail_sentiment_data'], series: [['series',['amount','volumeProxy','turnover','marginBalance','marginFloatRatio'], 'laggedSession']] },
  retailIndices: { files: ['retail_index_metrics'], series: ['sh','k50','sz'].map(key => [key,['turnover','marginBalance','marginFloatRatio'], 'laggedSession']) },
  retailWeeklyMeans: { files: ['retail_weekly_averages'], series: ['market','sh','k50','sz'].map(key => [key,['amount','volume','turnover'], 'session']) },
  starSnapshot: { files: ['star_official_valuation'], series: [['snapshots',['pe','pb'], 'monthSession']] },
  starHistory: { files: ['star_official_history'], series: [['rows',['pe'], 'officialSession']] },
  etf: { files: ['large_money_etf_shares'], series: [['series',['sh','k50','sz','total'], 'laggedSession']] },
  valuation: { files: ['valuation_data'], series: [['sh',['pb','pbPercentile'], 'session']] },
  refinancing: { files: ['refinancing_data','refinancing_issuance_records'], series: [['series',
    ['refinanceFund','refinanceBoards.chinext.refinanceFund','refinanceBoards.star.refinanceFund'], 'month']] },
  official: { files: ['official_sentiment_data','ipo_issuance_records'], series: [['series',
    ['ipoFund','holderNetReductionAmount','ipoBoards.chinext.ipoFund','ipoBoards.star.ipoFund',
      'holderBoards.chinext.holderNetReductionAmount','holderBoards.star.holderNetReductionAmount'], 'currentMonth']] },
  northHoldings: { files: ['northbound_index_holdings'], series: [['series',
    ['sh.value','sh.ratio','k50.value','k50.ratio','sz.value','sz.ratio'], 'quarter']] },
  fundReports: { files: ['large_money_fund_reports'], series: [['series',
    ['total.position','total.concentration','sh.position','sh.concentration','k50.position','k50.concentration','sz.position','sz.concentration'], 'semiannual']] },
};
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function read(root, name) { return JSON.parse(fs.readFileSync(path.join(root,'work', name+'.json'),'utf8')); }
function fingerprint(root, files) {
  try { return hash(files.map(name => name + ':' + hash(fs.readFileSync(path.join(root,'work',name+'.json')))).join('\n')); }
  catch (error) { if (error.code==='ENOENT') return null; throw error; }
}
function snapshot(root, task) {
  const contract = CONTRACTS[task.id];
  if (!contract) throw new Error('Missing output contract: ' + task.id);
  return Object.fromEntries(contract.files.map(name => {
    if (!fs.existsSync(path.join(root,'work',name+'.json'))) return [name,null];
    const data = read(root,name), {meta, ...values} = data;
    return [name,{...inspect(data), contentHash:hash(JSON.stringify(values))}];
  }));
}
const valueAt = (row, field) => field.split('.').reduce((value,key) => value?.[key],row);
function expectedDate(frequency, context) {
  const date = context.expectedSession.slice(0,4)+'-'+context.expectedSession.slice(4,6)+'-'+context.expectedSession.slice(6);
  if (['session','laggedSession','officialSession'].includes(frequency)) return date;
  if (frequency === 'currentMonth') return context.today;
  const now = new Date(context.today+'T00:00:00Z');
  if (frequency === 'month' || frequency === 'monthSession') {
    const end = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),0)).toISOString().slice(0,10);
    if (frequency === 'month') return end;
    const session = context.sessions.filter(day=>day<=end.replaceAll('-','')).at(-1);
    if (!session) throw new Error('Calendar missing prior month end');
    return session.slice(0,4)+'-'+session.slice(4,6)+'-'+session.slice(6);
  }
  // Reports are period labels. Fiscal quarter results have a disclosure
  // window; quarterly stock holdings use quarter-end exchange sessions.
  if (frequency === 'quarter') return new Date(Date.UTC(now.getUTCFullYear(),Math.floor(now.getUTCMonth()/3)*3,0)).toISOString().slice(0,10);
  const year = now.getUTCFullYear(), month = now.getUTCMonth()+1;
  return month >= 9 ? year+'-06-30' : month >= 4 ? (year-1)+'-12-31' : (year-1)+'-06-30';
}
function validateTask(root, task, previous, context) {
  const contract = CONTRACTS[task.id], checks = [], errors = [];
  const current = snapshot(root,task);
  if (task.id === 'fundReports') {
    const data = read(root,contract.files[0]);
    for (const period of context.fundReports?.duePeriods || []) {
      const date = period.slice(0,4)+'-'+period.slice(4,6)+'-'+period.slice(6);
      if (data.series.some(row=>row.date===date) && data.meta?.checkedAt?.[period]?.slice(0,10)!==context.today)
        errors.push('fundReports: due report '+period+' was not verified');
    }
    if (data.series.at(-1)?.coverage < 40) errors.push('fundReports: latest sample coverage below 40%');
  }
  for (const [name, inspected] of Object.entries(current)) {
    const definitions = name === contract.files[0] ? contract.series : contract.extra?.[name] || [];
    const data = read(root,name);
    // Even ancillary files must parse; source-record arrays are handled by
    // the source scripts' pagination and reconciliation checks.
    for (const [key,fields,frequency] of definitions) {
      const rows = key.split('.').reduce((v,k)=>v?.[k],data);
      if (!Array.isArray(rows) || !rows.length) { errors.push(name+'.'+key+': empty series'); continue; }
      let last = '';
      for (const row of rows) {
        const date = row.date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date || date<=last || date>context.today) {
          errors.push(name+'.'+key+': invalid, duplicate, unordered or future date '+date); break;
        }
        last = date;
      }
      const before = previous?.[name]?.series?.[key];
      const after = inspected.series[key];
      if (before && (after.rows<before.rows || after.firstDate>before.firstDate || after.lastDate<before.lastDate))
        errors.push(name+'.'+key+': historical series shrank or date regressed');
      for (const field of fields) {
        const actual = after.latestValidDate[field];
        const old = before?.latestValidDate[field];
        const expected = expectedDate(frequency,context);
        let status = actual ? actual >= expected ? 'current' : 'source_lag' : 'unavailable';
        if (old && (!actual || actual<old)) errors.push(name+'.'+key+'.'+field+': valid data regressed');
        if (rows.some(row=>valueAt(row,field)!=null && !Number.isFinite(valueAt(row,field))))
          errors.push(name+'.'+key+'.'+field+': nonnumeric/nonfinite value');
        const sessionLag = actual ? (context.sessions || []).filter(d=>d>actual.replaceAll('-','') && d<=context.expectedSession).length : Infinity;
        if (frequency==='session' && (!actual || actual<expected)) errors.push(name+'.'+key+'.'+field+': expected '+expected+', got '+(actual || 'none'));
        if (frequency==='officialSession' && sessionLag>3) errors.push(name+'.'+key+'.'+field+': more than 3 trading sessions behind');
        if (frequency==='laggedSession' && actual && sessionLag>2) errors.push(name+'.'+key+'.'+field+': more than 2 trading sessions behind');
        // Some historical fields were already unavailable. Make that visible
        // without fabricating observations or claiming every tab is current.
        checks.push({source:name,series:key,field,frequency,expectedDate:expected,latestValidDate:actual || null,status,
          missingAtLatestRow: !Number.isFinite(valueAt(rows.at(-1),field))});
      }
    }
  }
  if (errors.length) throw new Error('Output validation failed: '+errors.join('; '));
  return checks;
}
function codeFingerprint(root) {
  const configuration = ['star_constituent_events.json','ipo_listing_overrides.json'];
  return hash(fs.readdirSync(path.join(root,'work')).filter(name=>/\.(py|js)$/.test(name) || configuration.includes(name)).sort()
    .map(name=>name+':'+hash(fs.readFileSync(path.join(root,'work',name)))).join('\n'));
}
function inputFingerprint(root, task, tasks, code) {
  return hash(code+'\n'+(task.after || []).map(id => {
    if (!tasks.some(t=>t.id===id)) throw new Error('Unknown dependency '+id);
    return id+':'+fingerprint(root,CONTRACTS[id].files);
  }).join('\n'));
}
function reusable(checkpoint, {mode, now, today, expectedSession, input, output}) {
  return mode==='daily' && checkpoint?.today===today && checkpoint.expectedSession===expectedSession &&
    now-Date.parse(checkpoint.checkedAt)>=0 && now-Date.parse(checkpoint.checkedAt)<4*60*60*1000 &&
    checkpoint.input===input && checkpoint.output===output;
}
module.exports = { CONTRACTS, read, fingerprint, snapshot, validateTask, codeFingerprint, inputFingerprint, reusable, expectedDate, hash };
