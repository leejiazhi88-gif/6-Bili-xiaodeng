const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    for(const width of [1440,1000,620,390,320]) {
      const page=await browser.newPage({viewport:{width,height:1000}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
      assert.equal(await page.locator('h1').textContent(),'6 XiaoDeng');
      assert.equal(await page.locator('#overviewSeriesControls input:checked').count(),3);
      for(const [key,name] of [['sh','创业板指'],['k50','科创50'],['sz','科创综指']]) {
        assert.match(await page.locator('#chart-volume-'+key+'-latest .chart-reading-heading').textContent(),new RegExp(name));
        const layout=await page.evaluate(key=>{
          const node=document.getElementById('chart-volume-'+key),c=echarts.getInstanceByDom(node),o=c.getOption();
          const heading=document.getElementById('chart-volume-'+key+'-latest');
          return {title:o.title[0]?.show,legend:o.legend[0].show,plot:o.grid[0].top,header:heading.offsetTop+heading.offsetHeight,
            values:heading.querySelector('.chart-reading-values').getBoundingClientRect().top,headingBottom:heading.querySelector('.chart-reading-heading').getBoundingClientRect().bottom};
        },key);
        assert.equal(layout.title,false);assert.equal(layout.legend,false);
        assert.ok(layout.plot>layout.header);assert.ok(layout.values>=layout.headingBottom);
      }
      const initial=await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('chart-profit')).getOption().series.map(s=>({name:s.name,finite:s.data.some(p=>Number.isFinite(p[1]))})));
      assert.equal(initial.length,3);assert.ok(initial.every(s=>s.finite));
      for(let mask=0;mask<8;mask++) {
        for(const [i,key] of ['sh','k50','sz'].entries()) await page.locator('#overviewSeriesControls input[data-index="'+key+'"]').setChecked(!!(mask&(1<<i)));
        const state=await page.evaluate(()=>{
          return ['chart-price','chart-pe','chart-profit'].map(id=>{
            const o=echarts.getInstanceByDom(document.getElementById(id)).getOption();
            return {id,legend:o.legend[0],readings:document.querySelectorAll('#'+id+'-latest .chart-reading-item').length};
          });
        });
        const count=[0,1,2].filter(i=>mask&(1<<i)).length;
        for(const s of state) {
          assert.equal(s.readings,count,s.id+' mask '+mask);
          assert.equal(s.legend.show,false);
          for(const [name,selected] of Object.entries(s.legend.selected)) {
            const i=name.includes('创业板')?0:name.includes('科创50')?1:2;
            assert.equal(selected,!!(mask&(1<<i)));
          }
        }
        for(const [i,key] of ['sh','k50','sz'].entries()) assert.equal(await page.locator('#chart-volume-'+key).isVisible(),!!(mask&(1<<i)));
        assert.ok(await page.evaluate(()=>['sh','k50','sz'].every(key=>{const n=document.getElementById('chart-volume-'+key);return !n.getBoundingClientRect().width || Math.abs(echarts.getInstanceByDom(n).getWidth()-n.clientWidth)<2})));
      }
      // A time-range change cannot restore a deselected index or affect other modules.
      await page.locator('#overviewSeriesControls input[data-index="k50"]').uncheck();
      await page.locator('.ranges [data-years="3"]').click();
      assert.equal(await page.locator('#chart-price-latest .chart-reading-item').count(),2);
      assert.equal(await page.locator('#valuationChart-latest .chart-reading-item').count(),3);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.deepEqual(errors,[]);
      await page.locator('#overviewSeriesControls input[data-index="k50"]').check();
      await page.locator('.volume-charts').scrollIntoViewIfNeeded();
      await page.screenshot({path:'/tmp/xd-overview-controls-'+width+'.png'});
      console.log('PASS overview selection/title/layout',width);
      await page.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
