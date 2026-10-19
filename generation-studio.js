'use strict';
/* One generation interface for Image, Audio and Video; media-specific adapters only. */
(() => {
 const q=(s,r=document)=>r.querySelector(s), all=(s,r=document)=>[...r.querySelectorAll(s)];
 const types={
  person:{name:'Human',fields:['Age','Hairstyle','Hair color','Eye color','Clothing','Expression','Pose']},
  car:{name:'Car',fields:['Body style','Color','Brand','Model','Wheels','Finish','Condition']},
  animal:{name:'Animal',fields:['Species','Age','Coat color','Coat pattern','Pose','Expression']},
  object:{name:'Object',fields:['Style','Color','Material','Shape','Size','Condition']},
  background:{name:'Background',fields:['Setting','Lighting','Weather','Time of day','Color palette']}
 };
 const configs={image:{form:'image-form',noun:'image',limit:3,status:'image-status'},audio:{form:'audio-form',noun:'audio',limit:8,status:'audio-job-status'},video:{form:'video-form',noun:'video',limit:8,status:'video-status'}};
 const contexts=new WeakMap();
 // Review only the latest generation requested in this page session, never library history.
 const currentJobs=new Map(),jobKey=(kind,story)=>kind+':'+story;
 function jobId(kind,story=activeStory,knownJob){
  const key=jobKey(kind,story);if(currentJobs.has(key))return currentJobs.get(key);
  const saved=localStorage.getItem('ecco-'+kind+'-job:'+story);
  const job=knownJob?.id===saved?knownJob:state.records.find(r=>r.kind==='job'&&r.id===saved);
  // Resume an unfinished generation after reload, but do not restore completed previews.
  if(job&&['queued','running'].includes(job.status)){currentJobs.set(key,job.id);return job.id;}
  return null;
 }
 function results(kind,list,story=activeStory,knownJob){
  const id=jobId(kind,story,knownJob);if(!id)return [];
  const job=knownJob?.id===id?knownJob:state.records.find(r=>r.kind==='job'&&r.id===id);
  const ids=Array.isArray(job?.result)?job.result:[job?.result];
  return list.filter(a=>!a.deleted&&a.media===kind&&(a.story_id||LEGACY_STORY)===story&&(a.job_id===id||ids.includes(a.id)));
 }
 function trackJob(kind,story,job){
  if(!job?.id)return;currentJobs.set(jobKey(kind,story),job.id);
  if(story!==activeStory)return;
  if(kind==='image'&&typeof updateGallery==='function')updateGallery();
  if(kind==='video'&&typeof updateVideoGallery==='function')updateVideoGallery();
 }
 const previousApi=api;
 api=async function(path,body,...args){
  const story=body?.story_id||activeStory,job=await previousApi.call(this,path,body,...args);
  const kind=({images:'image','image-edits':'image','character-sheets':'image',videos:'video'})[path];
  if(kind)trackJob(kind,story,job);return job;
 };
 const record=id=>state.records.find(a=>a.id===id&&a.kind==='asset'&&['image','video','audio'].includes(a.media)&&!a.deleted);
 const clone=x=>JSON.parse(JSON.stringify(x));
 const key=(kind,story)=>'ecco-generation-v1:'+kind+':'+story;
 const thumb=(a,extra='')=>a.media==='audio'?'<span aria-label="Audio recording">♫</span>':a.media==='video'?'<video data-asset="'+esc(a.id)+'" src="'+esc(media(a))+'" aria-label="'+esc(a.title||'Reference video')+'" preload="metadata" muted playsinline></video>':'<img data-asset="'+esc(a.id)+'" src="'+esc(media(a))+'" alt="'+esc(a.title||'Reference image')+'" '+extra+'>';
 const referenceKind=c=>c.kind==='video'&&['video','audio'].includes(c.data.reference_library)?c.data.reference_library:'image';
 const libraryVideos=()=>window.EccoVideoLibrary?.assets()||[];
 const referenceIds=c=>{if(referenceKind(c)==='audio')return c.data.audio_reference_ids||[];if(referenceKind(c)!=='video')return c.data.reference_ids;const available=new Set(libraryVideos().map(a=>a.id));return c.data.video_reference_ids.filter(id=>available.has(id));};
 function read(kind,story){try{return JSON.parse(localStorage.getItem(key(kind,story))||'{}');}catch{return {};}}
 function save(c){localStorage.setItem(key(c.kind,c.story),JSON.stringify(c.data));sync(c);}
 function objectDefaults(id){const a=record(id),objects=a?.editor?.recipe?.objects;return objects?.length?objects.map(o=>({name:o.name,type:types[o.type]?o.type:'object',attributes:{...o.ai}})):[{name:'Object 1',type:'object',attributes:{}}];}
 function ensureObjects(c,id){return c.data.objects[id]||(c.data.objects[id]=objectDefaults(id));}
 function selected(c){return referenceIds(c).map(record).filter(a=>a?.media===referenceKind(c));}
 function field(label,control){return '<label>'+esc(label)+control+'</label>';}
 function pop(c,id,title){const d=document.createElement('dialog');d.id=id;d.className='generation-dialog';d.innerHTML='<div class="form"><div class="section-head"><h2>'+esc(title)+'</h2><button type="button" class="secondary" data-close>Done</button></div><div data-body></div></div>';c.form.append(d);q('[data-close]',d).onclick=()=>d.close();return d;}
 function section(id,title,body){return '<section class="generation-section" data-section="'+id+'"><div class="generation-section-heading">'+title+'</div>'+body+'</section>';}
 function settingsFields(c){
  if(c.kind==='audio')return;
  const id=c.model.value,container=q('[data-model-fields]',c.form);
  container.innerHTML=modelFields(id);all('[data-setting]',container).forEach(el=>{el.name=el.dataset.setting;el.oninput=()=>{const id=c.model.value;modelProfiles.settings[id]={...modelSettings(id),[el.dataset.setting]:el.type==='number'?Number(el.value):el.value};saveModelProfiles();};});
  q('[data-model-status]',c.form).textContent=modelStatus(id);
 }
 function connectModel(c){
  if(c.kind==='audio')return;
  const category=c.kind==='image'?'images':'video';
  c.model.onchange=()=>{modelProfiles.selected[category]=c.model.value;saveModelProfiles();settingsFields(c);save(c);};
  settingsFields(c);
 }
 function sync(c){
  const refs=c.kind==='video'?['image','video','audio'].flatMap(kind=>selected({...c,data:{...c.data,reference_library:kind}})):selected(c),box=q('[data-selected]',c.form);
  if(box){box.innerHTML=refs.map((a,i)=>'<div class="generation-selected-item"><button type="button" class="secondary generation-thumb" data-ref-open="'+esc(a.id)+'" title="'+esc(a.title||'Reference '+(i+1))+'">'+thumb(a)+'<span>'+esc(a.media)+' '+(i+1)+'</span></button><button type="button" class="secondary generation-remove" data-ref-remove="'+esc(a.id)+'" aria-label="Remove reference '+(i+1)+'">×</button></div>').join('');
  all('[data-ref-open]',box).forEach(b=>b.onclick=()=>{const a=record(b.dataset.refOpen);if(a?.media==='image')openControls(c,b.dataset.refOpen);else{c.data.reference_library=a?.media||'audio';q('[data-reference-library]',c.form).value=c.data.reference_library;save(c);referencePicker(c);}});
  all('[data-ref-remove]',box).forEach(b=>b.onclick=()=>{const kind=record(b.dataset.refRemove)?.media||referenceKind(c),scope={...c,data:{...c.data,reference_library:kind}};setReferences(c,referenceIds(scope).filter(id=>id!==b.dataset.refRemove),kind);});
  }
  const text=c.kind==='audio'?all('textarea[data-field=text]',c.form).map(x=>x.value).join('\n'):q('textarea[name=prompt]',c.form)?.value||'';
  q('[data-prompt-summary]',c.form).textContent=text.trim()||(c.kind==='audio'?'Write the words to be spoken, or generate a script with AI.':'Add what you want to generate.');
  fitPrompt(c);
  q('[data-open-prompt]',c.form).textContent=c.kind==='audio'?(text.trim()?'Edit script':'Write script'):(text.trim()?'Edit prompt':'Add prompt');
  const referenceNote=q('[data-reference-note]',c.form);
  if(referenceNote)referenceNote.textContent=referenceKind(c)==='audio'?(refs.length?'Original recording, script and storyboard are reused.':'Choose a recording from Audio Library.'):referenceKind(c)==='video'?(refs.length?'Selected videos are saved as references.':'No reference videos selected.'):refs.length?(c.kind==='audio'?'Selected images guide AI script writing.':c.kind==='video'?'Selected images become shots in this order.':'Selected images guide the result.'):'No reference images selected.';
  if(c.kind==='image'){
   const has=refs.length>0;
   for(const opt of c.model.options)opt.disabled=has?opt.value!=='qwen-image-edit-2511':opt.value==='qwen-image-edit-2511';
   if(has&&c.model.value!=='qwen-image-edit-2511'){c.data.newImageModel=c.model.value;c.model.value='qwen-image-edit-2511';c.model.dispatchEvent(new Event('change'));}
   if(!has&&c.model.value==='qwen-image-edit-2511'){c.model.value=c.data.newImageModel||'sdxl';c.model.dispatchEvent(new Event('change'));}
  }
 }
 function setReferences(c,ids,kind=referenceKind(c)){
  const key=kind==='audio'?'audio_reference_ids':kind==='video'?'video_reference_ids':'reference_ids';
  const available=key==='video_reference_ids'?new Set(libraryVideos().map(a=>a.id)):null;
  c.data[key]=[...new Set(ids)].filter(id=>!available||available.has(id)).slice(0,configs[c.kind].limit);
  if(kind!=='audio')for(const id of c.data[key])ensureObjects(c,id);
  save(c);document.dispatchEvent(new Event('ecco-reference-change'));
 }
 function referencePicker(c){
  let d=q('#generation-library-picker');if(d)d.remove();d=document.createElement('dialog');d.id='generation-library-picker';d.className='generation-dialog';document.body.append(d);
  const chosen=new Set(referenceIds(c)),kind=referenceKind(c),limit=configs[c.kind].limit,plural=kind==='audio'?'recordings':kind+'s',library=kind==='audio'?'Audio Library':kind==='video'?'Video Library':'Image Library';
  const images=kind==='video'?libraryVideos():state.records.filter(a=>a.kind==='asset'&&a.media===kind&&!a.deleted);
  const folders=state.records.filter(a=>a.kind===kind+'_folder'&&!a.deleted);
  d.innerHTML='<div class="form"><div class="section-head"><h2>'+library+'</h2><button type="button" class="secondary" data-cancel>Cancel</button></div><div class="generation-filter-row">'+field('Search','<input type="search" data-search placeholder="Find '+(kind==='audio'?'a recording':kind==='image'?'an image':'a video')+'">')+field('Label','<select data-label><option value="">All '+plural+'</option>'+folders.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.name)+'</option>').join('')+'</select>')+'</div><p class="help">Select up to '+limit+' '+plural+'.</p><div class="generation-picker-grid" data-grid></div><p role="status" data-count></p><div class="row"><button type="button" data-use>Use selected '+plural+'</button></div></div>';
  const draw=()=>{
   const term=q('[data-search]',d).value.trim().toLowerCase(),folder=q('[data-label]',d).value;
   const shown=images.filter(a=>(!term||(a.title||a.prompt||'').toLowerCase().includes(term))&&(!folder||state.records.some(l=>l.kind==='library_item'&&!l.deleted&&l.asset_id===a.id&&l.folder_id===folder)));
   q('[data-grid]',d).innerHTML=shown.map(a=>'<button type="button" class="secondary generation-picker-item" data-image="'+esc(a.id)+'" aria-pressed="'+chosen.has(a.id)+'">'+thumb(a,'loading="lazy"')+'<span>'+esc(a.title||'Untitled '+kind)+'</span><small>'+ (chosen.has(a.id)?'Selected':'Select')+'</small></button>').join('')||'<p class="help">'+(window.EccoStorage?.ready?(kind==='video'&&!images.length?'No saved videos in Video Library.':'No '+plural+' match.'):'Connect storage to browse your '+library+'.')+'</p>';
   q('[data-count]',d).textContent=chosen.size+' selected';
   all('[data-image]',d).forEach(b=>b.onclick=()=>{const id=b.dataset.image;if(chosen.has(id))chosen.delete(id);else if(chosen.size<limit)chosen.add(id);else{q('[data-count]',d).textContent='This model supports up to '+limit+' references.';return;}draw();});
  };
  q('[data-search]',d).oninput=draw;q('[data-label]',d).onchange=draw;q('[data-cancel]',d).onclick=()=>d.close();q('[data-use]',d).onclick=()=>{if(c.form.isConnected&&c.story===activeStory){setReferences(c,[...chosen]);}d.close();};draw();d.showModal();
 }
 function objectInstructions(c,onlyId){
  const lines=[];
  for(const [i,id] of referenceIds(c).entries()){
   if(referenceKind(c)==='audio')continue;if(onlyId&&id!==onlyId)continue;
   for(const object of ensureObjects(c,id)){
    const attrs=Object.entries(object.attributes||{}).filter(([k,v])=>types[object.type].fields.includes(k)&&String(v).trim());
    if(attrs.length)lines.push('Reference '+referenceKind(c)+(onlyId?'':' '+(i+1))+', '+object.name+' ('+types[object.type].name+'): '+attrs.map(([k,v])=>k+': '+String(v).trim()).join('; ')+'.');
   }
  }
  if(!referenceIds(c).length)for(const object of ensureObjects(c,'new')){
   const attrs=Object.entries(object.attributes||{}).filter(([k,v])=>types[object.type].fields.includes(k)&&String(v).trim());if(attrs.length)lines.push(object.name+' ('+types[object.type].name+'): '+attrs.map(([k,v])=>k+': '+String(v).trim()).join('; ')+'.');
  }
  return lines.join('\n');
 }
 function compose(c,prompt,onlyId){
  const parts=[prompt.trim()],attrs=objectInstructions(c,onlyId),style=c.data.style;
  if(style)parts.push('Style: '+style+'.');if(attrs)parts.push(attrs);
  if(referenceIds(c).length)parts.push('Preserve the identity and unspecified details of each referenced subject. Apply each attribute only to the named object in its specified reference.');
  return parts.filter(Boolean).join('\n\n');
 }
 function openControls(c,reference){
  if(c.kind==='audio'){window.EccoAudioStudio?.controls(q('[data-delivery-controls]',c.controls));if(!c.controls.open)c.controls.showModal();return;}
  const d=c.controls,body=q('[data-object-controls]',d),ids=referenceIds(c);c.activeReference=reference||c.activeReference||ids[0]||'new';
  if(!ids.includes(c.activeReference))c.activeReference=ids[0]||'new';
  let oi=0;
  const render=()=>{
   const id=c.activeReference,objects=ensureObjects(c,id);oi=Math.min(oi,objects.length-1);const object=objects[oi];
   body.innerHTML='<div class="generation-reference-tabs">'+(selected(c).map((a,i)=>'<button type="button" class="secondary generation-thumb" data-control-ref="'+esc(a.id)+'" aria-pressed="'+(a.id===id)+'">'+thumb(a)+'<span>Reference '+(i+1)+'</span></button>').join('')||'<span class="help">New subject</span>')+'</div><div class="generation-filter-row">'+field('Selected object','<select data-object>'+objects.map((o,i)=>'<option value="'+i+'" '+(i===oi?'selected':'')+'>'+esc(o.name)+'</option>').join('')+'</select>')+field('Object type','<select data-type>'+Object.entries(types).map(([key,t])=>'<option value="'+key+'" '+(key===object.type?'selected':'')+'>'+t.name+'</option>').join('')+'</select>')+'</div>'+field('Object name / position','<input data-object-name maxlength="100" value="'+esc(object.name)+'" placeholder="Person on the left">')+'<div class="generation-attribute-grid">'+types[object.type].fields.map(name=>field(name,'<input data-attribute="'+esc(name)+'" value="'+esc(object.attributes[name]||'')+'" maxlength="200" placeholder="Keep original / unspecified">')).join('')+'</div><div class="row"><button type="button" class="secondary" data-add-object>Add object</button><button type="button" class="secondary" data-remove-object '+(objects.length===1?'disabled':'')+'>Remove object</button></div>';
   all('[data-control-ref]',body).forEach(b=>b.onclick=()=>{c.activeReference=b.dataset.controlRef;oi=0;render();});
   q('[data-object]',body).onchange=e=>{oi=Number(e.target.value);render();};
   q('[data-type]',body).onchange=e=>{object.type=e.target.value;save(c);render();};
   q('[data-object-name]',body).oninput=e=>{object.name=e.target.value;save(c);q('[data-object]',body).options[oi].textContent=object.name;};
   all('[data-attribute]',body).forEach(el=>el.oninput=()=>{object.attributes[el.dataset.attribute]=el.value;save(c);});
   q('[data-add-object]',body).onclick=()=>{if(objects.length>=8)return;objects.push({type:'object',name:'Object '+(objects.length+1),attributes:{}});oi=objects.length-1;save(c);render();};
   q('[data-remove-object]',body).onclick=()=>{objects.splice(oi,1);oi=0;save(c);render();};
  };render();if(!d.open)d.showModal();
 }
 function audioLines(form){
  const c=contexts.get(form);if(!c||c.kind!=='audio')return;
  window.EccoAudioStudio?.controls(q('[data-delivery-controls]',c.controls));sync(c);
 }
 function fitPrompt(c){
  if(!c.prompt?.open)return;
  all('textarea',c.prompt).forEach(el=>{el.style.height='auto';el.style.height=(el.scrollHeight+el.offsetHeight-el.clientHeight)+'px';});
 }
 function promptActions(c){
  q('[data-close]',c.prompt).textContent='Apply';
  c.prompt.addEventListener('focusin',e=>{if(e.target.matches('textarea:not([readonly])'))c.activePrompt=e.target;});
  q('[data-ai-generate]',c.prompt).onclick=()=>c.kind==='audio'?window.EccoAudioStudio?.generateScript():window.EccoAI?.generateField((c.activePrompt?.isConnected?c.activePrompt:q('textarea:not([readonly])',c.prompt)));
  q('[data-ai-improve]',c.prompt).onclick=()=>window.EccoAI?.improveField((c.activePrompt?.isConnected?c.activePrompt:q('textarea:not([readonly])',c.prompt)));
 }
 function mount(form,kind){
  if(!form||contexts.has(form))return;
  form.dataset.generationStudio=kind;form.classList.add('generation-form');
  const intro=form.closest('.grid')?.previousElementSibling;if(intro?.classList.contains('intro'))intro.remove();
  const story=activeStory,stored=read(kind,story),c={kind,story,form,data:{reference_ids:[],video_reference_ids:[],audio_reference_ids:[],reference_library:'image',objects:{},style:'',...stored},activePrompt:null};contexts.set(form,c);
  const model=kind==='audio'?q('[name=model]',form):q('#job-model',form),modelLabel=model.closest('label');c.model=model;model.setAttribute('aria-label','Model');
  if(kind==='image'&&!model.querySelector('[value="qwen-image-edit-2511"]'))model.add(new Option('Qwen Image Edit','qwen-image-edit-2511'));
  const promptNode=kind==='audio'?q('#audio-lines',form):kind==='image'?form.elements.prompt.closest('label'):null;
  const addLine=q('#add-audio-line',form),negative=form.elements.negative?.closest('label'),audioSettings=kind==='audio'?[q('.audio-output-controls',form)]:[],audioReferences=kind==='audio'?[form.elements.genre.closest('label'),form.elements.title.closest('label')]:[];
  const board=kind==='video'?form.elements.board_id.closest('label'):null,audioCompute=q('[data-audio-compute]',form);
  const submit=q('#generate-'+kind,form),status=q('#'+configs[kind].status,form);
  const footer=document.createElement('div');footer.className='generation-footer';footer.append(submit,status);submit.textContent='Generate '+kind;if(kind==='video'&&!localStorage.getItem('ecco-video-job:'+story))status.textContent='';
  const retained=[modelLabel,promptNode,addLine,negative,board,audioCompute,...audioSettings,...audioReferences].filter(Boolean);retained.forEach(el=>el.remove());footer.remove();
  form.replaceChildren();
  form.innerHTML=section('model','Model and Settings','<div data-model></div><details class="generation-settings"><summary>Model Settings</summary><div class="generation-settings-body" data-settings></div></details>')+ (kind==='audio'?'<section class="generation-section" data-section="references"><details class="generation-settings generation-references"><summary>References</summary><div class="generation-settings-body" data-audio-references></div></details></section>':section('references','References',(kind==='video'?'<select data-reference-library aria-label="Reference library"><option value="image">Image Library</option><option value="video">Video Library</option><option value="audio">Audio Library</option></select>':'')+'<button type="button" class="secondary generation-action" data-open-library>'+(kind==='video'?'Browse Library':'Image Library')+'</button><div class="generation-selected" data-selected></div><p class="help" data-reference-note></p>'))+section('prompt',kind==='audio'?'Spoken script':'Prompt','<button type="button" class="secondary generation-action" data-open-prompt>Add prompt</button><p class="help generation-prompt-summary" data-prompt-summary></p>')+section('controls','Additional Controls','<button type="button" class="secondary generation-action" data-open-controls>Additional Controls</button>');
  q('[data-model]',form).append(modelLabel);q('[data-settings]',form).innerHTML=kind==='audio'?'':'<div class="generation-attribute-grid" data-model-fields></div><p class="help" data-model-status></p>';
  if(audioCompute){q('[data-section=model]',form).insertAdjacentHTML('afterend',section('compute','Compute',''));q('[data-section=compute]',form).append(audioCompute);}
  if(negative)q('[data-settings]',form).append(negative);
  for(const node of audioSettings)q('[data-settings]',form).append(node);
  for(const node of audioReferences)q('[data-audio-references]',form).append(node);
  if(board){q('[data-settings]',form).append(board);board.querySelector('select').onchange=e=>{
   const b=boards().find(b=>b.id===e.target.value);if(!b)return;c.data.reference_library='image';q('[data-reference-library]',form).value='image';c.data.board_id=b.id;c.data.scenes=clone(b.scenes);c.data.reference_ids=[...new Set(b.scenes.map(s=>s.image_id))];setReferences(c,c.data.reference_ids);q('[data-video-seconds]',form).value=b.scenes[0]?.seconds||3;
  };q('[data-settings]',form).insertAdjacentHTML('beforeend',field('Shot duration (seconds)','<input data-video-seconds type="number" min="1" max="30" value="'+(Number(c.data.seconds)||3)+'">'));q('[data-video-seconds]',form).oninput=e=>{c.data.seconds=Number(e.target.value);save(c);};}
  c.prompt=pop(c,'generation-prompt-dialog',kind==='audio'?'Spoken script':'Prompt');const promptBody=q('[data-body]',c.prompt);promptBody.innerHTML='<div class="generation-ai-actions"><button type="button" class="secondary" data-ai-generate>Generate with AI</button><button type="button" class="secondary" data-ai-improve>Improve using AI</button></div>';
  if(kind==='audio'){q('[data-ai-generate]',c.prompt).textContent='Generate script with AI';promptBody.insertAdjacentHTML('beforeend','');}
  if(promptNode)promptBody.append(promptNode);else promptBody.insertAdjacentHTML('beforeend',field('Motion prompt','<textarea name="prompt" data-generation-prompt maxlength="1600" placeholder="Describe the movement, camera and action.">'+esc(c.data.prompt||'')+'</textarea>'));
  if(addLine)promptBody.append(addLine);
  if(kind!=='audio'){const text=q('textarea',c.prompt);text.dataset.generationPrompt='';if(stored.prompt!==undefined)text.value=stored.prompt;text.oninput=()=>{c.data.prompt=text.value;save(c);};text.maxLength=kind==='video'?1600:4000;}
  c.controls=pop(c,'generation-controls-dialog','Additional Controls');q('[data-close]',c.controls).textContent='Apply';
  q('[data-body]',c.controls).innerHTML=kind==='audio'?'<div data-delivery-controls></div>':'<div data-object-controls></div>'+field('Visual style','<input data-generation-style maxlength="160" value="'+esc(c.data.style)+'" placeholder="Keep original / unspecified">');
  const styleControl=q('[data-generation-style]',c.controls);if(styleControl)styleControl.oninput=e=>{c.data.style=e.target.value;save(c);};
  form.append(footer);form.noValidate=true;
  const librarySelect=q('[data-reference-library]',form);if(librarySelect){librarySelect.value=referenceKind(c);librarySelect.onchange=()=>{c.data.reference_library=librarySelect.value;c.activeReference=null;save(c);document.dispatchEvent(new Event('ecco-reference-change'));};}
  const libraryButton=q('[data-open-library]',form);if(libraryButton)libraryButton.onclick=()=>referencePicker(c);q('[data-open-prompt]',form).onclick=()=>{c.prompt.showModal();fitPrompt(c);q('textarea',c.prompt)?.focus();};q('[data-open-controls]',form).onclick=()=>openControls(c);
  form.addEventListener('input',()=>sync(c));form.addEventListener('focusin',e=>{const section=e.target.closest('.generation-section');if(section)all('.generation-section',form).forEach(s=>s.classList.toggle('is-focused',s===section));});
  connectModel(c);promptActions(c);if(kind==='audio')audioLines(form);
  if(kind==='image'&&refinementSource){c.data.reference_ids=[refinementSource.id];q('textarea[name=prompt]',form).value=refinementSource.prompt||'';c.data.prompt=refinementSource.prompt||'';}
  if(kind!=='audio')form.onsubmit=e=>{e.preventDefault();submitGeneration(c);};
  if(kind==='video'){submit.disabled=false;updateVideoStatus();}
  sync(c);
 }
 async function submitGeneration(c){
  const button=q('#generate-'+c.kind,c.form),status=q('#'+configs[c.kind].status,c.form);if(c.submitting||button.disabled)return;
  if(c.kind==='video'&&(c.data.audio_reference_ids||[]).length){notice('Audio references require the audio-driven video service.',true);return;}
  if(c.kind==='video'&&(c.data.video_reference_ids||[]).length){if(!referenceIds(c).length)referencePicker(c);else notice('Video references are saved. Generation from video references is not connected yet.',true);return;}
  if(!gpuConnected()){connectGPU(button.id);return;}
  if(!window.EccoStorage?.ready){window.EccoAI?.connections();return;}
  const text=q('textarea[name=prompt]',c.form).value.trim();
  if(c.data.reference_ids.some(id=>!record(id))){notice('A selected reference is unavailable. Reselect it in References.',true);return;}
  if(c.kind==='image'&&!text&&!objectInstructions(c)){q('[data-open-prompt]',c.form).click();notice('Add a prompt or choose object attributes first.',true);return;}
  if(c.kind==='video'&&!c.data.reference_ids.length){referencePicker(c);notice('Choose the images to animate.',true);return;}
  c.submitting=true;button.disabled=true;status.textContent='Preparing generation…';
  const tracking=c.kind==='image'?submittingImages:submittingVideos;tracking.add(c.story);
  try{
   let job;
   if(c.kind==='image'){
    const prompt=compose(c,text),refs=c.data.reference_ids;
    if(prompt.length>4000)throw Error('Keep the combined prompt and object attributes within 4,000 characters.');
    if(refs.length){
     if(!state.config.models_ready?.['qwen-image-edit-2511'])throw Error('Qwen Image Edit is not ready on the connected GPU.');
     const settings=modelSettings('qwen-image-edit-2511');
     if(!state.config.generation_controls_version&&(refs.length>1||settings.steps!==40||settings.cfg!==3||settings.seed!==42))throw Error('The connected GPU needs the multi-reference generation update. Your selections and prompt are saved.');
     job=await api('image-edits',{asset_id:refs[0],asset_ids:refs,prompt,story_id:c.story,...settings,reference_controls:clone(c.data.objects)});
    }else job=await api('images',{...modelPayload('images'),prompt,negative:c.form.elements.negative?.value||'',story_id:c.story});
   }else{
    const settings=modelPayload('video'),limit=settings.model==='wan-a14b'?6:settings.model==='wan-5b'?5:30;
    const savedRefs=[...new Set((c.data.scenes||[]).map(s=>s.image_id))];
    const sequence=c.data.board_id&&JSON.stringify(savedRefs)===JSON.stringify(c.data.reference_ids)?c.data.scenes:c.data.reference_ids.map(id=>c.data.scenes?.find(s=>s.image_id===id)||{image_id:id});
    const scenes=sequence.map(saved=>{
     const id=saved.image_id,asset=record(id);
     if(asset.stage!=='prod'||(asset.story_id||LEGACY_STORY)!==c.story)throw Error('Video references must be approved images from the selected story.');
     const seconds=saved?.seconds||Number(q('[data-video-seconds]',c.form).value)||3;if(seconds>limit)throw Error('This model supports up to '+limit+' seconds per shot. Update Model Settings or the storyboard.');
     const motion=compose(c,text||saved?.motion||'Natural, consistent movement',id);if(motion.length>2000)throw Error('Shorten the motion prompt or object attributes to 2,000 characters per shot.');
     return {...saved,image_id:id,seconds,motion,narration:saved?.narration||''};
    });
    if(scenes.reduce((n,s)=>n+s.seconds,0)>60&&settings.model!=='preview')throw Error('Keep this render within 60 seconds.');
    const board=await api('boards',{story_id:c.story,title:currentStory().title||'Video sequence',scenes});
    job=await api('videos',{...settings,board_id:board.id});
   }
   localStorage.setItem('ecco-'+c.kind+'-job:'+c.story,job.id);status.textContent='Queued. Follow progress in Activity.';await refresh();
  }catch(error){status.textContent=error.message;notice(error.message,true);}
  finally{c.submitting=false;tracking.delete(c.story);button.disabled=false;if(c.kind==='image')updateImageStatus();else updateVideoStatus();}
 }
 function aiContext(scope,element){const c=contexts.get(scope)||contexts.get(scope.closest?.('form'));if(!c)return null;return {reference_ids:referenceIds(c).filter(id=>record(id)?.media==='image'),context:{...(c.kind==='video'?{scenes:referenceKind(c)==='video'?[]:c.data.scenes||c.data.reference_ids.map(image_id=>({image_id})),video_references:selected(c).filter(a=>a.media==='video').map(a=>({id:a.id,title:a.title||'Untitled video'})),seconds:Number(q('[data-video-seconds]',c.form)?.value)||3}:{}),style:c.data.style,scene_controls:objectInstructions(c),instructions:'Reference-specific attributes: '+objectInstructions(c),...(c.kind==='audio'?{...window.EccoAudioStudio?.aiContext(element),genre:c.form.elements.genre.value}:{} )}};}
 MODEL_CATALOG['qwen-image-edit-2511']={name:'Qwen Image Edit',defaults:{steps:40,cfg:3,seed:42}};
 const oldImage=imagePage;imagePage=function(){oldImage.apply(this,arguments);mount(q('#image-form'),'image');};
 const oldVideo=renderPage;renderPage=function(){oldVideo.apply(this,arguments);mount(q('#video-form'),'video');};
 document.addEventListener('ecco-ai-busy',e=>{all('[data-ai-generate],[data-ai-improve]').forEach(b=>{b.disabled=e.detail.busy;b.textContent=b.hasAttribute('data-ai-generate')?(e.detail.busy&&e.detail.generate?'Generating…':'Generate with AI'):(e.detail.busy&&!e.detail.generate?'Improving…':'Improve using AI');});});
 window.EccoGeneration={jobId,results,trackJob,mount,audioLines,aiContext,compose,types,context:form=>contexts.get(form)};
})();







