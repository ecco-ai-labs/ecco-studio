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
 function button(action){const b=document.createElement('button');b.type='button';b.className='secondary ecco-back';b.textContent='← Back';b.setAttribute('aria-label','Back');b.onclick=e=>{e.preventDefault();e.stopPropagation();action();};return b;}
 // The one live Back button. A screen restored from history can bring back a copy of it; copies are removed.
 let backButton=null;
 const NEXT_LOOK=['background-color','color','border','border-radius','padding','font-size','font-weight','min-height','box-shadow','line-height'];
 function update(){
  const heading=q('#heading');
  if(!backButton&&heading){backButton=button(back);backButton.id='workspace-back';heading.before(backButton);}
  const b=backButton;
  for(const copy of document.querySelectorAll('#workspace-back'))if(copy!==b)copy.remove();
  if(b&&!b.isConnected&&heading)heading.before(b);
  // Owner requests 18 Nov 2026: Back sits at the left of the row with the visible "Next: …" button and looks
  // exactly like Next. A row that already has its own step Back (for example "← Back: Image") keeps that one
  // instead, styled like Next. Screens without a Next row keep Back above the heading.
  const next=[...document.querySelectorAll('#page button')].find(x=>/^\s*Next:/.test(x.textContent)&&x.getClientRects().length&&!x.closest('dialog'));
  const row=next?.parentElement;
  const local=row&&[...row.querySelectorAll(':scope > button')].find(x=>x!==b&&/^\s*←\s*Back/.test(x.textContent));
  for(const old of document.querySelectorAll('[data-next-look]'))if(old!==b&&old!==local){for(const p of NEXT_LOOK)old.style.removeProperty(p);delete old.dataset.nextLook;}
  if(b&&row&&!local&&row.firstElementChild!==b)row.prepend(b);
  else if(b&&(!row||local)&&heading&&b.nextElementSibling!==heading)heading.before(b);
  const styled=local||(row?b:null);
  if(styled&&next){const look=getComputedStyle(next);for(const p of NEXT_LOOK)styled.style.setProperty(p,look.getPropertyValue(p),'important');styled.dataset.nextLook='';}
  if(b&&!styled){for(const p of NEXT_LOOK)b.style.removeProperty(p);delete b.dataset.nextLook;}
  if(b){if(row&&!local)b.dataset.placement='actions';else delete b.dataset.placement;b.hidden=page==='welcome'||!!local;b.disabled=!stack.length;}
  for(const control of document.querySelectorAll('[data-screen-back]'))control.disabled=!stack.length;
 }
 // Capture edits and focus before a click changes the current view, including direct library routes.
 document.addEventListener('click',()=>{if(!restoring&&page!=='welcome'&&(!current||current.key===key()))current=capture();},true);
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;remember();});}).observe(document.body,{childList:true,subtree:true});
 document.addEventListener('ecco:auth-change',reset);
 window.EccoNavigation={back,reset,get depth(){return stack.length;}};
 remember();
})();
