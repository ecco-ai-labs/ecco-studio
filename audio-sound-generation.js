'use strict';
(() => {
 const modelFor=kind=>kind==='music'?'ace-step-1.5':'moss-soundeffect-v2';
 const models={'moss-soundeffect-v2':'MOSS SoundEffect v2','ace-step-1.5':'ACE-Step 1.5'};
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const mounts=new Map();
 function availability(status,selection){for(const [area,apply] of mounts){if(!area.isConnected)mounts.delete(area);else apply(status,selection);}}
 const running=new Map(),journalKey='ecco-sound-jobs-v1';
 const journal=()=>JSON.parse(localStorage.getItem(journalKey)||'{}');
 function rememberJob(key,value){const jobs=journal();jobs[key]=value;localStorage.setItem(journalKey,JSON.stringify(jobs));}
 function soundRequest(cue,{compute='cpu',worker_id='',story_id=activeStory||null}={}){
  return {kind:cue.kind,description:String(cue.description||'').trim(),title:cue.name,model:modelFor(cue.kind),duration:Number(cue.duration)||(cue.kind==='music'?20:5),compute,worker_id,story_id};
 }
 // Persist the job before polling. A lost response is not permission to submit twice.
 async function generate(request,{valid=()=>{},progress=()=>{},task=()=>{},replace=false}={}){
  const id=JSON.stringify(request);
  if(running.has(id)){const asset=await running.get(id);valid();return asset;}
  const operation=(async()=>{
   valid();if(!window.EccoStorage?.ready)throw Error('Connect workspace storage first.');
   if(!request.description)throw Error('Describe the sound you want to create.');
   const min=request.kind==='music'?10:1,max=request.kind==='music'?60:30;
   if(!Number.isFinite(request.duration)||request.duration<min||request.duration>max)throw Error('Choose a sound duration from '+min+' to '+max+' seconds.');
   let record=journal()[id];
   if(record?.status==='submitting')throw Error('The sound submission was not confirmed. Check Activity or Audio Library before submitting this sound again.');
   if(record?.status==='done'&&!replace){window.EccoAudioLibrary?.remember(record.asset);return record.asset;}
   if(!record?.id||['done','error','cancelled'].includes(record.status)){
    progress('Checking sound worker…');const available=await api('audio/status');valid();
    const target=window.EccoAudioCompute?.target(available,request.compute,request.worker_id)||(!request.worker_id?available.compute?.[request.compute]:null);
    if(!target?.ready||!target.sound_models?.includes(request.model))throw Error(models[request.model]+' is not installed and verified on the selected '+request.compute.toUpperCase()+' worker. Choose a CPU with this sound model.');
    rememberJob(id,{status:'submitting'});
    let job;try{job=await api('audio/sounds/generate',request);}catch(error){if(error.job?.id)rememberJob(id,{id:error.job.id,status:error.job.status==='cancelled'?'cancelled':'queued'});throw error;}
    if(!job.id)throw Error('The service did not confirm a sound job. Check Activity before retrying.');
    record={id:job.id,status:'queued'};rememberJob(id,record);
   }
   await window.EccoGenerationStop?.track('audio',request.story_id||activeStory,{id:record.id,status:record.status||'queued',task:'sound'});
   task({id:record.id,status:'queued',message:'Waiting for the sound worker…'});
   const started=Date.now();
   while(Date.now()-started<1850000){
    valid();
    const result=await api('audio/jobs/'+encodeURIComponent(record.id));
    window.EccoGenerationStop?.remember({id:record.id,...result});
    task({id:record.id,status:result.status,message:result.error||result.progress||'Waiting for the sound worker…',steps:result.sound_progress});
    if(result.status==='cancelled'){rememberJob(id,{...record,status:'cancelled'});throw Object.assign(Error('Stopped by user. Your draft and completed sounds are saved.'),{name:'GenerationStopped'});}
    if(['error','failed'].includes(result.status)){rememberJob(id,{...record,status:'error'});throw Error(result.error||'Sound generation failed.');}
    if(result.status==='done'){
     const asset=result.asset;if(!asset?.id||asset.media!=='audio'||asset.kind!=='asset')throw Error('The job finished without a saved sound asset. Check Audio Library.');
     rememberJob(id,{...record,status:'done',asset});window.EccoAudioLibrary?.remember(asset);valid();return asset;
    }
    valid();progress(result.progress||'Waiting for the sound worker…');await sleep(2000);
   }
   throw Error('Still processing. Generate again to resume checking this sound; it will not submit a duplicate.');
  })();
  running.set(id,operation);try{return await operation;}finally{running.delete(id);}
 }
 async function ensure({plan,lines,assets,compute='cpu',worker_id='',story_id,valid,changed,progress,tasks=()=>{}}){
  if(!plan?.enabled)return;
  if(plan.speech_key!==window.EccoSoundDesign.key(lines))throw Error('The script changed. Review the sound timing in Final Script before generating.');
  window.EccoSoundDesign.validate(plan.cues,lines,{assets});
  // Validate timing and speech limits before spending time generating any files.
  const placeholders=plan.cues.map((cue,i)=>({...cue,asset_id:cue.asset_id||'pending-sound-'+i}));
  window.EccoSoundDesign.prepare({...plan,cues:placeholders},lines,[...assets,...placeholders.filter(c=>c.asset_id.startsWith('pending-sound-')).map(c=>({id:c.asset_id}))]);
  const rows=plan.cues.map((cue,index)=>({key:'sound-'+index,name:cue.name,status:cue.asset_id?'done':'waiting',message:cue.asset_id?'Existing sound ready':''}));
  const publish=()=>tasks(rows.map(r=>({...r})));publish();
  const missing=plan.cues.filter(c=>!c.asset_id);let completed=0;
  for(const cue of missing){
   valid();const row=rows[plan.cues.indexOf(cue)],before=JSON.stringify(cue);row.status='running';row.message='Checking sound worker…';publish();
   const current=()=>{valid();if(JSON.stringify(cue)!==before)throw Error('The sound cue changed. Your edits are preserved; generate again.');};
   try{
    const asset=await generate(soundRequest(cue,{compute,worker_id,story_id}),{valid:current,task:state=>{Object.assign(row,state);publish();},progress:message=>{row.message=message;publish();progress('Sound '+(completed+1)+' of '+missing.length+' · '+cue.name+' · '+message+' · '+completed+' files complete');}});
    current();cue.asset_id=asset.id;completed++;row.status='done';row.message='Sound saved';publish();changed();progress('Generating Sounds: '+completed+' of '+missing.length+' complete · '+cue.name+' ready');
   }catch(error){row.status=error.name==='GenerationStopped'?'cancelled':'error';row.message=error.message;publish();if(error.name==='GenerationStopped')throw error;throw Error(cue.name+': '+error.message+' Completed sounds are saved. Generate audio again to continue.');}
  }
 }
 function mount({box,cue,changed,valid,settingsChanged=()=>{},preferredCompute}){
  const area=document.createElement('div');area.className='form';area.dataset.soundGeneration='';
  area.innerHTML='<div class="generation-filter-row"><label>Sound Model<select data-sound-model></select></label><label>Duration (Seconds)<input type="number" data-sound-duration step="1"></label><label>Compute<select data-sound-compute><option value="cpu">CPU</option><option value="a100">A100</option><option value="b200">B200</option></select></label></div><button type="button" class="secondary" data-generate-sound>Generate Sound</button><button type="button" class="secondary" data-cancel-generation="audio">Cancel</button><p class="help" role="status" data-sound-availability></p><p class="help" role="status" data-sound-status></p>';
  box.querySelector('[data-field=description]').closest('label').after(area);
  const q=s=>area.querySelector(s),model=modelFor(cue.kind),duration=q('[data-sound-duration]'),compute=q('[data-sound-compute]'),button=q('button'),status=q('[data-sound-status]');
  q('[data-sound-model]').add(new Option(models[model],model));duration.min=cue.kind==='music'?10:1;duration.max=cue.kind==='music'?60:30;duration.value=cue.duration||(cue.kind==='music'?20:5);compute.value=cue.compute||'cpu';
  const collect=()=>{cue.duration=Number(duration.value);Object.assign(cue,window.EccoAudioCompute?.parse(compute.value)||{compute:compute.value,worker_id:''});settingsChanged();};duration.oninput=collect;compute.onchange=()=>{collect();showAvailability();};
  const selected=preferredCompute||cue;if(selected.worker_id)compute.add(new Option('CPU · '+selected.worker_id,'cpu:'+selected.worker_id));compute.value=window.EccoAudioCompute?.value(selected.compute||'cpu',selected.worker_id)||selected.compute||'cpu';
  let pending=false,capabilities=null,mainValue=preferredCompute?window.EccoAudioCompute.value(preferredCompute.compute||'cpu',preferredCompute.worker_id||''):null;
  function showAvailability(){
   const choice=window.EccoAudioCompute?.parse(compute.value)||{},result=window.EccoAudioCompute?.readiness(capabilities,choice.compute,choice.worker_id,model,true)||{ready:false,reason:'Checking worker availability…'};
   q('[data-sound-model]').options[0].disabled=!result.ready;
   button.disabled=pending||!result.ready;
   q('[data-sound-availability]').textContent=result.ready?'':result.reason;
  }
  function applyAvailability(available,main){
   capabilities=available;if(pending)return;
   let previous=compute.value;
   if(preferredCompute&&main){const next=window.EccoAudioCompute.value(main.compute,main.worker_id);if(next!==mainValue){previous=next;mainValue=next;}}
   const choices=window.EccoAudioCompute?.choices(available)||[];
   if(choices.length){
    const signature=JSON.stringify(choices);if(compute.dataset.options!==signature){compute.replaceChildren(...choices.map(c=>new Option(c.label,c.value)));compute.dataset.options=signature;}
    if(previous==='cpu')previous=choices.find(c=>c.compute==='cpu'&&c.ready)?.value||choices.find(c=>c.compute==='cpu')?.value||previous;
    if(previous&&![...compute.options].some(o=>o.value===previous))compute.add(new Option(previous+' · Unavailable',previous));
    compute.value=previous;
   }
   showAvailability();
  }
  mounts.set(area,applyAvailability);showAvailability();
  const refreshChoices=async()=>{if(!window.EccoStorage?.ready||!window.EccoAudioCompute){applyAvailability(null);return;}const available=await api('audio/status');if(area.isConnected)applyAvailability(available);};
  button.onclick=async()=>{
   if(pending||button.disabled)return;
   const stopToken=window.EccoGenerationStop?.begin('audio',activeStory);
   try{
    valid();collect();if(!window.EccoStorage?.ready)throw Error('Connect workspace storage first.');
    if(!cue.description.trim())throw Error('Describe the sound you want to create.');if(!duration.reportValidity())return;
    pending=true;button.disabled=true;button.setAttribute('aria-busy','true');button.innerHTML='<span class="generation-spinner" aria-hidden="true"></span>Checking Worker…';
    const request=soundRequest(cue,{compute:cue.compute,worker_id:cue.worker_id,story_id:activeStory||null});
    const signature=()=>JSON.stringify([cue.kind,cue.description.trim(),cue.name,cue.duration,cue.compute,cue.worker_id,cue.asset_id]),before=signature();
    const current=()=>{window.EccoGenerationStop?.assert(stopToken);valid();if(!area.isConnected||signature()!==before)throw Error('The sound changed. Your edits were kept; find the completed file in Audio Library.');};
    button.innerHTML='<span class="generation-spinner" aria-hidden="true"></span>Generating Sound…';
    const asset=await generate(request,{valid:current,replace:!!cue.asset_id,progress:message=>{if(area.isConnected)status.textContent=message;}});
    current();cue.asset_id=asset.id;changed();

   }catch(error){if(area.isConnected)status.textContent=error.message;}
   finally{pending=false;window.EccoGenerationStop?.finish(stopToken);if(area.isConnected){button.setAttribute('aria-busy','false');button.textContent='Generate Sound';showAvailability();}}
  };
  refreshChoices().catch(error=>{if(area.isConnected){applyAvailability(null);status.textContent=error.message;}});
 }
 window.EccoSoundGeneration={mount,modelFor,models,generate,ensure,soundRequest,availability};
})();

