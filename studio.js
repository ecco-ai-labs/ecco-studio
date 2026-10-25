'use strict';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state={records:[],config:{models_ready:{}},storage_pending:true},page='images',lastSignature='',savedBoard=null;
const LEGACY_STORY='00000000000000000000000000000001';
// A page refresh starts a new selection; saved story drafts stay in storage.
let activeStory='';
localStorage.removeItem('ecco-active-story');
const defaultDraft={title:'',story:'',scenes:[]};
function stories(){if(state.storage_pending)return [];const explicit=state.records.filter(r=>r.kind==='story');const legacy=explicit.find(r=>r.id===LEGACY_STORY),legacyContent=state.records.some(r=>['asset','board'].includes(r.kind)&&!r.deleted&&(!r.story_id||r.story_id===LEGACY_STORY));return [...(!legacy&&legacyContent?[{id:LEGACY_STORY,title:'The Fisherman and the Jinni'}]:[]),...explicit.filter(r=>!r.deleted).sort((a,b)=>a.created-b.created)];}
function currentStory(){return stories().find(s=>s.id===activeStory)||{id:null,title:'No active story'};}
function readStoryData(key){try{const value=JSON.parse(localStorage.getItem(key)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
function storyDescription(id=activeStory){
 const direct=readStoryData(id?'ecco-story-description:'+id:'ecco-new-story-draft');
 if(!id)return direct.cloudId?{}:direct;
 if(direct.cloudId===id)return direct;
 if(direct.cloudId&&!localStorage.getItem('ecco-story-recovery:description:'+id))localStorage.setItem('ecco-story-recovery:description:'+id,JSON.stringify(direct));
 // Only restore a legacy description when its explicit owner matches this story.
 for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key==='ecco-new-story-draft'||key.startsWith('ecco-story-setup:')){const value=readStoryData(key);if(value.cloudId===id)return value;}}
 return {};
}
function loadDraft(){
 const story=stories().find(s=>s.id===activeStory),key=activeStory?'ecco-board-draft:'+activeStory:'ecco-board-new-draft',saved=readStoryData(key);
 const own=!saved.story_id||saved.story_id===activeStory;
 if(own&&Array.isArray(saved.scenes))return repairWeeklyNewsDraft(saved,story);
 if(!own&&!localStorage.getItem('ecco-story-recovery:ownership:'+activeStory))localStorage.setItem('ecco-story-recovery:ownership:'+activeStory,JSON.stringify(saved));
 const description=storyDescription(),board=activeStory?state.records.filter(r=>r.kind==='board'&&!r.deleted&&(r.story_id||LEGACY_STORY)===activeStory).sort((a,b)=>b.created-a.created)[0]:null;
 return {story_id:activeStory,title:board?.title||story?.title||description.title||'',story:board?.scenes?.map(s=>s.narration||'').join('\n\n')||description.sourceText||localStorage.getItem('ecco-story-source:'+activeStory)||description.summary||story?.summary||'',scenes:structuredClone(board?.scenes||[]),story_format:description.story_format};
}

// Repair the confirmed News / Weekly News import mix-up without deleting its backup.
function repairWeeklyNewsDraft(value,record){
 const normalize=text=>String(text||'').replace(/\s+/g,' ').trim().toLowerCase();
 const merchant=text=>normalize(text).startsWith('the story of the merchant and the genius');
 let collections;try{collections=JSON.parse(localStorage.getItem('ecco-story-collections-v1')||'{}');}catch{return value;}
 const parent=collections.collections?.find(c=>c.id===collections.members?.[activeStory]);
 if(normalize(parent?.name)!=='news'||![value.title,record?.title].some(t=>['weekly news','weekly business news'].includes(normalize(t))))return value;
 const keys=[];for(let i=0;i<localStorage.length;i++)keys.push(localStorage.key(i));
 const setups=[];
 for(const key of keys){if(key==='ecco-new-story-draft'||key.startsWith('ecco-story-setup:')||key==='ecco-story-description:'+activeStory){try{const data=JSON.parse(localStorage.getItem(key)||'{}');if(data.cloudId===activeStory)setups.push({key,data});}catch{}}}
 const contaminated=merchant(value.story)||setups.some(s=>merchant(s.data.sourceText)||merchant(s.data.summary))||merchant(localStorage.getItem('ecco-story-source:'+activeStory));
 if(!contaminated)return value;
 const backupKey='ecco-story-recovery:merchant-mixup:'+activeStory;
 if(!localStorage.getItem(backupKey))localStorage.setItem(backupKey,JSON.stringify({draft:value,setups,source:localStorage.getItem('ecco-story-source:'+activeStory),savedAt:new Date().toISOString()}));
 const replacement=[...setups.map(s=>s.data.summary),record?.summary].find(t=>String(t||'').trim()&&!merchant(t))||'';
 const original=normalize(value.story);
 const next=merchant(value.story)?{...value,story:replacement,scenes:(value.scenes||[]).filter(scene=>{const narration=normalize(scene.narration);return !narration||!original.includes(narration);})}:value;
 for(const {key,data} of setups){if(merchant(data.sourceText))data.sourceText='';if(merchant(data.summary))data.summary=replacement;localStorage.setItem(key,JSON.stringify(data));}
 if(merchant(localStorage.getItem('ecco-story-source:'+activeStory)))localStorage.removeItem('ecco-story-source:'+activeStory);
 localStorage.setItem('ecco-board-draft:'+activeStory,JSON.stringify(next));
 return next;
}

let draft={...defaultDraft,scenes:[]};
let refinementSource=null;
function storyControls(){
 const el=document.querySelector('.project');
 el.innerHTML=`<label>Current story<select id="story-picker"><option value="" ${!activeStory?'selected':''}>Choose a story</option>${stories().map(s=>`<option value="${s.id}" ${s.id===activeStory?'selected':''}>${esc(s.title)}</option>`).join('')}</select></label><button id="new-story" class="secondary">+ New story</button><button id="delete-story" class="secondary" ${!activeStory?'disabled':''}>Delete story</button><button id="view-trash" class="secondary">Trash</button>`;
 $('#delete-story').onclick=()=>{if(!confirm('Remove this story from the dropdown? Its images and videos are preserved. Restore the story from Trash at any time.'))return;action(async()=>{await api('stories/archive',{story_id:activeStory});await refresh();draft=loadDraft();navigate('images');notice('Story removed from the dropdown. Restore it from Trash.');});};
 $('#view-trash').onclick=()=>navigate('trash');
 $('#story-picker').onchange=e=>{window.EccoWorkspaceUI?.preserveNewStoryDraft();window.EccoWorkspaceUI?.persistWorkingDraft();activeStory=e.target.value;localStorage.setItem('ecco-active-story',activeStory);draft=loadDraft();lastSignature='';window.EccoWorkspaceUI?.selectJourneyStory(activeStory);navigate(activeStory?'board':'empty');refresh();};
 $('#new-story').onclick=()=>{
  if(!$('#new-story-dialog')){const d=document.createElement('dialog');d.id='new-story-dialog';d.innerHTML='<form id="new-story-form" class="form"><h2>Start a new story</h2><label>New story title<input name="title" maxlength="160" required placeholder="For example, Ali Baba and the Forty Thieves"></label><label>Story Idea / Summary<textarea name="summary" maxlength="4000" placeholder="Describe your story, characters and setting"></textarea></label><div class="row"><button>Create story</button><button type="button" id="cancel-story" class="secondary">Cancel</button></div></form>';document.body.appendChild(d);$('#cancel-story').onclick=()=>d.close();$('#new-story-form').onsubmit=e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));const button=e.target.querySelector('button');button.disabled=true;notice('Creating story…');action(async()=>{persistDraft();const created=await api('stories',b);activeStory=created.id;localStorage.setItem('ecco-active-story',activeStory);await refresh();draft=loadDraft();d.close();e.target.reset();navigate('images');notice('Story created. Enter a prompt to make its first image.');}).finally(()=>button.disabled=false);};}
  $('#new-story-dialog').showModal();
 };
}

const names={images:'Image studio',board:'Storyboard',render:'Video studio',review:'Production library',publish:'Publish to YouTube',trash:'Trash',models:'Models & settings',characters:'Character library'};
let noticeTimer;
function notice(s,error=false){clearTimeout(noticeTimer);if(s&&!error)noticeTimer=setTimeout(()=>{if($('#notice').textContent===s)$('#notice').textContent='';},5000);if(error)window.EccoErrors?.show(s);$('#notice').textContent=s;$('#notice').className=error?'error':'';const d=$('#new-story-dialog[open]');if(d){let n=d.querySelector('[role=status]');if(!n){n=document.createElement('p');n.setAttribute('role','status');d.querySelector('form').appendChild(n);}n.textContent=s;n.className=error?'error':'';}}
let gpuURL='https://1muqctw9bxvguu-8888.proxy.runpod.net/proxy/8765/';
let gpuOrigin=new URL(gpuURL).origin;
let connected=false;
const mediaCache=new Map(),mediaLoading=new Set();
async function api(path,body){
 throw Error('This action is not configured on the independent workspace service.');
}
function connectGPU(trigger){
 if(!['generate-image','generate-video','generate-audio','accelerator-status'].includes(trigger)||gpuConnected())return;

 let dialog=$('#gpu-picker-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='gpu-picker-dialog';dialog.style.width='min(900px,94vw)';dialog.innerHTML='<div class="section-head"><h2>Connect a GPU workspace</h2><button type="button" class="secondary">Close</button></div><div id="gpu-picker-content"></div>';dialog.querySelector('button').onclick=()=>dialog.close();document.body.append(dialog);}
 EccoGPUPicker.mount($('#gpu-picker-content'),async gpu=>{try{if(!window.EccoStorage?.ready){dialog.close();window.EccoStorage?.open();return;}await window.EccoGPUConnection.select(gpu);gpuURL=gpu.url;gpuOrigin=gpu.origin;dialog.close();notice(gpu.name+' connected.');}catch(error){notice(error.message,true);}});
 dialog.showModal();
}
function gpuConnected(){return Boolean(window.EccoGPUConnection?.ready);}
document.addEventListener('click',event=>{
 const button=event.target.closest('#generate-image,#generate-video');
 if(!button||gpuConnected())return;
 event.preventDefault();event.stopImmediatePropagation();connectGPU(button.id);
},true);
function welcome(){
 page='welcome';document.body.classList.add('workspace-entry-mode');document.title='Ecco AI Labs Studios';
 $('#heading').textContent='';$('#wan-badge').textContent='GPU not connected';$('#page').replaceChildren();
 let entry=$('#workspace-entry');if(!entry){entry=document.createElement('section');entry.id='workspace-entry';entry.setAttribute('aria-label','Welcome to Ecco AI Labs Studio');entry.innerHTML='<img class="entry-logo" src="logo-transparent.png" alt="Ecco AI Labs logo"><h1>Ecco AI Labs<span class="entry-subtitle">Studios</span></h1><button type="button" id="entry-tell-story" disabled>Tell Your Story</button><p class="entry-copyright">© '+new Date().getFullYear()+' Ecco Labs AI India Pvt Ltd. All rights reserved.</p>';document.body.append(entry);entry.querySelector('button').onclick=()=>{if(!window.EccoAuth?.user)return;document.body.classList.remove('workspace-entry-mode');page='empty';$('#heading').textContent='';$('#page').replaceChildren();document.querySelectorAll('nav button.active').forEach(b=>b.classList.remove('active'));};}
}
async function hydrateMedia(){
 if(!state)return;
 for(const a of state.records.filter(r=>r.kind==='asset'&&!r.deleted)){
  if(mediaCache.has(a.id)||mediaLoading.has(a.id))continue;mediaLoading.add(a.id);
  try{const r=await api('media/'+a.id);mediaCache.set(a.id,URL.createObjectURL(new Blob([r.buffer],{type:r.mime})));document.querySelectorAll('[data-asset="'+a.id+'"]').forEach(el=>{if(el.tagName==='A')el.href=mediaCache.get(a.id);else el.src=mediaCache.get(a.id);});}
  catch(e){notice(e.message,true);}finally{mediaLoading.delete(a.id);}
 }
}

async function action(fn){try{await fn();await refresh();}catch(e){document.querySelectorAll('[data-trash]').forEach(b=>b.disabled=false);notice(e.message,true);}}
const allAssets=()=>state.records.filter(r=>r.kind==='asset'&&(r.story_id||LEGACY_STORY)===activeStory).sort((a,b)=>b.created-a.created);
const assets=()=>allAssets().filter(a=>!a.deleted);
const approvedImages=()=>assets().filter(a=>a.media==='image'&&a.stage==='prod');
const boards=()=>state.records.filter(r=>r.kind==='board'&&(r.story_id||LEGACY_STORY)===activeStory).sort((a,b)=>b.created-a.created);
function media(a){return mediaCache.get(a.id)||'';}
function empty(title,body){return `<div class="empty"><strong>${esc(title)}</strong><p class="help">${esc(body)}</p></div>`;}
function card(a){return `<article class="card">${a.media==='image'?`<img data-asset="${a.id}" src="${media(a)}" alt="${esc(a.prompt)}" loading="lazy">`:a.media==='audio'?`<audio data-asset="${a.id}" src="${media(a)}" controls preload="metadata" aria-label="${esc(a.title||'Audio recording')}"></audio>`:`<video data-asset="${a.id}" src="${media(a)}" controls preload="metadata"></video>`}<div class="card-body"><span class="badge ${a.stage==='dev'?'pending':''}">${a.media}-${a.stage}</span>${a.media==='image'&&a.settings?.model?`<p class="help">${esc(MODEL_CATALOG[a.settings.model]?.name||a.settings.model)} · ${a.settings.width||'?'} × ${a.settings.height||'?'} · ${a.settings.steps} steps</p>`:''}<p>${esc(a.title||a.prompt)}</p>${a.media==='video'?`<p>${a.mode==='wan'?'Wan generated motion':'Pan / zoom storyboard preview'} · silent video</p>`:''}<div class="actions">${!a.deleted&&a.media==='image'?`<button class="small secondary" data-refine="${a.id}">Refine this image</button><button class="small secondary" data-edit-image="${a.id}">Edit expression / appearance</button><button class="small secondary" data-save-character="${a.id}">Save character</button>${a.stage==='prod'?`<button class="small secondary" data-animate="${a.id}">Animate this image</button>`:''}`:''}${!a.deleted&&a.stage==='dev'?`<button class="small" data-approve="${a.id}">Approve → ${a.media}-prod</button>`:''}<a class="small" data-asset="${a.id}" href="${media(a)}" download="${esc(a.path.split('/').pop())}">Download</a><button class="small secondary" data-trash="${a.id}" data-restore="${a.deleted?'yes':'no'}">${a.deleted?'Restore':'Delete'}</button>${a.deleted?`<button class="small danger" data-purge="${a.id}">Delete permanently</button>`:''}<span class="muted">${a.sync==='synced'?'GitHub synced':'GitHub sync pending'}</span></div></div></article>`;}
function wireCards(){document.querySelectorAll('[data-edit-image]').forEach(b=>b.onclick=()=>editImageDialog(b.dataset.editImage));document.querySelectorAll('[data-animate]').forEach(b=>b.onclick=()=>{const a=state.records.find(x=>x.id===b.dataset.animate);activeStory=a.story_id||LEGACY_STORY;localStorage.setItem('ecco-active-story',activeStory);draft=loadDraft();draft.scenes.push({image_id:a.id,seconds:modelProfiles.selected.video==='wan-a14b'?6:3,motion:'Natural character movement, consistent appearance, smooth cinematic animation',narration:''});persistDraft();navigate('board');notice('Image added as the next shot. Set motion and duration, save the storyboard, then render.');});document.querySelectorAll('[data-purge]').forEach(b=>b.onclick=()=>{if(!confirm('Permanently delete this asset and its generated workspace copies? This cannot be undone. Existing videos, GitHub copies and backups are not erased.'))return;action(async()=>{b.disabled=true;await api('purge',{asset_id:b.dataset.purge,confirmed:true});notice('Asset permanently removed from this workspace.');});});document.querySelectorAll('[data-save-character]').forEach(b=>b.onclick=()=>saveCharacterDialog(b.dataset.saveCharacter));document.querySelectorAll('[data-refine]').forEach(b=>b.onclick=()=>{refinementSource=state.records.find(a=>a.id===b.dataset.refine);navigate('images');$('#image-form').elements.prompt.value=refinementSource.prompt;$('#image-form').scrollIntoView({behavior:'smooth',block:'start'});notice('Refining the selected image. Describe the complete result you want; lower strength preserves more of this version.');});document.querySelectorAll('[data-trash]').forEach(b=>b.onclick=()=>action(async()=>{b.disabled=true;notice(b.dataset.restore==='yes'?'Restoring…':'Moving to Trash…');await api('trash',{asset_id:b.dataset.trash,restore:b.dataset.restore==='yes'});notice(b.dataset.restore==='yes'?'Asset restored.':'Moved to Trash. You can restore it.');}));document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>action(async()=>{await api('approve',{asset_id:b.dataset.approve});notice('Approved. '+(state.config.github_connected?'Syncing to GitHub.':'GitHub sync awaits connection.'));}));}
function imagePage(){
 if(!state.storage_pending&&!stories().length){$('#page').innerHTML=empty('Start a new story','Choose + New story in the sidebar, or restore a story from Trash.');return;}
 if(refinementSource&&(refinementSource.story_id||LEGACY_STORY)!==activeStory)refinementSource=null;
 $('#page').innerHTML=`<p class="intro">Create a scene, review the result, then approve it for your storyboard. Every image begins in <strong>image-dev</strong>.</p><div class="grid"><form id="image-form" class="panel form"><h2>${refinementSource?'Refine your image':'Describe your frame'}</h2>${refinementSource?`<div class="panel"><img class="refine-preview" src="${media(refinementSource)}" alt="Starting image for this refinement"><p class="help">Based on the selected image. The original stays in your library. Describe the full desired scene; this is an image-guided variation, not precise instruction editing.</p><label>Change strength<input name="strength" type="range" min="0.05" max="0.95" step="0.05" value="0.35"><output id="strength-value">0.35 · subtle changes</output></label><button type="button" id="clear-refinement" class="secondary">Start a fresh image instead</button></div>`:''}<label>Image prompt<textarea name="prompt" required placeholder="Describe the characters, setting, action and visual style">${activeStory===LEGACY_STORY?'A stylized 3D animated film still of an elderly Arabian fisherman on a quiet shoreline at sunrise, teal and sand-colored robes, a sealed brass vessel clearly visible beside his fishing net, warm cinematic lighting, wide composition, no text':''}</textarea></label><label>Negative prompt<input name="negative" value="blurry, bad anatomy, watermark, text"></label><div class="row"><label>Steps<input name="steps" type="number" min="5" max="60" value="25"></label><label>Guidance<input name="cfg" type="number" min="1" max="15" value="7" step="0.5"></label></div><label>Seed<input name="seed" type="number" min="0" max="9007199254740991" value="20261011"></label><button id="generate-image">Generate image</button><p id="image-status" role="status" aria-live="polite"></p><p class="help">Selected model · one image per job<br>Steps and image size drive diffusion work. Text token count alone is not a measure of GPU cost.</p></form><div><div class="section-head"><h2>Review images</h2><span id="image-count"></span></div><div id="image-gallery"></div></div></div>`;
 $('#image-form').onsubmit=async e=>{e.preventDefault();if($('#generate-image').disabled)return;const story=activeStory,b=Object.fromEntries(new FormData(e.target));submittingImages.add(story);localStorage.removeItem('ecco-image-job:'+story);setGenerationBusy($('#generate-image'),true,'Submitting…','Generate image');$('#image-status').textContent='Sending your image job…';try{const job=await api('images',{...modelPayload('images'),...b,story_id:story,...(refinementSource?{source_asset_id:refinementSource.id}:{})});localStorage.setItem('ecco-image-job:'+story,job.id);submittingImages.delete(story);await refresh();}catch(err){submittingImages.delete(story);if(activeStory===story&&$('#image-status')){$('#image-status').textContent=err.message+' Check Activity before retrying.';setGenerationBusy($('#generate-image'),false,'','Generate image');}notice(err.message,true);}};attachModelControls('images',$('#image-form'));updateGallery();updateImageStatus();if(refinementSource){$('#image-form').elements.prompt.value=refinementSource.prompt;$('#clear-refinement').onclick=()=>{refinementSource=null;imagePage();};$('#image-form').elements.strength.oninput=e=>$('#strength-value').textContent=e.target.value+(+e.target.value<.5?' · subtle changes':' · larger variations');}
}
function updateGallery(){const el=$('#image-gallery');if(!el)return;const list=window.EccoGeneration?.results('image',assets())||[];$('#image-count').textContent=list.length+' frames';el.className=list.length?'cards':'';el.innerHTML=list.length?list.map(card).join(''):empty('Your first frame starts here','Enter a prompt and generate an image on your GPU.');wireCards();}
function persistDraft(){if(draft.story_id&&draft.story_id!==activeStory)return;draft.story_id=activeStory;localStorage.setItem(activeStory?'ecco-board-draft:'+activeStory:'ecco-board-new-draft',JSON.stringify(draft));savedBoard=null;}
function boardPage(){
 draft=loadDraft();
 $('#page').innerHTML=`<p class="intro">Write your original adaptation, split it into scenes, and choose approved images. Scene splitting is a simple editor aid; it does not call a language model.</p><div class="stack"><div class="panel form"><label>Story Title<input id="board-title" value="${esc(draft.title)}"></label><label>Story / Script / Narration<textarea id="story-text">${esc(draft.story)}</textarea></label><div class="row"><button id="split">Split paragraphs into scenes</button><button id="add-scene" class="secondary">Add a scene</button></div></div><div id="scenes"></div><div class="row"><button id="save-board">Save storyboard revision</button></div><div id="saved-boards"></div></div>`;
 $('#board-title').oninput=e=>{draft.title=e.target.value;persistDraft();};$('#story-text').oninput=e=>{draft.story=e.target.value;persistDraft();};
 $('#split').onclick=()=>{draft.scenes=draft.story.split(/\n\s*\n/).filter(s=>s.trim()).slice(0,60).map(s=>({image_id:approvedImages()[0]?.id||'',seconds:3,motion:'Slow cinematic camera movement, consistent character and lighting',narration:s.trim()}));persistDraft();renderScenes();};
 $('#add-scene').onclick=()=>{if(draft.scenes.length>=60)return notice('Maximum 60 scenes per pilot storyboard',true);draft.scenes.push({image_id:approvedImages()[0]?.id||'',seconds:3,motion:'Slow cinematic camera movement',narration:''});persistDraft();renderScenes();};
 $('#save-board').onclick=()=>action(async()=>{savedBoard=await api('boards',{...draft,story_id:activeStory});notice('Storyboard revision saved. Open Video studio to render it.');});renderScenes();renderSavedBoards();
}
function shotOptions(values,value){return [''].concat(values).map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(v||'From image / prompt')}</option>`).join('');}
function storyboardIsAudio(){
 let setup={};try{setup=JSON.parse(localStorage.getItem(activeStory?'ecco-story-description:'+activeStory:'ecco-new-story-draft')||'{}');}catch{}
 const format=(!activeStory&&setup.cloudId?'':setup.story_format)||draft.story_format;
 return String(format||setup.genre||draft.genre||'').toLowerCase()==='audio';
}
function renderScenes(){const audioOnly=storyboardIsAudio(),imgs=approvedImages();$('#scenes').innerHTML=draft.scenes.map((s,i)=>{if(audioOnly)return `<article class="panel scene" style="grid-template-columns:minmax(0,1fr)"><div><div class="scene-head"><h3>Scene ${String(i+1).padStart(2,'0')}</h3><div><button class="small secondary" data-up="${i}" ${i===0?'disabled':''}>↑</button> <button class="small secondary" data-down="${i}" ${i===draft.scenes.length-1?'disabled':''} aria-label="Move shot down">↓</button> <button class="small secondary" data-remove="${i}">Remove</button></div></div><div class="scene-fields"><label class="wide"><span style="color:var(--accent)">Scene Title</span><input data-scene="${i}" data-field="title" value="${esc(s.title||'')}"></label><label class="wide">Narration Script<textarea data-scene="${i}" data-field="narration">${esc(s.narration)}</textarea></label><label>Seconds<input type="number" min="1" max="30" step="1" value="${s.seconds}" data-scene="${i}" data-field="seconds"></label></div></div></article>`;const a=imgs.find(a=>a.id===s.image_id);return `<article class="panel scene"><div>${a?`<img data-asset="${a.id}" src="${media(a)}" alt="Scene ${i+1} reference">`:''}</div><div><div class="scene-head"><h3>Scene ${String(i+1).padStart(2,'0')}</h3><div><button class="small secondary" data-up="${i}" ${i===0?'disabled':''}>↑</button> <button class="small secondary" data-down="${i}" ${i===draft.scenes.length-1?'disabled':''} aria-label="Move shot down">↓</button> <button class="small secondary" data-remove="${i}">Remove</button></div></div><div class="scene-fields"><label>Seconds<input type="number" min="1" max="30" step="1" value="${s.seconds}" data-scene="${i}" data-field="seconds"></label><label>Shot framing<select data-scene="${i}" data-field="shot_size">${shotOptions(['Wide shot','Medium shot','Close-up','Extreme close-up','Over-the-shoulder'],s.shot_size)}</select></label><label>Camera angle<select data-scene="${i}" data-field="camera_angle">${shotOptions(['Eye level','Low angle','High angle','Bird’s-eye view','Dutch angle'],s.camera_angle)}</select></label><label>Camera movement<select data-scene="${i}" data-field="camera_move">${shotOptions(['Locked-off camera','Slow dolly in','Slow dolly out','Pan left','Pan right','Tracking shot','Slow orbit'],s.camera_move)}</select></label><div class="shot-subjects"><h4>Subjects &amp; actions</h4><p class="help">Up to 4 characters or objects. Prompt guidance only: exact positions, identity and motion are not guaranteed. Preview mode ignores these AI controls.</p>${(s.subjects||[]).map((o,j)=>`<div class="subject-row"><label>Subject name<input data-subject-scene="${i}" data-subject="${j}" data-subject-field="name" maxlength="80" value="${esc(o.name)}"></label><label>Appearance / position<input data-subject-scene="${i}" data-subject="${j}" data-subject-field="description" maxlength="500" value="${esc(o.description)}"></label><label>Action<input data-subject-scene="${i}" data-subject="${j}" data-subject-field="action" maxlength="500" value="${esc(o.action)}"></label><button class="small secondary" data-remove-subject="${i}:${j}">Remove subject</button></div>`).join('')}<button class="small secondary" data-add-subject="${i}" ${(s.subjects||[]).length>=4?'disabled':''}>+ Add subject</button></div><label class="wide">Motion prompt<textarea data-scene="${i}" data-field="motion">${esc(s.motion)}</textarea></label><label class="wide"><span style="color:var(--accent)">Scene Title</span><input data-scene="${i}" data-field="title" value="${esc(s.title||'')}"></label><label class="wide">Narration script<textarea data-scene="${i}" data-field="narration">${esc(s.narration)}</textarea></label></div></div></article>`;}).join('')||empty('Build your sequence','Split the story into scenes or add a scene manually.');
 document.querySelectorAll('[data-field]').forEach(el=>{el.oninput=()=>{draft.scenes[+el.dataset.scene][el.dataset.field]=el.dataset.field==='seconds'?Number(el.value):el.value;persistDraft();};if(el.dataset.field==='image_id')el.onchange=()=>{el.oninput();renderScenes();};});
 document.querySelectorAll('[data-down]').forEach(el=>el.onclick=()=>{const i=+el.dataset.down;[draft.scenes[i],draft.scenes[i+1]]=[draft.scenes[i+1],draft.scenes[i]];persistDraft();renderScenes();});
 document.querySelectorAll('[data-add-subject]').forEach(el=>el.onclick=()=>{const s=draft.scenes[+el.dataset.addSubject];s.subjects=s.subjects||[];if(s.subjects.length<4)s.subjects.push({name:'',description:'',action:''});persistDraft();renderScenes();});
 document.querySelectorAll('[data-subject-field]').forEach(el=>el.oninput=()=>{draft.scenes[+el.dataset.subjectScene].subjects[+el.dataset.subject][el.dataset.subjectField]=el.value;persistDraft();});
 document.querySelectorAll('[data-remove-subject]').forEach(el=>el.onclick=()=>{const [i,j]=el.dataset.removeSubject.split(':').map(Number);draft.scenes[i].subjects.splice(j,1);persistDraft();renderScenes();});
 document.querySelectorAll('[data-up]').forEach(el=>el.onclick=()=>{const i=+el.dataset.up;[draft.scenes[i-1],draft.scenes[i]]=[draft.scenes[i],draft.scenes[i-1]];persistDraft();renderScenes();});
 document.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>{draft.scenes.splice(+el.dataset.remove,1);persistDraft();renderScenes();});
}
function renderSavedBoards(){const e=$('#saved-boards');if(!e)return;if(!boards().length){e.replaceChildren();return;}e.innerHTML=`<h3>Saved revisions</h3>${boards().map(b=>`<p class="help">${esc(b.title)} · ${b.scenes.length} scenes · ${new Date(b.created*1000).toLocaleString()} <button class="small secondary" data-load-board="${b.id}">Edit a copy</button></p>`).join('')||'<p class="help">No revisions saved yet.</p>'}`;e.querySelectorAll('[data-load-board]').forEach(btn=>btn.onclick=()=>{const b=boards().find(b=>b.id===btn.dataset.loadBoard);draft={title:b.title,story:b.scenes.map(s=>s.narration).join('\n\n'),scenes:structuredClone(b.scenes)};persistDraft();boardPage();});}

function renderPage(){
 $('#page').innerHTML=`<p class="intro">Choose a saved storyboard and render a review copy into <strong>video-dev</strong>. Start with a short sequence before scaling up.</p><div class="grid"><form id="video-form" class="panel form"><h2>Render a sequence</h2><label>Storyboard revision<select name="board_id" required><option value="">Choose a revision</option>${boards().map(b=>`<option value="${b.id}">${esc(b.title)} · ${b.scenes.length} scenes · ${new Date(b.created*1000).toLocaleTimeString()}</option>`).join('')}</select></label><p class="help">Wan A14B: native 1280 × 720, up to 6 seconds per shot at 16 fps. Wan 5B: up to 5 seconds. Up to 8 ordered shots / 60 seconds per AI render, 5B and preview at 24 fps. Preview uses still images with camera moves. Both currently produce silent video.</p><button id="generate-video" ${!state.storage_pending&&!boards().length?'disabled':''}>Generate review video</button><p id="video-status" role="status" aria-live="polite">Choose a storyboard revision, then generate your video.</p></form><div><div class="section-head"><h2>Review videos</h2></div><div id="video-gallery"></div></div></div>`;
 $('#video-form').onsubmit=async e=>{e.preventDefault();if($('#generate-video').disabled)return;const b=Object.fromEntries(new FormData(e.target));const storyAtSubmit=activeStory;submittingVideos.add(storyAtSubmit);setGenerationBusy($('#generate-video'),true,'Submitting…','Generate review video');$('#video-status').textContent='Submitting video job…';try{const config=modelPayload('video');const job=await api('videos',{...b,...config});localStorage.setItem('ecco-video-job:'+storyAtSubmit,job.id);submittingVideos.delete(storyAtSubmit);if(activeStory===storyAtSubmit&&$('#video-status'))$('#video-status').textContent='Queued. Waiting for the GPU. You do not need to click Generate again.';notice('Video job accepted. Watch the status beside Generate.');await refresh();}catch(err){submittingVideos.delete(storyAtSubmit);if($('#video-status'))$('#video-status').textContent=err.message+' Check Activity before retrying to avoid submitting twice.';setGenerationBusy($('#generate-video'),false,'','Generate review video');notice(err.message,true);}};attachModelControls('video',$('#video-form'));updateVideoGallery();updateVideoStatus();
}
const submittingVideos=new Set(),submittingImages=new Set();
function setGenerationBusy(button,busy,label,idle){if(!button)return;button.disabled=busy;button.setAttribute('aria-busy',String(busy));button.innerHTML=busy?'<span class="generation-spinner" aria-hidden="true"></span>'+esc(label):idle;}
function updateImageStatus(){
 const el=$('#image-status'),button=$('#generate-image');if(!el||!button)return;
 const idle=$('#studio-reference-image')?.value?'Generate edited image':'Generate image';
 if(submittingImages.has(activeStory)){setGenerationBusy(button,true,'Submitting…',idle);el.textContent='Sending your image job…';return;}
 const id=window.EccoGeneration?.jobId('image');
 if(!id){el.textContent='';setGenerationBusy(button,false,'',idle);return;}
 const j=state?.records.find(r=>r.kind==='job'&&r.id===id);
 if(!j){setGenerationBusy(button,true,'Queued…',idle);el.textContent='Job accepted. Waiting for its status…';return;}
 const busy=['queued','running'].includes(j.status);
 setGenerationBusy(button,busy,j.status==='queued'?'Queued…':'Generating image…',idle);
 if(j.status==='queued'){el.textContent='Queued. Waiting for the GPU. No need to click again.';return;}
 if(j.status==='running'){el.textContent='Generating image · '+(j.progress||'Preparing model')+'. This page updates automatically.';return;}
 if(j.status!=='done'){el.textContent='Image '+j.status+': '+(j.error||'Check Activity for details.');return;}
 const result=state.records.find(a=>a.kind==='asset'&&a.media==='image'&&a.id===j.result&&!a.deleted);
 if(!result){el.textContent='Job finished, but its image output is unavailable. Check Activity for details.';return;}
 const img=[...document.querySelectorAll('#image-gallery img[data-asset]')].find(e=>e.dataset.asset===result.id);
 if(!img){el.textContent='Image saved, but it is not displayed in this story. Check the image library.';return;}
 if(!img.complete){img.loading='eager';el.textContent='Generation finished. Loading the new image…';if(!img.dataset.statusWatch){img.dataset.statusWatch='1';img.addEventListener('load',updateImageStatus,{once:true});img.addEventListener('error',updateImageStatus,{once:true});}return;}
 if(!img.naturalWidth){el.textContent='The image was generated, but its preview could not load. Check the connection or download it from its card.';return;}
 if(refinementSource&&result.settings?.source_asset_id===refinementSource.id){refinementSource=result;const preview=$('.refine-preview');if(preview){preview.src=media(result);preview.alt='Latest refined image';}}
 el.textContent='✓ New image ready. ';
 const view=document.createElement('button');view.type='button';view.className='small secondary';view.textContent='View new image';view.onclick=()=>{img.closest('.card')?.scrollIntoView({behavior:'smooth',block:'center'});};el.append(view);
}

function updateVideoStatus(){
 const el=$('#video-status'),button=$('#generate-video');if(!el||!button)return;const idle=button.closest('[data-generation-studio]')?'Generate video':'Generate review video';if(submittingVideos.has(activeStory)){setGenerationBusy(button,true,'Submitting…',idle);return;}
 const id=window.EccoGeneration?.jobId('video');if(!id){el.textContent='';setGenerationBusy(button,false,'',idle);return;}
 const j=state.records.find(r=>r.kind==='job'&&r.id===id);if(!j){if(id){setGenerationBusy(button,true,'Queued…',idle);el.textContent='Job accepted. Waiting for its status…';}return;}
 const busy=['queued','running'].includes(j.status);setGenerationBusy(button,busy,j.status==='queued'?'Queued…':'Generating video…',idle);button.disabled=busy||(!button.closest('[data-generation-studio]')&&!boards().length);
 if(j.status==='queued')el.textContent='Queued. Waiting for the shared GPU. Do not submit again.';
 else if(j.status==='running')el.textContent='';
 else if(j.status==='done')el.textContent='✓ Video ready — press Play under Review videos.'+(j.seconds?' Render time: '+j.seconds.toFixed(1)+' seconds.':'');
 else el.textContent='Video '+j.status+': '+(j.error||'Check Activity for details.');
}
function updateVideoGallery(){const e=$('#video-gallery');if(!e)return;const list=window.EccoGeneration?.results('video',assets())||[];e.className=list.length?'cards':'';e.innerHTML=list.length?list.map(card).join(''):'';wireCards();}
function trashPage(){const archived=state.records.filter(r=>r.kind==='story'&&r.deleted);const list=allAssets().filter(a=>a.deleted);$('#page').innerHTML=`<div class="section-head"><h2>Trash · ${esc(currentStory().title)}</h2><button id="back-images">Back to images</button></div><div class="panel"><h3>Deleted stories</h3>${archived.map(s=>`<p>${esc(s.title)} <button class="small secondary" data-restore-story="${s.id}">Restore story</button></p>`).join('')||'<p class="help">No deleted stories.</p>'}</div><p>Deleted assets stay recoverable here. Existing rendered videos are unchanged.</p><div class="cards">${list.map(card).join('')||'Trash is empty.'}</div>`;$('#back-images').onclick=()=>navigate('images');document.querySelectorAll('[data-restore-story]').forEach(b=>b.onclick=()=>action(async()=>{await api('stories/archive',{story_id:b.dataset.restoreStory,restore:true});notice('Story restored to the dropdown.');}));wireCards();if(typeof hydrateMedia==='function')hydrateMedia();}
function reviewPage(){const list=assets().filter(a=>a.stage==='prod');$('#page').innerHTML=`<p class="intro">Approved assets in <strong>image-prod</strong> and <strong>video-prod</strong>. GitHub sync status is shown on each asset.</p>${list.length?`<div class="cards">${list.map(card).join('')}</div>`:empty('Your production library is empty','Review an image or video and approve it to add it here.')}`;wireCards();}
function connectYouTube(options={}){
 if(connectYouTube.pending)return;
 if(!window.EccoStorage?.ready||!state.config.youtube_configured)return setupYouTube();
 // Open synchronously from the user's click so Google authorization is not blocked.
 const popup=window.open('about:blank','ecco-youtube-auth','width=700,height=800');
 if(!popup){notice('Allow the Google authorization window, then click Connect YouTube again.',true);return;}
 popup.opener=null;connectYouTube.pending=true;updateYouTubeConnection();
 return action(async()=>{
  try{
   const result=await api('youtube/connect',{playlists:options.playlists===true}),url=new URL(result.url);
   if(url.origin!=='https://accounts.google.com')throw Error('The backend returned an invalid Google authorization URL.');
   if(popup.closed)throw Error('Google authorization was closed. Click Connect YouTube to try again.');
   popup.location.href=url.href;
  }catch(error){popup.close();throw error;}
  finally{connectYouTube.pending=false;updateYouTubeConnection();}
 });
}
function youtubeChannels(){
 if(!window.EccoStorage?.ready)return [];
 const channels=[state.config.youtube_channel];
 return channels.filter(channel=>channel?.id&&channel?.title);
}
function selectedYouTubeChannel(){
 const channels=youtubeChannels(),select=$('#publish-form [name=channel_id]');
 return channels.find(channel=>channel.id===select?.value)||null;
}
function syncYouTubeSelect(select,channels){
 if(!select)return;
 const previous=select.value,signature=JSON.stringify(channels);
 if(select.dataset.channels!==signature){
  select.replaceChildren(new Option(channels.length?'Choose a channel':'No connected channels',''),...channels.map(c=>new Option(c.title+(c.handle?' · '+c.handle:'')+' · '+c.id,c.id)));
  select.value=channels.some(c=>c.id===previous)?previous:channels.length===1?channels[0].id:'';
  select.dataset.channels=signature;
 }
 select.disabled=!channels.length;
}
function setupYouTube(){
 if($('#youtube-setup-dialog'))return;
 const dialog=document.createElement('dialog');dialog.id='youtube-setup-dialog';dialog.setAttribute('aria-labelledby','youtube-setup-title');
 dialog.innerHTML='<form class="form"><div class="section-head"><h2 id="youtube-setup-title">Set up YouTube</h2><button type="button" class="secondary ai-dialog-close" data-close aria-label="Close YouTube setup">×</button></div><p class="help">Select the OAuth client JSON downloaded from Google Cloud. It will be encrypted and saved privately on your workspace backend.</p><label data-import>Google OAuth client JSON<input type="file" name="client_json" accept=".json,application/json" required></label><p class="help" data-requirement></p><button type="button" class="secondary" data-storage>Connect storage</button><p role="status" aria-live="polite" data-status></p><button type="submit">Install configuration</button><button type="button" data-authorize hidden>Connect YouTube securely</button></form>';
 document.body.append(dialog);
 const form=dialog.querySelector('form'),fileInput=form.querySelector('[name=client_json]'),submit=form.querySelector('[type=submit]'),status=form.querySelector('[data-status]');
 let busy=false;
 const storage=form.querySelector('[data-storage]'),authorize=form.querySelector('[data-authorize]'),requirement=form.querySelector('[data-requirement]');
 dialog.updateConnection=()=>{
  const ready=!!window.EccoStorage?.ready,configured=ready&&!!state.config.youtube_configured,available=ready&&!!state.config.youtube_setup_available;
  storage.hidden=ready;authorize.hidden=!configured;submit.hidden=configured;submit.disabled=busy||!available;
  fileInput.closest('label').hidden=configured;fileInput.required=!configured;fileInput.disabled=busy||configured;
  const message=!ready?'Choose your JSON here, then connect workspace storage to install it. The storage access key is separate from this JSON.':configured?'Configuration is installed. Connect your channel with Google.':available?'Ready to install your Google OAuth client JSON.':'YouTube setup is unavailable on this workspace. Check the existing backend configuration.';
  if(requirement.textContent!==message)requirement.textContent=message;
 };
 storage.onclick=()=>window.EccoStorage?.open({preservePage:true});
 authorize.onclick=()=>{dialog.close();connectYouTube();};
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{form.reset();dialog.remove();$('#connect-youtube')?.focus();},{once:true});
 form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  if(!window.EccoStorage?.ready||!state.config.youtube_setup_available){dialog.updateConnection();return;}
  const file=fileInput.files?.[0];
  if(!file){status.textContent='Choose the JSON file downloaded from Google Cloud.';return;}
  if(!file.size||file.size>32768){status.textContent='Choose a Google OAuth client JSON file under 32 KB.';return;}
  busy=true;submit.disabled=true;fileInput.disabled=true;status.textContent='Installing configuration…';
  try{
   let config;
   try{config=JSON.parse((await file.text()).replace(/^\uFEFF/,''));}
   catch{throw Error('This file is not valid JSON. Choose the Google OAuth client download.');}
   if(!config||typeof config!=='object'||Array.isArray(config)||!config.web)throw Error('Choose the Google OAuth JSON for a Web application.');
   const result=await api('youtube/configure',config);
   if(!result.youtube_configured)throw Error('The backend could not verify YouTube setup.');
   Object.assign(state.config,result);updateYouTubeConnection();
   dialog.close();notice('YouTube configuration installed. Click Connect beside YouTube in Connections to authorize your channel.');
  }catch(error){
   status.textContent=error.message||'Configuration could not be installed. Try again.';
  }finally{busy=false;fileInput.value='';dialog.updateConnection();}
 };
 dialog.updateConnection();dialog.showModal();(authorize.hidden?fileInput:authorize).focus();
}
function updateYouTubeConnection(){
 const channels=youtubeChannels(),channel=channels[0],button=$('#connect-youtube');
 if(button){
  button.disabled=!!connectYouTube.pending;button.dataset.connected=String(!!channel);
  const label=connectYouTube.pending?'Connecting…':channel?'Connected':'Connect';if(button.textContent!==label)button.textContent=label;
  button.title=channel?'Reconnect YouTube':state.config.youtube_configured?'Authorize a channel you own':'Set up YouTube';
 }
 const disconnect=$('#disconnect-youtube');if(disconnect){disconnect.hidden=!channel;disconnect.disabled=!!disconnect.dataset.disconnecting;}
 for(const badge of document.querySelectorAll('[data-youtube-status]')){
  const label=channels.length>1?channels.length+' channels connected':channel?channel.title+(channel.handle?' · '+channel.handle:''):'Not connected';
  if(badge.textContent!==label)badge.textContent=label;badge.classList.toggle('pending',!channel);
 }
 const enable=$('#enable-youtube-playlists');if(enable){enable.hidden=!channel||!state.config.youtube_playlists_available||!!state.config.youtube_playlist_write;enable.disabled=!!connectYouTube.pending;}
 $('#youtube-setup-dialog')?.updateConnection?.();
 const form=$('#publish-form'),destination=form?.querySelector('[name=channel_id]'),confirmation=form?.querySelector('[name=confirmed]');
 syncYouTubeSelect(destination,channels);
 const selected=selectedYouTubeChannel(),selectedId=selected?.id||'';
 if(form&&form.dataset.reviewChannel!==selectedId){form.dataset.reviewChannel=selectedId;if(confirmation)confirmation.checked=false;}
 window.EccoYouTubePlaylists?.update();
 const playlistName=window.EccoYouTubePlaylists?.selectedTitle();
 const review=form?.querySelector('[name=confirmed]+span');if(review)review.textContent=(form.publishingSelection?.items.length>1?'I reviewed these '+form.publishingSelection.items.length+' selected videos and authorize their uploads to ':'I reviewed this video and authorize its upload to ')+(selected?(selected.handle||selected.title)+' ('+selected.id+')':'the selected channel')+(playlistName?' and add it to the playlist “'+playlistName+'”':'')+' with the visibility and audience selected above.';
 const submit=$('#publish-form button:not([type="button"])');
 if(submit)submit.disabled=!selected||!assets().some(a=>a.media==='video'&&a.stage==='prod'&&!a.upload_state);
 window.EccoPublishingConnection?.();
 window.EccoPublishing?.update();
}

function mountYouTubeConnection(root){
 const section=document.createElement('section');section.className='connection';section.id='youtube-connection';
 section.innerHTML='<div class="connection-heading"><h3>YouTube</h3><button type="button" class="secondary" id="connect-youtube">Connect</button></div><p class="help" data-youtube-status aria-live="polite">Not connected</p><button type="button" class="secondary" id="enable-youtube-playlists" hidden>Enable playlists</button><button type="button" class="secondary" id="disconnect-youtube" hidden>Disconnect</button>';
 root.append(section);section.querySelector('#connect-youtube').onclick=()=>connectYouTube();section.querySelector('#enable-youtube-playlists').onclick=()=>connectYouTube({playlists:true});
 section.querySelector('#disconnect-youtube').onclick=()=>action(async()=>{const button=$('#disconnect-youtube');if(button.dataset.disconnecting)return;button.disabled=true;button.dataset.disconnecting='true';try{const result=await api('youtube/disconnect',{});Object.assign(state.config,result||{youtube_channel:null,youtube_playlist_write:false});}finally{delete button.dataset.disconnecting;updateYouTubeConnection();}});
 updateYouTubeConnection();
}
window.EccoYouTube={mount:mountYouTubeConnection,update:updateYouTubeConnection};
function publishPage(){const list=assets().filter(a=>a.media==='video'&&a.stage==='prod'&&!a.upload_state),channel=state.config.youtube_channel;
 $('#page').innerHTML=`<form id="publish-form" class="panel form"><label>YouTube channel<select name="channel_id" required></select></label><label>Approved video<select name="asset_id" required><option value="">Choose a production video</option>${list.map(a=>`<option value="${a.id}">${esc(a.title)} · ${a.id.slice(0,8)}</option>`).join('')}</select></label><label>Video title<input name="title" maxlength="100" required value="${esc(currentStory().title)} — ECCO AI Labs"></label><label>Description<textarea name="description">An ECCO AI Labs development film.</textarea></label><div class="row"><label>Visibility<select name="visibility"><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option><option value="schedule">Schedule</option></select></label><label>Audience<select name="made_for_kids" required><option value="">Choose an audience</option><option value="false">Not made for kids</option><option value="true">Made for kids</option></select></label></div><label data-youtube-only="schedule" hidden>Publish at (your local time)<input type="datetime-local" name="publish_at"></label><label class="inline-check"><input name="confirmed" type="checkbox" required><span>I reviewed this video and authorize its upload to the connected channel with the visibility and audience selected above.</span></label><button ${!channel||!list.length?'disabled':''}>Upload approved video</button></form><div class="statline">${assets().filter(a=>a.youtube_id).map(a=>`<span><a href="https://www.youtube.com/watch?v=${encodeURIComponent(a.youtube_id)}" target="_blank" rel="noopener">Uploaded ${esc(a.youtube_id)}</a> · ${esc(a.youtube_visibility)}${a.youtube_playlist_error?' · '+esc(a.youtube_playlist_error):a.youtube_playlist_id?' · Added to playlist':''}</span>`).join('')}</div>`;
 window.EccoYouTubePlaylists?.mount($('#publish-form'));
 $('#publish-form [name=channel_id]').onchange=updateYouTubeConnection;
 const visibility=$('#publish-form [name=visibility]'),schedule=$('#publish-form [name=publish_at]');
 visibility.onchange=()=>{const scheduled=visibility.value==='schedule';schedule.closest('label').hidden=!scheduled;schedule.required=scheduled;};
 updateYouTubeConnection();
 $('#publish-form').onsubmit=e=>{e.preventDefault();let b=Object.fromEntries(new FormData(e.target));b.confirmed=b.confirmed==='on';b.made_for_kids=b.made_for_kids==='true';if(b.visibility==='schedule'){const date=new Date(b.publish_at);if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now()){notice('Choose a future publishing date and time.',true);return;}b.visibility='private';b.publish_at=date.toISOString();}else delete b.publish_at;action(async()=>{await (window.EccoPublishingMedia?window.EccoPublishingMedia.submit(e.target,b):api('youtube/publish',b));notice('Upload queued. Check Activity for completion and actual visibility.');});};
}
function navigate(p){page=p;$('#heading').textContent=names[p];document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===p));({images:imagePage,board:boardPage,render:renderPage,review:reviewPage,publish:publishPage,trash:trashPage,models:modelsPage,characters:charactersPage}[p])();}
function connections(){const c=state.config;$('#connections').innerHTML=`<div class="connection"><h3>GPU workspace</h3><p>ComfyUI on this Runpod machine. Wan models: ${c.wan_ready?'ready':'not ready'}. FFmpeg: ${c.ffmpeg?'ready':'missing'}.</p></div><div class="connection"><h3>GitHub · ${esc(c.repo)}</h3><p>${c.github_connected?'Write credential configured; each sync verifies repository access.':'Not connected. Assets remain on the persistent GPU volume until GitHub write access is configured.'}</p><p>Folders: image-dev, image-prod, video-dev, video-prod, storyboards. Files above 90 MiB need Git LFS support before sync; this pilot does not implement LFS.</p><p>The interface is hosted on GitHub Pages. GPU connectivity is managed by the independent workspace service.</p></div><div class="connection"><h3>YouTube</h3><p>${c.youtube_channel?'Connected: '+esc(c.youtube_channel.title):'OAuth connection pending.'} Publishing uses the verified channel shown in the review form.</p></div><div class="connection"><h3>Compute estimates</h3><p>$${c.hourly_rate.toFixed(3)}/hour × elapsed job time. This is an allocation estimate, not measured GPU utilization or the complete Runpod bill. Model loading and waiting can be included; idle time, storage, setup and failed experiments outside this app are excluded.</p></div>`;$('#connection-dialog').showModal();}
async function refresh(next=null,throwErrors=false){if(!next&&!connected&&!window.EccoStorage?.ready)return false;try{next=next||await api('state');state=next;updateYouTubeConnection();renderModelNav();const bill=state.records.filter(r=>r.kind==='billing').sort((a,b)=>b.created-a.created)[0];const session=state.config.session_cost;powerButton.textContent=state.config.billing?.last_success&&Date.now()/1000-state.config.billing.last_success<2100?'GPU & costs · $'+state.config.billing.total_spent_usd.toFixed(2)+' account total':session?'GPU & costs · ~$'+session.estimated_usd.toFixed(2)+' this session':'GPU & costs · $1.79/hr';if(activeStory&&!stories().some(s=>s.id===activeStory))activeStory='';if(!document.querySelector('#story-picker'))draft=loadDraft();storyControls();const gpuReady=state.config.runtime?.services?.comfy?.ready;$('#wan-badge').textContent=!gpuConnected()?'Storage connected · GPU disconnected':gpuReady===false?'Connected · GPU engine starting':'Connected';$('#wan-badge').className='badge '+(gpuReady===false?'pending':'');const a=assets(),b=boards();const checks=[['Generate an image',a.some(a=>a.media==='image')],['Approve an image',approvedImages().length],['Save a storyboard',b.length],['Render a video',a.some(a=>a.media==='video')],['Connect GitHub',state.config.github_connected],['Connect YouTube',state.config.youtube_channel]];$('#checklist').innerHTML=checks.map(([t,done])=>`<li class="${done?'done':''}">${done?'✓':'○'} ${t}</li>`).join('');
 const jobs=(window.EccoPublishingStatus?.jobs()||state.records.filter(r=>r.kind==='job')).filter(j=>!j.publishing_attempt).sort((a,b)=>b.created-a.created).slice(0,12);let jobList=$('#ecco-generation-jobs');if(!jobList){jobList=document.createElement('div');jobList.id='ecco-generation-jobs';$('#jobs').querySelectorAll(':scope > p').forEach(p=>p.remove());$('#jobs').append(jobList);}
 window.EccoActivityView.syncRows(jobList,jobs,(row,j)=>{const markup=`<div class="job ${j.status==='failed'?'failed':''}"><div>${esc(j.label)}<div class="detail">${new Date(j.created*1000).toLocaleTimeString()}</div></div><div>${!j.error&&!j.sync_warning&&window.EccoClipProgress?.isSequence(j)?esc(window.EccoClipProgress.summary(j)):esc(j.error||j.sync_warning||j.progress||'')}<div class="detail">${esc(j.status)}</div></div><div>${j.seconds===undefined?'—':j.seconds.toFixed(1)+' s'}</div><div>${j.estimated_compute_usd===undefined?'—':'$'+j.estimated_compute_usd.toFixed(3)}</div></div>`;if(row.dataset.content!==markup){row.dataset.content=markup;row.innerHTML=markup;}});
 let emptyJobs=$('#ecco-no-generation-jobs');if(!emptyJobs){emptyJobs=document.createElement('p');emptyJobs.id='ecco-no-generation-jobs';emptyJobs.className='help';emptyJobs.textContent='No jobs yet. Generate your first image to begin measuring.';jobList.after(emptyJobs);}emptyJobs.hidden=jobs.length>0;
 window.EccoPublishingStatus?.sync();
 const sig=JSON.stringify(state.records.filter(r=>r.kind!=='job'));if(sig!==lastSignature){lastSignature=sig;if(page==='images')updateGallery();if(page==='render')updateVideoGallery();if(page==='review')reviewPage();if(page==='trash')trashPage();if(page==='board')renderSavedBoards();}updateVideoStatus();hydrateMedia();return true;
 }catch(e){$('#wan-badge').textContent='Offline';$('#wan-badge').className='badge pending';if(throwErrors)throw e;if(window.EccoStorage?.reportError)window.EccoStorage.reportError(e);else notice('Cannot reach workspace storage. '+e.message,true);return false;}}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=> navigate(b.dataset.page));$('#settings').onclick=()=>state.storage_pending?notice('Connect your workspace using Account → Storage.'):connections();$('#close-settings').onclick=()=>$('#connection-dialog').close();$('#sync').onclick=()=>action(async()=>{if(!state.config.github_connected)throw Error('GitHub is not connected. Open Connections & storage for details.');await api('github/sync',{});notice('GitHub sync queued.');});
const reconnectButton=document.createElement('button');reconnectButton.textContent='Connect GPUs';reconnectButton.className='secondary';reconnectButton.id='reconnect-gpu';reconnectButton.hidden=true;reconnectButton.onclick=()=>{};
welcome();let activityRefreshPending=false;setInterval(async()=>{if(activityRefreshPending)return;activityRefreshPending=true;try{await refresh();}finally{activityRefreshPending=false;}},3000);

function powerControls(){
 let d=$('#power-dialog');if(!d){d=document.createElement('dialog');d.id='power-dialog';document.body.appendChild(d);}
 const bill=state?.records.filter(r=>r.kind==='billing').sort((a,b)=>b.created-a.created)[0];
 const session=state?.config?.session_cost;
 const sessionHTML=session?`<h3>Current session · compute estimate</h3><p><strong>~$${session.estimated_usd.toFixed(2)}</strong> over ${(session.elapsed_seconds/3600).toFixed(2)} hours at $${session.hourly_rate.toFixed(2)}/hour. Includes idle time. Excludes storage and earlier sessions. Based on container uptime, not the RunPod invoice.</p>`:'';
 const liveBill=state?.config?.billing;
 const liveBillingHTML=liveBill?.connected?`<h3>RunPod account total</h3><p>${liveBill.last_success?`<strong>$${liveBill.total_spent_usd.toFixed(2)} spent</strong> · $${liveBill.balance_usd.toFixed(2)} balance<br>Last updated: ${new Date(liveBill.last_success*1000).toLocaleString()}`:'Awaiting first reading'}</p><p class="help">Refreshes every 30 minutes while this Pod is running. RunPod reporting can lag. ${esc(liveBill.last_error||'')}</p><button type="button" id="refresh-billing">Refresh now</button>`:`<h3>Connect actual RunPod billing</h3><p class="help">Automatic account totals require a RunPod API key with GraphQL Read Only access. Enter it here in the private Studio, never in chat. It stays on your private volume and is never sent to GitHub.</p><form id="billing-key-form" class="form"><label>Read-only billing API key<input name="api_key" type="password" autocomplete="off" required></label><button>Connect billing · refresh every 30 minutes</button></form>`;
 const billingHTML=bill?`<h3>Historical account snapshot · NOT LIVE</h3><p><strong>$${bill.credit_used_usd.toFixed(2)} credit used</strong> · balance $${bill.balance_usd.toFixed(2)}</p><p>Snapshot checked ${esc(bill.checked_label)}. Calculated from $${bill.total_credits_usd.toFixed(2)} loaded minus remaining balance; this is not a live billing feed or a per-story cost.</p><p>RunPod account spend rate at that check: <strong>$${bill.rate_usd_hour.toFixed(3)}/hour</strong>, including charged resources. Billing reports can lag by an hour.</p>`:'<h3>Historical account snapshot · NOT LIVE</h3><p>Connect the GPU to view the last saved billing snapshot. Live billing sync is not configured.</p>';
 const active=state?state.records.filter(r=>r.kind==='job'&&['queued','running'].includes(r.status)).length:null;
 d.innerHTML=`<div class="section-head"><h2>GPU & costs</h2><button id="close-power" class="secondary">Close</button></div><div class="panel form">${liveBillingHTML}${sessionHTML}${billingHTML}<a class="small" href="https://console.runpod.io/user/billing" target="_blank" rel="noopener">Open current RunPod billing ↗</a><h3>ecco-demo-a100 · A100 80 GB</h3><p>GPU rental: <strong>$1.79/hour · $42.96 per 24 hours</strong> while running, even when no images are being generated. Storage is additional.</p><p>${active===null?'Job status unavailable. Check RunPod before stopping.':active?'There are '+active+' queued or running jobs in the last studio update. Wait for them before stopping.':'No queued or running studio jobs in the last update. Check for any work started outside this app before stopping.'}</p><a class="small" href="https://console.runpod.io/pods?id=1muqctw9bxvguu&inspectorTab=connect" target="_blank" rel="noopener">Start / Stop GPU in RunPod ↗</a><p>Opens the pod control panel. Use <strong>Stop</strong> when finished; use <strong>Start</strong> or <strong>Resume</strong> there when available. This button does not change the pod automatically. GPU availability on restart is not guaranteed.</p><p><strong>Keep ecco-models-workspace.</strong> Its 100 GB network volume holds models and media; the configured storage charge is about $7/month and continues while compute is off. Do not delete the volume to stop GPU charges.</p><p>Stopping ComfyUI or closing this app does not stop GPU billing. Stopping the pod disconnects the app. After restart, services may need restoring before you reconnect.</p><p>Direct in-app power control is pending a private RunPod API connection. This panel remains accessible when the GPU is offline.</p></div>`;
 $('#close-power').onclick=()=>d.close();if($('#billing-key-form'))$('#billing-key-form').onsubmit=e=>{e.preventDefault();const input=e.target.elements.api_key,key=input.value;input.value='';action(async()=>{await api('billing/connect',{api_key:key});await refresh();d.close();powerControls();notice('Billing connected. Automatic refresh every 30 minutes while the Pod runs.');});};if($('#refresh-billing'))$('#refresh-billing').onclick=()=>action(async()=>{$('#refresh-billing').disabled=true;await api('billing/refresh',{});await refresh();d.close();powerControls();});d.showModal();
}
const powerButton=document.createElement('button');powerButton.textContent='GPU & costs';powerButton.className='secondary';powerButton.onclick=powerControls;document.querySelector('.header-right').prepend(powerButton);

const activityPanel=$('#activity-panel'),activityToggle=$('#toggle-activity');activityToggle.onclick=()=>{activityPanel.hidden=!activityPanel.hidden;activityToggle.setAttribute('aria-expanded',String(!activityPanel.hidden));};$('#close-activity').onclick=()=>{activityPanel.hidden=true;activityToggle.setAttribute('aria-expanded','false');activityToggle.focus();};document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!activityPanel.hidden)$('#close-activity').click();});

function saveCharacterDialog(aid){let d=$('#character-dialog');if(!d){d=document.createElement('dialog');d.id='character-dialog';document.body.appendChild(d);}d.innerHTML='<form class="form" id="character-form"><h2>Save a reusable character</h2><label>Name<input name="name" required maxlength="100" placeholder="Old fisherman or aggressive dog"></label><label>Identity details<textarea name="description" required maxlength="2000" placeholder="Age, face, clothing, colors and features to preserve"></textarea></label><p class="help">Saves an image reference, not a trained LoRA. Earlier image versions remain in your story.</p><div class="row"><button>Save character</button><button type="button" id="cancel-character" class="secondary">Cancel</button></div></form>';$('#cancel-character').onclick=()=>d.close();$('#character-form').onsubmit=e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));action(async()=>{await api('characters',{...b,asset_id:aid});await refresh();d.close();navigate('characters');notice('Character saved to your reusable reference library.');});};d.showModal();}
function charactersPage(){const editReady=!!state.config.models_ready?.['qwen-image-edit-2511'];const list=state.records.filter(x=>x.kind==='character');$('#page').innerHTML=`<p class="intro">Reusable characters across your stories. Save a satisfactory image with <strong>Save character</strong>. Reference images and trained adapters are shown separately.</p>${!editReady?'<p class="notice">Instruction editing, character sheets and multi-character composition await the Qwen Edit model installation. Current storage must be expanded first.</p>':''}<form id="compose-characters" class="panel form"><h2>Compose a scene from your library</h2><p class="help">Choose up to three references. Generate a scene image, review it, then use Animate this image to create its video shot.</p>${list.map(c=>`<label><input type="checkbox" name="character_ids" value="${c.id}">${esc(c.name)}</label>`).join('')}<label>Scene prompt<textarea name="prompt" required placeholder="The old man is walking his dog on a gloomy beach. Keep both characters consistent with their references."></textarea></label><button ${!editReady||!list.length?'disabled':''}>Generate scene image</button></form><div class="cards">${list.map(c=>{const a=state.records.find(x=>x.id===c.image_ids[0]);return `<article class="card">${a?`<img src="${media(a)}" alt="${esc(c.name)}">`:''}<div class="card-body"><h2>${esc(c.name)}</h2><p>${esc(c.description)}</p><span class="badge">Reference image · no trained LoRA</span><div class="actions"><button data-character-refine="${c.id}" class="secondary">Refine reference</button><button data-character-sheet="${c.id}" class="secondary" ${!editReady?'disabled':''}>Generate six-view sheet</button><button data-training-request="${c.id}" class="secondary">Prepare LoRA request</button></div><p class="help">Character sheets and multi-reference composition require the instruction-edit model. Training requires a reviewed dataset and a configured trainer; saving a request does not start training or create a .safetensors file.</p>${(c.sheet_ids||[]).length?`<p>Generated views: ${(c.sheet_ids||[]).length} · review below</p>`:''}</div></article>`;}).join('')||empty('Build your cast','Open an image and choose Save character.')}</div>`;$('#compose-characters').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),button=e.target.querySelector('button');setGenerationBusy(button,true,'Submitting…','Generate scene image');action(async()=>{const job=await api('image-edits',{character_ids:f.getAll('character_ids'),prompt:f.get('prompt'),story_id:activeStory});localStorage.setItem('ecco-image-job:'+activeStory,job.id);navigate('images');notice('Scene composition queued. Review the result before animating.');}).finally(()=>setGenerationBusy(button,false,'','Generate scene image'));};document.querySelectorAll('[data-character-sheet]').forEach(b=>b.onclick=()=>action(async()=>{setGenerationBusy(b,true,'Submitting…','Generate six-view sheet');const job=await api('character-sheets',{character_id:b.dataset.characterSheet,story_id:activeStory});localStorage.setItem('ecco-image-job:'+activeStory,job.id);navigate('images');notice('Six-view character sheet queued. Each view appears as it finishes.');}));document.querySelectorAll('[data-character-refine]').forEach(b=>b.onclick=()=>{const c=list.find(x=>x.id===b.dataset.characterRefine);const a=state.records.find(x=>x.id===c.image_ids[0]);activeStory=a.story_id||LEGACY_STORY;localStorage.setItem('ecco-active-story',activeStory);refinementSource=a;navigate('images');});document.querySelectorAll('[data-training-request]').forEach(b=>b.onclick=()=>action(async()=>{const r=await api('training-requests',{character_id:b.dataset.trainingRequest});notice('LoRA request saved. Status: dataset and trainer needed. No training has started.');}));}

function editImageDialog(aid){let d=$('#edit-image-dialog');if(!d){d=document.createElement('dialog');d.id='edit-image-dialog';document.body.appendChild(d);}const ready=!!state.config.models_ready?.['qwen-image-edit-2511'];const a=state.records.find(x=>x.id===aid);d.innerHTML=`<form id="edit-image-form" class="form"><h2>Edit expression or appearance</h2><img class="refine-preview" src="${media(a)}" alt="Image to edit"><label>Describe the change<textarea name="prompt" required placeholder="Give him a warm smile. Keep his identity, clothing and the background unchanged."></textarea></label><p class="help">Use plain instructions for expression, skin tone, clothes, lighting or background. Results still need review; exact preservation is not guaranteed.</p>${!ready?'<p>Qwen Image Edit is not installed yet. This feature needs more persistent model storage.</p>':''}<div class="row"><button ${ready?'':'disabled'}>Apply edit</button><button type="button" id="cancel-image-edit" class="secondary">Cancel</button></div></form>`;$('#cancel-image-edit').onclick=()=>d.close();$('#edit-image-form').onsubmit=e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target)),button=e.target.querySelector('button');setGenerationBusy(button,true,'Submitting…','Apply edit');action(async()=>{const job=await api('image-edits',{...b,asset_id:aid,story_id:a.story_id||LEGACY_STORY});localStorage.setItem('ecco-image-job:'+(a.story_id||LEGACY_STORY),job.id);d.close();activeStory=a.story_id||LEGACY_STORY;navigate('images');notice('Instruction edit queued. The original stays in your library.');}).finally(()=>setGenerationBusy(button,false,'','Apply edit'));};d.showModal();}






