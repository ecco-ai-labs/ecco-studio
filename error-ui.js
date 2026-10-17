'use strict';
(() => {
 let dialog, lastMessage='', lastAt=0;
 const pending=[];
 function show(message, options={}){
  message=String(message?.message||message||'Something went wrong. Please try again.');
  if(message===lastMessage && (dialog?.open || Date.now()-lastAt<2500))return;
  lastMessage=message;lastAt=Date.now();
  if(dialog?.open){pending.push([message,options]);return;}
  if(!dialog){
   dialog=document.createElement('dialog');dialog.id='ecco-error-popup';
   dialog.setAttribute('aria-labelledby','ecco-error-title');
   dialog.setAttribute('aria-describedby','ecco-error-message');
   dialog.innerHTML='<h2 id="ecco-error-title">Unable to complete action</h2><p id="ecco-error-message" role="alert"></p><div class="row"><button type="button" data-retry hidden></button><button type="button" data-close>Close</button></div>';
   document.body.append(dialog);
   dialog.querySelector('[data-close]').onclick=()=>dialog.close();
   dialog.addEventListener('close',()=>{if(pending.length){const [text,opts]=pending.shift();lastMessage='';show(text,opts);}});
  }
  dialog.querySelector('h2').textContent=options.title||'Unable to complete action';
  dialog.querySelector('p').textContent=message;
  const retry=dialog.querySelector('[data-retry]');retry.hidden=!options.retry;
  retry.textContent=options.retryLabel||'Try again';
  retry.onclick=()=>{dialog.close();options.retry?.();};
  dialog.showModal();dialog.querySelector('[data-close]').focus();
 }
 window.EccoErrors={show};
 const style=document.createElement('style');style.textContent=`
 #ecco-error-popup{width:min(480px,calc(100vw - 32px));box-sizing:border-box;background:#201d44;border:1px solid #605679;border-radius:9px;padding:20px;color:var(--accent,#ffdc24)}
 #ecco-error-popup h2,#ecco-error-popup p,#ecco-error-popup button{color:var(--accent,#ffdc24)!important}
 #ecco-error-popup h2{font-size:16px;margin:0 0 12px}#ecco-error-popup p{font-size:13px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;max-height:55vh;overflow:auto}
 #ecco-error-popup::backdrop{background:#0008}#ecco-error-popup .row{justify-content:flex-end}
 #ecco-error-popup [hidden]{display:none!important}`;
 document.head.append(style);
 window.addEventListener('unhandledrejection',event=>show(event.reason));
 window.addEventListener('error',event=>{if(event.error)show(event.error);});
})();
