'use strict';
(() => {
 let dialog, lastMessage='', lastAt=0;
 const pending=[];
 function show(message, options={}){
  const issue=window.EccoErrorKnowledge?.lookup(message);
  if(!options.logged)window.EccoErrorLog?.record(message,{source:'popup',knowledge_issue:issue?.id||null,possible_cause:issue?.cause||null});options={...options,logged:true};
  message=String(message?.message||message||'Something went wrong. Please try again.');
  // One pop-up per kind of problem (owner report 21 Nov 2026): a storage blip used to queue one pop-up per failed
  // request (HTTP 502, then 503, then "did not respond"…), so closing one showed the next for minutes after it recovered.
  // The same known issue (or the same text) is not shown again while open or for 30 s, and a waiting pop-up older
  // than 30 s is dropped instead of shown.
  const key=issue?.id||message;
  if(key===lastMessage && (dialog?.open || Date.now()-lastAt<30000))return;
  if(pending.some(([,o])=>o.key===key))return;
  if(dialog?.open){pending.push([message,{...options,issue,key,at:Date.now()}]);return;}
  lastMessage=key;lastAt=Date.now();
  if(!dialog){
   dialog=document.createElement('dialog');dialog.id='ecco-error-popup';
   dialog.setAttribute('aria-labelledby','ecco-error-title');
   dialog.setAttribute('aria-describedby','ecco-error-message ecco-error-cause');
   dialog.innerHTML='<h2 id="ecco-error-title">Unable to complete action</h2><p id="ecco-error-message" role="alert"></p><div data-cause hidden><strong>Possible cause</strong><p id="ecco-error-cause"></p></div><div data-steps hidden><strong>What you can do next</strong><ul id="ecco-error-steps"></ul></div><div class="row"><button type="button" data-retry hidden></button><button type="button" data-close>Close</button></div>';
   document.body.append(dialog);
   dialog.querySelector('[data-close]').onclick=()=>dialog.close();
   dialog.addEventListener('close',()=>{while(pending.length&&Date.now()-pending[0][1].at>30000)pending.shift();
    if(pending.length){const [text,opts]=pending.shift();show(text,opts);}});
  }
  dialog.querySelector('h2').textContent=options.title||'Unable to complete action';
  const explanation=issue||options.issue;
  dialog.querySelector('#ecco-error-message').textContent=explanation?.message||message;
  dialog.querySelector('[data-cause]').hidden=!explanation;
  dialog.querySelector('#ecco-error-cause').textContent=explanation?.cause||'';
  // Story Generation (2026-11-10): optional next steps, shown under the cause.
  const steps=dialog.querySelector('#ecco-error-steps');steps.replaceChildren(...(options.steps||[]).map(text=>Object.assign(document.createElement('li'),{textContent:text})));dialog.querySelector('[data-steps]').hidden=!options.steps?.length;
  const retry=dialog.querySelector('[data-retry]');retry.hidden=!options.retry;
  retry.textContent=options.retryLabel||'Try again';retry.className='secondary';
  retry.onclick=()=>{dialog.close();options.retry?.();};
  dialog.showModal();dialog.querySelector('[data-close]').focus();
 }
 window.EccoErrors={show};
 const style=document.createElement('style');style.textContent=`
 #ecco-error-popup{width:min(480px,calc(100vw - 32px));box-sizing:border-box;background:#201d44;border:1px solid #605679;border-radius:9px;padding:18px;color:var(--accent,#ffdc24)}
 #ecco-error-popup h2,#ecco-error-popup p,#ecco-error-popup li{color:#ff7474!important}#ecco-error-popup ul{margin:6px 0 0;padding-left:18px}
 #ecco-error-popup [data-retry]{color:var(--accent,#ffdc24)!important}
 #ecco-error-popup h2{font-size:calc(16px - 2pt);margin:0 0 12px}#ecco-error-popup p{font-size:calc(13px - 2pt);line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;max-height:55vh;overflow:auto}
 #ecco-error-popup::backdrop{background:#0008}#ecco-error-popup .row{justify-content:flex-end}
 #ecco-error-popup [hidden]{display:none!important}`;
 document.head.append(style);
 window.addEventListener('unhandledrejection',event=>show(event.reason));
 window.addEventListener('error',event=>{if(event.error)show(event.error);});
})();

