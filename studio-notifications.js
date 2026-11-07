/* Authenticated in-app notices. Audience checks and read receipts live on the server. */
(()=>{
 const controls=document.querySelector('#workspace-community-controls');if(!controls)return;
 const host=document.createElement('div');host.id='studio-notifications';
 host.innerHTML='<button id="notification-bell" type="button" class="secondary asset-icon" aria-label="Notifications" aria-expanded="false" aria-controls="notification-list"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="notification-count" hidden aria-hidden="true"></span></button><section id="notification-list" aria-label="Notifications" hidden><strong>Notifications</strong><div data-notification-items></div><p data-notification-status role="status"></p></section>';
 controls.append(host);controls.setAttribute('aria-label','Community, support, source code and notifications');
 const bell=host.querySelector('button'),badge=host.querySelector('.notification-count'),panel=host.querySelector('section'),items=host.querySelector('[data-notification-items]'),status=host.querySelector('[data-notification-status]');
 const endpoint='https://vowmjru85f2gzo-8888.proxy.runpod.net/api/desk/support';
 let feed=[],failed='',loading=false,revision=0,expiryTimer=0;const pending=new Set();
 function identity(){const u=window.EccoAuth?.user;return u&&(u.id||u.sub||u.email)||'';}
 function token(){return identity()?sessionStorage.getItem('ecco-user-session')||'':'';}
 function context(){return identity()+'|'+token();}
 function close(){panel.hidden=true;bell.setAttribute('aria-expanded','false');}
 function active(){return feed.filter(n=>!n.expiresAt||Date.parse(n.expiresAt)>Date.now());}
 function accept(data){
  if(data.notificationVersion!==1||!Array.isArray(data.notifications))throw Error('User notifications are not available yet.');
  const ids=new Set();feed=data.notifications.filter(n=>{if(!n||typeof n.id!=='string'||typeof n.title!=='string'||typeof n.body!=='string'||!['informational','warning','error'].includes(n.severity)||ids.has(n.id)||n.expiresAt&&!Number.isFinite(Date.parse(n.expiresAt)))return false;ids.add(n.id);return true;}).slice(0,5);
 }
 function snapshot(){return {notifications:failed?[]:active().map(n=>({...n,offer:n.offer?{...n.offer}:null})),loading,error:failed};}
 window.EccoNotifications={snapshot,refresh:load};
 function render(){
  const visible=active(),count=visible.length,focused=document.activeElement?.dataset.notificationId;
  badge.hidden=!count;badge.textContent=String(count);bell.setAttribute('aria-label',count?`Notifications: ${count} unread`:'Notifications');bell.title=bell.getAttribute('aria-label');
  items.replaceChildren();status.textContent=failed||(!token()?'Sign in to see notifications.':loading&&!count?'Loading notifications…':!count?'No notifications':'');status.hidden=!status.textContent;
  for(const n of visible){
   const row=document.createElement('button'),title=document.createElement('span'),body=document.createElement('span'),meta=document.createElement('span');
   row.type='button';row.className='notification-item';row.dataset.notificationId=n.id;row.dataset.read='false';row.dataset.severity=n.severity;row.disabled=pending.has(n.id);row.setAttribute('aria-busy',String(pending.has(n.id)));
   title.className='notification-title';body.className='notification-body';meta.className='notification-meta';title.textContent=n.title;body.textContent=n.body;
   const level={informational:'Informational',warning:'Warning',error:'Error'}[n.severity];meta.textContent=level+(n.expiresAt?' · Expires '+new Date(n.expiresAt).toLocaleString():'');
   row.setAttribute('aria-label',`${level}: ${n.title} — Unread. Activate to mark as read.`);
   row.onclick=()=>markRead(n.id);row.append(title,body,meta);items.append(row);if(focused===n.id)row.focus();
  }
  document.dispatchEvent(new CustomEvent('ecco:notifications-change'));
  clearTimeout(expiryTimer);const deadlines=visible.filter(n=>n.expiresAt).map(n=>Date.parse(n.expiresAt));
  if(deadlines.length)expiryTimer=setTimeout(render,Math.min(2147483647,Math.max(1,Math.min(...deadlines)-Date.now()+1)));
 }
 async function api(payload){
  const session=token();if(!session)throw Error('Sign in to see notifications.');
  const response=await fetch(endpoint+(payload?'':'?userNotifications=1'),{method:payload?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+session,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'Could not load notifications.'),{status:response.status});return data;
 }
 async function load(){
  if(!token()||pending.size){render();return;}
  const scope=context(),seq=++revision;loading=true;
  try{const data=await api();if(scope!==context()||seq!==revision)return;accept(data);failed='';}
  catch(e){if(scope!==context()||seq!==revision)return;failed=e.message||'Could not load notifications.';if(e.status===401)feed=[];}
  finally{if(scope===context()&&seq===revision){loading=false;render();}}
 }
 async function markRead(id){
  if(pending.size||!active().some(n=>n.id===id))return;
  const scope=context(),seq=++revision;pending.add(id);failed='';render();
  try{const data=await api({op:'readNotification',id});if(scope!==context()||seq!==revision)return;accept(data);
   try{localStorage.setItem('ecco-notifications-sync:'+identity(),String(Date.now()));}catch{}
  }catch(e){if(scope===context()&&seq===revision)failed='Could not mark notification as read. Please try again.';}
  finally{if(scope===context()&&seq===revision){pending.delete(id);loading=false;render();if(!panel.hidden)(items.querySelector('button:not(:disabled)')||bell).focus();}}
 }
 bell.onclick=()=>{panel.hidden=!panel.hidden;bell.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){render();load();}};
 document.addEventListener('pointerdown',e=>{if(!host.contains(e.target))close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){close();bell.focus();e.stopPropagation();}});
 panel.addEventListener('pointerdown',e=>e.stopPropagation());panel.addEventListener('click',e=>e.stopPropagation());
 document.addEventListener('ecco:auth-change',()=>{revision++;feed=[];pending.clear();loading=false;failed='';close();render();load();});
 window.addEventListener('storage',e=>{if(e.key==='ecco-notifications-sync:'+identity())load();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();load();}});window.addEventListener('focus',load);
 render();load();setInterval(()=>{if(!document.hidden)load();},30000);
})();
