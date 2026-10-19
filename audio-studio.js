'use strict';
// GitHub Pages UI. Generation and saved audio require an independent application service.
(() => {
 const audioModels=window.EccoAudioModels;
 const genres=["Story Book Reading","Podcast","Movie","Theatre","Casual Conversation","Documentary","News","Interview","Educational"];
 const emotions=language=>!model().emotions?['neutral']:language==='English'?['neutral','happy','sad','angry','enunciated','confused','whisper']:['neutral','happy','sad','angry','disgust','fear','surprise'];
 const q=s=>document.querySelector(s);
 const blank=()=>({text:'',language:'Hindi',emotion:'neutral',voice:'en_female'});
 const key=()=>`ecco-audio-draft:${activeStory}`;
 let draft,story,signature='',submitting=false,service=null,recordings=[],lastJob=null,polling=false;
 const serviceReady=()=>!!service;
 let computeStatus=null,computeChecked=0;
 function showComputeStatus(){
  const note=q('[data-audio-compute-status]');if(!note||!draft)return;
  const target=computeStatus?.compute?.[draft.compute];
  note.textContent=!service?'Connect workspace storage to check availability.':target?.ready?(target.models&&!target.models.includes(draft.model)?model().name+' is not available on '+draft.compute.toUpperCase()+'.':''):target?.reason||'Checking '+draft.compute.toUpperCase()+' availability…';
 }
 async function checkCompute(){
  if(!service){computeStatus=null;showComputeStatus();return null;}
  const current=service;
  if(typeof current.status!=='function')throw Error('The audio service needs an update to support compute selection.');
  const result=await current.status();
  if(current!==service)throw Error('Storage disconnected.');
  if(result?.routing_version!==1)throw Error('The audio service needs an update to support compute selection.');
  computeStatus=result;computeChecked=Date.now();showComputeStatus();return result;
 }
 async function requireCompute(compute,modelId){
  const result=await checkCompute();
  const target=result?.compute?.[compute];
  if(!target?.ready)throw Error(target?.reason||compute.toUpperCase()+' audio worker is not connected.');
  if(target.models&&!target.models.includes(modelId))throw Error('This audio model is not enabled on '+compute.toUpperCase()+'. Choose another compute target.');
 }
 for(const model of audioModels){
  MODEL_CATALOG[model.id]={name:model.name,license:model.license,defaults:{}};
  if(!MODEL_CATEGORIES.voice.models.includes(model.id))MODEL_CATEGORIES.voice.models.push(model.id);
 }
 MODEL_CATEGORIES.voice.title='Audio & narration';
 try{const chosen=JSON.parse(localStorage.getItem('ecco-model-profiles-v1'))?.selected?.voice;if(audioModels.some(m=>m.id===chosen))modelProfiles.selected.voice=chosen;}catch{}
 names.audio='Audio Studio';
 const oldStatus=modelStatus;
 modelStatus=function(id){const item=audioModels.find(m=>m.id===id);return item?item.license+' · '+item.languages.length+' languages. '+(serviceReady()?'Audio service connected.':'Connect workspace storage to generate audio.'):oldStatus(id);};
 const oldAvailable=modelAvailable;
 modelAvailable=function(id){return audioModels.some(m=>m.id===id)?serviceReady():oldAvailable(id);};
 const dialects={English:['Indian English','British English','Irish English','Australian English','American English','Scottish English'],Hindi:['Standard Hindi','Delhi Hindi','Punjabi-influenced Hindi'],Urdu:['Standard Urdu','Lucknow Urdu','Hyderabadi Urdu'],Punjabi:['Majhi','Malwai','Doabi'],Tamil:['Standard Tamil','Chennai Tamil','Sri Lankan Tamil']};
 const newSpeaker=(index,seed={})=>({id:'speaker-'+index,name:index===0?'Narrator':index===1?'Guest':'Speaker '+(index+1),language:'Hindi',voice:index%2?'en_male':'en_female',emotion:'neutral',dialect:'',mixed_language:'',delivery:'',...seed});
 const model=()=>audioModels.find(m=>m.id===draft.model)||audioModels[0];
 const speaker=id=>draft.speakers.find(s=>s.id===id)||draft.speakers[0];
 const activeSpeakers=()=>draft.presentation==='conversation'?draft.speakers:[draft.speakers[0]];
 const turns=()=>draft.presentation==='single'?[{text:draft.single_text,speaker_id:draft.speakers[0].id}]:draft.lines;
 function load(){
  story=activeStory;
  try{draft=JSON.parse(localStorage.getItem(key()));}catch{draft=null;}
  if(!draft||!Array.isArray(draft.lines)||!draft.lines.length)draft={title:'',speed:1,pitch:0,pause:0.35,lines:[blank()]};
  draft={title:'',speed:1,pitch:0,pause:0.35,...draft};
  // Each visit starts on CPU; a GPU is used only after an explicit selection.
  draft.compute='cpu';
  if(!audioModels.some(m=>m.id===draft.model))draft.model=audioModels[0].id;
  if(audioModels.some(m=>m.id===modelProfiles.selected.voice))draft.model=modelProfiles.selected.voice;
  if(!genres.includes(draft.genre))draft.genre=genres[0];
  // Migrate existing scripts without dropping text, speaker changes or language choices.
  if(!Array.isArray(draft.speakers)||!draft.speakers.length){
   const identities=new Map();draft.speakers=[];
   for(const line of draft.lines){
    const identity=JSON.stringify([line.voice,line.language,line.emotion]);
    if(!identities.has(identity)){const item=newSpeaker(draft.speakers.length,{voice:line.voice||'en_female',language:line.language||'Hindi',emotion:line.emotion||'neutral'});draft.speakers.push(item);identities.set(identity,item.id);}
    line.speaker_id=identities.get(identity);
   }
  }
  if(!['single','conversation'].includes(draft.presentation))draft.presentation=draft.speakers.length>1?'conversation':'single';
  if(typeof draft.single_text!=='string')draft.single_text=draft.lines.map(l=>l.text||'').join('\n\n');
  for(const line of draft.lines)if(!draft.speakers.some(s=>s.id===line.speaker_id))line.speaker_id=draft.speakers[0].id;
  normalizeSpeakers();
  save();
 }
 function normalizeSpeakers(){
  draft.speakers.forEach((item,index)=>{if(!model().languages.includes(item.language))item.language='Hindi';if(!model().voices.some(v=>v.id===item.voice))item.voice=model().voices[index%model().voices.length].id;if(!emotions(item.language).includes(item.emotion))item.emotion='neutral';if(!model().languages.includes(item.mixed_language)||item.mixed_language===item.language)item.mixed_language='';});
 }
 function changeModel(value){
  for(const item of draft.speakers){item.model_settings||={};item.model_settings[draft.model]={language:item.language,voice:item.voice,emotion:item.emotion,mixed_language:item.mixed_language};if(item.model_settings[value])Object.assign(item,item.model_settings[value]);}
  draft.model=value;modelProfiles.selected.voice=value;saveModelProfiles();normalizeSpeakers();save();drawControls();showComputeStatus();clearPreview();q('#audio-voice-preview-dialog')?.close();
 }
 const modelParameters=()=>draft.model==='chatterbox'?{exaggeration:Number(draft.exaggeration??0.5)}:{};
 function save(){localStorage.setItem(key(),JSON.stringify(draft));}
 const options=(values,value)=>values.map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(v.charAt(0).toUpperCase()+v.slice(1))}</option>`).join('');
 const speakerOptions=value=>draft.speakers.map(s=>`<option value="${esc(s.id)}" ${s.id===value?'selected':''}>${esc(s.name||'Speaker')}</option>`).join('');
 function drawLines(){
  const single=draft.presentation==='single';
  q('#audio-lines').innerHTML=`<label>Opening Title<input data-opening-text maxlength="300" value="${esc(draft.opening_text||'')}" placeholder="Optional spoken opening title"></label><label>Pause After Opening Title (Seconds)<input data-opening-pause type="number" min="0" max="10" step="0.1" value="${draft.opening_pause??2}"></label>${single?'':`<label>Opening Speaker<select data-opening-speaker>${speakerOptions(draft.opening_speaker||draft.speakers[0].id)}</select></label>`}`+(single?`<div class="audio-line" data-line="0"><label>Spoken script<textarea data-field="text" data-single-script dir="auto" maxlength="4000" rows="6" placeholder="Enter exactly what the narrator should say. Use Generate script with AI to turn instructions into a script.">${esc(draft.single_text)}</textarea></label></div>`:draft.lines.map((line,index)=>`<fieldset class="audio-line" data-line="${index}"><div class="audio-turn-heading">${line.scene_title?`<span style="color:var(--accent)">${esc(line.scene_title)}</span>`:''}<label>Speaker<select data-turn-speaker>${speakerOptions(line.speaker_id)}</select></label><button type="button" class="secondary small" data-remove-turn="${index}" ${draft.lines.length===1?'disabled':''}>Remove turn</button></div><label>${esc(speaker(line.speaker_id).name||'Speaker')}’s words<textarea data-field="text" dir="auto" maxlength="4000" rows="3" placeholder="What should this speaker say?">${esc(line.text||'')}</textarea></label></fieldset>`).join(''));
  const add=q('#add-audio-line');add.hidden=single;add.textContent='Add speaker turn';add.disabled=draft.lines.length>=20;
  q('#audio-lines').oninput=e=>{if(e.target.matches('[data-opening-text],[data-opening-pause]')){draft[e.target.matches('[data-opening-text]')?'opening_text':'opening_pause']=e.target.matches('[data-opening-text]')?e.target.value:Number(e.target.value);save();return;}const root=e.target.closest('[data-line]');if(!root)return;const i=Number(root.dataset.line);if(e.target.matches('[data-field=text]')){if(single)draft.single_text=e.target.value;else draft.lines[i].text=e.target.value;save();}};
  q('#audio-lines').onchange=e=>{if(e.target.matches('[data-opening-speaker]')){draft.opening_speaker=e.target.value;save();return;}if(!e.target.matches('[data-turn-speaker]'))return;draft.lines[Number(e.target.closest('[data-line]').dataset.line)].speaker_id=e.target.value;save();drawLines();drawControls();};
  q('#audio-lines').onclick=e=>{const button=e.target.closest('[data-remove-turn]');if(!button)return;draft.lines.splice(Number(button.dataset.removeTurn),1);save();drawLines();drawControls();};
  window.EccoGeneration?.audioLines(q('#audio-form'));
 }
 function changePresentation(value){
  if(value===draft.presentation)return;
  if(value==='conversation'){
   if(draft.speakers.length===1){draft.speakers[0].name=draft.speakers[0].name==='Narrator'?'Host':draft.speakers[0].name;draft.speakers.push(newSpeaker(1));}
   if(!draft.lines.some(l=>l.text?.trim()))draft.lines=[{text:draft.single_text,speaker_id:draft.speakers[0].id}];
  }else if(!draft.single_text.trim())draft.single_text=draft.lines.map(l=>l.text||'').join('\n\n');
  draft.presentation=value;save();drawLines();drawControls();
 }
 const speakerIcon='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg>';
 function drawControls(root=q('[data-delivery-controls]')){
  if(!root||!draft)return;normalizeSpeakers();
  root.innerHTML=`<label>Audio format<select data-audio-presentation><option value="single" ${draft.presentation==='single'?'selected':''}>Single Voice</option><option value="conversation" ${draft.presentation==='conversation'?'selected':''}>Conversation</option></select></label><div class="audio-speaker-tabs" role="group" aria-label="Speakers">${activeSpeakers().map((s,i)=>`<button type="button" class="secondary" data-speaker-tab="${esc(s.id)}" aria-pressed="${s.id===(draft.selected_speaker||draft.speakers[0].id)}">${esc(s.name||'Speaker '+(i+1))}</button>`).join('')}${draft.presentation==='conversation'?`<button type="button" class="secondary" data-add-speaker ${draft.speakers.length>=8?'disabled':''}>Add speaker</button>`:''}</div><div data-speaker-panel></div>${model().expressiveness?`<label>Expressiveness<input data-expressiveness type="range" min="0" max="2" step="0.1" value="${draft.exaggeration??0.5}"><span data-expressiveness-value>${draft.exaggeration??0.5}</span></label>`:''}`;
  if(!activeSpeakers().some(s=>s.id===draft.selected_speaker))draft.selected_speaker=draft.speakers[0].id;
  const expression=root.querySelector('[data-expressiveness]');if(expression)expression.oninput=()=>{draft.exaggeration=Number(expression.value);root.querySelector('[data-expressiveness-value]').textContent=expression.value;save();};
  const selected=speaker(draft.selected_speaker),panel=root.querySelector('[data-speaker-panel]'),choices=dialects[selected.language]||[];
  panel.dataset.speaker=selected.id;
  panel.innerHTML=`${draft.presentation==='conversation'?`<label>Speaker name<input data-speaker-field="name" maxlength="60" value="${esc(selected.name)}" placeholder="Host, Guest…"></label>`:''}<div class="generation-filter-row"><label>Language<select data-speaker-field="language">${options(model().languages,selected.language)}</select></label><label>Mix with<select data-speaker-field="mixed_language"><option value="">None</option>${options(model().languages.filter(l=>l!==selected.language),selected.mixed_language)}</select></label></div><div class="audio-voice-row"><label>Voice<select data-speaker-field="voice">${model().voices.map(v=>`<option value="${v.id}" ${selected.voice===v.id?'selected':''}>${v.name}</option>`).join('')}</select></label><button type="button" class="secondary audio-voice-preview" data-preview-voice aria-label="Preview selected voice" title="Preview selected voice">${speakerIcon}<span>Preview</span></button></div><div class="generation-filter-row"><label>Dialect / accent<select data-speaker-field="dialect"><option value="">Voice default</option>${options(choices,selected.dialect)}<option value="other" ${selected.dialect==='other'?'selected':''}>Other</option></select></label>${model().emotions?`<label>Emotion<select data-speaker-field="emotion">${options(emotions(selected.language),selected.emotion)}</select></label>`:''}</div><label data-custom-dialect ${selected.dialect==='other'?'':'hidden'}>Dialect / accent instructions<input data-speaker-field="custom_dialect" maxlength="160" value="${esc(selected.custom_dialect||'')}" placeholder="Describe the accent you want"></label><label>Speaking direction<textarea data-speaker-field="delivery" maxlength="1000" rows="3" placeholder="e.g. Hindi mixed with Punjabi, spoken by a man with a soft, expressive delivery.">${esc(selected.delivery||'')}</textarea></label>${draft.presentation==='conversation'?`<button type="button" class="secondary" data-remove-speaker ${draft.speakers.length<=2||draft.lines.some(l=>l.speaker_id===selected.id)?'disabled':''} title="Assign this speaker’s turns to another speaker before removing">Remove speaker</button>`:''}`;
  root.querySelector('[data-audio-presentation]').onchange=e=>changePresentation(e.target.value);
  root.querySelectorAll('[data-speaker-tab]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.speakerTab===selected.id));b.onclick=()=>{draft.selected_speaker=b.dataset.speakerTab;save();drawControls(root);};});
  const add=root.querySelector('[data-add-speaker]');if(add)add.onclick=()=>{const next=newSpeaker(Date.now());next.name='Speaker '+(draft.speakers.length+1);draft.speakers.push(next);draft.selected_speaker=next.id;save();drawControls(root);drawLines();};
  panel.oninput=e=>{const field=e.target.dataset.speakerField;if(!field)return;selected[field]=e.target.value;save();if(field==='name'){root.querySelector('[data-speaker-tab="'+selected.id+'"]').textContent=selected.name||'Speaker';q('#audio-lines').querySelectorAll('[data-turn-speaker]').forEach(select=>{const option=[...select.options].find(o=>o.value===selected.id);if(option)option.textContent=selected.name||'Speaker';});}};
  panel.onchange=e=>{const field=e.target.dataset.speakerField;if(!field)return;selected[field]=e.target.value;if(field==='language'){selected.emotion='neutral';selected.dialect='';selected.custom_dialect='';if(selected.mixed_language===selected.language)selected.mixed_language='';}save();drawControls(root);if(field==='name')drawLines();};
  panel.querySelector('[data-preview-voice]').onclick=()=>previewVoice(selected);
  const remove=panel.querySelector('[data-remove-speaker]');if(remove)remove.onclick=()=>{if(draft.lines.some(l=>l.speaker_id===selected.id))return;draft.speakers=draft.speakers.filter(s=>s.id!==selected.id);draft.selected_speaker=draft.speakers[0].id;save();drawControls(root);drawLines();};
 }
 function splitText(text){
  const chunks=[];let rest=text.trim();
  while(rest.length>500){let cut=Math.max(rest.lastIndexOf('\n',500),rest.lastIndexOf(' ',500));if(cut<100)cut=500;chunks.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();}
  if(rest)chunks.push(rest);return chunks;
 }
 function requestLines(){
  if(turns().some(t=>!t.text?.trim()))throw Error('Add the script for each speaker turn in Prompt.');
  if(turns().reduce((n,t)=>n+t.text.length,0)+(draft.opening_text||'').length>4000)throw Error('Keep the complete script within 4,000 characters.');
  const lines=turns().flatMap(t=>{const s=speaker(t.speaker_id);return splitText(t.text).map(text=>({text,voice:s.voice,language:s.language,emotion:s.emotion}));});
  if(draft.opening_text?.trim()){
   const s=draft.presentation==='single'?draft.speakers[0]:speaker(draft.opening_speaker),pause=Number(draft.opening_pause??2);if(!Number.isFinite(pause)||pause<0||pause>10)throw Error('Choose a title pause between 0 and 10 seconds.');
   lines[0].pause_before=pause;lines.unshift({text:draft.opening_text.trim(),voice:s.voice,language:s.language,emotion:s.emotion});
  }
  if(lines.length>20)throw Error('Shorten the script or combine some speaker turns. This model accepts up to 20 speech segments.');
  return lines;
 }
 function aiContext(element){
  if(!draft)return {};
  const directions=activeSpeakers().map(s=>`${s.name}: ${s.language}${s.mixed_language?' mixed naturally with '+s.mixed_language:''}; ${model().voices.find(v=>v.id===s.voice)?.name}; ${s.emotion} emotion${s.dialect?'; requested dialect/accent: '+(s.dialect==='other'?s.custom_dialect:s.dialect):''}${s.delivery?'; speaking direction: '+s.delivery:''}.`).join('\n');
  const target=draft.presentation==='conversation'&&element?.closest('.audio-line')?speaker(draft.lines[Number(element.closest('.audio-line').dataset.line)]?.speaker_id):draft.speakers[0];
  return {scenes:selectedScenes(),language:target.language,lines:turns().map(t=>({text:t.text,speaker:speaker(t.speaker_id).name,language:speaker(t.speaker_id).language,voice:speaker(t.speaker_id).voice})),instructions:`Audio format: ${draft.presentation==='single'?'single narrator':'conversation'}. Speaker directions:\n${directions}\nSelected speaker: ${target.name}. Write this field in ${target.language}${target.mixed_language?' mixed with '+target.mixed_language:''}.\nWrite only spoken words for the selected field, without speaker labels or stage directions. Preserve the speaker assignments; do not treat delivery instructions as spoken text.`};
 }
 function importScript(text){
  if(turns().some(t=>t.text?.trim()))throw Error('This audio draft already has text. Clear it or save it before importing a scene.');
  if(text.length>4000)throw Error('Keep the complete script within 4,000 characters.');
  if(draft.presentation==='single')draft.single_text=text;else draft.lines=[{text,speaker_id:draft.speakers[0].id}];save();drawLines();drawControls();
 }
 const boardScenes=()=>{try{return JSON.parse(localStorage.getItem(activeStory?'ecco-board-draft:'+activeStory:'ecco-board-new-draft')||'{}').scenes||[];}catch{return [];}};
 const selectedScenes=()=>boardScenes().flatMap((s,i)=>(draft.source_scenes||[]).some(ref=>ref.index===i&&ref.fingerprint===JSON.stringify([s.title||'',s.narration||'']))?[{title:s.title||'Scene '+(i+1),narration:s.narration||'',scene_number:i+1}]:[]);
 function mountScenePicker(){
  const form=q('#audio-form');if(!form||q('#scene-audio-source'))return;
  const area=document.createElement('div');area.id='scene-audio-source';area.className='form';
  area.innerHTML='<button type="button" class="secondary" data-select-scenes>Select Scenes</button><p class="help" data-scene-selection></p>';
  (q('[data-audio-references]')||form).append(area);
  const summary=()=>{area.querySelector('[data-scene-selection]').textContent=selectedScenes().length+' scenes selected · storyboard order';};summary();
  area.querySelector('button').onclick=()=>{
   const scenes=boardScenes(),target=activeStory,snapshot=JSON.stringify(scenes);
   q('#audio-scenes-dialog')?.remove();const dialog=document.createElement('dialog');dialog.id='audio-scenes-dialog';dialog.className='generation-dialog';
   dialog.innerHTML='<div class="form"><div class="section-head"><h2>Select Scenes</h2><button type="button" class="secondary" data-close>Close</button></div><div data-scenes></div><button type="button" data-apply>Apply</button></div>';
   const list=dialog.querySelector('[data-scenes]');
   scenes.forEach((s,i)=>{const label=document.createElement('label');label.style.cssText='display:flex;flex-direction:row;gap:8px;margin:12px 0;color:var(--accent)';const input=document.createElement('input');input.type='checkbox';input.value=String(i);input.style.width='auto';input.checked=selectedScenes().some(ref=>ref.scene_number===i+1);const text=document.createElement('span');text.textContent='Scene '+(i+1)+' · '+(s.title||s.narration||'Untitled');label.append(input,text);list.append(label);});
   if(!scenes.length)list.textContent='Add scenes in StoryBoard Your Story first.';
   dialog.querySelector('[data-close]').onclick=()=>dialog.close();
   dialog.querySelector('[data-apply]').onclick=()=>{if(target!==activeStory||JSON.stringify(boardScenes())!==snapshot){notice('The storyboard changed. Reopen Select Scenes.',true);return;}draft.source_scenes=[...dialog.querySelectorAll('input:checked')].map(el=>{const index=Number(el.value),s=scenes[index];return {index,fingerprint:JSON.stringify([s.title||'',s.narration||''])};});save();summary();dialog.close();};
   dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
  };
 }
 function generateScript(){
  const scenes=selectedScenes();if(!scenes.length){notice('Select storyboard scenes under References first.',true);return;}
  if(scenes.length!==(draft.source_scenes||[]).length){notice('A selected scene changed. Reselect scenes before generating.',true);return;}
  q('#audio-script-instructions')?.remove();const dialog=document.createElement('dialog');dialog.id='audio-script-instructions';dialog.className='generation-dialog';
  dialog.innerHTML='<form class="form"><div class="section-head"><h2>Generate Script with AI</h2><button type="button" class="secondary" data-close>Close</button></div><label>Instructions<textarea data-instructions rows="5" maxlength="4000" placeholder="Describe language, news delivery and how to combine the selected scenes. These instructions will not be spoken."></textarea></label><label>Pause After Opening Title (Seconds)<input data-pause type="number" min="0" max="10" step="0.1"></label><button type="submit">Generate Script</button><p role="status"></p></form>';
  const instructions=dialog.querySelector('[data-instructions]'),pause=dialog.querySelector('[data-pause]'),button=dialog.querySelector('[type=submit]'),status=dialog.querySelector('[role=status]');instructions.value=draft.script_instructions||'';pause.value=draft.opening_pause??2;
  instructions.oninput=()=>{draft.script_instructions=instructions.value;save();};pause.onchange=()=>{draft.opening_pause=Number(pause.value);save();};
  const target=activeStory,form=q('#audio-form');dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
  dialog.querySelector('form').onsubmit=async event=>{
   event.preventDefault();if(button.disabled)return;
   try{
    if(!window.EccoStorage?.ready||!window.EccoAI?.enabled)throw Error('Connect AI and storage in Connections first.');
    if((turns().some(t=>t.text?.trim())||draft.opening_text?.trim())&&!confirm('Replace the current spoken script with a script from the selected scenes?'))return;
    draft.script_instructions=instructions.value;draft.opening_pause=Number(pause.value);save();const snapshot=JSON.stringify(draft),sourceSnapshot=JSON.stringify(boardScenes());
    button.disabled=true;button.textContent='Generating Script…';status.textContent='Combining selected scenes and adapting the language…';
    const direction=aiContext();
    const voiceChoices=model().voices.map(v=>({id:v.id,name:v.name}));
    const contract='Return audio_plan as JSON only: {"opening":{"text":"one spoken sentence introducing the recording title","voice":"'+model().voices[0].id+'"},"segments":[{"scene_number":1,"text":"spoken news script","voice":"'+model().voices[0].id+'"}]}. Include exactly one segment per selected scene, in supplied order, with its original scene_number. Use only voices from the available list. Apply requested female/male assignments to the corresponding scenes. Default to '+draft.speakers[0].voice+' unless instructed otherwise. The opening must be at most 300 characters; total spoken text at most 4000 characters. Write only supported facts from selected scenes; no additional facts from saved stories. Translate/adapt to the requested languages and delivery. Text fields contain spoken words only: no labels, markup or pause instructions. The application inserts silence separately. User language instructions override the default language.';
    const result=await api('ai/enhance',{stage:'storyboard',mode:'generate',story_id:target||null,fields:[{id:'audio_plan',text:contract,max_length:16000}],context:{...direction,title:draft.title||currentStory().title,scenes,instructions:contract+'\nAvailable voices: '+JSON.stringify(voiceChoices)+'\nSpeaker settings: '+direction.instructions+'\nUser instructions: '+instructions.value},review_only:false});
    if(!dialog.open||!form.isConnected||target!==activeStory||JSON.stringify(draft)!==snapshot||JSON.stringify(boardScenes())!==sourceSnapshot)throw Error('The script or scenes changed while AI was working. Your edits were preserved.');
    if(result.questions?.length)throw Error(result.questions.join(' '));
    if(result.revisions?.length!==1||result.revisions[0].id!=='audio_plan')throw Error('AI returned an incomplete audio plan. Your draft was preserved.');
    let plan;try{plan=JSON.parse(result.revisions[0].text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('AI returned an unreadable audio plan. Your draft was preserved.');}
    const validPart=part=>part&&typeof part.text==='string'&&part.text.trim()&&model().voices.some(v=>v.id===part.voice);
    if(!validPart(plan.opening)||plan.opening.text.length>300||!Array.isArray(plan.segments)||plan.segments.length!==scenes.length||plan.segments.some((part,i)=>!validPart(part)||part.scene_number!==scenes[i].scene_number)||[plan.opening,...plan.segments].reduce((n,p)=>n+p.text.length,0)>4000)throw Error('AI returned an invalid scene or speaker assignment. Your draft was preserved.');
    const settings={...draft.speakers[0]},assigned=new Map();
    for(const voice of new Set([plan.opening.voice,...plan.segments.map(p=>p.voice)])){let item=draft.speakers.find(s=>s.voice===voice);if(!item){item=newSpeaker(Date.now()+draft.speakers.length,{...settings,id:'voice-'+voice,voice,name:model().voices.find(v=>v.id===voice).name});draft.speakers.push(item);}assigned.set(voice,item.id);}
    draft.opening_text=plan.opening.text.trim();draft.opening_speaker=assigned.get(plan.opening.voice);
    draft.lines=plan.segments.map((part,i)=>({text:part.text.trim(),speaker_id:assigned.get(part.voice),scene_title:scenes[i].title}));draft.single_text=draft.lines.map(l=>l.text).join('\n\n');
    if(assigned.size>1)draft.presentation='conversation';else{draft.presentation='single';const primary=speaker(assigned.values().next().value);draft.speakers=[primary,...draft.speakers.filter(s=>s.id!==primary.id)];}
    save();drawLines();drawControls();dialog.close();const context=window.EccoGeneration?.context(form);if(context?.prompt&&!context.prompt.open)context.prompt.showModal();
   }catch(error){notice(error.message,true);status.textContent='';}finally{button.disabled=false;button.textContent='Generate Script';}
  };
  document.body.append(dialog);dialog.showModal();instructions.focus();
 }

 let preview=null;
 function clearPreview(){if(!preview)return;clearTimeout(preview.timer);const player=preview.dialog.querySelector('audio');if(player?.src){player.pause();player.removeAttribute('src');}preview=null;}
 function previewVoice(selected){
  clearPreview();q('#audio-voice-preview-dialog')?.remove();
  const d=document.createElement('dialog');d.id='audio-voice-preview-dialog';d.className='generation-dialog';d.setAttribute('aria-label','Voice Preview');
  const settings={model:draft.model,compute:draft.compute,...modelParameters(),genre:draft.genre,speed:draft.speed,pitch:draft.pitch,pause:0,story_id:activeStory,title:'Voice preview · '+(selected.name||'Narrator')},voice={voice:selected.voice,language:selected.language,emotion:selected.emotion};
  d.innerHTML=`<div class="form"><div class="section-head"><h2>Voice Preview</h2><button type="button" class="secondary" data-close>Close</button></div><p>${esc(model().voices.find(v=>v.id===selected.voice)?.name)} · ${esc(selected.language)} · ${esc(selected.emotion)}</p><label>Preview text<textarea maxlength="300" rows="3" dir="auto" placeholder="Enter a short sample in the language you want to hear."></textarea></label><button type="button" id="audio-voice-preview-generate">Generate preview</button><p role="status"></p><audio controls preload="metadata" aria-label="Voice preview playback" hidden></audio></div>`;
  document.body.append(d);const token={dialog:d,story:activeStory,timer:null};preview=token;
  const valid=()=>preview===token&&d.open&&d.isConnected&&page==='audio'&&activeStory===token.story;
  d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>{if(preview===token)clearPreview();d.remove();},{once:true});
  const button=d.querySelector('#audio-voice-preview-generate'),status=d.querySelector('[role=status]'),player=d.querySelector('audio');
  button.onclick=async()=>{
   if(button.disabled)return;
   const text=d.querySelector('textarea').value.trim();if(!text){status.textContent='Enter some preview text first.';return;}
   if(!serviceReady()){window.EccoStorage?.open();return;}
   const current=service,started=Date.now();button.disabled=true;player.hidden=true;player.removeAttribute('src');status.textContent='Generating voice preview…';
   const fail=error=>{if(valid()){status.textContent=error.message||'Could not create the voice preview.';button.disabled=false;}};
   try{
    await requireCompute(settings.compute,settings.model);if(!valid()||current!==service)return;
    const job=await current.generate({...settings,lines:[{text,...voice}]});if(!valid()||current!==service)return;
    const check=async()=>{if(!valid()||current!==service)return;try{
     const result=await current.job(job.id);if(!valid()||current!==service)return;
     if(result.status==='error')throw Error(result.error||'Voice preview failed.');
     if(result.status==='done'){
      const id=result.asset_id||result.asset_ids?.[0]||(Array.isArray(result.result)?result.result[0]:result.result);if(!id)throw Error('The preview completed without an audio file.');
      const url=await current.mediaURL(id);if(!valid()||current!==service)return;const parsed=new URL(url);if(parsed.protocol!=='https:'&&!(parsed.protocol==='blob:'&&parsed.origin===location.origin))throw Error('Could not play the returned audio URL.');
      player.src=url;player.hidden=false;status.textContent='Preview ready. Press Play to listen.';button.disabled=false;return;
     }
     if(Date.now()-started>300000)throw Error('Preview is still processing. Check Activity before generating another.');
     status.textContent=result.progress||'Generating voice preview…';token.timer=setTimeout(check,1500);
    }catch(error){fail(error);}};
    await check();
   }catch(error){fail(error);}
  };d.showModal();d.querySelector('textarea').focus();
 }
 const audioAssets=()=>recordings.filter(a=>!a.deleted&&(a.story_id||LEGACY_STORY)===activeStory);
 const audioActionIcon=name=>'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+({download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>'}[name])+'</svg>';
 function audioCard(a){return `<article class="card audio-card"><div class="asset-corner-actions"><button type="button" class="asset-icon" data-download-audio="${esc(a.id)}" title="Download WAV" aria-label="Download ${esc(a.title||'audio recording')}">${audioActionIcon('download')}</button><button type="button" class="asset-icon" data-delete-audio="${esc(a.id)}" title="Move to Trash" aria-label="Delete ${esc(a.title||'audio recording')}">${audioActionIcon('trash')}</button></div><div class="audio-card-preview"><audio controls preload="metadata" data-audio-id="${esc(a.id)}" aria-label="${esc(a.title||'Audio recording')}"></audio></div><div class="card-body"><button type="button" class="small secondary" data-save-audio="${esc(a.id)}">Add to Audio Library</button><span class="badge">${esc(a.stage||'dev')}</span><h3>${esc(a.title||'Audio recording')}</h3><p class="help">${esc(audioModels.find(m=>m.id===a.settings?.model)?.name||'Audio')} · WAV${a.duration?' · '+esc(a.duration)+' sec':''}</p><details><summary>Script</summary><p class="audio-transcript" dir="auto">${esc(a.prompt||'')}</p></details></div></article>`;}
 async function hydrateAudio(){
  const current=service;if(!current)return;
  for(const element of document.querySelectorAll('audio[data-audio-id]')){
   try{const url=await current.mediaURL(element.dataset.audioId);if(current!==service)return;const parsed=new URL(url);if(parsed.protocol!=='https:'&&!(parsed.protocol==='blob:'&&parsed.origin===location.origin))throw Error('Audio service must return a secure media URL.');element.src=parsed.href;}
   catch(error){notice(error.message,true);}
  }
  document.querySelectorAll('[data-save-audio]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await refresh();if(!window.EccoAudioLibrary)throw Error('Audio Library is unavailable. Refresh and try again.');window.EccoAudioLibrary.add(button.dataset.saveAudio);}catch(error){notice(error.message,true);}finally{button.disabled=false;}});
  document.querySelectorAll('[data-download-audio]').forEach(button=>button.onclick=async()=>{try{await current.download(button.dataset.downloadAudio);}catch(error){notice(error.message,true);}});
  document.querySelectorAll('[data-delete-audio]').forEach(button=>button.onclick=async()=>{
   button.disabled=true;
   try{const id=button.dataset.deleteAudio;await api('trash',{asset_id:id});recordings=recordings.filter(a=>a.id!==id);update();await refresh();notice('Audio moved to Trash.');}
   catch(error){button.disabled=false;notice(error.message,true);}
  });
 }
 async function poll(){
  if(!service||polling||page!=='audio')return;
  const current=service,requestedStory=activeStory;polling=true;
  try{
   const next=await current.list({story_id:requestedStory});
   if(current!==service||requestedStory!==activeStory)return;
   recordings=next;
   if(Date.now()-computeChecked>15000)await checkCompute();
   const id=localStorage.getItem('ecco-audio-job:'+requestedStory);
   lastJob=id?await current.job(id):null;
   update();
  }catch(error){if(page==='audio')notice(error.message,true);}finally{polling=false;}
 }
 // The independent application service supplies this adapter after authentication.
 // Never attach the legacy RunPod/Jupyter bridge here.
 window.EccoAudioStudio={generateScript,mountScenePicker,controls:drawControls,aiContext,importScript,connect(adapter){
  if(!adapter||adapter.storageIndependentOfGPU!==true||!['list','generate','job','mediaURL','download'].every(name=>typeof adapter[name]==='function'))throw Error('An authenticated, GPU-independent audio service is required.');
  service=adapter;computeStatus=null;computeChecked=0;recordings=[];lastJob=null;signature='';update();poll();
 },disconnect(){clearPreview();q('#audio-voice-preview-dialog')?.close();service=null;computeStatus=null;computeChecked=0;recordings=[];lastJob=null;signature='';update();}};
 function update(){
  if(page!=='audio'||!q('#audio-form'))return;
  if(story!==activeStory){render();return;}
  showComputeStatus();
  const button=q('#generate-audio');
  const currentId=window.EccoGeneration?.jobId('audio',activeStory,lastJob);
  const job=lastJob?.id===currentId?lastJob:state?.records.find(r=>r.id===currentId);
  const busy=submitting||['queued','running'].includes(job?.status);
  const label=submitting?'Submitting…':job?.status==='queued'?'Queued…':'Running Generation';
  setGenerationBusy(button,busy,label,'Generate audio');
  q('#audio-job-status').textContent=submitting?'Submitting…':job?({queued:'Queued',running:'Running Generation',done:'Audio saved.',failed:'Generation failed',error:'Generation failed'}[job.status]||job.status)+(job.error?' · '+job.error:''):'';
  const list=window.EccoGeneration?.results('audio',audioAssets(),activeStory,lastJob)||[],next=JSON.stringify(list);
  if(next!==signature){
   signature=next;
   q('#audio-gallery')?.remove();
   if(list.length){(q('#audio-review-results')||q('.audio-workspace')).insertAdjacentHTML('beforeend',`<div class="cards" id="audio-gallery">${list.map(audioCard).join('')}</div>`);hydrateAudio();}
  }

 }
 function render(){
  clearPreview();q('#audio-voice-preview-dialog')?.close();load();signature='';
  q('#page').innerHTML=`<section class="audio-studio"><div class="grid audio-workspace"><form id="audio-form" class="panel form"><div class="audio-model-controls model-summary"><label>Audio model<select name="model">${audioModels.map(model=>`<option value="${esc(model.id)}" ${draft.model===model.id?'selected':''}>${esc(model.name)}</option>`).join('')}</select></label><label>Genre<select name="genre">${options(genres,draft.genre)}</select></label></div><label>Recording title<input name="title" maxlength="160" value="${esc(draft.title)}" placeholder="Scene 1 · opening dialogue"></label><div id="audio-lines"></div><button type="button" class="secondary" id="add-audio-line">Add speaker turn</button><div class="audio-output-controls"><label>Speed<select name="speed">${[0.75,1,1.25,1.5].map(v=>`<option value="${v}" ${Number(draft.speed)===v?'selected':''}>${v}×</option>`).join('')}</select></label><label>Pitch<select name="pitch">${[-4,-2,0,2,4].map(v=>`<option value="${v}" ${Number(draft.pitch)===v?'selected':''}>${v>0?'+':''}${v} semitones</option>`).join('')}</select></label><label>Pause<select name="pause">${[0,0.35,0.75,1,2].map(v=>`<option value="${v}" ${Number(draft.pause)===v?'selected':''}>${v} seconds</option>`).join('')}</select></label></div><div class="row"><button id="generate-audio">Generate audio</button><span class="help">Draft saved in this browser · up to 4,000 characters</span></div><p id="audio-job-status" role="status"></p></form></div></section>`;
  q('#audio-form').insertAdjacentHTML('afterbegin',`<div data-audio-compute><select name="compute" aria-label="Audio compute" aria-describedby="audio-compute-status"><option value="cpu" ${draft.compute==='cpu'?'selected':''}>CPU</option><option value="a100" ${draft.compute==='a100'?'selected':''}>A100</option><option value="b200" ${draft.compute==='b200'?'selected':''}>B200</option></select><p id="audio-compute-status" class="help" data-audio-compute-status role="status"></p></div>`);
  drawLines();
  q('#add-audio-line').onclick=()=>{if(draft.presentation==='conversation'&&draft.lines.length<20){const previous=draft.lines.at(-1).speaker_id,next=draft.speakers[(draft.speakers.findIndex(s=>s.id===previous)+1)%draft.speakers.length];draft.lines.push({text:'',speaker_id:next.id});save();drawLines();drawControls();}};
  q('#audio-form').addEventListener('input',e=>{if(e.target.name&&e.target.name!=='model'){draft[e.target.name]=['title','model','genre','compute'].includes(e.target.name)?e.target.value:Number(e.target.value);save();}});
  q('#audio-form').addEventListener('change',e=>{if(e.target.name==='model')changeModel(e.target.value);if(e.target.name==='compute'){draft.compute=e.target.value;save();showComputeStatus();clearPreview();q('#audio-voice-preview-dialog')?.close();}});
  q('#audio-form').onsubmit=async e=>{
   e.preventDefault();save();
   if(submitting||q('#generate-audio').disabled)return;
   if(!serviceReady()){window.EccoStorage?.open();return;}
   let lines;try{lines=requestLines();}catch(error){notice(error.message,true);q('[data-open-prompt]')?.click();return;}
   const requestedStory=activeStory;submitting=true;update();
   try{const current=service,request={model:draft.model,compute:draft.compute,...modelParameters(),genre:draft.genre,title:draft.title,speed:draft.speed,pitch:draft.pitch,pause:draft.pause,lines,story_id:requestedStory};await requireCompute(request.compute,request.model);if(current!==service)throw Error('Storage disconnected.');const job=await current.generate(request);window.EccoGeneration?.trackJob('audio',requestedStory,job);localStorage.setItem('ecco-audio-job:'+requestedStory,job.id);if(activeStory===requestedStory)lastJob=job;update();refresh();notice('Audio queued. You can keep working while it generates.');await poll();}
   catch(error){notice(error.message,true);}
   finally{submitting=false;update();}
  };
  if(window.EccoGeneration){window.EccoGeneration.mount(q('#audio-form'),'audio');const review=document.createElement('div');review.id='audio-review-results';review.innerHTML='<div class="section-head"><h2>Review audio</h2></div>';q('.audio-workspace').append(review);}
  mountScenePicker();update();poll();
 }
 const oldNavigate=navigate;
 navigate=function(p){
  if(p!=='audio'){clearPreview();q('#audio-voice-preview-dialog')?.close();return oldNavigate.apply(this,arguments);}
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









