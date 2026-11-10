// Automatic episodes (owner-approved mock "Automatic series", 2026-11-09).
// One pilot episode, plain-words changes, one approval; later episodes run on their own.
// Backend contract: backend/README.md → "Automatic episodes (auto series)".
(()=>{
 const STAGES=[['source','Reading the episode'],['cast','Finding the characters'],['voices','Giving each one a voice'],['script','Writing it the way people speak'],['delivery','Feelings and delivery for every line'],['sounds','Background sounds'],['assets','Preparing voices and sounds'],['record','Recording'],['check','Checking it']];
 const PHASE={source:0,cast:1,voices:2,script:3,delivery:4,sounds:5,assets:6,record:7,recording:7,check:8,listen:8};
 const CHECKS=[['distinct_voices','A different voice for each character'],['gender_age','Voices fit each character’s gender and age'],['listen_back','Every word was spoken'],['loudness','Even volume, no long silences'],['delivery','Feelings and delivery'],['sounds','Background sounds']];
 const ZONES=['Asia/Kolkata','America/Los_Angeles','UTC'];
 const LABEL={working:['Being made',''],question:['1 question','bad'],made:['Ready to listen','meh'],held:['Waiting for your OK','meh'],published:['Published','ok'],error:['Stopped','bad']};
 const el=(tag,{dataset,...props}={},...kids)=>{const n=Object.assign(document.createElement(tag),props);Object.assign(n.dataset,dataset||{});n.append(...kids.filter(k=>k!=null));return n;};
 let timer=null;
 // The Schedule tab can repaint while a request runs; always draw into the box that is on screen.
 const live=root=>root?.isConnected?root:document.querySelector('[data-auto]');

 // Speech model for designed voices on the ready GPU: VoxCPM2 for English, IndicF5 for Indian languages.
 function setup(ctx){
  const gpu=window.EccoAudioCompute?.gpu?.();if(!gpu)return {reason:'Automatic episodes are recorded on a GPU (A100 or B200). Connect one in Compute, then come back.'};
  const order=ctx.data.language==='English'?['voxcpm2','chatterbox','indicf5']:['indicf5','voxcpm2'],model=order.find(m=>gpu.models.includes(m));
  if(!model)return {reason:'The connected '+gpu.compute.toUpperCase()+' does not have a voice model for automatic episodes (VoxCPM2, IndicF5 or Chatterbox).'};
  return {snapshot:{model,compute:gpu.compute,genre:ctx.genre()}};
 }
 function workflowBody(ctx,snapshot,review){
  const d=ctx.data,s=ctx.schedule(),shape=d.storyShape,n=shape.episodes,b=ctx.series();
  const mode=shape.open?(ctx.isNews()?{source_mode:'news',prompt:b.about,lookback:+b.lookback||24,count:+b.count||3}:{source_mode:'series',prompt:b.about,series_about:b.about,series_changes:b.changes,series_plan:b.plan.filter(t=>t.trim()),no_repeat:true})
   :{source_mode:'chapters',next_chapter:1,total_chapters:n,chapters:Array.from({length:n},(_,i)=>ctx.episodeText(i).slice(0,20000))};
  const ends=shape.open&&(s.ends||'never')==='never'?{end_mode:'never'}:{end_mode:'runs',run_count:n};
  return {id:d.workflowId,workflow_type:'audio',name:d.workflowName||d.title||'Series',...mode,...ends,source_story_id:ctx.storyId(),repeat:s.repeat,weekday:+s.day,start_date:s.start,time:s.time,timezone:s.tz,
   auto:true,review_before_publish:review,audio_snapshot:{...snapshot,script_brief:{title:d.title,audience:d.audience,narration_style:d.narrationStyle||''}},
   auto_options:{language:d.language||'English',audience:String(d.audience||'').slice(0,100)}};
 }
 const auto=ctx=>ctx.data.auto||(ctx.data.auto={});

 function mount(root,ctx){
  clearTimeout(timer);root.replaceChildren();const a=auto(ctx);
  root.append(el('h3',{id:'story-auto-heading',textContent:'Automatic episodes'}));
  if(!a.workflowId){
   root.append(el('p',{className:'help',textContent:'The workflow picks the characters, voices, feelings and background sounds for every episode. You hear episode 1 first, tell us what to change in plain words, then approve the series.'}));
   const status=el('p',{className:'help',role:'status'}),start=el('button',{type:'button',textContent:'Make the pilot episode'});start.dataset.autoPilot='';
   const plan=setup(ctx);if(plan.reason){start.disabled=true;status.textContent=plan.reason;}
   start.onclick=()=>void pilot(root,ctx,start,status);root.append(el('div',{className:'row'},start),status);return;
  }
  root.append(el('p',{className:'help',dataset:{autoState:''},textContent:'Loading episodes…'}));void refresh(root,ctx);
 }
 async function pilot(root,ctx,button,status){
  const plan=setup(ctx);if(plan.reason){status.textContent=plan.reason;return;}
  if(!ZONES.includes(ctx.schedule().tz)){status.textContent='Automatic schedules run on India, Pacific or UTC time for now. Choose India or Pacific above.';return;}
  button.disabled=true;button.setAttribute('aria-busy','true');status.textContent='Saving the series…';
  try{
   await ctx.ensureSaved();const d=ctx.data;d.workflowId=d.workflowId||crypto.randomUUID();
   // Pilot waits for your OK; your publish choice is applied when you approve the series.
   const saved=await ctx.api('audio/workflows/save',workflowBody(ctx,plan.snapshot,true));d.workflowId=saved.id;d.workflowName=saved.name;
   status.textContent='Starting episode 1…';
   const started=await ctx.api('audio/auto/pilot',{workflow_id:saved.id,request_id:crypto.randomUUID()});
   Object.assign(auto(ctx),{workflowId:saved.id,pilotId:started.episode_id,snapshot:plan.snapshot});ctx.persist();const box=live(root);if(box)mount(box,ctx);
  }catch(error){status.textContent=error.message;button.disabled=false;button.setAttribute('aria-busy','false');}
 }
 async function refresh(root,ctx){
  const a=auto(ctx);root=live(root);if(!root)return;
  try{const result=await ctx.api('audio/auto/episodes',{workflow_id:a.workflowId});root=live(root);if(!root)return;a.approved=!!result.series?.approved;paint(root,ctx,result.episodes||[]);
   if((result.episodes||[]).some(e=>e.status==='working')||!(result.episodes||[]).length)timer=setTimeout(()=>void refresh(root,ctx),10000);
  }catch(error){const state=root.querySelector('[data-auto-state]')||root.appendChild(el('p',{className:'help'}));state.textContent='Could not load episodes: '+error.message;timer=setTimeout(()=>void refresh(root,ctx),30000);}
 }
 function paint(root,ctx,episodes){
  const a=auto(ctx);root.replaceChildren(el('h3',{id:'story-auto-heading',textContent:'Automatic episodes'}));
  const list=[...episodes].sort((x,y)=>x.episode-y.episode),first=list[0];
  if(!first){root.append(el('p',{className:'help',dataset:{autoState:''},textContent:'Episode 1 starts within a minute…'}));return;}
  if(!a.approved){root.append(episodeCard(root,ctx,first,true));return;}
  root.append(el('p',{className:'help',textContent:'Series approved. '+(ctx.schedule().review==='auto'?'Each episode publishes on its own; you get a note after each.':'Each episode waits for your OK.')}));
  const box=el('div',{className:'story-auto-episodes'});for(const ep of list.reverse())box.append(episodeCard(root,ctx,ep,false));root.append(box);
 }
 function episodeCard(root,ctx,ep,isPilot){
  const [label,tone]=LABEL[ep.status]||[ep.status,''],card=el('article',{className:'story-auto-episode'});card.dataset.autoEpisode=ep.id;
  card.append(el('div',{className:'story-auto-head'},el('b',{textContent:(isPilot?'Pilot · ':'')+'Episode '+ep.episode+(ep.title?' · '+ep.title:'')}),el('span',{className:'story-auto-badge '+tone,textContent:label})));
  if(ep.status==='working'){
   const at=PHASE[ep.phase]??0,ol=el('ol',{className:'story-auto-stages'});
   STAGES.forEach(([,text],i)=>{const li=el('li',{textContent:(i<at?'✓ ':i===at?'… ':'○ ')+text});if(i<at)li.className='done';if(i===at)li.setAttribute('aria-current','step');ol.append(li);});
   card.append(ol,el('p',{className:'help',textContent:(ep.progress||'Working')+' · No clicks needed.'}));return card;
  }
  if(ep.status==='error'){card.append(el('p',{className:'help',textContent:ep.error||'This episode stopped.'}));return card;}
  const who=[ep.returning?.length&&'Returning: '+ep.returning.join(', '),ep.new_voices?.length&&'New voices: '+ep.new_voices.join(', ')].filter(Boolean).join(' · ');if(who)card.append(el('p',{className:'help',textContent:who}));
  if(ep.asset_id){const player=el('audio',{controls:true,preload:'metadata'});player.setAttribute('aria-label','Episode '+ep.episode);window.EccoStorage?.mediaURL?.(ep.asset_id).then(url=>{if(player.isConnected)player.src=url;}).catch(()=>{});card.append(player);}
  card.append(checks(ep));if(ep.held_reason)card.append(el('p',{className:'help',textContent:ep.held_reason}));
  for(const q of ep.questions||[])if(q.answer==null)card.append(question(root,ctx,ep,q));
  for(const c of ep.changes||[])card.append(el('p',{className:'help',textContent:'✓ Changed: “'+c.instruction+'”'}));
  card.append(changeBox(root,ctx,ep));
  const actions=el('div',{className:'row story-auto-actions'});
  if(isPilot){const ok=el('button',{type:'button',textContent:'Sounds good, approve the series'});ok.dataset.autoApprove='';ok.disabled=!['made','held','published'].includes(ep.status);ok.onclick=()=>void approve(root,ctx,ok);actions.append(ok);}
  else if(['made','held'].includes(ep.status)){const pub=el('button',{type:'button',textContent:'Publish'});pub.onclick=()=>void act(root,ctx,pub,'audio/auto/publish',{episode_id:ep.id});actions.append(pub);}
  if(actions.childNodes.length)card.append(actions);
  return card;
 }
 function checks(ep){
  const ul=el('ul',{className:'story-auto-checks'});
  for(const [key,text] of CHECKS){const c=ep.checks?.[key];if(!c)continue;const mark={passed:'✓',failed:'✗',partial:'~',skipped:'–'}[c.status]||'–';
   ul.append(el('li',{className:c.status,textContent:mark+' '+text+(c.status==='skipped'?' (not checked)':c.status==='partial'?' (partly checked)':'')+(c.status==='failed'&&c.detail?': '+c.detail:'')}));}
  return ul;
 }
 function question(root,ctx,ep,q){
  const box=el('fieldset',{className:'story-auto-question'},el('legend',{textContent:q.text}));
  q.options.forEach((o,i)=>{const pick=el('button',{type:'button',className:'secondary',textContent:'Use '+o.label}),row=el('div',{className:'row'});
   if(o.sample_ref){const p=el('audio',{controls:true,preload:'none'});p.setAttribute('aria-label',o.label);window.EccoStorage?.mediaURL?.(o.sample_ref).then(u=>{if(p.isConnected)p.src=u;}).catch(()=>{});row.append(p);}
   pick.onclick=()=>void act(root,ctx,pick,'audio/auto/answer',{episode_id:ep.id,question_id:q.id,option:i});row.append(pick);box.append(row);});
  return box;
 }
 function changeBox(root,ctx,ep){
  const id='story-auto-change-'+ep.id,box=el('div',{className:'story-auto-change'}),label=el('label',{htmlFor:id,textContent:'Tell us what to change'}),text=el('textarea',{id,rows:2,maxLength:1000,placeholder:'For example: the narrator warmer and slower; the villain much deeper; less music under the voices'});
  const go=el('button',{type:'button',className:'secondary',textContent:'Apply and remake'}),status=el('p',{className:'help',role:'status'});
  go.disabled=ep.status==='working';go.onclick=()=>{if(!text.value.trim()){status.textContent='Write what you want changed first.';return;}void act(root,ctx,go,'audio/auto/change',{episode_id:ep.id,instruction:text.value.trim()},status);};
  box.append(label,text,el('div',{className:'row'},go,el('span',{className:'help',textContent:'Plain words. It applies to later episodes too.'})),status);return box;
 }
 async function act(root,ctx,button,path,body,status){
  button.disabled=true;button.setAttribute('aria-busy','true');
  try{await ctx.api(path,body);clearTimeout(timer);await refresh(root,ctx);}
  catch(error){if(status)status.textContent=error.message;else ctx.message(error.message,true);button.disabled=false;button.setAttribute('aria-busy','false');}
 }
 async function approve(root,ctx,button){
  const a=auto(ctx);button.disabled=true;button.setAttribute('aria-busy','true');
  try{
   // Apply the publish choice from Schedule now that the pilot is approved.
   const review=ctx.schedule().review!=='auto',saved=(await ctx.api('audio/workflows/status')).workflows?.find(w=>w.id===a.workflowId);
   if(saved&&saved.review_before_publish!==review)await ctx.api('audio/workflows/save',{...saved,review_before_publish:review});
   const result=await ctx.api('audio/auto/approve',{workflow_id:a.workflowId});a.approved=true;a.nextRun=result.workflow?.next_run||null;ctx.persist();await refresh(root,ctx);
  }catch(error){ctx.message(error.message,true);button.disabled=false;button.setAttribute('aria-busy','false');}
 }
 window.EccoStoryAuto={mount,workflowBody,setup};
})();
