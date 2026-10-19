'use strict';
/* One creation entry point; existing workflows keep their saved type and editor. */
(()=>{
 const q=s=>document.querySelector(s);
 function start(){
  page='workflow-create';
  q('#heading').textContent='New Workflow';
  q('#page').innerHTML='<section class="panel form" id="workflow-start"><h2>Step 1 · What do you want to create?</h2><fieldset><legend>Workflow type</legend><div class="row"><label class="row"><input type="radio" name="workflow-type" value="audio" style="width:auto">Audio</label><label class="row"><input type="radio" name="workflow-type" value="video" style="width:auto">Video</label></div></fieldset><p class="help">Choose the output, then configure the workflow steps.</p><div class="row"><button type="button" data-continue disabled>Continue</button><button type="button" class="secondary" data-cancel>Cancel</button></div><p role="alert"></p></section>';
  const root=q('#workflow-start'),next=root.querySelector('[data-continue]');
  root.addEventListener('change',()=>{next.disabled=!root.querySelector('input:checked');});
  root.querySelector('[data-cancel]').onclick=()=>window.EccoWorkflows.showLibrary();
  next.onclick=()=>{
   const choice=root.querySelector('input:checked')?.value;if(!choice)return;
   const editor=choice==='audio'?window.EccoAudioWorkflow:window.EccoWorkflows;
   if(!editor?.show){root.querySelector('[role=alert]').textContent='This workflow editor is still loading. Try again.';return;}
   editor.show();
  };
 }
 document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  const navNew=button.closest('#workflow-library')&&button.classList.contains('tree-folder')&&!button.closest('.text-library-row')&&/^new workflow$/i.test(button.textContent.trim());
  if(['workflow-library-new','workflow-new','new-audio-workflow'].includes(button.id)||navNew){
   event.preventDefault();event.stopImmediatePropagation();start();
  }
 },true);
 // The legacy audio editor adds its shortcut on redraw; suppress that redundant entry.
 const style=document.createElement('style');style.textContent='#new-audio-workflow{display:none!important}#workflow-start{max-width:640px}#workflow-start fieldset{border:1px solid var(--border,#514b69);border-radius:8px;padding:16px}#workflow-start legend{color:var(--accent,#ffdc24)}#workflow-start [role=alert]{color:#ff7272}';
 document.head.append(style);
 window.EccoWorkflowStart={show:start};
})();
