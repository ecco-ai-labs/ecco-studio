'use strict';
/* Scoped story-choice presentation; does not alter navigation handlers. */
(()=>{
 const style=document.createElement('style');
 style.textContent='body.story-choice-mode>main>header{display:none!important}';
 document.head.append(style);
 function rename(){
  const button=document.querySelector('#story-choice-screen .story-choice-actions button');
  if(button&&button.textContent==='Create a New Story')button.textContent='Tell New Story';
 }
 let queued=false;
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;rename();});}).observe(document.body,{childList:true,subtree:true});
 rename();
})();
