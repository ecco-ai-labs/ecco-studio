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
  root.innerHTML=section(2,'Choose your avatar','<button type="button" class="secondary" data-pick="image">Choose from Image Library</button><div data-list="image" class="generation-selected"></div>')+
   section(3,'Video reference · optional','<button type="button" class="secondary" data-pick="video">Choose from Video Library</button><p class="help">AI uses sampled frames to guide framing, lighting and visual direction. This does not copy exact motion.</p><div data-list="video" class="generation-selected"></div>')+
   section(4,'Speech audio · optional','<button type="button" class="secondary" data-pick="audio">Choose from Audio Library</button><p class="help" data-audio-hint></p><div data-list="audio" class="form"></div><details><summary>Saved speech script</summary><textarea data-transcript readonly rows="4"></textarea></details>')+
   section(5,'Direct your shots','<div class="row"><button type="button" class="secondary" data-load>Load storyboard shots</button><button type="button" class="secondary" data-add>Add shot</button></div><div data-shots class="form"></div><p data-timing class="help"></p>')+
   section(6,'Create the direction script','<label>What should happen?<textarea data-brief rows="3" maxlength="2000" placeholder="Describe the scene and how the shots should flow together."></textarea></label><button type="button" class="secondary" data-write>Generate direction script with AI</button><p class="help">Review or edit each shot direction below. Your existing speech is not rewritten.</p><div data-directions class="form"></div><p role="status" data-ai-status></p>');
  button.textContent='7. Generate video';
  const persist=()=>{localStorage.setItem(key,JSON.stringify(data));};
  const totalAudio=()=>data.audio_ids.reduce((n,id)=>n+Number(find(id,'audio')?.seconds||find(id,'audio')?.duration||0),0);
  const activeShots=()=>data.shots.filter(s=>s.selected!==false);
  const fingerprint=()=>JSON.stringify({model:model.value,images:data.image_ids,videos:data.video_ids,audio:data.audio_ids,shots:data.shots,brief:data.brief});
  function timing(){q('[data-timing]',root).textContent=activeShots().length+' shots · '+activeShots().reduce((n,s)=>n+Number(s.seconds||0),0).toFixed(2)+'s'+(data.audio_ids.length?' / '+totalAudio().toFixed(2)+'s speech':'');}
  function balance(){const shots=activeShots();if(!shots.length||!totalAudio())return;const each=Math.floor(totalAudio()/shots.length*1000)/1000;shots.forEach((s,i)=>s.seconds=i===shots.length-1?totalAudio()-each*(shots.length-1):each);}
  function newShot(i=0){return {title:'Shot '+(i+1),selected:true,image_id:data.image_ids[0]||'',seconds:3,motion:'Natural movement',eye:'Look toward camera; natural blinking',lip:'Synchronize with speech',camera_move:'Static',camera_angle:'Eye level',shot_size:'Medium close-up'};}
  function loadBoard(){
   const sid=find(data.audio_ids[0],'audio')?.story_id||story;
   const board=read('ecco-board-draft:'+sid,null)||[...boards()].filter(b=>b.story_id===sid).sort((a,b)=>b.created-a.created)[0];
   data.shots=board?.scenes?.length?board.scenes.map((s,i)=>({...newShot(i),...s,selected:true,image_id:data.image_ids.includes(s.image_id)?s.image_id:data.image_ids[0]||''})):[newShot()];
   balance();data.directions=[];persist();drawShots();drawDirections();
  }
  function drawShots(){
   const box=q('[data-shots]',root);box.replaceChildren();
   data.shots.forEach((s,i)=>{
    const row=document.createElement('fieldset');row.className='form';
    row.innerHTML='<label class="row"><input type="checkbox" data-selected style="width:auto"><span></span></label><label>Avatar for this shot<select data-image></select></label><label>Action<textarea data-motion rows="2" maxlength="800"></textarea></label><div class="generation-attribute-grid">'+
     [['eye','Eye movement / expression'],['lip','Mouth / delivery'],['camera_move','Camera movement'],['camera_angle','Camera angle'],['shot_size','Framing'],['seconds','Seconds']].map(([f,l])=>'<label>'+l+'<input data-field="'+f+'" '+(f==='seconds'?'type="number" min="0.2" step="0.01"':'maxlength="160"')+'></label>').join('')+'</div><button type="button" class="small secondary" data-remove-shot>Remove shot</button>';
    q('span',row).textContent=s.title||'Shot '+(i+1);q('[data-selected]',row).checked=s.selected!==false;
    q('[data-selected]',row).onchange=e=>{s.selected=e.target.checked;balance();persist();drawShots();};
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
   data.directions.forEach((text,i)=>{const label=document.createElement('label');label.textContent='Shot '+(i+1)+' direction';const area=document.createElement('textarea');area.rows=3;area.maxLength=1800;area.value=text;area.oninput=()=>{data.directions[i]=area.value;persist();};label.append(area);box.append(label);});
  }
  function drawLists(){
   for(const kind of ['image','video','audio']){
    const box=q('[data-list="'+kind+'"]',root);box.replaceChildren();
    data[idsKey[kind]].forEach((id,i)=>{
     const a=find(id,kind),card=document.createElement('div');card.className='generation-selected-item';
     const label=document.createElement('span');label.textContent=(i+1)+'. '+(a?title(a):'Unavailable selection');
     if(a){const preview=document.createElement(kind==='image'?'img':kind);preview.src=media(a);preview.dataset.asset=id;preview.style.cssText=kind==='audio'?'width:100%':'width:120px;height:90px;object-fit:contain';if(kind==='image')preview.alt=title(a);else{preview.controls=true;preview.preload='metadata';}card.append(preview);}
     const remove=document.createElement('button');remove.type='button';remove.className='small secondary';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+kind+' '+(i+1));
     remove.onclick=()=>{data[idsKey[kind]].splice(i,1);persist();drawLists();drawShots();};
     card.append(label,remove);box.append(card);
    });
   }
   q('[data-transcript]',root).value=data.audio_ids.map(id=>{const a=find(id,'audio');return (a?.settings?.lines||[]).map(l=>l.text).join('\n')||a?.prompt||'';}).join('\n\n');
   q('[data-audio-hint]',root).textContent=model.value==='longcat-avatar-1.5'?'LongCat requires speech audio for lip sync. Multiple recordings play in the selected order.':'For synchronized speech, select LongCat in step 1. This model generates silent motion.';
   hydrateMedia();timing();
  }
  function picker(kind){
   const dialog=document.createElement('dialog');dialog.className='generation-dialog';
   dialog.innerHTML='<div class="form"><div class="section-head"><h2>'+kind[0].toUpperCase()+kind.slice(1)+' Library</h2><button type="button" data-cancel>Cancel</button></div><label>Search<input type="search" data-search></label><div data-options class="cards"></div><p data-count></p><button type="button" data-use>Use selected '+kind+'s</button></div>';
   const chosen=new Set(data[idsKey[kind]]),limit=kind==='video'?3:8;
   function draw(){const box=q('[data-options]',dialog);box.replaceChildren();const term=q('[data-search]',dialog).value.toLowerCase();assets(kind).filter(a=>title(a).toLowerCase().includes(term)).forEach(a=>{
    const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.style.width='auto';check.checked=chosen.has(a.id);check.onchange=()=>{if(check.checked&&chosen.size>=limit){check.checked=false;return;}check.checked?chosen.add(a.id):chosen.delete(a.id);q('[data-count]',dialog).textContent=chosen.size+' / '+limit+' selected';};
    label.append(check,document.createTextNode(title(a)));box.append(label);
   });q('[data-count]',dialog).textContent=chosen.size+' / '+limit+' selected';}
   q('[data-search]',dialog).oninput=draw;q('[data-cancel]',dialog).onclick=()=>dialog.close();
   q('[data-use]',dialog).onclick=()=>{const changed=JSON.stringify(data[idsKey[kind]])!==JSON.stringify([...chosen]);data[idsKey[kind]]=[...chosen];if(changed&&kind==='audio')loadBoard();if(!data.shots.length)loadBoard();persist();drawLists();drawShots();dialog.close();};
   dialog.onclose=()=>dialog.remove();document.body.append(dialog);draw();dialog.showModal();
  }
  root.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>picker(b.dataset.pick));
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
     context:{model:model.value,scenes:shots,summary:data.brief,lines:data.audio_ids.map(id=>({text:(find(id,'audio')?.settings?.lines||[]).map(l=>l.text).join(' ')})),
      instructions:'Write one continuous, feasible visual direction per supplied shot. Stitch them into a coherent sequence preserving shot order, duration, assigned avatar, eye and camera instructions. Preserve the existing recorded speech exactly: write visual direction only, not new dialogue. Audio drives lip timing. Use the sampled reference-video frames for visual style and composition, not identity or exact motion copying.'}});
    if(!form.isConnected||activeStory!==story||snapshot!==fingerprint())throw Error('Selections changed while AI was writing. Generate a fresh direction script.');
    if(result.questions?.length)throw Error(result.questions.join(' '));
    const byId=new Map(result.revisions?.map(r=>[r.id,r.text]));
    if(byId.size!==shots.length||shots.some((s,i)=>!byId.get('shot_'+i)))throw Error('AI returned an incomplete script. Your previous script is unchanged.');
    data.directions=shots.map((s,i)=>byId.get('shot_'+i));data.analyzed=snapshot;persist();drawDirections();aiStatus.textContent='Direction script ready for review.';
   }catch(e){aiStatus.textContent=e.message;}finally{write.disabled=false;write.textContent='Generate direction script with AI';}
  };
  form.onsubmit=async e=>{
   e.preventDefault();if(ctx.submitting)return;
   try{
    if(!data.image_ids.length||data.image_ids.some(id=>!find(id,'image')))throw Error('Choose an available avatar in step 2.');
    const shots=activeShots();if(!shots.length)throw Error('Add at least one shot in step 5.');
    if(shots.some(s=>!find(s.image_id,'image')||!Number.isFinite(s.seconds)||s.seconds<.2))throw Error('Each shot needs an available avatar and duration.');
    if(data.directions.length!==shots.length||data.directions.some(t=>!t.trim()))throw Error('Generate the direction script in step 6.');
    if(data.video_ids.length&&data.analyzed!==fingerprint())throw Error('Your selections changed. Regenerate the direction script to use the current video reference and controls.');
    if(!gpuConnected()||!modelAvailable(model.value))throw Error('Connect a GPU with the selected model ready.');
    if(data.audio_ids.length&&model.value!=='longcat-avatar-1.5')throw Error('Select LongCat in step 1 for synchronized speech.');
    if(model.value==='longcat-avatar-1.5'&&!data.audio_ids.length)throw Error('Select speech audio in step 4 for LongCat.');
    ctx.submitting=true;setGenerationBusy(button,true,'Generating video…','7. Generate video');status.textContent='Preparing video…';
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
   }catch(error){status.textContent=error.message;notice(error.message,true);}finally{ctx.submitting=false;setGenerationBusy(button,false,'','7. Generate video');}
  };
  if(!data.shots.length)loadBoard();drawLists();drawShots();drawDirections();persist();
 }
 const render=renderPage;renderPage=function(){render.apply(this,arguments);mount();};
 let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();});}).observe(document.body,{childList:true,subtree:true});
 mount();
})();
