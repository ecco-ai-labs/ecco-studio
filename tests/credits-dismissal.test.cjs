const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {JSDOM}=require('jsdom');

test('focusout during drawer removal cannot reenter Credits dismissal',t=>{
 const dom=new JSDOM('<details open><summary>User</summary><div class="workspace-menu-items"><button id="credits">Credit and Usage</button></div></details>',{runScripts:'outside-only'});
 const w=dom.window;t.after(()=>w.close());w.setInterval=()=>0;
 w.eval(readFileSync(resolve(__dirname,'../credits-store.js'),'utf8'));
 const trigger=w.document.getElementById('credits');
 w.EccoCredits.open('usage',trigger);
 const drawer=w.document.getElementById('workspace-usage-drawer');
 let removals=0;
 const nativeRemove=drawer.remove;
 // Chromium dispatches focusout synchronously while removing a focused child.
 drawer.remove=function(){
  removals++;
  if(removals===1)this.querySelector('button').dispatchEvent(new w.FocusEvent('focusout',{bubbles:true,relatedTarget:w.document.body}));
  return nativeRemove.call(this);
 };
 w.EccoCredits.closeUsage(true);
 assert.equal(removals,1);
 assert.equal(w.document.getElementById('workspace-usage-drawer'),null);
 assert.equal(trigger.getAttribute('aria-expanded'),'false');
 assert.equal(w.document.activeElement,trigger);
 // Repeated cleanup is harmless, and the menu can still be reopened.
 w.EccoCredits.closeUsage();w.EccoCredits.open('usage',trigger);
 assert.equal(trigger.getAttribute('aria-expanded'),'true');
 assert.ok(w.document.getElementById('workspace-usage-drawer'));
});

test('balance availability follows verified identity separately from credit-service availability',t=>{
 const dom=new JSDOM('<details open><summary>User</summary><div class="workspace-menu-items"><button id="credits">Credit and Usage</button></div></details>',{runScripts:'outside-only'});
 const w=dom.window;t.after(()=>w.close());w.setInterval=()=>0;
 w.EccoAuth={user:null};w.eval(readFileSync(resolve(__dirname,'../credits-store.js'),'utf8'));
 w.EccoCredits.open('usage',w.document.getElementById('credits'));
 const balance=()=>w.document.querySelector('[data-credit-balance]').textContent;
 assert.equal(balance(),'Sign in to view');
 w.EccoAuth.user={id:'verified-user'};w.document.dispatchEvent(new w.Event('ecco:auth-change'));
 assert.equal(balance(),'Unavailable');
 assert.equal(w.document.querySelector('[aria-label="Close Credits and Usage"]'),null);
});
