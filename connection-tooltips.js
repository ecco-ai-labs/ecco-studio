'use strict';
/* Compact immediate hover details; connection state remains owned by its services. */
(()=>{
 const style=document.createElement('style');
 style.textContent='#connection-indicators{position:relative}#connection-indicators[data-connection-tooltip]:hover::after,#connection-indicators[data-connection-tooltip]:focus-within::after{content:attr(data-connection-tooltip);position:absolute;top:calc(100% + 6px);left:0;z-index:10000;white-space:pre;pointer-events:none;padding:7px 9px;border:1px solid var(--border,#51496f);border-radius:6px;background:var(--panel,#242147);color:var(--text,#fff);font-size:11px;line-height:1.5;font-weight:400;box-shadow:0 3px 12px #0004}#connection-indicators:has(details[open])::after{display:none}';
 document.head.append(style);
 function refresh(){
  const panel=document.querySelector('#connection-indicators');
  if(!panel)return;
  const ai=panel.querySelector('#studio-ai-button');
  const storage=panel.querySelector('#studio-storage-indicator');
  const gpu=panel.querySelector('#connected-accelerator');
  const aiText=ai?.dataset.connected==='true'?'Connected to AI API':'AI API: Not connected';
  const storageText=storage?.dataset.connected==='true'?'Connected to Storage':'Storage: Not connected';
  const count=window.EccoGPUConnection?.connectedIds?.length||0;
  const gpuText=count?'Connected to GPUs: '+count:'GPUs: Not connected';
  for(const [element,text] of [[ai,aiText],[storage,storageText],[gpu,gpuText],[panel,[aiText,storageText,gpuText].join('\n')]]){
   if(element)element.removeAttribute('title');
  }
  const text=[aiText,storageText,gpuText].join('\n');
  if(panel.dataset.connectionTooltip!==text)panel.dataset.connectionTooltip=text;
 }
 document.addEventListener('mouseover',event=>{if(event.target.closest?.('#connection-indicators'))refresh();});
 document.addEventListener('ecco:gpu-connection-change',refresh);
 setInterval(refresh,1000);
 refresh();
})();
