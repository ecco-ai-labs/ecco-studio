'use strict';
/* Create Images for Your Story (owner-approved prototype, 2026-11-10).
   Three steps: 1. Image (upload, Image Library or Generate with AI, then Improve with AI drafts),
   2. Enhance Image (one tab per image; controls picked for what the image shows; choices are sent with
   or without a prompt), 3. Publish Images (one Publish button). Model settings stay hidden behind a
   button; Qwen and Serverless are the defaults. The Story workspace's Story Generation tab keeps its
   own image form.
   Image Level 2-3 build (21 Nov 2026, branch image-l5, owner approval 02:03 PT):
   - Generate never locks: each press queues its pictures; every picture shows what it is doing (place in line,
     starting a GPU worker, loading the model, step N of M), elapsed time, time left, and a Cancel button.
   - Pictures per prompt (1-4) with different seeds; a saved Character can be put into a picture.
   - Picture Set: one page per line, the same character on every page, redo one page, ZIP / PDF / save as a label.
   - Save as character from a selected image; 6-view character sheet.
   - ✦ Ideas rewrites a rough prompt into three picture descriptions.
   - Pictures made here stay out of Image Library until saved or published (ecco-unsaved-images).
   - The screen is only rewritten when what it shows changes; live progress updates in place. */
(()=>{
 const M=window.EccoImageWorkspaceModel,J=window.EccoImageJobs;
 const EDIT_MODEL='qwen-image-edit-2511',LIMIT=3,DRAFTS=3,IN_FLIGHT=6,CHARACTERS=3;
 const q=(s,r=document)=>r.querySelector(s),all=(s,r=document)=>[...r.querySelectorAll(s)];
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const key=story=>'ecco-image-workspace:'+story;
 const TAB=Math.random().toString(36).slice(2);
 let ws=null,wsStory=null,modelOpen=false,lastHtml='';const busy={};
 let queueInfo={},queueAt=0,watching=false,ticker=0;

 /* ---------- state ---------- */
 const freshSet=()=>({name:'',pagesText:'',chars:[],style:'',shape:'',pages:[]});
 const fresh=()=>({step:'image',src:'library',selected:[],active:0,enh:0,generated:[],ai:{},aiPrompt:'',genPrompt:'',genStyle:'',genShape:'',genCount:1,genCharacter:'',genQuality:'',ideas:[],checks:{},autoCheck:true,search:'',label:'',enhance:{},final:{},published:false,jobs:[],set:freshSet(),charForm:null});
 function load(){
  if(wsStory===activeStory&&ws)return ws;
  let saved=null;try{saved=JSON.parse(localStorage.getItem(key(activeStory))||'null');}catch{}
  ws={...fresh(),...(saved&&typeof saved==='object'?saved:{})};ws.set={...freshSet(),...(ws.set||{})};if(!Array.isArray(ws.jobs))ws.jobs=[];if(!ws.checks||typeof ws.checks!=='object')ws.checks={};
  wsStory=activeStory;modelOpen=false;return ws;
 }
 function save(){try{localStorage.setItem(key(wsStory),JSON.stringify(ws));}catch{}}
 const record=id=>state.records.find(r=>r.id===id&&r.kind==='asset'&&r.media==='image'&&!r.deleted);
 const jobRecord=id=>id?state.records.find(r=>r.kind==='job'&&r.id===id):null;
 const characters=()=>state.records.filter(r=>r.kind==='character'&&!r.deleted&&Array.isArray(r.image_ids)&&r.image_ids.length).sort((a,b)=>(b.created||0)-(a.created||0));
 const character=id=>characters().find(c=>c.id===id);
 const title=id=>{const r=record(id);return r?.title||r?.prompt?.split('\nVisual style:')[0]?.slice(0,60)||'Image';};
 // Enhance offers the Popular styles as choices; Generate with AI lists every style by group.
 const styles=()=>{const S=window.EccoImageStyles;return S?.groups?.find(g=>g[0]==='Popular')?.[1]||S?.names?.slice(0,8)||[];};
 const styleGroups=()=>window.EccoImageStyles?.groups||[['Styles',window.EccoImageStyles?.names||[]]];
 function tidy(){
  ws.selected=ws.selected.filter(record).slice(0,LIMIT);ws.generated=ws.generated.filter(record);
  for(const [id,f] of Object.entries(ws.final))if(!record(f))delete ws.final[id];
  ws.active=Math.max(0,Math.min(ws.active,ws.selected.length-1));ws.enh=Math.max(0,Math.min(ws.enh,ws.selected.length-1));
  ws.set.chars=(ws.set.chars||[]).filter(character).slice(0,CHARACTERS);if(ws.genCharacter&&!character(ws.genCharacter))ws.genCharacter='';
  // Finished jobs older than a day leave the list; unfinished ones stay until they finish.
  const day=Date.now()-864e5;ws.jobs=ws.jobs.filter(j=>!j.done||(j.finished||j.created||0)>day).slice(-60);
 }
 const finalOf=id=>ws.final[id]||id;
 const ai=id=>ws.ai[id]||(ws.ai[id]={drafts:[],index:0});
 const enh=id=>ws.enhance[id]||(ws.enhance[id]={type:'',analysis:null,choices:{},prompt:'',drafts:[],index:0,compare:'after'});

 /* ---------- unsaved pictures (owner-approved, 16 Nov): out of Image Library until saved ---------- */
 const UNSAVED='ecco-unsaved-images';
 function unsaved(add,remove){
  let list;try{list=JSON.parse(localStorage.getItem(UNSAVED))||[];}catch{list=[];}
  const set=new Set(list);(add||[]).forEach(id=>set.add(id));(remove||[]).forEach(id=>set.delete(id));
  try{localStorage.setItem(UNSAVED,JSON.stringify([...set].slice(-400)));}catch{}
 }

 /* ---------- model and compute ---------- */
 function imageModel(){const id=modelProfiles.selected.images;return MODEL_CATALOG[id]&&!MODEL_CATALOG[id].pending&&MODEL_CATEGORIES.images.models.includes(id)?id:'qwen-image-2512';}
 const computes=()=>window.EccoCompute?.choices()||[];
 function computeId(){
  const list=computes(),saved=localStorage.getItem('ecco-compute-image');
  if(list.some(g=>g.id===saved))return saved;if(list.some(g=>g.id==='serverless'))return 'serverless';return list[0]?.id||'';
 }
 const computeName=()=>{const id=computeId();return window.EccoGPUPicker?.gpus.find(g=>g.id===id)?.name||'Not connected';};
 const usesEdit=()=>ws.step==='image'&&((ws.src==='generate'&&ws.genCharacter)||(ws.src==='set'&&ws.set.chars.length));
 const modelName=()=>usesEdit()?MODEL_CATALOG[EDIT_MODEL]?.name||'Qwen Image Edit':ws.step==='image'&&(ws.src==='generate'||ws.src==='set')||!ws.selected.length?MODEL_CATALOG[imageModel()].name:MODEL_CATALOG[EDIT_MODEL]?.name||'Qwen Image Edit';
 // More picture shapes appear once the server lists them (state.config.image_sizes); until then the model's own sizes.
 const shapeList=()=>J.shapes(MODEL_CATALOG[imageModel()].sizes,state.config?.image_sizes?.[imageModel()]);
 // Fast mode (Lightning LoRA, 8 steps) is offered once the server reports it (state.config.image_fast); it is then the default.
 const fastReady=model=>!!state.config?.image_fast?.[model];
 const quality=()=>ws.genQuality||(fastReady(imageModel())?'fast':'best');
 const qualitySelect=()=>fastReady(imageModel())||fastReady(EDIT_MODEL)?'<label>Quality<select data-input="genQuality"><option value="fast"'+(quality()==='fast'?' selected':'')+'>Fast · about 15 s</option><option value="best"'+(quality()==='best'?' selected':'')+'>Best · about 1 min</option></select></label>':'';
 function requireCompute(){const gpu=computeId();if(!gpu)throw Error('Connect Serverless or a GPU in Compute first.');return gpu;}
 async function waitFor(job){
  const started=Date.now();
  for(;;){
   const next=await api('state'),done=next.records?.find(r=>r.kind==='job'&&r.id===job.id);
   if(done&&['error','cancelled'].includes(done.status))throw Error(done.error||'Image generation stopped.');
   if(done?.status==='done'){
    await refresh(next);const ids=Array.isArray(done.result)?done.result:[done.result];
    const made=state.records.filter(r=>r.kind==='asset'&&r.media==='image'&&!r.deleted&&(r.job_id===job.id||ids.includes(r.id))).map(r=>r.id);
    if(!made.length)throw Error('The job finished without an image.');return made;
   }
   if(Date.now()-started>600000)throw Error('The image is still generating. Check Activity before trying again.');
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
 }
 const styled=(prompt,style)=>style&&window.EccoImageStyles?.get(style)?window.EccoImageStyles.prompt(prompt,style):prompt;
 async function edit(ids,prompt,style){
  const gpu=requireCompute(),config=await window.EccoCompute.validate(gpu,EDIT_MODEL),settings=modelSettings(EDIT_MODEL);
  if(!config.generation_controls_version&&ids.length>1)throw Error('The connected GPU needs the multi-reference update to use several images. Your choices and prompt are saved.');
  const full=styled(prompt,style);if(full.length>4000)throw Error('Keep the prompt and choices within 4,000 characters.');
  const job=await api('image-edits',{gpu,asset_id:ids[0],asset_ids:ids,prompt:full,story_id:activeStory,...settings});
  const made=await waitFor(job);unsaved(made);return made;
 }
 async function run(name,task){
  if(busy[name])return;busy[name]=true;draw();
  try{await task();}catch(error){notice(error.message,true);}finally{busy[name]=false;save();if(page==='images'&&q('#image-workspace'))draw();}
 }

 /* ---------- queued picture jobs ---------- */
 // A job: {key,kind:'image'|'edit'|'sheet',target:'gen'|'set',page,path,payload,prompt,id,created,claimed,done,error,results}
 const jobKey=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
 const liveJobs=()=>ws.jobs.filter(j=>!j.done);
 // Build the request for one picture: a plain picture, or a picture with saved characters (instruction-edit model).
 async function request(prompt,{style='',shape='',seed=null,chars=[]}={}){
  const gpu=requireCompute();
  if(chars.length){
   const config=await window.EccoCompute.validate(gpu,EDIT_MODEL),settings={...modelSettings(EDIT_MODEL)};if(seed!=null)settings.seed=seed;if(quality()==='fast'&&fastReady(EDIT_MODEL))settings.quality='fast';
   if(!config.generation_controls_version&&chars.length>1)throw Error('The connected GPU needs the multi-reference update to use several characters.');
   const full=styled(prompt,style);if(full.length>4000)throw Error('Keep the description within 4,000 characters.');
   return {kind:'edit',path:'image-edits',payload:{gpu,character_ids:chars,prompt:full,story_id:activeStory,...settings}};
  }
  const model=imageModel();await window.EccoCompute.validate(gpu,model);
  const payload=modelPayload('images',gpu,model);if(shape&&(MODEL_CATALOG[model].sizes?.includes(shape)||state.config?.image_sizes?.[model]?.includes(shape)))payload.resolution=shape;
  if(seed!=null)payload.seed=seed;if(quality()==='fast'&&fastReady(model))payload.quality='fast';
  const full=styled(prompt,style);if(full.length>4000)throw Error('Keep the description within 4,000 characters.');
  return {kind:'image',path:'images',payload:{...payload,prompt:full,negative:style?window.EccoImageStyles.negative('',style):'',story_id:activeStory}};
 }
 function queue(req,extra){const j={key:jobKey(),created:Date.now(),...req,...extra};ws.jobs.push(j);return j;}
 async function submit(j){
  j.claimed=TAB+':'+Date.now();save();
  try{const job=await api(j.path,j.payload);j.id=job.id;j.claimed='';if(job&&!state.records.some(r=>r.id===job.id))state.records.push({kind:'job',...job});}
  catch(error){j.claimed='';if(/queue is full|429|too many/i.test(error.message)){j.retryAt=Date.now()+8000;}else{j.done=true;j.finished=Date.now();j.error=error.message;notice(error.message,true);}}
  save();
 }
 function pump(){
  const flying=ws.jobs.filter(j=>!j.done&&(j.id||(j.claimed&&Date.now()-Number(j.claimed.split(':')[1])<30000))).length;
  let room=IN_FLIGHT-flying;
  for(const j of ws.jobs){
   if(room<=0)break;
   if(j.done||j.id||(j.claimed&&Date.now()-Number(j.claimed.split(':')[1])<30000)||(j.retryAt&&Date.now()<j.retryAt))continue;
   room--;submit(j).then(async()=>{try{await refresh(await api('state'));}catch{}settle();watch();if(page==='images'&&q('#image-workspace'))draw();});
  }
 }
 // A finished job puts its pictures where they belong: the Generate grid, a set page, or (sheet) the Generate grid.
 function settle(){
  let changed=false;
  for(const j of ws.jobs){
   if(j.done||!j.id)continue;
   const r=jobRecord(j.id);if(!r)continue;
   if(['failed','error','cancelled','interrupted'].includes(r.status)){j.done=true;j.finished=Date.now();j.error=r.status==='cancelled'?'Cancelled':(r.error||'Failed');changed=true;continue;}
   if(r.status!=='done')continue;
   const ids=Array.isArray(r.result)?r.result:[r.result];
   const made=state.records.filter(a=>a.kind==='asset'&&a.media==='image'&&!a.deleted&&(a.job_id===j.id||ids.includes(a.id))).sort((a,b)=>(a.created||0)-(b.created||0)).map(a=>a.id);
   if(!made.length)continue;
   j.done=true;j.finished=Date.now();j.results=made;j.seconds=r.seconds;changed=true;unsaved(made);
   if(j.target==='set'){const p=ws.set.pages[j.page];if(p&&p.key===j.key){if(p.asset)(p.history||(p.history=[])).push(p.asset);p.asset=made[0];}}
   else{
    ws.generated=[...made.slice().reverse(),...ws.generated.filter(id=>!made.includes(id))];
    if(j.kind==='image'&&j.prompt)for(const id of made)queueCheck(id,j.prompt);
    if(j.select&&ws.selected.length<LIMIT&&!ws.selected.includes(made[0])){ws.selected.push(made[0]);ws.active=ws.selected.length-1;ws.published=false;}
   }
  }
  if(changed)save();return changed;
 }
 async function queuePlaces(){
  if(Date.now()-queueAt<5000||!liveJobs().some(j=>j.id&&jobRecord(j.id)?.status==='queued'))return;
  queueAt=Date.now();
  try{const data=await api('queue?'+new URLSearchParams({owner:window.EccoAuth?.user?.email||'',offset:'0',limit:'50'}).toString());queueInfo={};for(const x of data.items||[])queueInfo[x.id]={place:x.place,wait_seconds:x.wait_seconds};}catch{}
 }
 // While pictures are being made, check the server every 2.5 seconds while the page is visible (the studio's own refresh runs every 3).
 async function watch(){
  if(watching)return;watching=true;
  try{
   while(ws&&liveJobs().length&&window.EccoStorage?.ready!==false){
    pump();
    if(!document.hidden){try{const next=await api('state');await refresh(next);}catch{}}
    await queuePlaces();
    if(settle()&&page==='images'&&q('#image-workspace'))draw();
    paintJobs();
    await new Promise(r=>setTimeout(r,2500));
   }
  }finally{watching=false;}
 }
 async function cancel(j){
  if(!j.id){j.done=true;j.finished=Date.now();j.error='Cancelled';save();draw();return;}
  const r=jobRecord(j.id);
  try{if(r?.status==='queued'&&!r.started)await api('queue/cancel',{gpu:computeId()||'serverless',job_ids:[j.id]});else await api('generation/stop',{job_id:j.id});}
  catch(error){notice('Could not cancel: '+error.message,true);return;}
  j.cancelRequested=true;save();watch();
 }
 // Typical time, measured from this workspace's finished jobs of the same kind (Fast jobs measured separately).
 const typicalSeconds=(kind,fast)=>{const jobs=state.records.filter(r=>r.kind==='job'),done=ws.jobs.filter(j=>j.done&&j.seconds&&!!j.payload?.quality===!!fast&&(j.kind==='image')===(kind==='image')).map(j=>({status:'done',seconds:j.seconds,created:j.created}));
  return done.length>=2?J.typical(done,'',0):fast?(kind==='image'?15:30):J.typical(jobs,kind==='image'?'image':'edit',kind==='image'?65:150);};
 // Live lines: written in place every second without redrawing the screen.
 function paintJobs(){
  for(const el of all('#image-workspace [data-job]')){
   const j=ws.jobs.find(x=>x.key===el.dataset.job);if(!j)continue;
   const r=jobRecord(j.id),s=j.error&&!r?{state:'failed',text:j.error,pct:null,elapsed:'',left:''}:!j.id&&!j.claimed?{state:'waiting',text:'Waiting its turn · '+IN_FLIGHT+' pictures are sent at a time',pct:null,elapsed:'',left:''}:J.stage(r||(j.id?{status:'queued',created:j.created/1000}:null),Date.now(),queueInfo[j.id],typicalSeconds(j.kind,j.payload?.quality==='fast'));
   const text=q('[data-job-text]',el),time=q('[data-job-time]',el),bar=q('[data-job-bar]',el);
   if(text&&text.textContent!==s.text)text.textContent=s.text;
   const t=[s.elapsed&&s.state!=='done'?s.elapsed+' so far':s.elapsed,s.left].filter(Boolean).join(' · ').replace(/^(?=.)/,'· ');if(time&&time.textContent!==t)time.textContent=t;
   if(bar){bar.classList.toggle('story-gen-indeterminate',s.pct==null&&!['done','failed','cancelled'].includes(s.state));bar.dataset.status=s.state==='done'?'done':['failed','cancelled'].includes(s.state)?'failed':'running';const fill=bar.firstElementChild;if(fill)fill.style.width=(s.pct==null?(s.state==='done'?100:0):s.pct)+'%';if(s.pct!=null)bar.setAttribute('aria-valuenow',String(s.pct));else bar.removeAttribute('aria-valuenow');}
   el.dataset.state=s.state;
   const stop=q('[data-act=cancel-job]',el);if(stop)stop.hidden=['done','failed','cancelled'].includes(s.state)||!!j.cancelRequested;
  }
 }
 function jobCard(j,label){
  return '<div class="iw-job" data-job="'+esc(j.key)+'"><div class="iw-head"><strong class="iw-job-name">'+esc(label)+'</strong><button type="button" class="secondary" data-act="cancel-job" data-key="'+esc(j.key)+'" aria-label="Cancel '+esc(label)+'">Cancel</button></div>'
   +'<div class="story-gen-track story-gen-indeterminate" data-job-bar role="progressbar" aria-label="'+esc(label)+' progress" aria-valuemin="0" aria-valuemax="100"><span style="width:0%"></span></div>'
   +'<p class="help" aria-live="polite"><span data-job-text></span> <span data-job-time></span></p></div>';
 }

 /* ---------- picture check (IMP-03): does the picture show what was asked? ---------- */
 // The AI service's vision model looks at the finished picture and lists requested details it gets wrong
 // (counts, colours, left/right, words). Misses come with Fix it (an instruction edit) and Try again (new seed).
 const CHECK='You are checking a generated picture against the request in the text field. Look at the attached picture. List only requested details that are clearly wrong or missing: counts of things, colours, left/right/above/below positions, and any words that should appear. Ignore style and small details. Return the text field as JSON only: {"ok":true,"misses":[]} or {"ok":false,"misses":["short plain fix instruction", ...]} with at most 4 misses, each written as an instruction such as "Show three red cups, not two".';
 function parseCheck(text){try{const v=JSON.parse(String(text).replace(/^```(?:json)?|```$/g,'').trim());const misses=Array.isArray(v.misses)?v.misses.map(m=>String(m).slice(0,160)).filter(Boolean).slice(0,4):[];return {ok:!!v.ok&&!misses.length,misses};}catch{return null;}}
 const checking=new Set();
 function queueCheck(id,prompt){
  if(!ws.autoCheck||!window.EccoAI?.enabled||ws.checks[id]||checking.has(id))return;
  ws.checks[id]={status:'checking',prompt};checking.add(id);
  api('ai/enhance',{stage:'image',mode:'improve',story_id:null,reference_ids:[id],fields:[{id:'picture_check',text:String(prompt).split('\nVisual style:')[0].slice(0,3000),max_length:4000}],context:{instructions:CHECK},review_only:false})
   .then(result=>{const r=parseCheck(result.revisions?.find(x=>x.id==='picture_check')?.text);ws.checks[id]=r?{status:r.ok?'ok':'misses',misses:r.misses,prompt}:{status:'unknown',prompt};})
   .catch(()=>{ws.checks[id]={status:'unknown',prompt};})
   .finally(()=>{checking.delete(id);save();if(page==='images'&&q('#image-workspace'))draw();});
 }
 async function fixPicture(id){
  const c=ws.checks[id];if(!c?.misses?.length)return;
  try{const gpu=requireCompute(),config=await window.EccoCompute.validate(gpu,EDIT_MODEL),settings={...modelSettings(EDIT_MODEL)};if(quality()==='fast'&&fastReady(EDIT_MODEL))settings.quality='fast';
   const prompt='Fix this picture: '+c.misses.join('; ')+'. Keep everything else the same.';
   queue({kind:'edit',path:'image-edits',payload:{gpu,asset_id:id,asset_ids:[id],prompt,story_id:activeStory,...settings}},{target:'gen',prompt:'Fix: '+c.misses[0]});c.status='fixing';}
  catch(error){notice(error.message,true);return;}
  save();pump();draw();watch();
 }
 async function retryPicture(id){
  const c=ws.checks[id];if(!c?.prompt)return;
  try{const req=await request(c.prompt,{style:ws.genStyle,shape:ws.genShape,seed:Math.floor(Math.random()*2147000000)});queue(req,{target:'gen',prompt:c.prompt});c.status='retried';}
  catch(error){notice(error.message,true);return;}
  save();pump();draw();watch();
 }
 function checksPane(){
  const ids=ws.generated.slice(0,12).filter(id=>ws.checks[id]),list=ids.map(id=>[id,ws.checks[id]]);if(!list.length)return '';
  const busy=list.filter(([,c])=>c.status==='checking').length,ok=list.filter(([,c])=>c.status==='ok').length,miss=list.filter(([,c])=>['misses','fixing','retried'].includes(c.status));
  return '<div class="iw-checks" aria-live="polite"><p class="help">'+(busy?spinner+' Checking '+busy+(busy===1?' picture':' pictures')+' against your prompt… ':'')+(ok?'✓ '+ok+(ok===1?' picture matches':' pictures match')+' your prompt. ':'')+(miss.length?miss.length+(miss.length===1?' picture misses':' pictures miss')+' something:':'')+'</p>'
   +miss.map(([id,c])=>{const done=c.status!=='misses';return '<div class="iw-check" data-check="'+esc(id)+'"><p>'+esc(title(id))+': '+esc(c.misses.join(' · '))+'</p>'+(done?'<p class="help">'+(c.status==='fixing'?'Fixing: the corrected picture appears above when it is ready.':'Trying again with a new seed: the new picture appears above.')+'</p>':'<div class="iw-row"><button type="button" class="secondary" data-act="fix-picture" data-id="'+esc(id)+'" aria-label="Fix it: '+esc(title(id))+'">Fix it</button><button type="button" class="secondary" data-act="retry-picture" data-id="'+esc(id)+'" aria-label="Try again: '+esc(title(id))+'">Try again</button></div>')+'</div>';}).join('')+'</div>';
 }

 /* ---------- small pieces ---------- */
 const img=(id,alt,cls='')=>{const r=record(id);return '<img class="'+cls+'" data-asset="'+esc(id)+'" src="'+esc(r?media(r):'')+'" alt="'+esc(alt)+'">';};
 // Tiles use the small thumbnail where the storage service offers one (blank tiles in the picker, live test 21 Nov).
 const thumb=id=>{const r=record(id);const src=r?(typeof thumbURL==='function'?thumbURL(r):'')||media(r):'';return '<img data-thumb="'+esc(id)+'" src="'+esc(src)+'" alt="" loading="lazy">';};
 const spinner='<span class="generation-spinner" aria-hidden="true"></span>';
 const tab=(id,label,selected,act,extra='')=>'<button type="button" role="tab" id="'+id+'" aria-selected="'+selected+'" tabindex="'+(selected?0:-1)+'" data-act="'+act+'" '+extra+'>'+label+'</button>';
 const drafts=(list,index,act)=>'<div class="pdf-ai-drafts iw-drafts" role="tablist" aria-label="Drafts">'+[0,1,2].map(i=>'<button type="button" role="tab" class="pdf-ai-draft-tab" aria-selected="'+(i===index)+'" tabindex="'+(i===index?0:-1)+'" data-filled="'+(!!list[i])+'" data-act="'+act+'" data-index="'+i+'">Draft '+(i+1)+'</button>').join('')+'</div>';
 function tile(id,number,act){
  const on=number>0;
  return '<button type="button" class="iw-tile" data-act="'+act+'" data-id="'+esc(id)+'" aria-pressed="'+on+'" aria-label="'+esc(title(id))+(on?', selected '+number:'')+'">'+thumb(id)+(on?'<span class="iw-badge">'+number+'</span>':'')+'<span class="iw-cap help">'+esc(title(id))+'</span></button>';
 }
 const styleSelect=(input,value)=>'<label>Style<select data-input="'+input+'"><option value="">No style</option>'+styleGroups().map(([g,list])=>'<optgroup label="'+esc(g)+'">'+list.map(s=>'<option value="'+esc(s)+'"'+(s===value?' selected':'')+'>'+esc(s)+'</option>').join('')+'</optgroup>').join('')+'</select></label>';
 const shapeSelect=(input,value,disabled)=>{const list=shapeList();return list.length?'<label>Shape<select data-input="'+input+'"'+(disabled?' disabled':'')+'>'+list.map(s=>'<option value="'+s.size+'"'+(s.size===value?' selected':'')+'>'+esc(s.name)+'</option>').join('')+'</select></label>':'';};

 /* ---------- step 1: Image ---------- */
 function genPane(){
  const count=Math.max(1,Math.min(J.MAX_VARIATIONS,+ws.genCount||1)),chars=characters(),char=character(ws.genCharacter);
  const live=ws.jobs.filter(j=>j.target==='gen'&&!j.done);
  const ideas=ws.ideas.length?'<div class="iw-group"><span id="iw-ideas-label">Ideas</span><div class="iw-ideas" role="group" aria-labelledby="iw-ideas-label">'+ws.ideas.map((t,i)=>'<div class="iw-idea"><p>'+esc(t)+'</p><button type="button" class="secondary" data-act="use-idea" data-index="'+i+'" aria-label="Use idea '+(i+1)+'">Use</button></div>').join('')+'</div></div>':'';
  return '<section class="pdf-review-box" aria-labelledby="iw-gen-heading"><div class="iw-head"><strong class="pdf-review-heading" id="iw-gen-heading">What should the image show?</strong><button type="button" class="pdf-ai-icon" data-act="ideas" aria-label="Write three picture ideas from this prompt" title="Ideas"'+(busy.ideas||!ws.genPrompt.trim()?' disabled':'')+'>'+(busy.ideas?spinner:'<span aria-hidden="true">✦</span>')+'</button></div>'
   +'<textarea data-input="genPrompt" rows="6" maxlength="3000" aria-labelledby="iw-gen-heading" placeholder="For example: a lighthouse on a black cliff at night, a storm rolling in">'+esc(ws.genPrompt)+'</textarea>'+ideas
   +'<div class="iw-pair">'+styleSelect('genStyle',ws.genStyle)+shapeSelect('genShape',ws.genShape,!!char)+'</div>'
   +'<div class="iw-pair"><label>Pictures<select data-input="genCount">'+[1,2,3,4].map(n=>'<option value="'+n+'"'+(n===count?' selected':'')+'>'+n+'</option>').join('')+'</select></label>'
   +'<label>Character<select data-input="genCharacter"><option value="">No character</option>'+chars.map(c=>'<option value="'+esc(c.id)+'"'+(c.id===ws.genCharacter?' selected':'')+'>'+esc(c.name)+'</option>').join('')+'</select></label></div>'
   +(qualitySelect()?'<div class="iw-pair">'+qualitySelect()+'</div>':'')
   +(char?'<p class="help">'+esc(char.name)+' keeps the same look. The shape follows the character picture.</p>':'')
   +'<button type="button" data-act="generate"'+(ws.genPrompt.trim()?'':' disabled')+'>'+(count>1?'Generate '+count+' pictures':'Generate image')+'</button>'
   +(live.length?'<div class="iw-jobs" aria-label="Pictures in progress">'+live.map((j,i)=>jobCard(j,'Picture '+(i+1)+' · '+String(j.prompt||'').slice(0,40))).join('')+'</div>':'')
   +(ws.generated.length?'<p class="help">Click an image to select it.</p><div class="iw-grid">'+ws.generated.map(id=>tile(id,ws.selected.indexOf(id)+1,'pick')).join('')+'</div>':'')+checksPane()+'</section>';
 }
 function setPane(){
  const s=ws.set,chars=characters(),lines=J.pages(s.pagesText),live=s.pages.some(p=>{const j=ws.jobs.find(x=>x.key===p.key);return j&&!j.done;});
  const one=s.chars.length===1?character(s.chars[0]):null,made=s.pages.filter(p=>record(p.asset)).length;
  return '<section class="pdf-review-box iw-set" aria-labelledby="iw-set-heading"><div class="iw-head"><strong class="pdf-review-heading" id="iw-set-heading">Picture Set</strong><span class="help">'+(s.pages.length?made+' of '+s.pages.length+' pages ready':'One picture per line')+'</span></div>'
   +'<label>Set name<input type="text" data-input="setName" maxlength="80" value="'+esc(s.name)+'" placeholder="For example: The Fox and the Lantern"></label>'
   +'<div class="iw-group"><span id="iw-set-chars">Characters<span class="help"> Pick up to 3 · they look the same on every page</span></span>'+(chars.length?'<div class="iw-options" role="group" aria-labelledby="iw-set-chars">'+chars.map(c=>'<button type="button" class="iw-chip" data-act="set-char" data-id="'+esc(c.id)+'" aria-pressed="'+s.chars.includes(c.id)+'">'+esc(c.name)+'</button>').join('')+'</div>':'<p class="help">No characters yet. Select an image in Selected Images and choose Save as character.</p>')+'</div>'
   +(one?'<div class="iw-row"><button type="button" class="secondary" data-act="sheet">Make '+esc(one.name)+' character sheet (6 views)</button></div>':'')
   +'<div class="iw-pair">'+styleSelect('setStyle',s.style)+shapeSelect('setShape',s.shape,s.chars.length>0)+'</div>'+(qualitySelect()?'<div class="iw-pair">'+qualitySelect()+'</div>':'')
   +'<div class="iw-head"><label for="iw-set-pages">Pages</label><button type="button" class="pdf-ai-icon" data-act="write-pages" aria-label="Write pages from the first line" title="Write pages"'+(busy.pages||!s.pagesText.trim()?' disabled':'')+'>'+(busy.pages?spinner:'<span aria-hidden="true">✦</span>')+'</button></div>'
   +'<textarea id="iw-set-pages" data-input="setPages" rows="7" maxlength="6000" placeholder="One line per page, for example:&#10;The fox finds a lantern in the snow&#10;The fox follows the light into the forest&#10;Or write one idea and press ✦">'+esc(s.pagesText)+'</textarea>'
   +'<button type="button" data-act="make-set"'+(lines.length&&!live?'':' disabled')+'>'+(lines.length?'Generate '+lines.length+(lines.length===1?' page':' pages'):'Generate pages')+'</button>'
   +(s.pages.length?'<div class="iw-set-pages">'+s.pages.map((p,i)=>{
     const j=ws.jobs.find(x=>x.key===p.key),running=j&&!j.done,label='Page '+(i+1);
     return '<figure class="iw-page" data-page="'+i+'"><div class="iw-page-media">'+(record(p.asset)?'<button type="button" class="iw-tile" data-act="pick" data-id="'+esc(p.asset)+'" aria-pressed="'+(ws.selected.includes(p.asset))+'" aria-label="'+esc(label)+': '+esc(p.text)+'">'+thumb(p.asset)+'<span class="iw-badge">'+(i+1)+'</span></button>':'<div class="iw-empty-slot help">'+esc(label)+'</div>')+'</div>'
      +'<figcaption class="help">'+esc(label)+' · '+esc(p.text)+'</figcaption>'+(running?jobCard(j,label):j?.error&&!record(p.asset)?'<p class="help">'+esc(j.error)+'</p>':'')
      +'<div class="iw-row"><button type="button" class="secondary" data-act="redo-page" data-index="'+i+'"'+(running?' disabled':'')+' aria-label="Redo '+esc(label)+'">Redo</button></div></figure>';
    }).join('')+'</div>'
    +'<div class="iw-row"><button type="button" class="secondary" data-act="set-zip"'+(made&&!busy.zip?'':' disabled')+'>'+(busy.zip?spinner+' Preparing…':'Download ZIP')+'</button><button type="button" class="secondary" data-act="set-pdf"'+(made?'':' disabled')+'>Print or save as PDF</button><button type="button" class="secondary" data-act="set-save"'+(made&&!busy.setSave?'':' disabled')+'>'+(busy.setSave?spinner+' Saving…':'Save set to Image Library')+'</button></div>':'')
   +'</section>';
 }
 function sourcePane(){
  if(ws.src==='upload')return '<section class="pdf-review-box" aria-labelledby="iw-upload-heading"><strong class="pdf-review-heading" id="iw-upload-heading">Upload an Image</strong><input type="file" accept="image/png,image/jpeg,image/webp" multiple data-upload-file hidden><div class="story-upload-slot"><button type="button" class="story-upload-target" data-act="upload"'+(busy.upload?' disabled aria-busy="true"':'')+'>'+(busy.upload?spinner:'<span class="story-upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg></span>')+(busy.upload?'Uploading…':'Upload Image')+'</button></div><p class="help">PNG, JPG or WebP, one or several at a time. Uploads are added to Selected Images and kept in Image Library.</p></section>';
  if(ws.src==='generate')return genPane();
  if(ws.src==='set')return setPane();
  const images=state.records.filter(r=>r.kind==='asset'&&r.media==='image'&&!r.deleted).sort((a,b)=>(b.created||0)-(a.created||0));
  const folders=state.records.filter(r=>r.kind==='image_folder'&&!r.deleted);
  const term=ws.search.trim().toLowerCase();
  // Pictures made in Image Generation stay out of Image Library until saved there (owner-approved mocks, 2026-11-16).
  let hidden;try{hidden=new Set(JSON.parse(localStorage.getItem(UNSAVED))||[]);}catch{hidden=new Set();}
  const shown=images.filter(a=>!(hidden.has(a.id)&&!state.records.some(l=>l.kind==='library_item'&&!l.deleted&&l.asset_id===a.id))&&(!term||(a.title||a.prompt||'').toLowerCase().includes(term))&&(!ws.label||state.records.some(l=>l.kind==='library_item'&&!l.deleted&&l.asset_id===a.id&&l.folder_id===ws.label)));
  return '<section class="pdf-review-box" aria-labelledby="iw-lib-heading"><strong class="pdf-review-heading" id="iw-lib-heading">Image Library</strong><div class="iw-pair"><label>Search<input type="search" data-input="search" value="'+esc(ws.search)+'" placeholder="Find an image"></label><label>Label<select data-input="label"><option value="">All images</option>'+folders.map(f=>'<option value="'+esc(f.id)+'"'+(f.id===ws.label?' selected':'')+'>'+esc(f.name)+'</option>').join('')+'</select></label></div><p class="help">Select up to 3 images. Click again to deselect. To merge pictures, pick the background first.</p>'+(shown.length?'<div class="iw-grid iw-library">'+shown.map(a=>tile(a.id,ws.selected.indexOf(a.id)+1,'pick')).join('')+'</div>':'<p class="help">'+(images.length?'No images match.':'Image Library is empty. Upload or generate an image.')+'</p>')+'</section>';
 }
 function selectedPane(){
  const id=ws.selected[ws.active],f=ws.charForm;
  return '<section class="pdf-review-box pdf-selected-label" aria-labelledby="iw-selected-heading"><div class="iw-head"><strong class="pdf-review-heading" id="iw-selected-heading">Selected Images</strong><span class="help">'+ws.selected.length+' of 3</span></div><p class="help">Only these images go to Enhance Image.</p>'+
   (id?'<div class="iw-preview">'+img(id,'Image '+(ws.active+1)+': '+title(id))+'<span class="iw-cap help">Image '+(ws.active+1)+' · '+esc(title(id))+'</span></div>':'<p class="iw-blank help">Choose images from a tab on the left.</p>')+
   '<div class="iw-grid">'+[0,1,2].map(i=>{const s=ws.selected[i];return s?'<div class="iw-slot">'+'<button type="button" class="iw-tile" data-act="show" data-index="'+i+'" aria-pressed="'+(i===ws.active)+'" aria-label="Show image '+(i+1)+': '+esc(title(s))+'">'+thumb(s)+'<span class="iw-badge">'+(i+1)+'</span></button><button type="button" class="iw-remove" data-act="remove" data-index="'+i+'" aria-label="Remove image '+(i+1)+'" title="Remove">×</button></div>':'<div class="iw-empty-slot help">Empty</div>';}).join('')+'</div>'+
   (id?(f?'<div class="iw-character-form" role="group" aria-label="Save as character"><label>Character name<input type="text" data-input="charName" maxlength="100" value="'+esc(f.name)+'" placeholder="For example: Pip the fox"></label><label>What should stay the same<textarea data-input="charDesc" rows="3" maxlength="2000" placeholder="For example: a small red fox with a white chest, green scarf, amber eyes">'+esc(f.desc)+'</textarea></label><div class="iw-row"><button type="button" data-act="char-save"'+(f.name.trim()&&!busy.character?'':' disabled')+'>'+(busy.character?spinner+' Saving…':'Save character')+'</button><button type="button" class="secondary" data-act="char-cancel">Cancel</button></div></div>'
    :'<div class="iw-row"><button type="button" class="secondary" data-act="char-open">Save as character</button></div>'):'')+
   '</section>';
 }
 function improvePane(){
  const id=ws.selected[ws.active],a=id?ai(id):{drafts:[],index:0},shown=a.drafts[a.index];
  return '<section class="pdf-review-box" aria-labelledby="iw-ai-heading"><div class="iw-head"><strong class="pdf-review-heading" id="iw-ai-heading">Improve with AI</strong><button type="button" class="pdf-ai-icon" data-act="improve" aria-label="Improve with AI" title="Improve with AI"'+(!id||busy.improve||!ws.aiPrompt.trim()?' disabled':'')+'>'+(busy.improve?spinner:'<span aria-hidden="true">✦</span>')+'</button></div><textarea data-input="aiPrompt" rows="6" maxlength="2000" aria-label="AI instructions" placeholder="Describe how to change the selected image…">'+esc(ws.aiPrompt)+'</textarea>'+(busy.improve?'<p class="help iw-status" role="status">'+spinner+' Changing the picture. This usually takes 1-3 minutes.</p>':'')+drafts(a.drafts,a.index,'ai-draft')+
   (shown?'<div class="iw-preview iw-preview-small">'+img(shown,'Draft '+(a.index+1))+'<span class="iw-cap help">Draft '+(a.index+1)+'</span></div>':'<p class="iw-blank help">Your AI output will appear here. ✦ fills the next draft, up to 3.</p>')+
   '<div class="iw-row"><button type="button" data-act="use-ai"'+(shown?'':' disabled')+'>Use AI Image</button><button type="button" class="secondary" data-act="clear-ai"'+(shown?'':' disabled')+'>Clear AI Output</button></div></section>';
 }
 function imageStep(){
  const tabs=[['upload','Upload an Image'],['library','Select from Image Library'],['generate','Generate with AI'],['set','Picture Set']];
  return '<div class="story-source-tabs" role="tablist" aria-label="Image source">'+tabs.map(([id,label])=>tab('iw-src-'+id,label,ws.src===id,'src','data-src="'+id+'" aria-controls="iw-src-panel"')).join('')+'</div>'+
   '<div class="story-source-panel" role="tabpanel" id="iw-src-panel" aria-labelledby="iw-src-'+ws.src+'"><div class="pdf-selection-layout iw-layout">'+sourcePane()+selectedPane()+improvePane()+'</div></div>';
 }

 /* ---------- step 2: Enhance Image ---------- */
 function controlsPane(id){
  const e=enh(id);
  if(busy['analyze:'+id])return '<p class="help iw-status">'+spinner+' Picking controls for this image…</p>';
  if(!e.type)return '<div class="iw-group"><span id="iw-type-label">What does this image show?</span><div class="iw-options" role="group" aria-labelledby="iw-type-label">'+M.TYPE_IDS.map(t=>'<button type="button" class="iw-chip" data-act="type" data-type="'+t+'">'+M.TYPES[t].name+'</button>').join('')+'</div></div>';
  return M.sections(e.type,styles()).map(s=>'<div class="iw-section"><h3>'+esc(s.title)+'</h3>'+s.groups.map(g=>{
   const value=e.choices[g.key],picked=g.multi?(Array.isArray(value)?value:[]):value?[value]:[],labelId='iw-g-'+g.key;
   return '<div class="iw-group"><span id="'+labelId+'">'+esc(g.label)+(picked.length?'<b>'+esc(picked.join(', '))+'</b>':'')+(g.multi?'<span class="help"> Pick any</span>':'')+'</span><div class="iw-options" role="group" aria-labelledby="'+labelId+'">'+g.options.map(o=>{
    const n=M.optionName(o),on=picked.includes(n),sug=M.isSuggested(e.analysis,g.key,n);
    return g.swatch?'<button type="button" class="iw-swatch'+(sug?' iw-suggested':'')+'" style="--iw-swatch:'+esc(o.hex)+'" data-act="choose" data-key="'+g.key+'" data-value="'+esc(n)+'" aria-pressed="'+on+'" aria-label="'+esc(n)+(sug?', suggested':'')+'" title="'+esc(n)+'"></button>'
     :'<button type="button" class="iw-chip'+(sug?' iw-suggested':'')+'" data-act="choose" data-key="'+g.key+'" data-value="'+esc(n)+'" aria-pressed="'+on+'"'+(sug?' aria-description="Suggested"':'')+'>'+esc(n)+'</button>';
   }).join('')+'</div></div>';
  }).join('')+'</div>').join('');
 }
 function sent(id,number){
  const e=enh(id),list=e.type?M.chosen(e.type,e.choices,styles()):[],prompt=e.prompt.trim();
  const note=!list.length&&!prompt?'Pick a choice or write a prompt.':prompt&&list.length?'Your prompt and your choices are sent together.':prompt?'Only the prompt is sent.':'No prompt: your choices are sent on their own.';
  return '<h3>Sent to generation</h3><span><span class="help">Image · </span>Image '+number+' · '+esc(title(id))+'</span><span><span class="help">Prompt · </span>'+esc(prompt||'None')+'</span><span><span class="help">Choices · </span>'+esc(list.map(c=>c.label+': '+c.value).join('; ')||'None')+'</span><p class="help">'+note+'</p>';
 }
 function enhanceStep(){
  if(!ws.selected.length)return '<p class="iw-blank help">Choose images in step 1 first.</p>';
  const id=ws.selected[ws.enh],number=ws.enh+1,e=enh(id),shown=e.drafts[e.index],before=e.compare==='before';
  const can=e.type&&M.canGenerate(e.prompt,e.type,e.choices,styles())&&e.drafts.length<DRAFTS&&!busy['enhance:'+id];
  return '<div class="story-source-tabs" role="tablist" aria-label="Images to enhance">'+ws.selected.map((s,i)=>tab('iw-enh-'+i,'Image '+(i+1)+' · '+esc(title(s))+(ws.final[s]?' <span class="iw-done">✓</span>':''),i===ws.enh,'enh','data-index="'+i+'" aria-controls="iw-enh-panel"')).join('')+'</div>'+
   '<div class="story-source-panel" role="tabpanel" id="iw-enh-panel" aria-labelledby="iw-enh-'+ws.enh+'"><div class="pdf-selection-layout iw-layout iw-enhance">'+
   '<section class="pdf-review-box" aria-labelledby="iw-preview-heading"><div class="iw-head"><strong class="pdf-review-heading" id="iw-preview-heading">Preview</strong><div class="iw-row" role="group" aria-label="Compare"><button type="button" class="secondary" data-act="compare" data-mode="before" aria-pressed="'+before+'">Before</button><button type="button" class="secondary" data-act="compare" data-mode="after" aria-pressed="'+!before+'">After</button></div></div>'+
   '<div class="iw-preview">'+img(before?id:shown||finalOf(id),(before?'Before':'After')+': '+title(id))+'<span class="iw-cap help">'+(before?'Before':shown?'Draft '+(e.index+1):ws.final[id]?'Enhanced':'Original')+'</span></div>'+
   drafts(e.drafts,e.index,'enh-draft')+'<p class="help">'+(e.drafts.length?e.drafts.length+' of 3 drafts made for this image.':'Generate fills Draft 1. Each run fills the next draft, up to 3.')+'</p>'+
   '<div class="iw-row"><button type="button" data-act="use-draft"'+(shown?'':' disabled')+'>Use Draft '+(e.index+1)+' for Image '+number+'</button><button type="button" class="secondary" data-act="clear-drafts"'+(e.drafts.length?'':' disabled')+'>Clear drafts</button></div></section>'+
   '<section class="pdf-review-box pdf-selected-label" aria-labelledby="iw-controls-heading"><div class="iw-head"><strong class="pdf-review-heading" id="iw-controls-heading">Enhancements</strong>'+(e.type?'<div class="iw-row"><button type="button" class="secondary" data-act="suggest"'+(e.analysis&&Object.keys(e.analysis.suggestions).length?'':' disabled')+'>✦ Use suggestions</button><button type="button" class="secondary" data-act="clear-choices">Clear</button></div>':'')+'</div><p class="help">✦ marks a suggestion. Your choices are sent with or without a prompt.</p><div class="iw-controls">'+controlsPane(id)+'</div></section>'+
   '<section class="pdf-review-box" aria-labelledby="iw-prompt-heading"><div class="iw-head"><strong class="pdf-review-heading" id="iw-prompt-heading">AI Prompt</strong><span class="help">Optional</span></div><div class="iw-group"><span id="iw-refs-label">Refer to an image</span><div class="iw-options" role="group" aria-labelledby="iw-refs-label">'+ws.selected.map((s,i)=>'<button type="button" class="iw-chip" data-act="ref" data-index="'+i+'">Image '+(i+1)+'</button>').join('')+'</div></div>'+
   '<textarea data-input="enhPrompt" rows="5" maxlength="2000" aria-labelledby="iw-prompt-heading" placeholder="For example: make this character look younger, or draw a photo album cover using Image 1 as the background and the character from Image 2 signing.">'+esc(e.prompt)+'</textarea>'+
   '<div class="iw-sent" data-sent aria-live="polite">'+sent(id,number)+'</div><button type="button" data-act="enhance"'+(can?'':' disabled')+(busy['enhance:'+id]?' aria-busy="true"':'')+'>'+(busy['enhance:'+id]?spinner+' Generating…':e.drafts.length>=DRAFTS?'All 3 drafts made':'Generate Draft '+(e.drafts.length+1))+'</button>'+(busy['enhance:'+id]?'<p class="help iw-status" role="status">Changing the picture. This usually takes 1-3 minutes.</p>':'')+'</section>'+
   '</div></div>';
 }

 /* ---------- step 3: Publish Images ---------- */
 function publishStep(){
  if(ws.published)return '<section class="iw-published" role="status"><h2>'+ws.selected.length+(ws.selected.length===1?' image':' images')+' published to Image Library</h2><p class="help">You can pick them in step 1 next time.</p><div class="iw-row"><button type="button" class="secondary" data-act="open-library">Open Image Library</button><button type="button" class="secondary" data-act="again">Create more images</button></div></section>';
  if(!ws.selected.length)return '<p class="iw-blank help">Choose images in step 1 first.</p>';
  return '<div class="story-source-panel"><div class="iw-publish">'+ws.selected.map((id,i)=>'<figure>'+img(finalOf(id),'Image '+(i+1)+': '+title(id))+'<figcaption class="help">Image '+(i+1)+' · '+esc(title(finalOf(id)))+(ws.final[id]?' · enhanced':'')+'</figcaption></figure>').join('')+'</div></div>';
 }

 /* ---------- frame ---------- */
 function settingsBox(){
  if(!modelOpen)return '';
  const models=MODEL_CATEGORIES.images.models.filter(id=>MODEL_CATALOG[id]&&!MODEL_CATALOG[id].pending&&id!=='trellis-2'),model=imageModel(),s=modelSettings(model),gpus=computes(),gpu=computeId();
  return '<section class="iw-model-settings" id="iw-model" role="dialog" aria-labelledby="iw-model-heading"><div class="iw-head"><h2 id="iw-model-heading">Model settings</h2><button type="button" class="secondary" data-act="model" aria-label="Close model settings">×</button></div>'+
   '<label>Image model<select data-setting="model">'+models.map(id=>'<option value="'+id+'"'+(id===model?' selected':'')+'>'+esc(MODEL_CATALOG[id].name)+(id==='qwen-image-2512'?' (default)':'')+'</option>').join('')+'</select></label><p class="help">When an image or a character is used, '+esc(MODEL_CATALOG[EDIT_MODEL]?.name||'Qwen Image Edit')+' is used automatically.</p>'+
   '<label>Compute<select data-setting="compute"'+(gpus.length?'':' disabled')+'>'+(gpus.length?gpus.map(g=>'<option value="'+esc(g.id)+'"'+(g.id===gpu?' selected':'')+'>'+esc(g.name)+(g.id==='serverless'?' (default)':'')+'</option>').join(''):'<option>Connect Serverless or a GPU in Compute</option>')+'</select></label>'+
   '<div class="iw-pair iw-three"><label>Steps<input type="number" min="5" max="80" data-setting="steps" value="'+esc(s.steps)+'"></label><label>CFG<input type="number" min="1" max="15" step="0.5" data-setting="cfg" value="'+esc(s.cfg)+'"></label><label>Seed<input type="number" min="0" data-setting="seed" value="'+esc(s.seed)+'"></label></div>'+
   '<div class="iw-row iw-end"><button type="button" class="secondary" data-act="reset-model">Reset to defaults</button><button type="button" data-act="model">Done</button></div></section>';
 }
 function foot(){
  if(ws.step==='image')return '<div class="iw-foot"><span class="help">'+ws.selected.length+' selected. You can change them later.</span><button type="button" data-act="step" data-step="enhance"'+(ws.selected.length?'':' disabled')+'>Next: Enhance Image →</button></div>';
  if(ws.step==='enhance')return '<div class="iw-foot"><button type="button" class="secondary" data-act="step" data-step="image">← Back: Image</button><button type="button" data-act="step" data-step="publish">Next: Publish Images →</button></div>';
  return '<div class="iw-foot"><button type="button" class="secondary" data-act="step" data-step="enhance">← Back: Enhance Image</button>'+(ws.published?'':'<button type="button" data-act="publish"'+(ws.selected.length&&!busy.publish?'':' disabled')+(busy.publish?' aria-busy="true"':'')+'>'+(busy.publish?spinner+' Publishing…':'Publish')+'</button>')+'</div>';
 }
 function draw(force){
  const root=q('#page');if(!root||page!=='images')return;load();settle();tidy();
  const steps=[['image','1. Image'],['enhance','2. Enhance Image'],['publish','3. Publish Images']];
  const html='<div id="image-workspace" class="form"><div class="iw-steps" role="tablist" aria-label="Create images steps">'+steps.map(([id,label])=>tab('iw-step-'+id,label,ws.step===id,'step','data-step="'+id+'" aria-controls="iw-step-panel"')).join('')+'</div>'+
   '<section class="panel form story-editor-panel" id="iw-step-panel" role="tabpanel" aria-labelledby="iw-step-'+ws.step+'"><div class="iw-settings" role="group" aria-label="Model"><span class="iw-pill">Model <b>'+esc(modelName())+'</b></span><span class="iw-pill">Compute <b>'+esc(computeName())+'</b></span><button type="button" class="secondary" data-act="model" aria-expanded="'+modelOpen+'"'+(modelOpen?' aria-controls="iw-model"':'')+'>Model settings</button>'+settingsBox()+'</div>'+
   (ws.step==='image'?imageStep():ws.step==='enhance'?enhanceStep():publishStep())+'</section>'+foot()+'</div>';
  // Only rewrite the screen when what it shows has changed (the studio refreshes every 3 seconds).
  if(force||html!==lastHtml||!q('#image-workspace',root)){
   const scroll=window.scrollY,focus=document.activeElement?.closest?.('#image-workspace')?(document.activeElement.dataset.input||document.activeElement.id):'';
   const caret=focus&&typeof document.activeElement.selectionStart==='number'?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;
   root.innerHTML=html;lastHtml=html;
   if(focus){const el=q('#image-workspace [data-input="'+focus+'"]')||q('#'+CSS.escape(focus));el?.focus();if(caret&&el&&typeof el.setSelectionRange==='function')try{el.setSelectionRange(caret[0],caret[1]);}catch{}}
   window.scrollTo(0,scroll);
  }
  paintJobs();
  if(typeof hydrateMedia==='function')hydrateMedia();
  if(liveJobs().length)watch();
  if(!ticker)ticker=setInterval(()=>{if(page==='images'&&q('#image-workspace')&&ws&&liveJobs().length)paintJobs();},1000);
  if(ws.step==='enhance'&&ws.selected.length){const id=ws.selected[ws.enh],e=enh(id);if(!e.type&&!e.tried&&!busy['analyze:'+id])analyze(id);}
 }
 function analyze(id){
  const e=enh(id);e.tried=true;
  if(!window.EccoAI?.enabled){save();draw();return;}
  run('analyze:'+id,async()=>{
   try{
    const result=await api('ai/enhance',{stage:'image',mode:'generate',story_id:activeStory,reference_ids:[finalOf(id)],fields:[{id:'image_enhancement',text:JSON.stringify(M.catalog(styles())),max_length:12000}],context:{}});
    const analysis=M.parseAnalysis(result.revisions?.[0]?.text,styles());e.analysis=analysis;e.type=analysis.type;
   }catch(error){notice(error.message+' Choose what the image shows instead.',true);}
  });
 }

 /* ---------- AI text helpers ---------- */
 async function rewrite(id,idea,instructions){
  if(!window.EccoAI?.enabled)throw Error('Connect AI in Connections to use ✦.');
  const result=await api('ai/enhance',{stage:'storyboard',mode:'generate',story_id:null,fields:[{id,text:idea,max_length:4000}],context:{title:'',genre:'',language:'English',summary:JSON.stringify({output:'image'}),lines:[],instructions},review_only:false});
  const value=result.revisions?.find(r=>r.id===id)?.text;if(typeof value!=='string'||!value.trim())throw Error('AI returned nothing. Try again.');return value.trim();
 }
 const IDEA='Rewrite the idea as one vivid picture description of 1-3 sentences: who is in it, what they are doing, their expressions, the setting and the light. Keep every detail the person asked for, including counts, positions and any words to show. Do not name any art style. Return only the description. Do not ask questions.';
 function ideas(){
  const idea=ws.genPrompt.trim();if(!idea)return;
  return run('ideas',async()=>{const out=[];for(let i=0;i<3;i++)out.push(await rewrite('picture_description',idea,IDEA+(i?' Make version '+(i+1)+' of 3 different in composition and camera angle.':'')));ws.ideas=out;});
 }
 function writePages(){
  const s=ws.set,lines=J.pages(s.pagesText),idea=lines[0]||'';if(!idea)return;
  return run('pages',async()=>{
   const text=await rewrite('set_pages',idea,'Write a picture book of 8 pages from this idea. Return exactly 8 lines, one per page, each one short picture description (who, doing what, where). Keep the same characters throughout. No numbering, no titles, no art style. Do not ask questions.');
   const pages=J.pages(text);if(!pages.length)throw Error('AI returned no pages. Try again.');s.pagesText=pages.join('\n');if(!s.name)s.name=idea.slice(0,60);
  });
 }

 /* ---------- actions ---------- */
 function select(id){
  const i=ws.selected.indexOf(id);
  if(i>=0){ws.selected.splice(i,1);ws.active=Math.min(ws.active,Math.max(0,ws.selected.length-1));}
  else if(ws.selected.length<LIMIT){ws.selected.push(id);ws.active=ws.selected.length-1;}
  else{notice('Select up to 3 images. Remove one first.',true);return;}
  ws.published=false;
 }
 async function queueGenerate(){
  const prompt=ws.genPrompt.trim();if(!prompt)return;
  const count=Math.max(1,Math.min(J.MAX_VARIATIONS,+ws.genCount||1)),chars=ws.genCharacter?[ws.genCharacter]:[];
  const base=count>1?Math.floor(Math.random()*2147000000):null;
  try{
   for(let i=0;i<count;i++){
    const seed=base==null?null:base+i,req=await request(prompt,{style:ws.genStyle,shape:ws.genShape,seed,chars});
    queue(req,{target:'gen',prompt,select:count===1});
   }
  }catch(error){notice(error.message,true);return;}
  save();pump();draw();watch();
 }
 async function makeSet(){
  const s=ws.set,lines=J.pages(s.pagesText);if(!lines.length)return;
  const base=Math.floor(Math.random()*2147000000);
  try{
   s.pages=[];
   for(let i=0;i<lines.length;i++){
    const req=await request(lines[i],{style:s.style,shape:s.shape,seed:base+i,chars:s.chars});
    const j=queue(req,{target:'set',page:i,prompt:lines[i]});s.pages.push({text:lines[i],key:j.key,asset:'',history:[]});
   }
  }catch(error){notice(error.message,true);}
  save();pump();draw();watch();
 }
 async function redoPage(i){
  const s=ws.set,p=s.pages[i];if(!p)return;
  try{const req=await request(p.text,{style:s.style,shape:s.shape,seed:Math.floor(Math.random()*2147000000),chars:s.chars});const j=queue(req,{target:'set',page:i,prompt:p.text});p.key=j.key;}
  catch(error){notice(error.message,true);return;}
  save();pump();draw();watch();
 }
 async function sheet(){
  const id=ws.set.chars[0],c=character(id);if(!c)return;
  try{const gpu=requireCompute();await window.EccoCompute.validate(gpu,EDIT_MODEL);queue({kind:'sheet',path:'character-sheets',payload:{gpu,character_id:id,story_id:activeStory}},{target:'gen',prompt:c.name+' character sheet'});}
  catch(error){notice(error.message,true);return;}
  ws.src='generate';save();pump();draw();watch();notice('Making a 6-view sheet for '+c.name+'. The views appear in Generate with AI.');
 }
 async function bytesOf(id){const r=await api('media/'+id);return {bytes:new Uint8Array(r.buffer),mime:r.mime||'image/png'};}
 function setZip(){
  const s=ws.set;return run('zip',async()=>{
   const files=[];let n=0;
   for(const [i,p] of s.pages.entries()){if(!record(p.asset))continue;const b=await bytesOf(p.asset);files.push({name:String(i+1).padStart(2,'0')+'-'+J.safeName(p.text).slice(0,40)+(/jpe?g/.test(b.mime)?'.jpg':/webp/.test(b.mime)?'.webp':'.png'),bytes:b.bytes});n++;}
   files.push({name:'pages.txt',bytes:new TextEncoder().encode(s.pages.map((p,i)=>'Page '+(i+1)+': '+p.text).join('\n')+'\n')});
   const url=URL.createObjectURL(new Blob([J.zip(files)],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=J.safeName(s.name||'picture-set')+'.zip';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   notice(n+(n===1?' page':' pages')+' downloaded as a ZIP.');
  });
 }
 function setPdf(){
  const s=ws.set,w=window.open('','_blank');if(!w){notice('Allow pop-ups for this site to print or save the set as a PDF.',true);return;}
  w.document.write('<!doctype html><title>'+esc(s.name||'Picture set')+'</title><p>Preparing pages…</p>');
  (async()=>{
   const pages=[];for(const [i,p] of s.pages.entries()){if(!record(p.asset))continue;const b=await bytesOf(p.asset);pages.push({n:i+1,text:p.text,url:URL.createObjectURL(new Blob([b.bytes],{type:b.mime}))});}
   w.document.open();
   w.document.write('<!doctype html><html><head><title>'+esc(s.name||'Picture set')+'</title><style>@page{margin:12mm}body{margin:0;font-family:system-ui,sans-serif}section{page-break-after:always;display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px}img{max-width:100%;max-height:85vh}h1{font-size:20px}p{font-size:14px}</style></head><body>'+(s.name?'<h1>'+esc(s.name)+'</h1>':'')+pages.map(p=>'<section><img src="'+p.url+'" alt="Page '+p.n+'"><p>Page '+p.n+' · '+esc(p.text)+'</p></section>').join('')+'</body></html>');
   w.document.close();setTimeout(()=>{try{w.focus();w.print();}catch{}},600);
  })().catch(error=>{try{w.close();}catch{}notice(error.message,true);});
 }
 function setSave(){
  const s=ws.set;return run('setSave',async()=>{
   const name=String(s.name||'Picture set').replace(/\//g,'-').trim().slice(0,80);
   let folder=state.records.find(r=>r.kind==='image_folder'&&!r.deleted&&r.name===name);if(!folder)folder=await api('library/folders',{name});
   const ids=s.pages.map(p=>p.asset).filter(record);for(const id of ids)await api('library/save',{asset_id:id,folder_id:folder.id});
   unsaved([],ids);await refresh();notice(ids.length+(ids.length===1?' page':' pages')+' saved to Image Library under '+name+'.');
  });
 }
 function act(button){
  const a=button.dataset.act,id=ws.selected[ws.step==='enhance'?ws.enh:ws.active];
  if(a==='step'){ws.step=button.dataset.step;modelOpen=false;}
  else if(a==='src')ws.src=button.dataset.src;
  else if(a==='model')modelOpen=!modelOpen;
  else if(a==='reset-model'){delete modelProfiles.settings[imageModel()];modelProfiles.selected.images='qwen-image-2512';saveModelProfiles();if(computes().some(g=>g.id==='serverless'))localStorage.setItem('ecco-compute-image','serverless');}
  else if(a==='pick')select(button.dataset.id);
  else if(a==='show')ws.active=+button.dataset.index;
  else if(a==='remove'){const i=+button.dataset.index;ws.selected.splice(i,1);ws.active=Math.min(ws.active,Math.max(0,ws.selected.length-1));ws.enh=0;ws.published=false;ws.charForm=null;}
  else if(a==='upload'){q('#image-workspace [data-upload-file]')?.click();return;}
  else if(a==='generate'){queueGenerate();return;}
  else if(a==='cancel-job'){const j=ws.jobs.find(x=>x.key===button.dataset.key);if(j)cancel(j);return;}
  else if(a==='ideas'){ideas();return;}
  else if(a==='fix-picture'){fixPicture(button.dataset.id);return;}
  else if(a==='retry-picture'){retryPicture(button.dataset.id);return;}
  else if(a==='use-idea'){const t=ws.ideas[+button.dataset.index];if(t){ws.genPrompt=t;ws.ideas=[];}}
  else if(a==='set-char'){const c=button.dataset.id,list=ws.set.chars;const i=list.indexOf(c);if(i>=0)list.splice(i,1);else if(list.length<CHARACTERS)list.push(c);else{notice('Pick up to 3 characters.',true);return;}}
  else if(a==='make-set'){makeSet();return;}
  else if(a==='redo-page'){redoPage(+button.dataset.index);return;}
  else if(a==='write-pages'){writePages();return;}
  else if(a==='sheet'){sheet();return;}
  else if(a==='set-zip'){setZip();return;}
  else if(a==='set-pdf'){setPdf();return;}
  else if(a==='set-save'){setSave();return;}
  else if(a==='char-open')ws.charForm={name:'',desc:''};
  else if(a==='char-cancel')ws.charForm=null;
  else if(a==='char-save'){
   const f=ws.charForm,target=id;if(!f||!target||!f.name.trim())return;
   return run('character',async()=>{const c=await api('characters',{asset_id:target,name:f.name.trim(),description:f.desc.trim()||f.name.trim(),story_id:activeStory});unsaved([],[target]);await refresh();ws.charForm=null;if(c?.id&&!ws.set.chars.includes(c.id)&&ws.set.chars.length<CHARACTERS)ws.set.chars.push(c.id);notice((c?.name||f.name.trim())+' saved as a character. Use it in Generate with AI or Picture Set.');});
  }
  else if(a==='improve'){
   const prompt=ws.aiPrompt.trim(),target=id;if(!target||!prompt)return;
   const d=ai(target);if(d.drafts.length>=DRAFTS){notice('All three drafts are in use. Clear the AI output, then try again.',true);return;}
   return run('improve',async()=>{const ids=await edit([target],prompt,'');d.drafts.push(ids[0]);d.index=d.drafts.length-1;});
  }
  else if(a==='ai-draft'){if(id)ai(id).index=+button.dataset.index;}
  else if(a==='use-ai'){const d=ai(id),draft=d.drafts[d.index];if(draft){ws.selected[ws.active]=draft;ws.published=false;}}
  else if(a==='clear-ai'){if(id)ws.ai[id]={drafts:[],index:0};}
  else if(a==='enh')ws.enh=+button.dataset.index;
  else if(a==='type'){const e=enh(id);e.type=button.dataset.type;e.choices={};}
  else if(a==='choose'){const e=enh(id),g=M.groups(e.type,styles()).find(x=>x.key===button.dataset.key);if(g)e.choices=M.toggle(e.choices,g,button.dataset.value);}
  else if(a==='suggest'){const e=enh(id);if(e.analysis)e.choices=JSON.parse(JSON.stringify(e.analysis.suggestions));}
  else if(a==='clear-choices')enh(id).choices={};
  else if(a==='ref'){const e=enh(id),label='Image '+(+button.dataset.index+1);e.prompt=(e.prompt&&!/\s$/.test(e.prompt)?e.prompt+' ':e.prompt)+label+' ';}
  else if(a==='compare')enh(id).compare=button.dataset.mode;
  else if(a==='enh-draft')enh(id).index=+button.dataset.index;
  else if(a==='use-draft'){const e=enh(id),draft=e.drafts[e.index];if(draft){ws.final[id]=draft;ws.published=false;e.compare='after';}}
  else if(a==='clear-drafts'){const e=enh(id);e.drafts=[];e.index=0;}
  else if(a==='enhance'){
   const e=enh(id),number=ws.enh+1,target=id;
   if(!e.type||!M.canGenerate(e.prompt,e.type,e.choices,styles()))return;
   const c=M.compose({number,type:e.type,prompt:e.prompt,choices:e.choices,styles:styles()});
   const others=M.referenced(e.prompt,ws.selected.length).filter(n=>n!==number).map(n=>finalOf(ws.selected[n-1]));
   const ids=[finalOf(target),...others].slice(0,LIMIT);
   return run('enhance:'+target,async()=>{const made=await edit(ids,c.prompt,c.style);e.drafts.push(made[0]);e.index=e.drafts.length-1;e.compare='after';});
  }
  else if(a==='publish')return run('publish',publish);
  else if(a==='open-library'){window.EccoLibraryHub?.open('image');return;}
  else if(a==='again'){const keep={jobs:ws.jobs.filter(j=>!j.done),set:ws.set};ws=fresh();Object.assign(ws,keep);}
  save();draw();
 }
 async function publish(){
  const story=state.records.find(r=>r.kind==='story'&&r.id===activeStory),name=String(story?.title||'').replace(/\//g,'-').trim().slice(0,80);
  let folder=name?state.records.find(r=>r.kind==='image_folder'&&!r.deleted&&r.name===name):null;
  const ids=ws.selected.map(finalOf);
  for(const id of ids){
   const r=record(id);if(r&&r.stage!=='prod')await api('approve',{asset_id:id});
   if(name){if(!folder)folder=await api('library/folders',{name});if(folder&&!folder.deleted)await api('library/save',{asset_id:id,folder_id:folder.id});}
  }
  unsaved([],ids);await refresh();ws.published=true;notice(ws.selected.length+(ws.selected.length===1?' image':' images')+' published to Image Library.');
 }
 const INPUTS={charName:v=>{ws.charForm&&(ws.charForm.name=v);},charDesc:v=>{ws.charForm&&(ws.charForm.desc=v);},setName:v=>{ws.set.name=v;},setPages:v=>{ws.set.pagesText=v;},setStyle:v=>{ws.set.style=v;},setShape:v=>{ws.set.shape=v;},genCount:v=>{ws.genCount=Math.max(1,Math.min(4,+v||1));},genCharacter:v=>{ws.genCharacter=v;},genQuality:v=>{ws.genQuality=v==='best'?'best':'fast';}};
 function input(el){
  const k=el.dataset.input;
  if(k==='enhPrompt'){const id=ws.selected[ws.enh],e=enh(id);e.prompt=el.value;const box=q('#image-workspace [data-sent]');if(box)box.innerHTML=sent(id,ws.enh+1);const b=q('#image-workspace [data-act=enhance]');if(b&&!busy['enhance:'+id])b.disabled=!(e.type&&M.canGenerate(e.prompt,e.type,e.choices,styles())&&e.drafts.length<DRAFTS);save();return;}
  if(INPUTS[k]){INPUTS[k](el.value);save();if(el.tagName==='SELECT'||k==='setPages'||k==='charName')draw();return;}
  ws[k]=el.value;save();
  if(k==='genPrompt'){const b=q('#image-workspace [data-act=generate]');if(b)b.disabled=!el.value.trim();const i=q('#image-workspace [data-act=ideas]');if(i&&!busy.ideas)i.disabled=!el.value.trim();}
  if(k==='aiPrompt'&&!busy.improve){const b=q('#image-workspace [data-act=improve]');if(b)b.disabled=!ws.selected.length||!el.value.trim();}
  if(k==='search'||k==='label'||k==='genStyle'||k==='genShape')draw();
 }
 function setting(el){
  const k=el.dataset.setting,model=imageModel();
  if(k==='model'){modelProfiles.selected.images=el.value;saveModelProfiles();}
  else if(k==='compute'){localStorage.setItem('ecco-compute-image',el.value);}
  else{const n=Number(el.value);if(Number.isFinite(n)){modelProfiles.settings[model]={...modelProfiles.settings[model],[k]:n};saveModelProfiles();}}
  draw();
 }
 async function upload(files){
  files=[...(files||[])].filter(Boolean);if(!files.length)return;
  const bad=files.filter(f=>!/^image\/(png|jpeg|webp)$/.test(f.type));
  if(bad.length){notice(bad.length===files.length?'Choose a PNG, JPG or WebP image.':bad.length+' file(s) skipped: choose PNG, JPG or WebP images.',true);files=files.filter(f=>!bad.includes(f));if(!files.length)return;}
  await run('upload',async()=>{
   let full=0;
   for(const file of files){
    const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('The image could not be read.'));r.readAsDataURL(file);});
    const made=await api('images/upload',{name:file.name,data,story_id:activeStory});await refresh();
    if(!state.records.some(r=>r.id===made.id))state.records.push(made);
    if(ws.selected.length<LIMIT){ws.selected.push(made.id);ws.active=ws.selected.length-1;}else full++;
   }
   if(full)notice('Uploaded. Selected Images already has 3; remove one to use '+(full===1?'it':'the others')+'.',true);
  });
 }

 /* ---------- wiring ---------- */
 document.addEventListener('click',e=>{const b=e.target.closest?.('#image-workspace [data-act]');if(b&&!b.disabled){e.preventDefault();act(b);}});
 document.addEventListener('input',e=>{if(e.target.closest?.('#image-workspace')&&e.target.dataset.input&&e.target.tagName!=='SELECT')input(e.target);});
 document.addEventListener('change',e=>{
  if(!e.target.closest?.('#image-workspace'))return;
  if(e.target.matches('[data-upload-file]')){upload(e.target.files);e.target.value='';}
  else if(e.target.dataset.setting)setting(e.target);
  else if(e.target.tagName==='SELECT'&&e.target.dataset.input)input(e.target);
 });
 document.addEventListener('keydown',e=>{
  const t=e.target.closest?.('#image-workspace [role=tab]');if(!t||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  const tabs=all('[role=tab]',t.parentElement),i=tabs.indexOf(t),n=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  e.preventDefault();tabs[n].click();const label=tabs[n].id;requestAnimationFrame(()=>q('#'+CSS.escape(label))?.focus());
 });
 // Two tabs show the same work: a change saved in one tab is picked up by the other (live test 21 Nov: tabs disagreed).
 window.addEventListener('storage',e=>{if(!wsStory||e.key!==key(wsStory)||!e.newValue)return;try{const next=JSON.parse(e.newValue);if(next&&typeof next==='object'){ws={...fresh(),...next};ws.set={...freshSet(),...(ws.set||{})};if(page==='images'&&q('#image-workspace'))draw(true);}}catch{}});
 document.addEventListener('ecco:gpu-connection-change',()=>{if(page==='images'&&q('#image-workspace'))draw();});
 const storyMode=()=>window.EccoStoryWorkspace?.active||document.body.classList.contains('story-simple-mode');
 // The new screen opens from the Create Images entry points: the left-nav step, the Story home list and
 // the journey guide's Back/Next. Other flows that open the image page (refine an image, instruction
 // edits, uploads, character handoff) keep the existing image form they fill in.
 let entry=0,open=false;
 const ENTRY='#workspace-image-studio-node,#workspace-production-group [data-page="images"],nav [data-page="images"],#story-home-list [data-story-destination="images"],#journey-guide [data-back],#journey-guide [data-next]';
 document.addEventListener('click',e=>{if(e.target.closest?.(ENTRY))entry=Date.now();},true);
 const previous=imagePage,navigateBefore=navigate;
 navigate=function(target){if(target!=='images'){open=false;entry=0;lastHtml='';}return navigateBefore.apply(this,arguments);};
 imagePage=function(){
  const asked=Date.now()-entry<5000;entry=0;
  if(asked){open=true;lastHtml='';}
  if(storyMode()||!window.EccoImageWorkspaceModel||!window.EccoImageJobs||!open||refinementSource){open=false;return previous.apply(this,arguments);}
  if(!state.storage_pending&&!stories().length){$('#page').innerHTML=empty('Start a new story','Choose + New story in the sidebar, or restore a story from Trash.');lastHtml='';return;}
  draw();
 };
 /* ---------- sidebar: Studios › Image Studio (owner request 18 Nov 2026; moved out of Tell Your Story) ---------- */
 function openStudio(step){
  window.EccoStoryWorkspace?.leave?.();entry=Date.now();navigate('images');
  if(step&&q('#image-workspace')){load();ws.step=step;save();draw();}
  studioNode();
 }
 function studioNode(){
  const box=q('#workspace-studios-group > .workspace-library-content');if(!box)return;
  let node=q('#workspace-image-studio-node');
  if(!node){
   node=document.createElement('button');node.type='button';node.className='journey-step';node.id='workspace-image-studio-node';
   node.innerHTML='<span aria-hidden="true">- </span>Image Studio';
   node.addEventListener('click',()=>openStudio());
  }
  if(box.firstElementChild!==node)box.prepend(node);
  node.classList.toggle('active',page==='images'&&!!q('#image-workspace'));
 }
 if(typeof names!=='undefined')names.images='Image Studio';
 let nodeQueued=false;new MutationObserver(()=>{if(nodeQueued)return;nodeQueued=true;queueMicrotask(()=>{nodeQueued=false;studioNode();});}).observe(document.querySelector('aside')||document.body,{childList:true,subtree:true});
 studioNode();
 window.EccoImageWorkspace={draw,open:openStudio,get state(){return ws;}};
})();
