'use strict';
/* Google identity never substitutes for workspace authorization. */
(()=>{
 const CLIENT_ID='219292517219-tngp5k9kso8jvk4ps6oqee45l0j97p78.apps.googleusercontent.com';
 const endpoint='https://vowmjru85f2gzo-8888.proxy.runpod.net/api/auth/';
 let user=null,token=sessionStorage.getItem('ecco-user-session')||'',expires=0,library=null,expiryTimer=null;
 let ready=false,busy=false,error='',preparing=null,renewTimer=null;
 const q=s=>document.querySelector(s);
 async function request(path,body){
  const response=await fetch(endpoint+path,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Google sign-in service is unavailable.');
  const result=await response.json();
  if(!response.ok)throw Error(path==='config'?'Google sign-in service is not enabled yet.':result.error||'Google sign-in failed.');
  return result;
 }
 function loadGoogle(){
  if(window.google?.accounts?.id)return Promise.resolve();
  if(library)return library;
  library=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
   const timeout=setTimeout(()=>{script.remove();library=null;reject(Error('Google sign-in could not load. Please try again.'));},15000);
   script.onload=()=>{clearTimeout(timeout);resolve();};script.onerror=()=>{clearTimeout(timeout);script.remove();library=null;reject(Error('Google sign-in could not load. Please try again.'));};document.head.append(script);
  });return library;
 }
 function changed(){mount();document.dispatchEvent(new CustomEvent('ecco:auth-change',{detail:{user}}));}
 async function signOut(){
  try{if(token)await request('logout',{});}catch{}
  user=null;token='';expires=0;sessionStorage.removeItem('ecco-user-session');clearTimeout(expiryTimer);window.google?.accounts?.id.disableAutoSelect();
  window.EccoCredits?.disconnect();sessionStorage.removeItem('ecco-storage-access');
  // Reload also removes in-memory workspace credentials and rendered shared data.
  location.reload();
 }
 async function prepare(){
  if(preparing)return preparing;
  preparing=(async()=>{
   ready=false;error='';mount();
   try{
    const config=await request('config');if(config.client_id!==CLIENT_ID)throw Error('Google sign-in configuration does not match.');
    await loadGoogle();const pending=await request('challenge',{});
    window.google.accounts.id.initialize({client_id:CLIENT_ID,nonce:pending.nonce,auto_select:false,callback:async result=>{
     if(busy)return;busy=true;error='';mount();
     try{
      const verified=await request('google',{credential:result.credential,challenge:pending.challenge});
      if(!verified.user?.id||!verified.session_token||!Number.isFinite(verified.expires_at))throw Error('Invalid sign-in response.');
      user=verified.user;token=verified.session_token;expires=verified.expires_at;sessionStorage.setItem('ecco-user-session',token);
      clearTimeout(renewTimer);clearTimeout(expiryTimer);expiryTimer=setTimeout(signOut,Math.max(0,expires*1000-Date.now()));changed();
     }catch(e){ready=false;error=e.message;}
     finally{busy=false;mount();}
    }});
    ready=true;
    clearTimeout(renewTimer);renewTimer=setTimeout(()=>{if(!user&&!busy)prepare();},240000);
   }catch(e){error=e.message;}
   finally{preparing=null;mount();}
  })();return preparing;
 }
 async function restore(){
  if(token){
   try{
    const verified=await request('me');
    if(!verified.user?.id||!Number.isFinite(verified.expires_at)||verified.expires_at*1000<=Date.now())throw Error('Session expired');
    user=verified.user;expires=verified.expires_at;
    expiryTimer=setTimeout(signOut,Math.max(0,expires*1000-Date.now()));changed();return;
   }catch{token='';sessionStorage.removeItem('ecco-user-session');}
  }
  return prepare();
 }
 function open(){return user?Promise.resolve():prepare();}
 function mount(){
  const connections=q('#connection-indicators');
  let identity=q('#google-user-menu');
  if(user&&connections){
   if(!identity){
    identity=document.createElement('details');identity.id='google-user-menu';identity.className='workspace-menu';
    const name=document.createElement('summary');name.id='google-user-name';
    const items=document.createElement('div');items.className='workspace-menu-items';
    const logout=document.createElement('button');logout.type='button';logout.textContent='Log off';logout.onclick=signOut;
    items.append(logout);identity.append(name,items);
   }
   const name=user.name||user.email;
   if(identity.firstElementChild.textContent!==name)identity.firstElementChild.textContent=name;
   if(connections.nextElementSibling!==identity)connections.after(identity);
  }else if(identity)identity.remove();
  for(const parent of [q('#workspace-entry'),q('[data-category="Account"] .workspace-menu-items')].filter(Boolean)){
   let box=parent.querySelector('[data-google-account]');
   if(!box){box=document.createElement('div');box.dataset.googleAccount='';if(parent.id==='workspace-entry')parent.insertBefore(box,parent.querySelector('.entry-copyright'));else parent.prepend(box);}
   const mode=user?'user:'+user.id:busy?'busy':error?'error:'+error:ready?'ready':'loading';
   if(box.dataset.mode===mode)continue;
   box.dataset.mode=mode;box.replaceChildren();
   if(user){
    if(parent.id==='workspace-entry'){
     const label=document.createElement('span');label.textContent='Signed in as '+(user.name||user.email);box.append(label);
    }else{
     const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Log off';button.onclick=signOut;box.append(button);
    }
   }else if(ready&&!busy&&!error){
    window.google.accounts.id.renderButton(box,{type:'standard',theme:'outline',size:'large',width:190,text:'signin_with',shape:'rectangular'});
   }else{
    const message=document.createElement('span');message.setAttribute('role','status');message.textContent=error||(busy?'Signing in…':'Loading Google sign-in…');if(error)message.className='signin-error';box.append(message);
    if(error){const retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='Try again';retry.onclick=prepare;box.append(retry);}
   }
  }
 }
 const style=document.createElement('style');style.textContent='#google-user-menu{position:relative}#google-user-menu>summary{list-style:none}#google-user-menu>summary::-webkit-details-marker{display:none}#google-user-menu>.workspace-menu-items{left:0;right:auto;min-width:110px}#google-user-name{color:var(--text);font-size:13px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}#workspace-entry #entry-tell-story{box-sizing:border-box;width:190px;min-width:190px;height:40px;min-height:40px;padding:0 12px}#workspace-entry>[data-google-account]{margin-top:16px}#workspace-entry>[data-google-account] iframe{clip-path:inset(2px 10px round 4px)}[data-google-account]{display:flex;flex-direction:column;align-items:center;gap:8px;font-family:Google Sans,Arial,sans-serif;font-size:14px}[data-google-account] .signin-error{color:var(--error,#ff7373)}';document.head.append(style);
 let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;mount();});}).observe(document.body,{childList:true,subtree:true});mount();restore();
 document.addEventListener('click',event=>{const menu=q('#google-user-menu');if(menu?.open&&!menu.contains(event.target))menu.open=false;});
 document.addEventListener('keydown',event=>{const menu=q('#google-user-menu');if(event.key==='Escape'&&menu?.open){menu.open=false;menu.querySelector('summary').focus();}});
 window.EccoAuth={open,signOut,get user(){return user;}};
})();
