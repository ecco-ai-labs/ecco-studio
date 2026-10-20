'use strict';
/* Keep the top menu visible but inactive while choosing a story. */
(()=>{
 const style=document.createElement('style');
 style.textContent='#story-choice-screen .story-choice-actions button{background:#ffdc24!important;color:#000!important;box-sizing:border-box;width:190px;height:46px;min-height:46px;padding:4px 10px;white-space:normal;line-height:1.3}';
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
  const button=document.querySelector('#story-choice-screen .story-choice-actions button');
  if(button&&button.textContent==='Create a New Story')button.textContent='Tell New Story';
 }
 let queued=false;
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;sync();});}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
 sync();
})();
