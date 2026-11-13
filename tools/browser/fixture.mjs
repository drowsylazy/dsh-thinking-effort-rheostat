// Real React + Chromium layout regressions; no Harness server or credentials needed.
// pnpm --dir tools/browser install --ignore-scripts
// node tools/browser/fixture.mjs [--source path] [--before] [--report path]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const before = args.includes('--before');
const reportPath = option('--report', resolve(root, '.verification/fixture.json'));
const source = readFileSync(option('--source', resolve(root, 'client.js')), 'utf8');
const executablePath = process.env.DSH_TEST_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
const errors = [];

async function fixture(effect = 'none', width = 1280, theme = 'light', options = {}) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin:0; font-family:Arial,sans-serif; --dsw-alias-bg-layer-1:${theme === 'dark' ? '#232324' : '#fff'}; --dsw-alias-bg-layer-2:#ddd; --dsw-alias-label-primary:${theme === 'dark' ? '#eee' : '#222'}; --dsw-alias-label-secondary:#777; --dsw-alias-border-l2:#ccc; --dsw-alias-interactive-bg-hover:#eee; --dsw-alias-state-business-primary:#5686fe; --dsw-elevation-prominent:0 6px 20px #0002; }
    #conversation { position:absolute; left:${width < 600 ? 0 : 180}px; right:20px; top:80px; height:680px; overflow:auto; }
    #content { position:relative; height:850px; }
    #footer { position:absolute; left:40px; right:0; top:540px; height:140px; ${effect === 'filter' ? 'filter:drop-shadow(0 4px 12px #0001);' : effect === 'transform' ? 'transform:translateZ(0);' : effect === 'will-change' ? 'will-change:transform;' : effect === 'contain' ? 'contain:layout;' : ''} }
    #mount { position:absolute; top:50px; right:${width < 600 ? 0 : 100}px; }
    .te-panel { animation:none!important; }
  </style></head><body><div id="conversation"><div id="content"><div id="footer"><div id="mount"></div></div></div></div></body></html>`);
  await page.addScriptTag({ path: resolve(dirname(require.resolve('react/package.json')), 'umd/react.production.min.js') });
  await page.addScriptTag({ path: resolve(dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.production.min.js') });
  await page.evaluate(() => {
    window.__ModuleLoader__ = { load: spec => { window.__bundle = spec; } };
  });
  await page.addScriptTag({ content: source });
  await page.evaluate(options => {
    const levels = options.levels || ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    const provider = options.provider || 'test';
    const model = options.model || 'test-model';
    const current = { provider, model, ...(options.initialEffort === null ? {} : { reasoningEffort:options.initialEffort || 'max' }) };
    const reasoning = { efforts:levels.map(id => ({id,name:id[0].toUpperCase()+id.slice(1)})), ...(options.noDefault ? {} : { defaultEffort:options.defaultEffort || 'medium' }) };
    const listeners = new Set();
    window.__calls = [];
    let snapshot = { current, groups:[{id:provider,models:[{id:model,name:'Test Model',...(options.noReasoning ? {} : {reasoning})}]}], status:'ready',error:null };
    window.fetch = async () => ({ ok:true, json:async () => ({ ok:true,state:'native',levels:options.noReasoning ? [] : levels }) });
    // Match the core contract: only adapter-owned IDs, or an omitted effort.
    const directory = { available:true, load:async () => {}, store:{getSnapshot:() => snapshot,subscribe:listener => {listeners.add(listener);return () => listeners.delete(listener);}}, select:async selection => {
      window.__calls.push(selection);
      if(Object.hasOwn(selection,'reasoningEffort') && (options.noReasoning || !levels.includes(selection.reasoningEffort))) return {ok:false};
      snapshot={...snapshot,current:selection,retainedEffort:'High'};listeners.forEach(fn => fn());return {ok:true};
    } };
    const bundle = window.__bundle.factory(name => {
      if(name === 'react') return window.React;
      if(name === 'react-dom') return window.ReactDOM;
      throw new Error('Unexpected test import: '+name);
    });
    let Control, dictionary;
    window.__disposers = [];
    const scope = { modelDirectories:{directoryFor:() => directory}, slots:{inject:(_name,callback) => callback(),register:(_options,component) => {Control=component;return () => {}; }}, locale:{register:(_name,dict) => {dictionary=dict;return () => {}; }}, effect:fn => {const dispose=fn();if(typeof dispose === 'function')window.__disposers.push(dispose);} };
    bundle.apply({...scope,inject:(_services,callback) => callback(scope)});
    window.__root=window.ReactDOM.createRoot(document.getElementById('mount'));
    window.__root.render(window.React.createElement(Control,{sessionId:'fixture',t:key => dictionary[options.locale || 'en'][key] || key}));
  }, options);
  await page.locator('[data-te-chip]').waitFor({ state:'visible' });
  return page;
}

async function open(page) {
  await page.locator('[data-te-chip]').click();
  await page.locator('[data-te-panel]').waitFor({ state:'visible' });
  await page.waitForFunction(() => document.querySelector('[data-te-panel] button[role="slider"]') === document.activeElement);
}
async function geometry(page) {
  return page.evaluate(() => {
    const panel=document.querySelector('[data-te-panel]');
    const chip=document.querySelector('[data-te-chip]');
    const rect=el => {const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const c=rect(chip),p=rect(panel);
    const expectedLeft=Math.max(8,Math.min(c.left,innerWidth-272-8));
    const ancestorStyle=getComputedStyle(document.getElementById('footer'));
    return {chip:c,panel:p,expectedLeft,deltaLeft:p.left-expectedLeft,deltaBottom:p.bottom-(c.top-8),inViewport:p.left>=7.5&&p.right<=innerWidth-7.5&&p.top>=0&&p.bottom<=innerHeight,bodyPortal:panel.parentElement===document.body,ancestor:{willChange:ancestorStyle.willChange,transform:ancestorStyle.transform},viewport:{width:innerWidth,height:innerHeight}};
  });
}
async function test(name, callback) {
  try { const details=await callback();results.push({name,ok:true,details});console.log('PASS '+name); }
  catch(error) { results.push({name,ok:false,error:error.message});console.error('FAIL '+name+': '+error.message); }
}

try {
  for(const theme of ['light','dark']) {
    for(const effect of ['none','will-change','filter','transform','contain']) {
      await test(`${theme}: ${effect} ancestor uses viewport coordinates`,async () => {
        const page=await fixture(effect,1280,theme);
        try {
          await open(page);
          const g=await geometry(page);
          if(effect==='will-change') {
            assert.equal(g.ancestor.willChange,'transform');
            assert.equal(g.ancestor.transform,'none','will-change alone must establish the legacy containing block');
          }
          if(before && effect !== 'none') {
            assert.ok(Math.abs(g.deltaLeft)>20 || Math.abs(g.deltaBottom)>20,'legacy offset must reproduce');
            assert.equal(g.bodyPortal,false);
          } else {
            assert.ok(Math.abs(g.deltaLeft)<1,JSON.stringify(g));
            assert.ok(Math.abs(g.deltaBottom)<1,JSON.stringify(g));
            assert.equal(g.inViewport,true,JSON.stringify(g));
            if(!before)assert.equal(g.bodyPortal,true,'panel must escape the composer containing block');
          }
          if(theme==='light' && effect==='filter') {
            mkdirSync(dirname(reportPath),{recursive:true});
            await page.screenshot({path:reportPath.replace(/\.json$/,'.png')});
          }
          return g;
        } finally { await page.close(); }
      });
    }
  }
  await test('narrow viewport keeps the entire panel on screen',async () => {
    const page=await fixture('none',240);
    try {await open(page);const g=await geometry(page);assert.equal(g.inViewport,!before,JSON.stringify(g));return g;}
    finally {await page.close();}
  });
  await test('scroll and window resize re-anchor the open panel',async () => {
    const page=await fixture();
    try {
      await open(page);
      const old=await geometry(page);
      await page.locator('#conversation').evaluate(el => {el.scrollTop=80;});
      await page.waitForFunction(() => {const p=document.querySelector('[data-te-panel]').getBoundingClientRect(),c=document.querySelector('[data-te-chip]').getBoundingClientRect();return Math.abs(p.bottom-c.top+8)<1;});
      const scrolled=await geometry(page);
      assert.ok(scrolled.chip.top<old.chip.top-70);
      await page.setViewportSize({width:1100,height:800});
      await page.waitForFunction(() => {const p=document.querySelector('[data-te-panel]').getBoundingClientRect(),c=document.querySelector('[data-te-chip]').getBoundingClientRect();return Math.abs(p.left-Math.max(8,Math.min(c.left,innerWidth-272-8)))<1;});
      const resized=await geometry(page);assert.ok(Math.abs(resized.deltaLeft)<1);return {scrolled,resized};
    } finally {await page.close();}
  });
  await test('portal keeps keyboard selection, Escape, outside dismissal and cleanup',async () => {
    const page=await fixture();
    try {
      await open(page);
      const slider=page.locator('[role="slider"]');
      await slider.press('ArrowLeft');
      await page.waitForFunction(() => document.querySelector('[role="slider"]').getAttribute('aria-valuenow')==='5');
      assert.equal(await page.evaluate(() => window.__calls[0].reasoningEffort),'xhigh');
      await slider.press('Escape');
      await page.locator('[data-te-panel]').waitFor({state:'detached'});
      assert.equal(await page.locator('[data-te-chip]').evaluate(el => el===document.activeElement),true);
      await open(page);
      await page.mouse.click(8,8);
      await page.locator('[data-te-panel]').waitFor({state:'detached'});
      await open(page);
      await page.evaluate(() => {window.__root.unmount();window.__disposers.forEach(fn => fn());});
      assert.equal(await page.locator('[data-te-panel]').count(),0);
      return {requests:1,unmounted:true};
    } finally {await page.close();}
  });
  // Hy4 publishes High only. Provider default is a separate, omitted-effort
  // choice, not a fabricated Low/Medium level or an explicit Off value.
  for(const model of ['homelab/workbuddy/hy4free','homelab/workbuddy-ai/hy4free']) {
    await test(`${model}: default and High switch with keyboard and pointer`,async () => {
      const page=await fixture('will-change',1280,'light',{provider:'magpie',model,levels:['high'],initialEffort:'high',noDefault:true});
      try {
        await open(page);
        const slider=page.locator('[role="slider"]');
        assert.equal(await slider.getAttribute('aria-valuemax'),'2');
        assert.equal(await page.locator('.te-tick').count(),2,'only default and the actually offered High');
        await slider.press('Home');
        await page.waitForFunction(() => document.querySelector('[data-te-chip]').textContent==='Provider default');
        assert.deepEqual(await page.evaluate(() => window.__calls[0]),{provider:'magpie',model});
        await slider.press('Home');
        assert.equal(await page.evaluate(() => window.__calls.length),1,'active default is a no-op');
        await slider.press('End');
        await page.waitForFunction(() => document.querySelector('[data-te-chip]').textContent==='High');
        assert.deepEqual(await page.evaluate(() => window.__calls[1]),{provider:'magpie',model,reasoningEffort:'high'});
        const rail=await page.locator('.te-rail').boundingBox();
        await page.mouse.click(rail.x+13,rail.y+rail.height/2);
        await page.waitForFunction(() => document.querySelector('[data-te-chip]').textContent==='Provider default');
        assert.deepEqual(await page.evaluate(() => window.__calls[2]),{provider:'magpie',model});
        if(model.includes('workbuddy/')) {
          const panel=await page.locator('[data-te-panel]').boundingBox();
          mkdirSync(dirname(reportPath),{recursive:true});
          await page.screenshot({path:reportPath.replace(/\.json$/,'-hy4-default.png'),clip:{x:panel.x-8,y:panel.y-8,width:panel.width+16,height:panel.height+72}});
        }
        await page.mouse.click(rail.x+rail.width-13,rail.y+rail.height/2);
        await page.waitForFunction(() => document.querySelector('[data-te-chip]').textContent==='High');
        assert.deepEqual(await page.evaluate(() => window.__calls[3]),{provider:'magpie',model,reasoningEffort:'high'});
        return {choices:['provider default','high'],requests:await page.evaluate(() => window.__calls)};
      } finally {await page.close();}
    });
  }
  await test('provider default and an explicit Off level stay distinct',async () => {
    const page=await fixture('none',1280,'light',{levels:['off','high'],initialEffort:'high',noDefault:true});
    try {
      await open(page);
      const slider=page.locator('[role="slider"]');
      assert.equal(await slider.getAttribute('aria-valuemax'),'3');
      await slider.press('Home');
      await page.waitForFunction(() => window.__calls.length===1);
      assert.equal(await page.evaluate(() => Object.hasOwn(window.__calls[0],'reasoningEffort')),false);
      await slider.press('ArrowRight');
      await page.waitForFunction(() => window.__calls.length===2);
      assert.equal(await page.evaluate(() => window.__calls[1].reasoningEffort),'off');
      assert.equal(await page.locator('[data-te-chip]').textContent(),'Off');
      return {requests:await page.evaluate(() => window.__calls)};
    } finally {await page.close();}
  });
  await test('an adapter-configured default is not duplicated',async () => {
    const page=await fixture('none',1280,'light',{levels:['high'],initialEffort:null,defaultEffort:'high'});
    try {await open(page);assert.equal(await page.locator('[role="slider"]').getAttribute('aria-valuemax'),'1');assert.equal(await page.locator('[data-te-chip]').textContent(),'High');}
    finally {await page.close();}
  });
  await test('opaque generic IDs work without a declaration writer',async () => {
    const page=await fixture('none',1280,'light',{provider:'generic',levels:['fast-mode','deep-mode'],initialEffort:null,noDefault:true});
    try {
      await open(page);
      const slider=page.locator('[role="slider"]');
      assert.equal(await slider.getAttribute('aria-valuemax'),'3');
      await slider.press('End');
      await page.waitForFunction(() => window.__calls.length===1);
      assert.equal(await page.evaluate(() => window.__calls[0].reasoningEffort),'deep-mode');
      await slider.press('Home');
      await page.waitForFunction(() => window.__calls.length===2);
      assert.equal(await page.evaluate(() => Object.hasOwn(window.__calls[1],'reasoningEffort')),false);
    } finally {await page.close();}
  });
  await test('provider-default labels follow the Chinese locale',async () => {
    const page=await fixture('none',1280,'light',{levels:['high'],initialEffort:null,noDefault:true,locale:'zh'});
    try {await open(page);assert.equal(await page.locator('[data-te-chip]').textContent(),'模型默认');assert.ok((await page.locator('[role="slider"]').getAttribute('aria-valuetext')).startsWith('模型默认'));}
    finally {await page.close();}
  });
  await test('models without reasoning still have an inert preview',async () => {
    const page=await fixture('none',1280,'light',{initialEffort:null,noReasoning:true});
    try {
      await page.locator('[data-te-chip]').click();
      await page.locator('[data-te-panel]').waitFor({state:'visible'});
      assert.equal(await page.locator('[role="slider"]').count(),0);
      assert.equal(await page.locator('.te-tick').count(),5);
      await page.locator('.te-rail').click();
      assert.deepEqual(await page.evaluate(() => window.__calls),[]);
    } finally {await page.close();}
  });
  await test('no uncaught browser errors',async () => {assert.deepEqual(errors,[]);});
} finally {
  await browser.close();
  mkdirSync(dirname(reportPath),{recursive:true});
  writeFileSync(reportPath,JSON.stringify({mode:before?'legacy-reproduction':'fixed',results},null,2));
}
const failures=results.filter(result => !result.ok);
console.log(`${results.length-failures.length}/${results.length} browser layout checks passed`);
if(failures.length)process.exitCode=1;
