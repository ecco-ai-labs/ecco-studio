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
 function userIcon(){const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.classList.add('user-login-icon');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.8');icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');icon.innerHTML='<circle cx="12" cy="12" r="10"/><g class="user-person" stroke="none"><circle cx="12" cy="9" r="3.5"/><path d="M5 19a7 6 0 0 1 14 0 10 10 0 0 1-14 0Z"/></g>';return icon;}
 function mount(){
  const entryButton=q('#entry-tell-story');if(entryButton){entryButton.disabled=!user;entryButton.setAttribute('aria-disabled',String(!user));}
  const connections=q('#connection-indicators');
  let identity=q('#google-user-menu');
  let signedOut=q('#google-signedout-user');
  if(!user&&connections){
   if(!signedOut){signedOut=document.createElement('div');signedOut.id='google-signedout-user';const label=document.createElement('span');label.textContent='Not Logged in';signedOut.append(userIcon(),label);}
   const menus=q('#workspace-menus');if(menus&&menus.lastElementChild!==signedOut)menus.append(signedOut);
  }else signedOut?.remove();
  if(user&&connections){
   if(!identity){
    identity=document.createElement('details');identity.id='google-user-menu';identity.className='workspace-menu';
    const name=document.createElement('summary');name.id='google-user-name';
    const icon=userIcon();
    const label=document.createElement('span');label.dataset.userLabel='';const arrow=document.createElement('span');arrow.textContent='⌄';arrow.setAttribute('aria-hidden','true');name.append(icon,label,arrow);
    const items=document.createElement('div');items.className='workspace-menu-items';
    const logout=document.createElement('button');logout.type='button';logout.textContent='Log Off';logout.onclick=signOut;
    const credits=document.createElement('button');credits.type='button';credits.textContent='Credit and Usage';credits.dataset.userFlyout='usage';credits.setAttribute('aria-controls','workspace-usage-drawer');credits.setAttribute('aria-expanded','false');credits.onclick=()=>window.EccoCredits?.open('usage',credits);credits.addEventListener('pointerenter',()=>window.EccoCredits?.open('usage',credits));
    const billing=document.createElement('button');billing.type='button';billing.textContent='Billing';billing.dataset.userFlyout='billing';billing.setAttribute('aria-controls','workspace-billing-drawer');billing.setAttribute('aria-expanded','false');billing.onclick=()=>window.EccoBilling?.open(billing);billing.addEventListener('pointerenter',()=>window.EccoBilling?.open(billing));
    for(const trigger of [credits,billing])trigger.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'){event.preventDefault();trigger.click();document.getElementById(trigger.getAttribute('aria-controls'))?.querySelector('button')?.focus();}});
    items.append(credits,billing,logout);identity.append(name,items);
   }
   const name=user.name||user.email;
   const label=identity.querySelector('[data-user-label]');if(label.textContent!==name)label.textContent=name;
   const menus=q('#workspace-menus');if(menus&&menus.lastElementChild!==identity)menus.append(identity);
  }else if(identity)identity.remove();
  for(const parent of [q('#workspace-entry'),q('[data-category="Account"] .workspace-menu-items')].filter(Boolean)){
   let box=parent.querySelector('[data-google-account]');
   if(parent.id!=='workspace-entry'&&!user){box?.remove();continue;}
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
 const style=document.createElement('style');style.textContent='#google-signedout-user{display:flex;align-items:center;gap:10px;box-sizing:border-box;width:max-content;height:36px;padding:6px 10px;font-size:12px;line-height:18px;font-weight:500;white-space:nowrap;color:var(--ecco-theme-text,var(--text,#eeebf5))}#google-user-menu{position:relative}#google-user-menu>summary{list-style:none}#google-user-menu>summary::-webkit-details-marker{display:none}#google-user-menu>.workspace-menu-items{left:auto;right:0;min-width:190px}#google-user-name{color:var(--text);font-size:13px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}#workspace-entry #entry-tell-story{box-sizing:border-box;width:190px;min-width:190px;height:40px;min-height:40px;padding:0 12px}#workspace-entry #entry-tell-story:disabled{opacity:.5;cursor:not-allowed;box-shadow:none}#workspace-entry>[data-google-account]{margin-top:16px}#workspace-entry>[data-google-account] iframe{clip-path:inset(2px 10px round 4px)}[data-google-account]{display:flex;flex-direction:column;align-items:center;gap:8px;font-family:Google Sans,Arial,sans-serif;font-size:14px}[data-google-account] .signin-error{color:var(--error,#ff7373)}#workspace-menus>.workspace-menu>summary{box-sizing:border-box;width:max-content;height:36px;padding:6px 10px;font-size:12px;gap:8px;justify-content:flex-start}#google-user-name{max-width:220px}:is(#google-user-name,#google-signedout-user) .user-login-icon{flex:0 0 auto;color:var(--ecco-theme-text,var(--text,#eeebf5))}:is(#google-user-name,#google-signedout-user) .user-person{fill:var(--ecco-theme-accent,var(--accent,#ffdc24))}#google-user-name [data-user-label]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}#google-user-menu>.workspace-menu-items>button{box-sizing:border-box;width:100%;height:40px;min-height:40px;padding:8px 12px!important;font-size:13px!important}';document.head.append(style);
 let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;mount();});}).observe(document.body,{childList:true,subtree:true});mount();restore();
 document.addEventListener('click',event=>{const menu=q('#google-user-menu');if(menu?.open&&!menu.contains(event.target))menu.open=false;});
 document.addEventListener('keydown',event=>{const menu=q('#google-user-menu');if(event.key==='Escape'&&menu?.open){menu.open=false;menu.querySelector('summary').focus();}});
 window.EccoAuth={open,signOut,get user(){return user;}};
})();
