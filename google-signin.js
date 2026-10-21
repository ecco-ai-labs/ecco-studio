'use strict';
/* Google identity never substitutes for workspace authorization. */
(()=>{
 const CLIENT_ID='219292517219-tngp5k9kso8jvk4ps6oqee45l0j97p78.apps.googleusercontent.com';
 const endpoint='https://vowmjru85f2gzo-8888.proxy.runpod.net/api/auth/';
 let user=null,token='',expires=0,dialog=null,library=null,expiryTimer=null;
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
  user=null;token='';expires=0;clearTimeout(expiryTimer);window.google?.accounts?.id.disableAutoSelect();
  window.EccoCredits?.disconnect();sessionStorage.removeItem('ecco-storage-access');
  // Reload also removes in-memory workspace credentials and rendered shared data.
  location.reload();
 }
 async function open(){
  if(dialog?.open)return;
  const d=document.createElement('dialog');dialog=d;d.className='generation-dialog google-signin-dialog';
  const head=document.createElement('div');head.className='section-head';const title=document.createElement('h2');title.textContent='Login with Google';
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Close popup');close.onclick=()=>d.close();head.append(title,close);
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Loading…';
  const host=document.createElement('div');host.className='google-signin-button';
  const retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='Try again';retry.hidden=true;
  d.append(head,status,host,retry);document.body.append(d);d.showModal();d.addEventListener('close',()=>{d.remove();if(dialog===d)dialog=null;},{once:true});
  async function prepare(){
   retry.hidden=true;host.replaceChildren();status.className='';status.textContent='Loading…';
   try{
    const config=await request('config');if(config.client_id!==CLIENT_ID)throw Error('Google sign-in configuration does not match.');
    await loadGoogle();const pending=await request('challenge',{});if(!d.open)return;
    window.google.accounts.id.initialize({client_id:CLIENT_ID,nonce:pending.nonce,auto_select:false,callback:async result=>{
     if(!d.open)return;host.hidden=true;status.textContent='Signing in…';
     try{
      const verified=await request('google',{credential:result.credential,challenge:pending.challenge});
      // Only server-verified identity can change signed-in UI state.
      if(!verified.user?.id||!verified.session_token||!Number.isFinite(verified.expires_at))throw Error('Invalid sign-in response.');
      user=verified.user;token=verified.session_token;expires=verified.expires_at;
      clearTimeout(expiryTimer);expiryTimer=setTimeout(signOut,Math.max(0,expires*1000-Date.now()));
      changed();d.close();
     }catch(error){status.textContent=error.message;status.className='signin-error';retry.hidden=false;host.hidden=false;host.replaceChildren();}
    }});
    status.textContent='';host.hidden=false;window.google.accounts.id.renderButton(host,{type:'standard',theme:'outline',size:'large',text:'signin_with',shape:'rectangular'});
   }catch(error){if(d.open){status.textContent=error.message;status.className='signin-error';retry.hidden=false;}}
  }
  retry.onclick=prepare;await prepare();
 }
 function mount(){
  for(const parent of [q('#workspace-entry'),q('[data-category="Account"] .workspace-menu-items')].filter(Boolean)){
   let button=parent.querySelector('[data-google-account]');
   if(!button){button=document.createElement('button');button.type='button';button.className='secondary';button.dataset.googleAccount='';if(parent.id==='workspace-entry'){const footer=parent.querySelector('.entry-copyright');parent.insertBefore(button,footer);}else parent.prepend(button);}
   const text=user?'Sign out · '+(user.name||user.email):'Login with Google';
   if(button.dataset.accountLabel!==text){
    button.dataset.accountLabel=text;button.replaceChildren();
    if(!user){const logo=document.createElement('img');logo.src='google-logo.png';logo.alt='';logo.width=18;logo.height=18;logo.className='google-brand-logo';button.append(logo);}
    const label=document.createElement('span');label.textContent=text;button.append(label);
    button.setAttribute('aria-label',text);
   }
   button.onclick=user?signOut:open;
  }
 }
 const style=document.createElement('style');style.textContent='[data-google-account]{display:inline-flex;align-items:center;justify-content:center;gap:10px}[data-google-account] .google-brand-logo{width:18px;height:18px;object-fit:contain;background:#fff;box-sizing:content-box;padding:2px;border-radius:2px;flex:none}.google-signin-dialog{color:var(--text);background:var(--panel);width:min(400px,calc(100vw - 32px))}.google-signin-dialog .google-signin-button{display:flex;justify-content:center;margin:16px 0}.google-signin-dialog .signin-error{color:var(--error,#ff7373)}.google-signin-dialog>.section-head>button{width:26px;height:26px;padding:0;background:#ffdc24;color:#211b33;font-size:20px}';document.head.append(style);
 let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;mount();});}).observe(document.body,{childList:true,subtree:true});mount();
 window.EccoAuth={open,signOut,get user(){return user;}};
})();
