'use strict';
/* Voice Studio (owner-approved mock "Ecco Voice Studio Mocks", 2026-11-15).
   Opens from the sidebar: Studios › Voice Studio. Copies the Create Images screen one-for-one (same panes,
   classes and sizes) with Voice wording:
   1. Voice: Upload a Voice / Generate with AI / Record with Mic → Selected Voices (up to 3) → Improve with AI
      drafts. 2. Enhance Voice: hear each voice say any line. 3. Publish Voice: save to Audio Library under a label.
   Uploaded and recorded clips become saved voices with /api/audio/voices/create; Generate with AI and Improve
   with AI design a voice with /api/audio/voices/design (Qwen3-TTS, VoxCPM2 or Indic Parler-TTS). */
(()=>{
 const LIMIT=3,DRAFTS=3,PAGE='voice-studio';
 const q=(s,r=document)=>r.querySelector(s),all=(s,r=document)=>[...r.querySelectorAll(s)];
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const KEY='ecco-voice-workspace';
 let ws=null,modelOpen=false,status=null,recorder=null,recordStart=0,recordTimer=0;const busy={};
 const TYPES=['Cartoon','Animals & Birds','Characters','Real person'];
 const TYPE_HINT={'Cartoon':'An animated cartoon character voice, expressive and playful. ','Animals & Birds':'A talking animal or bird character voice. ','Characters':'A professional character voice. ','Real person':''};
 // Each language's sample sentence is what a new voice says (designed voices need a few seconds of speech).
 const SAMPLES={English:'Welcome to our story. Close your eyes, listen carefully, and imagine the adventure that is about to begin.',Hindi:'हमारी कहानी में आपका स्वागत है। आराम से बैठिए और सुनिए। आज हम एक ऐसी दुनिया में चलेंगे जहाँ हर मोड़ पर एक नया किस्सा हमारा इंतज़ार कर रहा है।',Telugu:'మా కథకు స్వాగతం. హాయిగా కూర్చుని వినండి. ఈ రోజు మనం ఒక కొత్త ప్రయాణం మొదలుపెడదాం.',Tamil:'எங்கள் கதைக்கு உங்களை வரவேற்கிறோம். அமைதியாக உட்கார்ந்து கேளுங்கள். இன்று ஒரு புதிய பயணத்தைத் தொடங்கப் போகிறோம்.',Urdu:'ہماری کہانی میں آپ کا استقبال ہے۔ آرام سے بیٹھیں اور سنیں۔ آج ہم ایک نئے سفر پر چلنے والے ہیں۔',Punjabi:'ਸਾਡੀ ਕਹਾਣੀ ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ। ਆਰਾਮ ਨਾਲ ਬੈਠੋ ਅਤੇ ਸੁਣੋ। ਅੱਜ ਅਸੀਂ ਇੱਕ ਨਵੀਂ ਦੁਨੀਆ ਦੀ ਸੈਰ ਕਰਨ ਜਾ ਰਹੇ ਹਾਂ।'};
 const LANGS=Object.keys(SAMPLES),INDIC=['Hindi','Telugu','Tamil','Urdu','Punjabi'];
 const MODEL_NAMES={'qwen3-tts':'Qwen3-TTS Voice Design','voxcpm2':'VoxCPM2 Voice Design','indic-parler':'Indic Parler-TTS'};
 const CLONE_FOR={'qwen3-tts':'qwen3-tts','voxcpm2':'voxcpm2','indic-parler':'indicf5'};

 /* ---------- state ---------- */
 const fresh=()=>({step:'voice',src:'upload',selected:[],active:0,test:0,generated:[],ai:{},aiPrompt:'',genPrompt:'',genType:'Cartoon',genLang:'English',model:'',testLine:'Hello! This is my new voice. How does it sound?',tests:{},label:'',newLabel:'',published:false});
 function load(){
  if(ws)return ws;let saved=null;try{saved=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
  ws={...fresh(),...(saved&&typeof saved==='object'?saved:{})};return ws;
 }
 function save(){try{localStorage.setItem(KEY,JSON.stringify(ws));}catch{}}
 const record=id=>state?.records?.find(r=>r.id===id&&r.kind==='asset'&&r.media==='audio'&&!r.deleted);
 const title=id=>{const r=record(id);return r?.voice_reference?.character||r?.title||'Voice';};
 const secs=id=>{const s=Number(record(id)?.seconds||record(id)?.duration||0);return s?s.toFixed(s<10?1:0)+' s':'';};
 function tidy(){
  ws.selected=ws.selected.filter(record).slice(0,LIMIT);ws.generated=ws.generated.filter(record);
  ws.active=Math.max(0,Math.min(ws.active,ws.selected.length-1));ws.test=Math.max(0,Math.min(ws.test,ws.selected.length-1));
 }
 const ai=id=>ws.ai[id]||(ws.ai[id]={drafts:[],index:0});
 const describable=id=>!!record(id)?.voice_reference?.description;

 /* ---------- model and compute ---------- */
 const designModels=lang=>(INDIC.includes(lang)?['indic-parler','voxcpm2']:['qwen3-tts','voxcpm2']).filter(id=>MODEL_NAMES[id]);
 function computeChoice(needed=[]){
  const C=window.EccoAudioCompute;if(!C||!status)return null;
  const choices=C.choices(status),saved=localStorage.getItem('ecco-compute-voice');
  return choices.find(c=>c.value===saved&&c.ready)||C.preferred(status,needed)||null;
 }
 const ready=(choice,model)=>!!choice&&!!window.EccoAudioCompute?.target(status,choice.compute,choice.worker_id)?.models?.includes(model);
 function designModel(lang=ws.genLang){
  const list=designModels(lang);if(ws.model&&list.includes(ws.model))return ws.model;
  const choice=computeChoice();return list.find(id=>ready(choice,id))||list[0];
 }
 const computeName=()=>{const c=computeChoice([designModel()]);return c?c.label.replace(/^Serverless · A100$/,'Serverless'):'Not connected';};
 async function checkStatus(){
  if(!window.EccoStorage?.ready&&typeof api!=='function')return null;
  try{status=await api('audio/status');}catch{status=null;}
  if(page===PAGE)draw();return status;
 }
 function requireCompute(model){
  if(!status)throw Error('Connect workspace storage, then wait for the audio worker check.');
  const choice=computeChoice([model]);if(!choice)throw Error('Connect Serverless or an audio worker in Compute first.');
  if(!ready(choice,model))throw Error((MODEL_NAMES[model]||model)+' is not installed on '+choice.label+'. Choose another compute in Model settings.');
  return {compute:choice.compute,...(choice.worker_id?{worker_id:choice.worker_id}:{})};
 }
 async function waitJob(job,label){
  const started=Date.now();
  for(;;){
   const result=await api('audio/jobs/'+encodeURIComponent(job.id));
   if(['error','cancelled'].includes(result.status))throw Error(result.error||(result.status==='cancelled'?label+' stopped.':label+' failed.'));
   if(result.status==='done')return result;
   if(Date.now()-started>600000)throw Error(label+' is still running. Check Activity before trying again.');
   await new Promise(resolve=>setTimeout(resolve,1500));
  }
 }
 const nameFrom=text=>{const words=String(text||'').replace(/[^\p{L}\p{N}\s'-]/gu,' ').trim().split(/\s+/).filter(Boolean).slice(0,5).join(' ');return (words||'New voice').slice(0,60);};
 async function design(description,name,lang){
  const model=designModel(lang),where=requireCompute(model);
  const job=await api('audio/voices/design',{model,...where,character:name.slice(0,80),emotion:'default',language:lang,description:description.slice(0,1200),text:SAMPLES[lang]||SAMPLES.English});
  window.EccoGeneration?.trackJob?.('audio','',job);
  const result=await waitJob(job,'Voice design');
  if(!result.voice_reference_id)throw Error('The voice was made but could not be saved. Try again with a longer description.');
  await refresh();return result.voice_reference_id;
 }
 async function saveClip(asset,name,source){
  const ref=await api('audio/voices/create',{asset_id:asset.id,character:name.slice(0,80),emotion:'default',source,consent:true,clean:true});
  await refresh();return ref.id;
 }

 /* ---------- small pieces ---------- */
 const spinner='<span class="generation-spinner" aria-hidden="true"></span>';
 const tab=(id,label,selected,act,extra='')=>'<button type="button" role="tab" id="'+id+'" aria-selected="'+selected+'" tabindex="'+(selected?0:-1)+'" data-act="'+act+'" '+extra+'>'+label+'</button>';
 const drafts=(list,index,act)=>'<div class="pdf-ai-drafts iw-drafts" role="tablist" aria-label="Drafts">'+[0,1,2].map(i=>'<button type="button" role="tab" class="pdf-ai-draft-tab" aria-selected="'+(i===index)+'" tabindex="'+(i===index?0:-1)+'" data-filled="'+(!!list[i])+'" data-act="'+act+'" data-index="'+i+'">Draft '+(i+1)+'</button>').join('')+'</div>';
 const player=(id,label)=>{const r=record(id);return '<audio data-asset="'+esc(id)+'" src="'+esc(r&&typeof media==='function'?media(r):'')+'" controls preload="metadata" aria-label="'+esc(label)+'"></audio>';};
 const slot=(id,i,act,on)=>'<button type="button" class="vw-slot" data-act="'+act+'" data-index="'+i+'" data-id="'+esc(id)+'" aria-pressed="'+on+'" aria-label="'+esc((act==='show'?'Show voice '+(i+1)+': ':'')+title(id))+'"><span class="iw-badge">'+(i+1)+'</span><span class="vw-name">'+esc(title(id))+'</span><span class="help">'+esc(secs(id))+'</span></button>';
 const uploadIcon='<span class="story-upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg></span>';
 const micIcon='<span class="story-upload-icon vw-mic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v5"/></svg></span>';
 const stopIcon='<span class="story-upload-icon vw-mic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></span>';

 /* ---------- step 1: Voice ---------- */
 function sourcePane(){
  if(ws.src==='upload')return '<section class="pdf-review-box" aria-labelledby="vw-upload-heading"><strong class="pdf-review-heading" id="vw-upload-heading">Upload a Voice</strong><input type="file" accept="audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/ogg,audio/flac,.wav,.mp3,.m4a,.ogg,.flac" data-upload-file hidden><div class="story-upload-slot"><button type="button" class="story-upload-target" data-act="upload"'+(busy.upload?' disabled aria-busy="true"':'')+'>'+(busy.upload?spinner:uploadIcon)+(busy.upload?'Uploading…':'Upload Audio')+'</button></div><p class="help">WAV, MP3 or M4A, 10 seconds or more. Uploads are added to Selected Voices and kept in Audio Library. Only upload voices you have permission to use.</p></section>';
  if(ws.src==='record'){
   const on=!!recorder,secsNow=on?Math.floor((Date.now()-recordStart)/1000):0;
   return '<section class="pdf-review-box" aria-labelledby="vw-record-heading"><strong class="pdf-review-heading" id="vw-record-heading">Record with Mic</strong><div class="story-upload-slot"><button type="button" class="story-upload-target" data-act="record"'+(busy.record?' disabled aria-busy="true"':'')+' aria-pressed="'+on+'">'+(busy.record?spinner:on?stopIcon:micIcon)+(busy.record?'Saving…':on?'Stop Recording · 0:'+String(secsNow).padStart(2,'0'):'Start Recording')+'</button></div><p class="help">Read any lines in the voice you want, for 10 seconds or more. Recordings are added to Selected Voices and kept in Audio Library.</p></section>';
  }
  return '<section class="pdf-review-box" aria-labelledby="vw-gen-heading"><strong class="pdf-review-heading" id="vw-gen-heading">What should the voice sound like?</strong><textarea data-input="genPrompt" rows="6" maxlength="1000" aria-labelledby="vw-gen-heading" placeholder="For example: a grumpy cartoon duck who quacks when he gets angry">'+esc(ws.genPrompt)+'</textarea><div class="iw-pair"><label>Voice type<select data-input="genType">'+TYPES.map(t=>'<option'+(t===ws.genType?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select></label><label>Language<select data-input="genLang">'+LANGS.map(l=>'<option'+(l===ws.genLang?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select></label></div><button type="button" data-act="generate"'+(busy.generate?' disabled aria-busy="true"':ws.genPrompt.trim()?'':' disabled')+'>'+(busy.generate?spinner+' Generating…':'Generate voice')+'</button>'+(ws.generated.length?'<p class="help">Click a voice to select it.</p><div class="vw-list">'+ws.generated.map((id,i)=>slot(id,i,'pick',ws.selected.includes(id))).join('')+'</div>':'')+'</section>';
 }
 function selectedPane(){
  const id=ws.selected[ws.active];
  return '<section class="pdf-review-box pdf-selected-label" aria-labelledby="vw-selected-heading"><div class="iw-head"><strong class="pdf-review-heading" id="vw-selected-heading">Selected Voices</strong><span class="help">'+ws.selected.length+' of 3</span></div><p class="help">Only these voices go to Enhance Voice.</p>'+
   (id?'<div class="vw-preview"><strong class="vw-name">Voice '+(ws.active+1)+' · '+esc(title(id))+'</strong>'+player(id,'Voice '+(ws.active+1)+': '+title(id))+'</div>':'<p class="iw-blank help">Choose voices from a tab on the left.</p>')+
   '<div class="iw-grid">'+[0,1,2].map(i=>{const s=ws.selected[i];return s?'<div class="iw-slot">'+slot(s,i,'show',i===ws.active)+'<button type="button" class="iw-remove" data-act="remove" data-index="'+i+'" aria-label="Remove voice '+(i+1)+'" title="Remove">×</button></div>':'<div class="iw-empty-slot help">Empty</div>';}).join('')+'</div></section>';
 }
 function improvePane(){
  const id=ws.selected[ws.active],a=id?ai(id):{drafts:[],index:0},shown=a.drafts[a.index],fixed=id&&!describable(id);
  return '<section class="pdf-review-box" aria-labelledby="vw-ai-heading"><div class="iw-head"><strong class="pdf-review-heading" id="vw-ai-heading">Improve with AI</strong><button type="button" class="pdf-ai-icon" data-act="improve" aria-label="Improve with AI" title="Improve with AI"'+(!id||fixed||busy.improve||!ws.aiPrompt.trim()?' disabled':'')+'>'+(busy.improve?spinner:'<span aria-hidden="true">✦</span>')+'</button></div><textarea data-input="aiPrompt" rows="6" maxlength="600" aria-label="AI instructions" placeholder="'+(fixed?'Improve with AI changes voices made with Generate with AI. To change an uploaded or recorded voice, upload or record it again.':'Describe how to change the selected voice…')+'"'+(fixed?' disabled':'')+'>'+esc(ws.aiPrompt)+'</textarea>'+drafts(a.drafts,a.index,'ai-draft')+
   (shown&&record(shown)?'<div class="vw-preview vw-preview-small"><strong class="vw-name">Draft '+(a.index+1)+'</strong>'+player(shown,'Draft '+(a.index+1))+'</div>':'<p class="iw-blank help">Your AI output will appear here. ✦ fills the next draft, up to 3.</p>')+
   '<div class="iw-row"><button type="button" data-act="use-ai"'+(shown?'':' disabled')+'>Use AI Voice</button><button type="button" class="secondary" data-act="clear-ai"'+(shown?'':' disabled')+'>Clear AI Output</button></div></section>';
 }
 function voiceStep(){
  const tabs=[['upload','Upload a Voice'],['generate','Generate with AI'],['record','Record with Mic']];
  return '<div class="story-source-tabs" role="tablist" aria-label="Voice source">'+tabs.map(([id,label])=>tab('vw-src-'+id,label,ws.src===id,'src','data-src="'+id+'" aria-controls="vw-src-panel"')).join('')+'</div>'+
   '<div class="story-source-panel" role="tabpanel" id="vw-src-panel" aria-labelledby="vw-src-'+ws.src+'"><div class="pdf-selection-layout iw-layout">'+sourcePane()+selectedPane()+improvePane()+'</div></div>';
 }

 /* ---------- step 2: Enhance Voice (hear it say any line) ---------- */
 function enhanceStep(){
  if(!ws.selected.length)return '<p class="iw-blank help">Choose voices in step 1 first.</p>';
  const id=ws.selected[ws.test],heard=ws.tests[id];
  return '<div class="story-source-tabs" role="tablist" aria-label="Voices to enhance">'+ws.selected.map((s,i)=>tab('vw-enh-'+i,'Voice '+(i+1)+' · '+esc(title(s)),i===ws.test,'test-tab','data-index="'+i+'" aria-controls="vw-enh-panel"')).join('')+'</div>'+
   '<div class="story-source-panel" role="tabpanel" id="vw-enh-panel" aria-labelledby="vw-enh-'+ws.test+'"><div class="pdf-selection-layout iw-layout">'+
   '<section class="pdf-review-box" aria-labelledby="vw-orig-heading"><strong class="pdf-review-heading" id="vw-orig-heading">Voice</strong><div class="vw-preview"><strong class="vw-name">'+esc(title(id))+'</strong>'+player(id,title(id))+'</div><p class="help">'+esc(record(id)?.voice_reference?.description||'Saved from '+(record(id)?.voice_reference?.source==='recording'?'your recording':'an uploaded clip')+'.')+'</p></section>'+
   '<section class="pdf-review-box pdf-selected-label" aria-labelledby="vw-test-heading"><strong class="pdf-review-heading" id="vw-test-heading">Hear it say</strong><textarea data-input="testLine" rows="4" maxlength="300" aria-labelledby="vw-test-heading">'+esc(ws.testLine)+'</textarea><button type="button" data-act="speak"'+(busy.speak||!ws.testLine.trim()?' disabled':'')+(busy.speak?' aria-busy="true"':'')+'>'+(busy.speak?spinner+' Speaking…':'Speak this line')+'</button>'+(heard&&record(heard)?'<div class="vw-preview vw-preview-small">'+player(heard,'Test line')+'</div>':'<p class="iw-blank help">The voice saying your line will appear here.</p>')+'</section>'+
   '<section class="pdf-review-box" aria-labelledby="vw-ai2-heading"><strong class="pdf-review-heading" id="vw-ai2-heading">Improve with AI</strong><p class="help">To change this voice, go back to 1. Voice and use Improve with AI.</p></section>'+
   '</div></div>';
 }

 /* ---------- step 3: Publish Voice ---------- */
 function publishStep(){
  if(ws.published)return '<section class="iw-published" role="status"><h2>'+ws.selected.length+(ws.selected.length===1?' voice':' voices')+' saved to Audio Library'+(labelName()?' › '+esc(labelName()):'')+'</h2><p class="help">Pick them in Story Characters or here next time.</p><div class="iw-row"><button type="button" class="secondary" data-act="open-library">Open Audio Library</button><button type="button" class="secondary" data-act="again">Create more voices</button></div></section>';
  if(!ws.selected.length)return '<p class="iw-blank help">Choose voices in step 1 first.</p>';
  const labels=state.records.filter(r=>r.kind==='audio_folder'&&!r.deleted);
  return '<div class="story-source-panel"><div class="iw-group"><span id="vw-label-label">Save under label</span><div class="iw-options" role="radiogroup" aria-labelledby="vw-label-label">'+labels.map(l=>'<button type="button" class="iw-chip" role="radio" data-act="label" data-id="'+esc(l.id)+'" aria-pressed="'+(ws.label===l.id)+'" aria-checked="'+(ws.label===l.id)+'">'+esc(l.name)+'</button>').join('')+'<button type="button" class="iw-chip" role="radio" data-act="label" data-id="new" aria-pressed="'+(ws.label==='new')+'" aria-checked="'+(ws.label==='new')+'">+ New label</button></div>'+(ws.label==='new'?'<label class="vw-new-label">Label name<input data-input="newLabel" maxlength="80" value="'+esc(ws.newLabel)+'" placeholder="For example: Cartoon voices"></label>':'')+'</div>'+
   '<div class="iw-publish vw-publish">'+ws.selected.map((id,i)=>'<figure><figcaption class="help">Voice '+(i+1)+' · '+esc(title(id))+'</figcaption>'+player(id,'Voice '+(i+1)+': '+title(id))+'</figure>').join('')+'</div></div>';
 }
 const labelName=()=>ws.label==='new'?ws.newLabel.trim():state.records.find(r=>r.kind==='audio_folder'&&r.id===ws.label)?.name||'';

 /* ---------- frame ---------- */
 function settingsBox(){
  if(!modelOpen)return '';
  const list=designModels(ws.genLang),model=designModel(),choices=window.EccoAudioCompute&&status?window.EccoAudioCompute.choices(status):[],choice=computeChoice([model]);
  return '<section class="iw-model-settings" id="vw-model" role="dialog" aria-labelledby="vw-model-heading"><div class="iw-head"><h2 id="vw-model-heading">Model settings</h2><button type="button" class="secondary" data-act="model" aria-label="Close model settings">×</button></div>'+
   '<label>Voice model<select data-setting="model"><option value="">Automatic (best for the language)</option>'+list.map(id=>'<option value="'+id+'"'+(id===ws.model?' selected':'')+'>'+esc(MODEL_NAMES[id])+'</option>').join('')+'</select></label><p class="help">Using '+esc(MODEL_NAMES[model])+' for '+esc(ws.genLang)+'.</p>'+
   '<label>Compute<select data-setting="compute"'+(choices.length?'':' disabled')+'>'+(choices.length?choices.map(c=>'<option value="'+esc(c.value)+'"'+(choice&&c.value===choice.value?' selected':'')+'>'+esc(c.label)+'</option>').join(''):'<option>Connect workspace storage to check availability</option>')+'</select></label>'+
   '<div class="iw-row iw-end"><button type="button" class="secondary" data-act="reset-model">Reset to defaults</button><button type="button" data-act="model">Done</button></div></section>';
 }
 function foot(){
  if(ws.step==='voice')return '<div class="iw-foot"><span class="help">'+ws.selected.length+' selected. You can change them later.</span><button type="button" data-act="step" data-step="enhance"'+(ws.selected.length?'':' disabled')+'>Next: Enhance Voice →</button></div>';
  if(ws.step==='enhance')return '<div class="iw-foot"><button type="button" class="secondary" data-act="step" data-step="voice">← Back: Voice</button><button type="button" data-act="step" data-step="publish">Next: Publish Voice →</button></div>';
  return '<div class="iw-foot"><button type="button" class="secondary" data-act="step" data-step="enhance">← Back: Enhance Voice</button>'+(ws.published?'':'<button type="button" data-act="publish"'+(ws.selected.length&&labelName()&&!busy.publish?'':' disabled')+(busy.publish?' aria-busy="true"':'')+'>'+(busy.publish?spinner+' Publishing…':'Publish')+'</button>')+'</div>';
 }
 function draw(){
  const root=q('#page');if(!root||page!==PAGE)return;load();if(state?.records)tidy();
  const scroll=window.scrollY,focus=document.activeElement?.closest?.('#voice-workspace')?(document.activeElement.dataset.input||document.activeElement.id):'';
  const steps=[['voice','1. Voice'],['enhance','2. Enhance Voice'],['publish','3. Publish Voice']];
  root.innerHTML='<div id="voice-workspace" class="form"><div class="iw-steps" role="tablist" aria-label="Voice Studio steps">'+steps.map(([id,label])=>tab('vw-step-'+id,label,ws.step===id,'step','data-step="'+id+'" aria-controls="vw-step-panel"')).join('')+'</div>'+
   '<section class="panel form story-editor-panel" id="vw-step-panel" role="tabpanel" aria-labelledby="vw-step-'+ws.step+'"><div class="iw-settings" role="group" aria-label="Model"><span class="iw-pill">Model <b>'+esc(MODEL_NAMES[designModel()])+'</b></span><span class="iw-pill">Compute <b>'+esc(computeName())+'</b></span><button type="button" class="secondary" data-act="model" aria-expanded="'+modelOpen+'"'+(modelOpen?' aria-controls="vw-model"':'')+'>Model settings</button>'+settingsBox()+'</div>'+
   (ws.step==='voice'?voiceStep():ws.step==='enhance'?enhanceStep():publishStep())+'</section>'+foot()+'</div>';
  if(focus){const el=q('#voice-workspace [data-input="'+focus+'"]')||q('#'+CSS.escape(focus));el?.focus();}
  window.scrollTo(0,scroll);
  if(typeof hydrateMedia==='function')hydrateMedia();
  sidebar();
 }
 async function run(name,task){
  if(busy[name])return;busy[name]=true;draw();
  try{await task();}catch(error){notice(error.message,true);}finally{busy[name]=false;save();if(page===PAGE)draw();}
 }

 /* ---------- actions ---------- */
 function add(id){
  if(ws.selected.includes(id))return;
  if(ws.selected.length<LIMIT){ws.selected.push(id);ws.active=ws.selected.length-1;ws.published=false;}
  else notice('Selected Voices already has 3. Remove one to add this voice.',true);
 }
 function act(button){
  const a=button.dataset.act,id=ws.selected[ws.active];
  if(a==='step'){ws.step=button.dataset.step;modelOpen=false;}
  else if(a==='src'){if(recorder&&button.dataset.src!=='record')stopRecording(false);ws.src=button.dataset.src;}
  else if(a==='model'){modelOpen=!modelOpen;if(modelOpen&&!status)checkStatus();}
  else if(a==='reset-model'){ws.model='';localStorage.removeItem('ecco-compute-voice');}
  else if(a==='pick'){const v=button.dataset.id,i=ws.selected.indexOf(v);if(i>=0){ws.selected.splice(i,1);ws.active=Math.min(ws.active,Math.max(0,ws.selected.length-1));}else add(v);}
  else if(a==='show')ws.active=+button.dataset.index;
  else if(a==='remove'){ws.selected.splice(+button.dataset.index,1);ws.active=Math.min(ws.active,Math.max(0,ws.selected.length-1));ws.test=0;ws.published=false;}
  else if(a==='upload'){q('#voice-workspace [data-upload-file]')?.click();return;}
  else if(a==='record'){if(recorder)stopRecording(true);else startRecording();return;}
  else if(a==='generate'){
   const prompt=ws.genPrompt.trim();if(!prompt)return;
   return run('generate',async()=>{const ref=await design(TYPE_HINT[ws.genType]+prompt,nameFrom(prompt),ws.genLang);ws.generated=[ref,...ws.generated];add(ref);});
  }
  else if(a==='improve'){
   const change=ws.aiPrompt.trim(),target=id;if(!target||!change)return;
   const base=record(target)?.voice_reference?.description;if(!base)return;
   const d=ai(target);if(d.drafts.length>=DRAFTS){notice('All three drafts are in use. Clear the AI output, then try again.',true);return;}
   const lang=record(target)?.voice_reference?.language||ws.genLang;
   return run('improve',async()=>{const ref=await design(base+' Change: '+change,title(target),lang);d.drafts.push(ref);d.index=d.drafts.length-1;});
  }
  else if(a==='ai-draft'){if(id)ai(id).index=+button.dataset.index;}
  else if(a==='use-ai'){const d=ai(id),draft=d.drafts[d.index];if(draft){ws.selected[ws.active]=draft;ws.ai[draft]={drafts:d.drafts.filter(x=>x!==draft),index:0};ws.published=false;}}
  else if(a==='clear-ai'){if(id)ws.ai[id]={drafts:[],index:0};}
  else if(a==='test-tab')ws.test=+button.dataset.index;
  else if(a==='speak'){const target=ws.selected[ws.test],line=ws.testLine.trim();if(!target||!line)return;return run('speak',async()=>{ws.tests[target]=await speak(target,line);});}
  else if(a==='label')ws.label=button.dataset.id;
  else if(a==='publish')return run('publish',publish);
  else if(a==='open-library'){navigate('audio-library');return;}
  else if(a==='again'){ws=fresh();}
  save();draw();
 }
 async function speak(id,line){
  const lang=record(id)?.voice_reference?.language||'English';
  const model=CLONE_FOR[designModel(lang)]||'voxcpm2',where=requireCompute(model);
  const job=await api('audio/generate',{model,...where,pause:0,title:'Voice Studio test · '+title(id),lines:[{text:line.slice(0,300),voice:'ref:'+id,language:lang}]});
  const result=await waitJob(job,'Voice test');
  const made=result.asset_id||result.asset_ids?.[0]||(Array.isArray(result.result)?result.result[0]:result.result);
  if(!made)throw Error('The test finished without an audio file.');
  await refresh();return made;
 }
 async function publish(){
  const name=labelName();if(!name)throw Error('Choose a label or name a new one.');
  let folder=ws.label==='new'?state.records.find(r=>r.kind==='audio_folder'&&!r.deleted&&r.name===name):state.records.find(r=>r.kind==='audio_folder'&&r.id===ws.label);
  if(!folder)folder=await api('audio/folders',{name});
  for(const id of ws.selected){
   const r=record(id),existing=state.records.filter(l=>l.kind==='library_item'&&!l.deleted&&l.asset_id===id).map(l=>l.folder_id);
   await api('audio/labels',{asset_id:id,title:title(id),folder_ids:[...new Set([...existing,folder.id])]});
   if(r&&r.stage&&r.stage!=='prod')await api('approve',{asset_id:id}).catch(()=>{});
  }
  if(ws.label==='new')ws.label=folder.id;
  await refresh();ws.published=true;notice(ws.selected.length+(ws.selected.length===1?' voice':' voices')+' saved to Audio Library › '+name+'.');
 }
 function input(el){
  const k=el.dataset.input;ws[k]=el.value;save();
  if(k==='genPrompt'&&!busy.generate){const b=q('#voice-workspace [data-act=generate]');if(b)b.disabled=!el.value.trim();}
  if(k==='aiPrompt'&&!busy.improve){const b=q('#voice-workspace [data-act=improve]'),id=ws.selected[ws.active];if(b)b.disabled=!id||!describable(id)||!el.value.trim();}
  if(k==='testLine'&&!busy.speak){const b=q('#voice-workspace [data-act=speak]');if(b)b.disabled=!el.value.trim();}
  if(k==='newLabel'&&!busy.publish){const b=q('#voice-workspace [data-act=publish]');if(b)b.disabled=!labelName()||!ws.selected.length;}
  if(k==='genLang'||k==='genType')draw();
 }
 function setting(el){
  if(el.dataset.setting==='model')ws.model=el.value;
  else if(el.dataset.setting==='compute')localStorage.setItem('ecco-compute-voice',el.value);
  save();draw();
 }
 const toBase64=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('The audio could not be read.'));r.readAsDataURL(blob);});
 async function upload(file){
  if(!file)return;
  if(!/^audio\//.test(file.type)&&!/\.(wav|mp3|m4a|ogg|flac)$/i.test(file.name)){notice('Choose a WAV, MP3, M4A, OGG or FLAC file.',true);return;}
  await run('upload',async()=>{
   const asset=await api('audio/upload',{name:file.name,data:await toBase64(file)});
   window.EccoAudioLibrary?.remember?.(asset);
   add(await saveClip(asset,file.name.replace(/\.[^.]+$/,'').slice(0,60)||'Uploaded voice','upload'));
  });
 }
 // Chrome records WebM/Opus, which the storage server does not accept, so the recording is decoded and sent as WAV.
 async function toWav(blob){
  const Ctx=window.AudioContext||window.webkitAudioContext,ctx=new Ctx();
  try{
   const decoded=await ctx.decodeAudioData(await blob.arrayBuffer()),rate=24000,frames=Math.ceil(decoded.duration*rate);
   const offline=new OfflineAudioContext(1,frames,rate),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
   const data=(await offline.startRendering()).getChannelData(0),out=new DataView(new ArrayBuffer(44+data.length*2));
   const text=(o,s)=>[...s].forEach((c,i)=>out.setUint8(o+i,c.charCodeAt(0)));
   text(0,'RIFF');out.setUint32(4,36+data.length*2,true);text(8,'WAVE');text(12,'fmt ');out.setUint32(16,16,true);out.setUint16(20,1,true);out.setUint16(22,1,true);out.setUint32(24,rate,true);out.setUint32(28,rate*2,true);out.setUint16(32,2,true);out.setUint16(34,16,true);text(36,'data');out.setUint32(40,data.length*2,true);
   data.forEach((v,i)=>out.setInt16(44+i*2,Math.max(-1,Math.min(1,v))*0x7fff,true));
   return new Blob([out],{type:'audio/wav'});
  }finally{ctx.close?.();}
 }
 async function startRecording(){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){notice('This browser cannot record audio. Upload a recording instead.',true);return;}
  let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}catch{notice('Allow microphone access in your browser to record.',true);return;}
  const chunks=[];recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const keep=recorder?._keep;const took=(Date.now()-recordStart)/1000;recorder=null;clearInterval(recordTimer);
   if(!keep){draw();return;}
   if(took<3){notice('Record at least 10 seconds so the voice can be copied well.',true);draw();return;}
   run('record',async()=>{const wav=await toWav(new Blob(chunks,{type:chunks[0]?.type||'audio/webm'}));const stamp=new Date().toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    const asset=await api('audio/upload',{name:'Voice recording '+stamp+'.wav',data:await toBase64(wav)});window.EccoAudioLibrary?.remember?.(asset);add(await saveClip(asset,'My voice · '+stamp,'recording'));});
  };
  recordStart=Date.now();recorder.start();recordTimer=setInterval(()=>{if(page===PAGE&&ws.src==='record'){const b=q('#voice-workspace [data-act=record]');if(b)b.lastChild.textContent='Stop Recording · 0:'+String(Math.floor((Date.now()-recordStart)/1000)).padStart(2,'0');if(Date.now()-recordStart>60000)stopRecording(true);}},500);
  draw();
 }
 function stopRecording(keep){if(!recorder)return;recorder._keep=keep;if(recorder.state!=='inactive')recorder.stop();}

 /* ---------- sidebar: Studios › Voice Studio (tree) ---------- */
 const expanded=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k)!=='false';localStorage.setItem(k,String(v));}catch{}return true;};
 // Owner request: Studios sits exactly as far below Tell Your Story as Tell Your Story sits below Library (text to
 // text). The space after a group's last line depends on the font, so it is measured rather than fixed: the gap
 // Library → Tell Your Story is read whenever both are in the same open/closed state, and Studios gets the gap that
 // matches Tell Your Story's current state.
 const gapCache={};
 function textBottom(el){const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let m=-Infinity,n;while(n=w.nextNode()){if(!n.textContent.trim())continue;const r=document.createRange();r.selectNodeContents(n);for(const b of r.getClientRects())if(b.height)m=Math.max(m,b.bottom);}return m;}
 function textTop(group){const label=group.querySelector(':scope>summary span:last-child');if(!label)return NaN;const r=document.createRange();r.selectNodeContents(label);return r.getClientRects()[0]?.top??NaN;}
 function alignGap(){
  const lib=q('#workspace-library-group'),tell=q('#workspace-production-group'),group=q('#workspace-studios-group');
  if(!lib||!tell||!group||!group.offsetParent)return;
  if(lib.open===tell.open){const g=textTop(tell)-textBottom(lib);if(Number.isFinite(g))gapCache[tell.open]=g;}
  const target=gapCache[tell.open];group.style.marginTop='';if(!Number.isFinite(target))return;
  const now=textTop(group)-textBottom(tell);if(!Number.isFinite(now))return;
  const margin=parseFloat(getComputedStyle(group).marginTop)+target-now;
  if(Math.abs(target-now)>0.25&&margin>=0)group.style.marginTop=margin+'px';
 }
 let aligning=0;const queueAlign=()=>{cancelAnimationFrame(aligning);aligning=requestAnimationFrame(alignGap);};
 function sidebar(){
  const tell=q('#workspace-production-group');if(!tell)return;
  let group=q('#workspace-studios-group');
  if(!group){
   group=document.createElement('details');group.id='workspace-studios-group';group.className='workspace-library';group.open=expanded('ecco-studios-expanded');
   // Studios lists each studio as one plain "-" entry; its steps are the tabs on the studio screen (owner-approved mock, 18 Nov 2026).
   group.innerHTML='<summary><span class="library-symbol" aria-hidden="true"></span><span>Studios</span></summary><div class="workspace-library-content"><button type="button" class="journey-step" id="workspace-voice-studio-node"><span aria-hidden="true">- </span>Voice Studio</button></div>';
   group.addEventListener('toggle',()=>expanded('ecco-studios-expanded',group.open));
   q('#workspace-voice-studio-node',group).addEventListener('click',()=>navigate(PAGE));
  }
  if(tell.nextElementSibling!==group)tell.after(group);
  for(const g of [q('#workspace-library-group'),tell])if(g&&!g.dataset.studiosGap){g.dataset.studiosGap='1';g.addEventListener('toggle',queueAlign);}
  queueAlign();
  const on=page===PAGE;
  q('#workspace-voice-studio-node',group).classList.toggle('active',on);
 }

 /* ---------- wiring ---------- */
 document.addEventListener('click',e=>{const b=e.target.closest?.('#voice-workspace [data-act]');if(b&&!b.disabled){e.preventDefault();act(b);}});
 document.addEventListener('input',e=>{if(e.target.closest?.('#voice-workspace')&&e.target.dataset.input&&e.target.tagName!=='SELECT')input(e.target);});
 document.addEventListener('change',e=>{
  if(!e.target.closest?.('#voice-workspace'))return;
  if(e.target.matches('[data-upload-file]')){upload(e.target.files[0]);e.target.value='';}
  else if(e.target.dataset.setting)setting(e.target);
  else if(e.target.tagName==='SELECT'&&e.target.dataset.input)input(e.target);
 });
 document.addEventListener('keydown',e=>{
  const t=e.target.closest?.('#voice-workspace [role=tab]');if(!t||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  const tabs=all('[role=tab]',t.parentElement),i=tabs.indexOf(t),n=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  e.preventDefault();tabs[n].click();const label=tabs[n].id;requestAnimationFrame(()=>q('#'+CSS.escape(label))?.focus());
 });
 document.addEventListener('ecco:gpu-connection-change',()=>{if(page===PAGE)checkStatus();});
 const previous=navigate;
 navigate=function(target,...args){
  if(target!==PAGE){if(recorder)stopRecording(false);const result=previous.call(this,target,...args);sidebar();return result;}
  if(typeof notice==='function')notice('');document.body.classList.remove('workspace-entry-mode');q('#workspace-entry')?.remove();
  page=PAGE;q('#heading').textContent='Voice Studio';all('nav button').forEach(b=>b.classList.remove('active'));all('#workspace-production-group .journey-step').forEach(b=>b.classList.remove('active'));
  const guide=q('#journey-guide');if(guide)guide.hidden=true;
  load();draw();checkStatus();
 };
 if(typeof names!=='undefined')names[PAGE]='Voice Studio';
 let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;sidebar();});}).observe(document.querySelector('aside')||document.body,{childList:true,subtree:true});
 sidebar();
 window.addEventListener('resize',queueAlign);document.fonts?.ready?.then(queueAlign);
 window.EccoVoiceStudio={draw,open:()=>navigate(PAGE),get state(){return ws;}};
})();
