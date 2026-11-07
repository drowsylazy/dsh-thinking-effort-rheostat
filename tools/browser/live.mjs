// Verify the installed plugin against the existing, authenticated Harness GUI.
// The Host grants DSH_TEST_URL for this test process only; it is never persisted.
// No personal browser profile, replacement server, model changes or test messages.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
const plan=JSON.parse(readFileSync(process.argv[2],'utf8'));
const url=process.env.DSH_TEST_URL;
const report={phase:plan.phase,origin:new URL(url).origin,results:[],errors:[]};
let browser,page;
const redact=value => String(value).replaceAll(url,'[test URL]');

async function measure(chip) {
  return chip.evaluate(el => {
    const panel=document.querySelector('[data-te-panel]');
    const rect=node => {const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const c=rect(el),p=rect(panel);
    const seat=el.closest('[data-composer-seat]');
    const style=getComputedStyle(seat);
    const expectedLeft=Math.max(8,Math.min(c.left,innerWidth-272-8));
    return {session:el.closest('[data-conversation-session]').getAttribute('data-conversation-session'),phase:el.closest('[data-content-phase]').getAttribute('data-content-phase'),chip:c,panel:p,expectedLeft,deltaLeft:p.left-expectedLeft,deltaBottom:p.bottom-c.top+8,bodyPortal:panel.parentElement===document.body,inViewport:p.left>=7.5&&p.right<=innerWidth-7.5&&p.top>=0&&p.bottom<=innerHeight,ancestor:{willChange:style.willChange,transform:style.transform,position:style.position},viewport:{width:innerWidth,height:innerHeight}};
  });
}
async function open(chip) {
  await chip.click();
  const panel=page.locator('[data-te-panel]');
  await panel.waitFor({state:'visible'});
  await panel.evaluate(async el => {await Promise.all(el.getAnimations().filter(a => Number.isFinite(a.effect.getTiming().iterations)).map(a => a.finished.catch(() => {})));});
}
async function screenshot(g,name) {
  const x=Math.max(0,Math.min(g.chip.left,g.panel.left)-24);
  const y=Math.max(0,Math.min(g.chip.top,g.panel.top)-24);
  const right=Math.min(g.viewport.width,Math.max(g.chip.right,g.panel.right)+24);
  const bottom=Math.min(g.viewport.height,Math.max(g.chip.bottom,g.panel.bottom)+24);
  const path=plan.report.replace(/\.json$/,`-${name}.png`);
  await page.screenshot({path,clip:{x,y,width:right-x,height:bottom-y}});
  return path;
}
async function test(name,fn) {
  const result={name};
  report.results.push(result);
  try {await fn(result);result.ok=true;}
  catch(error) {result.ok=false;result.error=redact(error.message);}
}

try {
  browser=await chromium.launch({executablePath:process.env.DSH_TEST_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
  page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  page.setDefaultTimeout(15000);
  page.on('pageerror',error => report.errors.push(redact(error.message)));
  report.status=(await page.goto(url,{waitUntil:'domcontentloaded'})).status();
  assert.equal(report.status,200);
  const search=page.getByRole('button',{name:'搜索会话',exact:true});
  try {await search.click({timeout:4000});}
  catch {
    // A fresh test browser shows the product's informational preview notice.
    // Dismiss only this known notice; never accept an approval/plan/question.
    const preview=page.getByRole('dialog').filter({hasText:'预览版说明'});
    if(await preview.count()) await preview.getByRole('button',{name:'继续',exact:true}).click();
    else await page.keyboard.press('Escape');
    await search.click();
  }
  await page.locator('input').first().fill(plan.sessionId);
  await page.getByRole('treeitem').first().click();
  const oldChip=page.locator(`[data-conversation-session="${plan.sessionId}"] [data-te-chip]`).first();
  await oldChip.waitFor({state:'visible'});
  await page.waitForFunction(id => document.querySelector(`[data-conversation-session="${id}"][data-content-phase="active"]`)!==null,plan.sessionId);
  await open(oldChip);
  await test('existing conversation (active)',async result => {
    const g=await measure(oldChip);result.geometry=g;result.screenshot=await screenshot(g,'old');
    assert.equal(g.ancestor.willChange,'transform');
    assert.equal(g.ancestor.transform,'none');
    if(plan.phase==='baseline') {
      assert.equal(g.bodyPortal,false,'expected original inline panel');
      assert.ok(Math.abs(g.deltaLeft)>20 || Math.abs(g.deltaBottom)>20,'original offset must reproduce');
    } else {
      assert.equal(g.bodyPortal,true);
      assert.ok(Math.abs(g.deltaLeft)<1,JSON.stringify(g));
      assert.ok(Math.abs(g.deltaBottom)<1,JSON.stringify(g));
      assert.equal(g.inViewport,true);
    }
  });
  await page.keyboard.press('Escape');
  await page.locator('[data-te-panel]').waitFor({state:'detached'});
  if(plan.phase!=='baseline') {
    await test('old conversation reopen and resize',async result => {
      await open(oldChip);
      await page.setViewportSize({width:1024,height:900});
      await page.waitForFunction(() => {const p=document.querySelector('[data-te-panel]').getBoundingClientRect();return Math.abs(p.left-parseFloat(document.querySelector('[data-te-panel]').style.left))<1 && p.right<=innerWidth-7.5;});
      const g=await measure(oldChip);result.geometry=g;
      assert.ok(Math.abs(g.deltaLeft)<1,JSON.stringify(g));assert.ok(Math.abs(g.deltaBottom)<1,JSON.stringify(g));assert.equal(g.inViewport,true);
      await page.keyboard.press('Escape');await page.locator('[data-te-panel]').waitFor({state:'detached'});
      await page.setViewportSize({width:1280,height:900});
    });
  }
  const workspaceNew=page.getByRole('button',{name:`在“${plan.workspaceTitle}”中新建会话`,exact:true});
  if(await workspaceNew.count()) await workspaceNew.click();
  else await page.getByRole('button',{name:'新建会话',exact:true}).last().click();
  const newChip=page.locator('[data-content-phase="hero"] [data-te-chip]').first();
  await newChip.waitFor({state:'visible'});
  await open(newChip);
  await test('blank conversation (hero)',async result => {
    const g=await measure(newChip);result.geometry=g;result.screenshot=await screenshot(g,'new');
    assert.equal(g.ancestor.willChange,'auto');
    assert.ok(Math.abs(g.deltaLeft)<1,JSON.stringify(g));assert.ok(Math.abs(g.deltaBottom)<1,JSON.stringify(g));assert.equal(g.inViewport,true);
    if(plan.phase!=='baseline')assert.equal(g.bodyPortal,true);
  });
  await test('inside click, outside dismissal and Escape',async () => {
    await page.locator('[data-te-panel] .te-kicker').click();
    assert.equal(await page.locator('[data-te-panel]').count(),1);
    await page.locator('[data-content-phase="hero"] [data-composer-input]').first().click();
    await page.locator('[data-te-panel]').waitFor({state:'detached'});
    await open(newChip);
    await page.keyboard.press('Escape');
    await page.locator('[data-te-panel]').waitFor({state:'detached'});
    assert.equal(await newChip.evaluate(el => el===document.activeElement),true);
  });
  await test('no browser errors',async () => {assert.deepEqual(report.errors,[]);});
} catch(error) {
  report.failure=redact(error.message);
  if(page)report.overlays=await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map(el => ({text:el.textContent.trim().slice(0,1000),buttons:[...el.querySelectorAll('button')].map(b => b.textContent.trim())}))).catch(() => []);
} finally {
  await browser?.close();
  report.ok=!report.failure&&report.results.every(result => result.ok)&&report.errors.length===0;
  writeFileSync(plan.report,JSON.stringify(report,null,2));
  if(!report.ok)process.exitCode=1;
}
