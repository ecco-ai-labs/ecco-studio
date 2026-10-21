'use strict';
/* Keep connection controls available while other top menus are frozen. */
(()=>{
 const style=document.createElement('style');
 style.textContent='body.story-choice-mode #story-choice-screen .story-choice-actions button{background:#ffdc24!important;color:#000!important;box-sizing:border-box;width:190px;height:46px;min-height:46px;padding:4px 10px;white-space:normal;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif!important;font-size:15px!important;font-weight:650!important;line-height:normal!important}';
 document.head.append(style);
 const frozen=new Map();
 function sync(){
  const choosing=document.body.classList.contains('story-choice-mode');
  const header=document.querySelector('body>main>header');
  const available=header?[...header.querySelectorAll('#connection-indicators,#google-user-menu')]:[];
  const targets=new Set();
  function collect(parent){
   for(const child of parent.children){
    if(available.includes(child))continue;
    if(available.some(control=>child.contains(control)))collect(child);
    else targets.add(child);
   }
  }
  if(choosing&&header)collect(header);
  for(const [element,wasInert] of frozen){
   if(!targets.has(element)){
    element.inert=wasInert;
    frozen.delete(element);
   }
  }
  for(const element of targets){
   if(frozen.has(element))continue;
   frozen.set(element,element.inert);
   element.inert=true;
   if(element.matches('details[open]'))element.open=false;
   element.querySelectorAll('details[open]').forEach(menu=>{menu.open=false;});
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
