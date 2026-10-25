const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),fs=require('node:fs');
test('unread count, read persistence, account isolation, dismissal and safe text',async()=>{
 const d=new JSDOM('<div id="workspace-community-controls"></div><button id="outside">Outside</button>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only',pretendToBeVisual:true}),w=d.window;
 w.EccoAuth={user:{sub:'alice'}};w.setInterval=()=>0;w.fetch=async()=>({ok:true,json:async()=>[{id:'one',title:'Feature one',body:'<img src=x onerror=alert(1)>'},{id:'two',title:'Feature two',body:'Second'}]});
 w.eval(fs.readFileSync('studio-notifications.js','utf8'));await new Promise(r=>setTimeout(r,10));const q=s=>w.document.querySelector(s),bell=q('#notification-bell');
 assert.equal(q('.notification-count').textContent,'2');bell.click();assert.equal(q('#notification-list').hidden,false);assert.equal(q('.notification-count').textContent,'2');assert.equal(q('#notification-list img'),null);
 q('.notification-item[data-read="false"]').click();assert.equal(q('.notification-count').textContent,'1');assert.equal(q('.notification-item').dataset.read,'true');assert.equal(q('.notification-item').textContent.includes('Feature one'),true);assert.equal(q('.notification-read'),null);assert.deepEqual(JSON.parse(w.localStorage.getItem('ecco-notifications-read:v1:alice')),['one']);
 q('.notification-item[data-read="false"]').click();assert.equal(q('.notification-count').hidden,true);assert.equal(w.document.querySelectorAll('.notification-item[data-read="true"]').length,2);
 w.EccoAuth.user={sub:'bob'};w.document.dispatchEvent(new w.Event('ecco:auth-change'));assert.equal(q('.notification-count').textContent,'2');assert.equal(q('#notification-list').hidden,true);
 bell.click();w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(q('#notification-list').hidden,true);assert.equal(w.document.activeElement,bell);
 bell.click();q('#outside').dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(q('#notification-list').hidden,true);
 w.EccoAuth.user={sub:'alice'};w.document.dispatchEvent(new w.Event('ecco:auth-change'));assert.equal(q('.notification-count').hidden,true);d.window.close();
});
