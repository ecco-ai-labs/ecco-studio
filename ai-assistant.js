'use strict';
/* One workspace control; prompts go through the authenticated CPU service. */
(() => {
 const q=s=>document.querySelector(s), rawAPI=api;
 let connection={connected:false,enabled:false,model:'gpt-6.1-sol'}, busy=false,lastReview=null,progressMessage='',connectionVersion=0;
 const skipSubmit=new WeakSet(),skipClick=new WeakSet();
 const forms={
  'story-setup-form':['story','textarea[name="summary"]'],
  'new-story-form':['story','textarea[name="summary"]'],
  'director-form':['storyboard','textarea[name="story"]'],
  'image-form':['image','textarea[name="prompt"],input[name="negative"]'],
  'edit-image-form':['image','textarea[name="prompt"]'],
  'compose-characters':['image','textarea[name="prompt"]'],
  'character-form':['character','textarea[name="description"]'],
  'audio-form':['audio','textarea[data-field="text"]'],
  'video-form':['video',''],
  'publish-form':['publish','input[name="title"],textarea[name="description"]']
 };
 const actions={'save-board':'storyboard','director-save':'storyboard','oe-ai':'image'};
 const showError=error=>window.EccoErrors.show(error,{title:'AI assistance'});
 function setConnection(value){if(['enabled','connected','model'].some(key=>value[key]!==undefined&&value[key]!==connection[key])){connectionVersion++;progressMessage='';}connection={...connection,...value};if(state?.config){state.config.ai=connection;state.config.ai_story_planner={ready:!!connection.enabled};}mount();}
 async function readStatus(){
  if(!window.EccoStorage?.ready){setConnection({connected:false,enabled:false});return connection;}
  const version=connectionVersion,value=await rawAPI('ai/status');if(version===connectionVersion)setConnection(value);return connection;
 }
 api=async function(path,...args){const value=await rawAPI(path,...args);if(path==='state'&&value.config?.ai)setConnection(value.config.ai);return value;};
 function connections(){
  const dialog=q('#connection-dialog'),root=q('#connections');
  dialog.querySelector('h2').textContent='Connections';
  root.innerHTML='<section class="connection" id="openai-connection"><div class="connection-heading"><h3>AI · OpenAI</h3><button type="button" class="secondary" id="connect-openai">Connect</button></div><p class="help" data-ai-status>Checking connection…</p><p class="help">Refines your story, image, audio and video prompts. Usage is billed to your OpenAI project.</p><label class="ai-global-control"><input type="checkbox" role="switch" id="enable-studio-ai"><span>Enable AI across Studios</span></label><button type="button" class="secondary" data-ai-disconnect hidden>Disconnect</button></section><section class="connection"><div class="connection-heading"><h3>Storage</h3><button type="button" class="secondary" data-storage>Connect</button></div><p class="help">Save and access your libraries independently of GPU generation.</p></section><section class="connection" id="gpu-connection"><div class="connection-heading"><h3>GPU</h3><button type="button" class="secondary" data-gpu-connect>Connect</button></div><p class="help">Connect an accelerator when you need to generate images, audio or video.</p></section>';
  const gpu=root.querySelector('#gpu-connection');
  gpu.querySelector('button').onclick=()=>{dialog.close();connectGPU('connections');};
  root.querySelector('[data-storage]').onclick=()=>{dialog.close();window.EccoStorage.open();};
  root.querySelector('#connect-openai').onclick=openKeyDialog;
  root.querySelector('[data-ai-disconnect]').onclick=async()=>{try{setConnection(await rawAPI('ai/disconnect',{}));renderConnection();}catch(error){showError(error);}};
  root.querySelector('#enable-studio-ai').onchange=async e=>{
   const control=e.target;control.disabled=true;
   try{setConnection(await rawAPI('ai/settings',{enabled:control.checked}));}
   catch(error){showError(error);}finally{renderConnection();}
  };
  if(!dialog.open)dialog.showModal();
  renderConnection();readStatus().then(renderConnection).catch(error=>{root.querySelector('[data-ai-status]').textContent='OpenAI connection unavailable.';showError(error);});
 }
 function renderConnection(){
  const root=q('#openai-connection');if(!root)return;
  root.querySelector('[data-ai-status]').textContent=connection.connected?'Connected · '+connection.model+(connection.enabled?' · AI enabled across Studio':' · AI disabled'):'Not connected';
  const control=root.querySelector('#enable-studio-ai');control.checked=!!connection.enabled;control.disabled=!connection.connected;
  root.querySelector('[data-ai-disconnect]').hidden=!connection.connected;
  const button=root.querySelector('#connect-openai');button.textContent=connection.connected?'Connected':'Connect';button.dataset.connected=String(!!connection.connected);
  const storage=q('#connections [data-storage]'),gpu=q('#connections [data-gpu-connect]');
  if(storage){const ready=!!window.EccoStorage?.ready;storage.dataset.connected=String(ready);storage.textContent=ready?'Connected':'Connect';}
  if(gpu){const ready=!!q('#connected-accelerator')?.classList.contains('accelerator-connected');gpu.dataset.connected=String(ready);gpu.textContent=ready?'Connected':'Connect';}
 }
 function openKeyDialog(){
  if(!window.EccoStorage?.ready){showError('Connect workspace storage first, then return to Connect to OpenAI. No GPU is required.');return;}
  let dialog=q('#openai-key-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='openai-key-dialog';document.body.append(dialog);}
  dialog.innerHTML='<form class="form"><h2>Connect to OpenAI</h2><label>OpenAI project API key<input type="password" name="api_key" required autocomplete="off" spellcheck="false" placeholder="sk-…"></label><p class="help">Create a key in your <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI API account</a>. It is sent over HTTPS to this workspace’s private application server and is never saved in browser storage or GitHub.</p><label>AI model<select name="model"><option value="gpt-6.1-sol">GPT-6.1 Sol</option><option value="gpt-6-astra">GPT-6 Astra</option></select></label><p class="help">Connecting runs a small API test and enables AI across Studio. An API account with billing and model access is required.</p><p role="status"></p><div class="row"><button type="submit">Verify & connect</button><button type="button" class="secondary" data-close>Cancel</button></div></form>';
  const form=dialog.querySelector('form');form.elements.model.value=connection.connected?connection.model:'gpt-6.1-sol';
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.onclose=()=>{form.elements.api_key.value='';};
  form.onsubmit=async event=>{
   event.preventDefault();const button=form.querySelector('[type=submit]'),input=form.elements.api_key,key=input.value.trim();input.value='';
   button.disabled=true;form.querySelector('[role=status]').textContent='Verifying OpenAI access…';
   try{setConnection(await rawAPI('ai/connect',{api_key:key,model:form.elements.model.value}));dialog.close();renderConnection();notice('OpenAI connected. AI is enabled across Studio.');}
   catch(error){form.querySelector('[role=status]').textContent='Connection was not saved.';showError(error);}
   finally{button.disabled=false;}
  };
  if(!dialog.open)dialog.showModal();
 }
 function stageFor(element){
  const form=element.closest('form');if(form&&forms[form.id])return forms[form.id][0];
  return page==='board'||page==='director'?'storyboard':page==='audio'?'audio':page==='publish'?'publish':'image';
 }
 function contextFor(scope,stage){
  const context={model:scope.querySelector('#job-model')?.value||scope.querySelector('[name=model]')?.value||''};
  for(const name of ['title','summary','story','style','genre','language','emotion','voice','seconds','count','speed','pitch','pause']){
   const field=scope.querySelector('[name="'+name+'"]');if(field)context[name==='story'?'summary':name]=field.value;
  }
  const scene=q('#image-scene-controls');
  if(stage==='image'&&scene){context.style=q('#image-style')?.value||'';context.scene_controls=[...scene.querySelectorAll('input,select')].map(x=>({label:x.closest('label')?.textContent.trim(),value:x.value}));}
  if(stage==='storyboard'&&page==='board')context.scenes=structuredClone(draft.scenes);
  if(stage==='audio')context.lines=[...scope.querySelectorAll('.audio-line')].map(line=>Object.fromEntries([...line.querySelectorAll('[data-field]')].map(x=>[x.dataset.field,x.value])));
  return context;
 }
 function referencesFor(scope,context){
  const references=[scope.querySelector('#studio-reference-image')?.value];
  if(scope.id==='image-form'&&refinementSource)references.push(refinementSource.id);
  for(const scene of context.scenes||[])if(scene.image_id&&!references.includes(scene.image_id))references.push(scene.image_id);
  const characterIds=[...scope.querySelectorAll('[name=character_ids]:checked')].map(x=>x.value);
  return {reference_ids:references.filter(Boolean),character_ids:characterIds};
 }
 function collect(scope,stage,selector){
  const elements=[...scope.querySelectorAll(selector||'textarea')].filter(el=>!el.disabled&&!el.readOnly);
  return elements.map((element,index)=>({element,id:'field_'+index,text:element.value,max_length:element.maxLength>0?element.maxLength:100000}));
 }
 function actionFields(button){
  if(button.id==='split')return collect(q('#page'),'storyboard','#story-text');
  if(button.id==='save-board')return collect(q('#page'),'storyboard','#story-text,textarea[data-field="motion"],textarea[data-field="narration"]');
  if(button.id==='oe-ai')return collect(button.closest('dialog'),'image','#oe-instruction,#oe-ai-fields input');
  return collect(button.closest('.director-shot')||q('#page'),'storyboard','textarea[data-dfield]');
 }
 function videoReview(form){
  const board=boards().find(b=>b.id===form.elements.board_id.value);
  if(!board)throw Error('Choose a storyboard revision before AI review.');
  const context=contextFor(form,'video');context.title=board.title;context.scenes=structuredClone(board.scenes);
  const fields=board.scenes.map((scene,index)=>({id:'shot_'+index,text:scene.motion||'',max_length:12000}));
  if(!fields.length)throw Error('The selected storyboard has no shots to review.');
  return {fields,context,review_only:true,board_id:board.id};
 }
 async function enhance(scope,stage,fields,extra={}){
  if(busy)throw Error('An AI review is already running. Wait for it to finish.');
  if(!connection.enabled){connections();throw Error('Enable AI across Studio in Connections first.');}
  if(!fields.length||!fields.some(f=>f.text.trim()))throw Error('Enter your idea or prompt before using AI.');
  const version=connectionVersion,storyAtStart=activeStory,context=extra.context||contextFor(scope,stage),snapshot=JSON.stringify(context);
  busy=true;showBusy('AI is reviewing '+stage+' prompts…');
  try{
   const result=await rawAPI('ai/enhance',{stage,story_id:['story-setup-form','new-story-form','director-form'].includes(scope.id)?null:activeStory,fields:fields.map(({id,text,max_length})=>({id,text,max_length})),context,...referencesFor(scope,context),review_only:!!extra.review_only});
   if(version!==connectionVersion||!window.EccoStorage?.ready)throw Error('The AI connection changed during review. Nothing was applied.');
   if(activeStory!==storyAtStart||!scope.isConnected||fields.some(f=>f.element&&(!f.element.isConnected||f.element.value!==f.text))||(!extra.review_only&&JSON.stringify(contextFor(scope,stage))!==snapshot))throw Error('Your draft or selection changed during AI review. Nothing was applied; review the current text again.');
   if(extra.board_id&&scope.elements.board_id.value!==extra.board_id)throw Error('The selected storyboard changed during AI review. Review it again.');
   const byId=new Map(result.revisions.map(r=>[r.id,r.text]));
   if(byId.size!==fields.length||fields.some(f=>!byId.has(f.id)||typeof byId.get(f.id)!=='string'||byId.get(f.id).length>f.max_length))throw Error('The AI review returned an invalid revision. Your original text is unchanged.');
   lastReview={stage,result,fields:fields.map(f=>({...f,after:byId.get(f.id)})),applied:false};
   if(result.questions?.length)throw Error('AI needs clarification before continuing:\n\n'+result.questions.join('\n')+'\n\nUpdate your draft and try again.');
   if(!extra.review_only){
    for(const field of lastReview.fields){if(field.element&&field.element.value!==field.after){field.element.value=field.after;field.element.dispatchEvent(new Event('input',{bubbles:true}));field.element.dispatchEvent(new Event('change',{bubbles:true}));}}
    lastReview.applied=true;
   }
   showBusy('AI '+(extra.review_only?'review complete':'prompts refined')+' · '+result.model);return result;
  }catch(error){showBusy('AI review stopped · no changes applied');throw error;}finally{busy=false;mount();}
 }
 function showBusy(message){progressMessage=message;const bar=q('#studio-ai-status');if(bar)bar.querySelector('[data-ai-message]').textContent=message;}
 function reviewDialog(){
  if(!lastReview)return;
  let dialog=q('#ai-review-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='ai-review-dialog';document.body.append(dialog);}
  const review=lastReview;dialog.innerHTML='<div class="form"><h2>AI prompt review</h2><p class="help">'+esc(review.stage+' · '+review.result.model)+'</p>'+(review.result.questions?.length?'<p class="ai-questions">'+esc(review.result.questions.join('\n'))+'</p>':'')+'<p class="help">'+esc(review.result.notes.join('\n'))+'</p>'+review.fields.map(field=>'<details><summary>'+esc(field.id)+'</summary><label>Original<textarea readonly>'+esc(field.text)+'</textarea></label><label>AI revision<textarea readonly>'+esc(field.after)+'</textarea></label></details>').join('')+'<div class="row"><button type="button" class="secondary" data-undo>Restore original text</button><button type="button" data-close>Close</button></div></div>';
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  const undo=dialog.querySelector('[data-undo]');undo.disabled=!review.applied||review.fields.some(f=>!f.element?.isConnected||f.element.value!==f.after);
  undo.onclick=()=>{for(const field of review.fields){field.element.value=field.text;field.element.dispatchEvent(new Event('input',{bubbles:true}));}review.applied=false;dialog.close();};
  dialog.showModal();
 }
 async function assistForm(form){
  const [stage,selector]=forms[form.id];
  if(stage==='video'){const review=videoReview(form);return enhance(form,stage,review.fields,review);}
  return enhance(form,stage,collect(form,stage,selector));
 }
 document.addEventListener('submit',async event=>{
  const form=event.target;if(!forms[form.id]||!connection.enabled||skipSubmit.has(form))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(busy)return;
  const button=event.submitter;const originalDisabled=button?.disabled;let forwarded=false;if(button)button.disabled=true;
  try{await assistForm(form);if(button)button.disabled=originalDisabled;skipSubmit.add(form);try{form.requestSubmit(button||undefined);forwarded=true;}finally{skipSubmit.delete(form);}}
  catch(error){showError(error);}finally{if(!forwarded&&button?.isConnected)button.disabled=originalDisabled;}
 },true);
 document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||!connection.enabled||skipClick.has(button)||button.disabled)return;
  const stage=actions[button.id]||(button.hasAttribute('data-redo-shot')?'storyboard':null);if(!stage)return;
  event.preventDefault();event.stopImmediatePropagation();if(busy)return;
  button.disabled=true;let forwarded=false;
  try{await enhance(button.closest('dialog')||q('#page'),stage,actionFields(button));button.disabled=false;skipClick.add(button);try{button.click();forwarded=true;}finally{skipClick.delete(button);}}
  catch(error){showError(error);}finally{if(!forwarded&&button.isConnected)button.disabled=false;}
 },true);
 function mount(){
  const settings=q('#settings');if(settings){if(settings.textContent!=='Connections')settings.textContent='Connections';settings.onclick=connections;}
  document.querySelectorAll('.ai-prompt-assist').forEach(button=>button.remove());
  const accelerator=q('#connected-accelerator'),header=q('main > header .header-right');
  let button=q('#studio-ai-button');
  if(!button&&header){button=document.createElement('span');button.id='studio-ai-button';button.textContent='✦';button.setAttribute('role','img');header.append(button);}
  if(button){
   if(accelerator){const storage=q('#studio-storage-indicator'),next=storage||accelerator;if(button.nextElementSibling!==next)next.before(button);}
   button.dataset.connected=String(!!connection.connected);
   button.setAttribute('aria-label',connection.connected?'AI connected':'AI not connected');
  }
  let storage=q('#studio-storage-indicator');
  if(!storage&&header){storage=document.createElement('span');storage.id='studio-storage-indicator';storage.setAttribute('role','img');storage.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></svg>';header.append(storage);}
  if(storage){if(button&&button.nextElementSibling!==storage)button.after(storage);const connected=!!window.EccoStorage?.ready;storage.dataset.connected=String(connected);storage.setAttribute('aria-label',connected?'Storage connected':'Storage not connected');}
  if(header&&button&&storage&&accelerator){
   let panel=q('#connection-indicators');
   if(!panel){panel=document.createElement('div');panel.id='connection-indicators';panel.setAttribute('role','group');panel.setAttribute('aria-label','Connection status');header.prepend(panel);}
   for(const icon of [button,storage,accelerator])if(icon.parentElement!==panel)panel.append(icon);
  }
  for(const id of ['connect-storage','reconnect-gpu']){const extra=document.getElementById(id);if(extra)extra.hidden=true;}
  const pageRoot=q('#page');let bar=q('#studio-ai-status');
  const show=pageRoot&&(Object.keys(forms).some(id=>pageRoot.querySelector('#'+id))||['board','director','characters'].includes(page));
  if(show&&!bar){bar=document.createElement('div');bar.id='studio-ai-status';bar.innerHTML='<span data-ai-message></span><button type="button" class="small secondary" data-review>View AI review</button>';pageRoot.prepend(bar);bar.querySelector('[data-review]').onclick=reviewDialog;}
  if(bar){bar.hidden=!progressMessage&&!lastReview;bar.dataset.enabled=String(!!connection.enabled);const text=progressMessage,label=bar.querySelector('[data-ai-message]');if(label.textContent!==text)label.textContent=text;bar.querySelector('[data-review]').hidden=!lastReview;}
 }
 window.EccoAI={connections,open:openKeyDialog,get enabled(){return connection.enabled;},refresh:readStatus};
 let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;mount();},0);}).observe(document.body,{childList:true,subtree:true});
 setInterval(()=>{mount();if(q('#connection-dialog')?.open)renderConnection();},2000);
 mount();if(window.EccoStorage?.ready)readStatus().catch(()=>{});
})();
