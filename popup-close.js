'use strict';
/* Shared close/minimize controls. Minimizing never fires the popup's close cleanup. */
(()=>{
 const groups=[],records=new WeakMap(),mutedClose=new WeakMap(),nativeClose=HTMLDialogElement.prototype.close,nativeShow=HTMLDialogElement.prototype.show,nativeModal=HTMLDialogElement.prototype.showModal;
 let navigating=false,order=0;
 const style=document.createElement('style');
 style.textContent=`
 dialog{position:fixed}
 dialog.ecco-popup-close-ready{padding-top:44px!important}
 dialog.ecco-popup-close-ready > button.ecco-popup-close{position:absolute!important;top:10px!important;right:10px!important;z-index:20}
 dialog.ecco-popup-close-ready > button.ecco-popup-minimize{position:absolute!important;top:10px!important;right:46px!important;z-index:20}
 dialog [data-ecco-replaced-close]{display:none!important}
 dialog[data-ecco-minimized]{display:none!important}
 #ecco-popup-resume{position:fixed;right:20px;bottom:20px;z-index:9999;max-width:min(360px,calc(100vw - 40px));padding:10px;background:var(--ecco-theme-surface,#252039);border:1px solid var(--ecco-theme-border,#51496f);border-radius:9px;color:var(--ecco-theme-text,#fff)}
 #ecco-popup-resume[hidden]{display:none!important}
 #ecco-popup-resume summary{cursor:pointer;color:var(--ecco-theme-accent,#ffdc24)}
 #ecco-popup-resume [data-popup-list]{display:grid;gap:8px;max-height:50vh;overflow:auto;margin-top:10px}
 #ecco-popup-resume button{white-space:normal;text-align:left}
 #ecco-popup-resume p{font-size:12px;margin:8px 0 0}
 `;
 document.head.append(style);
 const dock=document.createElement('details');dock.id='ecco-popup-resume';dock.hidden=true;
 dock.innerHTML='<summary>Resume popups</summary><div data-popup-list></div><p>Kept open in this tab. Use Save Draft before refreshing.</p>';document.body.append(dock);
 const label=dialog=>dialog.querySelector('h1,h2,h3,.pdf-dialog-head strong')?.textContent.trim()||dialog.getAttribute('aria-label')||'Popup';
 function register(dialog){
  if(records.has(dialog))return records.get(dialog);
  const record={order:++order,group:null,focus:null};records.set(dialog,record);
  dialog.addEventListener('close',event=>{
   const pending=mutedClose.get(dialog)||0;
   if(pending){mutedClose.set(dialog,pending-1);event.stopImmediatePropagation();return;}
   delete dialog.dataset.eccoMinimized;record.group=null;queueMicrotask(renderDock);
  },true);return record;
 }
 function quietlyClose(dialog){
  if(!dialog.open)return;mutedClose.set(dialog,(mutedClose.get(dialog)||0)+1);
  const value=dialog.returnValue;nativeClose.call(dialog);dialog.returnValue=value;
 }
 HTMLDialogElement.prototype.showModal=function(){const record=register(this);if(record.group){resume(record.group);return;}record.order=++order;return nativeModal.call(this);};
 HTMLDialogElement.prototype.close=function(...args){if(navigating&&records.get(this)?.group)return;return nativeClose.apply(this,args);};
 function visibleDialogs(){return [...document.querySelectorAll('dialog[open]')].filter(d=>!d.hasAttribute('data-ecco-minimized')).sort((a,b)=>register(a).order-register(b).order);}
 function minimize(){
  const dialogs=visibleDialogs();if(!dialogs.length)return null;
  const group={dialogs,context:window.EccoWorkspaceUI?.capturePopupContext?.(),title:dialogs.map(label).join(' → ')};groups.push(group);
  for(const dialog of [...dialogs].reverse()){
   const record=register(dialog);record.group=group;record.focus=dialog.contains(document.activeElement)?document.activeElement:null;
   dialog.dataset.eccoMinimized='true';quietlyClose(dialog);
   // Keep open=true for existing async validity checks, without a modal backdrop or focus trap.
   nativeShow.call(dialog);
  }
  renderDock();dock.open=true;dock.querySelector('summary').focus();return group;
 }
 function resume(group){
  if(!groups.includes(group))return;
  if(visibleDialogs().length)minimize();
  group.context?.restore();
  for(const dialog of group.dialogs){
   const record=records.get(dialog);if(!dialog.isConnected||record?.group!==group)continue;
   quietlyClose(dialog);delete dialog.dataset.eccoMinimized;record.group=null;record.order=++order;nativeModal.call(dialog);
   dialog.dispatchEvent(new Event('ecco-popup-resume'));if(record.focus?.isConnected)record.focus.focus();
  }
  groups.splice(groups.indexOf(group),1);group.context?.dispose();renderDock();
 }
 function renderDock(){
  for(let i=groups.length-1;i>=0;i--)if(!groups[i].dialogs.some(d=>d.isConnected&&records.get(d)?.group===groups[i])){groups[i].context?.dispose();groups.splice(i,1);}
  dock.hidden=!groups.length;const list=dock.querySelector('[data-popup-list]');list.replaceChildren();
  for(const group of groups){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Resume '+group.title;button.onclick=()=>resume(group);list.append(button);}
  dock.querySelector('summary').textContent='Resume popups ('+groups.length+')';
 }
 const previousNavigate=navigate;
 navigate=function(...args){for(const group of groups)group.context?.suspend();navigating=true;try{return previousNavigate.apply(this,args);}finally{navigating=false;}};
 window.EccoPopups={minimize,resume,isMinimized:dialog=>!!records.get(dialog)?.group};
 function mount(){
  for(const dialog of document.querySelectorAll('dialog')){
   register(dialog);
   dialog.classList.add('ecco-popup-close-ready');
   for(const button of dialog.querySelectorAll('button')){
    if(button.closest('dialog')!==dialog||button.classList.contains('ecco-popup-close')||button.classList.contains('ecco-popup-minimize'))continue;
    const text=button.textContent.trim(),label=button.getAttribute('aria-label')||'';
    if(/^(?:×|✕|x|close|cancel)$/i.test(text)||/^(?:close|cancel)(?:\s|$)/i.test(label))button.setAttribute('data-ecco-replaced-close','');
   }
   if([...dialog.children].some(el=>el.classList.contains('ecco-popup-close')))continue;
   const close=document.createElement('button');close.type='button';close.className='ecco-popup-close';
   close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>';close.setAttribute('aria-label','Close popup');close.title='Close';
   close.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    dialog.close('cancel');
   });
   dialog.append(close);
   const minimizeButton=document.createElement('button');minimizeButton.type='button';minimizeButton.className='secondary ecco-popup-minimize';minimizeButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 12h12"/></svg>';minimizeButton.setAttribute('aria-label','Minimize popup');minimizeButton.title='Minimize and keep your work';minimizeButton.onclick=event=>{event.preventDefault();event.stopPropagation();minimize();};dialog.append(minimizeButton);
  }
 }
 let queued=false;
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();});}).observe(document.body,{childList:true,subtree:true});
 mount();
})();
