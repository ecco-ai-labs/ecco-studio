'use strict';
/* One local dismissal control for every Studio dialog, including nested dialogs. */
(()=>{
 const style=document.createElement('style');
 style.textContent=`
 dialog{position:fixed}
 dialog.ecco-popup-close-ready{padding-top:44px!important}
 :is(#ecco-error-popup,dialog).ecco-popup-close-ready > button.ecco-popup-close{
  position:absolute!important;top:10px!important;right:10px!important;
  width:26px!important;height:26px!important;min-width:26px!important;min-height:26px!important;
  max-width:26px!important;padding:0!important;margin:0!important;
  display:grid!important;place-items:center!important;border:0!important;border-radius:5px!important;
  background:#ffdc24!important;color:#211b33!important;font-size:20px!important;
  font-weight:600!important;line-height:1!important;box-shadow:none!important;cursor:pointer;z-index:20;
 }
 dialog .ecco-popup-close:focus-visible{outline:2px solid white!important;outline-offset:2px}
 dialog [data-ecco-replaced-close]{display:none!important}
 `;
 document.head.append(style);
 function mount(){
  for(const dialog of document.querySelectorAll('dialog')){
   dialog.classList.add('ecco-popup-close-ready');
   for(const button of dialog.querySelectorAll('button')){
    if(button.closest('dialog')!==dialog||button.classList.contains('ecco-popup-close'))continue;
    const text=button.textContent.trim(),label=button.getAttribute('aria-label')||'';
    if(/^(?:×|✕|x|close|cancel)$/i.test(text)||/^(?:close|cancel)(?:\s|$)/i.test(label))button.setAttribute('data-ecco-replaced-close','');
   }
   if([...dialog.children].some(el=>el.classList.contains('ecco-popup-close')))continue;
   const close=document.createElement('button');close.type='button';close.className='ecco-popup-close';
   close.textContent='×';close.setAttribute('aria-label','Close popup');close.title='Close';
   close.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    dialog.close('cancel');
   });
   dialog.append(close);
  }
 }
 let queued=false;
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();});}).observe(document.body,{childList:true,subtree:true});
 mount();
})();
