'use strict';
/* Compact model settings cards and the approved page title. */
(()=>{
 const style=document.createElement('style');
 style.textContent='#models-form .models-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px;align-items:start}#models-form .model-panel{padding:12px;gap:8px;min-width:0}#models-form .model-panel h2{margin:0;font-size:16px}#models-form .model-fields{gap:8px}#models-form .model-panel label{gap:4px;font-size:12px;min-width:0}#models-form .model-panel input,#models-form .model-panel select{padding:6px 8px;min-width:0;width:100%;box-sizing:border-box;font-size:12px}#models-form .model-panel button{padding:6px 8px;font-size:12px}#models-form .model-status{min-height:0;margin:0}#models-form .model-status:empty{display:none}';
 document.head.append(style);
 function rename(){for(const element of document.querySelectorAll('#heading,button[data-page="models"]')){if(['Models & settings','Models & Settings'].includes(element.textContent))element.textContent='Model Garden';}}
 let queued=false;
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;rename();});}).observe(document.body,{childList:true,subtree:true});
 rename();
})();
