'use strict';
// GitHub Pages UI. Generation and saved audio require an independent application service.
(() => {
 const audioModels=window.EccoAudioModels;
 const genres=["Story Book Reading","Podcast","Movie","Theatre","Casual Conversation","Documentary","News","Interview","Educational"];
 const emotions=language=>!model().emotions?['neutral']:language==='English'?['neutral','happy','sad','angry','enunciated','confused','whisper']:['neutral','happy','sad','angry','disgust','fear','surprise'];
 const q=s=>document.querySelector(s);
 const blank=()=>({text:'',language:'Hindi',emotion:'neutral',voice:'en_female'});
 const key=()=>{
  if(activeStory)return `ecco-audio-draft:${activeStory}`;
  let localId;try{localId=JSON.parse(localStorage.getItem('ecco-new-story-draft')||'{}').localDraftId;}catch{}
  return 'ecco-audio-draft:'+(localId?'local:'+localId:'');
 };
 let draft,story,signature='',submitting=false,service=null,recordings=[],lastJob=null,polling=false,submissionLabel='Submitting…';
 const serviceReady=()=>!!service;
 let computeStatus=null,computeChecked=0;
 function showComputeStatus(){
  const note=q('[data-audio-compute-status]');if(!note||!draft)return;
  const select=q('#audio-form [name=compute]');
  const choices=Object.entries(computeStatus?.compute||{}).filter(([id,target])=>target.ready&&(id==='cpu'||window.EccoCompute?.choices().some(g=>g.name.toLowerCase()===id)));
  if(select){
   const signature=JSON.stringify(choices.map(([id])=>id));
   if(select.dataset.options!==signature){select.replaceChildren(new Option('Select connected compute',''),...choices.map(([id])=>new Option(id.toUpperCase(),id)));select.dataset.options=signature;}
   select.value=choices.some(([id])=>id===draft.compute)?draft.compute:'';
   select.disabled=!choices.length;
  }
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
  if(!compute)throw Error('Select connected compute first.');
  const result=await checkCompute();
  const target=result?.compute?.[compute];
  if(compute!=='cpu'&&!window.EccoCompute?.choices().some(g=>g.name.toLowerCase()===compute))throw Error('Connect the selected audio GPU first.');
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
 const activeSpeakers=()=>draft.presentation==='conversation'?draft.speakers.slice(0,draft.character_count||draft.speakers.length):[draft.speakers[0]];
 const turns=()=>draft.presentation==='single'?(draft.lines.every(t=>t.speaker_id===draft.speakers[0].id)&&draft.lines.map(t=>t.text).join('\n\n')===draft.single_text?draft.lines:[{text:draft.single_text,speaker_id:draft.speakers[0].id}]):draft.lines;
 function readAudioModelSaved(){try{return JSON.parse(localStorage.getItem(key())||'{}').model;}catch{return null;}}
 function load(){
  story=activeStory;
  try{draft=JSON.parse(localStorage.getItem(key()));}catch{draft=null;}
  if(!draft){const saved=state?.records.find(r=>r.kind==='story'&&r.id===activeStory);if(saved?.audio_preparation){window.EccoAudioJourney.handoff({audio_preparation:JSON.stringify(saved.audio_preparation),summary:saved.summary,title:saved.title,story_format:'audio'},activeStory,{});draft=JSON.parse(localStorage.getItem(key()));}}
  if(!draft||!Array.isArray(draft.lines)||!draft.lines.length)draft={title:'',speed:1,pitch:0,pause:0.35,lines:[blank()]};
  draft={title:'',speed:1,pitch:0,pause:0.35,...draft};
  // Each visit starts on CPU; a GPU is used only after an explicit selection.
  draft.compute='cpu';
  if(!audioModels.some(m=>m.id===draft.model))draft.model=audioModels[0].id;
  if(!readAudioModelSaved()&&audioModels.some(m=>m.id===modelProfiles.selected.voice))draft.model=modelProfiles.selected.voice;
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
  draft.character_count=draft.presentation==='single'?1:Math.max(2,Math.min(20,draft.character_count||draft.speakers.length));
  normalizeSpeakers();
  save();
 }
 function normalizeSpeakers(){
  draft.speakers.forEach((item,index)=>{if(!model().languages.includes(item.language))item.language=model().languages.includes('Hindi')?'Hindi':model().languages[0];if(!model().voices.some(v=>v.id===item.voice))item.voice=window.EccoAudioDirection.defaultVoice(model(),item.language,index);if(!['neutral','happy','sad','angry','disgust','fear','surprise','enunciated','confused','whisper'].includes(item.emotion))item.emotion='neutral';if(!model().languages.includes(item.mixed_language)||item.mixed_language===item.language)item.mixed_language='';});
 }
 function changeModel(value){
  for(const item of draft.speakers){item.model_settings||={};item.model_settings[draft.model]={language:item.language,voice:item.voice,emotion:item.emotion,mixed_language:item.mixed_language};if(item.model_settings[value])Object.assign(item,item.model_settings[value]);}
  draft.model=value;modelProfiles.selected.voice=value;saveModelProfiles();normalizeSpeakers();save();drawControls();showComputeStatus();clearPreview();q('#audio-voice-preview-dialog')?.close();
 }
 const modelParameters=()=>draft.model==='chatterbox'?{exaggeration:Number(draft.exaggeration??draft.planned_expressiveness??0.5)}:{};
 function save(){localStorage.setItem(key(),JSON.stringify(draft));}
 const options=(values,value)=>values.map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(v.charAt(0).toUpperCase()+v.slice(1))}</option>`).join('');
 const speakerOptions=value=>(activeSpeakers().some(s=>s.id===value)?'':'<option value="" selected disabled>Choose an active character</option>')+activeSpeakers().map(s=>`<option value="${esc(s.id)}" ${s.id===value?'selected':''}>${esc(s.name||'Speaker')}</option>`).join('');
 function drawLines(){
  const single=draft.presentation==='single';
  q('#audio-lines').innerHTML=`<label>Opening Title<input data-opening-text maxlength="300" value="${esc(draft.opening_text||'')}" placeholder="Optional spoken opening title"></label><label>Pause After Opening Title (Seconds)<input data-opening-pause type="number" min="0" max="10" step="0.1" value="${draft.opening_pause??2}"></label>${single?'':`<label>Opening Speaker<select data-opening-speaker>${speakerOptions(draft.opening_speaker||draft.speakers[0].id)}</select></label>`}`+(single?`<div class="audio-line" data-line="0"><label>Spoken script<textarea data-field="text" data-single-script dir="auto" maxlength="4000" rows="6" placeholder="Enter exactly what the narrator should say. Use Generate script with AI to turn instructions into a script.">${esc(draft.single_text)}</textarea></label></div>`:draft.lines.map((line,index)=>`<fieldset class="audio-line" data-line="${index}"><div class="audio-turn-heading">${line.scene_title?`<span style="color:var(--accent)">${esc(line.scene_title)}</span>`:''}<label>Speaker<select data-turn-speaker>${speakerOptions(line.speaker_id)}</select></label><button type="button" class="secondary small" data-remove-turn="${index}" ${draft.lines.length===1?'disabled':''}>Remove turn</button></div><label>${esc(speaker(line.speaker_id).name||'Speaker')}’s words<textarea data-field="text" dir="auto" maxlength="4000" rows="3" placeholder="What should this speaker say?">${esc(line.text||'')}</textarea></label></fieldset>`).join(''));
  const add=q('#add-audio-line');add.hidden=single;add.textContent='Add speaker turn';add.disabled=draft.lines.length>=20;
  q('#audio-lines').oninput=e=>{if(e.target.matches('[data-opening-text],[data-opening-pause]')){draft[e.target.matches('[data-opening-text]')?'opening_text':'opening_pause']=e.target.matches('[data-opening-text]')?e.target.value:Number(e.target.value);save();return;}const root=e.target.closest('[data-line]');if(!root)return;const i=Number(root.dataset.line);if(e.target.matches('[data-field=text]')){if(single)draft.single_text=e.target.value;else{draft.lines[i].text=e.target.value;delete draft.lines[i].performance;}save();}};
  q('#audio-lines').onchange=e=>{if(e.target.matches('[data-opening-speaker]')){draft.opening_speaker=e.target.value;save();return;}if(!e.target.matches('[data-turn-speaker]'))return;const turn=draft.lines[Number(e.target.closest('[data-line]').dataset.line)];turn.speaker_id=e.target.value;delete turn.performance;save();drawLines();drawControls();};
  q('#audio-lines').onclick=e=>{const button=e.target.closest('[data-remove-turn]');if(!button)return;draft.lines.splice(Number(button.dataset.removeTurn),1);save();drawLines();drawControls();};
  window.EccoGeneration?.audioLines(q('#audio-form'));
  drawCharacters();reviewScript();
 }
 function setCharacterCount(value){
  const count=Number(value);
  if(!Number.isInteger(count)||count<1||count>20)throw Error('Choose 1–20 characters for this recording.');
  const previous=draft.presentation;
  while(draft.speakers.length<count){const item=newSpeaker(draft.speakers.length,{language:draft.speakers[0].language});draft.speakers.push(item);}
  draft.character_count=count;draft.presentation=count===1?'single':'conversation';draft.characters_configured=true;
  if(previous!==draft.presentation){
   if(count===1&&!draft.single_text.trim())draft.single_text=draft.lines.map(l=>l.text||'').join('\n\n');
   if(count>1&&!draft.lines.some(l=>l.text?.trim()))draft.lines=[{text:draft.single_text,speaker_id:draft.speakers[0].id}];
  }
  normalizeSpeakers();save();drawLines();drawControls();
 }
 function changePresentation(value){
  if(value===draft.presentation)return;
  if(value==='conversation'&&draft.speakers[0].name==='Narrator')draft.speakers[0].name='Host';
  setCharacterCount(value==='single'?1:Math.max(2,draft.speakers.length));
 }
 function drawCharacters(root){
  const roots=root?[root]:[...document.querySelectorAll('[data-audio-characters]')];
  for(const area of roots){
   area.innerHTML='<label>Number of Characters<input type="number" min="1" max="20" step="1" required data-character-count value="'+activeSpeakers().length+'"></label><div class="audio-character-names">'+activeSpeakers().map((s,i)=>'<label>Character '+(i+1)+'<input data-character-name="'+esc(s.id)+'" maxlength="60" value="'+esc(s.name||'')+'" placeholder="'+(i===0?'Narrator or Host':i===1?'Guest':'Character name')+'"></label>').join('')+'</div><p class="help">Choose each character’s voice and delivery in Additional Controls.</p>';
   area.querySelector('[data-character-count]').onchange=e=>{try{setCharacterCount(e.target.value);}catch(error){e.target.value=activeSpeakers().length;notice(error.message,true);}};
   area.querySelectorAll('[data-character-name]').forEach(input=>{
    input.oninput=()=>{speaker(input.dataset.characterName).name=input.value;draft.characters_configured=true;save();for(const other of document.querySelectorAll('[data-character-name]'))if(other!==input&&other.dataset.characterName===input.dataset.characterName)other.value=input.value;};
    input.onchange=()=>{input.oninput();drawLines();drawControls();};
   });
  }
 }
 function genreDefaults(value){
  if(draft.characters_configured||turns().some(t=>t.text?.trim()))return;
  const conversation=['Podcast','Interview','Casual Conversation'].includes(value);
  draft.speakers[0].name=conversation?'Host':value==='News'?'Newsreader':'Narrator';
  setCharacterCount(conversation?2:1);draft.characters_configured=false;save();
 }
 const speakerIcon='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg>';
 const deliveryStyles=['Voice Default','Storyteller','Conversational','Newsreader','Dramatic','Calm','Custom'];
 function drawControls(root=q('[data-delivery-controls]')){
  if(!root||!draft)return;normalizeSpeakers();
  if(!activeSpeakers().some(s=>s.id===draft.selected_speaker))draft.selected_speaker=draft.speakers[0].id;
  const selected=speaker(draft.selected_speaker),choices=dialects[selected.language]||[];
  const characterSelect=(label,field,values,unit='')=>`<label>${label}<select data-speaker-field="${field}"><option value="">Recording default (${draft[field]??(field==='exaggeration'?0.5:'')}${unit})</option>${values.map(v=>`<option value="${v}" ${Number(selected[field])===v&&selected[field]!==undefined?'selected':''}>${v}${unit}</option>`).join('')}</select></label>`;
  root.innerHTML=`<label>Audio Format<select data-audio-presentation><option value="single" ${draft.presentation==='single'?'selected':''}>Single Voice</option><option value="conversation" ${draft.presentation==='conversation'?'selected':''}>Conversation</option></select></label><div class="audio-speaker-tabs" role="tablist" aria-label="Characters">${activeSpeakers().map((s,i)=>`<button id="audio-character-tab-${i}" type="button" class="secondary" role="tab" data-speaker-tab="${esc(s.id)}" aria-selected="${s.id===selected.id}" aria-controls="audio-character-settings" tabindex="${s.id===selected.id?0:-1}">${esc(s.name||'Character '+(i+1))}</button>`).join('')}</div><div id="audio-character-settings" role="tabpanel" aria-labelledby="audio-character-tab-${activeSpeakers().indexOf(selected)}" data-speaker-panel></div>`;
  const panel=root.querySelector('[data-speaker-panel]');panel.dataset.speaker=selected.id;
  panel.innerHTML=`<label>Character Name<input data-speaker-field="name" maxlength="60" value="${esc(selected.name)}"></label><div class="audio-voice-row"><label>Voice<select data-speaker-field="voice">${model().voices.map(v=>`<option value="${v.id}" ${selected.voice===v.id?'selected':''}>${v.name}</option>`).join('')}</select></label><button type="button" class="secondary audio-voice-preview" data-preview-voice aria-label="Preview selected voice" title="Preview selected voice">${speakerIcon}<span>Preview</span></button></div><div class="generation-filter-row"><label>Delivery Style<select data-speaker-field="delivery_style">${options(deliveryStyles,selected.delivery_style||'Voice Default')}</select></label><label>Emotion<select data-speaker-field="emotion">${options(['neutral','happy','sad','angry','fear','surprise','confused','whisper'],selected.emotion)}</select></label></div><div class="generation-filter-row">${characterSelect('Pitch','pitch',[-4,-2,0,2,4],' semitones')}${characterSelect('Speed','speed',[0.75,0.9,1,1.1,1.25,1.5],'×')}${characterSelect('Pause Before Speaking','pause',[0,0.2,0.35,0.5,0.75,1,2],' sec')}</div>${model().expressiveness?characterSelect('Expressiveness','exaggeration',[0.3,0.5,0.6,0.7,0.8]):''}<details class="generation-settings"><summary>Language and Accent</summary><div class="generation-settings-body"><div class="generation-filter-row"><label>Language<select data-speaker-field="language">${options(model().languages,selected.language)}</select></label><label>Mix With<select data-speaker-field="mixed_language"><option value="">None</option>${options(model().languages.filter(l=>l!==selected.language),selected.mixed_language)}</select></label></div><label>Dialect / Accent<select data-speaker-field="dialect"><option value="">Voice default</option>${options(choices,selected.dialect)}<option value="other" ${selected.dialect==='other'?'selected':''}>Other</option></select></label><label data-custom-dialect ${selected.dialect==='other'?'':'hidden'}>Accent Instructions<input data-speaker-field="custom_dialect" maxlength="160" value="${esc(selected.custom_dialect||'')}"></label></div></details><label>Extra Speaking Instructions<textarea data-speaker-field="delivery" maxlength="1000" rows="3" placeholder="Tell the story warmly; pause before surprises; keep the fear gentle for children.">${esc(selected.delivery||selected.style||'')}</textarea></label><p class="help" data-character-summary></p>`;
  const summary=()=>{panel.querySelector('[data-character-summary]').textContent=(selected.name||'Character')+' · '+(model().voices.find(v=>v.id===selected.voice)?.name||'Voice')+' · '+(selected.delivery_style||'Voice Default')+' · Pitch '+(selected.pitch??draft.pitch??0)+' · Speed '+(selected.speed??draft.speed??1)+'×';};summary();
  root.querySelector('[data-audio-presentation]').onchange=e=>changePresentation(e.target.value);
  const selectTab=id=>{draft.selected_speaker=id;save();drawControls(root);root.querySelector('[data-speaker-tab="'+id+'"]').focus();};
  root.querySelectorAll('[data-speaker-tab]').forEach((button,index)=>{button.onclick=()=>selectTab(button.dataset.speakerTab);button.onkeydown=event=>{const cast=activeSpeakers();let next;if(event.key==='ArrowRight')next=(index+1)%cast.length;if(event.key==='ArrowLeft')next=(index+cast.length-1)%cast.length;if(event.key==='Home')next=0;if(event.key==='End')next=cast.length-1;if(next!==undefined){event.preventDefault();selectTab(cast[next].id);}};});
  const numeric=['speed','pitch','pause','exaggeration'];
  const change=e=>{const field=e.target.dataset.speakerField;if(!field)return;if(numeric.includes(field)){if(e.target.value==='')delete selected[field];else selected[field]=Number(e.target.value);}else selected[field]=e.target.value;if(field==='emotion')selected.emotion_override=true;if(field==='voice')selected.voice_selected=true;delete draft.delivery_signature;save();summary();if(field==='name'){const tab=root.querySelector('[data-speaker-tab="'+selected.id+'"]');tab.textContent=selected.name||'Character';}};
  panel.oninput=change;panel.onchange=e=>{change(e);if(e.target.dataset.speakerField==='language'){selected.dialect='';selected.custom_dialect='';if(selected.mixed_language===selected.language)selected.mixed_language='';save();drawControls(root);}if(e.target.dataset.speakerField==='dialect')panel.querySelector('[data-custom-dialect]').hidden=selected.dialect!=='other';};
  panel.querySelector('[data-preview-voice]').onclick=()=>previewVoice(selected);
 }
 function splitText(text){
  const chunks=[];let rest=text.trim();
  while(rest.length>500){let cut=Math.max(rest.lastIndexOf('\n',500),rest.lastIndexOf(' ',500));if(cut<100)cut=500;chunks.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();}
  if(rest)chunks.push(rest);return chunks;
 }
 function requestLines(){
  if(turns().some(t=>!activeSpeakers().some(s=>s.id===t.speaker_id)))throw Error('Assign every script turn to an active character before generating.');
  if(turns().some(t=>!t.text?.trim()))throw Error('Add the script for each speaker turn in Prompt.');
  if(turns().reduce((n,t)=>n+t.text.length,0)+(draft.opening_text||'').length>4000)throw Error('Keep the complete script within 4,000 characters.');
  const lines=turns().flatMap(t=>{const s=speaker(t.speaker_id);return splitText(t.text).map((text,i)=>({text,voice:s.voice,language:s.language,...window.EccoAudioDirection.lineControls(t,s,model()),...Object.fromEntries(['speed','pitch','exaggeration'].filter(k=>s[k]!==undefined&&(k!=='exaggeration'||model().expressiveness)).map(k=>[k,s[k]])),...(s.pause!==undefined?{pause_before:s.pause}:{}),...(i?{pause_before:0}:{})}));});
  if(draft.opening_text?.trim()){
   const s=draft.presentation==='single'?draft.speakers[0]:speaker(draft.opening_speaker),pause=Number(draft.opening_pause??2);if(!Number.isFinite(pause)||pause<0||pause>10)throw Error('Choose a title pause between 0 and 10 seconds.');
   lines[0].pause_before=pause;lines.unshift({text:draft.opening_text.trim(),voice:s.voice,language:s.language,...window.EccoAudioDirection.lineControls({performance:draft.opening_performance},s,model()),...Object.fromEntries(['speed','pitch','exaggeration'].filter(k=>s[k]!==undefined&&(k!=='exaggeration'||model().expressiveness)).map(k=>[k,s[k]]))});
  }
  if(lines.length>20)throw Error('Shorten the script or combine some speaker turns. This model accepts up to 20 speech segments.');
  return lines;
 }
 function applyCharacterCompatibility(request,target){
  const keys=['speed','pitch',...(request.model==='chatterbox'?['exaggeration']:[])];
  let needsUpdate=false;
  for(const key of keys){const values=new Set(request.lines.map(line=>line[key]??request[key]));if(values.size===1){request[key]=[...values][0];request.lines.forEach(line=>delete line[key]);}else needsUpdate=true;}
  if(needsUpdate){if(target?.character_controls_version!==1)throw Error('This audio service needs the character-controls update to apply different pitch, speed or expressiveness per character. Your selections are saved.');request.character_controls_version=1;}
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
  if(selectedScenes().length!==(draft.source_scenes||[]).length){notice('A selected scene changed. Reselect scenes before generating.',true);return;}
  (window.EccoAudioJourney?.openAudio||window.EccoAudioScript.open)({
   target:activeStory,form:q('#audio-form'),getDraft:()=>draft,save,
   characters:()=>activeSpeakers(),model,scenes:selectedScenes,sceneSnapshot:()=>JSON.stringify(boardScenes()),
   drawCharacters,
   apply(plan,brief,cast){
    if(cast){draft.speakers=cast;draft.character_count=cast.length;draft.presentation=cast.length===1?'single':'conversation';draft.characters_configured=true;draft.title=brief.title;draft.genre=brief.genre;draft.guided_preparation={...brief,plan};q('#audio-form [name=title]').value=draft.title;q('#audio-form [name=genre]').value=draft.genre;}
    draft.sound_design=brief.sound_design;draft.script_brief=brief;draft.script_instructions=brief.instructions;draft.opening_text=plan.opening?.text||'';
    draft.opening_performance=plan.opening?.performance;draft.planned_expressiveness=plan.expressiveness;delete draft.delivery_signature;draft.opening_speaker=plan.opening?.character_id||draft.speakers[0].id;draft.opening_pause=brief.opening_pause;
    draft.lines=plan.segments.map(part=>({text:part.text,speaker_id:part.character_id,performance:part.performance,...(part.scene_number?{scene_title:selectedScenes().find(s=>s.scene_number===part.scene_number)?.title}:{} )}));
    draft.single_text=draft.lines.map(l=>l.text).join('\n\n');
    for(const character of activeSpeakers()){character.language=brief.language;if(character.mixed_language===brief.language)character.mixed_language='';}
    normalizeSpeakers();save();drawLines();drawControls();
   }
  });
 }

 let preview=null;
 function clearPreview(){if(!preview)return;clearTimeout(preview.timer);const player=preview.dialog.querySelector('audio');if(player?.src){player.pause();player.removeAttribute('src');}preview=null;}
 function previewVoice(selected){
  clearPreview();q('#audio-voice-preview-dialog')?.remove();
  const d=document.createElement('dialog');d.id='audio-voice-preview-dialog';d.className='generation-dialog';d.setAttribute('aria-label','Voice Preview');
  const settings={model:draft.model,compute:draft.compute,...modelParameters(),genre:draft.genre,speed:selected.speed??draft.speed,pitch:selected.pitch??draft.pitch,...(draft.model==='chatterbox'?{exaggeration:selected.exaggeration??draft.exaggeration??draft.planned_expressiveness??0.5}:{}),pause:0,story_id:activeStory,title:'Voice preview · '+(selected.name||'Narrator')},voice={voice:selected.voice,language:selected.language,...window.EccoAudioDirection.lineControls({},selected,model())},character=JSON.parse(JSON.stringify(selected)),previewModel=model();
  d.innerHTML=`<div class="form"><div class="section-head"><h2>Voice Preview</h2><button type="button" class="secondary" data-close>Close</button></div><p>${esc(model().voices.find(v=>v.id===selected.voice)?.name)} · ${esc(selected.language)} · ${esc(selected.emotion)}</p><label>Preview text<textarea maxlength="300" rows="3" dir="auto" placeholder="Enter a short sample in the language you want to hear."></textarea></label><button type="button" id="audio-voice-preview-generate">Generate preview</button><p role="status"></p><audio controls preload="metadata" aria-label="Voice preview playback" hidden></audio></div>`;
  document.body.append(d);const token={dialog:d,story:activeStory,timer:null};preview=token;
  const valid=()=>preview===token&&d.open&&d.isConnected&&page==='audio'&&activeStory===token.story;
  d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>{if(preview===token)clearPreview();d.remove();},{once:true});
  const button=d.querySelector('#audio-voice-preview-generate'),status=d.querySelector('[role=status]'),player=d.querySelector('audio');
  button.onclick=async()=>{
   if(button.disabled)return;
   const text=d.querySelector('textarea').value.trim();if(!text){status.textContent='Enter some preview text first.';return;}
   if(!serviceReady()){window.EccoStorage?.open();return;}
   const current=service,started=Date.now();button.disabled=true;button.setAttribute('aria-busy','true');button.innerHTML='<span class="generation-spinner" aria-hidden="true"></span>Generating Preview…';player.hidden=true;player.removeAttribute('src');status.textContent='Generating voice preview…';
   const fail=error=>{if(valid()){status.textContent=error.message||'Could not create the voice preview.';button.disabled=false;button.setAttribute('aria-busy','false');button.textContent='Generate preview';}};
   try{
    await requireCompute(settings.compute,settings.model);if(!valid()||current!==service)return;
    let previewLine={text,...voice};if(character.delivery||character.style||character.delivery_style&&character.delivery_style!=='Voice Default'||!previewModel.emotions&&character.emotion!=='neutral'){if(!window.EccoAI?.enabled)throw Error('Connect OpenAI to preview the character’s speaking instructions.');status.textContent='Preparing Delivery…';const plan=await window.EccoAudioDirection.refine({plan:{opening:null,segments:[{character_id:character.id,text}]},cast:[character],brief:{...draft.script_brief,genre:settings.genre,language:character.language},model:previewModel,directionOnly:true,request:api,assertCurrent:()=>{if(!valid()||current!==service)throw Error('The preview changed. Try again.');}});previewLine={text,...voice,...window.EccoAudioDirection.lineControls(plan.segments[0],character,previewModel)};if(settings.model==='chatterbox'&&character.exaggeration===undefined&&plan.expressiveness!==null)settings.exaggeration=plan.expressiveness;}const job=await current.generate({...settings,lines:[previewLine]});if(!valid()||current!==service)return;
    const check=async()=>{if(!valid()||current!==service)return;try{
     const result=await current.job(job.id);if(!valid()||current!==service)return;
     if(result.status==='error')throw Error(result.error||'Voice preview failed.');
     if(result.status==='done'){
      const id=result.asset_id||result.asset_ids?.[0]||(Array.isArray(result.result)?result.result[0]:result.result);if(!id)throw Error('The preview completed without an audio file.');
      const url=await current.mediaURL(id);if(!valid()||current!==service)return;const parsed=new URL(url);if(parsed.protocol!=='https:'&&!(parsed.protocol==='blob:'&&parsed.origin===location.origin))throw Error('Could not play the returned audio URL.');
      player.src=url;player.hidden=false;status.textContent='Preview ready. Press Play to listen.';button.disabled=false;button.setAttribute('aria-busy','false');button.textContent='Generate preview';return;
     }
     if(Date.now()-started>300000)throw Error('Preview is still processing. Check Activity before generating another.');
     status.textContent=result.progress||'Generating voice preview…';token.timer=setTimeout(check,1500);
    }catch(error){fail(error);}};
    await check();
   }catch(error){fail(error);}
  };d.showModal();d.querySelector('textarea').focus();
 }
 function reviewScript(){
  window.EccoAudioReviewScript?.mount({root:q('#audio-final-script-panel'),generate:generateScript,getCast:()=>activeSpeakers(),getBrief:()=>({...draft.script_brief,genre:draft.genre}),getPlan:()=>({opening:draft.opening_text?.trim()?{text:draft.opening_text,character_id:draft.opening_speaker||draft.speakers[0].id,performance:draft.opening_performance}:null,segments:turns().map(t=>({text:t.text,character_id:t.speaker_id,performance:t.performance}))}),setPlan:plan=>{draft.lines=plan.segments.map(p=>({text:p.text,speaker_id:p.character_id,performance:p.performance}));draft.single_text=plan.segments.map(p=>p.text).join('\n\n');draft.opening_text=plan.opening?.text||'';draft.opening_performance=plan.opening?.performance;delete draft.delivery_signature;save();drawLines();}});
  window.EccoSoundDesign?.mount({root:q('#audio-final-script-panel'),getPlan:()=>draft.sound_design,setPlan:plan=>{draft.sound_design=plan;save();},getLines:requestLines,getBrief:()=>({...draft.script_brief,genre:draft.genre}),mediaURL:async id=>{if(!service)throw Error('Connect workspace storage to preview sounds.');return service.mediaURL(id);}});
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
 window.EccoAudioStudio={generateScript,characters:drawCharacters,mountScenePicker,controls:drawControls,aiContext,importScript,connect(adapter){
  if(!adapter||adapter.storageIndependentOfGPU!==true||!['list','generate','job','mediaURL','download'].every(name=>typeof adapter[name]==='function'))throw Error('An authenticated, GPU-independent audio service is required.');
  service=adapter;computeStatus=null;computeChecked=0;recordings=[];lastJob=null;signature='';update();poll();
 },disconnect(){clearPreview();q('#audio-voice-preview-dialog')?.close();service=null;computeStatus=null;computeChecked=0;recordings=[];lastJob=null;signature='';update();}};
 function update(){
  if(page!=='audio'||!q('#audio-form'))return;
  if(story!==activeStory){render();return;}
  showComputeStatus();reviewScript();
  const button=q('#generate-audio');
  const currentId=window.EccoGeneration?.jobId('audio',activeStory,lastJob);
  const job=lastJob?.id===currentId?lastJob:state?.records.find(r=>r.id===currentId);
  const busy=submitting||['queued','running'].includes(job?.status);
  const label=submitting?submissionLabel:/reconnect/i.test(job?.progress||'')?'Waiting for worker…':job?.status==='queued'?'Queued…':'Generating audio…';
  setGenerationBusy(button,busy,label,'Generate audio');const spinner=q('[data-audio-progress-spinner]');if(spinner)spinner.hidden=!busy;
  q('#audio-job-status').textContent=submitting?submissionLabel:job?(job.progress||{queued:'Queued',running:'Generating speech',done:'Audio saved.',failed:'Generation failed',error:'Generation failed'}[job.status]||job.status)+(job.error?' · '+job.error:''):'';
  const list=window.EccoGeneration?.results('audio',audioAssets(),activeStory,lastJob)||[],next=JSON.stringify(list);
  if(next!==signature){
   signature=next;const empty=q('[data-audio-review-empty]');if(empty)empty.hidden=!!list.length;
   q('#audio-gallery')?.remove();
   if(list.length){(q('#audio-review-panel')||q('.audio-workspace')).insertAdjacentHTML('beforeend',`<div class="cards" id="audio-gallery">${list.map(audioCard).join('')}</div>`);hydrateAudio();}
  }

 }
 function render(){
  clearPreview();q('#audio-voice-preview-dialog')?.close();load();signature='';
  q('#page').innerHTML=`<section class="audio-studio"><div class="grid audio-workspace"><form id="audio-form" class="panel form"><div class="audio-model-controls model-summary"><label>Audio model<select name="model">${audioModels.map(model=>`<option value="${esc(model.id)}" ${draft.model===model.id?'selected':''}>${esc(model.name)}</option>`).join('')}</select></label><label>Genre<select name="genre">${options(genres,draft.genre)}</select></label></div><label>Recording title<input name="title" maxlength="160" value="${esc(draft.title)}" placeholder="Scene 1 · opening dialogue"></label><div id="audio-lines"></div><button type="button" class="secondary" id="add-audio-line">Add speaker turn</button><div class="audio-output-controls" hidden><input type="hidden" name="speed" value="${draft.speed}"><input type="hidden" name="pitch" value="${draft.pitch}"><input type="hidden" name="pause" value="${draft.pause}"></div><div class="row"><button id="generate-audio">Generate audio</button><span class="help">Draft saved in this browser · up to 4,000 characters</span></div><p id="audio-job-status" role="status"></p></form></div></section>`;
  q('#audio-form').insertAdjacentHTML('afterbegin',`<div data-audio-compute><select name="compute" aria-label="Audio compute" aria-describedby="audio-compute-status"><option value="">Checking connected compute…</option></select><p id="audio-compute-status" class="help" data-audio-compute-status role="status"></p></div>`);
  drawLines();
  q('#add-audio-line').onclick=()=>{if(draft.presentation==='conversation'&&draft.lines.length<20){const previous=draft.lines.at(-1).speaker_id,cast=activeSpeakers(),next=cast[(cast.findIndex(s=>s.id===previous)+1)%cast.length];draft.lines.push({text:'',speaker_id:next.id});save();drawLines();drawControls();}};
  q('#audio-form').addEventListener('input',e=>{if(e.target.name&&e.target.name!=='model'){draft[e.target.name]=['title','model','genre','compute'].includes(e.target.name)?e.target.value:Number(e.target.value);save();}});
  q('#audio-form').addEventListener('change',e=>{if(e.target.name==='model')changeModel(e.target.value);if(e.target.name==='genre'){draft.genre=e.target.value;genreDefaults(e.target.value);}if(e.target.name==='compute'){draft.compute=e.target.value;save();showComputeStatus();clearPreview();q('#audio-voice-preview-dialog')?.close();}});
  q('#audio-form').onsubmit=async e=>{
   e.preventDefault();save();
   if(submitting||q('#generate-audio').disabled)return;
   if(!serviceReady()){window.EccoStorage?.open();return;}
   let lines;try{lines=requestLines();}catch(error){notice(error.message,true);q('[data-open-prompt]')?.click();return;}
   const requestedStory=activeStory;submitting=true;submissionLabel='Submitting…';q('[data-audio-tab=progress]')?.click();update();
   try{
    const current=service,baseline=JSON.stringify(draft),form=q('#audio-form');
    await requireCompute(draft.compute,draft.model);
    if(current!==service||activeStory!==requestedStory||!form.isConnected||JSON.stringify(draft)!==baseline)throw Error('The script or settings changed. Generate again with the current draft.');
    if(draft.sound_design?.enabled&&draft.sound_design.cues?.length&&computeStatus?.compute?.[draft.compute]?.sound_design_version!==1)throw Error('Sound Design is saved. Update the audio service before generating music and effects.');
    const hasDirection=activeSpeakers().some(s=>s.delivery||s.style||s.delivery_style&&s.delivery_style!=='Voice Default'||!model().emotions&&s.emotion!=='neutral');
    const signature=JSON.stringify([turns(),activeSpeakers(),draft.genre,draft.model,draft.opening_text]);
    if(hasDirection&&draft.delivery_signature!==signature){
     if(!window.EccoAI?.enabled)throw Error('Connect OpenAI to apply the characters’ speaking instructions. Your draft is saved.');
     submissionLabel='Preparing Delivery…';update();
     const existing={opening:draft.opening_text?.trim()?{text:draft.opening_text.trim(),character_id:draft.opening_speaker||draft.speakers[0].id}:null,segments:turns().map(t=>({text:t.text.trim(),character_id:t.speaker_id}))};
     const directed=await window.EccoAudioDirection.refine({plan:existing,cast:activeSpeakers(),brief:{...draft.script_brief,genre:draft.genre,language:draft.speakers[0].language},model:model(),directionOnly:true,request:api,assertCurrent:()=>{if(current!==service||activeStory!==requestedStory||!form.isConnected||JSON.stringify(draft)!==baseline)throw Error('The script or character settings changed. Generate again with the current draft.');}});
     draft.lines=directed.segments.map(p=>({text:p.text,speaker_id:p.character_id,performance:p.performance}));draft.opening_performance=directed.opening?.performance;draft.planned_expressiveness=directed.expressiveness;draft.delivery_signature=JSON.stringify([turns(),activeSpeakers(),draft.genre,draft.model,draft.opening_text]);save();lines=requestLines();
    }
    const sounds=window.EccoSoundDesign?.prepare(draft.sound_design,lines,window.EccoAudioLibrary?.items()||[])||{lines};
    if(sounds.sound_design_version&&computeStatus?.compute?.[draft.compute]?.sound_design_version!==1)throw Error('Sound Design is saved. Update the audio service before generating music and effects.');
    const request={model:draft.model,compute:draft.compute,...modelParameters(),genre:draft.genre,title:draft.title,speed:draft.speed,pitch:draft.pitch,pause:draft.pause,...sounds,story_id:requestedStory};
    applyCharacterCompatibility(request,computeStatus?.compute?.[draft.compute]);
    if(current!==service||activeStory!==requestedStory||!form.isConnected)throw Error('The workspace changed. Generate again from the current story.');
    submissionLabel='Submitting…';update();const job=await current.generate(request);window.EccoGeneration?.trackJob('audio',requestedStory,job);localStorage.setItem('ecco-audio-job:'+requestedStory,job.id);if(activeStory===requestedStory)lastJob=job;update();refresh();notice('Audio queued. You can keep working while it generates.');await poll();
   }
   catch(error){notice(error.message,true);}
   finally{submitting=false;update();}
  };
  if(window.EccoGeneration){window.EccoGeneration.mount(q('#audio-form'),'audio');const review=document.createElement('div');review.id='audio-review-results';review.innerHTML='<div class="section-head"><h2>Audio</h2></div><div class="audio-speaker-tabs" role="tablist" aria-label="Audio workspace"><button type="button" class="secondary" role="tab" id="audio-tab-script" data-audio-tab="script" aria-controls="audio-final-script-panel" aria-selected="true">Final Script</button><button type="button" class="secondary" role="tab" id="audio-tab-progress" data-audio-tab="progress" aria-controls="audio-progress-panel" aria-selected="false" tabindex="-1">Progress</button><button type="button" class="secondary" role="tab" id="audio-tab-review" data-audio-tab="review" aria-controls="audio-review-panel" aria-selected="false" tabindex="-1">Review</button></div><div id="audio-final-script-panel" role="tabpanel" aria-labelledby="audio-tab-script"></div><div id="audio-progress-panel" role="tabpanel" aria-labelledby="audio-tab-progress" hidden><span class="generation-spinner" data-audio-progress-spinner aria-hidden="true" hidden></span><p class="help">Generation status appears here after you submit.</p></div><div id="audio-review-panel" role="tabpanel" aria-labelledby="audio-tab-review" hidden><p class="help" data-audio-review-empty>Your newly generated recording will appear here.</p></div>';q('.audio-workspace').append(review);q('#audio-progress-panel').append(q('#audio-job-status'));const tabs=[...review.querySelectorAll('[data-audio-tab]')];tabs.forEach((tab,index)=>{tab.onclick=()=>{tabs.forEach(t=>{const selected=t===tab;t.setAttribute('aria-selected',String(selected));t.tabIndex=selected?0:-1;document.getElementById(t.getAttribute('aria-controls')).hidden=!selected;});};tab.onkeydown=e=>{const next=e.key==='ArrowRight'?(index+1)%tabs.length:e.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:null;if(next!==null){e.preventDefault();tabs[next].click();tabs[next].focus();}};});}
  mountScenePicker();update();poll();
 }
 const oldNavigate=navigate;
 navigate=function(p){
  if(p!=='audio'){q('#audio-script-instructions')?.close();clearPreview();q('#audio-voice-preview-dialog')?.close();return oldNavigate.apply(this,arguments);}
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









