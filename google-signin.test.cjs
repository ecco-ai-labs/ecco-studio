const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const CLIENT='219292517219-tngp5k9kso8jvk4ps6oqee45l0j97p78.apps.googleusercontent.com';
test('generic direct Google button, verified name menu and logout',async()=>{
 const dom=new JSDOM('<body><main><header><div id="connection-indicators"></div><div id="workspace-menus"><div data-category="Account"><div class="workspace-menu-items"></div></div><details id="education-menu"></details></div></header></main><section id="workspace-entry"><button id="entry-tell-story" disabled>Tell Your Story</button><p class="entry-copyright"></p></section></body>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only'});
 const w=dom.window;let callback;const renderOptions=[];const requests=[];
 w.AbortSignal={timeout:()=>undefined};
 w.google={accounts:{id:{initialize:config=>{callback=config.callback;},renderButton:(host,config)=>{renderOptions.push(config);const b=w.document.createElement('button');b.textContent='Sign in with Google';host.append(b);},disableAutoSelect:()=>{}}}};
 w.fetch=async(url,options)=>{requests.push({url,options});const path=url.split('/').pop();const result=path==='config'?{client_id:CLIENT}:path==='challenge'?{challenge:'fixture',nonce:'fixture-nonce'}:path==='google'?{user:{id:'google:123',name:'Test User',email:'fixture@example.com'},session_token:'test-session',expires_at:Date.now()/1000+3600}:{ok:true};return{ok:true,headers:{get:()=> 'application/json'},json:async()=>result};};
 try{
  w.__observers=[];const Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(callback){super(callback);w.__observers.push(this);}};w.eval(fs.readFileSync('google-signin.js','utf8'));await new Promise(r=>setTimeout(r,20));
  assert.equal(w.document.querySelector('#entry-tell-story').disabled,true);
  assert.equal(w.document.querySelectorAll('dialog').length,0);
  assert.equal(w.document.querySelector('#workspace-entry [data-google-account]').textContent,'Sign in with Google');
  assert.ok(renderOptions.every(x=>x.width<200&&x.text==='signin_with'));
  assert.equal(w.document.querySelector('#google-user-menu'),null);
  assert.equal(w.document.querySelector('[data-category="Account"] [data-google-account]'),null);
  await callback({credential:'fixture-credential'});
  assert.equal(w.document.querySelector('#entry-tell-story').disabled,false);
  assert.equal(w.sessionStorage.getItem('ecco-user-session'),'test-session');assert.equal(w.localStorage.getItem('ecco-user-session'),'test-session');
  assert.equal(w.document.querySelector('#workspace-entry [data-google-account]').textContent,'Signed in as Test User');
  const menu=w.document.querySelector('#google-user-menu');assert.equal(w.document.querySelector('#education-menu').nextElementSibling,menu);
  assert.equal(menu.querySelector('[data-user-label]').textContent,'Test User');
  assert.deepEqual([...menu.querySelectorAll('button')].map(b=>b.textContent),['Credit and Usage','Billing','Log Off']);
  menu.open=true;w.document.body.click();assert.equal(menu.open,false);
  menu.open=true;w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(menu.open,false);
  w.sessionStorage.setItem('ecco-storage-access','fixture-key');
  await w.EccoAuth.signOut();
  assert.equal(w.sessionStorage.getItem('ecco-user-session'),null);assert.equal(w.EccoAuth.user,null);assert.equal(w.sessionStorage.getItem('ecco-storage-access'),'fixture-key');
  assert.ok(requests.some(x=>x.url.endsWith('/logout')&&x.options.headers.Authorization==='Bearer test-session'));
 }finally{for(const observer of w.__observers||[])observer.disconnect();await Promise.resolve();w.close();}
});
test('reload restores identity only from server-verified session',async()=>{
 for(const valid of [true,false]){
  const dom=new JSDOM('<body><main><header><div id="connection-indicators"></div><div id="workspace-menus"><details id="education-menu"></details></div></header></main><section id="workspace-entry"><button id="entry-tell-story" disabled>Tell Your Story</button><p class="entry-copyright"></p></section></body>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only'});
  const w=dom.window;w.localStorage.setItem('ecco-user-session','existing-session');w.AbortSignal={timeout:()=>undefined};let verified=false;
  w.google={accounts:{id:{initialize:()=>{},renderButton:()=>{},disableAutoSelect:()=>{}}}};
  w.fetch=async(url,options)=>{const me=url.endsWith('/me');if(me){assert.equal(options.headers.Authorization,'Bearer existing-session');verified=true;}return{ok:!me||valid,status:me&&!valid?401:200,headers:{get:()=> 'application/json'},json:async()=>me?(valid?{user:{id:'google:123',name:'Restored User'},expires_at:Date.now()/1000+1000}:{error:'expired'}):url.endsWith('/config')?{client_id:CLIENT}:{challenge:'fixture',nonce:'nonce'}};};
  try{w.__observers=[];const Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(callback){super(callback);w.__observers.push(this);}};w.eval(fs.readFileSync('google-signin.js','utf8'));await new Promise(r=>setTimeout(r,20));assert.ok(verified);assert.equal(w.document.querySelector('#entry-tell-story').disabled,!valid);assert.equal(w.document.querySelector('#google-user-name [data-user-label]')?.textContent,valid?'Restored User':undefined);assert.equal(w.sessionStorage.getItem('ecco-user-session'),valid?'existing-session':null);}finally{for(const observer of w.__observers||[])observer.disconnect();await Promise.resolve();w.close();}
 }
});
test('transient outage retains sign-in and independent connections; explicit disconnect needs confirmed revocation',async()=>{
 const dom=new JSDOM('<body><div id="workspace-entry"></div></body>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only'});
 const w=dom.window;w.AbortSignal={timeout:()=>undefined};w.localStorage.setItem('ecco-user-session','retained');w.localStorage.setItem('ecco-storage-access','storage');w.localStorage.setItem('ecco-connected-gpus','["gpu"]');
 w.fetch=async()=>{throw Error('Network unavailable');};
 try{
  w.eval(fs.readFileSync('google-signin.js','utf8'));await new Promise(r=>setTimeout(r,20));
  assert.equal(w.EccoAuth.connected,true);assert.equal(w.localStorage.getItem('ecco-user-session'),'retained');
  await assert.rejects(w.EccoAuth.signOut(),/Network unavailable/);
  assert.equal(w.EccoAuth.connected,true);
  assert.equal(w.localStorage.getItem('ecco-storage-access'),'storage');assert.equal(w.localStorage.getItem('ecco-connected-gpus'),'["gpu"]');
 }finally{w.close();}
});
