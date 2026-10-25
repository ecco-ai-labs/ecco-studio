'use strict';
/* Separate compact hover status for each connection icon. */
(()=>{
 const style=document.createElement('style');
 style.textContent='#connection-indicators::after{display:none!important}#connection-indicators>[data-icon-tooltip]{position:relative}#connection-indicators>[data-icon-tooltip]:hover::after,#connection-indicators>#studio-publishing-control:focus-within::after{content:attr(data-icon-tooltip);position:absolute;top:calc(100% + 9px);left:0;z-index:10000;white-space:nowrap;pointer-events:none;padding:6px 8px;border:0;border-radius:5px;background:var(--connection-tooltip-bg,#fff);color:#000;font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:11px;line-height:1.4;font-weight:500;box-shadow:0 3px 12px #0004}#connection-indicators>[data-icon-tooltip][data-tooltip-connected="true"]{--connection-tooltip-bg:#ffdc24}#connection-indicators>[data-icon-tooltip][data-tooltip-connected="false"]{--connection-tooltip-bg:#fff}';
 document.head.append(style);
 function refresh(){
  const panel=document.querySelector('#connection-indicators');
  if(!panel)return;
  panel.removeAttribute('title');delete panel.dataset.connectionTooltip;
  const ai=panel.querySelector('#studio-ai-button'),storage=panel.querySelector('#studio-storage-indicator'),gpu=panel.querySelector('#connected-accelerator');
  const aiReady=ai?.dataset.connected==='true',storageReady=storage?.dataset.connected==='true';
  const ids=window.EccoGPUConnection?.connectedIds||[];
  const names=ids.map(id=>window.EccoGPUPicker?.gpus?.find(item=>item.id===id)?.name||'GPU');
  const items=[[ai,aiReady,aiReady?'Connected to AI':'AI: Not connected'],[storage,storageReady,storageReady?'Connected to Storage':'Storage: Not connected'],[gpu,ids.length>0,ids.length?'Connected to GPU: '+names.join(', '):'GPU: Not connected']];
  for(const [element,connected,text] of items){
   if(!element)continue;
   element.removeAttribute('title');
   if(element.dataset.iconTooltip!==text)element.dataset.iconTooltip=text;
   if(element.dataset.tooltipConnected!==String(connected))element.dataset.tooltipConnected=String(connected);
  }
 }
 document.addEventListener('mouseover',event=>{if(event.target.closest?.('#connection-indicators'))refresh();});
 document.addEventListener('ecco:gpu-connection-change',refresh);
 setInterval(refresh,1000);refresh();
})();
