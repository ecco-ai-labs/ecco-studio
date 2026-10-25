/* Customer support stays inside Studio. Team view lives at the same host /desk/.
   This module never grants shared storage or GPU access from a Google identity. */
(()=>{
 const q=s=>document.querySelector(s);
 const base=new URL('.',document.currentScript.src);
 const params=new URL(location.href).searchParams;
 let unmount=null,host=null,loading=null;
 let intent=params.get('desk');
 function clear(){if(unmount)unmount();unmount=null;host=null;}
 function signIn(){intent='support';navigate('welcome');window.EccoAuth?.open();}
 async function support(){
  if(page==='support'&&host?.isConnected)return;
  window.EccoWorkspaceUI?.persistWorkingDraft();
  clear();page='support';document.body.classList.remove('workspace-entry-mode');
  document.title='Support · Ecco AI Labs Studio';q('#heading').textContent='Ecco Desk · Support';
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  const root=q('#page');root.replaceChildren();
  const bar=document.createElement('div');bar.className='desk-studio-toolbar';
  const back=document.createElement('button');back.type='button';back.className='secondary';back.textContent='← Back to Studio';back.onclick=()=>{clear();welcome()};
  bar.append(back);root.append(bar);
  host=document.createElement('section');host.id='ecco-desk-support';host.setAttribute('aria-label','Ecco Desk customer support');root.append(host);
  const target=host;target.textContent='Opening support…';
  try{loading=loading||import(new URL('desk/desk-app.mjs?v=20261025-native-support',base).href);const app=await loading;if(target!==host||!target.isConnected)return;target.replaceChildren();unmount=app.mount(target,{embedded:true,portalOnly:true,onSignIn:signIn});}
  catch{loading=null;if(target===host){target.replaceChildren();const message=document.createElement('p');message.textContent='Support could not load. Please try again.';const retry=document.createElement('button');retry.textContent='Try again';retry.onclick=()=>{clear();support()};target.append(message,retry);}}
 }
 const previousNavigate=navigate;navigate=function(p,...args){if(p==='support')return support();clear();document.title='Ecco AI Labs Studios';return previousNavigate.call(this,p,...args)};
 const controls=q('#workspace-community-controls');
 if(controls){const button=document.createElement('button');button.id='workspace-support';button.type='button';button.className='secondary asset-icon';button.title='Technical support';button.setAttribute('aria-label','Technical support');button.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/><path d="M21 16v2a4 4 0 0 1-4 4h-5"/></svg>';button.onclick=()=>navigate('support');controls.append(button);controls.setAttribute('aria-label','Community, support and source code');}
 const style=document.createElement('style');style.textContent='.desk-studio-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}#ecco-desk-support{display:block;min-width:0}#workspace-support{display:inline-flex;align-items:center;justify-content:center;margin:0!important;background:transparent!important;border:0!important;box-shadow:none!important;color:var(--ecco-theme-text,#fff)!important}#workspace-support:hover,#workspace-support:focus-visible{color:var(--ecco-theme-accent,#ffdc24)!important}#workspace-support:focus-visible{outline:2px solid var(--ecco-theme-accent,#ffdc24);outline-offset:2px}#workspace-support svg{width:16px!important;height:16px!important;flex:none}#workspace-support svg,#workspace-support svg *{fill:none!important;stroke:currentColor!important}';document.head.append(style);
 function afterLogin(){if(!window.EccoAuth?.user||!intent)return;const action=intent;intent=null;if(params.has('desk')){const url=new URL(location.href);url.searchParams.delete('desk');history.replaceState(null,'',url);}if(action==='team')location.assign(new URL('desk/',base).href);else support();}
 const supportButton=q('#workspace-support');
 if(supportButton){
  const badge=document.createElement('span');badge.className='desk-response-badge';badge.setAttribute('aria-hidden','true');badge.hidden=true;supportButton.append(badge);
  style.textContent+='#workspace-support{position:relative;overflow:visible}#workspace-support .desk-response-badge{position:absolute;top:1px;right:1px;display:flex;align-items:center;justify-content:center;min-width:12px;height:12px;box-sizing:border-box;padding:0 2px;border-radius:8px;background:var(--ecco-theme-error,#d93849);color:#fff;font:700 8px/1 sans-serif;box-shadow:0 0 0 2px var(--ecco-theme-surface,#1c1c35);z-index:1;pointer-events:none}#workspace-support .desk-response-badge[hidden]{display:none}';
  let notificationRequest=0;
  function showUnread(count){const n=Number.isSafeInteger(count)&&count>0?count:0;badge.hidden=!n;badge.textContent=n>9?'9+':String(n);const label=n?`Technical support — Support has responded on ${n} ticket${n===1?'':'s'}`:'Technical support';supportButton.title=label;supportButton.setAttribute('aria-label',label);}
  async function refreshUnread(){
   const request=++notificationRequest,token=sessionStorage.getItem('ecco-user-session');
   if(!token||!window.EccoAuth?.user){showUnread(0);return;}
   if(document.visibilityState==='hidden')return;
   try{const response=await fetch('https://vowmjru85f2gzo-8888.proxy.runpod.net/api/desk/support?notifications=1',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(10000)});const result=await response.json();if(request!==notificationRequest||token!==sessionStorage.getItem('ecco-user-session'))return;if(response.ok)showUnread(result.unreadTickets);else if(response.status===401)showUnread(0);}catch{/* Preserve confirmed unread state during transient connectivity loss. */}
  }
  document.addEventListener('ecco:auth-change',()=>{notificationRequest++;showUnread(0);refreshUnread()});
  document.addEventListener('ecco:desk-unread-change',refreshUnread);
  document.addEventListener('visibilitychange',refreshUnread);
  window.addEventListener('focus',refreshUnread);
  setInterval(refreshUnread,10000);refreshUnread();
 }
 document.addEventListener('ecco:auth-change',afterLogin);
 if(intent==='support')support();else if(intent==='team'&&!window.EccoAuth?.user){navigate('welcome');window.EccoAuth?.open();}
 afterLogin();
 window.EccoDesk={open:support};
})();
