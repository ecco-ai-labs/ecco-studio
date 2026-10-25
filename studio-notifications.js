/* Public product announcements; read receipts are scoped to this browser and Google identity. */
(()=>{
 const controls=document.querySelector('#workspace-community-controls');if(!controls)return;
 const host=document.createElement('div');host.id='studio-notifications';
 host.innerHTML='<button id="notification-bell" type="button" class="secondary asset-icon" aria-label="Notifications" aria-expanded="false" aria-controls="notification-list"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="notification-count" hidden aria-hidden="true"></span></button><section id="notification-list" aria-label="Unread notifications" hidden><strong>Notifications</strong><div data-notification-items></div></section>';
 controls.append(host);controls.setAttribute('aria-label','Community, support, source code and notifications');
 const bell=host.querySelector('button'),badge=host.querySelector('.notification-count'),panel=host.querySelector('section'),items=host.querySelector('[data-notification-items]');
 let feed=[],failed=false;const memory=new Map();
 function identity(){const u=window.EccoAuth?.user;return u&&(u.sub||u.id||u.email)||'guest';}
 function key(){return 'ecco-notifications-read:v1:'+identity();}
 function receipts(){try{return new Set(JSON.parse(localStorage.getItem(key())||'[]'));}catch{return memory.get(key())||new Set();}}
 function unread(){const read=receipts();return feed.filter(n=>!read.has(n.id));}
 function close(){panel.hidden=true;bell.setAttribute('aria-expanded','false');}
 function render(){
  const list=unread();badge.hidden=!list.length;badge.textContent=String(list.length);bell.setAttribute('aria-label',list.length?`Notifications: ${list.length} unread`:'Notifications');bell.title=bell.getAttribute('aria-label');items.replaceChildren();
  if(!list.length){const p=document.createElement('p');p.textContent=failed?'Could not load notifications.':'No unread notifications';items.append(p);return;}
  for(const n of list){const row=document.createElement('article'),title=document.createElement('strong'),body=document.createElement('p'),read=document.createElement('button');title.textContent=n.title;body.textContent=n.body;read.type='button';read.className='notification-read';read.textContent='Mark as read';read.setAttribute('aria-label','Mark as read: '+n.title);read.onclick=()=>{const seen=receipts();seen.add(n.id);memory.set(key(),seen);try{localStorage.setItem(key(),JSON.stringify([...seen]));}catch{}const index=[...items.children].indexOf(row);render();const next=items.querySelectorAll('button');(next[Math.min(index,next.length-1)]||bell).focus();};row.append(title,body,read);items.append(row);}
 }
 bell.onclick=()=>{panel.hidden=!panel.hidden;bell.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){render();if(failed)load();}};
 document.addEventListener('pointerdown',e=>{if(!host.contains(e.target))close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){close();bell.focus();e.stopPropagation();}});
 host.addEventListener('focusout',()=>{queueMicrotask(()=>{if(!host.contains(document.activeElement))close();});});
 document.addEventListener('ecco:auth-change',()=>{close();render();});
 window.addEventListener('storage',e=>{if(e.key===key())render();});
 async function load(){try{const response=await fetch(new URL('notifications.json',document.baseURI),{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data))throw Error();const ids=new Set();feed=data.filter(n=>{if(!n||typeof n.id!=='string'||typeof n.title!=='string'||typeof n.body!=='string'||ids.has(n.id))return false;ids.add(n.id);return true;});failed=false;}catch{failed=true;}render();}
 render();load();setInterval(()=>{if(!document.hidden)load();},300000);
})();
