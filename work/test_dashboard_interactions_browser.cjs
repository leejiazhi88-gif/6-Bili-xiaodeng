const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});
for(const width of [1440,390,320]){
const p=await b.newPage({viewport:{width,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto(require('node:url').pathToFileURL(require('node:path').resolve(__dirname,'../index.html')).href);await p.waitForTimeout(150);
assert.equal(await p.locator('.chart-reading').count(),10);
for(const prefix of ['valuation','retail','largeMoney','official']){
const buttons=p.locator('#'+prefix+'MetricTabs [data-metric]');
for(let i=0;i<await buttons.count();i++){
await buttons.nth(i).click();
const id=({valuation:'valuationChart',retail:'retailSentimentChart',largeMoney:'largeMoneyChart',official:'officialSentimentChart'})[prefix];
const readings=await p.evaluate(id=>{const node=document.getElementById(id),header=document.getElementById(id+'-latest'),chart=echarts.getInstanceByDom(node),o=chart.getOption();return {series:o.series.length,items:header.querySelectorAll('.chart-reading-item').length,grid:o.grid[0].top,head:header.offsetTop+header.offsetHeight,zoom:o.dataZoom.map(z=>z.type),text:header.textContent}},id);
assert.equal(readings.series,readings.items);assert.ok(readings.grid>readings.head);assert.ok(!readings.zoom.includes('inside'));
if(prefix==='largeMoney') console.log(width,await buttons.nth(i).getAttribute('data-metric'),readings.text);
}
}
for(const avg of ['1','7','30']){await p.locator('#officialAverageModes [data-average="'+avg+'"]').click();assert.match(await p.locator('#officialSentimentChart-latest').textContent(),avg==='1'?/原数据/:new RegExp(avg+'点均线'));}
for(const id of ['overview','valuation','retail-sentiment','large-money-sentiment','official-sentiment']){
await p.evaluate(id=>window.scrollTo(0,document.getElementById(id).getBoundingClientRect().top+window.scrollY-65),id);await p.waitForTimeout(150);
assert.equal(await p.locator('.page-nav [aria-current="location"]').getAttribute('href'),'#'+id);
}
assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'horizontal overflow '+width);
assert.deepEqual(errors,[]);
await p.screenshot({path:'/tmp/xd-official-'+width+'.png'});console.log('PASS width',width);await p.close();}
await b.close()})().catch(e=>{console.error(e);process.exitCode=1});
