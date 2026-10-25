'use strict';
(() => {
 const operations=new Map(),pending=new Map(),known=new Map();
 const active=job=>['queued','running','cancelling','paused'].includes(job?.status);
 const key=(kind,story)=>kind+':'+story;
 const routes={'images':'image','image-edits':'image','character-sheets':'image','videos':'video','longcat/generate':'video','longcat/sequence':'video','audio/generate':'audio','audio/sounds/generate':'audio'};
 const stopped=()=>Object.assign(Error('Stopped by user. Your draft and completed media are saved.'),{name:'GenerationStopped'});
 function begin(kind,story){const token={kind,story,ids:new Set(),stopped:false,finished:false};operations.set(key(kind,story),token);return token;}
 function assert(token){if(token?.stopped)throw stopped();}
 function finish(token){if(token)token.finished=true;update();}
 function remember(job){if(!job?.id)return;known.set(job.id,job);const existing=state.records.find(r=>r.id===job.id);if(existing)Object.assign(existing,{status:job.status,progress:job.progress,cancel_requested:job.cancel_requested,error:job.error});}
 async function cancelJob(id){
  if(pending.has(id))return pending.get(id);
  const request=(async()=>{const result=await api('generation/stop',{job_id:id});remember(result);return result;})();
  pending.set(id,request);try{return await request;}finally{pending.delete(id);}
 }
 const original=api;
 api=async function(path,body,...rest){
  const kind=routes[path],story=body?.story_id||activeStory,token=kind&&operations.get(key(kind,story));
  if(kind)assert(token);
  const result=await original.call(this,path,body,...rest);
  if(kind&&result?.id){
   remember(result);token?.ids.add(result.id);
   if(token?.stopped){let response;try{response=await cancelJob(result.id);}catch(error){error.job=result;throw error;}const error=stopped();error.job=response;throw error;}
  }
  if(path==='state')for(const job of result.records||[])if(known.has(job.id))known.set(job.id,job);
  return result;
 };
 function jobs(kind,story,token){
  const ids=new Set(token?.ids||[]),id=window.EccoGeneration?.jobId(kind,story);if(id)ids.add(id);
  // Includes generated sound cues and generations recovered after a refresh.
  for(const r of state.records)if(r.story_id===story&&r.media===kind&&active(r)&&['job','audio_job','longcat_job','audio_video_job'].includes(r.kind))ids.add(r.id);
  return [...ids].map(id=>known.get(id)||state.records.find(r=>r.id===id)).filter(active);
 }
 async function stop(kind,story){
  const token=operations.get(key(kind,story));if(token)token.stopped=true;
  const button=document.getElementById('stop-'+kind);if(button)button.disabled=true;
  try{await Promise.all(jobs(kind,story,token).map(job=>cancelJob(job.id)));await refresh();}
  catch(error){if(token)token.stopError=error.message;notice('Could not confirm Stop: '+error.message+' Press Stop to retry.',true);}
  update();
 }
 function update(){
  for(const kind of ['image','audio','video']){
   const form=document.getElementById(kind+'-form'),generate=form?.querySelector('#generate-'+kind);if(!generate)continue;
   let button=form.querySelector('#stop-'+kind);
   if(!button){button=document.createElement('button');button.id='stop-'+kind;button.type='button';button.className='secondary';button.textContent='Stop';button.setAttribute('aria-label','Stop '+kind+' generation');button.title='Stop this generation; keep completed media';generate.after(button);button.onclick=()=>stop(kind,activeStory);}
   const token=operations.get(key(kind,activeStory)),running=jobs(kind,activeStory,token),preparing=token&&!token.finished;
   const waiting=running.some(j=>pending.has(j.id)||j.status==='cancelling'||j.cancel_requested),busy=preparing||running.length>0;
   const label=waiting||token?.stopped&&preparing?'Stopping…':'Stop';if(button.textContent!==label)button.textContent=label;
   button.disabled=!busy||waiting||Boolean(token?.stopped&&!token.finished&&!running.length);
   if(busy)generate.disabled=true;
  }
 }
 window.EccoGenerationStop={begin,assert,finish,stop};
 let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;update();});}).observe(document.body,{childList:true,subtree:true});
 setInterval(update,500);update();
})();
