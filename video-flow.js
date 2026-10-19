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
  const model=q('#job-model',form),footer=q('.generation-footer',form),button=q('#generate-video',form),status=q('#video-status',form);
  // Preserve the shared model controls; retire the overlapping reference/prompt controls.
  for(const name of ['references','prompt','controls'])q('[data-section="'+name+'"]',form).hidden=true;
  q('[aria-label="Dialogue audio"]',form)?.closest('label')?.parentElement.remove();
  q('[data-section="model"] .generation-section-heading',form).textContent='1. Select model';
  const root=document.createElement('div');root.className='form';root.id='video-flow';form.insertBefore(root,footer);
  const section=(n,t,body)=>'<section class="generation-section form" data-step="'+n+'"><div class="generation-section-heading">'+n+'. '+t+'</div>'+body+'</section>';
  root.innerHTML=section(2,'Library','<div class="row"><select aria-label="Library" data-library><option value="image">Image Library</option><option value="video">Video Library</option><option value="audio">Audio Library</option></select><button type="button" class="secondary" data-browse>Browse library</button></div><div data-list="image" class="generation-selected"></div><div data-list="video" class="generation-selected"></div><div data-list="audio" class="form"></div><p class="help" data-audio-hint></p>')+
   section(3,'Audio script','<p class="help" data-script-source>Select audio above to load the exact words used to generate it.</p><textarea aria-label="Audio script" data-transcript maxlength="4000" rows="5" placeholder="Your selected recording’s original script will appear here."></textarea><p class="help">AI edits the script text. To hear edited words or lip-sync them, generate a new recording in Audio Studio and select it here.</p>')+
   section(4,'Shots','<label>Storyboard<select data-board aria-label="Storyboard"></select></label><div class="row"><button type="button" class="secondary" data-load>Load selected storyboard</button><button type="button" class="secondary" data-add>Add shot</button></div><label>Edit shot<select data-shot aria-label="Edit shot"></select></label><div data-shots class="form"></div><p data-timing class="help"></p>')+
   section(5,'Video prompt','<label>Describe the action and setting<textarea data-brief rows="3" maxlength="2000" placeholder="For example: The selected avatar presents the selected audio in a newsroom, looking into the camera."></textarea></label><button type="button" class="secondary" data-write>Improve shot prompts with AI · optional</button><p class="help">Use this for visual instructions. The audio script above supplies the spoken words.</p><div data-directions class="form"></div><p role="status" data-ai-status></p>');
  button.textContent='Generate video';
  const legacyBoard=q('[name="board_id"]',form);if(legacyBoard){legacyBoard.required=false;legacyBoard.closest('label').hidden=true;}
  let shotIndex=0;
  const persist=()=>{localStorage.setItem(key,JSON.stringify(data));};
  const totalAudio=()=>data.audio_ids.reduce((n,id)=>n+Number(find(id,'audio')?.seconds||find(id,'audio')?.duration||0),0);
  const activeShots=()=>data.shots.filter(s=>s.selected!==false);
  const fingerprint=()=>JSON.stringify({model:model.value,images:data.image_ids,videos:data.video_ids,audio:data.audio_ids,shots:data.shots,brief:data.brief});
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
   select.replaceChildren();select.add(new Option(list.length?'Choose a storyboard':'No saved storyboard — add shots below',''));
   for(const b of list)select.add(new Option((b.title||'Storyboard')+' · '+b.scenes.length+' shots'+(b.created?' · '+new Date(b.created*1000).toLocaleString():''),b.id));
   select.value=list.some(b=>b.id===previous)?previous:(list[0]?.id||'');
   q('[data-load]',root).disabled=!list.length;
  }
  function loadBoard(){
   drawBoards();const board=boardOptions().find(b=>b.id===q('[data-board]',root).value);
   data.board_id=board?.id||'';
   data.shots=board?.scenes?.length?board.scenes.map((s,i)=>({...newShot(i),...s,selected:true,image_id:data.image_ids.includes(s.image_id)?s.image_id:data.image_ids[0]||''})):[newShot()];
   shotIndex=0;balance();data.directions=[];persist();drawShots();drawDirections();
  }
  function drawShots(){
   const box=q('[data-shots]',root);box.replaceChildren();
   const select=q('[data-shot]',root);select.replaceChildren();data.shots.forEach((s,i)=>select.add(new Option((i+1)+'. '+(s.title||'Shot '+(i+1))+(s.selected===false?' · excluded':''),String(i))));
   shotIndex=Math.max(0,Math.min(shotIndex,data.shots.length-1));select.value=String(shotIndex);select.onchange=()=>{shotIndex=Number(select.value);drawShots();drawDirections();};
   data.shots.forEach((s,i)=>{if(i!==shotIndex)return;
    const row=document.createElement('fieldset');row.className='form';
    row.innerHTML='<label>Include in video<select data-selected><option value="yes">Yes</option><option value="no">No</option></select></label><label>Avatar for this shot<select data-image></select></label><label>Action<textarea data-motion rows="2" maxlength="800"></textarea></label><div class="generation-attribute-grid">'+
     [['eye','Eye movement / expression'],['lip','Mouth / delivery'],['camera_move','Camera movement'],['camera_angle','Camera angle'],['shot_size','Framing'],['seconds','Seconds']].map(([f,l])=>'<label>'+l+'<input data-field="'+f+'" '+(f==='seconds'?'type="number" min="0.2" step="0.01"':'maxlength="160"')+'></label>').join('')+'</div><button type="button" class="small secondary" data-remove-shot>Remove shot</button>';
    q('[data-selected]',row).value=s.selected!==false?'yes':'no';
    q('[data-selected]',row).onchange=e=>{s.selected=e.target.value==='yes';balance();persist();drawShots();};
    const image=q('[data-image]',row);image.add(new Option('Choose avatar',''));
    data.image_ids.forEach(id=>{const a=find(id,'image');if(a)image.add(new Option(title(a),id));});
    image.value=s.image_id||data.image_ids[0]||'';s.image_id=image.value;image.onchange=()=>{s.image_id=image.value;persist();};
    const motion=q('[data-motion]',row);motion.value=s.motion||'';motion.oninput=()=>{s.motion=motion.value;persist();};
    row.querySelectorAll('[data-field]').forEach(el=>{const f=el.dataset.field;el.value=s[f]||'';el.oninput=()=>{s[f]=f==='seconds'?Number(el.value):el.value;persist();timing();};});
    q('[data-remove-shot]',row).onclick=()=>{data.shots.splice(i,1);data.directions=[];persist();drawShots();drawDirections();};
    box.append(row);
   });timing();
  }
  function drawDirections(){
   const box=q('[data-directions]',root);box.replaceChildren();
   data.directions.forEach((text,i)=>{if(activeShots()[i]!==data.shots[shotIndex])return;const label=document.createElement('label');label.textContent='Visual prompt for selected shot';const area=document.createElement('textarea');area.rows=3;area.maxLength=1800;area.value=text;area.oninput=()=>{data.directions[i]=area.value;persist();};label.append(area);box.append(label);});
  }
  function drawLists(){
   for(const kind of ['image','video','audio']){
    const box=q('[data-list="'+kind+'"]',root);box.replaceChildren();box.hidden=kind!==q('[data-library]',root).value;box.style.display=box.hidden?'none':'';
    data[idsKey[kind]].forEach((id,i)=>{
     const a=find(id,kind),card=document.createElement('div');card.className='generation-selected-item';
     const label=document.createElement('span');label.textContent=kind[0].toUpperCase()+kind.slice(1)+' Library: '+(a?title(a):'Unavailable selection');
     if(a){const preview=document.createElement(kind==='image'?'img':kind);preview.src=media(a);preview.dataset.asset=id;preview.style.cssText=kind==='audio'?'width:100%':'width:120px;height:90px;object-fit:contain';if(kind==='image')preview.alt=title(a);else{preview.controls=true;preview.preload='metadata';}card.append(preview);}
     const remove=document.createElement('button');remove.type='button';remove.className='small secondary';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+kind+' '+(i+1));
     remove.onclick=()=>{data[idsKey[kind]].splice(i,1);persist();drawLists();drawShots();};
     card.append(label,remove);box.append(card);
    });
   }
   const scripts=data.audio_ids.map(id=>audioScript(find(id,'audio')));
   const scriptKey=JSON.stringify(data.audio_ids);data.script_drafts=data.script_drafts||{};
   q('[data-transcript]',root).value=data.script_drafts[scriptKey]??scripts.filter(Boolean).join('\n\n');
   q('[data-script-source]',root).textContent=!scripts.length?'Select audio in Library to load its original script.':scripts.some(t=>!t)?'Some selected recordings have no saved generation script. Their audio will still be used unchanged.':'Original audio script · '+data.audio_ids.map(id=>title(find(id,'audio'))).join(' → ');
   q('[data-audio-hint]',root).textContent='Choose images for your avatars, optional videos for visual reference, and audio for speech. Selections remain when switching libraries.';
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
   q('[data-use]',dialog).onclick=()=>{const changed=JSON.stringify(data[idsKey[kind]])!==JSON.stringify([...chosen]);data[idsKey[kind]]=[...chosen];if(changed&&kind==='audio')loadBoard();if(!data.shots.length)loadBoard();persist();drawLists();drawShots();dialog.close();};
   dialog.onclose=()=>dialog.remove();document.body.append(dialog);draw();dialog.showModal();await reloadLibrary();
  }
  q('[data-transcript]',root).oninput=event=>{data.script_drafts=data.script_drafts||{};data.script_drafts[JSON.stringify(data.audio_ids)]=event.target.value;persist();};
  q('[data-library]',root).onchange=drawLists;
  q('[data-browse]',root).onclick=()=>picker(q('[data-library]',root).value);
  q('[data-load]',root).onclick=loadBoard;
  q('[data-add]',root).onclick=()=>{data.shots.push(newShot(data.shots.length));data.directions=[];persist();drawShots();drawDirections();};
  const brief=q('[data-brief]',root);brief.value=data.brief||'';brief.oninput=()=>{data.brief=brief.value;persist();};
  model.addEventListener('change',()=>{persist();drawLists();});
  const write=q('[data-write]',root),aiStatus=q('[data-ai-status]',root);
  const shotPrompt=s=>[s.motion,'Eyes: '+s.eye,'Mouth: '+s.lip,'Camera: '+s.camera_move,s.camera_angle,s.shot_size].filter(Boolean).join('. ');
  write.onclick=async()=>{
   if(write.disabled)return;
   const shots=activeShots(),snapshot=fingerprint();if(!shots.length){aiStatus.textContent='Add a shot first.';return;}
   write.disabled=true;write.textContent='Writing direction script…';aiStatus.textContent='';
   try{
    const result=await api('ai/enhance',{stage:'video',mode:'generate',story_id:story,reference_ids:data.image_ids,video_reference_ids:data.video_ids,
     fields:shots.map((s,i)=>({id:'shot_'+i,text:shotPrompt(s),max_length:1800})),
     context:{model:model.value,scenes:shots,summary:data.brief,lines:data.audio_ids.map(id=>({text:audioScript(find(id,'audio'))})),
      instructions:'Write one continuous, feasible visual direction per supplied shot. Stitch them into a coherent sequence preserving shot order, duration, assigned avatar, eye and camera instructions. Preserve the existing recorded speech exactly: write visual direction only, not new dialogue. Audio drives lip timing. Use the sampled reference-video frames for visual style and composition, not identity or exact motion copying.'}});
    if(!form.isConnected||activeStory!==story||snapshot!==fingerprint())throw Error('Selections changed while AI was writing. Generate a fresh direction script.');
    if(result.questions?.length)throw Error(result.questions.join(' '));
    const byId=new Map(result.revisions?.map(r=>[r.id,r.text]));
    if(byId.size!==shots.length||shots.some((s,i)=>!byId.get('shot_'+i)))throw Error('AI returned an incomplete script. Your previous script is unchanged.');
    data.directions=shots.map((s,i)=>byId.get('shot_'+i));data.analyzed=snapshot;persist();drawDirections();aiStatus.textContent='Visual prompts updated. Original audio script unchanged.';return true;
   }catch(e){aiStatus.textContent=e.message;return false;}finally{write.disabled=false;write.textContent='Improve shot prompts with AI · optional';}
  };
  form.onsubmit=async e=>{
   e.preventDefault();if(ctx.submitting)return;
   try{
    if(!data.image_ids.length||data.image_ids.some(id=>!find(id,'image')))throw Error('Choose an available avatar in step 2.');
    const shots=activeShots();if(!shots.length)throw Error('Add at least one shot.');
    if(shots.some(s=>!find(s.image_id,'image')||!Number.isFinite(s.seconds)||s.seconds<.2))throw Error('Each shot needs an available avatar and duration.');
    if(!gpuConnected()||!modelAvailable(model.value))throw Error('Connect a GPU with the selected model ready.');
    if(data.audio_ids.length&&model.value!=='longcat-avatar-1.5')throw Error('Select LongCat in step 1 for synchronized speech.');
    if(model.value==='longcat-avatar-1.5'&&!data.audio_ids.length)throw Error('Select audio from Audio Library for LongCat.');
    ctx.submitting=true;setGenerationBusy(button,true,'Generating video…','Generate video');status.textContent='Preparing video…';
    if(data.analyzed!==fingerprint()||data.directions.length!==shots.length){
     if(data.video_ids.length){status.textContent='Analyzing video references…';if(!await write.onclick())throw Error(aiStatus.textContent||'Could not analyze reference videos.');}
     else{data.directions=shots.map(s=>[data.brief,shotPrompt(s)].filter(Boolean).join('. '));data.analyzed=fingerprint();persist();drawDirections();}
    }
    let job;
    if(data.audio_ids.length){
     if(Math.abs(shots.reduce((n,s)=>n+s.seconds,0)-totalAudio())>.05)throw Error('Shot durations must cover the selected speech. Adjust seconds in step 5.');
     const payload={story_id:story,audio_ids:data.audio_ids,image_id:data.image_ids[0],video_reference_ids:data.video_ids,gpu:localStorage.getItem('ecco-selected-gpu'),
      ...modelSettings(model.value),shots:shots.map((s,i)=>({title:s.title,image_id:s.image_id,seconds:s.seconds,prompt:data.directions[i]}))};
     const signature=JSON.stringify(payload);if(data.request_signature!==signature){data.request_id=crypto.randomUUID().replaceAll('-','');data.request_signature=signature;persist();}
     job=await api('longcat/sequence',{...payload,request_id:data.request_id});
    }else{
     const board=await api('boards',{story_id:story,title:currentStory().title||'Video',scenes:shots.map((s,i)=>({...s,motion:data.directions[i],narration:''}))});
     job=await api('videos',{...modelPayload('video'),board_id:board.id});
    }
    localStorage.setItem('ecco-video-job:'+story,job.id);window.EccoGeneration.trackJob('video',story,job);status.textContent='Queued. Your video will appear in Review videos.';await refresh();
   }catch(error){status.textContent=error.message;notice(error.message,true);}finally{ctx.submitting=false;setGenerationBusy(button,false,'','Generate video');}
  };
  drawBoards();if(!data.shots.length)loadBoard();drawLists();drawShots();drawDirections();persist();
 }
 const render=renderPage;renderPage=function(){render.apply(this,arguments);mount();};
 let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();});}).observe(document.body,{childList:true,subtree:true});
 mount();
})();
