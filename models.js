'use strict';
const MODEL_CATEGORIES={images:{title:'Image generation',models:['sdxl','qwen-image-2512','flux-klein-4b','z-image']},assets3d:{title:'3D asset generation',models:['trellis-2']},video:{title:'Video generation',models:['preview','wan-5b','wan-a14b','longcat-avatar-1.5']},story:{title:'Story & screenplay',models:['manual','qwen-story']},voice:{title:'Voice & narration',models:['silent','cosyvoice']}};
const MODEL_CATALOG={
 'z-image':{name:'Z-Image 6B',pending:true,pendingLabel:'integration pending',statusText:'Downloaded to persistent GPU workspace (20.55 GB). Image generation integration is not ready.',defaults:{resolution:'1024x1024',steps:50,cfg:4,seed:42},sizes:['1024x1024','1280x720','720x1280']},
 'trellis-2':{name:'TRELLIS.2 4B',pending:true,pendingLabel:'integration pending',statusText:'Downloaded to persistent GPU workspace (16.24 GB). Converts a reference image into a textured 3D asset; a dedicated 3D generation workflow is not yet integrated.',defaults:{}},
 'sdxl':{name:'SDXL Base 1.0',defaults:{resolution:'1024x576',steps:25,cfg:7,seed:20261011,sampler:'dpmpp_2m',scheduler:'karras'},sizes:['1024x576','1024x1024','768x1024']},
 'qwen-image-2512':{name:'Qwen-Image-2512',defaults:{resolution:'1664x928',steps:50,cfg:4,seed:42},sizes:['1664x928','1328x1328','928x1664']},
 'flux-klein-4b':{name:'FLUX.2 klein 4B Base',defaults:{resolution:'1024x1024',steps:50,cfg:4,seed:42},sizes:['1024x1024']},
 'preview':{name:'Storyboard preview (no AI motion)',defaults:{}},
 'wan-5b':{name:'Wan 2.2 TI2V 5B',defaults:{resolution:'704x384',steps:20,cfg:5,seed:42},sizes:['704x384','1280x704']},
 'wan-a14b':{name:'Wan 2.2 I2V A14B',defaults:{resolution:'1280x720',steps:20,cfg:3.5,seed:42},sizes:['1280x720']},
 'longcat-avatar-1.5':{name:'LongCat-Video-Avatar 1.5',defaults:{resolution:'832x480',seed:42},sizes:['832x480','1280x720'],sizeLabels:{'832x480':'480p · reference aspect ratio','1280x720':'720p · reference aspect ratio'}},
 'manual':{name:'Manual story editor (no model)',defaults:{}},
 'qwen-story':{name:'Qwen language model — planned',pending:true,defaults:{temperature:0.7,max_tokens:2048}},
 'silent':{name:'Silent video / script only',defaults:{}},
 'cosyvoice':{name:'CosyVoice — planned',pending:true,defaults:{speed:1,language:'English'}}
};
let modelProfiles={selected:{images:'sdxl',assets3d:'trellis-2',video:'preview',story:'manual',voice:'silent'},settings:{}};
let activeModelCategory=null;
try{const saved=JSON.parse(localStorage.getItem('ecco-model-profiles-v1'));if(saved){for(const c of Object.keys(MODEL_CATEGORIES)){if(MODEL_CATEGORIES[c].models.includes(saved.selected?.[c]))modelProfiles.selected[c]=saved.selected[c];}modelProfiles.settings=saved.settings||{};}}catch{}
// Carry the user's model choices from the GitHub entry page into the same-tab workspace.
try {
 if(location.hash.startsWith('#preferences=')&&location.hash.length<16000){
  const handoff=JSON.parse(decodeURIComponent(location.hash.slice(13)));
  for(const c of Object.keys(MODEL_CATEGORIES)){const id=handoff.profiles?.selected?.[c];if(MODEL_CATEGORIES[c].models.includes(id))modelProfiles.selected[c]=id;}
  for(const [id,m] of Object.entries(MODEL_CATALOG)){const src=handoff.profiles?.settings?.[id];if(src&&typeof src==='object'){const clean={};for(const k of Object.keys(m.defaults)){if(typeof src[k]===typeof m.defaults[k])clean[k]=src[k];}modelProfiles.settings[id]={...modelProfiles.settings[id],...clean};}}
  localStorage.setItem('ecco-model-profiles-v1',JSON.stringify(modelProfiles));
  if(/^[a-f0-9]{32}$/.test(handoff.story||''))localStorage.setItem('ecco-active-story',handoff.story);
  history.replaceState(null,'',location.pathname+location.search);
 }
}catch{}
function modelSettings(id){return {...MODEL_CATALOG[id].defaults,...modelProfiles.settings[id]};}
function modelAvailable(id){if(MODEL_CATALOG[id].pending)return false;if(['manual','silent'].includes(id))return true;if(!state)return false;const ready=state.config.models_ready;if(ready)return !!ready[id];return id==='sdxl'||(id==='wan-5b'&&state.config.wan_ready)||(id==='preview'&&state.config.ffmpeg);}
function modelStatus(id){if(MODEL_CATALOG[id].pending)return MODEL_CATALOG[id].statusText||'Not installed / integrated — settings are planning presets only.';if(['manual','silent'].includes(id))return 'Available without a model.';if(!state||state.storage_pending)return 'GPU offline — availability will be checked when connected.';return modelAvailable(id)?'Available on connected backend.':'Unavailable on connected backend.';}
function saveModelProfiles(){localStorage.setItem('ecco-model-profiles-v1',JSON.stringify(modelProfiles));renderModelNav();}
function modelFields(id){const m=MODEL_CATALOG[id],s=modelSettings(id);return Object.keys(m.defaults).map(k=>{const label={resolution:'Resolution',steps:'Sampling steps',cfg:'Guidance',seed:'Seed',sampler:'Sampler',scheduler:'Scheduler',temperature:'Temperature',max_tokens:'Maximum output tokens',speed:'Voice speed',language:'Language'}[k];const opts=k==='resolution'?m.sizes:k==='sampler'?['dpmpp_2m','euler']:k==='scheduler'?['karras','normal']:k==='language'?['English','Hindi']:null;const ranges={steps:[5,60,1],cfg:[1,15,0.5],seed:[0,9007199254740930,1],temperature:[0,2,0.1],max_tokens:[128,8192,128],speed:[0.5,2,0.1]};const r=ranges[k];return `<label>${label}${opts?`<select data-setting="${k}">${opts.map(v=>`<option value="${esc(v)}" ${s[k]===v?'selected':''}>${esc(m.sizeLabels?.[v]||v)}</option>`).join('')}</select>`:`<input data-setting="${k}" type="number" min="${r[0]}" max="${r[1]}" step="${r[2]}" required value="${esc(s[k])}">`}</label>`;}).join('')||'<p class="help wide">No generation settings for this option.</p>';}
function modelsPage(){
 $('#page').innerHTML=`<p class="intro">Choose one model per production category. Settings are saved in this browser and used for new jobs. Selecting a model does not install it or start the GPU.</p><form id="models-form" class="stack"><div class="models-grid">${Object.entries(MODEL_CATEGORIES).map(([c,cat])=>{const id=modelProfiles.selected[c];return `<section class="panel form model-panel${activeModelCategory===c?' is-active':''}" data-model-category="${c}"><h2>${cat.title}</h2><label>${cat.title} model<select data-category="${c}">${cat.models.map(mid=>`<option value="${mid}" ${mid===id?'selected':''}>${esc(MODEL_CATALOG[mid].name)}${MODEL_CATALOG[mid].pending?' · '+(MODEL_CATALOG[mid].pendingLabel||'not installed'):''}</option>`).join('')}</select></label><p class="help model-status ${MODEL_CATALOG[id].pending?'pending':''}">${modelStatus(id)}</p><div class="model-fields" data-model="${id}">${modelFields(id)}</div>${c==='video'?'<p class="help">A14B: native 720p, 16 fps, 1–6 seconds per shot; 5B: 24 fps, 1–5 seconds. Preview: 720p, 1–30 seconds per scene. LongCat: one reference image and 0.2–10 seconds of dialogue, with synchronized audio; B200 required.</p>':''}<button type="button" class="secondary" data-reset="${id}">Reset this model’s settings</button></section>`;}).join('')}</div><div class="row"><button>Save model settings</button><p class="help" id="model-save-status" role="status">Presets for uninstalled models can be saved, but cannot run. No silent fallback to a different model.</p></div></form>`;
 const form=$('#models-form');
 function selectPanel(event){
  const panel=event.target.closest('.model-panel');if(!panel)return;
  activeModelCategory=panel.dataset.modelCategory;
  form.querySelectorAll('.model-panel').forEach(item=>item.classList.toggle('is-active',item===panel));
 }
 form.addEventListener('click',selectPanel);
 form.addEventListener('focusin',selectPanel);
 function capture(){form.querySelectorAll('[data-model]').forEach(el=>{const settings={};el.querySelectorAll('[data-setting]').forEach(x=>settings[x.dataset.setting]=x.type==='number'?Number(x.value):x.value);modelProfiles.settings[el.dataset.model]=settings;});}
 form.querySelectorAll('[data-category]').forEach(el=>el.onchange=()=>{capture();modelProfiles.selected[el.dataset.category]=el.value;saveModelProfiles();modelsPage();});
 form.querySelectorAll('[data-reset]').forEach(el=>el.onclick=()=>{capture();delete modelProfiles.settings[el.dataset.reset];saveModelProfiles();modelsPage();});
 form.onsubmit=e=>{e.preventDefault();capture();saveModelProfiles();$('#model-save-status').textContent='✓ Saved in this browser. New jobs will use these settings.';};
}
function modelPayload(category){const id=modelProfiles.selected[category],s=modelSettings(id);if(!modelAvailable(id))throw Error(MODEL_CATALOG[id].name+': '+modelStatus(id));if(!state.config.model_settings_version){if(category==='images'&&(s.resolution!=='1024x576'||s.sampler!=='dpmpp_2m'||s.scheduler!=='karras'))throw Error('These settings need the prepared backend update. Reconnect after the GPU backend is updated.');if(category==='video'&&id!=='preview'&&(s.resolution!=='704x384'||s.steps!==20||s.cfg!==5||s.seed!==42))throw Error('Custom video settings need the prepared backend update.');}return {model:id,...s,...(category==='video'?{mode:id==='preview'?'preview':'wan'}:{})};}
function attachModelControls(category,form){const cat=MODEL_CATEGORIES[category];const node=document.createElement('div');node.className='form model-summary';node.innerHTML=`<label>${cat.title} model<select id="job-model">${cat.models.map(id=>`<option value="${id}" ${modelProfiles.selected[category]===id?'selected':''}>${esc(MODEL_CATALOG[id].name)}${MODEL_CATALOG[id].pending?' · '+(MODEL_CATALOG[id].pendingLabel||'not installed'):''}</option>`).join('')}</select></label><p class="help" id="job-model-status"></p><button type="button" class="small secondary" id="edit-model-settings">Configure models</button>`;form.prepend(node);
 function apply(){const id=modelProfiles.selected[category],s=modelSettings(id);$('#job-model-status').textContent=modelStatus(id)+(s.resolution?' '+s.resolution.replace('x',' × ')+', '+s.steps+' steps.':'');if(category==='images'){for(const k of ['steps','cfg','seed']){const el=form.elements[k];if(el)el.value=s[k];}}}
 $('#job-model').onchange=e=>{modelProfiles.selected[category]=e.target.value;saveModelProfiles();apply();};$('#edit-model-settings').onclick=()=>navigate('models');apply();
}

function renderModelNav(){
 const root=document.getElementById('model-nav');if(!root)return;
 const signature=JSON.stringify([modelProfiles.selected,state?.config?.models_ready]);
 if(root.dataset.signature===signature)return;root.dataset.signature=signature;
 root.innerHTML='<h2>Generation models</h2>'+['images','video'].map(c=>`<label for="nav-model-${c}">${c==='images'?'Image model':'Video model'}<select id="nav-model-${c}" data-nav-category="${c}">${MODEL_CATEGORIES[c].models.map(id=>`<option value="${id}" ${modelProfiles.selected[c]===id?'selected':''} ${MODEL_CATALOG[id].pending?'disabled':''}>${esc(MODEL_CATALOG[id].name)}${MODEL_CATALOG[id].pending?' · '+(MODEL_CATALOG[id].pendingLabel||'not installed'):''}</option>`).join('')}</select><small>${esc(modelStatus(modelProfiles.selected[c]))}</small></label>`).join('')+'<button type="button" class="secondary" id="nav-model-settings">Model settings</button>';
 root.querySelectorAll('[data-nav-category]').forEach(el=>el.onchange=()=>{
  const c=el.dataset.navCategory,id=el.value;
  const settingsSelect=document.querySelector(`#models-form [data-category="${c}"]`);
  if(settingsSelect){settingsSelect.value=id;settingsSelect.dispatchEvent(new Event('change'));}
  else {modelProfiles.selected[c]=id;saveModelProfiles();const job=document.getElementById('job-model');if(job&&((c==='images'&&page==='images')||(c==='video'&&page==='render'))){job.value=id;job.dispatchEvent(new Event('change'));}}
  notice(MODEL_CATALOG[id].name+' selected for new '+(c==='images'?'images.':'videos.'));
 });
 document.getElementById('nav-model-settings').onclick=()=>navigate('models');
}
document.addEventListener('DOMContentLoaded',renderModelNav);
