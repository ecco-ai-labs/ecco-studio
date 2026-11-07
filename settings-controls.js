'use strict';
/* Reuse the existing Settings actions in the compact header control panel. */
(()=>{
 const svg=paths=>'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg>';
 const icons={
  models:svg('<path d="M12 21v-9M12 16C5 16 3 12 3 6c6 0 9 3 9 8M12 12c0-6 3-9 9-9 0 6-3 9-9 9"/>'),
  preferences:svg('<path d="M4 6h6m4 0h6M4 12h2m4 0h10M4 18h10m4 0h2"/><circle cx="12" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>'),
  drive:svg('<path d="M4 5h16l2 10v5H2v-5L4 5Z M2 15h20"/><path d="M16 18h.01M19 18h.01"/>')
 };
 function icon(element,label,kind){
  if(!element||element.dataset.settingsIcon===kind)return;
  element.dataset.settingsIcon=kind;element.dataset.iconTooltip=label;
  element.setAttribute('aria-label',label);element.removeAttribute('title');element.innerHTML=icons[kind];
 }
 function mount(){
  const menus=document.querySelector('#workspace-menus'),preferences=menus?.querySelector('[data-category="Activity"]');if(!preferences)return;
  let panel=document.querySelector('#workspace-settings-controls');
  if(!panel){panel=document.createElement('div');panel.id='workspace-settings-controls';panel.setAttribute('role','group');panel.setAttribute('aria-label','Settings');menus.insertBefore(panel,preferences);}
  const models=preferences.querySelector('button[data-page="models"]')||panel.querySelector('button[data-page="models"]'),drive=document.querySelector('#activity-files-menu');
  icon(models,'Model Garden','models');icon(preferences.querySelector('summary'),'User Preferences','preferences');icon(drive,'Workspace Drive','drive');
  if(models&&panel.firstElementChild!==models)panel.prepend(models);
  if(preferences.parentElement!==panel)panel.append(preferences);
  if(drive&&panel.lastElementChild!==drive)panel.append(drive);
 }
 let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();});}).observe(document.querySelector('#workspace-menus')||document.body,{childList:true,subtree:true});
 mount();
})();
