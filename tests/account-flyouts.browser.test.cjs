const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {chromium}=require('playwright');
const root=resolve(__dirname,'..');
const source=readFileSync(resolve(root,'updates/workspace-ui.js'),'utf8');
const billing=source.slice(source.indexOf(' function billingAmount('),source.indexOf(' function ribbon('));
let browser;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
async function fixture(t){
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 t.after(()=>page.close());page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://studio.test/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><main><header><div id="connection-indicators"></div><div id="workspace-menus"><details id="education-menu"></details></div></header></main><button id="outside">Outside</button>'}));
 await page.goto('https://studio.test/');
 await page.addStyleTag({path:resolve(root,'studio.css')});
 await page.addStyleTag({path:resolve(root,'updates/workspace-ui.css')});
 await page.evaluate(()=>{
  localStorage.setItem('ecco-user-session','test-only-session');
  window.fetch=async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({user:{id:'test-user',name:'Test User'}})});
  window.state={config:{session_cost:{estimated_usd:1.25},billing:{last_success:1,total_spent_usd:8}}};
  window.api=async()=>window.state;window.refresh=async()=>{};
 });
 await page.addScriptTag({content:'(()=>{const q=s=>document.querySelector(s);'+billing+'})();'});
 await page.addScriptTag({path:resolve(root,'credits-store.js')});
 await page.addScriptTag({path:resolve(root,'google-signin.js')});
 await page.locator('#google-user-name').click();
 return {page,errors,credits:page.locator('[data-user-flyout="usage"]'),bill:page.locator('[data-user-flyout="billing"]')};
}
async function focusedUsage(page,credits){
 await credits.focus();await credits.press('ArrowLeft');
 assert.equal(await page.locator('[aria-label="Close Credits and Usage"]').evaluate(el=>el===document.activeElement),true);
}
test('Billing opens after the focused Credits panel closes on hover',async t=>{
 const {page,errors,credits,bill}=await fixture(t);
 await focusedUsage(page,credits);await bill.hover();await bill.click();
 assert.deepEqual(errors,[]);
 assert.equal(await page.locator('#workspace-usage-drawer').count(),0);
 assert.equal(await page.locator('#workspace-billing-drawer').isVisible(),true);
 assert.equal(await page.locator('#google-user-menu').getAttribute('open'),'');
 assert.equal(await bill.getAttribute('aria-expanded'),'true');
 assert.equal(await credits.getAttribute('aria-expanded'),'false');
 assert.match(await page.locator('#workspace-billing-drawer').innerText(),/Total Cost: \$8.00/);
});
test('Credits close, Escape and ArrowRight restore focus without reentrant removal',async t=>{
 const {page,errors,credits}=await fixture(t);
 for(const key of ['click','Escape','ArrowRight']){
  await focusedUsage(page,credits);
  const close=page.locator('[aria-label="Close Credits and Usage"]');
  if(key==='click')await close.click();else await close.press(key);
  assert.equal(await page.locator('#workspace-usage-drawer').count(),0);
  assert.equal(await credits.evaluate(el=>el===document.activeElement),true,key+' focus');
  assert.equal(await page.locator('#google-user-menu').getAttribute('open'),'');
 }
 assert.deepEqual(errors,[]);
});
test('Billing keyboard dismissal and focus exit preserve the parent menu',async t=>{
 const {page,errors,bill}=await fixture(t);
 await bill.focus();await bill.press('ArrowLeft');
 const refresh=page.locator('.billing-refresh');
 assert.equal(await refresh.evaluate(el=>el===document.activeElement),true);
 await refresh.click();await refresh.press('Escape');
 assert.equal(await bill.evaluate(el=>el===document.activeElement),true);
 assert.equal(await bill.getAttribute('aria-expanded'),'false');
 assert.equal(await page.locator('#google-user-menu').getAttribute('open'),'');
 await bill.press('ArrowLeft');await page.locator('#outside').focus();
 assert.equal(await bill.getAttribute('aria-expanded'),'false');
 assert.deepEqual(errors,[]);
});
test('purchase and nested Billing Information close without losing the parent',async t=>{
 const {page,errors,credits}=await fixture(t);
 await focusedUsage(page,credits);await page.getByRole('button',{name:'Purchase Additional Credits',exact:true}).click();
 await page.getByRole('button',{name:'Add to cart',exact:true}).first().click();
 await page.getByRole('button',{name:'View cart',exact:true}).click();
 await page.getByRole('button',{name:'Check out',exact:true}).click();
 await page.getByRole('button',{name:'Billing Information',exact:true}).click();
 assert.equal(await page.locator('dialog[open]').count(),2);
 await page.locator('dialog').last().getByRole('button',{name:'Close popup',exact:true}).click();
 assert.equal(await page.locator('dialog[open]').count(),1);
 assert.equal(await page.getByRole('button',{name:'Complete purchase',exact:true}).isDisabled(),true);
 assert.deepEqual(errors,[]);
});
