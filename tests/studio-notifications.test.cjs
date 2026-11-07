const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('../desk/node_modules/jsdom'),fs=require('node:fs');
const tick=()=>new Promise(r=>setTimeout(r,10));
const notice=(id,extra={})=>({id,title:'Notice '+id,body:'<img src=x onerror=alert(1)>',severity:'informational',expiresAt:null,...extra});
function setup(){
 const d=new JSDOM('<div id="workspace-community-controls"></div><button id="outside">Outside</button>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only',pretendToBeVisual:true}),w=d.window;
 w.EccoAuth={user:{id:'alice'}};w.sessionStorage.setItem('ecco-user-session','alice-session');w.AbortSignal=AbortSignal;
 let interval;w.setInterval=fn=>{interval=fn;return 0};const state={alice:[notice('one'),notice('two',{severity:'error'})],bob:[notice('private')]};const history={alice:[],bob:[]};const calls=[];let failure=false,held=null;
 w.fetch=async(url,opts)=>{
  const who=opts.headers.Authorization.replace('Bearer ','').replace('-session','');calls.push({url:String(url),...opts,who});
  if(held)return held;
  if(failure)return {ok:false,status:503,json:async()=>({error:'Unavailable'})};
  if(opts.method==='POST'){const {id,op}=JSON.parse(opts.body);assert.equal(op,'readNotification');const n=state[who].find(n=>n.id===id);if(n)history[who]=[{...n,readAt:new Date().toISOString()},...history[who]].slice(0,3);state[who]=state[who].filter(n=>n.id!==id)}
  return {ok:true,json:async()=>({notificationVersion:1,notificationHistoryVersion:1,notifications:state[who],readNotifications:history[who]})};
 };
 w.eval(fs.readFileSync('studio-notifications.js','utf8'));
 return {w,state,history,calls,q:s=>w.document.querySelector(s),poll:()=>interval(),fail:v=>failure=v,hold:v=>held=v};
}
test('server reads remove only clicked row; safe text, severity, badge, focus and dismissal',async()=>{
 const {w,q,calls}=setup();await tick();const bell=q('#notification-bell');
 assert.equal(q('.notification-count').textContent,'2');bell.click();await tick();
 assert.equal(calls.filter(c=>c.method==='POST').length,0);assert.equal(q('#notification-list img'),null);
 assert.equal(q('[data-severity="error"] .notification-meta').textContent,'Error');
 bell.focus();bell.blur();assert.equal(q('#notification-list').hidden,false);
 q('[data-notification-id="one"]').click();await tick();
 assert.equal(q('.notification-count').textContent,'1');assert.equal(q('[data-notification-id="one"]').dataset.read,'true');assert.equal(q('[data-notification-history]').hidden,false);assert.equal(q('#notification-list').hidden,false);
 assert.equal(w.document.activeElement.dataset.notificationId,'two');
 q('[data-notification-id="two"]').click();await tick();assert.equal(q('.notification-count').hidden,true);assert.equal(w.document.activeElement,bell);assert.equal(q('[role="status"]').textContent,'No New notifications');
 w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(q('#notification-list').hidden,true);
 bell.click();q('#outside').dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(q('#notification-list').hidden,true);await tick();w.close();
});
test('failed read stays unread and can be retried without claiming success',async()=>{
 const {w,q,fail}=setup();await tick();fail(true);q('.notification-item').click();await tick();
 assert.equal(q('.notification-count').textContent,'2');assert.match(q('[role="status"]').textContent,/Could not mark/);assert.equal(q('.notification-item').disabled,false);
 fail(false);q('.notification-item').click();await tick();assert.equal(q('.notification-count').textContent,'1');w.close();
});
test('account switch clears immediately and rejects old in-flight feed',async()=>{
 const {w,q,hold,poll}=setup();await tick();let resolve;
 hold(new Promise(r=>resolve=r));poll();
 w.EccoAuth.user={id:'bob'};w.sessionStorage.setItem('ecco-user-session','bob-session');hold(null);w.document.dispatchEvent(new w.Event('ecco:auth-change'));assert.equal(q('.notification-count').hidden,true);await tick();
 assert(q('[data-notification-id="private"]'));resolve({ok:true,json:async()=>({notificationVersion:1,notifications:[notice('alice-secret')]})});await tick();assert.equal(q('[data-notification-id="alice-secret"]'),null);
 w.EccoAuth.user=null;w.document.dispatchEvent(new w.Event('ecco:auth-change'));assert.equal(q('.notification-item'),null);assert.equal(q('.notification-count').hidden,true);w.close();
});
test('expiration hides an unread notice without a network poll',async()=>{
 const {w,q,state,poll}=setup();await tick();state.alice=[notice('expiring',{severity:'warning',expiresAt:new Date(Date.now()+70).toISOString()})];poll();await tick();assert(q('[data-notification-id="expiring"]'));await new Promise(r=>setTimeout(r,85));assert.equal(q('.notification-item'),null);assert.equal(q('.notification-count').hidden,true);w.close();
});
test('older service response cannot masquerade as notifications; five-row bound retained',async()=>{
 const {w,q,state,poll,hold}=setup();await tick();state.alice=Array.from({length:6},(_,i)=>notice(String(i)));poll();await tick();assert.equal(w.document.querySelectorAll('.notification-item').length,5);
 hold(Promise.resolve({ok:true,json:async()=>({tickets:[]})}));poll();await tick();assert.match(q('[role="status"]').textContent,/not available yet/);w.close();
});

test('special offer snapshot follows the same read and expiry lifecycle as the bell',async()=>{
 const {w,state,q,poll}=setup();await tick();let changes=0;w.document.addEventListener('ecco:notifications-change',()=>changes++);
 state.alice=[notice('offer',{kind:'special_offer',offer:{credits:100,bonusCredits:50,cents:1000}})];await w.EccoNotifications.refresh();
 const snapshot=w.EccoNotifications.snapshot();assert.equal(snapshot.notifications[0].offer.bonusCredits,50);snapshot.notifications[0].offer.credits=999;assert.equal(w.EccoNotifications.snapshot().notifications[0].offer.credits,100);
 q('[data-notification-id="offer"]').click();await tick();assert.equal(w.EccoNotifications.snapshot().notifications.length,0);assert(changes>1);w.close();
});

 test('read history has three regular-weight non-actionable entries, numbering and expiry',async()=>{
 const {w,q,state,history,poll,calls}=setup();await tick();
 assert.equal(q('[data-read="false"] .notification-title').textContent,'1. Notice one');
 history.alice=Array.from({length:4},(_,i)=>notice('old'+i));poll();await tick();
 assert.equal(w.document.querySelectorAll('[data-read="true"]').length,3);
 assert.equal(q('[data-read="true"]').tagName,'ARTICLE');const before=calls.length;q('[data-read="true"]').click();assert.equal(calls.length,before);
 state.alice=[];history.alice=[notice('old-expiry',{expiresAt:new Date(Date.now()+70).toISOString()})];poll();await tick();
 assert.equal(q('[role="status"]').textContent,'No New notifications');assert(q('[data-notification-id="old-expiry"]'));
 await new Promise(r=>setTimeout(r,85));assert.equal(q('[data-read="true"]'),null);assert.equal(q('[data-notification-history]').hidden,true);
 w.close();
 });
