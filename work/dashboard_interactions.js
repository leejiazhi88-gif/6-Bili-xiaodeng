// Shared presentation behavior, applied after all module charts are created.
const css = `
<style id="dashboard-interactions-style">
.chart-reading-shell{position:relative;min-width:0}
.chart-reading{position:absolute;z-index:2;top:14px;left:20px;right:24px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;pointer-events:none}
.chart-reading-heading{font-size:13px;font-weight:650;color:var(--text);line-height:1.4;min-width:0}
.chart-reading-date,.chart-reading-status{font-size:11px;font-weight:400;color:var(--muted);margin-top:5px;line-height:1.4}
.chart-reading-values{display:flex;flex-wrap:wrap;gap:10px 20px;min-width:0}
.chart-reading-item{font-size:12px;line-height:1.4;min-width:0}
.chart-reading-name{display:flex;align-items:center;gap:6px}
.chart-reading-name::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}
.chart-reading-number{font-size:13px;font-weight:650;font-variant-numeric:tabular-nums;margin-top:3px;white-space:nowrap}
.chart-reading-number small{font-size:12px;color:var(--muted);font-weight:400;margin-left:4px}
.page-nav{max-width:100%;overflow-x:auto;flex-wrap:nowrap}.page-nav a{flex-shrink:0;white-space:nowrap}
@media(max-width:620px){.chart-reading{flex-direction:column;gap:10px;left:16px;right:16px}.chart-reading-values{gap:10px 16px}.page-nav{position:sticky!important;top:0;justify-content:flex-start!important}}
</style>`;
function runtime() {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const active = prefix => document.querySelector('#' + prefix + 'MetricTabs .active')?.dataset.metric;
  const metadata = (id, s) => {
    const overview = {'chart-price':['指数价格','点'], 'chart-pe':['市盈率 PE(TTM)','倍'], 'chart-profit':['归母净利润 TTM','亿元']};
    if (overview[id]) return overview[id];
    if (id.startsWith('chart-volume')) return ['交易规模', s.name === '成交量' ? '亿手' : '亿元'];
    if (id === 'valuationChart') return [document.querySelector('#valuationMetricTabs .active')?.textContent, active('valuation') === 'pe' ? '倍' : '%'];
    if (id === 'retailSentimentChart') return [document.querySelector('#retailMetricTabs .active')?.textContent,
      ({volume:'亿手',turnover:'%',marginFloatRatio:'%'})[active('retail')] || '亿元'];
    if (id === 'largeMoneyChart') return [document.querySelector('#largeMoneyMetricTabs .active')?.textContent,
      ({fundPosition:'%',institutionConcentration:'%',etfShares:'亿份'})[active('largeMoney')] ||
      (active('largeMoney') === 'northHoldings' && document.querySelector('#largeMoneyHoldingModes [data-holding-mode="ratio"]')?.classList.contains('active') ? '%' : '亿元')];
    return [document.querySelector('#officialMetricTabs .active')?.textContent,'亿元'];
  };
  const ids = ['chart-price','chart-pe','chart-profit','chart-volume-sh','chart-volume-k50','chart-volume-sz',
    'valuationChart','retailSentimentChart','largeMoneyChart','officialSentimentChart'];
  for (const id of ids) {
    const node = document.getElementById(id);
    if (!node) continue;
    const chart = echarts.getInstanceByDom(node);
    if (!chart) continue;
    const shell = document.createElement('div'); shell.className = 'chart-reading-shell';
    node.before(shell); shell.append(node);
    const header = document.createElement('div'); header.className = 'chart-reading'; header.id = id + '-latest';
    header.setAttribute('aria-live','polite'); shell.prepend(header);
    const originalSet = chart.setOption.bind(chart);
    const baseHeight = node.offsetHeight;
    let legendVisible = false, legendSelection = {}, allSeries = [];
    function layout() {
      const top = header.offsetHeight + 48;
      const legendHeight = legendVisible ? 32 : 0;
      node.style.height = Math.max(baseHeight, top + legendHeight + 240) + 'px';
      chart.resize();
      originalSet({grid:{top:top + legendHeight}, ...(legendVisible ? {legend:{top:top - 2}} : {})});
    }
    function render() {
      const items = allSeries.filter(s => legendSelection[s.name] !== false).map(s => {
        const points = (s.data || []).map(p => p?.value || p);
        const point = points.findLast(p => Array.isArray(p) && Number.isFinite(p[1]));
        const trailingMissing = point && points.at(-1)?.[0] > point[0];
        const [title,unit] = metadata(id,s);
        const reportDate = id === 'chart-profit' && point
          ? (s.name.includes('创业板') ? DATA.sh : DATA.sz).findLast(row => row.date <= point[0] && Number.isFinite(row.profitYi))?.profitPeriod : null;
        return {name:s.name,color:s.itemStyle?.color || s.lineStyle?.color || '#91aaa8',
          value:point?.[1],date:reportDate || point?.[0],title,unit,status:trailingMissing?'最近一期缺失，显示此前有效值':!point?'暂无数据':''};
      });
      const dates = [...new Set(items.map(i=>i.date).filter(Boolean))];
      const sameDate = dates.length === 1;
      const contextId = ({retailSentimentChart:'retail',largeMoneyChart:'largeMoney',officialSentimentChart:'official'})[id];
      const average = contextId && document.querySelector('#'+contextId+'AverageModes:not([hidden]) .active')?.textContent;
      header.innerHTML = '<div class="chart-reading-heading">'+escape(items[0]?.title || metadata(id,{})[0])+
        '<div class="chart-reading-date">'+escape(['最新数据',sameDate?dates[0]:dates.length?'各曲线日期见读数':'暂无数据',average].filter(Boolean).join(' · '))+'</div></div>'+
        '<div class="chart-reading-values">'+items.map(i=>'<div class="chart-reading-item" style="color:'+escape(i.color)+'" data-series="'+escape(i.name)+'">'+
          '<div class="chart-reading-name">'+escape(i.name)+'</div><div class="chart-reading-number">'+
          (Number.isFinite(i.value)?i.value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):'--')+'<small>'+escape(i.unit)+'</small></div>'+
          (!sameDate&&i.date?'<div class="chart-reading-date">'+escape(i.date)+'</div>':'')+
          (i.status?'<div class="chart-reading-status">'+escape(i.status)+'</div>':'')+'</div>').join('')+'</div>';
      layout();
    }
    chart.setOption = function(option, ...args) {
      const result = originalSet(option,...args);
      if (option.series) {
        const current = chart.getOption();
        allSeries = current.series || [];
        legendVisible = !!current.legend?.length && current.legend[0].show !== false;
        legendSelection = current.legend?.[0]?.selected || {};
        render();
      }
      return result;
    };
    chart.on('legendselectchanged', e => {legendSelection = e.selected;render();});
    let frame=0;
    window.addEventListener('resize',()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(layout);});
    const current = chart.getOption(); allSeries=current.series || [];
    legendVisible=!!current.legend?.length && current.legend[0].show !== false;
    legendSelection=current.legend?.[0]?.selected || {};
    render();
  }
  // Keep original methodological/status notes; the new row replaces only duplicate numerical readings.
  const oldValuation = document.getElementById('valuationMetricCoverage');
  if (oldValuation) oldValuation.hidden = true;
  const nav = document.querySelector('.page-nav');
  const links = Array.from(nav.querySelectorAll('a'));
  const sections = links.map(link=>({link,section:document.getElementById(link.hash.slice(1))})).filter(x=>x.section);
  let frame=0;
  function updateNav() {
    frame=0;
    let current=sections[0];
    const line=nav.getBoundingClientRect().bottom+32;
    for(const item of sections) if(item.section.getBoundingClientRect().top<=line) current=item;
    if(window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-2) current=sections.at(-1);
    if(!current)return;
    for(const link of links){link.classList.toggle('active',link===current.link);
      if(link===current.link)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
    const bounds=nav.getBoundingClientRect(),activeBounds=current.link.getBoundingClientRect();
    if(activeBounds.left<bounds.left+6||activeBounds.right>bounds.right-6)
      nav.scrollTo({left:current.link.offsetLeft-(nav.clientWidth-current.link.offsetWidth)/2,behavior:'instant'});
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(updateNav);}
  window.addEventListener('scroll',schedule,{passive:true});
  for(const event of ['resize','hashchange','load'])window.addEventListener(event,schedule);
  updateNav();
}
function enhance(html) {
  const insert = (source, tag, content) => {
    const at = source.lastIndexOf(tag);
    if (at < 0) throw new Error('Missing closing tag: ' + tag);
    return source.slice(0, at) + content + source.slice(at);
  };
  html = insert(html, '</head>', css + '\n');
  return insert(html, '</body>', '<script id="dashboard-interactions-script">(' + runtime.toString() + ')();</script>\n');
}
module.exports={enhance};
