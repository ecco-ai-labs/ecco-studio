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
  const team=document.createElement('a');team.href=new URL('desk/',base).href;team.textContent='Team workspace ↗';team.className='help';
  bar.append(back,team);root.append(bar);
  host=document.createElement('section');host.id='ecco-desk-support';host.setAttribute('aria-label','Ecco Desk customer support');root.append(host);
  const target=host;target.textContent='Opening support…';
  try{loading=loading||import(new URL('desk/desk-app.mjs?v=20261024-2',base).href);const app=await loading;if(target!==host||!target.isConnected)return;target.replaceChildren();unmount=app.mount(target,{embedded:true,portalOnly:true,onSignIn:signIn});}
  catch{loading=null;if(target===host){target.replaceChildren();const message=document.createElement('p');message.textContent='Support could not load. Please try again.';const retry=document.createElement('button');retry.textContent='Try again';retry.onclick=()=>{clear();support()};target.append(message,retry);}}
 }
 const previousNavigate=navigate;navigate=function(p,...args){if(p==='support')return support();clear();document.title='Ecco AI Labs Studios';return previousNavigate.call(this,p,...args)};
 const controls=q('#workspace-community-controls');
 if(controls){const button=document.createElement('button');button.id='workspace-support';button.type='button';button.className='secondary asset-icon';button.title='Support';button.setAttribute('aria-label','Support');button.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="fill:none!important" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9" style="fill:none!important"/><path style="fill:none!important" d="M9.5 8.5a2.6 2.6 0 0 1 5 1c0 1.7-2.5 2-2.5 4M12 16v1"/></svg>';button.onclick=()=>navigate('support');controls.append(button);controls.setAttribute('aria-label','Community, support and source code');}
 const style=document.createElement('style');style.textContent='.desk-studio-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.desk-studio-toolbar a{color:var(--ecco-theme-text,var(--text))}#ecco-desk-support{display:block;min-width:0}#workspace-support svg{width:16px;height:16px}';document.head.append(style);
 function afterLogin(){if(!window.EccoAuth?.user||!intent)return;const action=intent;intent=null;if(params.has('desk')){const url=new URL(location.href);url.searchParams.delete('desk');history.replaceState(null,'',url);}if(action==='team')location.assign(new URL('desk/',base).href);else support();}
 document.addEventListener('ecco:auth-change',afterLogin);
 if(intent==='support')support();else if(intent==='team'&&!window.EccoAuth?.user){navigate('welcome');window.EccoAuth?.open();}
 afterLogin();
 window.EccoDesk={open:support};
})();
