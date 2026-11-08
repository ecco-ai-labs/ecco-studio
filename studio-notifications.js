/* Authenticated in-app notices. Audience checks and read receipts live on the server. */
(()=>{
 const controls=document.querySelector('#workspace-community-controls');if(!controls)return;
 const host=document.createElement('div');host.id='studio-notifications';
 host.innerHTML='<button id="notification-bell" type="button" class="secondary asset-icon" aria-label="Notifications" aria-expanded="false" aria-controls="notification-list"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="notification-count" hidden aria-hidden="true"></span></button><section id="notification-list" aria-label="Notifications" hidden><div class="notification-heading"><strong>Notifications</strong><div class="notification-window-controls"><button type="button" class="ecco-popup-minimize" aria-label="Minimize popup" title="Minimize"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg></button><button type="button" class="ecco-popup-close" aria-label="Close popup" title="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div><table class="notification-table" aria-label="New notifications"><thead><tr><th scope="col">Number</th><th scope="col">Notification</th><th scope="col">Date it expires</th></tr></thead><tbody data-notification-items></tbody></table><p data-notification-status role="status"></p><section data-notification-history hidden aria-labelledby="old-notification-heading"><h3 id="old-notification-heading">Old Notfication</h3><table class="notification-table" aria-label="Old notifications"><thead><tr><th scope="col">Number</th><th scope="col">Notification</th><th scope="col">Date it expires</th></tr></thead><tbody data-read-notification-items></tbody></table></section></section>';
 controls.append(host);controls.setAttribute('aria-label','Community, support, source code and notifications');
 const bell=host.querySelector('button'),badge=host.querySelector('.notification-count'),panel=host.querySelector('section'),items=host.querySelector('[data-notification-items]'),status=host.querySelector('[data-notification-status]'),history=host.querySelector('[data-notification-history]'),readItems=host.querySelector('[data-read-notification-items]');
 const endpoint='https://vowmjru85f2gzo-8888.proxy.runpod.net/api/desk/support';
 let feed=[],billingFeed=[],upcomingFeed=[],readFeed=[],failed='',loading=false,revision=0,expiryTimer=0;const pending=new Set();
 function identity(){const u=window.EccoAuth?.user;return u&&(u.id||u.sub||u.email)||'';}
 function token(){return identity()?sessionStorage.getItem('ecco-user-session')||'':'';}
 function context(){return identity()+'|'+token();}
 function hide(){panel.hidden=true;bell.setAttribute('aria-expanded','false');}
 function close(){popup.dismiss();hide();}
 function open(){panel.hidden=false;bell.setAttribute('aria-expanded','true');render();load();}
 const popup=window.EccoPopups.registerPanel(panel,{title:'Notifications',onMinimize:hide,onResume:open});
 panel.querySelector('.ecco-popup-close').onclick=()=>{close();bell.focus();};
 panel.querySelector('.ecco-popup-minimize').onclick=()=>popup.minimize();
 function active(source=feed){return source.filter(n=>!n.expiresAt||Date.parse(n.expiresAt)>Date.now());}
 function accept(data){
  if(data.notificationVersion!==1||!Array.isArray(data.notifications))throw Error('User notifications are not available yet.');
  const ids=new Set(),valid=n=>{if(!n||typeof n.id!=='string'||typeof n.title!=='string'||typeof n.body!=='string'||!['informational','warning','error'].includes(n.severity)||ids.has(n.id)||n.expiresAt&&!Number.isFinite(Date.parse(n.expiresAt)))return false;ids.add(n.id);return true;};
  feed=data.notifications.filter(valid).slice(0,5);
  ids.clear();billingFeed=(data.notificationPresentationVersion===1&&Array.isArray(data.billingNotifications)?data.billingNotifications:feed.filter(n=>n.kind==='special_offer'||n.kind==='marketing_campaign')).filter(valid).slice(0,5);
  ids.clear();upcomingFeed=data.upcomingCampaignVersion===1&&Array.isArray(data.upcomingCampaigns)?data.upcomingCampaigns.filter(n=>n?.status==='upcoming'&&Number.isFinite(Date.parse(n.startsAt))&&valid(n)).slice(0,5):[];
  ids.clear();feed.forEach(n=>ids.add(n.id));
  readFeed=data.notificationHistoryVersion===1&&Array.isArray(data.readNotifications)?data.readNotifications.filter(valid).slice(0,3):[];
 }
 function snapshot(location='bell'){return {notifications:failed?[]:active(location==='billing'?billingFeed:feed).map(n=>({...n,offer:n.offer?{...n.offer}:null,placements:n.placements?[...n.placements]:undefined})),upcomingCampaigns:location==='billing'&&!failed?active(upcomingFeed).map(n=>({...n})):[],loading,error:failed};}
 window.EccoNotifications={snapshot,refresh:load,markRead:id=>markRead(id,false)};
 function render(){
  const visible=active(),old=active(readFeed),count=visible.length,focused=document.activeElement?.dataset.notificationId;
  badge.hidden=!count;badge.textContent=String(count);bell.setAttribute('aria-label',count?`Notifications: ${count} unread`:'Notifications');bell.title=bell.getAttribute('aria-label');
  items.replaceChildren();readItems.replaceChildren();items.closest('table').hidden=!count;history.hidden=!old.length;status.textContent=failed||(!token()?'Sign in to see notifications.':loading&&!count?'Loading notifications…':!count?'No New notifications':'');status.hidden=!status.textContent;
  function rowFor(n,index,read){
   const tr=document.createElement('tr'),number=document.createElement('td'),content=document.createElement('td'),expires=document.createElement('td');
   const row=document.createElement(read?'div':'button'),title=document.createElement('span'),body=document.createElement('span'),meta=document.createElement('span');
   const expired=!!n.expiresAt&&Date.parse(n.expiresAt)<=Date.now();
   tr.dataset.state=read||expired?'old':'unread';number.className='notification-number';number.textContent=String(index+1);
   row.className='notification-item';row.dataset.notificationId=n.id;row.dataset.read=String(read);row.dataset.expired=String(expired);row.dataset.severity=n.severity;
   title.className='notification-title';body.className='notification-body';meta.className='notification-meta';title.textContent=n.title;body.textContent=n.body;
   const level={informational:'Informational',warning:'Warning',error:'Error'}[n.severity];meta.textContent=level;
   expires.className='notification-expiry';
   if(n.expiresAt){const date=new Date(n.expiresAt),time=document.createElement('time');time.dateTime=n.expiresAt;time.textContent=date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});const clock=document.createElement('span');clock.textContent=date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',timeZoneName:'short'});time.append(clock);expires.append(time);}
   else expires.textContent='Until read';
   if(!read&&!expired){row.type='button';row.disabled=pending.has(n.id);row.setAttribute('aria-busy',String(pending.has(n.id)));row.setAttribute('aria-label',`${index+1}. ${level}: ${n.title} — Unread. Activate to mark as read.`);row.onclick=()=>markRead(n.id);}
   row.append(title,body,meta);content.append(row);tr.append(number,content,expires);(read?readItems:items).append(tr);if(!read&&focused===n.id)row.focus();
  }
  visible.forEach((n,index)=>rowFor(n,index,false));old.forEach((n,index)=>rowFor(n,index,true));
  document.dispatchEvent(new CustomEvent('ecco:notifications-change'));
  clearTimeout(expiryTimer);const deadlines=[...visible,...old,...active(billingFeed),...active(upcomingFeed)].filter(n=>n.expiresAt).map(n=>Date.parse(n.expiresAt));
  deadlines.push(...active(upcomingFeed).map(n=>Date.parse(n.startsAt)).filter(t=>t>Date.now()));
  if(deadlines.length)expiryTimer=setTimeout(()=>{render();load()},Math.min(2147483647,Math.max(1,Math.min(...deadlines)-Date.now()+1)));
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
  catch(e){if(scope!==context()||seq!==revision)return;failed=e.message||'Could not load notifications.';if(e.status===401){feed=[];billingFeed=[];upcomingFeed=[];readFeed=[];}}
  finally{if(scope===context()&&seq===revision){loading=false;render();}}
 }
 async function markRead(id,fromBell=true){
  if(pending.size||!active([...feed,...billingFeed]).some(n=>n.id===id))return false;
  const scope=context(),seq=++revision;pending.add(id);failed='';render();
  try{const data=await api({op:'readNotification',id});if(scope!==context()||seq!==revision)return;accept(data);
   try{localStorage.setItem('ecco-notifications-sync:'+identity(),String(Date.now()));}catch{}
   return true;
  }catch(e){if(scope===context()&&seq===revision)failed='Could not mark notification as read. Please try again.';return false;}
  finally{if(scope===context()&&seq===revision){pending.delete(id);loading=false;render();if(fromBell&&!panel.hidden)(items.querySelector('button:not(:disabled)')||bell).focus();}}
 }
 bell.onclick=()=>{if(popup.isMinimized()){popup.resume();return;}if(panel.hidden)open();else close();};
 document.addEventListener('pointerdown',e=>{if(!host.contains(e.target)&&!popup.isMinimized())close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){close();bell.focus();e.stopPropagation();}});
 panel.addEventListener('pointerdown',e=>e.stopPropagation());panel.addEventListener('click',e=>e.stopPropagation());
 document.addEventListener('ecco:auth-change',()=>{revision++;feed=[];billingFeed=[];upcomingFeed=[];readFeed=[];pending.clear();loading=false;failed='';close();render();load();});
 window.addEventListener('storage',e=>{if(e.key==='ecco-notifications-sync:'+identity())load();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();load();}});window.addEventListener('focus',load);
 render();load();setInterval(()=>{if(!document.hidden)load();},30000);
})();
