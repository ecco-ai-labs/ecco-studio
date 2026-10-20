'use strict';
/* The video production path: model, avatar, style reference, speech, shots, direction, render. */
(()=>{
 const q=(s,r=document)=>r.querySelector(s);
 const read=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))||d;}catch{return d;}};
 const assets=kind=>state.records.filter(a=>a.kind==='asset'&&a.media===kind&&!a.deleted);
 const find=(id,kind)=>assets(kind).find(a=>a.id===id);
 const idsKey={image:'image_ids',video:'video_ids',audio:'audio_ids'};
 const title=a=>a?.title||'Untitled';
 function mount(){
  const form=q('#video-form'),ctx=form&&window.EccoGeneration?.context(form);
  if(!ctx||form.dataset.videoFlow)return;form.dataset.videoFlow='true';
  const story=activeStory,key='ecco-video-flow:'+story;
  const old=read('ecco-audio-video:'+story,{}),saved=read(key,null);
  const data=saved||{image_ids:ctx.data.reference_ids||[],video_ids:ctx.data.video_reference_ids||[],
   audio_ids:ctx.data.audio_reference_ids?.length?ctx.data.audio_reference_ids:(old.enabled&&old.audio_id?[old.audio_id]:[]),
   shots:old.shots||[],brief:ctx.data.prompt||'',directions:[],analyzed:''};
  if(!data.image_ids.length&&old.avatar_id)data.image_ids=[old.avatar_id];
  // Seed a new video workspace only from this story; never overwrite saved edits.
  if(!saved&&story){
   const audios=assets('audio').filter(a=>a.story_id===story);
   const lastJob=localStorage.getItem('ecco-audio-job:'+story);
   const latest=audios.filter(a=>a.job_id===lastJob);
   if(!data.audio_ids.length){if(latest.length===1)data.audio_ids=[latest[0].id];else if(audios.length===1)data.audio_ids=[audios[0].id];}
   const boardDraft=read('ecco-board-draft:'+story,null);
   const board=boardDraft?.scenes?.length?boardDraft:state.records.filter(b=>b.kind==='board'&&!b.deleted&&b.story_id===story).sort((a,b)=>b.created-a.created)[0];
   if(!data.image_ids.length)data.image_ids=[...new Set((board?.scenes||[]).map(s=>s.image_id).filter(id=>find(id,'image')))];
  }

  const model=q('#job-model',form),footer=q('.generation-footer',form),button=q('#generate-video',form),status=q('#video-status',form);
  // Preserve the shared model controls; retire the overlapping reference/prompt controls.
  for(const name of ['references','prompt','controls'])q('[data-section="'+name+'"]',form).hidden=true;
  q('[aria-label="Dialogue audio"]',form)?.closest('label')?.parentElement.remove();
  q('[data-section="model"] .generation-section-heading',form).textContent='1. Select model';
  const root=document.createElement('div');root.className='form';root.id='video-flow';form.insertBefore(root,footer);
  const section=(n,t,body)=>'<section class="generation-section form" data-step="'+n+'"><div class="generation-section-heading">'+n+'. '+t+'</div>'+body+'</section>';
  root.innerHTML=section(2,'Library','<div class="row"><select aria-label="Library" data-library><option value="image">Image Library</option><option value="video">Video Library</option><option value="audio">Audio Library</option></select><button type="button" class="secondary" data-browse>Browse library</button></div><div data-list="image" class="generation-selected"></div><div data-list="video" class="generation-selected"></div><div data-list="audio" class="form"></div><p class="help" data-audio-hint></p>')+
   section(3,'Audio script','<button type="button" class="secondary" data-open-script>Edit audio script</button><div hidden><p data-script-source></p><textarea aria-label="Audio script" data-transcript maxlength="4000"></textarea></div>')+
   section(4,'Shots','<label>Storyboard<select data-board aria-label="Storyboard"></select></label><details data-shot aria-label="Shots" class="generation-settings"></details><div data-shots class="form"></div><p data-timing class="help"></p>')+
   '<div data-directions hidden></div><p role="status" data-ai-status></p>';
  button.textContent='Generate video';
  const legacyBoard=q('[name="board_id"]',form);if(legacyBoard){legacyBoard.required=false;legacyBoard.closest('label').hidden=true;}
  let shotIndex=0;
  const persist=()=>{localStorage.setItem(key,JSON.stringify(data));};
  const totalAudio=()=>data.audio_ids.reduce((n,id)=>n+Number(find(id,'audio')?.seconds||find(id,'audio')?.duration||0),0);
  const activeShots=()=>data.shots.filter(s=>s.selected!==false);
  const promptShot=({motion,...shot})=>shot;
  const fingerprint=()=>JSON.stringify({prompt_version:2,model:model.value,images:data.image_ids,videos:data.video_ids,audio:data.audio_ids,shots:data.shots,brief:data.brief});
  function timing(){q('[data-timing]',root).textContent=activeShots().length+' shots · '+activeShots().reduce((n,s)=>n+Number(s.seconds||0),0).toFixed(2)+'s'+(data.audio_ids.length?' / '+totalAudio().toFixed(2)+'s speech':'');}
  function balance(){const shots=activeShots();if(!shots.length||!totalAudio())return;const each=Math.floor(totalAudio()/shots.length*1000)/1000;shots.forEach((s,i)=>s.seconds=i===shots.length-1?totalAudio()-each*(shots.length-1):each);}
  function newShot(i=0){return {title:'Shot '+(i+1),selected:true,image_id:data.image_ids[0]||'',seconds:3,motion:'Natural movement',eye:'Look toward camera; natural blinking',lip:'Synchronize with speech',camera_move:'Static',camera_angle:'Eye level',shot_size:'Medium close-up'};}
  function boardOptions(){
   const sid=find(data.audio_ids[0],'audio')?.story_id||story;
   const list=state.records.filter(b=>b.kind==='board'&&!b.deleted&&(b.story_id===sid||b.story_id===story)).sort((a,b)=>b.created-a.created);
   const draft=read('ecco-board-draft:'+sid,null);if(draft?.scenes?.length)list.unshift({...draft,id:'draft:'+sid,title:(draft.title||'Storyboard')+' · current draft',story_id:sid});
   return list;
  }
  function drawBoards(){
   const select=q('[data-board]',root),list=boardOptions(),previous=select.value||data.board_id;
   select.replaceChildren();if(!list.length)select.add(new Option('No saved storyboards',''));
   for(const b of list)select.add(new Option((b.title||'Storyboard')+' · '+b.scenes.length+' shots'+(b.created?' · '+new Date(b.created*1000).toLocaleString():''),b.id));
   select.value=list.some(b=>b.id===previous)?previous:(list[0]?.id||'');
  }
  function loadBoard(){
   drawBoards();const board=boardOptions().find(b=>b.id===q('[data-board]',root).value);
   data.board_id=board?.id||'';
   data.shots=board?.scenes?.length?board.scenes.map((s,i)=>({...newShot(i),...s,video_prompt:s.video_prompt??s.motion??'',selected:true,image_id:find(s.image_id,'image')?s.image_id:data.image_ids[0]||''})):[newShot()];
   for(const shot of data.shots)if(shot.image_id&&!data.image_ids.includes(shot.image_id))data.image_ids.push(shot.image_id);
   shotIndex=0;balance();data.directions=[];persist();drawShots();drawDirections();
  }
  function drawShots(){
   const box=q('[data-shots]',root);box.replaceChildren();
   const select=q('[data-shot]',root),wasOpen=select.open;select.replaceChildren();
   shotIndex=Math.max(0,Math.min(shotIndex,data.shots.length-1));
   const summary=document.createElement('summary');summary.textContent='Choose shots to include in video'+(activeShots().length?' · '+activeShots().length+' shots selected':'');select.append(summary);
   const choices=document.createElement('div');choices.className='form';choices.style.cssText='max-height:260px;overflow:auto;padding:8px;gap:6px';
   data.shots.forEach((s,i)=>{
    const line=document.createElement('div');line.style.cssText='display:flex;align-items:center;gap:8px';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=s.selected!==false;checkbox.style.cssText='width:14px;height:14px;min-width:14px;margin:0;flex:none';checkbox.setAttribute('aria-label','Include shot '+(i+1)+' in video');
    checkbox.onchange=()=>{s.selected=checkbox.checked;if(checkbox.checked)shotIndex=i;balance();persist();drawShots();drawDirections();};
    const edit=document.createElement('button');edit.type='button';edit.className='secondary small';edit.style.cssText='flex:1;text-align:left';edit.textContent=(i+1)+'. '+(s.title||'Shot '+(i+1));edit.setAttribute('aria-pressed',String(i===shotIndex));
    edit.onclick=()=>{checkbox.checked=!checkbox.checked;checkbox.dispatchEvent(new Event('change'));};
    line.append(checkbox,edit);choices.append(line);
   });
   const add=document.createElement('button');add.type='button';add.className='secondary small';add.textContent='+ Add shot';
   add.onclick=()=>{data.shots.push(newShot(data.shots.length));shotIndex=data.shots.length-1;data.directions=[];persist();select.open=false;drawShots();drawDirections();};
   choices.append(add);select.append(choices);select.open=wasOpen;
   data.shots.forEach((s,i)=>{if(activeShots().length!==1||s.selected===false)return;
    const row=document.createElement('fieldset');row.className='form';
    row.innerHTML='<label>Avatar for this shot<select data-image></select></label><div class="row"><button type="button" class="small secondary" data-remove-shot>Remove shot</button></div>';
    const image=q('[data-image]',row);image.add(new Option('Choose avatar',''));
    data.image_ids.forEach(id=>{const a=find(id,'image');if(a)image.add(new Option(title(a),id));});
    image.value=s.image_id||data.image_ids[0]||'';image.onchange=()=>{s.image_id=image.value;persist();};
    q('[data-remove-shot]',row).onclick=()=>{data.shots.splice(i,1);data.directions=[];persist();drawShots();drawDirections();};
    box.append(row);
   });
   const controls=document.createElement('button');controls.type='button';controls.className='secondary small';controls.textContent='Shot Controls';controls.dataset.shotControls='';
   controls.onclick=()=>{const selected=activeShots();if(selected.length!==1){window.EccoErrors.show(new Error(selected.length?'Select only one shot to edit Shot Controls.':'Select one shot to edit Shot Controls.'));return;}const shot=selected[0];shotIndex=data.shots.indexOf(shot);openShotControls(shot,shotIndex);};
   box.append(controls);timing();
  }
  const shotControlOptions=[
   ['eye','Eye movement / expression',['Look toward camera; natural blinking','Maintain eye contact','Look left','Look right','Look upward','Look downward','Follow a moving subject','Brief glance away','Wide-eyed surprise','Narrowed eyes','Eyes gently closed','Slow blinking']],
   ['lip','Mouth / delivery',['Synchronize with speech','Subtle lip movement','Clear articulation','Conversational delivery','Animated delivery','Whispering expression','Shouting expression','Soft smile while speaking','Serious delivery','Laughing between phrases','Closed mouth when silent','Minimal mouth movement']],
   ['camera_move','Camera movement',['Locked-off camera','Slow push-in','Slow pull-back','Pan left','Pan right','Tilt up','Tilt down','Track left','Track right','Orbit subject','Handheld movement','Crane upward']],
   ['camera_angle','Camera angle',['Eye level','Low angle','High angle','Overhead','Ground level','Dutch angle','Over the shoulder','Front view','Three-quarter view','Side profile','Rear view','Point of view']],
   ['shot_size','Framing',['Extreme close-up','Close-up','Medium close-up','Medium shot','Medium wide shot','Full-body shot','Wide shot','Extreme wide shot','Two-shot','Group shot','Centered composition','Rule of thirds']],
   ['head_movement','Head movement',['Keep steady','Subtle natural motion','Nod gently','Shake head gently','Tilt left','Tilt right','Turn left','Turn right']],
   ['emotion','Emotion',['Neutral','Happy','Confident','Curious','Thoughtful','Surprised','Sad','Angry','Excited','Concerned','Calm','Playful']],
   ['gestures','Hand gestures',['Hands still','Subtle conversational gestures','Open palms','Point toward subject','Wave','Fold hands','Count on fingers','Expressive gestures']],
   ['posture','Posture',['Preserve reference posture','Stand upright','Sit upright','Relaxed stance','Lean forward','Lean back','Walk slowly','Turn toward camera']],
   ['lighting','Lighting',['Preserve reference lighting','Soft daylight','Studio key light','Warm indoor light','Golden hour','Cool moonlight','Backlighting','Dramatic side light']],
   ['focus','Focus',['Keep subject sharp','Shallow depth of field','Deep focus','Focus on eyes','Rack focus to background','Rack focus to subject','Soft background','Follow subject focus']]
  ];
  function openShotControls(shot,index){
   const dialog=document.createElement('dialog');dialog.className='generation-dialog';dialog.id='video-shot-controls';dialog.setAttribute('aria-label','Shot controls');
   dialog.innerHTML='<form class="form"><div class="section-head"><h2>Shot controls</h2><button type="button" data-close aria-label="Close shot controls">×</button></div><label>Video prompt<textarea data-video-prompt rows="3" maxlength="2000" placeholder="Describe the action and setting for this shot."></textarea></label><div class="generation-attribute-grid" data-fields></div><label>Shot duration (seconds)<input data-seconds type="number" min="0.2" step="0.01" required></label><div class="row"><button type="submit">Apply</button></div></form>';
   const prompt=q('[data-video-prompt]',dialog);prompt.value=shot.video_prompt??data.brief??'';dialog.eccoAIContext=()=>({...root.eccoAIContext(prompt),context:{...root.eccoAIContext(prompt).context,scenes:[promptShot(shot)]}});dialog.append(aiMenu);choosePrompt(prompt);dialog.addEventListener('focusin',event=>{if(event.target.matches('textarea'))choosePrompt(event.target);});
   const fields=q('[data-fields]',dialog);
   for(const [key,label,options] of shotControlOptions){
    const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('select');input.dataset.control=key;
    input.add(new Option('Keep original / unspecified',''));const values=[...new Set([shot[key],...options].filter(Boolean))];values.forEach(value=>input.add(new Option(value,value)));input.value=shot[key]||'';wrap.append(input);fields.append(wrap);
   }
   q('[data-seconds]',dialog).value=shot.seconds||3;
   q('[data-close]',dialog).onclick=()=>dialog.close();
   q('form',dialog).onsubmit=event=>{event.preventDefault();if(!data.shots.includes(shot)){dialog.close();return;}for(const input of dialog.querySelectorAll('[data-control]'))shot[input.dataset.control]=input.value;shot.video_prompt=prompt.value;shot.seconds=Number(q('[data-seconds]',dialog).value);data.directions=[];data.analyzed='';persist();drawShots();drawDirections();dialog.close();};
   dialog.onclose=()=>{root.append(aiMenu);aiMenu.open=false;choosePrompt(brief);dialog.remove();};document.body.append(dialog);dialog.showModal();
  }
  function drawDirections(){
   const box=q('[data-directions]',root);box.replaceChildren();
   data.directions.forEach((text,i)=>{if(activeShots()[i]!==data.shots[shotIndex])return;const label=document.createElement('label');label.textContent='Visual prompt for selected shot';const area=document.createElement('textarea');area.dataset.shotDirection='';area.rows=3;area.maxLength=1800;area.value=text;area.oninput=()=>{data.directions[i]=area.value;persist();};label.append(area);box.append(label);});
  }
  function drawLists(){
   for(const kind of ['image','video','audio']){
    const box=q('[data-list="'+kind+'"]',root);box.replaceChildren();box.hidden=!data[idsKey[kind]].length;box.style.display=box.hidden?'none':'';
    data[idsKey[kind]].forEach((id,i)=>{
     const a=find(id,kind),card=document.createElement('div');card.className='generation-selected-item';card.style.cssText='position:relative;display:inline-flex;flex-direction:column;gap:4px;vertical-align:top;margin:4px;width:'+(kind==='audio'?'220px':'72px')+';';
     const label=document.createElement('span');label.textContent=a?title(a):'Unavailable';label.title=label.textContent;label.style.cssText='font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%';
     if(a){const preview=document.createElement(kind==='image'?'img':kind);preview.src=media(a);preview.dataset.asset=id;preview.style.cssText=kind==='audio'?'width:100%;height:32px':'width:72px;height:56px;object-fit:cover;border-radius:5px';if(kind==='image')preview.alt=title(a);else{preview.controls=true;preview.preload='metadata';}card.append(preview);}
     const remove=document.createElement('button');remove.type='button';remove.className='small secondary';remove.textContent='×';remove.title='Remove selection';remove.style.cssText='position:absolute;right:-5px;top:-5px;width:20px;min-width:20px;height:20px;min-height:20px;padding:0;border-radius:50%;line-height:18px;font-size:16px;background:#292343;color:white;z-index:1';remove.setAttribute('aria-label','Remove '+kind+' '+(i+1));
     remove.onclick=()=>{data[idsKey[kind]].splice(i,1);persist();drawLists();drawShots();};
     card.append(label,remove);box.append(card);
    });
   }
   const scripts=data.audio_ids.map(id=>audioScript(find(id,'audio')));
   const scriptKey=JSON.stringify(data.audio_ids);data.script_drafts=data.script_drafts||{};
   q('[data-transcript]',root).value=data.script_drafts[scriptKey]??scripts.filter(Boolean).join('\n\n');
   q('[data-script-source]',root).textContent=!scripts.length?'Select audio in Library to load its original script.':scripts.some(t=>!t)?'Some selected recordings have no saved generation script. Their audio will still be used unchanged.':'Original audio script · '+data.audio_ids.map(id=>title(find(id,'audio'))).join(' → ');
   q('[data-audio-hint]',root).hidden=true;q('[data-audio-hint]',root).textContent='';
   hydrateMedia();timing();
  }
  function audioScript(a,seen=new Set()){
   if(!a||seen.has(a.id))return '';seen.add(a.id);
   const lines=a.settings?.lines||a.request?.lines;
   if(lines?.length)return lines.map(l=>typeof l==='string'?l:l.text||'').join('\n');
   if(a.source_audio_ids?.length)return a.source_audio_ids.map(id=>audioScript(find(id,'audio'),seen)).join('\n\n');
   const job=state.records.find(j=>j.id===a.job_id);
   if(job?.request?.lines?.length)return job.request.lines.map(l=>l.text||'').join('\n');
   return a.transcript||a.audio_script||(a.source==='generated'?a.prompt:'')||'';
  }
  async function picker(kind){
   const dialog=document.createElement('dialog');dialog.className='generation-dialog';
   dialog.innerHTML='<div class="form"><div class="section-head"><h2>'+kind[0].toUpperCase()+kind.slice(1)+' Library</h2><button type="button" data-cancel>Cancel</button></div><div class="generation-filter-row"><label>Search<input type="search" data-search></label><label>Label<select data-folder><option value="">All labels</option></select></label></div><p role="status" data-library-status></p><div data-options class="generation-picker-grid"></div><p data-count></p><button type="button" data-refresh>Refresh library</button><button type="button" data-use>Use selected '+(kind==='audio'?'audio':kind+'s')+'</button></div>';
   const chosen=new Set(data[idsKey[kind]]),limit=kind==='video'?3:8;
   function draw(){
    const folder=q('[data-folder]',dialog),previous=folder.value;folder.replaceChildren(new Option('All labels',''));
    state.records.filter(a=>a.kind===kind+'_folder'&&!a.deleted).forEach(f=>folder.add(new Option(f.name||f.title||'Label',f.id)));folder.value=previous;
    const box=q('[data-options]',dialog);box.replaceChildren();const term=q('[data-search]',dialog).value.toLowerCase();
    const available=assets(kind),shown=available.filter(a=>title(a).toLowerCase().includes(term)&&(!folder.value||state.records.some(l=>l.kind==='library_item'&&!l.deleted&&l.asset_id===a.id&&l.folder_id===folder.value)));
    for(const a of shown){
     const card=document.createElement('div');card.className='generation-picker-item';
     const preview=document.createElement(kind==='image'?'img':kind);preview.dataset.asset=a.id;preview.src=media(a);
     if(kind==='image')preview.alt=title(a);else{preview.controls=true;preview.preload='metadata';}card.append(preview);
     const label=document.createElement('span');label.textContent=title(a);card.append(label);
     const choose=document.createElement('button');choose.type='button';choose.textContent=chosen.has(a.id)?'Selected':'Select';choose.setAttribute('aria-pressed',chosen.has(a.id));choose.dataset.assetChoice=a.id;
     choose.onclick=()=>{if(chosen.has(a.id))chosen.delete(a.id);else if(chosen.size<limit)chosen.add(a.id);else{q('[data-library-status]',dialog).textContent='Select up to '+limit+' items.';return;}draw();};card.append(choose);box.append(card);
    }
    q('[data-library-status]',dialog).textContent=shown.length?shown.length+' available':state.storage_pending?'Connect storage using the top connection menu to load your library.':available.length?'No items match this search or label.':'No '+kind+' assets loaded. Refresh the library or check your storage connection.';
    q('[data-count]',dialog).textContent=chosen.size+' / '+limit+' selected';hydrateMedia();
   }
   async function reloadLibrary(){const b=q('[data-refresh]',dialog);b.disabled=true;q('[data-library-status]',dialog).textContent='Loading library…';try{const latest=await api('state');if(!Array.isArray(latest.records))throw Error('Library data was not returned.');state={...state,...latest};draw();drawBoards();}catch(e){q('[data-library-status]',dialog).textContent='Could not load library: '+e.message;}finally{b.disabled=false;}}
   q('[data-search]',dialog).oninput=draw;q('[data-folder]',dialog).onchange=draw;q('[data-refresh]',dialog).onclick=reloadLibrary;q('[data-cancel]',dialog).onclick=()=>dialog.close();
   q('[data-use]',dialog).onclick=()=>{const changed=JSON.stringify(data[idsKey[kind]])!==JSON.stringify([...chosen]);data[idsKey[kind]]=[...chosen];if(changed&&kind==='audio'){if(!data.shots.length)loadBoard();else{balance();data.directions=[];data.analyzed='';drawBoards();}}if(!data.shots.length)loadBoard();persist();drawLists();drawShots();dialog.close();};
   dialog.onclose=()=>dialog.remove();document.body.append(dialog);draw();dialog.showModal();await reloadLibrary();
  }
  q('[data-transcript]',root).oninput=event=>{data.script_drafts=data.script_drafts||{};data.script_drafts[JSON.stringify(data.audio_ids)]=event.target.value;persist();};

  q('[data-open-script]',root).onclick=()=>{
   const dialog=document.createElement('dialog');dialog.id='video-audio-script';dialog.className='generation-dialog';dialog.setAttribute('aria-label','Audio script');
   dialog.innerHTML='<div class="form"><div class="section-head"><h2>Audio script</h2><button type="button" data-close aria-label="Close audio script">×</button></div><p class="help" data-source></p><label>Script<textarea data-script-editor aria-label="Audio script" maxlength="4000" rows="10"></textarea></label><div class="row"><button type="button" class="secondary" data-generate>Generate with AI</button><button type="button" class="secondary" data-improve>Improve with AI</button></div><div class="row"><button type="button" data-apply>Apply</button></div></div>';
   const input=q('[data-script-editor]',dialog),savedField=q('[data-transcript]',root),scriptKey=JSON.stringify(data.audio_ids);
   input.value=savedField.value;q('[data-source]',dialog).textContent=q('[data-script-source]',root).textContent;
   input.classList.add('ai-selected-field');
   dialog.eccoAIContext=()=>{const context=root.eccoAIContext(savedField);context.context.lines=[{text:input.value}];return context;};
   q('[data-generate]',dialog).onclick=()=>window.EccoAI?.generateField(input);
   q('[data-improve]',dialog).onclick=()=>window.EccoAI?.improveField(input);
   q('[data-close]',dialog).onclick=()=>dialog.close();
   q('[data-apply]',dialog).onclick=()=>{if(scriptKey!==JSON.stringify(data.audio_ids)||!root.isConnected){dialog.close();return;}savedField.value=input.value;savedField.dispatchEvent(new Event('input',{bubbles:true}));dialog.close();};
   dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();input.focus();
  };

  q('[data-library]',root).onchange=drawLists;
  q('[data-browse]',root).onclick=()=>picker(q('[data-library]',root).value);
  q('[data-board]',root).onchange=loadBoard;
  const brief=q('[data-transcript]',root);
  const aiMenu=document.createElement('details');aiMenu.className='storyboard-ai-floating';aiMenu.id='video-flow-ai';
  aiMenu.innerHTML='<summary aria-label="AI assistance">AI</summary><div class="storyboard-ai-actions"><button type="button" class="secondary" data-generate>Generate with AI</button><button type="button" class="secondary" data-improve>Improve with AI</button></div>';
  root.append(aiMenu);let selectedPrompt=brief;
  const choosePrompt=element=>{document.querySelectorAll('#video-flow .ai-selected-field,#video-shot-controls .ai-selected-field').forEach(el=>el.classList.remove('ai-selected-field'));selectedPrompt=element;selectedPrompt.classList.add('ai-selected-field');};
  root.addEventListener('focusin',event=>{if(event.target.matches('textarea'))choosePrompt(event.target);});
  const selectedField=()=>selectedPrompt.isConnected?selectedPrompt:brief;
  q('[data-generate]',aiMenu).onclick=()=>{aiMenu.open=false;window.EccoAI?.generateField(selectedField());};
  q('[data-improve]',aiMenu).onclick=()=>{aiMenu.open=false;window.EccoAI?.improveField(selectedField());};
  root.eccoAIContext=element=>({reference_ids:[...data.image_ids],video_reference_ids:[...data.video_ids],context:{model:model.value,summary:data.brief,scenes:element.matches('[data-motion],[data-shot-direction]')?[promptShot(data.shots[shotIndex])]:activeShots().map(promptShot),lines:[{text:q('[data-transcript]',root).value}],instructions:element.matches('[data-transcript]')?'Write only spoken script text.':'Write visual instructions only. Preserve recorded speech; do not invent dialogue.'}});
  model.addEventListener('change',()=>{persist();drawLists();});
  const aiStatus=q('[data-ai-status]',root);let writingDirections=false;
  const shotPrompt=s=>[s.video_prompt??data.brief,...shotControlOptions.filter(([key])=>s[key]).map(([key,label])=>label+': '+s[key])].filter(Boolean).join('. ');
  const writeDirections=async()=>{
   if(writingDirections)return false;
   const shots=activeShots(),snapshot=fingerprint();if(!shots.length){aiStatus.textContent='Add a shot first.';return;}
   writingDirections=true;aiStatus.textContent='';
   try{
    const result=await api('ai/enhance',{stage:'video',mode:'generate',story_id:story,reference_ids:data.image_ids,video_reference_ids:data.video_ids,
     fields:shots.map((s,i)=>({id:'shot_'+i,text:shotPrompt(s),max_length:1800})),
     context:{model:model.value,scenes:shots.map(promptShot),summary:data.brief,lines:data.audio_ids.map(id=>({text:audioScript(find(id,'audio'))})),
      instructions:'Write one continuous, feasible visual direction per supplied shot. Stitch them into a coherent sequence preserving shot order, duration, assigned avatar, eye and camera instructions. Preserve the existing recorded speech exactly: write visual direction only, not new dialogue. Audio drives lip timing. Use the sampled reference-video frames for visual style and composition, not identity or exact motion copying.'}});
    if(!form.isConnected||activeStory!==story||snapshot!==fingerprint())throw Error('Selections changed while AI was writing. Generate a fresh direction script.');
    if(result.questions?.length)throw Error(result.questions.join(' '));
    const byId=new Map(result.revisions?.map(r=>[r.id,r.text]));
    if(byId.size!==shots.length||shots.some((s,i)=>!byId.get('shot_'+i)))throw Error('AI returned an incomplete script. Your previous script is unchanged.');
    data.directions=shots.map((s,i)=>byId.get('shot_'+i));data.analyzed=snapshot;persist();drawDirections();aiStatus.textContent='Visual prompts updated. Original audio script unchanged.';return true;
   }catch(e){aiStatus.textContent=e.message;return false;}finally{writingDirections=false;}
  };
  form.onsubmit=async e=>{
   e.preventDefault();if(ctx.submitting)return;
   const selectedModel=model.value,gpu=ctx.compute.value;
   ctx.submitting=true;
   try{
    if(!data.image_ids.length||data.image_ids.some(id=>!find(id,'image')))throw Error('Choose an available avatar in step 2.');
    const shots=activeShots();if(!shots.length)throw Error('Add at least one shot.');
    if(shots.some(s=>!find(s.image_id,'image')||!Number.isFinite(s.seconds)||s.seconds<.2))throw Error('Each shot needs an available avatar and duration.');
    await window.EccoCompute.validate(gpu,selectedModel);
    if(model.value!==selectedModel||ctx.compute.value!==gpu)throw Error('Model or compute changed while checking. Generate again with your current selection.');
    if(data.audio_ids.length&&selectedModel!=='longcat-avatar-1.5')throw Error('Select LongCat in step 1 for synchronized speech.');
    if(selectedModel==='longcat-avatar-1.5'&&!data.audio_ids.length)throw Error('Select audio from Audio Library for LongCat.');
    ctx.submitting=true;setGenerationBusy(button,true,'Generating video…','Generate video');status.textContent='Preparing video…';
    if(data.analyzed!==fingerprint()||data.directions.length!==shots.length){
     if(data.video_ids.length){status.textContent='Analyzing video references…';if(!await writeDirections())throw Error(aiStatus.textContent||'Could not analyze reference videos.');}
     else{data.directions=shots.map(s=>[shotPrompt(s)].filter(Boolean).join('. '));data.analyzed=fingerprint();persist();drawDirections();}
    }
    let job;
    if(data.audio_ids.length){
     if(Math.abs(shots.reduce((n,s)=>n+s.seconds,0)-totalAudio())>.05)throw Error('Shot durations must cover the selected speech. Adjust seconds in step 5.');
     const payload={story_id:story,audio_ids:data.audio_ids,image_id:data.image_ids[0],video_reference_ids:data.video_ids,gpu,
      ...modelSettings(selectedModel),shots:shots.map((s,i)=>({title:s.title,image_id:s.image_id,seconds:s.seconds,prompt:data.directions[i]}))};
     const signature=JSON.stringify(payload);if(data.request_signature!==signature){data.request_id=crypto.randomUUID().replaceAll('-','');data.request_signature=signature;persist();}
     job=await api('longcat/sequence',{...payload,request_id:data.request_id});
    }else{
     const board=await api('boards',{story_id:story,title:currentStory().title||'Video',scenes:shots.map((s,i)=>({...s,motion:data.directions[i],narration:''}))});
     job=await api('videos',{...modelPayload('video',gpu,selectedModel),board_id:board.id});
    }
    localStorage.setItem('ecco-video-job:'+story,job.id);window.EccoGeneration.trackJob('video',story,job);status.textContent='Queued. Your video will appear in Review videos.';await refresh();
   }catch(error){status.textContent=error.message;window.EccoErrorLog?.record(error,{source:'video submission',model:selectedModel,gpu,displayed_model:model.value,profile_model:modelProfiles.selected.video});window.EccoErrors.show(error,{logged:true});}finally{ctx.submitting=false;setGenerationBusy(button,false,'','Generate video');}
  };
  drawBoards();if(!data.shots.length)loadBoard();drawLists();drawShots();drawDirections();persist();
 }
 const render=renderPage;renderPage=function(){render.apply(this,arguments);mount();};
 let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();});}).observe(document.body,{childList:true,subtree:true});
 mount();
})();



