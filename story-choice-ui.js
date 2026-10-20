'use strict';
/* Keep the top menu visible but inactive while choosing a story. */
(()=>{
 const style=document.createElement('style');
 style.textContent='body.story-choice-mode #story-choice-screen .story-choice-actions button{background:#ffdc24!important;color:#000!important;box-sizing:border-box;width:190px;height:46px;min-height:46px;padding:4px 10px;white-space:normal;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif!important;font-size:15px!important;font-weight:650!important;line-height:normal!important}';
 document.head.append(style);
 function sync(){
  const choosing=document.body.classList.contains('story-choice-mode');
  const header=document.querySelector('body>main>header');
  if(header){
   if(choosing&&!header.hasAttribute('data-story-choice-frozen')){
    header.dataset.storyChoiceFrozen=header.inert?'already-inert':'restore';
    header.inert=true;
    header.querySelectorAll('details[open]').forEach(menu=>{menu.open=false;});
   }else if(!choosing&&header.hasAttribute('data-story-choice-frozen')){
    if(header.dataset.storyChoiceFrozen==='restore')header.inert=false;
    delete header.dataset.storyChoiceFrozen;
   }
  }
  for(const button of document.querySelectorAll('#story-choice-screen .story-choice-actions button')){
   const label=button.textContent.trim();
   if(['Create a New Story','Create New Story','Tell New Story'].includes(label))button.textContent='New Story';
   if(/^Continue with (an )?Existing Story$/i.test(label))button.textContent='Existing Story';
  }
 }
 let queued=false;
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;sync();});}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
 sync();
})();
