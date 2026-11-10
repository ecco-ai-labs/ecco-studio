'use strict';
/* Characters step: one tab per character, its properties from the Story step, and
   Create + Test for each character. Audio stories create a voice; image and video
   stories create an avatar. Owner approved the Characters mock-up on 8 November 2026.
   Jobs run through the existing services: Audio Studio voice samples and image jobs. */
(()=>{
 const q=(s,r=document)=>r?.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const AVATAR_MODELS=['z-image','sdxl','qwen-image-2512','flux-klein-4b'];
 const AUDIO_RESET=['delivery','model','voice','language','dialect','style','emotion','gender','age_group'];
 const LABELS={none:'Not created',created:'Created',tested:'Tested'};
 const media=new Map(),voiceTests=new Map();
 let ctx=null,busy=null;

 const visual=()=>ctx.data.output!=='audio';
 const speaks=()=>ctx.data.output!=='image';
 function status(c){
  const created=visual()?!!c.reference_id:!!c.voice_sample;
  return created?(c.tested?'tested':'created'):'none';
 }
 // Owner fix I5 (2026-11-09): in a series written fresh each episode, a character can change each episode (a guest); only fixed characters need a voice now.
 const seriesOpen=()=>ctx.data.sourceTab==='each'&&ctx.data.recurrence==='recurring';
 const perEpisode=c=>seriesOpen()&&!!c.perEpisode;
 // Voice fix (2026-11-09): say plainly when characters share a voice.
 function sharedNote(){
  if(visual())return '';const seen=new Map();for(const c of ctx.data.cast.filter(c=>!perEpisode(c))){const k=(c.model||'')+'|'+c.voice;seen.set(k,[...(seen.get(k)||[]),c.name]);}
  const groups=[...seen.values()].filter(n=>n.length>1);return groups.length?' · Same voice: '+groups.map(n=>n.join(' and ')).join('; ')+'. Choose another voice or audio model for more variety.':'';
 }
 function progress(){
  const cast=ctx.data.cast.filter(c=>!perEpisode(c)),list=cast.map(status);
  // Automatic flow (owner-approved 2026-11-09): an audio character is ready once it has a voice; samples are optional.
  if(!visual())return {total:cast.length,created:cast.filter(c=>!!c.voice).length,tested:list.filter(s=>s==='tested').length};
  return {total:cast.length,created:list.filter(s=>s!=='none').length,tested:list.filter(s=>s==='tested').length};
 }
 async function mediaURL(id){
  if(media.has(id))return media.get(id);
  if(!window.EccoStorage?.mediaURL)throw Error('Connect workspace storage from Connections → Storage.');
  const url=await window.EccoStorage.mediaURL(id);media.set(id,url);return url;
 }
 function marker(state){
  const dot=document.createElement('span');dot.className='story-cast-status';dot.dataset.status=state;dot.setAttribute('aria-hidden','true');
  if(state==='tested')dot.innerHTML='<svg viewBox="0 0 16 16"><path d="M4.5 8.2l2.3 2.3 4.7-4.8"/></svg>';
  return dot;
 }
 function element(tag,props={},...children){
  const el=document.createElement(tag);
  for(const [k,v] of Object.entries(props)){
   if(v===undefined||v===null||v===false)continue;
   if(k==='className')el.className=v;else if(k==='text')el.textContent=v;else if(k==='html')el.innerHTML=v;
   else if(k.startsWith('on'))el[k]=v;else if(k==='dataset')Object.assign(el.dataset,v);else el.setAttribute(k,v===true?'':v);
  }
  el.append(...children.filter(Boolean));return el;
 }
 const button=(text,onclick,className='')=>element('button',{type:'button',className:className||undefined,onclick,text});
 function playButton(label,onclick){
  const b=element('button',{type:'button',className:'secondary story-cast-play','aria-label':label,onclick});
  b.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7.5-4.5z"/></svg>';return b;
 }
 function setBusy(el,text){
  if(!el)return ()=>{};const original=el.innerHTML;busy=el;el.disabled=true;el.setAttribute('aria-busy','true');
  if(text)el.textContent=text;
  return ()=>{busy=null;if(!el.isConnected)return;el.disabled=false;el.setAttribute('aria-busy','false');el.innerHTML=original;};
 }

 /* Tabs */
 function drawTabs(selected){
  const {list,data}=ctx;list.replaceChildren();
  data.cast.forEach((c,index)=>{
   const name=c.name?.trim()||'Character '+(index+1),state=status(c);
   const tab=element('button',{type:'button',className:'story-character-tab',role:'tab',id:'story-character-tab-'+index,'aria-controls':'story-character-properties','aria-selected':String(index===selected),tabindex:index===selected?'0':'-1',dataset:{status:state}});
   tab.append(marker(state),element('span',{className:'story-cast-tab-name',text:name}));if(perEpisode(c))tab.append(element('span',{className:'story-generation-tag',text:'Changes each episode'}));tab.setAttribute('aria-description',LABELS[state]);
   tab.onclick=()=>{data.activeCharacter=c.id;ctx.persist();ctx.redraw();q('[data-character-tabs] [aria-selected=true]',q('#page'))?.focus();};
   tab.onkeydown=event=>{const n=data.cast.length,next=event.key==='ArrowRight'?(index+1)%n:event.key==='ArrowLeft'?(index+n-1)%n:event.key==='Home'?0:event.key==='End'?n-1:null;if(next!==null){event.preventDefault();list.querySelectorAll('[role=tab]')[next].focus();}};
   list.append(tab);
  });
  const add=element('button',{type:'button',className:'story-character-add','aria-label':'Add character',title:'Add character',text:'+'});
  add.disabled=data.cast.length>=20;
  add.onclick=()=>{if(data.cast.length>=20)return;const c={id:crypto.randomUUID(),name:(data.output==='image'?'Person ':'Character ')+(data.cast.length+1)};data.cast.push(c);data.activeCharacter=c.id;ctx.changed();ctx.redraw();q('[data-property=name]',ctx.root)?.focus();};
  list.append(add);
 }
 function refreshStatus(){
  const {list,data}=ctx;
  data.cast.forEach((c,index)=>{
   const tab=q('#story-character-tab-'+index,list);if(!tab)return;const state=status(c);
   tab.querySelector('.story-cast-status')?.replaceWith(marker(state));tab.setAttribute('aria-description',LABELS[state]);tab.dataset.status=state;
  });
  // Pictures do not need every character created first (owner-approved mock, 2026-11-09).
  const p=progress(),optional=ctx.data.output==='image',ready=optional||(p.created===p.total&&p.total>0);
  const summary=q('[data-cast-progress]',q('#page'));if(summary)summary.textContent=optional?'Optional for pictures: create a look to keep the same person across images.':!visual()?(p.created===p.total?'Every character has a voice':p.created+' of '+p.total+' characters have a voice · Choose a voice for the rest to continue')+sharedNote():'Created '+p.created+' of '+p.total+' · Tested '+p.tested+' of '+p.total+(ready?'':' · Create every character to continue')+sharedNote();
  const next=q('[data-next]',q('#page'));if(next){if(optional&&next.textContent!=='Next: Story Generation')next.textContent='Next: Story Generation';next.disabled=!ready;next.setAttribute('aria-describedby','story-cast-progress');}
 }

 /* From Story */
 function field(c,index,label,key,{options,multiline,onchange}={}){
  const wrap=element('label',{text:label});
  const input=element(options?'select':multiline?'textarea':'input',{'aria-label':'Character '+(index+1)+' '+label,dataset:{character:index,property:key}});
  if(options){
   input.append(new Option('Choose',''));for(const o of options){const [value,text]=Array.isArray(o)?o:[o,o];input.append(new Option(text,value));}
   if(c[key]&&![...input.options].some(o=>o.value===c[key]))input.append(new Option(c[key],c[key]));
  }else{input.maxLength=key==='name'?60:key==='delivery'||key==='appearance'?1000:500;if(multiline)input.rows=3;}
  input.value=c[key]||'';
  input[options?'onchange':'oninput']=()=>{
   c[key]=input.value;if(key==='voice')c.voiceChosen=true;
   if(!visual()&&AUDIO_RESET.includes(key)&&(c.voice_sample||c.tested)){delete c.voice_sample;c.tested=false;}
   ctx.changed();
   if(key==='name'){const name=q('#story-character-tab-'+index+' .story-cast-tab-name',ctx.list);if(name)name.textContent=input.value.trim()||'Character '+(index+1);}
   refreshStatus();onchange?.();
  };
  wrap.append(input);return wrap;
 }
 function properties(c,index){
  const {data,languages}=ctx;
  const section=element('section',{className:'story-cast-props form','aria-labelledby':'story-cast-props-title'});
  section.append(element('h3',{id:'story-cast-props-title',text:'From Story'}),element('p',{className:'help',text:'Filled in from your story. Edit anything that doesn’t fit.'}));
  if(seriesOpen()){const box=element('input',{type:'checkbox'});box.checked=!!c.perEpisode;box.onchange=()=>{c.perEpisode=box.checked;ctx.persist();ctx.redraw();};const label=element('label',{className:'story-cast-each'},box,document.createTextNode(' Changes each episode'));section.append(label,element('p',{className:'help',text:'For a guest or anyone new each time. A voice that fits them is picked when each episode is written.'}));}
  const grid=element('div',{className:'story-character-fields'});
  grid.append(field(c,index,'Name','name'),field(c,index,'Role','role'),field(c,index,'Age group','age_group',{options:['Child','Teenager','Adult','Older adult']}),field(c,index,'Gender','gender',{options:['Female','Male','Non-binary','Unspecified']}));
  const personality=field(c,index,'Personality','personality',{multiline:true});personality.classList.add('story-simple-wide');grid.append(personality);
  if(speaks())grid.append(field(c,index,'Language','language',{options:languages,onchange:()=>{if(!visual())drawCreate(c,index);}}),field(c,index,'Dialect','dialect'));
  section.append(grid);
  const more=element('details',{className:'story-cast-more',open:true},element('summary',{text:'More properties'}));
  const extra=element('div',{className:'story-character-fields'});
  extra.append(field(c,index,'Nationality','nationality'));
  if(speaks())extra.append(field(c,index,'Speaking style','style'),field(c,index,'Emotion','emotion',{options:window.EccoAudioDirection?.emotions||['neutral']}));
  if(speaks()&&visual()){
   const model=ctx.audioModel();
   extra.append(field(c,index,'Voice','voice',{options:(model?.voices||[]).map(v=>[v.id,v.name||v.label||v.id])}),field(c,index,'Delivery instructions','delivery'));
  }
  more.append(extra,button('Save to Character Library',()=>ctx.saveToLibrary(c),'secondary'));
  section.append(more);
  return section;
 }

 /* Create + Test */
 function storyLines(c){
  const own=(ctx.data.plan?.segments||[]).filter(s=>s.character_id===c.id).map(s=>s.text);
  if(own.length)return own.slice(0,3);
  const name=(c.name||'').trim();if(!name)return [];
  const prefix=name.toLowerCase()+':';
  return String(ctx.data.script||'').split(/\n+/).map(l=>l.trim()).filter(l=>l.toLowerCase().startsWith(prefix)).map(l=>l.slice(prefix.length).trim()).filter(Boolean).slice(0,3);
 }
 function audioModels(c){
  const all=(window.EccoAudioModels||[]).filter(m=>!m.pending);
  const fit=all.filter(m=>!c.language||m.languages?.includes(c.language));
  return fit.length?fit:all;
 }
 function currentAudioModel(c){
  const list=audioModels(c),fallback=ctx.audioModel();
  return list.find(m=>m.id===c.model)||list.find(m=>m.id===fallback?.id)||list[0];
 }
 async function voiceSample(c,text,title){
  if(!window.EccoAudioStudio?.sample)throw Error('Audio Studio is still loading. Try again in a moment.');
  if(!c.voice)throw Error('Choose a voice for '+(c.name||'this character')+' first.');
  const model=currentAudioModel(c);
  return window.EccoAudioStudio.sample({...c,model:model?.id},text,{title});
 }
 // After a model change, choose a voice from that model that fits the character and isn't used by anyone else.
 function fitVoice(c){
  const model=currentAudioModel(c),voices=(model?.voices||[]).filter(v=>!v.language||!c.language||v.language===c.language);
  if(!voices.length)return;const used=new Set(ctx.data.cast.filter(x=>x!==c&&(x.model||'')===model.id).map(x=>x.voice));
  const want=/^f/i.test(c.gender||'')?'(feminine|female)':/^m/i.test(c.gender||'')?'(masculine|male)':'',free=voices.filter(v=>!used.has(v.id));
  const pick=(want&&free.find(v=>new RegExp('\\b'+want+'\\b','i').test(v.name||'')))||free[0]||voices[0];c.voice=pick.id;c.voiceChosen=false;
 }
 function sampleText(c){
  return storyLines(c)[0]||(c.name?'Hello, I am '+c.name+'.':'Hello, this is my voice.')+' Welcome to our story.';
 }
 function createAudio(c,index,host){
  const model=currentAudioModel(c);
  if(model&&c.model!==model.id)c.model=model.id;
  const voices=(model?.voices||[]).filter(v=>!v.language||!c.language||v.language===c.language);
  const brief=[ctx.data.genre,c.language||ctx.data.language,c.dialect].filter(Boolean).join(' · ');
  const create=element('section',{className:'story-cast-step form','aria-labelledby':'story-cast-create-title'});
  create.append(element('h3',{id:'story-cast-create-title',text:'Create voice'}));
  const suggestion=field(c,index,'Suggested voice','delivery',{multiline:true});suggestion.append(element('span',{className:'help',text:'Suggested from your story'+(brief?' · '+brief:'')+'. Edit before generating if needed.'}));
  const row=element('div',{className:'story-character-fields'});
  const ready=window.EccoAudioCompute?.readyNow?.();
  row.append(field(c,index,'Audio model','model',{options:audioModels(c).map(m=>[m.id,m.name+(ready&&!ready.includes(m.id)?' (not on this worker)':'')]),onchange:()=>{c.modelChosen=true;fitVoice(c);ctx.persist();drawCreate(c,index);}}),field(c,index,'Voice','voice',{options:voices.map(v=>[v.id,v.name||v.label||v.id])}));
  const created=!!c.voice_sample;
  const go=button(created?'Generate again':'Generate voice',async()=>{
   const done=setBusy(go,'Generating voice…');
   try{const result=await voiceSample(c,sampleText(c),'Character voice · '+(c.name||'Character'));c.voice_sample=result.asset_id;c.tested=false;media.set(result.asset_id,result.url);ctx.changed();drawCreate(c,index);refreshStatus();ctx.status(c.name+'’s voice is ready. Test it below.');}
   catch(error){done();ctx.message(error.message,true);}
  },created?'secondary':'');
  go.dataset.castGenerate='voice';
  create.append(suggestion,row,go);
  if(created){
   const player=element('audio',{controls:true,preload:'metadata','aria-label':'Voice sample for '+(c.name||'this character')});
   mediaURL(c.voice_sample).then(url=>{if(player.isConnected)player.src=url;}).catch(()=>{});
   create.append(element('p',{className:'help story-cast-ready',text:'Voice ready · made with '+(model?.name||'the selected model')}),player);
  }
  const test=element('section',{className:'story-cast-step form','aria-labelledby':'story-cast-test-title'},element('h3',{id:'story-cast-test-title',text:'Test'}));
  if(!created)test.append(element('p',{className:'story-cast-empty',text:'Generate a voice to test it with lines from your story.'}));
  else{
   const player=element('audio',{controls:true,preload:'metadata','aria-label':'Voice test playback',hidden:true});
   const play=async(text,trigger)=>{
    if(!text.trim()){ctx.message('Type a line to hear it first.',true);return;}
    const key=JSON.stringify([c.id,c.voice_sample,c.model,c.voice,c.delivery,c.language,c.dialect,text]);const done=setBusy(trigger);
    try{let url=voiceTests.get(key);if(!url){url=(await voiceSample(c,text,'Character voice test · '+(c.name||'Character'))).url;voiceTests.set(key,url);}if(!player.isConnected)return;player.src=url;player.hidden=false;await player.play().catch(()=>{});}
    catch(error){ctx.message(error.message,true);}finally{done();}
   };
   const lines=storyLines(c);
   if(lines.length){test.append(element('p',{className:'help',text:'Lines from your story'}));lines.forEach((line,i)=>{const b=playButton('Play line '+(i+1),()=>play(line,b));test.append(element('div',{className:'story-cast-line'},b,element('span',{className:'story-cast-line-text',text:'“'+line+'”'})));});}
   else test.append(element('p',{className:'help',text:'Lines from your story appear here once they are assigned to '+(c.name||'this character')+'. Type one below meanwhile.'}));
   const own=element('input',{type:'text',maxlength:'300','aria-label':'Try your own line',placeholder:'Type a line to hear it in this voice'});
   const ownPlay=playButton('Play your line',()=>play(own.value,ownPlay));
   test.append(element('label',{className:'story-cast-own',text:'Or try your own line'},element('div',{className:'story-cast-line'},own,ownPlay)),player,verdict(c,'Sounds right — mark as tested','Not right? Edit the suggestion or switch model or voice, then generate again.','Tested — this voice is ready for the story'));
  }
  host.append(create,test);
 }
 function verdict(c,label,hint,doneText){
  if(c.tested)return element('p',{className:'help story-cast-tested',role:'status'},marker('tested'),document.createTextNode(doneText));
  const mark=button(label,()=>{c.tested=true;ctx.changed();drawCreate(c,ctx.data.cast.indexOf(c));refreshStatus();});
  mark.dataset.castTested='';
  return element('div',{className:'story-cast-verdict'},mark,element('span',{className:'help',text:hint}));
 }
 async function waitForImages(job){
  const started=Date.now();
  for(;;){
   const state=await api('state');const record=state.records?.find(r=>r.kind==='job'&&r.id===job.id);
   if(record&&['error','cancelled'].includes(record.status))throw Error(record.error||'Avatar generation stopped.');
   if(record?.status==='done'){
    const ids=Array.isArray(record.result)?record.result:[record.result];
    const assets=state.records.filter(r=>r.kind==='asset'&&r.media==='image'&&!r.deleted&&(r.job_id===job.id||ids.includes(r.id))).map(r=>r.id);
    if(!assets.length)throw Error('The avatar job finished without an image.');return assets;
   }
   if(Date.now()-started>600000)throw Error('The avatar is still generating. Check Activity before trying again.');
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
 }
 async function generateAvatar(c){
  const model=c.avatar_model||modelProfiles.selected.images;
  const gpu=localStorage.getItem('ecco-compute-image')||window.EccoGPUConnection?.selectedId||'';
  if(!gpu)throw Error('Connect a GPU from Compute to generate avatars.');
  // Real-run fix E3 (2026-11-09): the video's Visual style shapes the avatar.
  const style=ctx.data.output==='video'&&ctx.data.videoStyle?'Style: '+ctx.data.videoStyle+'.':'';
  const prompt=[c.appearance?.trim(),'Character portrait of '+(c.name||'the character')+', head and shoulders, plain background.',style].filter(Boolean).join(' ');
  if(prompt.length>4000)throw Error('Shorten the avatar prompt to 4,000 characters.');
  await window.EccoCompute.validate(gpu,model);
  const job=await api('images',{...modelPayload('images',gpu,model),prompt,negative:'',story_id:activeStory});
  return waitForImages(job);
 }
 function createAvatar(c,index,host){
  const models=AVATAR_MODELS.filter(id=>MODEL_CATALOG[id]&&!MODEL_CATALOG[id].pending);
  if(!models.includes(c.avatar_model))c.avatar_model=models.includes(modelProfiles.selected.images)?modelProfiles.selected.images:models[0];
  const create=element('section',{className:'story-cast-step form','aria-labelledby':'story-cast-create-title'},element('h3',{id:'story-cast-create-title',text:'Create avatar'}));
  const brief=[ctx.data.genre,ctx.data.audience,ctx.data.output==='video'&&ctx.data.videoStyle].filter(Boolean).join(' · ');
  const prompt=field(c,index,'Suggested avatar prompt','appearance',{multiline:true});prompt.append(element('span',{className:'help',text:'Suggested from your story'+(brief?' · '+brief:'')+'. Edit before generating if needed.'}));
  const row=element('div',{className:'story-character-fields'},field(c,index,'Image model','avatar_model',{options:models.map(id=>[id,MODEL_CATALOG[id].name])}));
  const candidates=(c.avatar_candidates||[]).slice(-4),created=!!c.reference_id;
  const go=button(candidates.length?'Generate again':'Generate avatar',async()=>{
   const done=setBusy(go,'Generating avatar…');
   try{const ids=await generateAvatar(c);c.avatar_candidates=[...new Set([...(c.avatar_candidates||[]),...ids])].slice(-8);if(!c.reference_id){c.reference_id=ids[0];c.tested=false;}ctx.changed();drawCreate(c,index);refreshStatus();ctx.status('Avatar ready for '+(c.name||'this character')+'.');}
   catch(error){done();ctx.message(error.message,true);}
  },candidates.length?'secondary':'');
  go.dataset.castGenerate='avatar';
  create.append(prompt,row,go);
  if(!candidates.length&&!created)create.append(element('p',{className:'story-cast-empty',text:'Generate an avatar to see options here.'}));
  else{
   const gallery=element('div',{className:'story-cast-gallery'});
   const preview=element('img',{className:'story-cast-avatar',alt:'Avatar preview for '+(c.name||'this character')});
   if(c.reference_id)mediaURL(c.reference_id).then(url=>{if(preview.isConnected)preview.src=url;}).catch(()=>{});
   const options=element('div',{className:'story-cast-options',role:'group','aria-label':'Avatar options'});
   const shown=c.reference_id&&!candidates.includes(c.reference_id)?[c.reference_id,...candidates].slice(0,4):candidates;
   shown.forEach((id,i)=>{
    const pick=element('button',{type:'button',className:'story-cast-option','aria-label':'Avatar option '+(i+1),'aria-pressed':String(id===c.reference_id)});
    const img=element('img',{alt:''});mediaURL(id).then(url=>{if(img.isConnected)img.src=url;}).catch(()=>{});pick.append(img);
    pick.onclick=()=>{if(c.reference_id===id)return;c.reference_id=id;c.tested=false;ctx.changed();drawCreate(c,index);refreshStatus();q('.story-cast-option[aria-pressed=true]',ctx.root)?.focus();};
    options.append(pick);
   });
   gallery.append(preview,element('div',{className:'story-cast-pick'},element('p',{className:'help',text:'Pick the avatar you like'}),options,element('p',{className:'help',text:'Made with '+(MODEL_CATALOG[c.avatar_model]?.name||'the selected model')})));
   create.append(gallery);
  }
  const test=element('section',{className:'story-cast-step form','aria-labelledby':'story-cast-test-title'},element('h3',{id:'story-cast-test-title',text:'Test'}));
  if(!created)test.append(element('p',{className:'story-cast-empty',text:'Pick an avatar to test it.'}));
  else test.append(element('p',{className:'help',text:'Check that the avatar fits '+(c.name||'this character')+' and the story, then mark it as tested.'}),verdict(c,'Looks right — mark as tested','Not right? Pick another option, edit the prompt or switch model.','Tested — this avatar is ready for the story'));
  host.append(create,test);
 }
 function drawCreate(c,index){
  const host=q('.story-cast-create',ctx.root);if(!host)return;
  const focused=document.activeElement?.closest?.('.story-cast-create')?document.activeElement.dataset?.property||document.activeElement.getAttribute('aria-label'):null;
  host.replaceChildren();
  if(perEpisode(c)){host.append(element('h3',{text:'Picked for each episode'}),element('p',{className:'help',text:'Each episode has a different '+(c.role||c.name||'guest').toLowerCase()+'. A '+(visual()?'look':'voice')+' that fits them is chosen when the episode is written, and you can change it when you review the episode.'}));return;}
  if(visual())createAvatar(c,index,host);else createAudio(c,index,host);
  if(focused)(q('[data-property="'+focused+'"]',host)||q('[aria-label="'+focused+'"]',host))?.focus();
 }

 // Automatic flow (owner-approved mock 2026-11-09): audio opens on a short cast list; the full editor opens from Change.
 const STYLES=[['Expressive storyteller','Big changes in pace and feeling, pauses for effect.'],['Rich and measured','Steady, deep, unhurried.'],['Clear and warm','Even pace, friendly, easy to follow.'],['Bright and brisk','Crisp, confident, quick.'],['Intimate and quiet','Close, soft, slow.']];
 const defaultStyle=d=>['news'].includes(d.type)?'Bright and brisk':['documentary'].includes(d.type)?'Rich and measured':['teaching','training','presentation'].includes(d.type)?'Clear and warm':['storybook','audio-drama'].includes(d.type)?'Expressive storyteller':'Clear and warm';
 const isNarrator=c=>/narrat|storyteller/i.test((c.role||'')+' '+(c.name||''));
 function voiceLabel(c){const m=currentAudioModel(c),v=(m?.voices||[]).find(x=>x.id===c.voice);return (v?.name||c.voice||'No voice yet')+(m?' · '+m.name:'');}
 function roster(){
  const {data,root}=ctx,list=element('div',{className:'story-cast-roster',role:'list','aria-label':'Cast'});
  if(!data.narrationStyle)data.narrationStyle=defaultStyle(data);
  data.cast.forEach((c,index)=>{
   const row=element('div',{className:'story-cast-row',role:'listitem'});
   const who=element('div',{className:'story-cast-who'},element('b',{text:c.name||'Character '+(index+1)}),element('span',{className:'help',text:[c.role,c.gender&&c.gender!=='Unspecified'?c.gender:'',c.age_group].filter(Boolean).join(' · ')}));
   const voice=element('span',{className:'help story-cast-voice',text:perEpisode(c)?'Picked for each episode':voiceLabel(c)});
   const player=element('audio',{preload:'none',hidden:true,'aria-label':'Voice sample for '+(c.name||'character')});
   const hear=playButton('Hear '+(c.name||'this voice'),async()=>{const done=setBusy(hear);try{let url=c.voice_sample?await mediaURL(c.voice_sample):voiceTests.get('roster|'+c.id+'|'+c.model+'|'+c.voice);if(!url){url=(await voiceSample(c,sampleText(c),'Character voice · '+(c.name||'Character'))).url;voiceTests.set('roster|'+c.id+'|'+c.model+'|'+c.voice,url);}player.src=url;player.hidden=false;await player.play().catch(()=>{});}catch(error){ctx.message(error.message,true);}finally{done();}});
   hear.disabled=perEpisode(c)||!c.voice;
   const change=button('Change',()=>{data.activeCharacter=c.id;data.castDetail=true;ctx.persist();ctx.redraw();});change.classList.add('secondary');change.setAttribute('aria-label','Change '+(c.name||'character')+'’s voice');
   row.append(who,voice,hear,change,player);
   if(isNarrator(c)){const style=element('select',{'aria-label':'Narration style'});for(const [n] of STYLES)style.add(new Option(n,n));style.value=data.narrationStyle;style.onchange=()=>{data.narrationStyle=style.value;ctx.changed();};
    row.append(element('label',{className:'story-cast-style help'},document.createTextNode('Narration style'),style));}
   list.append(row);
  });
  root.append(element('p',{className:'help',text:'Each character has a voice picked for them. Hear any of them, and use Change only if one isn’t right.'}),list);
 }
 function render(context){
  ctx=context;const {data,root}=ctx;
  // Characters without a voice yet (the starter Host/Guest or Narrator) get their own voices too.
  if(!visual()&&data.cast.some(c=>!c.voice)){window.EccoStoryVoices?.assign(data.cast,ctx.audioModel());ctx.persist();}
  if(seriesOpen())for(const c of data.cast)if(c.perEpisode===undefined)c.perEpisode=/guest|celebrit|interviewee/i.test((c.name||'')+' '+(c.role||''));
  const selected=Math.max(0,data.cast.findIndex(c=>c.id===data.activeCharacter));data.activeCharacter=data.cast[selected]?.id;
  drawTabs(selected);
  const compact=!visual()&&!data.castDetail&&data.cast.length>0,tabs=q('[data-character-tabs]',q('#page'));if(tabs)(tabs.closest('.story-cast-bar')||tabs).hidden=compact;
  if(compact){root.removeAttribute('aria-labelledby');root.replaceChildren();roster();refreshStatus();return;}
  root.setAttribute('aria-labelledby','story-character-tab-'+selected);root.replaceChildren();
  const c=data.cast[selected];
  if(!c){
   // Pictures start with no characters (audit I12). A person is added only to keep them the same across pictures.
   if(data.output==='image'){const empty=element('div',{className:'story-cast-empty'});empty.append(element('p',{className:'help',text:'No characters needed for a picture.'}));const add=element('button',{type:'button',className:'secondary',text:'+ Add a person',dataset:{addPerson:''}});add.onclick=()=>q('.story-character-add',ctx.list)?.click();empty.append(add);root.append(empty);}
   refreshStatus();return;
  }
  if(!visual()){const back=button('← Back to cast list',()=>{data.castDetail=false;ctx.persist();ctx.redraw();});back.classList.add('secondary');back.dataset.castBack='';root.append(back);}
  root.append(properties(c,selected),element('div',{className:'story-cast-create'}));
  drawCreate(c,selected);refreshStatus();
 }
 window.EccoStoryCharacters={render,status:c=>ctx?status(c):'none',progress:()=>ctx?progress():null,refresh:()=>ctx&&refreshStatus()};
})();
