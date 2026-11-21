/* Generate with AI → Character. Persistent assets, explicit approvals, real jobs. */
(() => {
 'use strict';
 const q=(s,r=document)=>r.querySelector(s),all=(s,r=document)=>[...r.querySelectorAll(s)];
 const steps=['Appearance','Character set','3D model','Rig','Performance','Export'];
 const views={front:'Front',back:'Back',left:'Left side',right:'Right side',neutral:'Neutral',smile:'Smiling',angry:'Angry',fear:'Fear'};
 const active=j=>['queued','running','cancelling'].includes(j?.status);
 const label=s=>s[0].toUpperCase()+s.slice(1);
 let openDialog=null,viewerLoading=null;
 const id=()=>crypto.randomUUID().replaceAll('-','');
 const field=(text,html)=>'<label>'+esc(text)+html+'</label>';
 const button=(key,text,disabled=false)=>'<button type="button" class="secondary" data-action="'+key+'"'+(disabled?' disabled':'')+'>'+esc(text)+'</button>';
 function viewer(){
  if(customElements.get('model-viewer'))return Promise.resolve();
  if(!viewerLoading)viewerLoading=import('./vendor/model-viewer.min.js').catch(error=>{viewerLoading=null;throw error;});
  return viewerLoading;
 }
 async function open(form,brief=''){
  if(openDialog?.isConnected){openDialog.showModal();return;}
  const story=activeStory,origin=document.activeElement,context=window.EccoGeneration?.context(form);
  let records=state.records||[],capabilities=state.config.character_studio||{},step=0,current=null,busy=false,closed=false,selection='',pending=null,performanceId='';
  const storageKey='ecco-character-studio:'+story;
  let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{}
  current=records.find(r=>r.kind==='character'&&r.id===saved.character_id&&r.source_story_id===story&&!r.deleted)||null;
  pending=saved.pending||null;
  const dialog=document.createElement('dialog');dialog.id='character-studio-dialog';dialog.className='generation-dialog';dialog.setAttribute('aria-label','Generate with AI · Character');openDialog=dialog;
  dialog.innerHTML='<div class="form"><div class="section-head"><h2>Generate with AI · Character</h2><button type="button" class="secondary" data-close>Close</button></div>'+field('Character','<select data-character></select>')+'<nav class="generation-ai-actions" aria-label="Character stages">'+steps.map((name,i)=>'<button type="button" class="secondary" data-step="'+i+'">'+(i+1)+'. '+name+'</button>').join('')+'<section data-character-body></section><section class="generation-section" data-character-job hidden><progress aria-label="Character generation progress"></progress><p role="status" aria-live="polite" data-job-status></p>'+button('stop','Stop')+'</section><p role="status" aria-live="polite" data-status></p><div data-reconcile hidden>'+button('reconcile','Check submission')+'</div></div>';
  document.body.append(dialog);
  const body=q('[data-character-body]',dialog),status=q('[data-status]',dialog),picker=q('[data-character]',dialog);
  const draft={name:saved.draft?.name||'',description:saved.draft?.description||brief||form?.elements.prompt?.value||'',
   gpu:context?.compute?.value||'',quality:'high',action:'run',expression:'neutral',seconds:3,camera:'three-quarter',output:'clip'};
  if(current){draft.name=current.name;draft.description=current.description;}
  let createId=saved.create_id||id();
  const remember=()=>{
   const value={character_id:current?.id||'',create_id:createId,draft:{name:draft.name,description:draft.description}};
   if(pending)value.pending={path:pending.path,body:{...pending.body,data:undefined},upload:pending.upload};
   localStorage.setItem(storageKey,JSON.stringify(value));
  };
  const check=()=>{if(activeStory!==story)throw Error('Return to the original story before changing this character.');if(!window.EccoStorage?.ready)throw Error('Connect workspace storage to continue.');};
  const job=()=>records.filter(r=>(r.kind==='character_job'||r.source_kind==='character_job')&&r.character_id===current?.id).sort((a,b)=>b.created-a.created)[0];
  const running=()=>busy||active(job())||!!pending;
  const asset=aid=>records.find(r=>r.id===aid&&r.kind==='asset'&&!r.deleted);
  function merge(item){records=records.filter(r=>r.id!==item.id).concat([item]);if(item.kind==='character')current=item;}
  function showError(error){status.textContent=error.message||String(error);window.EccoErrorLog?.record?.(error,{source:'character-studio'});}
  async function act(fn){if(busy)return;saveDraft();busy=true;status.textContent='';syncJob();try{check();await fn();}catch(error){showError(error);}finally{busy=false;if(!closed){draw();syncJob();}}}
  function choices(){
   picker.replaceChildren(new Option('New character',''),...records.filter(r=>r.kind==='character'&&r.pipeline_version===1&&r.source_story_id===story&&!r.deleted).map(r=>new Option(r.name,r.id)));
   picker.value=current?.id||'';picker.disabled=busy||!!pending;
  }
  function syncJob(){
   const j=job(),box=q('[data-character-job]',dialog);box.hidden=!j;
   if(j){q('[data-job-status]',dialog).textContent=(j.progress||j.status)+(j.error&&j.error!==j.progress?' · '+j.error:'');
    const progress=q('progress',box);if(j.status==='done'){progress.max=1;progress.value=1;}else if(j.total>1){progress.max=j.total;progress.value=j.completed||0;}else progress.removeAttribute('value');
    q('[data-action=stop]',box).disabled=!active(j)||busy||j.status==='cancelling';}
   q('[data-reconcile]',dialog).hidden=!pending;
   for(const b of all('[data-action]',body))b.disabled=b.dataset.unavailable==='true'||running();
   picker.disabled=busy||!!pending;
  }
  async function refreshData(redraw=true){
   const data=await api('state');if(closed)return;
   records=data.records;capabilities=data.config.character_studio||{};
   if(current)current=records.find(r=>r.id===current.id&&r.kind==='character')||current;
   if(pending&&records.some(r=>r.id===pending.body.request_id)){pending=null;remember();}
   if(redraw)draw();syncJob();
  }
  function saveDraft(){
   for(const key of ['name','description','gpu','quality','action','expression','camera','output']){const e=q('[name='+key+']',body);if(e)draft[key]=e.value;}
   const seconds=q('[name=seconds]',body);if(seconds)draft.seconds=Number(seconds.value);
   remember();
  }
  async function saveCharacter(){
   saveDraft();check();
   if(!draft.name.trim()||!draft.description.trim())throw Error('Enter a character name and appearance description.');
   remember();
   const result=await api('character-studio/save',{...(current?{character_id:current.id,revision:current.revision}:{story_id:story,request_id:createId}),name:draft.name.trim(),description:draft.description.trim()});
   merge(result);remember();
  }
  function workerReady(stage){return capabilities.workers?.some(w=>w.id===draft.gpu&&w.ready&&w.capabilities?.[stage]);}
  function compute(){
   return field('Compute','<select name="gpu"><option value="">Select connected GPU</option>'+(window.EccoCompute?.choices()||[]).map(g=>'<option value="'+esc(g.id)+'"'+(draft.gpu===g.id?' selected':'')+'>'+esc(g.name+' · '+g.label)+'</option>').join('')+'</select>');
  }
  function quality(){return field('Quality','<select name="quality"><option value="preview"'+(draft.quality==='preview'?' selected':'')+'>Preview · 2K texture target</option><option value="high"'+(draft.quality==='high'?' selected':'')+'>High · 4K texture target</option></select>');}
  function control(key,text,available=true){return '<button type="button" class="secondary" data-action="'+key+'" data-unavailable="'+!available+'"'+(!available||running()?' disabled':'')+'>'+esc(text)+'</button>';}
  function preview(aid,title,selectable=false){const a=asset(aid);if(!a)return '';return '<figure class="character-preview"><img data-preview="'+esc(aid)+'" alt="'+esc(title)+'"><figcaption>'+esc(title)+'</figcaption>'+(selectable?'<label><input type="radio" name="appearance" value="'+esc(aid)+'"'+(selection===aid?' checked':'')+'>Choose appearance</label>':'')+'</figure>';}
  function modelPreview(outputs){if(!outputs)return '';const aid=outputs.rig||outputs.model;return preview(outputs.still,'Rendered preview')+(aid?'<model-viewer data-model="'+esc(aid)+'" camera-controls interaction-prompt="auto" shadow-intensity="1" alt="Rotatable 3D character"></model-viewer>':'');}
  function chosenPerformance(){return performanceId==='base'?null:current?.performances?.find(p=>p.job_id===performanceId)||current?.performances?.at(-1);}
  function exportButton(aid,text){const a=asset(aid);return a?'<button type="button" class="secondary" data-download="'+esc(aid)+'">'+esc(text)+'</button>':'';}
  function draw(){
   if(closed)return;
   choices();for(const b of all('[data-step]',dialog)){b.setAttribute('aria-current',Number(b.dataset.step)===step?'step':'false');b.setAttribute('aria-pressed',String(Number(b.dataset.step)===step));}
   let html='';
   if(!capabilities.available)html+='<p class="help">The Character service update is not running on your workspace yet. You can prepare the character brief; generation stays unavailable.</p>';
   if(step===0){
    html+=field('Name','<input name="name" maxlength="100" value="'+esc(draft.name)+'">')+field('Appearance','<textarea name="description" maxlength="4000"'+(current?.approved_image_id?' readonly':'')+'>'+esc(draft.description)+'</textarea>');
    html+='<div class="row">'+control('save',current?'Save name':'Save character',capabilities.available)+control('copy','New version',!!current)+'</div>'+compute();
    html+='<p class="help">Uses the image model selected in Image Studio. Approve one full-body image to establish this character’s identity.</p>';
    html+=control('appearance','Generate appearance',capabilities.available&&!current?.approved_image_id);
    const images=records.filter(r=>r.kind==='asset'&&r.media==='image'&&!r.deleted&&(r.story_id||LEGACY_STORY)===story);
    html+=field('Or choose an existing image','<select name="existing"><option value="">Choose image from this story</option>'+images.map(a=>'<option value="'+esc(a.id)+'"'+(selection===a.id?' selected':'')+'>'+esc(a.title||a.prompt?.slice(0,70)||a.id)+'</option>').join('')+'</select>');
    html+='<div class="generation-picker-grid">'+(current?.image_ids||[]).map((aid,i)=>preview(aid,'Appearance '+(i+1),!current.approved_image_id)).join('')+'</div>';
    if(selection&&!current?.image_ids?.includes(selection))html+=preview(selection,'Selected reference');
    html+=current?.approved_image_id?'<p class="help">Appearance approved.</p>':control('approve-appearance','Approve appearance',!!current&&!!selection);
   }else if(!current){html+='<p>Save a character in Appearance to continue.</p>';
   }else if(step===1){
    html+=compute()+'<p class="help">Review identity, clothing and proportions in every view. Each view is generated from the approved appearance.</p>'+control('sheet','Generate missing views',capabilities.available&&!!current.approved_image_id);
    html+='<div class="generation-picker-grid">'+Object.entries(views).map(([key,name])=>'<section>'+preview(current.views[key],name)+(current.views[key]?'':'<p>'+name+' · Not generated</p>')+control('view:'+key,current.views[key]?'Regenerate '+name:'Generate '+name,capabilities.available&&!!current.approved_image_id&&!current.approved_model_id)+'</section>').join('')+'</div>';
    html+=control('approve-sheet','Approve character set',Object.keys(current.views).length===8)+ (current.approved_views?'<p class="help">Character set approved.</p>':'');
   }else if(step===2){
    html+=compute()+quality()+'<p class="help">Builds geometry and textures from the approved front view. Use the other views to check identity and proportions. Texture size is a target; inspect the generated detail.</p>'+control('model','Build 3D model',!!current.approved_views&&workerReady('model'));
    if(!workerReady('model'))html+='<p class="help">3D generation is not ready on the selected compute.</p>';
    html+=modelPreview(current.model_outputs)+control('approve-model','Approve 3D model',!!current.model_asset_id);
   }else if(step===3){
    html+=compute()+'<p class="help">Generate the body skeleton and skin weights, then inspect the result. Facial controls are checked separately.</p>'+control('rig','Generate body rig',!!current.approved_model_id&&workerReady('rig'));
    if(!workerReady('rig'))html+='<p class="help">Body rigging is not ready on the selected compute.</p>';
    html+=modelPreview(current.rig_outputs);
    if(current.rig_report){const r=current.rig_report;html+='<p class="help">Body: '+(r.skinned?'skin weights present':'not ready')+' · '+(r.bone_count||0)+' bones. Actions: '+esc((r.actions||[]).join(', '))+'. Expressions: '+esc((r.expressions||['neutral']).join(', '))+'.</p>';if(r.missing_controls?.length)html+='<p class="help">Map these controls in Blender: '+esc(r.missing_controls.join(', '))+'.</p>';if(r.facial_status==='needs_facial_shape_keys')html+='<p class="help">This body rig has no facial expressions yet. Add and review smile, angry and fear shape keys in Blender, then import the GLB below.</p>';}
    html+='<details><summary>Import a reviewed rig from Blender</summary><p class="help">Self-contained GLB, up to 50 MB. Include skin weights, facial shape keys and custom properties. Import creates a new candidate for approval.</p>'+field('Rig file','<input name="rig_file" type="file" accept=".glb">')+control('upload','Import rig',!!current.approved_model_id&&workerReady('import'))+'<a href="characters/blender_addon.py" download>Download Blender review add-on</a></details>'+control('approve-rig','Approve rig',!!current.rig_asset_id);
   }else if(step===4){
    html+=compute();const report=current.rig_report||{};
    html+='<div class="generation-attribute-grid">'+field('Action','<select name="action">'+['stand','sit','run','jump','kick'].map(v=>'<option value="'+v+'"'+(draft.action===v?' selected':'')+(!(report.actions||[]).includes(v)?' disabled':'')+'>'+label(v)+'</option>').join('')+'</select>')+field('Expression','<select name="expression">'+['neutral','smile','angry','fear'].map(v=>'<option value="'+v+'"'+(draft.expression===v?' selected':'')+(!(report.expressions||['neutral']).includes(v)?' disabled':'')+'>'+label(v)+'</option>').join('')+'</select>')+field('Seconds','<input name="seconds" type="number" min="1" max="10" step="1" value="'+draft.seconds+'">')+field('Camera','<select name="camera">'+['front','three-quarter','side'].map(v=>'<option value="'+v+'"'+(draft.camera===v?' selected':'')+'>'+label(v)+'</option>').join('')+'</select>')+field('Output','<select name="output"><option value="clip"'+(draft.output==='clip'?' selected':'')+'>Animated clip and still</option><option value="still"'+(draft.output==='still'?' selected':'')+'>Posed still</option></select>')+'</div>'+quality();
    html+='<p class="help">These are editable movement previews. Review joint deformation and foot contact in Blender before a final shot. An unavailable expression needs facial controls added to the rig.</p>'+control('performance','Render performance',!!current.approved_rig_id&&workerReady('performance'));
    const latest=current.performances?.at(-1);if(latest){html+=preview(latest.outputs.still,'Performance still');if(latest.outputs.clip)html+='<video controls playsinline data-preview="'+esc(latest.outputs.clip)+'" aria-label="Rendered character performance"></video>';}
   }else{
    const latest=chosenPerformance(),outputs=latest?.outputs||current.rig_outputs||current.model_outputs||{};
    html+=field('Saved output','<select name="performance"><option value="base"'+(!latest?' selected':'')+'>Character model / rig</option>'+(current.performances||[]).map((p,i)=>'<option value="'+esc(p.job_id)+'"'+(latest?.job_id===p.job_id?' selected':'')+'>'+esc((i+1)+'. '+p.settings.action+' · '+p.settings.expression+' · '+p.settings.seconds+' sec')+'</option>').join('')+'</select>');
    html+='<div class="row">'+exportButton(outputs.blend,'Download Blender scene')+exportButton(latest?.settings.input_asset_id||current.rig_asset_id||current.model_asset_id,'Download GLB')+exportButton(outputs.still,'Download still')+exportButton(outputs.clip,'Download clip')+'</div>'+preview(outputs.still,'Export preview');
    if(outputs.clip)html+='<video controls playsinline data-preview="'+esc(outputs.clip)+'" aria-label="Rendered clip"></video>';
    html+='<div class="row">'+control('use-image','Use frame in Image Studio',!!outputs.still)+control('use-video','Use frame in Video Studio',!!outputs.still)+'</div><p class="help">Video Studio receives the rendered frame and performance prompt. The Blender clip is also downloadable; motion-video conditioning is not connected to the current video workflow.</p>';
   }
   body.innerHTML=html;
   body.oninput=()=>saveDraft();
   body.onchange=event=>{
    const target=event.target;
    if(target.name==='performance'){performanceId=target.value;draw();return;}
    if(target.name==='appearance'||target.name==='existing'){selection=target.value;draw();return;}
    saveDraft();if(target.name==='gpu')draw();
   };
   for(const element of all('[data-preview]',body))window.EccoStorage.mediaURL(element.dataset.preview).then(url=>{if(element.isConnected)element.src=url;}).catch(showError);
   const model=q('[data-model]',body);if(model)Promise.all([viewer(),window.EccoStorage.mediaURL(model.dataset.model)]).then(([,url])=>{if(model.isConnected)model.src=url;}).catch(showError);
   for(const b of all('[data-download]',body))b.onclick=()=>act(async()=>{const a=asset(b.dataset.download),url=await window.EccoStorage.mediaURL(a.id),link=document.createElement('a');link.href=url;link.download=(current.name.replace(/[^a-z0-9_-]/gi,'_')||'character')+'-'+a.character_role+'.'+a.path.split('.').at(-1);link.click();});
   syncJob();
  }
  async function submit(path,request){
   pending={path,body:request,upload:path.endsWith('/upload')};remember();
   try{const j=await api(path,request);merge(j);pending=null;remember();}
   catch(error){if(error.status>=400&&error.status<500){pending=null;remember();}throw error;}
  }
  async function generate(stage,view){
   saveDraft();if(!current)await saveCharacter();
   if(!draft.gpu||!window.EccoGPUConnection?.isConnected(draft.gpu))throw Error('Select a connected GPU in Compute.');
   let image_settings={};
   if(stage==='appearance'){
    const c=window.EccoGeneration.context(form);if(!c)throw Error('Reopen Character from Image Studio to select its image model.');
    if(c.data.reference_ids.length)throw Error('Choose an existing image below, or remove Image Studio references before generating a new appearance.');
    await window.EccoCompute.validate(draft.gpu,c.model.value);image_settings=modelPayload('images',draft.gpu,c.model.value);
   }
   const request={request_id:id(),character_id:current.id,revision:current.revision,stage,gpu:draft.gpu,quality:draft.quality};
   if(stage==='appearance')request.image_settings=image_settings;
   if(view)request.view=view;
   if(stage==='performance')Object.assign(request,{action:draft.action,expression:draft.expression,seconds:draft.seconds,camera:draft.camera,output:draft.output});
   await submit('character-studio/generate',request);
  }
  async function approve(stage){
   const request={character_id:current.id,revision:current.revision,stage};
   if(stage==='appearance')request.asset_id=selection;
   if(stage==='model'||stage==='rig')request.asset_id=current[stage+'_asset_id'];
   merge(await api('character-studio/approve',request));step=Math.min(5,step+1);remember();
  }
  async function useFrame(kind){
   const latest=chosenPerformance(),outputs=latest?.outputs||current.rig_outputs||current.model_outputs,aid=outputs.still;
   const settings=latest?.settings||{},prompt=current.name+': '+current.description+'. '+(settings.action?'Action: '+settings.action+'. Expression: '+settings.expression+'. Duration: '+settings.seconds+' seconds.':'Preserve this character’s appearance.');
   if(kind==='video')await api('approve',{asset_id:aid});
   await refresh();check();dialog.close();navigate(kind==='video'?'render':'images');
   const target=q(kind==='video'?'#video-form':'#image-form');
   window.EccoGeneration.useCharacterFrame(target,aid,prompt,story,settings.seconds);
  }
  dialog.onclick=event=>{
   const action=event.target.closest('[data-action]')?.dataset.action;
   if(!action)return;
   act(async()=>{
    if(action==='save')await saveCharacter();
    else if(action==='copy'){saveDraft();draft.name=current.name+' v2';draft.description=current.description;current=null;createId=id();selection='';step=0;remember();}
    else if(action.startsWith('approve-'))await approve(action.slice(8));
    else if(action.startsWith('view:'))await generate('sheet',action.slice(5));
    else if(['appearance','sheet','model','rig','performance'].includes(action))await generate(action);
    else if(action==='stop'){merge(await api('generation/stop',{job_id:job().id}));}
    else if(action==='reconcile'){await refreshData(false);if(pending){if(pending.upload&&!pending.body.data)throw Error('Upload acceptance is still unconfirmed. Keep this request ID for support: '+pending.body.request_id);await submit(pending.path,pending.body);}}
    else if(action==='upload'){
     saveDraft();const file=q('[name=rig_file]',body).files[0];if(!file||!file.name.toLowerCase().endsWith('.glb')||file.size>50*1024*1024)throw Error('Choose a GLB file up to 50 MB.');
     const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Cannot read GLB.'));reader.readAsDataURL(file);});
     await submit('character-studio/upload',{request_id:id(),character_id:current.id,revision:current.revision,gpu:draft.gpu,data});
    }else if(action==='use-image')await useFrame('image');else if(action==='use-video')await useFrame('video');
   });
  };
  for(const tab of all('[data-step]',dialog))tab.onclick=()=>{saveDraft();step=Number(tab.dataset.step);draw();};
  picker.onchange=()=>{saveDraft();current=records.find(r=>r.id===picker.value&&r.kind==='character')||null;selection='';step=0;if(current){draft.name=current.name;draft.description=current.description;}else createId=id();remember();draw();};
  q('[data-close]',dialog).onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{saveDraft();closed=true;clearInterval(timer);dialog.remove();openDialog=null;if(origin?.isConnected)origin.focus();},{once:true});
  const timer=setInterval(async()=>{if(!closed&&!busy&&dialog.open){try{const before=JSON.stringify(current),prior=JSON.stringify(job());await refreshData(false);if(before!==JSON.stringify(current)||prior!==JSON.stringify(job())){saveDraft();draw();}}catch(error){showError(error);}}},4000);
  draw();dialog.showModal();q('input,select',body)?.focus();
  try{await refreshData();}catch(error){showError(error);}
 }
 window.EccoCharacterStudio={open};
})();
