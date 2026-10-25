/* Public product announcements; read receipts are scoped to this browser and Google identity. */
(()=>{
 const controls=document.querySelector('#workspace-community-controls');if(!controls)return;
 const host=document.createElement('div');host.id='studio-notifications';
 host.innerHTML='<button id="notification-bell" type="button" class="secondary asset-icon" aria-label="Notifications" aria-expanded="false" aria-controls="notification-list"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="notification-count" hidden aria-hidden="true"></span></button><section id="notification-list" aria-label="Notifications" hidden><strong>Notifications</strong><div data-notification-items></div></section>';
 controls.append(host);controls.setAttribute('aria-label','Community, support, source code and notifications');
 const bell=host.querySelector('button'),badge=host.querySelector('.notification-count'),panel=host.querySelector('section'),items=host.querySelector('[data-notification-items]');
 let feed=[],failed=false;const memory=new Map();
 function identity(){const u=window.EccoAuth?.user;return u&&(u.sub||u.id||u.email)||'guest';}
 function key(){return 'ecco-notifications-read:v1:'+identity();}
 const readRetention=7*24*60*60*1000;
 function saveReceipts(read){memory.set(key(),read);try{localStorage.setItem(key(),JSON.stringify(Object.fromEntries(read)));}catch{}}
 function receipts(){
  if(memory.has(key()))return memory.get(key());
  let saved;try{saved=JSON.parse(localStorage.getItem(key())||'{}');}catch{saved={};}
  const now=Date.now(),read=new Map(Array.isArray(saved)?saved.filter(id=>typeof id==='string').map(id=>[id,now]):Object.entries(saved||{}).filter(([,time])=>Number.isFinite(time)&&time>0));
  memory.set(key(),read);if(Array.isArray(saved))saveReceipts(read);return read;
 }

 function unread(){const read=receipts();return feed.filter(n=>!read.has(n.id));}
 function close(){panel.hidden=true;bell.setAttribute('aria-expanded','false');}
 function updateCount(){const count=unread().length;badge.hidden=!count;badge.textContent=String(count);bell.setAttribute('aria-label',count?`Notifications: ${count} unread`:'Notifications');bell.title=bell.getAttribute('aria-label');}
 function render(){
  updateCount();const focused=document.activeElement?.dataset.notificationId;items.replaceChildren();
  const seen=receipts(),visible=feed.filter(n=>!seen.has(n.id)||Date.now()-seen.get(n.id)<readRetention);
  if(!visible.length){const p=document.createElement('p');p.textContent=failed?'Could not load notifications.':'No notifications';items.append(p);return;}
  for(const n of visible){
   const row=document.createElement('button'),title=document.createElement('span'),body=document.createElement('span');
   row.type='button';row.className='notification-item';row.dataset.notificationId=n.id;title.className='notification-title';body.className='notification-body';title.textContent=n.title;body.textContent=n.body;
   function state(read){row.dataset.read=String(read);row.setAttribute('aria-label',n.title+(read?' — Read':' — Unread'));}
   state(seen.has(n.id));
   row.onclick=()=>{const read=receipts();if(!read.has(n.id)){read.set(n.id,Date.now());saveReceipts(read);}state(true);updateCount();};
   row.append(title,body);items.append(row);if(focused===n.id)row.focus();
  }
 }

 bell.onclick=()=>{panel.hidden=!panel.hidden;bell.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){render();if(failed)load();}};
 document.addEventListener('pointerdown',e=>{if(!host.contains(e.target))close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){close();bell.focus();e.stopPropagation();}});
 // Header menu handlers must not treat a notification click as an outside click.
 panel.addEventListener('pointerdown',event=>event.stopPropagation());
 panel.addEventListener('click',event=>event.stopPropagation());
 document.addEventListener('ecco:auth-change',()=>{close();render();});
 window.addEventListener('storage',e=>{if(e.key===key()||e.key===null){memory.delete(key());render();}});
 async function load(){try{const response=await fetch(new URL('notifications.json',document.baseURI),{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data))throw Error();const ids=new Set();feed=data.filter(n=>{if(!n||typeof n.id!=='string'||typeof n.title!=='string'||typeof n.body!=='string'||ids.has(n.id))return false;ids.add(n.id);return true;}).slice(0,5);failed=false;}catch{failed=true;}render();}
 render();load();setInterval(()=>{if(!document.hidden)load();},300000);
})();
