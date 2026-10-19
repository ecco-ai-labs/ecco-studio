'use strict';
/* One workspace control; prompts go through the authenticated CPU service. */
(() => {
 const q=s=>document.querySelector(s), rawAPI=api;
 let connection={connected:false,enabled:false,model:'gpt-6.1-sol'}, busy=false,lastReview=null,progressMessage='',connectionVersion=0;
 const promptControls=new Map();let promptId=0;
 const forms={
  'story-setup-form':['story','input[name="title"],textarea[name="summary"]'],
  'new-story-form':['story','textarea[name="summary"]'],
  'director-form':['storyboard','textarea[name="story"]'],
  'video-form':['video','textarea[name="prompt"]'],
  'image-form':['image','textarea[name="prompt"],input[name="negative"]'],
  'edit-image-form':['image','textarea[name="prompt"]'],
  'compose-characters':['image','textarea[name="prompt"]'],
  'character-form':['character','textarea[name="description"]'],
  'audio-form':['audio','textarea[data-field="text"]'],
  'workflow-form':['story','textarea[name="prompt"]'],
  'publish-form':['publish','input[name="title"],textarea[name="description"]']
 };
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
  root.innerHTML='<section class="connection" id="openai-connection"><div class="connection-heading"><h3>AI</h3><button type="button" class="secondary" id="connect-openai">Connect</button></div><p class="help">Refines your story, image, audio and video prompts. API usage is billed separately.</p><label class="ai-global-control"><input type="checkbox" role="switch" id="enable-studio-ai"><span>Enable AI across Studios</span></label><button type="button" class="secondary" data-ai-disconnect hidden>Disconnect</button></section><section class="connection"><div class="connection-heading"><h3>Storage</h3><button type="button" class="secondary" data-storage>Connect</button></div><p class="help">Save and access your libraries independently of GPU generation.</p></section><section class="connection" id="gpu-connection"><div class="connection-heading"><h3>GPU</h3><button type="button" class="secondary" data-gpu-connect>Connect</button></div><p class="help">Connect an accelerator when you need to generate images, audio or video.</p></section>';
  const gpu=root.querySelector('#gpu-connection');
  gpu.querySelector('button').onclick=()=>{connectGPU('accelerator-status');};
  root.querySelector('[data-storage]').onclick=()=>{window.EccoStorage.open();};
  root.querySelector('#connect-openai').onclick=openKeyDialog;
  root.querySelector('[data-ai-disconnect]').onclick=async()=>{try{setConnection(await rawAPI('ai/disconnect',{}));renderConnection();}catch(error){showError(error);}};
  root.querySelector('#enable-studio-ai').onchange=async e=>{
   const control=e.target;control.disabled=true;
   try{setConnection(await rawAPI('ai/settings',{enabled:control.checked}));}
   catch(error){showError(error);}finally{renderConnection();}
  };
  if(!dialog.open)dialog.showModal();
  renderConnection();readStatus().then(renderConnection).catch(showError);
 }
 function renderConnection(){
  const root=q('#openai-connection');if(!root)return;
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
 function contextFor(scope,stage){
  const context={model:scope.querySelector('#job-model')?.value||scope.querySelector('[name=model]')?.value||''};
  for(const name of ['title','summary','story','style','genre','language','emotion','voice','seconds','count','speed','pitch','pause']){
   const field=scope.querySelector('[name="'+name+'"]');if(field)context[name==='story'?'summary':name]=field.value;
  }
  const scene=q('#image-scene-controls');
  if(stage==='image'&&scene){context.style=q('#image-style')?.value||'';context.scene_controls=[...scene.querySelectorAll('input,select')].map(x=>({label:x.closest('label')?.textContent.trim(),value:x.value}));}
  if(stage==='storyboard'&&page==='board'){context.title=q('#board-title')?.value||draft.title;context.summary=q('#story-text')?.value||'';context.scenes=structuredClone(draft.scenes);}
  if(stage==='audio')context.lines=[...scope.querySelectorAll('.audio-line')].map(line=>Object.fromEntries([...line.querySelectorAll('[data-field]')].map(x=>[x.dataset.field,x.value])));
  return context;
 }
 function referencesFor(scope,context){
  const shared=window.EccoGeneration?.aiContext(scope);
  const references=shared?[...shared.reference_ids]:[scope.querySelector('#studio-reference-image')?.value];
  if(scope.id==='image-form'&&refinementSource)references.push(refinementSource.id);
  for(const scene of context.scenes||[])if(scene.image_id&&!references.includes(scene.image_id))references.push(scene.image_id);
  const characterIds=[...scope.querySelectorAll('[name=character_ids]:checked')].map(x=>x.value);
  return {reference_ids:references.filter(Boolean),character_ids:characterIds};
 }
 function bindings(){
  const result=new Map(),add=(scope,stage,selector)=>{
   if(!scope)return;
   for(const element of scope.querySelectorAll(selector))if(!element.readOnly&&element.type!=='hidden')result.set(element,{scope,stage,element});
  };
  for(const [id,[stage,selector]] of Object.entries(forms))add(q('#'+id),stage,selector);
  add(q('#page'),'storyboard','#board-title,#story-text,#scenes textarea[data-field="motion"],#scenes textarea[data-field="narration"],#scenes input[data-subject-field="description"],#scenes input[data-subject-field="action"]');
  for(const shot of document.querySelectorAll('.director-shot'))add(shot,'storyboard','textarea[data-dfield]');
  add(q('#video-flow [data-step="3"]'),'audio','textarea[data-transcript]');
  add(q('#video-flow'),'video','textarea[data-brief],textarea[data-motion],textarea[data-shot-direction]');
  add(q('#video-audio-script'),'audio','textarea[data-script-editor]');
  add(q('#video-shot-controls'),'video','textarea[data-video-prompt]');
  const objectPrompt=q('#oe-instruction');add(objectPrompt?.closest('dialog'),'image','#oe-instruction,#oe-ai-fields input');
  return result;
 }
 function fieldName(element){
  if(element.getAttribute('aria-label'))return element.getAttribute('aria-label');
  const label=element.closest('label');
  return label?[...label.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim()||'Prompt':'Prompt';
 }
 function generationInstructions(options={}){
  return [options.instructions?.trim(),options.language?'Write the generated text in '+options.language+'. Use its native script unless the user asks for transliteration. Keep JSON keys, IDs and technical setting names unchanged.':''].filter(Boolean).join('\n');
 }
 function requestGeneration({label,key,onGenerate,isValid=()=>true}){
  if(busy)return;
  const story=activeStory,draftKey='ecco-ai-generation:'+story+':'+key,languageKey='ecco-ai-language:'+story;
  let saved={};try{saved=JSON.parse(localStorage.getItem(draftKey)||'{}');}catch{}
  q('#ai-generation-dialog')?.remove();
  const dialog=document.createElement('dialog');dialog.id='ai-generation-dialog';dialog.setAttribute('aria-label','Generate with AI');
  const languages=['English','Hindi','Urdu','Tamil','Punjabi','Telugu','Bengali','Marathi','Gujarati','Kannada','Malayalam','Arabic','Spanish','Portuguese','French','German','Chinese','Japanese','Korean'];
  dialog.innerHTML='<form class="form"><h2>Generate with AI</h2><p class="help">'+esc(label)+'</p><label>Output language<select name="language"><option value="">Use existing language</option>'+languages.map(language=>'<option>'+language+'</option>').join('')+'<option value="other">Other language</option></select></label><label data-other-language hidden>Language<input name="other_language" maxlength="80" placeholder="e.g. Assamese or Hindi and Urdu"></label><label>What should AI generate?<textarea name="instructions" maxlength="4000" rows="5" placeholder="e.g. Write 10 scenes in Hindi with natural dialogue and a dramatic tone."></textarea></label><p role="status" data-generation-status></p><div class="row"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Generate</button></div></form>';
  document.body.append(dialog);
  const form=dialog.querySelector('form'),select=form.elements.language,custom=form.elements.other_language,instructions=form.elements.instructions;
  const language=localStorage.getItem(languageKey)||saved.language||'';
  select.value=!language||languages.includes(language)?language:'other';custom.value=select.value==='other'?language:'';instructions.value=saved.instructions||'';
  const syncLanguage=()=>{form.querySelector('[data-other-language]').hidden=select.value!=='other';custom.required=select.value==='other';};syncLanguage();select.onchange=syncLanguage;
  form.querySelector('[data-cancel]').onclick=()=>dialog.close();
  form.onsubmit=event=>{
   event.preventDefault();if(!form.reportValidity())return;
   if(activeStory!==story||!isValid()){form.querySelector('[data-generation-status]').textContent='Your draft or selection changed. Reopen Generate with AI for the current field.';return;}
   const options={language:select.value==='other'?custom.value.trim():select.value,instructions:instructions.value.trim()};
   if(select.value==='other'&&!options.language){custom.focus();return;}
   localStorage.setItem(draftKey,JSON.stringify(options));localStorage.setItem(languageKey,options.language);
   dialog.close();Promise.resolve().then(()=>onGenerate(options)).catch(showError);
  };
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();instructions.focus();
 }
 function generateWithInstructions(binding){
  const original=binding.element.value,snapshot=JSON.stringify(snapshotFor(binding));
  return requestGeneration({label:binding.label,key:binding.stage+':'+(binding.element.id||binding.element.name||binding.element.dataset.field||binding.label),isValid:()=>binding.element.isConnected&&binding.scope.isConnected&&binding.element.value===original&&JSON.stringify(snapshotFor(binding))===snapshot,onGenerate:options=>improve({...binding,generationRequest:options})});
 }
 function snapshotFor(binding){
  const flow=(binding.element.closest('#video-flow')||binding.element.closest('#video-shot-controls')||binding.element.closest('#video-audio-script'))?.eccoAIContext?.(binding.element);
  const shared=flow||window.EccoGeneration?.aiContext(binding.scope,binding.element);
  const context={...contextFor(binding.scope,binding.stage),...shared?.context};
  // Keep the target field's role clear, especially negative prompts and individual dialogue lines.
  context.instructions=binding.generateField?'Generate content for only the selected field: '+binding.label+'. Use the current story title and script as context. Return only the requested field content. Do not replace other fields.':binding.generateStory?'Generate a complete story summary from the instructions in this field. Follow the supplied title and genre. Return the story itself, not a rewritten prompt. Editable field: '+binding.label:'Editable field: '+binding.label;
  if(shared)context.instructions+=' '+shared.context.instructions;
  if(binding.generationRequest){context.instructions+='\nUser generation request:\n'+generationInstructions(binding.generationRequest);if(binding.generationRequest.language)context.language=binding.generationRequest.language;}
  if(binding.scope.id==='image-form')context.summary=binding.scope.querySelector('[name="prompt"]')?.value||'';
  if(binding.scope.id==='workflow-form'){
   context.title=binding.scope.querySelector('[name="name"]')?.value||'';
   context.seconds=binding.scope.querySelector('[name="duration"]')?.value||'';
  }
  if(binding.scope.matches('.director-shot'))context.scenes=[Object.fromEntries([...binding.scope.querySelectorAll('[data-dfield]')].map(el=>[el.dataset.dfield,el.value]))];
  return {context,...referencesFor(binding.scope,context),...(flow?{reference_ids:flow.reference_ids,video_reference_ids:flow.video_reference_ids}:{})};
 }
 function validReview(review){
  if(review.version!==connectionVersion||!connection.enabled||!window.EccoStorage?.ready)throw Error('The AI connection changed. Request a new suggestion before applying.');
  if(activeStory!==review.story||!review.scope.isConnected||!review.element.isConnected||review.element.value!==review.original||JSON.stringify(snapshotFor(review))!==review.snapshot)throw Error('Your draft or selection changed. Request a new suggestion for the current text.');
 }
 async function improve(binding){
  if(busy)return;
  if(!window.EccoStorage?.ready||!connection.enabled){connections();return;}
  const {element,scope,stage}=binding;
  if(binding.generateField&&scope.dataset.generationStudio&&!connection.generation_modes?.includes('generate')){showError('Generate with AI needs the prepared AI service update. Improve using AI is available now.');return;}
  if(!element.value.trim()&&!binding.generateField){element.focus();notice('Enter an idea or prompt first, then choose Improve with AI.',true);return;}
  const details=snapshotFor(binding),review={...binding,original:element.value,version:connectionVersion,story:activeStory,snapshot:JSON.stringify(details),maxLength:element.maxLength>0?element.maxLength:100000,applied:false};
  const fieldId=('field_'+(element.name||element.dataset.field||element.dataset.dfield||element.id||'prompt')).replace(/[^A-Za-z0-9_.:-]/g,'_').slice(0,100);
  busy=true;binding.pending=true;showBusy('AI is '+(binding.generateField?'generating ':'improving ')+binding.label.toLowerCase()+'…');document.dispatchEvent(new CustomEvent('ecco-ai-busy',{detail:{busy:true,generate:!!binding.generateField}}));mountPromptControls();
  try{
   const brief=review.original||(binding.generateField?(generationInstructions(binding.generationRequest)||'Generate '+binding.label+' for '+(draft.title||'the selected story')).slice(0,review.maxLength):'');
   const result=await rawAPI('ai/enhance',{stage,mode:binding.generateField?'generate':'improve',story_id:['story-setup-form','new-story-form','director-form','workflow-form'].includes(scope.id)?null:activeStory,fields:[{id:fieldId,text:brief,max_length:review.maxLength}],...details,review_only:false});
   validReview(review);
   if(!Array.isArray(result.revisions)||result.revisions.length!==1||result.revisions[0].id!==fieldId||typeof result.revisions[0].text!=='string'||result.revisions[0].text.length>review.maxLength)throw Error('AI returned an invalid suggestion. Your original text is unchanged.');
   review.result=result;review.suggestion=result.revisions[0].text;lastReview=review;
   showBusy(result.questions?.length?'AI needs clarification':'AI suggestion ready');reviewDialog();
  }catch(error){showBusy('AI suggestion stopped · your text is unchanged');showError(error);}
  finally{busy=false;binding.pending=false;document.dispatchEvent(new CustomEvent('ecco-ai-busy',{detail:{busy:false}}));mount();}
 }
 function showBusy(message){progressMessage=message;const bar=q('#studio-ai-status');if(bar)bar.querySelector('[data-ai-message]').textContent=message;}
 function reviewDialog(){
  if(!lastReview)return;
  let dialog=q('#ai-review-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='ai-review-dialog';document.body.append(dialog);}
  const review=lastReview,questions=review.result.questions||[],notes=review.result.notes||[];
  dialog.innerHTML='<div class="form"><h2>'+(review.generateField?'Generate with AI':review.generateStory?'Generate using AI':'Improve with AI')+'</h2><p class="help">'+esc(review.label)+'</p>'+(questions.length?'<p class="ai-questions">'+esc(questions.join('\n'))+'</p>':'')+'<p class="help ai-review-notes">'+esc(notes.join('\n'))+'</p><details><summary>Original</summary><label>Original text<textarea readonly>'+esc(review.original)+'</textarea></label></details><label>AI suggestion<textarea data-suggestion maxlength="'+review.maxLength+'">'+esc(review.suggestion)+'</textarea></label><p role="status" data-apply-status></p><div class="row"><button type="button" class="secondary" data-cancel>Cancel</button><button type="button" data-apply>Apply</button></div></div>';
  const input=dialog.querySelector('[data-suggestion]'),apply=dialog.querySelector('[data-apply]'),status=dialog.querySelector('[data-apply-status]');
  input.oninput=()=>{review.suggestion=input.value;};
  apply.disabled=review.applied;
  if(review.applied){input.readOnly=true;status.textContent='Suggestion applied.';dialog.querySelector('[data-cancel]').textContent='Close';}
  apply.onclick=()=>{
   try{
    validReview(review);
    if(input.value.length>review.maxLength)throw Error('Keep this suggestion within '+review.maxLength+' characters.');
    review.element.value=input.value;
    review.element.dispatchEvent(new Event('input',{bubbles:true}));review.element.dispatchEvent(new Event('change',{bubbles:true}));
    review.suggestion=input.value;review.applied=true;showBusy('AI suggestion applied');dialog.close();review.element.focus();mount();
   }catch(error){status.textContent=error.message;showError(error);}
  };
  dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
  if(!dialog.open)dialog.showModal();input.focus();
 }
 function mountPromptControls(){
  const current=bindings();
  for(const [element,entry] of promptControls){
   if(!current.has(element)||!element.isConnected){
    // Preserve the original label if a field becomes read-only or is removed by its editor.
    if(entry.toolbar.isConnected){entry.toolbar.replaceWith(...entry.labelNode.childNodes);}
    if(element.getAttribute('aria-labelledby')===entry.labelNode.id)element.removeAttribute('aria-labelledby');
    promptControls.delete(element);
   }
  }
  for(const [element,binding] of current){
   if(element.closest('[data-generation-studio],#video-audio-script'))continue;
   let entry=promptControls.get(element);
   if(!entry){
    const label=fieldName(element),toolbar=document.createElement('span'),labelNode=document.createElement('span'),button=document.createElement('button');
    toolbar.className='ai-prompt-toolbar';labelNode.className='ai-prompt-label';labelNode.id='ai-prompt-label-'+(++promptId);
    const parent=element.parentElement;
    if(parent.tagName==='LABEL')for(const node of [...parent.childNodes]){if(node===element)break;if(node.nodeType===3)labelNode.append(node);}
    if(!labelNode.textContent.trim())labelNode.textContent=label;
    button.type='button';button.className='secondary ai-prompt-assist';button.textContent='Improve with AI';button.setAttribute('aria-label','Improve '+label.toLowerCase()+' with AI');
    toolbar.append(labelNode,button);element.before(toolbar);
    if(!element.hasAttribute('aria-label')&&!element.hasAttribute('aria-labelledby'))element.setAttribute('aria-labelledby',labelNode.id);
    entry={...binding,label,toolbar,labelNode,button,pending:false};promptControls.set(element,entry);button.onclick=()=>improve(entry);
   }
   entry.scope=binding.scope;entry.stage=binding.stage;
   const disabled=busy||element.disabled; if(entry.button.disabled!==disabled)entry.button.disabled=disabled;
   const text=entry.pending?'Improving…':'Improve with AI';if(entry.button.textContent!==text)entry.button.textContent=text;
   entry.button.setAttribute('aria-busy',String(entry.pending));
  }
 }

 function mountStoryAI(){
  const form=q('#story-setup-form');if(!form||q('#story-description-ai'))return;
  const menu=document.createElement('details');menu.id='story-description-ai';menu.className='storyboard-ai-floating';
  menu.innerHTML='<summary aria-label="AI assistance">AI</summary><div class="storyboard-ai-actions"><button type="button" class="secondary" data-generate>Generate with AI</button><button type="button" class="secondary" data-improve>Improve with AI</button></div>';
  q('#page').append(menu);
  let selected=form.elements.summary;
  const choose=element=>{form.querySelectorAll('.ai-selected-field').forEach(el=>el.classList.remove('ai-selected-field'));selected=element;selected.classList.add('ai-selected-field');};
  choose(selected);
  form.addEventListener('focusin',event=>{if(event.target.matches('input[name="title"],textarea[name="summary"]'))choose(event.target);});
  menu.querySelector('[data-generate]').onclick=()=>{menu.open=false;window.EccoAI.generateField(selected);};
  menu.querySelector('[data-improve]').onclick=()=>{menu.open=false;window.EccoAI.improveField(selected);};
 }

 function mount(){
  const settings=q('#settings');if(settings){if(settings.textContent!=='Connections')settings.textContent='Connections';settings.onclick=connections;}
  mountPromptControls();mountStoryAI();
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
   let menu=q('#connection-panel-menu');
   if(!menu){menu=document.createElement('details');menu.id='connection-panel-menu';menu.className='workspace-menu';menu.innerHTML='<summary aria-label="Connection options"><span aria-hidden="true">+</span></summary><div class="workspace-menu-items"></div>';panel.append(menu);}
   const items=menu.querySelector('.workspace-menu-items');
   if(settings&&settings.parentElement!==items)items.append(settings);
   if(settings)settings.onclick=()=>{menu.open=false;connections();};
  }
  for(const id of ['connect-storage','reconnect-gpu']){const extra=document.getElementById(id);if(extra)extra.hidden=true;}
  const pageRoot=q('#page');let bar=q('#studio-ai-status');
  const show=pageRoot&&[...promptControls.keys()].some(element=>pageRoot.contains(element));
  if(show&&!bar){bar=document.createElement('div');bar.id='studio-ai-status';bar.innerHTML='<span data-ai-message></span><button type="button" class="small secondary" data-review>View AI review</button>';pageRoot.prepend(bar);bar.querySelector('[data-review]').onclick=reviewDialog;}
  if(bar){bar.hidden=!progressMessage&&!lastReview;bar.dataset.enabled=String(!!connection.enabled);const text=progressMessage,label=bar.querySelector('[data-ai-message]');if(label.textContent!==text)label.textContent=text;bar.querySelector('[data-review]').hidden=!lastReview;}
 }
 window.EccoAI={improveField:element=>{const binding=bindings().get(element);if(!binding)return notice('Select an editable prompt first.',true);return improve({...binding,label:promptControls.get(element)?.label||fieldName(element)});},generateField:element=>{const binding=bindings().get(element);if(!binding)return notice('Select an editable text field first.',true);return generateWithInstructions({...binding,label:promptControls.get(element)?.label||fieldName(element),generateField:true});},requestGeneration,generationInstructions,connections,open:openKeyDialog,generateStory:form=>{const element=form.elements.summary;return generateWithInstructions({element,scope:form,stage:'story',label:'Story Idea / Summary',generateStory:true,generateField:true});},get enabled(){return connection.enabled;},refresh:readStatus};
 let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;mount();},0);}).observe(document.body,{childList:true,subtree:true});
 setInterval(()=>{mount();if(q('#connection-dialog')?.open)renderConnection();},2000);
 mount();if(window.EccoStorage?.ready)readStatus().catch(()=>{});
})();




