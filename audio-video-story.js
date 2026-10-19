'use strict';
(()=>{
 const q=(s,r=document)=>r.querySelector(s),read=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))||d;}catch{return d;}};
 const assets=type=>state.records.filter(a=>a.kind==='asset'&&a.media===type&&!a.deleted);
 const key=s=>'ecco-audio-video:'+s;
 function mount(){
  const form=q('#video-form');if(!form||q('#audio-video-story',form)||!window.EccoGeneration?.context(form))return;
  const story=activeStory,ctx=window.EccoGeneration.context(form),saved=read(key(story),{});
  const panel=document.createElement('section');panel.id='audio-video-story';panel.className='generation-section form';
  panel.innerHTML='<div data-audio-video-fields hidden class="form"><label hidden>Recording<select data-recording></select></label><audio controls data-playback preload="metadata"></audio><details open><summary>Recorded audio script</summary><textarea data-transcript readonly rows="5" aria-label="Recorded audio script"></textarea><p class="help">These are the words saved with this recording. The original audio is reused unchanged.</p></details><div class="row"><button type="button" class="secondary" data-load-shots>Load current storyboard shots</button><button type="button" class="secondary" data-avatar>Choose avatar from Image Library</button></div><p data-avatar-name class="help"></p><p class="help">Select shots and edit their camera direction below. Initial timings are evenly distributed estimates; listen to the audio and adjust the boundaries. Editing visuals does not regenerate speech.</p><div data-shots class="form"></div><p data-timing role="status"></p></div>';
  q('[data-section=references]',form).append(panel);
  const oldAudio=q('[aria-label="Dialogue audio"]',form);if(oldAudio)oldAudio.closest('label').parentElement.remove();
  const model=q('#job-model',form),library=q('[data-reference-library]',form),fields=q('[data-audio-video-fields]',panel),picker=q('[data-recording]',panel);
  const data={enabled:false,audio_id:'',avatar_id:'',shots:[],...saved};
  const persist=()=>localStorage.setItem(key(story),JSON.stringify(data));
  const recording=()=>assets('audio').find(a=>a.id===data.audio_id),selected=()=>data.shots.filter(s=>s.selected);
  const duration=()=>Number(recording()?.seconds||recording()?.duration||0);
  const sourceBoard=()=>{const sid=recording()?.story_id||story;const local=read(sid?'ecco-board-draft:'+sid:'ecco-board-new-draft',null);if(local?.scenes?.length)return local;return [...boards()].filter(b=>b.story_id===sid).sort((a,b)=>b.created-a.created)[0]||{scenes:[]};};
  function balance(){const list=selected();if(!list.length)return;const each=Math.floor(duration()/list.length*1000)/1000;list.forEach((s,i)=>s.seconds=i===list.length-1?duration()-each*(list.length-1):each);}
  function timing(){const total=selected().reduce((n,s)=>n+Number(s.seconds||0),0);q('[data-timing]',panel).textContent=selected().length+' shots · '+total.toFixed(2)+'s visuals / '+duration().toFixed(2)+'s original audio';}
  function drawShots(){
   const root=q('[data-shots]',panel);root.replaceChildren();
   data.shots.forEach((shot,i)=>{
    const row=document.createElement('fieldset');row.className='form';row.innerHTML='<label class="row"><input type="checkbox" data-selected style="width:auto"><span></span></label><label>Visual action<textarea data-motion rows="2" maxlength="1600"></textarea></label><div class="generation-attribute-grid"><label>Camera movement<input data-camera_move maxlength="160"></label><label>Camera angle<input data-camera_angle maxlength="160"></label><label>Framing<input data-shot_size maxlength="160"></label><label>Duration (seconds)<input data-seconds type="number" min="0.2" step="0.01"></label></div>';
    q('span',row).textContent='Shot '+(i+1)+' · '+shot.title;q('[data-selected]',row).checked=shot.selected;
    for(const f of ['motion','camera_move','camera_angle','shot_size','seconds']){const input=q('[data-'+f+']',row);input.value=shot[f]||'';input.oninput=()=>{shot[f]=f==='seconds'?Number(input.value):input.value;persist();timing();};}
    q('[data-selected]',row).onchange=e=>{shot.selected=e.target.checked;balance();persist();drawShots();};root.append(row);
   });if(!data.shots.length)root.textContent='No storyboard shots loaded. Open Storyboard to create them, or load a saved storyboard.';timing();
  }
  function loadShots(){data.shots=sourceBoard().scenes.map((s,i)=>({...s,title:s.title||'Scene '+(i+1),selected:true}));balance();persist();drawShots();}
  function audioChanged(rebalance=true){
   data.audio_id=picker.value;const audio=recording();q('[data-transcript]',panel).value=(audio?.settings?.lines||[]).map(l=>l.text).join('\n\n')||audio?.prompt||'No transcript was saved with this recording.';
   const player=q('[data-playback]',panel);if(audio){player.dataset.asset=audio.id;player.src=media(audio);hydrateMedia();}else{player.removeAttribute('src');delete player.dataset.asset;}
   if(rebalance)balance();persist();drawShots();
  }
  picker.add(new Option('Choose generated audio',''));assets('audio').sort((a,b)=>b.created-a.created).forEach(a=>picker.add(new Option(a.title||'Audio recording',a.id)));
  picker.value=data.audio_id;picker.onchange=()=>audioChanged();
  q('[data-load-shots]',panel).onclick=loadShots;
  function avatarName(){const avatar=assets('image').find(a=>a.id===data.avatar_id);q('[data-avatar-name]',panel).textContent=avatar?'Avatar: '+(avatar.title||'Selected image'):'Choose one avatar to use across the selected shots.';}
  q('[data-avatar]',panel).onclick=()=>{
   const dialog=document.createElement('dialog');dialog.className='generation-dialog';dialog.innerHTML='<div class="form"><div class="section-head"><h2>Avatar · Image Library</h2><button type="button" data-close>Close</button></div><div data-images class="cards"></div></div>';
   for(const a of assets('image')){const button=document.createElement('button');button.type='button';button.className='secondary';const img=document.createElement('img');img.dataset.asset=a.id;img.src=media(a);img.alt=a.title||'Avatar';img.style.cssText='width:100%;height:120px;object-fit:contain';const title=document.createElement('span');title.textContent=a.title||'Untitled image';button.append(img,title);button.onclick=()=>{data.avatar_id=a.id;persist();avatarName();dialog.close();};q('[data-images]',dialog).append(button);}
   if(!assets('image').length)q('[data-images]',dialog).textContent='No images in your library.';q('[data-close]',dialog).onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();hydrateMedia();
  };
  const normalSubmit=form.onsubmit;
  form.onsubmit=async event=>{
   if(!data.enabled){if(model.value==='longcat-avatar-1.5'){event.preventDefault();notice('Choose a recording using References → Audio Library → Browse Library.',true);return;}return normalSubmit.call(form,event);}
   event.preventDefault();const button=q('#generate-video',form),status=q('#video-status',form);if(ctx.submitting)return;
   try{
    if((ctx.data.audio_reference_ids||[]).length>1)throw Error('Your audio selections are saved. This renderer currently supports one recording per render; multi-audio assembly is not connected yet.');
    if((ctx.data.video_reference_ids||[]).length)throw Error('Your video selections are saved. Combining existing video clips with audio-driven shots is not connected yet.');
    if((ctx.data.reference_ids||[]).length>1)throw Error('Your image selections are saved. This renderer currently uses one avatar across the selected shots.');
    if(!data.avatar_id&&ctx.data.reference_ids?.length===1)data.avatar_id=ctx.data.reference_ids[0];
    if(!recording())throw Error('Choose an existing audio recording.');
    if(!selected().length)throw Error('Select at least one storyboard shot.');
    if(!assets('image').some(a=>a.id===data.avatar_id))throw Error('Choose an avatar from Image Library.');
    if(Math.abs(selected().reduce((n,s)=>n+s.seconds,0)-duration())>.05)throw Error('Shot durations must cover the complete recording. Adjust the durations above.');
    if(!state.config.longcat?.sequence_available)throw Error('The audio-to-video sequence service is not deployed yet. Your audio and shot choices are saved.');
    if(!gpuConnected()||!modelAvailable('longcat-avatar-1.5'))throw Error('Connect the LongCat-ready GPU to render these shots.');
    ctx.submitting=true;setGenerationBusy(button,true,'Running Generation','Generate video');
    const payload={story_id:story,audio_id:data.audio_id,image_id:data.avatar_id,gpu:localStorage.getItem('ecco-selected-gpu'),...modelSettings('longcat-avatar-1.5'),shots:selected().map(s=>({title:s.title,seconds:s.seconds,prompt:[s.motion||'Natural presenter movement',s.camera_move&&'Camera movement: '+s.camera_move,s.camera_angle&&'Camera angle: '+s.camera_angle,s.shot_size&&'Framing: '+s.shot_size].filter(Boolean).join('. ')}))};
    const signature=JSON.stringify(payload);if(data.request_signature!==signature){data.request_id=crypto.randomUUID().replaceAll('-','');data.request_signature=signature;persist();}
    const job=await api('longcat/sequence',{...payload,request_id:data.request_id});
    localStorage.setItem('ecco-video-job:'+story,job.id);window.EccoGeneration.trackJob('video',story,job);status.textContent='Queued · reusing your original audio.';await refresh();
   }catch(error){status.textContent=error.message;notice(error.message,true);}finally{ctx.submitting=false;setGenerationBusy(button,false,'','Generate video');}
  };
  // Audio is a source in the existing References dropdown, not a separate mode.
  if(data.enabled&&!ctx.data.audio_reference_ids?.length&&data.audio_id){ctx.data.audio_reference_ids=[data.audio_id];ctx.data.reference_library='audio';library.value='audio';}
  function syncSource(){
   data.enabled=(ctx.data.audio_reference_ids||[]).length>0;fields.hidden=!data.enabled;panel.hidden=!data.enabled;
   if(data.enabled){
    const id=ctx.data.audio_reference_ids?.[0]||'',changed=id!==data.audio_id;
    picker.value=id;audioChanged(changed);
    if(changed)loadShots();
    model.value='longcat-avatar-1.5';model.dispatchEvent(new Event('change',{bubbles:true}));
   }
   persist();
  }
  document.addEventListener('ecco-reference-change',()=>{if(form.isConnected)syncSource();});
  syncSource();if(!data.shots.length)loadShots();avatarName();

 }
 function links(){
  document.querySelectorAll('[data-save-audio]').forEach(existing=>{
   if(existing.parentElement.querySelector('[data-audio-to-video]'))return;
   const id=existing.dataset.saveAudio,button=document.createElement('button');button.type='button';button.className='small secondary';button.dataset.audioToVideo=id;button.textContent='Create video';
   button.onclick=()=>{const audio=assets('audio').find(a=>a.id===id);if(!audio)return;const sid=audio.story_id||LEGACY_STORY;if(sid!==activeStory){window.EccoWorkspaceUI.openStory(sid);}const data=read(key(sid),{});localStorage.setItem(key(sid),JSON.stringify({...data,enabled:true,audio_id:id}));navigate('render');};existing.after(button);
  });
 }
 const render=renderPage;renderPage=function(){render.apply(this,arguments);mount();};
 let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();links();});}).observe(document.body,{childList:true,subtree:true});mount();links();
})();
