'use strict';
/* Compact model settings cards and the approved page title. */
(()=>{
 const style=document.createElement('style');
 style.textContent='#models-form .models-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:10px;align-items:stretch;grid-auto-rows:1fr}#models-form .model-panel{padding:10px;gap:6px;min-width:0;height:100%;box-sizing:border-box;display:flex;flex-direction:column}#models-form .model-panel h2{margin:0;font-size:calc(16px - 2pt)}#models-form .model-fields{gap:6px}#models-form .model-panel label{gap:4px;font-size:calc(12px - 2pt);min-width:0}#models-form .model-panel input,#models-form .model-panel select{padding:4px 6px;min-width:0;width:100%;box-sizing:border-box;font-size:calc(12px - 2pt)}#models-form .model-panel button{padding:4px 6px;font-size:calc(12px - 2pt)}#models-form .model-status{min-height:0;margin:0}#models-form .model-status:empty{display:none}#models-form [data-save-model]{margin-top:auto}#models-form [data-save-status]{margin:0;min-height:1.4em}';
 document.head.append(style);
 function rename(){for(const element of document.querySelectorAll('#heading,button[data-page="models"]')){if(['Models & settings','Models & Settings'].includes(element.textContent))element.textContent='Model Garden';}}
 let queued=false;
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;rename();});}).observe(document.body,{childList:true,subtree:true});
 rename();
})();
