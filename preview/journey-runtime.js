'use strict';
/* Guided handoffs are scoped to the selected story. Generation remains explicit. */
(()=>{
 const q=s=>document.querySelector(s),J=window.EccoStoryJourneys;
 const read=(key,fallback={})=>{try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}};
 const write=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
 const setup=()=>read(activeStory?'ecco-story-description:'+activeStory:'ecco-new-story-draft');
 const format=()=>setup().story_format||J.current()?.format||'video';
 const storyAssets=kind=>(state.records||[]).filter(a=>a.kind==='asset'&&!a.deleted&&(a.story_id||LEGACY_STORY)===activeStory&&(!kind||a.media===kind));
 const board=()=>read(activeStory?'ecco-board-draft:'+activeStory:'ecco-board-new-draft');
 const narration=b=>(b.scenes||[]).map(s=>s.narration||'').filter(Boolean).join('\n\n');
 function seedAudio(force=false){
  if(!activeStory)return;const key='ecco-audio-draft:'+activeStory,b=board(),text=narration(b);let existing=read(key);const inherited=read('ecco-journey-audio-defaults');if(!Object.keys(existing).length&&setup().parent_story_id&&inherited.parent_story_id===setup().parent_story_id)existing={...inherited};
  if(!text.trim())return;
  const edited=existing.single_text?.trim()||existing.lines?.some(l=>l.text?.trim());if(edited&&!force)return;
  const speaker=existing.speakers?.[0]||{id:'speaker-0',name:'Narrator',voice:'en_female',language:'English',emotion:'neutral',delivery:setup().journey_second||''};
  write(key,{...existing,title:existing.title||b.title||currentStory().title,presentation:existing.presentation||'single',speakers:existing.speakers?.length?existing.speakers:[speaker],single_text:text,lines:[{text,speaker_id:speaker.id}],source_scenes:(b.scenes||[]).map((s,index)=>({index,fingerprint:JSON.stringify([s.title||'',s.narration||''])})),journey_source:JSON.stringify(b.scenes||[])});
 }
 function exportScript(){const b=board(),text=narration(b)||b.story||'';const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=(currentStory().title||'script').replace(/[^\w -]/g,'_')+'-script.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function sourceMedia(){
  q('#heading').textContent='Source Media';const root=q('#page'),data=setup();
  root.innerHTML='<div class="form"><label>Library<select data-source-library><option value="audio">Audio Library</option><option value="video">Video Library</option><option value="image">Image Library</option></select></label><div data-source-items class="form"></div><p role="status" data-source-status></p></div>';
  const chosen=new Set(data.source_asset_ids||[]);const draw=()=>{const box=q('[data-source-items]'),kind=q('[data-source-library]').value;box.replaceChildren();const list=(state.records||[]).filter(a=>a.kind==='asset'&&!a.deleted&&a.media===kind);for(const asset of list){const label=document.createElement('label');label.className='row';const input=document.createElement('input');input.type='checkbox';input.style.width='auto';input.checked=chosen.has(asset.id);const span=document.createElement('span');span.textContent=asset.title||'Untitled '+kind;label.append(input,span);input.onchange=()=>{input.checked?chosen.add(asset.id):chosen.delete(asset.id);data.source_asset_ids=[...chosen];write('ecco-story-description:'+activeStory,data);};box.append(label);}q('[data-source-status]').textContent=list.length?'':'No '+kind+' available. Add it in Studio first.';};q('[data-source-library]').onchange=draw;draw();
 }
 function review(){
  const kind=format()==='audio'?'audio':'video',list=storyAssets(kind).sort((a,b)=>b.created-a.created);
  q('#heading').textContent=kind==='audio'?'Review & Export Audio':'Review & Publish';
  const root=q('#page');root.innerHTML='<div class="row" data-review-actions></div><div class="cards" data-journey-results></div><p role="status" data-review-status></p>';
  const actions=q('[data-review-actions]'),script=document.createElement('button');script.type='button';script.className='secondary';script.textContent='Download Script';script.onclick=exportScript;actions.append(script);
  const refreshButton=document.createElement('button');refreshButton.type='button';refreshButton.className='secondary';refreshButton.textContent='Refresh Results';refreshButton.onclick=async()=>{refreshButton.disabled=true;try{await refresh();if(page==='journey-results')review();}catch(e){notice(e.message,true);}finally{refreshButton.disabled=false;}};actions.append(refreshButton);
  const box=q('[data-journey-results]');box.innerHTML=list.map(card).join('');wireCards();if(typeof hydrateMedia==='function')hydrateMedia();
  if(!list.length){q('[data-review-status]').textContent='No completed '+kind+' for this story yet.';const back=document.createElement('button');back.type='button';back.textContent='Return to '+(kind==='audio'?'Audio':'Video');back.onclick=()=>navigate(kind==='audio'?'audio':'render');actions.append(back);}
  if(kind==='video'){const publish=document.createElement('button');publish.type='button';publish.textContent='Publish to YouTube';publish.disabled=!list.some(a=>a.stage==='prod');publish.onclick=()=>navigate('publish');actions.append(publish);}
  const spec=J.current();if(spec&&(spec.group==='Series'||['audiobook','podcast','news','audio-drama'].includes(spec.id))){
   const next=document.createElement('button');next.type='button';next.className='secondary';next.textContent=['audiobook','book-adaptation'].includes(spec.id)?'Next Chapter':spec.id==='teaching'||spec.id==='training'?'Next Lesson':'Next Episode';
   next.onclick=()=>{const previous=setup(),audio=read('ecco-audio-draft:'+activeStory),parent=activeStory;window.EccoWorkspaceUI.startNewStory({...spec,seed:{title:previous.title,collection_id:previous.collection_id,genre:previous.genre,story_format:previous.story_format,journey_second:previous.journey_second,parent_story_id:parent,audio_audience:previous.audio_audience,audio_language:previous.audio_language,audio_tone:previous.audio_tone,audio_language_style:previous.audio_language_style,audio_language_style_instructions:previous.audio_language_style_instructions}});write('ecco-journey-audio-defaults',{parent_story_id:parent,model:audio.model,speakers:audio.speakers,presentation:audio.presentation,character_count:audio.character_count,speed:audio.speed,pitch:audio.pitch});};actions.append(next);
  }
 }
 async function advance(target,button){
  if(!J.current()){navigate(target);return;}const origin=page,story=activeStory;
  if(origin==='story-setup'){q('#story-setup-form')?.requestSubmit();return;}
  if(!story){notice('Save this story before continuing.',true);return;}
  button.disabled=true;
  try{
   if(origin==='journey-sources'){
    const selected=(setup().source_asset_ids||[]).map(id=>state.records.find(a=>a.id===id&&!a.deleted)).filter(Boolean);if(!selected.length)throw Error('Select source media before continuing.');
    const b=board();if(!(b.scenes||[]).length){const script=selected.map(a=>a.transcript||a.audio_script||(a.settings?.lines||[]).map(l=>l.text).join('\n\n')||'').filter(Boolean).join('\n\n');if(script){b.story=script;b.scenes=[{title:'Source script',narration:script,seconds:3,image_id:''}];write('ecco-board-draft:'+story,b);draft=b;}}
    const key='ecco-generation-v1:video:'+story,refs=read(key);if(!refs.reference_ids?.length)refs.reference_ids=selected.filter(a=>a.media==='image').map(a=>a.id);if(!refs.video_reference_ids?.length)refs.video_reference_ids=selected.filter(a=>a.media==='video').map(a=>a.id);write(key,refs);
   }
   if(origin==='board'||origin==='director'){
    persistDraft();const b=board();if(!(b.scenes||[]).length)throw Error('Add script sections or storyboard shots before continuing.');
    if(format()==='audio'&&!narration(b).trim())throw Error('Add the spoken script before continuing.');
    // Early scripts and unillustrated storyboards stay editable locally. The renderer saves its complete immutable inputs later.
    write('ecco-journey-checkpoint:'+story,{step:'board',saved_at:Date.now(),scenes:b.scenes});seedAudio();
   }
   if(origin==='audio'&&target==='journey-results'){await refresh();if(!storyAssets('audio').length)throw Error('Generate or upload audio for this story before reviewing it.');}
   if(origin==='render'){await refresh();if(!storyAssets('video').length)throw Error('Wait for a completed video before reviewing it.');}
   if(story!==activeStory||origin!==page)return;navigate(target);
  }catch(e){notice(e.message,true);}finally{if(button.isConnected)button.disabled=false;}
 }
 function adapt(){
  const spec=J.current();if(!spec)return;
  if(page==='board'){
   const intro=q('#page > .intro');if(intro)intro.hidden=true;for(const id of ['board-collection','source-story-picker'])q('#'+id)?.closest('label')?.setAttribute('hidden','');
   if(format()==='audio'){
    q('#heading').textContent=J.steps([]).find(s=>s[0]==='board')[1];
    const seconds=q('#scene-default-seconds');if(seconds)seconds.closest('label').hidden=true;
   
   }
  }
  if(page==='audio'){
   const form=q('#audio-form');if(form&&!form.querySelector('[data-use-journey-script]')){const b=document.createElement('button');b.type='button';b.className='secondary';b.dataset.useJourneyScript='';b.textContent='Use Storyboard Script';b.onclick=()=>{const text=narration(board());if(!text.trim()){notice('Add the spoken script in the previous step first.',true);return;}const existing=read('ecco-audio-draft:'+activeStory);if((existing.single_text?.trim()||existing.lines?.some(l=>l.text?.trim()))&&!confirm('Replace the current audio script with the storyboard narration?'))return;try{window.EccoAudioStudio.importScript(text);}catch(e){notice(e.message,true);}};(q('[data-audio-references]')||form).append(b);}
  }
 }
 const previousNavigate=navigate;
 navigate=function(target,...args){
  if(target==='audio'&&J.current())seedAudio();
  let result;if(target==='journey-sources'){page=target;sourceMedia();}else if(target==='journey-results'){page=target;document.body.classList.remove('workspace-entry-mode','story-choice-mode');q('#workspace-entry')?.remove();review();}else result=previousNavigate.call(this,target,...args);
  if(activeStory&&J.current()&&J.steps([]).some(s=>s[0]===target))localStorage.setItem('ecco-story-page:'+activeStory,target);
  adapt();return result;
 };
 let pending=false;new MutationObserver(()=>{if(pending)return;pending=true;queueMicrotask(()=>{pending=false;adapt();});}).observe(q('#page'),{childList:true,subtree:true});
 const previousRefresh=refresh;refresh=async function(...args){const result=await previousRefresh.apply(this,args);if(page==='journey-results'){const signature=JSON.stringify(storyAssets(format()==='audio'?'audio':'video').map(a=>[a.id,a.stage,a.deleted,a.sync]));if(q('#page').dataset.journeyResultSignature!==signature){review();q('#page').dataset.journeyResultSignature=signature;}}return result;};
 window.EccoJourneyFlow={advance,seedAudio,review,adapt,narration,storyAssets};
})();
