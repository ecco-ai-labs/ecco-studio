'use strict';
/* Story Generation (owner-approved mocks, 2026-11-10).
   One screen per story: an overall progress bar that is the sum of every worker's progress, one row per worker or
   clip (like a multi-threaded download), an activity log, error popups that say what to do next, and, once the
   result is ready, review with targeted fixes and one Publish button.
   The Audio, Image and Video studios still submit every job; this screen only starts, watches, fixes and publishes. */
(()=>{
 const q=(s,r=document)=>r?.querySelector(s),all=(s,r=document)=>[...(r?.querySelectorAll(s)||[])];
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ACTIVE=['queued','running','cancelling','paused'],FAILED=['failed','error'];
 const FPS=25,MAX_FIX_FRAMES=24;
 const NOUN={audio:'audio',image:'images',video:'video'},LABEL={audio:'Audio',image:'Image',video:'Video'};
 const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
 const write=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
 const session=(key,fallback)=>{try{return JSON.parse(sessionStorage.getItem(key))??fallback;}catch{return fallback;}};
 const sessionWrite=(key,value)=>{try{sessionStorage.setItem(key,JSON.stringify(value));}catch{}};
 // Errors already announced are remembered across reloads and tabs, so an old failed run never pops up again.
 const shownErrors=story=>{try{return JSON.parse(localStorage.getItem('ecco-gen-errors-shown:'+story))??[];}catch{return [];}};
 const rememberShown=(story,keys)=>{try{localStorage.setItem('ecco-gen-errors-shown:'+story,JSON.stringify(keys.slice(-20)));}catch{}};
 const records=()=>typeof state!=='undefined'&&state?.records||[];
 const legacy=()=>typeof LEGACY_STORY==='undefined'?'':LEGACY_STORY;
 const ofStory=(r,story)=>(r.story_id||legacy())===story;
 const clock=()=>Date.now()/1000;
 function duration(seconds){seconds=Math.max(0,Math.round(seconds||0));const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return h?h+'h '+String(m).padStart(2,'0')+'m':m+'m '+String(s).padStart(2,'0')+'s';}
 function remaining(seconds){if(seconds==null||!isFinite(seconds))return 'Estimating…';if(seconds<60)return 'under a minute';const low=Math.max(1,Math.round(seconds*.85/60)),high=Math.max(low,Math.round(seconds*1.2/60));return low===high?'about '+low+' min':'about '+low+'–'+high+' min';}
 const clampPct=x=>Math.max(0,Math.min(100,Number(x)||0));
 const jobRecord=id=>id?records().find(r=>r.kind==='job'&&r.id===id):null;
 function results(job){if(!job)return [];const ids=[].concat(job.result||[],job.output_asset_id||[]).filter(Boolean);return records().filter(a=>a.kind==='asset'&&!a.deleted&&(ids.includes(a.id)||a.job_id===job.id));}
 function latestAsset(kind,story){return records().filter(a=>a.kind==='asset'&&!a.deleted&&a.media===kind&&ofStory(a,story)).sort((a,b)=>(b.created||0)-(a.created||0))[0]||null;}

 // ---------- Error advice: what the person can do next ----------
 function advice(message,kind){
  const text=String(message||'');
  if(/out of memory|OOM|CUDA error|memory/i.test(text))return {cause:'The GPU ran out of memory.',steps:['Lower the resolution or clip length in Model Settings, then generate again.','Or choose a GPU with more memory in Model Settings.'],action:'settings',label:'Open Model Settings'};
  if(/not ready|unavailable|disconnect|reconnect|no (connected )?gpu|select a connected gpu|worker/i.test(text))return {cause:'The GPU or its model service is not available right now.',steps:['Check Compute in Model Settings and select a connected GPU.','Then generate again. Finished parts are kept.'],action:'settings',label:'Open Model Settings'};
  if(/approved images|choose the images|reference/i.test(text))return {cause:'The video needs an approved image for each scene.',steps:['Choose Prepare Images, approve one image per scene, then generate the video.'],action:'images',label:'Prepare Images'};
  if(/storage|network|failed to fetch|timed? ?out|connection/i.test(text))return {cause:'The connection to storage or the GPU dropped.',steps:['Check your internet connection, then try again.','Finished parts are kept; only what was in progress is redone.'],action:'retry',label:'Try again'};
  if(/script|turn|speaker|character/i.test(text)&&kind==='audio')return {cause:'The script needs a fix before it can be recorded.',steps:['Choose Edit story, fix the script or characters, then generate again.'],action:'edit',label:'Edit story'};
  return {cause:'',steps:['Try again. Finished parts are kept.','If it fails again, open Model Settings to try another model or GPU, or copy the details from Activity for support.'],action:'retry',label:'Try again'};
 }

 // ---------- Progress snapshots (real job data only) ----------
 function unitStatus(s){s=String(s||'').toLowerCase();if(/complete|done/.test(s))return 'done';if(/fail|error/.test(s))return 'failed';if(/stop|cancel/.test(s))return 'stopped';if(/generat|running|preparing|saving|mix/.test(s))return 'running';return 'waiting';}
 function videoSnapshot(story){
  const tracked=localStorage.getItem('ecco-video-job:'+story);
  let job=jobRecord(tracked);
  if(window.EccoClipProgress&&(!job||window.EccoClipProgress.isSequence(job)))job=window.EccoClipProgress.select(records(),story,tracked)[0]||job;
  if(!job)return null;
  const sequence=window.EccoClipProgress?.isSequence(job);let units=[];
  if(sequence){
   units=window.EccoClipProgress.clips(job,records()).map((c,i)=>{const child=records().find(r=>r.id===job.children?.[i]);return {id:'clip-'+c.number,name:'Clip '+c.number,detail:c.detail||(c.status==='Waiting'?'Starts when a worker is free.':c.status),pct:c.percent,status:unitStatus(c.status),worker:workerName(child),error:child?.error||''};});
  }else if(job.scene_count>1){
   const at=Math.min(job.scene_count-1,job.scene_index||0),step=job.step_total?(job.step||0)/job.step_total:0;
   units=Array.from({length:job.scene_count},(_,i)=>({id:'scene-'+(i+1),name:'Scene '+(i+1),pct:job.status==='done'||i<at?100:i===at?Math.round(step*100):0,status:job.status==='done'||i<at?'done':i===at&&ACTIVE.includes(job.status)?'running':FAILED.includes(job.status)&&i===at?'failed':'waiting',detail:i===at&&job.step_total?'Sampling step '+(job.step||0)+' of '+job.step_total:'',worker:workerName(job)}));
  }else units=[{id:'video',name:'Video',pct:job.status==='done'?100:clampPct(job.overall_percent),status:job.status==='done'?'done':FAILED.includes(job.status)?'failed':ACTIVE.includes(job.status)?'running':'waiting',detail:job.progress||'',worker:workerName(job)}];
  const overall=job.status==='done'?100:sequence||!job.overall_percent?units.reduce((n,u)=>n+u.pct,0)/Math.max(1,units.length):clampPct(job.overall_percent);
  const done=units.filter(u=>u.status==='done').length,noun=sequence?'clip':units.length>1?'scene':'video';
  return {kind:'video',key:job.id,job,status:job.status,units,overall,started:job.started||job.created,eta:job.eta_seconds,
   headline:units.length>1?units.length+' '+noun+'s'+(workers(units)>1?' on '+workers(units)+' workers':''):'One video',
   counts:units.length>1?[[cap(noun)+'s done',done+' of '+units.length]]:[],error:job.error||units.find(u=>u.status==='failed')?.error||'',assets:results(job)};
 }
 function imageSnapshot(story){
  const job=jobRecord(localStorage.getItem('ecco-image-job:'+story));if(!job)return null;
  const total=Math.max(1,Number(job.total||job.request?.count||job.count)||1),made=results(job).length,step=/(\d+)\s*(?:\/|of)\s*(\d+)/i.exec(job.progress||'');
  const running=ACTIVE.includes(job.status),stepPct=step&&Number(step[2])?Number(step[1])/Number(step[2])*100:null;
  const units=Array.from({length:total},(_,i)=>{const finished=job.status==='done'||i<made,active=running&&i===made;return {id:'image-'+(i+1),name:total>1?'Image '+(i+1):'Image',pct:finished?100:active?(stepPct??null):0,status:finished?'done':active?'running':FAILED.includes(job.status)&&i===made?'failed':'waiting',detail:active?job.progress||'Preparing the model':'',worker:workerName(job)};});
  const overall=job.status==='done'?100:units.reduce((n,u)=>n+(u.pct??0),0)/units.length;
  return {kind:'image',key:job.id,job,status:job.status,units,overall,started:job.started||job.created,eta:job.eta_seconds,headline:total+' image'+(total>1?'s':''),counts:[['Images done',made+' of '+total]],error:job.error||'',assets:results(job)};
 }
 function audioSnapshot(story){
  const run=window.EccoAudioTasks?.get?.(story);if(!run?.rows?.length)return null;
  let weight=0,sum=0;const units=[];
  for(const row of run.rows){
   const s=row.steps,valid=s&&s.total>0&&s.completed>=0,status=row.status==='done'?'done':FAILED.includes(row.status)?'failed':row.status==='cancelled'?'stopped':['running','queued','cancelling'].includes(row.status)?'running':'waiting';
   const pct=status==='done'?100:valid?s.completed/s.total*100:status==='running'?null:0,w=row.key==='speech'&&valid?s.total:1;
   weight+=w;sum+=w*(pct??(status==='running'?15:0));
   units.push({id:row.key,name:row.name,pct,status,detail:valid&&row.key==='speech'?s.completed+' of '+s.total+' passages'+(row.message&&!/passages/.test(row.message)?' · '+row.message:''):row.message||'',worker:row.key==='speech'?'Speech worker':row.key.startsWith('sound')?'Sound worker':row.key==='mix'?'Mixer':'',steps:valid?s:null,error:FAILED.includes(row.status)?row.message:''});
  }
  const speech=units.find(u=>u.id==='speech'),status=units.some(u=>u.status==='failed')?'failed':units.some(u=>u.status==='stopped')?'cancelled':units.every(u=>u.status==='done')?'done':units.some(u=>u.status==='running')?'running':'queued';
  const sounds=units.filter(u=>u.id.startsWith('sound-'));
  return {kind:'audio',key:String(run.id),run,status,units,overall:status==='done'?100:sum/Math.max(1,weight),started:run.id/1000,eta:null,
   headline:(speech?.steps?speech.steps.total+' passages':'Speech')+(sounds.length?' and '+sounds.length+' sound effect'+(sounds.length>1?'s':''):''),
   counts:[...(speech?.steps?[['Passages',speech.steps.completed+' of '+speech.steps.total]]:[]),...(sounds.length?[['Sound effects',sounds.filter(u=>u.status==='done').length+' of '+sounds.length]]:[])],
   error:units.find(u=>u.status==='failed')?.error||'',assets:[]};
 }
 function workerName(r){if(!r)return '';const gpu=window.EccoGPUPicker?.gpus?.find(g=>g.id===(r.gpu||r.worker_id||r.pod));return gpu?gpu.name+' · '+gpu.label:r.gpu_name||r.worker||'';}
 const workers=units=>new Set(units.map(u=>u.worker).filter(Boolean)).size;
 const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
 function snapshot(kind,story){return kind==='video'?videoSnapshot(story):kind==='image'?imageSnapshot(story):audioSnapshot(story);}

 // ---------- Activity log (per story, this browser session) ----------
 function logKey(story){return 'ecco-gen-log:'+story;}
 function track(snap,story){
  const key=logKey(story),saved=session(key,{key:'',units:{},items:[]});
  if(saved.key!==snap.key){saved.key=snap.key;saved.units={};saved.items=[{t:clock(),m:'Generation started.'}];}
  for(const u of snap.units){const before=saved.units[u.id];if(before===u.status)continue;saved.units[u.id]=u.status;
   const m=u.status==='done'?u.name+' finished.':u.status==='running'?u.name+' started'+(u.worker?' on '+u.worker:'')+'.':u.status==='failed'?u.name+' failed'+(u.error?': '+u.error:'.'):u.status==='stopped'?u.name+' stopped.':'';
   if(m&&(before||u.status!=='waiting'))saved.items.push({t:clock(),m});}
  const last=saved.items[saved.items.length-1]?.m,end=snap.status==='done'?'Ready to review.':FAILED.includes(snap.status)?'Generation stopped with an error.':snap.status==='cancelled'?'Generation stopped.':'';
  if(end&&last!==end)saved.items.push({t:clock(),m:end});
  saved.items=saved.items.slice(-40);sessionWrite(key,saved);return saved.items;
 }

 // ---------- Mounting ----------
 let ctx=null,root=null,timer=null,progressSig='',reviewSig='',autoStartUntil=0;
 function mount(page,options){
  if(!page)return;
  const same=ctx&&ctx.story===options.story&&ctx.kind===options.kind&&root?.isConnected&&root.parentElement===page;
  ctx={...ctx,...options};
  if(!same){
   root?.remove();q('#story-gen-settings')?.remove();progressSig='';reviewSig='';
   root=document.createElement('section');root.id='story-generation';root.className='story-gen';root.dataset.inlinePanel='';root.setAttribute('aria-label','Story generation');
   root.innerHTML='<div class="story-gen-toolbar"><div class="story-gen-state"><span class="story-gen-chip" data-gen-chip></span><span class="help" data-gen-summary></span></div><div class="story-gen-actions"><button type="button" class="secondary" data-gen-settings aria-controls="story-gen-settings" aria-expanded="false"></button><button type="button" class="secondary" data-gen-stop hidden>Stop generation</button><button type="button" class="secondary" data-gen-start></button><button type="button" class="secondary" data-gen-download hidden>Download</button><button type="button" data-publish disabled>Publish</button></div></div><p class="help" data-gen-note></p><div data-gen-progress></div><div data-gen-review></div><div class="row"><button type="button" class="secondary" data-next-episode hidden>Start next episode / chapter</button></div>';
   const anchor=q('#story-simple-publishing',page);if(anchor)anchor.after(root);else page.prepend(root);
   q('[data-gen-settings]',root).onclick=()=>toggleSettings();
   q('[data-gen-stop]',root).onclick=()=>ctx.stop?.();
   q('[data-gen-start]',root).onclick=()=>start();
   q('[data-gen-download]',root).onclick=()=>download();
   q('[data-publish]',root).onclick=()=>publish();
   q('[data-next-episode]',root).onclick=()=>ctx.nextEpisode?.();
  }
  q('[data-gen-settings]',root).textContent='Model Settings · '+LABEL[ctx.kind];
  q('[data-next-episode]',root).hidden=!ctx.recurring;
  settingsDrawer(page);
  for(const child of [...page.children])if(child!==root&&child.id!=='story-gen-settings'&&child.id!=='story-simple-publishing'&&child.tagName!=='DIALOG'&&!child.hidden){child.hidden=true;child.dataset.storyGenHidden='';}
  if(options.autoStart){autoStartUntil=Date.now()+20000;ctx.autoStart=false;}
  if(!timer)timer=setInterval(update,1000);
  update();
 }
 function settingsDrawer(page){
  let drawer=q('#story-gen-settings');
  if(!drawer){drawer=document.createElement('aside');drawer.id='story-gen-settings';drawer.className='story-gen-drawer panel';drawer.hidden=true;drawer.dataset.inlinePanel='';drawer.setAttribute('aria-labelledby','story-gen-settings-title');
   drawer.innerHTML='<div class="section-head"><h2 id="story-gen-settings-title"></h2><button type="button" class="secondary" data-close aria-label="Close Model Settings">Close</button></div><p class="help">Changes apply to the next generation or fix. Anything already running keeps its settings.</p><div data-drawer-body></div>';
   page.append(drawer);q('[data-close]',drawer).onclick=()=>toggleSettings(false);
   drawer.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();toggleSettings(false);}});}
  q('#story-gen-settings-title',drawer).textContent='Model Settings · '+LABEL[ctx.kind];
  const body=q('[data-drawer-body]',drawer),form=q('#'+ctx.kind+'-form',page);
  if(form&&form.parentElement!==body){const grid=form.parentElement;body.prepend(form);const advanced=q('.story-simple-advanced',form);if(advanced)advanced.open=true;if(grid&&grid!==page&&!grid.hidden){grid.hidden=true;grid.dataset.storyGenHidden='';}}
  for(const extra of all('.story-simple-script-review',page))if(extra.parentElement!==body)body.append(extra);
 }
 function toggleSettings(open){
  const drawer=q('#story-gen-settings'),button=q('[data-gen-settings]',root);if(!drawer)return;
  open=open??drawer.hidden;drawer.hidden=!open;button?.setAttribute('aria-expanded',String(open));
  if(open)(q('summary, select, input, button',q('[data-drawer-body]',drawer))||q('[data-close]',drawer))?.focus();else button?.focus();
 }
 function generateButton(){return q('#generate-'+ctx.kind);}
 function busyText(){const s=q(ctx.kind==='audio'?'#audio-job-status':'#'+ctx.kind+'-status');return s?.textContent?.trim()||'';}
 function start(){
  const button=generateButton();
  if(!button){window.EccoErrors?.show('The '+NOUN[ctx.kind]+' studio is still loading. Try again in a moment.',{title:'Generation could not start'});return false;}
  if(button.disabled||button.getAttribute('aria-busy')==='true'){window.EccoErrors?.show(busyText()||'Generation is already running.',{title:'Generation could not start'});return false;}
  const previous=snapshot(ctx.kind,ctx.story)?.key;if(previous)rememberShown(ctx.story,[...shownErrors(ctx.story).filter(k=>k!==previous),previous]);autoStartUntil=0;button.click();setTimeout(update,300);return true;
 }
 async function download(){const asset=current().asset;if(!asset)return;try{if(ctx.kind==='audio'){q('[data-download-audio="'+(window.CSS?.escape?CSS.escape(asset.id):asset.id)+'"]')?.click();return;}const url=typeof media==='function'?media(asset):'';if(!url)throw Error('The file is still loading. Try again in a moment.');const a=document.createElement('a');a.href=url;a.download=(asset.title||'ecco-'+ctx.kind).replace(/[\\/:*?"<>|]+/g,'-');a.click();}catch(error){window.EccoErrors?.show(error,{title:'Download failed'});}}
 async function publish(){const button=q('[data-publish]',root),asset=current().asset;button.disabled=true;try{await ctx.publish?.(asset);}catch(error){window.EccoErrors?.show(error,{title:'Publish could not start'});}finally{if(button.isConnected)button.disabled=!current().asset;}}

 function current(){
  const snap=snapshot(ctx.kind,ctx.story);let asset=null;
  if(ctx.kind==='audio'){const list=(window.EccoAudioStudio?.recordings?.()||[]).slice().sort((a,b)=>(b.created||0)-(a.created||0));asset=list[0]||null;}
  else if(ctx.kind==='image'){const done=snap?.status==='done'?snap.assets:[];asset=done[0]||latestAsset('image',ctx.story);}
  else asset=latestAsset('video',ctx.story);
  const button=generateButton(),submitting=button?.getAttribute('aria-busy')==='true'&&!ACTIVE.includes(snap?.status);
  const running=snap&&ACTIVE.includes(snap.status)||submitting;
  const failed=!running&&snap&&FAILED.includes(snap.status)&&(!asset||(asset.created||0)<(snap.started||0));
  const mode=running?'running':failed?'failed':asset&&(!snap||snap.status==='done'||(asset.created||0)>=(snap.started||0)||snap.status==='cancelled')?'review':snap?.status==='cancelled'?'stopped':'idle';
  return {snap,asset,mode,submitting};
 }

 function update(){
  if(!root?.isConnected||!ctx){clearInterval(timer);timer=null;return;}
  const {snap,asset,mode,submitting}=current();
  if(autoStartUntil&&mode!=='running'){const button=generateButton();if(button&&!button.disabled&&button.getAttribute('aria-busy')!=='true')start();else if(Date.now()>autoStartUntil){autoStartUntil=0;window.EccoErrors?.show(busyText()||'The '+NOUN[ctx.kind]+' studio is not ready to generate yet. Check Model Settings, then choose Generate.',{title:'Generation could not start',retry:()=>toggleSettings(true),retryLabel:'Open Model Settings'});}}
  else if(mode==='running')autoStartUntil=0;
  const chip=q('[data-gen-chip]',root),summary=q('[data-gen-summary]',root);
  const chipText={running:submitting?'Starting…':'Generating',failed:'Needs attention',review:'Ready to review',stopped:'Stopped',idle:'Ready to generate'}[mode];
  if(chip.textContent!==chipText){chip.textContent=chipText;chip.dataset.state=mode;}
  const summaryText=mode==='review'&&asset?describe(asset):mode==='running'&&snap?Math.round(snap.overall)+'% · '+snap.headline:mode==='idle'?'Choose Generate to start. Progress shows here.':'';
  if(summary.textContent!==summaryText)summary.textContent=summaryText;
  q('[data-gen-stop]',root).hidden=mode!=='running';
  const startLabel=mode==='review'||mode==='failed'||mode==='stopped'?'Generate again':'Generate';const startButton=q('[data-gen-start]',root);
  if(startButton.textContent!==startLabel)startButton.textContent=startLabel;startButton.hidden=mode==='running';startButton.className=mode==='idle'?'':'secondary';
  q('[data-gen-download]',root).hidden=mode!=='review';
  const publishButton=q('[data-publish]',root);publishButton.disabled=!asset||mode==='running';publishButton.hidden=!asset;
  const note=ctx.kind==='video'?'':'Connected publishing currently accepts approved videos; Publish opens Story Publishing for this '+(ctx.kind==='audio'?'recording':'image')+'.';
  const noteEl=q('[data-gen-note]',root),showNote=mode==='review'&&!!note;if(noteEl.hidden===showNote||noteEl.textContent!==note){noteEl.textContent=note;noteEl.hidden=!showNote;}
  drawProgress(snap,mode);
  drawReview(asset,mode);
  if(snap&&mode==='failed')announceError(snap);
 }
 function describe(asset){const bits=[asset.title||LABEL[ctx.kind]];if(asset.duration)bits.push(duration(asset.duration));if(asset.width&&asset.height)bits.push(asset.width+' × '+asset.height);if(asset.created)bits.push('made '+new Date(asset.created*1000).toLocaleString());return bits.join(' · ');}

 function drawProgress(snap,mode){
  const host=q('[data-gen-progress]',root);
  if(!snap||mode==='review'||mode==='idle'){if(host.childElementCount){host.replaceChildren();progressSig='';}return;}
  const items=track(snap,ctx.story),ended=mode==='running'?clock():(items.at(-1)?.t||clock()),elapsed=snap.started?Math.max(0,ended-snap.started):0;
  const eta=mode==='running'?(snap.eta??(snap.overall>4&&elapsed>20?elapsed*(100-snap.overall)/snap.overall:null)):0;
  const sig=JSON.stringify([mode,Math.round(snap.overall),snap.units.map(u=>[u.status,Math.round(u.pct??-1),u.detail,u.worker]),items.length,Math.round(elapsed/5),eta==null?-1:Math.round(eta/10),snap.counts]);
  if(sig===progressSig)return;progressSig=sig;
  const overall=Math.round(snap.overall),blocks=snap.units.length>1&&snap.units.length<=200?snap.units:null;
  const passageUnit=snap.kind==='audio'?snap.units.find(u=>u.id==='speech'&&u.steps):null;
  const map=snap.kind==='audio'&&passageUnit?Array.from({length:Math.min(200,passageUnit.steps.total)},(_,i)=>({name:'Passage '+(i+1),pct:i<passageUnit.steps.completed?100:0,status:i<passageUnit.steps.completed?'done':i===passageUnit.steps.completed&&passageUnit.status==='running'?'running':passageUnit.status==='failed'&&i===passageUnit.steps.completed?'failed':'waiting'})):blocks;
  const busy=snap.units.filter(u=>u.status==='running'),active=new Set(busy.map(u=>u.worker||u.name)).size;
  const stats=[['Elapsed',duration(elapsed)],['Remaining',mode==='running'?remaining(eta):'—'],...snap.counts,['Working now',active?active+' worker'+(active>1?'s':''):'—']];
  const state=mode==='failed'?'Generation stopped with an error':mode==='stopped'?'Generation stopped':'Generating '+NOUN[snap.kind];
  host.innerHTML='<section class="panel story-gen-overall" aria-label="Overall progress"><div class="story-gen-overall-head"><div><span class="help">'+esc(state)+'</span><h2>'+esc(snap.headline)+'</h2></div><div class="story-gen-overall-figure"><span class="story-gen-percent">'+overall+'%</span><span class="help">'+esc(mode==='running'?remaining(eta)+' left':'')+'</span></div></div>'
   +'<div class="story-gen-track story-gen-track-large" role="progressbar" aria-label="Overall progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+overall+'"><span style="width:'+overall+'%"></span></div>'
   +(map&&map.length>1&&(snap.kind!=='audio'||passageUnit)?'<div class="story-gen-map-wrap"><span class="help">'+(snap.kind==='audio'?'Passage map · in script order':snap.kind==='video'?'Clip map · each block fills as its frames finish':'Image map')+'</span><div class="story-gen-map" style="--cells:'+Math.min(map.length,snap.kind==='audio'?32:12)+'">'+map.map(b=>'<span class="story-gen-block" data-status="'+b.status+'" title="'+esc(b.name+' · '+(b.status==='running'&&b.pct!=null?Math.round(b.pct)+'%':b.status))+'"><span style="width:'+Math.round(b.status==='done'?100:b.pct??0)+'%"></span></span>').join('')+'</div></div>':'')
   +'<dl class="story-gen-stats">'+stats.map(([k,v])=>'<div><dt class="help">'+esc(k)+'</dt><dd><strong>'+esc(v)+'</strong></dd></div>').join('')+'</dl>'
   +'<p class="help">Overall progress is the sum of every worker\'s finished work divided by all the work in this '+(snap.kind==='audio'?'recording':snap.kind)+', so it moves whenever any worker makes progress.</p></section>'
   +'<div class="story-gen-columns"><section class="panel story-gen-workers" aria-label="Workers"><div class="section-head"><h3>'+(snap.kind==='video'?'Workers and clips':snap.kind==='audio'?'Workers and tasks':'Workers')+'</h3><span class="help">'+(snap.units.length>1?'Each worker takes the next waiting task':'')+'</span></div>'
   +snap.units.map(u=>'<div class="story-gen-unit" data-status="'+u.status+'"><div class="story-gen-unit-head"><strong>'+esc(u.name)+(u.worker?' · '+esc(u.worker):'')+'</strong><span class="story-gen-unit-state">'+esc(u.status==='running'?(u.pct==null?'Working…':Math.round(u.pct)+'%'):{done:'Done',failed:'Failed',stopped:'Stopped',waiting:'Waiting'}[u.status])+'</span></div><div class="story-gen-track'+(u.pct==null&&u.status==='running'?' story-gen-indeterminate':'')+'" role="progressbar" aria-label="'+esc(u.name)+' progress"'+(u.pct==null?'':' aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(u.pct)+'"')+'><span style="width:'+Math.round(u.status==='done'?100:u.pct??0)+'%"></span></div>'+(u.detail?'<p class="help">'+esc(u.detail)+'</p>':'')+'</div>').join('')+'</section>'
   +'<section class="panel story-gen-log" aria-label="Activity"><h3>Activity</h3><ol>'+items.slice().reverse().map(i=>'<li><time class="help">'+esc(new Date(i.t*1000).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'}))+'</time><span>'+esc(i.m)+'</span></li>').join('')+'</ol><p class="help">You can leave this tab. Generation keeps going and this screen catches up when you return.</p></section></div>';
 }
 function announceError(snap){
  const shown=shownErrors(ctx.story);if(shown.includes(snap.key))return;rememberShown(ctx.story,[...shown,snap.key]);
  const help=advice(snap.error,snap.kind),failed=snap.units.find(u=>u.status==='failed');
  const message=(failed?failed.name+' stopped. ':'')+(snap.error||'Generation stopped.')+(help.cause?'\n\n'+help.cause:'');
  const steps=[...help.steps,...(snap.units.some(u=>u.status==='done')?['Finished parts are kept.']:[])];
  const action=help.action==='settings'?()=>toggleSettings(true):help.action==='images'?()=>ctx.prepareImages?.():help.action==='edit'?()=>ctx.edit?.():()=>start();
  window.EccoErrors?.show(message,{title:LABEL[snap.kind]+' generation needs attention',steps,retry:action,retryLabel:help.label});
 }

 // ---------- Review and fixes ----------
 function drawReview(asset,mode){
  const host=q('[data-gen-review]',root);
  const sig=mode==='review'&&asset?ctx.kind+':'+asset.id:'';
  if(sig===reviewSig){if(sig)refreshFixes();return;}reviewSig=sig;host.replaceChildren();if(!sig)return;
  if(ctx.kind==='video')videoReview(host,asset);else if(ctx.kind==='audio')audioReview(host,asset);else imageReview(host,asset);
 }
 function fixesKey(){return 'ecco-gen-fixes:'+ctx.kind+':'+ctx.story;}
 const running=new Map();
 function fixes(){const list=read(fixesKey(),[]);for(const f of list)if(['running','queued'].includes(f.status)&&!running.has(f.id)){f.status='failed';f.message='Interrupted when the page reloaded. Select the frames and run the fix again.';}return list;}
 function saveFix(fix){const list=fixes().filter(f=>f.id!==fix.id);list.unshift(fix);write(fixesKey(),list.slice(0,12));refreshFixes();}
 function refreshFixes(){
  const host=q('[data-fixes]',root);if(!host)return;const list=fixes(),sig=JSON.stringify(list);if(host.dataset.sig===sig)return;host.dataset.sig=sig;
  host.innerHTML=list.length?list.map(f=>'<div class="story-gen-fix" data-status="'+esc(f.status)+'"><div class="story-gen-unit-head"><strong>'+esc(f.label)+'</strong><span class="story-gen-unit-state">'+esc(f.status==='done'?'Ready':f.status==='failed'?'Failed':Math.round(f.pct||0)+'%')+'</span></div>'+(['running','queued'].includes(f.status)?'<div class="story-gen-track" role="progressbar" aria-label="'+esc(f.label)+' progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(f.pct||0)+'"><span style="width:'+Math.round(f.pct||0)+'%"></span></div>':'')+'<p class="help">'+esc(f.message||'')+'</p></div>').join(''):'<p class="help">No fixes yet.</p>';
 }
 function fixPanel(title,intro){return '<section class="panel story-gen-fixer" aria-label="'+esc(title)+'"><h2 data-fix-title>'+esc(title)+'</h2><p class="help" data-fix-intro>'+esc(intro)+'</p><div data-fix-body></div><div class="story-gen-fixes"><h3>Fixes</h3><div data-fixes></div></div></section>';}
 function chips(names,name,legend='What looks wrong?'){return '<fieldset class="story-gen-chips"><legend>'+esc(legend)+'</legend>'+names.map((n,i)=>'<label><input type="radio" name="'+name+'" value="'+esc(n)+'"'+(i?'':' checked')+'> '+esc(n)+'</label>').join('')+'</fieldset>';}
 async function waitFor(check,{every=3000,limit=45*60000,progress}={}){const until=Date.now()+limit;for(;;){if(typeof refresh==='function')await refresh(null,false,true);const result=await check();if(result)return result;progress?.();if(Date.now()>until)throw Error('This is taking longer than expected. Check Activity, then try again.');await new Promise(r=>setTimeout(r,every));}}
 const resultIds=job=>[].concat(job?.result||[],job?.output_asset_id||[]).filter(Boolean);

 // Video: pick the frames that look wrong, describe the fix, redraw only those frames and put them back in place.
 function videoReview(host,asset){
  host.innerHTML='<div class="story-gen-columns"><section class="story-gen-player" aria-label="Video review"><video controls preload="metadata" data-asset="'+esc(asset.id)+'" data-gen-player></video>'
   +'<section class="panel story-gen-frames" aria-label="Frames"><div class="section-head"><h3 data-frames-title>Frames</h3><div class="row"><button type="button" class="secondary" data-frames-earlier>Earlier</button><button type="button" class="secondary" data-frames-here>Show frames at the current time</button><button type="button" class="secondary" data-frames-later>Later</button></div></div><p class="help" data-frames-help>Pause where something looks wrong, then choose Show frames at the current time. Select the frames to fix; Shift selects a range.</p><div class="story-gen-strip" data-strip role="group" aria-label="Frames to fix"></div></section></section>'
   +fixPanel('Fix frames','Only the frames you select are redrawn and put back in place. The rest of the video, and the original file, stay unchanged.')+'</div>';
  const body=q('[data-fix-body]',host),player=q('[data-gen-player]',host),strip=q('[data-strip]',host);
  mediaURL(asset).then(url=>{if(player.isConnected&&!player.src)player.src=url;}).catch(error=>{q('[data-frames-help]',host).textContent=error.message;});
  body.innerHTML='<p data-selected-label><strong>No frames selected</strong></p>'+chips(['Color changed','Object disappeared','Face changed','Flicker','Wrong pose','Other'],'gen-video-issue')
   +'<label>Describe the fix<textarea rows="4" data-fix-text placeholder="For example: her t-shirt turns from red to blue. Keep it red, the same as the frame before."></textarea></label>'
   +'<p class="help">The frame just before your selection is used as a reference so the new frames match it.</p><div class="row"><button type="button" data-fix-run disabled>Regenerate frames</button><button type="button" class="secondary" data-fix-clear>Clear</button></div>';
  const selected=new Set();let center=1,total=0,anchor=null,grabber=null,token=0;
  const label=()=>{const list=[...selected].sort((a,b)=>a-b);q('[data-selected-label]',body).innerHTML='<strong>'+(list.length?list.length+' frame'+(list.length>1?'s':'')+' selected':'No frames selected')+'</strong>'+(list.length?'<span class="help"> · '+esc(ranges(list))+'</span>':'');q('[data-fix-run]',body).disabled=!list.length;q('[data-fix-run]',body).textContent='Regenerate '+(list.length?list.length+' frame'+(list.length>1?'s':''):'frames');};
  async function source(){if(grabber)return grabber;const url=typeof media==='function'?media(asset):'';if(!url)throw Error('The video is still loading. Try again in a moment.');grabber=document.createElement('video');grabber.muted=true;grabber.preload='auto';grabber.src=url;await new Promise((resolve,reject)=>{grabber.onloadeddata=resolve;grabber.onerror=()=>reject(Error('The video could not be opened for frame review.'));});total=Math.max(1,Math.round(grabber.duration*FPS));return grabber;}
  async function seek(video,frame){await new Promise(resolve=>{const done=()=>{video.removeEventListener('seeked',done);resolve();};video.addEventListener('seeked',done);video.currentTime=Math.min(video.duration-1e-3,(frame-.5)/FPS);});}
  async function frameCanvas(frame,width){const v=await source();await seek(v,frame);const scale=width?width/v.videoWidth:1,c=document.createElement('canvas');c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);c.getContext('2d').drawImage(v,0,0,c.width,c.height);return c;}
  async function draw(){
   const mine=++token;try{await source();}catch(error){q('[data-frames-help]',host).textContent=error.message;return;}
   center=Math.max(1,Math.min(total,center));const first=Math.max(1,Math.min(center-7,total-15)),frames=Array.from({length:Math.min(16,total)},(_,i)=>first+i);
   q('[data-frames-title]',host).textContent='Frames '+frames[0]+'–'+frames[frames.length-1]+' of '+total;
   strip.innerHTML=frames.map(n=>'<button type="button" class="story-gen-frame" data-frame="'+n+'" aria-pressed="'+selected.has(n)+'"><canvas width="160" height="90" aria-hidden="true"></canvas><span>'+n+'</span></button>').join('');
   for(const n of frames){if(mine!==token)return;const c=await frameCanvas(n,160).catch(()=>null);const cell=q('[data-frame="'+n+'"] canvas',strip);if(c&&cell){cell.height=c.height;cell.getContext('2d').drawImage(c,0,0);}}
  }
  strip.onclick=e=>{const b=e.target.closest('[data-frame]');if(!b)return;const n=Number(b.dataset.frame);
   if(e.shiftKey&&anchor){const [a,z]=[Math.min(anchor,n),Math.max(anchor,n)];for(let i=a;i<=z;i++)if(selected.size<MAX_FIX_FRAMES)selected.add(i);}
   else if(selected.has(n))selected.delete(n);else{if(selected.size>=MAX_FIX_FRAMES){window.EccoErrors?.show('Fix up to '+MAX_FIX_FRAMES+' frames at a time. Run this fix, then select more.',{title:'Too many frames'});return;}selected.add(n);}
   anchor=n;for(const cell of all('[data-frame]',strip))cell.setAttribute('aria-pressed',String(selected.has(Number(cell.dataset.frame))));label();};
  q('[data-frames-here]',host).onclick=()=>{center=Math.floor(player.currentTime*FPS)+1;player.pause();draw();};
  q('[data-frames-earlier]',host).onclick=()=>{center-=16;draw();};
  q('[data-frames-later]',host).onclick=()=>{center+=16;draw();};
  q('[data-fix-clear]',body).onclick=()=>{selected.clear();anchor=null;for(const cell of all('[data-frame]',strip))cell.setAttribute('aria-pressed','false');label();};
  q('[data-fix-run]',body).onclick=async()=>{
   const text=q('[data-fix-text]',body).value.trim(),issue=q('input[name=gen-video-issue]:checked',body)?.value||'Other',frames=[...selected].sort((a,b)=>a-b);
   if(!text){window.EccoErrors?.show('Describe what should change, so the new frames can be drawn correctly.',{title:'Describe the fix'});q('[data-fix-text]',body).focus();return;}
   const fix={id:crypto.randomUUID(),label:'Frames '+ranges(frames)+' · '+issue,status:'running',pct:2,message:'Saving the selected frames…',created:Date.now()};running.set(fix.id,true);saveFix(fix);
   q('[data-fix-clear]',body).click();q('[data-fix-text]',body).value='';
   try{await runVideoFix({asset,frames,issue,text,fix,frameCanvas,total:()=>total});}
   catch(error){Object.assign(fix,{status:'failed',message:error.message});saveFix(fix);window.EccoErrors?.show(error.message,{title:'Frame fix stopped',steps:advice(error.message,'video').steps});}
   finally{running.delete(fix.id);}
  };
  label();refreshFixes();
 }
 async function runVideoFix({asset,frames,issue,text,fix,frameCanvas,total}){
  const story=ctx.story,update=(pct,message)=>{Object.assign(fix,{pct,message});saveFix(fix);};
  const upload=async(canvas,name)=>{const data=canvas.toDataURL('image/jpeg',.92).split(',')[1];const record=await api('images/upload',{name,data,story_id:story});if(!record?.id)throw Error('Storage did not confirm the saved frame.');return record.id;};
  const before=frames[0]>1&&!frames.includes(frames[0]-1)?frames[0]-1:frames[frames.length-1]<total()?frames[frames.length-1]+1:null;
  const reference=before?await upload(await frameCanvas(before),'frame-'+before+'-reference.jpg'):null;
  const jobs=[];
  for(const [i,n] of frames.entries()){
   const id=await upload(await frameCanvas(n),'frame-'+n+'.jpg');
   const prompt='Edit this frame of a video. Problem: '+issue.toLowerCase()+'. '+text+' Keep everything else exactly the same: framing, camera angle, lighting, characters, clothing, objects and art style.'+(reference?' The second image is a neighbouring frame from the same shot; match it.':'');
   const job=await window.EccoGeneration.editImage({assetIds:reference?[id,reference]:[id],prompt,story});
   jobs.push({frame:n,id:job.id});update(5+Math.round((i+1)/frames.length*20),'Sent '+(i+1)+' of '+frames.length+' frames to be redrawn…');
  }
  const finished=await waitFor(()=>{const list=jobs.map(j=>jobRecord(j.id));const bad=list.find(j=>j&&FAILED.includes(j.status));if(bad)throw Error('A frame could not be redrawn: '+(bad.error||bad.status));const done=list.filter(j=>j?.status==='done');update(25+Math.round(done.length/jobs.length*50),'Redrawing frames · '+done.length+' of '+jobs.length+' done');return done.length===jobs.length?list:null;});
  update(78,'Putting the new frames back in place…');
  const v=await frameCanvas(frames[0]),replacements={};
  for(const [i,j] of jobs.entries()){
   const result=records().find(a=>resultIds(finished[i]).includes(a.id));if(!result)throw Error('A redrawn frame is missing from the library.');
   const url=await mediaURL(result),img=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('A redrawn frame could not be loaded.'));im.src=url;});
   const c=document.createElement('canvas');c.width=v.width;c.height=v.height;c.getContext('2d').drawImage(img,0,0,c.width,c.height);
   replacements[String(j.frame)]={dataUrl:c.toDataURL('image/jpeg',.9)};
  }
  const request={request_id:crypto.randomUUID().replaceAll('-',''),asset_id:asset.id,story_id:story,fps:FPS,total:total(),removed:[],replacements};
  const job=await api('frame-editor/export',request);
  const out=await waitFor(async()=>{const r=await api('frame-editor/jobs/'+job.id);if(r.status==='failed')throw Error(r.error||'The fixed video could not be saved.');update(85,r.progress||'Saving the fixed video…');return r.status==='done'?r:null;},{every:2500});
  Object.assign(fix,{status:'done',pct:100,message:'Fixed video saved as a new version. The original is kept in the Video Library.',result:out.output_asset_id});saveFix(fix);
  if(typeof refresh==='function')await refresh();
  if(typeof notice==='function')notice('Fixed video ready to review.');
 }
 async function mediaURL(asset){if(typeof media==='function'&&media(asset))return media(asset);if(typeof media!=='function')throw Error('Media is not available here.');const holder=document.createElement('img');holder.dataset.asset=asset.id;holder.hidden=true;document.body.append(holder);try{if(typeof hydrateMedia==='function')await hydrateMedia();for(let i=0;i<240&&!media(asset);i++)await new Promise(r=>setTimeout(r,250));const url=media(asset);if(!url)throw Error((asset.media==='video'?'The video':'A redrawn frame')+' could not be downloaded. Check the connection and try again.');return url;}finally{holder.remove();}}
 function ranges(list){const out=[];let a=list[0],b=list[0];for(const n of list.slice(1)){if(n===b+1){b=n;continue;}out.push(a===b?a:a+'–'+b);a=b=n;}if(list.length)out.push(a===b?a:a+'–'+b);return out.join(', ');}

 // Audio: click a word that sounds wrong, say how it should sound, regenerate.
 function audioReview(host,asset){
  const studio=window.EccoAudioStudio;
  host.innerHTML='<div class="story-gen-columns"><section class="story-gen-player" aria-label="Audio review"><audio controls preload="metadata" data-gen-player></audio>'
   +'<section class="panel story-gen-transcript" aria-label="Transcript"><div class="section-head"><h3>Transcript</h3><span class="help">Click a word that sounds wrong</span></div><div data-transcript></div></section></section>'
   +fixPanel('Fix the recording','Choose a word in the transcript, then say how it should sound or change the wording. The recording is then made again with your fix.')+'</div>';
  studio?.mediaURL?.(asset.id).then(url=>{const p=q('[data-gen-player]',host);if(p&&url)p.src=url;}).catch(()=>{});
  const transcript=q('[data-transcript]',host),body=q('[data-fix-body]',host);
  const lines=studio?.lines?.()||[],speakers=studio?.speakers?.()||[],name=id=>speakers.find(s=>s.id===id)?.name||'Speaker';
  const words=text=>String(text).split(/(\s+)/);
  const pronounced=()=>studio?.pronunciations?.()||[];
  function paint(){const fixed=new Set(pronounced().map(p=>p.word.toLowerCase()));transcript.innerHTML=lines.length?lines.map((l,i)=>'<div class="story-gen-passage" data-line="'+i+'"><span class="help">'+esc(name(l.speaker_id))+' · passage '+(i+1)+'</span><p>'+words(l.text).map(w=>/\S/.test(w)?'<span class="story-gen-word'+(fixed.has(clean(w).toLowerCase())?' story-gen-word-fixed':'')+'" data-word="'+esc(clean(w))+'">'+esc(w)+'</span>':esc(w)).join('')+'</p></div>').join(''):'<p class="help">The script for this recording is not available here. Open Model Settings to see it.</p>';}
  const clean=w=>w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'');
  body.innerHTML=chips(['Mispronounced','Wrong word'],'gen-audio-issue','What sounds wrong?')
   +'<div data-pron><label>Word<input type="text" data-word-input autocomplete="off"></label><label>Say it as<input type="text" data-say-input placeholder="For example: la-HOR" autocomplete="off"></label><label class="story-gen-check"><input type="checkbox" data-all checked> <span data-all-label>Every place this word is said</span></label></div>'
   +'<div data-wording hidden><label>Passage<select data-line-select></select></label><label>New wording<textarea rows="4" data-line-text></textarea></label></div>'
   +'<div class="row"><button type="button" data-fix-run>Save fix and regenerate</button></div><div data-pron-list></div>';
  const lineSelect=q('[data-line-select]',body);lineSelect.innerHTML=lines.map((l,i)=>'<option value="'+i+'">'+esc(name(l.speaker_id)+' · passage '+(i+1))+'</option>').join('');
  let selectedLine=null;
  const syncIssue=()=>{const wording=q('input[name=gen-audio-issue]:checked',body).value==='Wrong word';q('[data-pron]',body).hidden=wording;q('[data-wording]',body).hidden=!wording;if(wording){if(selectedLine!=null)lineSelect.value=String(selectedLine);q('[data-line-text]',body).value=lines[Number(lineSelect.value)]?.text||'';}};
  for(const r of all('input[name=gen-audio-issue]',body))r.onchange=syncIssue;lineSelect.onchange=()=>{q('[data-line-text]',body).value=lines[Number(lineSelect.value)]?.text||'';};
  const count=word=>lines.reduce((n,l)=>n+words(l.text).filter(w=>clean(w).toLowerCase()===word.toLowerCase()).length,0);
  const syncCount=()=>{const w=q('[data-word-input]',body).value.trim(),n=w?count(w):0;q('[data-all-label]',body).textContent=n>1?'All '+n+' places “'+w+'” is said':'Every place this word is said';};
  q('[data-word-input]',body).oninput=syncCount;
  transcript.onclick=e=>{const w=e.target.closest('[data-word]');if(!w)return;selectedLine=Number(w.closest('[data-line]').dataset.line);for(const s of all('.story-gen-word-selected',transcript))s.classList.remove('story-gen-word-selected');w.classList.add('story-gen-word-selected');q('[data-word-input]',body).value=w.dataset.word;const known=pronounced().find(p=>p.word.toLowerCase()===w.dataset.word.toLowerCase());q('[data-say-input]',body).value=known?.sayAs||'';syncCount();syncIssue();q('[data-say-input]',body).focus();};
  function list(){const items=pronounced();q('[data-pron-list]',body).innerHTML=items.length?'<h3>Pronunciations</h3><ul class="story-gen-pron">'+items.map((p,i)=>'<li><span>“'+esc(p.word)+'” → '+esc(p.sayAs)+(p.line==null?'':' · passage '+(p.line+1))+'</span><button type="button" class="secondary" data-remove-pron="'+i+'" aria-label="Remove pronunciation for '+esc(p.word)+'">Remove</button></li>').join('')+'</ul>':'';for(const b of all('[data-remove-pron]',body))b.onclick=()=>{studio.removePronunciation(Number(b.dataset.removePron));list();paint();};}
  q('[data-fix-run]',body).onclick=()=>{
   try{
    if(!studio?.setPronunciation)throw Error('Open this story\'s audio studio to change the recording.');
    if(q('input[name=gen-audio-issue]:checked',body).value==='Wrong word'){const i=Number(lineSelect.value),text=q('[data-line-text]',body).value.trim();if(!text)throw Error('Write the new wording for this passage.');studio.editLine(i,text);lines[i]={...lines[i],text};saveFix({id:crypto.randomUUID(),label:'Passage '+(i+1)+' · new wording',status:'done',pct:100,message:'Saved. The recording is being made again.',created:Date.now()});}
    else{const word=q('[data-word-input]',body).value.trim(),sayAs=q('[data-say-input]',body).value.trim();if(!word||!sayAs)throw Error('Choose a word and write how it should sound.');studio.setPronunciation({word,sayAs,line:q('[data-all]',body).checked||selectedLine==null?null:selectedLine});saveFix({id:crypto.randomUUID(),label:'“'+word+'” said as '+sayAs,status:'done',pct:100,message:'Saved to this story\'s pronunciations. The recording is being made again.',created:Date.now()});}
    paint();list();start();
   }catch(error){window.EccoErrors?.show(error,{title:'Fix could not be saved'});}
  };
  paint();list();syncIssue();refreshFixes();
 }

 // Image: pick an image and describe the change; the image is redrawn from itself.
 function imageReview(host,asset){
  const snap=snapshot('image',ctx.story),list=(snap?.status==='done'&&snap.assets.length?snap.assets:[asset]);
  host.innerHTML='<div class="story-gen-columns"><section class="story-gen-player" aria-label="Image review"><div class="story-gen-images">'+list.map((a,i)=>'<button type="button" class="story-gen-image" data-image="'+esc(a.id)+'" aria-pressed="'+(i===0)+'"><img data-asset="'+esc(a.id)+'" alt="'+esc(a.prompt||a.title||'Generated image')+'"></button>').join('')+'</div></section>'
   +fixPanel('Fix this image','Describe what to change. The image is redrawn from itself, so everything else stays the same.')+'</div>';
  if(typeof hydrateMedia==='function')hydrateMedia();
  const body=q('[data-fix-body]',host);let chosen=list[0]?.id;
  body.innerHTML=chips(['Color changed','Object missing','Face changed','Wrong pose','Other'],'gen-image-issue')+'<label>Describe the fix<textarea rows="4" data-fix-text placeholder="For example: make the dress red and add the bread back on the table."></textarea></label><div class="row"><button type="button" data-fix-run>Regenerate image</button></div>';
  q('.story-gen-images',host).onclick=e=>{const b=e.target.closest('[data-image]');if(!b)return;chosen=b.dataset.image;for(const x of all('[data-image]',host))x.setAttribute('aria-pressed',String(x===b));};
  q('[data-fix-run]',body).onclick=async()=>{const text=q('[data-fix-text]',body).value.trim(),issue=q('input[name=gen-image-issue]:checked',body).value;if(!text){window.EccoErrors?.show('Describe what should change.',{title:'Describe the fix'});return;}
   const button=q('[data-fix-run]',body);button.disabled=true;
   try{const job=await window.EccoGeneration.editImage({assetIds:[chosen],prompt:'Problem: '+issue.toLowerCase()+'. '+text+' Keep everything else exactly the same.',story:ctx.story});localStorage.setItem('ecco-image-job:'+ctx.story,job.id);saveFix({id:crypto.randomUUID(),label:issue,status:'done',pct:100,message:'Sent. Progress shows above; the new image appears here when it is ready.',created:Date.now()});if(typeof refresh==='function')await refresh();update();}
   catch(error){window.EccoErrors?.show(error.message,{title:'Image fix could not start',steps:advice(error.message,'image').steps});}
   finally{if(button.isConnected)button.disabled=false;}};
  refreshFixes();
 }

 // Pronunciations are applied to the words sent to the voice model; the script keeps its normal spelling.
 function applyPronunciations(text,list,line){
  let out=String(text??'');
  for(const p of list||[]){if(!p?.word||!p?.sayAs||(p.line!=null&&p.line!==line))continue;const word=p.word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');out=out.replace(new RegExp('(?<![\\p{L}\\p{N}])'+word+'(?![\\p{L}\\p{N}])','giu'),p.sayAs);}
  return out;
 }
 function leave(){clearInterval(timer);timer=null;root=null;ctx=null;progressSig='';reviewSig='';autoStartUntil=0;}
 window.EccoStoryGeneration={mount,update,leave,openSettings:()=>toggleSettings(true),closeSettings:()=>toggleSettings(false),applyPronunciations,advice,snapshot,ranges};
})();
