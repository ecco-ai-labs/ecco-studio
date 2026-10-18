'use strict';
// GitHub Pages UI. Generation and saved audio require an independent application service.
(() => {
 const languages=['Hindi','Urdu','English','Tamil','Punjabi','Assamese','Bengali','Bodo','Dogri','Gujarati','Kannada','Kashmiri','Konkani','Maithili','Malayalam','Manipuri','Marathi','Nepali','Odia','Sanskrit','Santali','Sindhi','Telugu'];
 // Add future audio models here; the selector and catalog share these identifiers.
 const audioModels=[{id:'indic-mio',name:'Simple Audio Model',license:'Apache-2.0'}];
 const genres=["Story Book Reading","Podcast","Movie","Theatre","Casual Conversation","Documentary","News","Interview","Educational"];
 const emotions=language=>language==='English'?['neutral','happy','sad','angry','enunciated','confused','whisper']:['neutral','happy','sad','angry','disgust','fear','surprise'];
 const q=s=>document.querySelector(s);
 const blank=()=>({text:'',language:'Hindi',emotion:'neutral',voice:'en_female'});
 const key=()=>`ecco-audio-draft:${activeStory}`;
 let draft,story,signature='',submitting=false,service=null,recordings=[],lastJob=null,polling=false;
 const serviceReady=()=>!!service;
 for(const model of audioModels){
  MODEL_CATALOG[model.id]={name:model.name,license:model.license,defaults:{}};
  if(!MODEL_CATEGORIES.voice.models.includes(model.id))MODEL_CATEGORIES.voice.models.push(model.id);
 }
 MODEL_CATEGORIES.voice.title='Audio & narration';
 names.audio='Audio Studio';
 const oldStatus=modelStatus;
 modelStatus=function(id){return id==='indic-mio'?'Apache 2.0 · 22 Indian languages + English. '+(serviceReady()?'Independent audio service connected.':'Generation awaits the independent audio service. You can prepare your script now.'):oldStatus(id);};
 const oldAvailable=modelAvailable;
 modelAvailable=function(id){return id==='indic-mio'?serviceReady():oldAvailable(id);};
 function load(){
  story=activeStory;
  try{draft=JSON.parse(localStorage.getItem(key()));}catch{draft=null;}
  if(!draft||!Array.isArray(draft.lines)||!draft.lines.length)draft={title:'',speed:1,pitch:0,pause:0.35,lines:[blank()]};
  if(!audioModels.some(model=>model.id===draft.model))draft.model=audioModels[0].id;
  if(!genres.includes(draft.genre))draft.genre=genres[0];
 }
 function save(){localStorage.setItem(key(),JSON.stringify(draft));}
 const options=(values,value)=>values.map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(v.charAt(0).toUpperCase()+v.slice(1))}</option>`).join('');
 function lineHTML(line,index){
  return `<fieldset class="audio-line" data-line="${index}"><legend>Line ${index+1}</legend><div class="audio-line-controls"><label>Language<select data-field="language">${options(languages,line.language)}</select></label><label>Voice<select data-field="voice"><option value="en_female" ${line.voice==='en_female'?'selected':''}>Voice A · feminine</option><option value="en_male" ${line.voice==='en_male'?'selected':''}>Voice B · masculine</option></select></label><label>Emotion<select data-field="emotion">${options(emotions(line.language),line.emotion)}</select></label><button type="button" class="secondary small" data-remove-line="${index}" aria-label="Remove line ${index+1}" ${draft.lines.length===1?'disabled':''}>Remove</button></div><label>Spoken text<textarea data-field="text" dir="auto" maxlength="500" rows="3" required placeholder="Write in the language you want spoken. You can mix languages within a line.">${esc(line.text)}</textarea></label></fieldset>`;
 }
 function drawLines(){
  q('#audio-lines').innerHTML=draft.lines.map(lineHTML).join('');
  q('#audio-form').oninput=e=>{
   const field=e.target.dataset.field,root=e.target.closest('[data-line]');if(!field||!root)return;
   const line=draft.lines[Number(root.dataset.line)];line[field]=e.target.value;
   if(field==='language'){
    if(!emotions(line.language).includes(line.emotion))line.emotion='neutral';
    root.querySelector('[data-field="emotion"]').innerHTML=options(emotions(line.language),line.emotion);
   }
   save();
  };
  q('#audio-lines').onclick=e=>{const button=e.target.closest('[data-remove-line]');if(!button)return;draft.lines.splice(Number(button.dataset.removeLine),1);save();drawLines();};
  q('#add-audio-line').disabled=draft.lines.length>=20;
  window.EccoGeneration?.audioLines(q('#audio-form'));
 }
 const audioAssets=()=>recordings.filter(a=>!a.deleted&&(a.story_id||LEGACY_STORY)===activeStory);
 function audioCard(a){return `<article class="card audio-card"><div class="card-body"><span class="badge">${esc(a.stage||'dev')}</span><h3>${esc(a.title||'Audio recording')}</h3><audio controls preload="metadata" data-audio-id="${esc(a.id)}" aria-label="${esc(a.title||'Audio recording')}"></audio><p class="help">Indic-Mio · WAV${a.duration?' · '+esc(a.duration)+' sec':''}</p><details><summary>Script</summary><p class="audio-transcript" dir="auto">${esc(a.prompt||'')}</p></details><div class="actions"><button type="button" class="small" data-download-audio="${esc(a.id)}">Download WAV</button></div></div></article>`;}
 async function hydrateAudio(){
  const current=service;if(!current)return;
  for(const element of document.querySelectorAll('audio[data-audio-id]')){
   try{const url=await current.mediaURL(element.dataset.audioId);if(current!==service)return;const parsed=new URL(url);if(parsed.protocol!=='https:')throw Error('Audio service must return a secure media URL.');element.src=parsed.href;}
   catch(error){notice(error.message,true);}
  }
  document.querySelectorAll('[data-download-audio]').forEach(button=>button.onclick=async()=>{try{await current.download(button.dataset.downloadAudio);}catch(error){notice(error.message,true);}});
 }
 async function poll(){
  if(!service||polling||page!=='audio')return;
  const current=service,requestedStory=activeStory;polling=true;
  try{
   const next=await current.list({story_id:requestedStory});
   if(current!==service||requestedStory!==activeStory)return;
   recordings=next;
   const id=localStorage.getItem('ecco-audio-job:'+requestedStory);
   lastJob=id?await current.job(id):null;
   update();
  }catch(error){if(page==='audio')notice(error.message,true);}finally{polling=false;}
 }
 // The independent application service supplies this adapter after authentication.
 // Never attach the legacy RunPod/Jupyter bridge here.
 window.EccoAudioStudio={connect(adapter){
  if(!adapter||adapter.storageIndependentOfGPU!==true||!['list','generate','job','mediaURL','download'].every(name=>typeof adapter[name]==='function'))throw Error('An authenticated, GPU-independent audio service is required.');
  service=adapter;recordings=[];lastJob=null;signature='';update();poll();
 },disconnect(){service=null;recordings=[];lastJob=null;signature='';update();}};
 function update(){
  if(page!=='audio'||!q('#audio-form'))return;
  if(story!==activeStory){render();return;}
  const button=q('#generate-audio');
  button.disabled=submitting;
  button.textContent=submitting?'Submitting…':'Generate audio';
  const currentId=window.EccoGeneration?.jobId('audio',activeStory,lastJob);
  const job=lastJob?.id===currentId?lastJob:null;
  q('#audio-job-status').textContent=job?`${job.status==='done'?'Audio saved.':job.status} ${job.error||job.progress&&job.status==='running'&&job.progress||''}`:'';
  const list=window.EccoGeneration?.results('audio',audioAssets(),activeStory,lastJob)||[],next=JSON.stringify(list);
  if(next!==signature){
   signature=next;
   const empty=q('[data-audio-empty]');if(empty)empty.hidden=!!list.length;
   q('#audio-gallery')?.remove();
   if(list.length){(q('#audio-review-results')||q('.audio-workspace')).insertAdjacentHTML('beforeend',`<div class="cards" id="audio-gallery">${list.map(audioCard).join('')}</div>`);hydrateAudio();}
  }

 }
 function render(){
  load();signature='';
  q('#page').innerHTML=`<section class="audio-studio"><p class="intro">Prepare narration or bilingual dialogue. Add a line for each speaker or language. Choose Generate audio to connect a GPU when needed.</p><div class="grid audio-workspace"><form id="audio-form" class="panel form"><div class="audio-model-controls model-summary"><label>Audio model<select name="model">${audioModels.map(model=>`<option value="${esc(model.id)}" ${draft.model===model.id?'selected':''}>${esc(model.name)}</option>`).join('')}</select></label><label>Genre<select name="genre">${options(genres,draft.genre)}</select></label></div><label>Recording title<input name="title" maxlength="160" value="${esc(draft.title)}" placeholder="Scene 1 · opening dialogue"></label><div id="audio-lines"></div><button type="button" class="secondary" id="add-audio-line">+ Add dialogue line</button><div class="audio-output-controls"><label>Speed<select name="speed">${[0.75,1,1.25,1.5].map(v=>`<option value="${v}" ${Number(draft.speed)===v?'selected':''}>${v}×</option>`).join('')}</select></label><label>Pitch<select name="pitch">${[-4,-2,0,2,4].map(v=>`<option value="${v}" ${Number(draft.pitch)===v?'selected':''}>${v>0?'+':''}${v} semitones</option>`).join('')}</select></label><label>Pause between lines<select name="pause">${[0,0.35,0.75,1,2].map(v=>`<option value="${v}" ${Number(draft.pause)===v?'selected':''}>${v} seconds</option>`).join('')}</select></label></div><p class="help">Write in the original script for best pronunciation. Language selects the available emotions; it does not translate text. Use *word* for emphasis. Voice presets may carry an accent; dialect quality varies.</p><div class="row"><button id="generate-audio">Generate audio</button><span class="help">Draft saved in this browser · up to 4,000 characters</span></div><p id="audio-job-status" role="status"></p></form></div></section>`;
  drawLines();
  q('#add-audio-line').onclick=()=>{if(draft.lines.length<20){draft.lines.push({...blank(),voice:draft.lines.at(-1).voice==='en_female'?'en_male':'en_female',language:draft.lines.at(-1).language});save();drawLines();}};
  q('#audio-form').addEventListener('input',e=>{if(e.target.name){draft[e.target.name]=['title','model','genre'].includes(e.target.name)?e.target.value:Number(e.target.value);save();}});
  q('#audio-form').onsubmit=async e=>{
   e.preventDefault();save();
   if(submitting)return;
   if(!gpuConnected()){connectGPU('generate-audio');return;}
   if(!serviceReady()){notice('GPU connected. Audio generation still needs the independent audio service and Indic-Mio worker to be configured. Your script is saved in this browser.',true);return;}
   if(draft.lines.some(line=>!line.text.trim())){notice('Add spoken text for every dialogue line.',true);q('[data-open-prompt]')?.click();return;}
   if(draft.lines.reduce((n,line)=>n+line.text.length,0)>4000){notice('Keep the complete script within 4,000 characters.',true);return;}
   const requestedStory=activeStory;submitting=true;update();
   try{const job=await service.generate({...draft,model:draft.model,story_id:requestedStory});window.EccoGeneration?.trackJob('audio',requestedStory,job);localStorage.setItem('ecco-audio-job:'+requestedStory,job.id);update();notice('Audio queued. You can keep working while it generates.');await poll();}
   catch(error){notice(error.message,true);}
   finally{submitting=false;update();}
  };
  if(window.EccoGeneration){window.EccoGeneration.mount(q('#audio-form'),'audio');const review=document.createElement('div');review.id='audio-review-results';review.innerHTML='<div class="section-head"><h2>Review audio</h2></div><div class="empty" data-audio-empty><strong>Your audio starts here</strong><p class="help">Add a script and generate audio.</p></div>';q('.audio-workspace').append(review);}
  update();poll();
 }
 const oldNavigate=navigate;
 navigate=function(p){
  if(p!=='audio')return oldNavigate.apply(this,arguments);
  document.body.classList.remove('workspace-entry-mode');q('#workspace-entry')?.remove();page='audio';
  q('#heading').textContent='Audio Studio';
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page==='audio'));
  render();
 };
 setInterval(poll,4000);
 const nav=q('nav[aria-label="Production stages"]')||q('aside nav');
 const production=q('#workspace-production-group .workspace-library-content');
 const video=nav.querySelector('button[data-page="render"]');
 const button=document.createElement('button');button.type='button';button.dataset.page='audio';button.textContent='− Audio Studios';button.addEventListener('click',()=>navigate('audio'));
 // Inherit the existing production-menu styling and place Audio after Video.
 if(video)video.after(button);else (production||nav).append(button);
})();


