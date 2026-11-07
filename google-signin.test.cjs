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
  await new Promise(r=>setTimeout(r,0));
  assert.equal(w.document.body.classList.contains('workspace-entry-mode'),true);
  assert.equal(w.document.activeElement.id,'workspace-entry');
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
test('session heartbeats retain open work; an actual identity change still clears it',async()=>{
 const dom=new JSDOM('<body><div id="workspace-entry"></div><textarea id="draft">Unsent support reply</textarea></body>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only'});
 const w=dom.window;w.AbortSignal={timeout:()=>undefined};w.localStorage.setItem('ecco-user-session','retained');
 let identity='google:123',heartbeat,changes=0;
 w.__observers=[];const Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(callback){super(callback);w.__observers.push(this);}};
 w.setInterval=(fn,ms)=>{if(ms===60000)heartbeat=fn;return 1;};
 w.document.addEventListener('ecco:auth-change',()=>{changes++;w.document.querySelector('#draft').value='';});
 w.fetch=async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({user:{id:identity,name:'Verified user'}})});
 try{
  w.eval(fs.readFileSync('google-signin.js','utf8'));await new Promise(r=>setTimeout(r,20));
  assert.equal(changes,1);w.document.querySelector('#draft').value='Unsent support reply';
  heartbeat();await new Promise(r=>setTimeout(r,20));
  heartbeat();await new Promise(r=>setTimeout(r,20));
  assert.equal(changes,1);assert.equal(w.document.querySelector('#draft').value,'Unsent support reply');
  identity='google:456';heartbeat();await new Promise(r=>setTimeout(r,20));
  assert.equal(changes,2);assert.equal(w.document.querySelector('#draft').value,'');
 }finally{for(const observer of w.__observers)observer.disconnect();await Promise.resolve();w.close();}
});
test('transient outage retains sign-in; explicit sign-out clears identity and preserves independent connections',async()=>{
 const dom=new JSDOM('<body><div id="workspace-entry"></div></body>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only'});
 const w=dom.window;w.AbortSignal={timeout:()=>undefined};w.localStorage.setItem('ecco-user-session','retained');w.localStorage.setItem('ecco-storage-access','storage');w.localStorage.setItem('ecco-connected-gpus','["gpu"]');
 w.__observers=[];const Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(callback){super(callback);w.__observers.push(this);}};
 w.fetch=async()=>{throw Error('Network unavailable');};
 try{
  w.eval(fs.readFileSync('google-signin.js','utf8'));await new Promise(r=>setTimeout(r,20));
  assert.equal(w.EccoAuth.connected,true);assert.equal(w.localStorage.getItem('ecco-user-session'),'retained');
  await w.EccoAuth.signOut();await new Promise(r=>setTimeout(r,0));
  assert.equal(w.EccoAuth.connected,false);
  assert.equal(w.localStorage.getItem('ecco-user-session'),null);assert.equal(w.sessionStorage.getItem('ecco-user-session'),null);
  assert.match(w.document.querySelector('#workspace-entry').textContent,/Signed out on this browser/);
  assert.equal(w.localStorage.getItem('ecco-storage-access'),'storage');assert.equal(w.localStorage.getItem('ecco-connected-gpus'),'["gpu"]');
 }finally{for(const observer of w.__observers)observer.disconnect();await Promise.resolve();w.close();}
});

const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function authFixture(){
 const dom=new JSDOM('<body><div id="connection-indicators"></div><div id="workspace-menus"></div><section id="workspace-entry"><button id="entry-tell-story" disabled>Tell Your Story</button></section></body>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only'});
 const w=dom.window,logs=[],callbacks=[],requests=[];let handler;
 w.AbortSignal={timeout:()=>undefined};
 w.google={accounts:{id:{initialize:config=>callbacks.push(config.callback),renderButton:host=>{const button=w.document.createElement('button');button.textContent='Sign in with Google';host.append(button);},disableAutoSelect:()=>{}}}};
 w.EccoConnectivityLog={record:(event,details)=>logs.push({event,details})};
 const response=(body,status=200,type='application/json')=>({ok:status>=200&&status<300,status,headers:{get:()=>type},json:async()=>body});
 w.fetch=async(url,options)=>{const path=url.split('/').pop();requests.push({path,options});return handler?.(path,options)??response(path==='me'?{user:{id:'google:123',name:'Test User'}}:path==='config'?{client_id:CLIENT}:path==='challenge'?{challenge:'fixture',nonce:'nonce'}:{ok:true});};
 const observers=[];const Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(cb){super(cb);observers.push(this);}};
 return {w,logs,callbacks,requests,response,setHandler(fn){handler=fn;},async start(session='existing-session'){if(session)w.localStorage.setItem('ecco-user-session',session);w.eval(fs.readFileSync('google-signin.js','utf8'));await settle();},async close(){for(const observer of observers)observer.disconnect();await Promise.resolve();w.close();}};
}

test('sign-out clears the UI immediately during slow, failed and non-JSON logout responses',async()=>{
 for(const failure of ['pending','network','http','html']){
  const f=authFixture(),{w,response}=f;
  try{
   await f.start();let complete;
   f.setHandler(path=>{if(path!=='logout')return;if(failure==='pending')return new Promise(resolve=>complete=resolve);if(failure==='network')throw Error('offline');return failure==='html'?response({},503,'text/html'):response({error:'Sign-in service unavailable'},503);});
   await w.EccoAuth.signOut();await settle();
   assert.equal(w.EccoAuth.connected,false);assert.equal(w.EccoAuth.user,null);
   assert.equal(w.localStorage.getItem('ecco-user-session'),null);assert.equal(w.sessionStorage.getItem('ecco-user-session'),null);
   assert.equal(w.document.querySelector('#google-user-menu'),null);assert.equal(w.document.querySelector('#entry-tell-story').disabled,true);
   assert.equal(f.requests.find(x=>x.path==='logout').options.headers.Authorization,'Bearer existing-session');
   if(complete){complete(response({ok:true}));await settle();assert.ok(f.logs.some(x=>x.event==='Sign-in server revocation confirmed'));}
   else{assert.ok(f.logs.some(x=>x.details?.level==='error'));assert.match(w.document.querySelector('#workspace-entry').textContent,/Server sign-out could not be confirmed/);}
  }finally{await f.close();}
 }
});

test('late identity restore or Google verification cannot sign the user back in after sign-out',async()=>{
 for(const pending of ['me','google']){
  const f=authFixture(),{w,response}=f;let complete;
  try{
   f.setHandler(path=>path===pending?new Promise(resolve=>complete=resolve):undefined);
   await f.start(pending==='google'?'':'existing-session');
   const verification=pending==='google'?f.callbacks[0]({credential:'fixture'}):null;
   await w.EccoAuth.signOut();
   complete(response({user:{id:'google:123',name:'Late user'},session_token:'late-session'}));
   await verification;await settle();
   assert.equal(w.EccoAuth.connected,false);assert.equal(w.EccoAuth.user,null);assert.equal(w.localStorage.getItem('ecco-user-session'),null);
   assert.equal(w.document.querySelector('#entry-tell-story').disabled,true);
  }finally{await f.close();}
 }
});

test('cross-tab sign-out clears the tab session and ignores a late heartbeat',async()=>{
 const f=authFixture(),{w,response}=f;let complete;
 try{
  await f.start();f.setHandler(path=>path==='me'?new Promise(resolve=>complete=resolve):undefined);
  w.dispatchEvent(new w.Event('online'));
  w.localStorage.removeItem('ecco-user-session');
  w.dispatchEvent(new w.StorageEvent('storage',{key:'ecco-user-session',oldValue:'existing-session',newValue:null}));
  complete(response({user:{id:'google:123',name:'Late user'}}));await settle();
  assert.equal(w.EccoAuth.connected,false);assert.equal(w.EccoAuth.user,null);assert.equal(w.sessionStorage.getItem('ecco-user-session'),null);
  assert.equal(w.document.querySelector('#google-user-menu'),null);
 }finally{await f.close();}
});

test('a late failed revocation does not disturb a new sign-in',async()=>{
 const f=authFixture(),{w,response}=f;let fail;
 try{
  await f.start();f.setHandler(path=>path==='logout'?new Promise((resolve,reject)=>fail=reject):path==='google'?response({user:{id:'google:456',name:'New user'},session_token:'new-session'}):undefined);
  await w.EccoAuth.signOut();await settle();await f.callbacks.at(-1)({credential:'new-credential'});
  fail(Error('offline'));await settle();
  assert.equal(w.EccoAuth.user.id,'google:456');assert.equal(w.localStorage.getItem('ecco-user-session'),'new-session');
  assert.doesNotMatch(w.document.querySelector('#workspace-entry').textContent,/could not be confirmed/);
  assert.ok(f.logs.some(x=>x.event==='Sign-in server revocation unconfirmed'));
 }finally{await f.close();}
});
