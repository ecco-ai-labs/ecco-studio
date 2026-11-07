'use strict';
/* In-tab screen history. Back never substitutes the welcome screen for a missing entry. */
(()=>{
 const q=s=>document.querySelector(s),stack=[];
 let current=null,restoring=false,queued=false;
 const key=()=>[page,activeStory,['library','audio-library','workflow-detail','workflow-library','story-library-detail'].includes(page)?q('#page h2')?.textContent:''].join('|');
 function capture(){return {key:key(),page,title:document.title,context:page==='support'?null:window.EccoWorkspaceUI?.capturePopupContext({navigation:true})};}
 function reset(){for(const entry of stack)entry.context?.dispose();stack.length=0;current=null;update();}
 function remember(){
  if(page==='welcome'){reset();return;}
  const next=key();
  if(current&&current.key!==next&&!restoring){stack.push(current);if(stack.length>30)stack.shift().context?.dispose();current=null;}
  current=capture();update();
 }
 function back(){
  const entry=stack.pop();if(!entry){update();return false;}
  restoring=true;window.EccoDesk?.close();
  document.querySelectorAll('.workspace-menu[open]').forEach(menu=>{menu.open=false;});
  if(entry.page==='support')navigate('support');else entry.context?.restore();
  document.title=entry.title;entry.context?.dispose();current=capture();update();
  queueMicrotask(()=>{restoring=false;});return true;
 }
 function button(action){const b=document.createElement('button');b.type='button';b.className='secondary ecco-back';b.textContent='← Back';b.setAttribute('aria-label','Back');b.dataset.ribbonClose='1';b.onclick=e=>{e.preventDefault();e.stopPropagation();action();};return b;}
 function prependBack(parent,action){if(parent.querySelector(':scope > .ecco-back'))return;parent.prepend(button(action));}
 function update(){
  let b=q('#workspace-back');const heading=q('#heading');
  if(!b&&heading){b=button(back);b.id='workspace-back';heading.before(b);}
  if(b){b.hidden=page==='welcome';b.disabled=!stack.length;}
  for(const control of document.querySelectorAll('[data-screen-back]'))control.disabled=!stack.length;
 }
 function mount(){
  update();
  for(const menu of document.querySelectorAll('.workspace-menu > .workspace-menu-items')){
   const details=menu.parentElement;prependBack(menu,()=>{details.open=false;details.querySelector('summary')?.focus();});
  }
  for(const dialog of document.querySelectorAll('dialog')){
   if(dialog.querySelector(':scope > .ecco-back'))continue;
   const b=button(()=>{if(typeof dialog.eccoBack==='function')dialog.eccoBack();else dialog.close('cancel');});b.classList.add('ecco-dialog-back');dialog.prepend(b);
  }
  for(const id of ['workspace-theme-drawer','workspace-billing-drawer','workspace-usage-drawer']){
   const drawer=q('#'+id);if(!drawer)continue;
   prependBack(drawer,()=>{const trigger=document.querySelector('[aria-controls="'+id+'"]');drawer.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));if(!drawer.hidden&&drawer.isConnected){drawer.hidden=true;drawer.inert=true;trigger?.setAttribute('aria-expanded','false');}trigger?.focus();});
  }
  const notifications=q('#notification-list');if(notifications)prependBack(notifications,()=>{q('#notification-bell')?.click();q('#notification-bell')?.focus();});
  const activity=q('#activity-panel');if(activity)prependBack(activity,()=>{q('#close-activity')?.click();q('#activity-edge-arrow')?.focus();});
 }
 // Capture edits and focus before a click changes the current view, including direct library routes.
 document.addEventListener('click',()=>{if(!restoring&&page!=='welcome'&&(!current||current.key===key()))current=capture();},true);
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;remember();mount();});}).observe(document.body,{childList:true,subtree:true});
 document.addEventListener('ecco:auth-change',reset);
 window.EccoNavigation={back,reset,get depth(){return stack.length;}};
 remember();mount();
})();
