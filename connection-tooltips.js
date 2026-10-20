'use strict';
/* Compact native hover details; connection state remains owned by its services. */
(()=>{
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
   if(element&&element.title!==text)element.title=text;
  }
 }
 document.addEventListener('mouseover',event=>{if(event.target.closest?.('#connection-indicators'))refresh();});
 document.addEventListener('ecco:gpu-connection-change',refresh);
 setInterval(refresh,1000);
 refresh();
})();
