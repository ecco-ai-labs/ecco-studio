const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),fs=require('node:fs');
test('unread count, read persistence, account isolation, dismissal and safe text',async()=>{
 const d=new JSDOM('<div id="workspace-community-controls"></div><button id="outside">Outside</button>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only',pretendToBeVisual:true}),w=d.window;
 w.EccoAuth={user:{sub:'alice'}};w.setInterval=()=>0;w.fetch=async()=>({ok:true,json:async()=>[{id:'one',title:'Feature one',body:'<img src=x onerror=alert(1)>'},{id:'two',title:'Feature two',body:'Second'}]});
 w.eval(fs.readFileSync('studio-notifications.js','utf8'));await new Promise(r=>setTimeout(r,10));const q=s=>w.document.querySelector(s),bell=q('#notification-bell');
 assert.equal(q('.notification-count').textContent,'2');bell.click();assert.equal(q('#notification-list').hidden,false);assert.equal(q('.notification-count').textContent,'2');assert.equal(q('#notification-list img'),null);
 bell.focus();bell.blur();bell.dispatchEvent(new w.FocusEvent('focusout',{bubbles:true,relatedTarget:q('#outside')}));await Promise.resolve();assert.equal(q('#notification-list').hidden,false);q('.notification-item[data-read="false"]').querySelector('.notification-title').click();assert.equal(q('.notification-count').textContent,'1');assert.equal(q('#notification-list').hidden,false);assert.equal(q('.notification-item').dataset.read,'true');assert.equal(q('.notification-item').textContent.includes('Feature one'),true);assert.equal(q('.notification-read'),null);assert.ok(JSON.parse(w.localStorage.getItem('ecco-notifications-read:v1:alice')).one>0);
 q('.notification-item[data-read="false"]').click();assert.equal(q('.notification-count').hidden,true);assert.equal(w.document.querySelectorAll('.notification-item[data-read="true"]').length,2);
 const now=w.Date.now();w.Date.now=()=>now+7*24*60*60*1000;bell.click();bell.click();assert.equal(w.document.querySelectorAll('.notification-item').length,0);assert.equal(q('.notification-count').hidden,true);
 w.EccoAuth.user={sub:'bob'};w.document.dispatchEvent(new w.Event('ecco:auth-change'));assert.equal(q('.notification-count').textContent,'2');assert.equal(q('#notification-list').hidden,true);
 bell.click();w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(q('#notification-list').hidden,true);assert.equal(w.document.activeElement,bell);
 bell.click();q('#outside').dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(q('#notification-list').hidden,true);
 w.EccoAuth.user={sub:'alice'};w.document.dispatchEvent(new w.Event('ecco:auth-change'));assert.equal(q('.notification-count').hidden,true);d.window.close();
});

test('keeps only five newest notices and counts only their unread entries',async()=>{
 const d=new JSDOM('<div id="workspace-community-controls"></div>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only'}),w=d.window;
 w.setInterval=()=>0;w.fetch=async()=>({ok:true,json:async()=>Array.from({length:6},(_,i)=>({id:String(6-i),title:'Notice '+(6-i),body:'Body'}))});
 w.eval(fs.readFileSync('studio-notifications.js','utf8'));await new Promise(r=>setTimeout(r,10));
 assert.equal(w.document.querySelectorAll('.notification-item').length,5);assert.equal(w.document.querySelector('.notification-count').textContent,'5');assert.equal(w.document.querySelector('[data-notification-id="1"]'),null);assert.equal(w.document.querySelector('.notification-title').textContent,'Notice 6');w.close();
});
