'use strict';
(()=>{
 const busy=j=>['queued','running','paused'].includes(j.status);
 const sequences=()=>state?.records?.filter(j=>(j.source_kind==='audio_video_job'||j.kind==='audio_video_job')&&busy(j))||[];
 function render(root,jobs){
  const signature=JSON.stringify(jobs.map(j=>[j.id,j.status,j.progress,j.pause_requested,j.stop_requested,window.EccoClipProgress?.clips(j,state.records)]));
  if(root.dataset.signature===signature)return;root.dataset.signature=signature;root.replaceChildren();
  for(const job of jobs){
   const box=document.createElement('div');box.className='form';box.style.gap='8px';
   const info=document.createElement('p');info.className='help';info.textContent=(job.title||'Video sequence')+' · '+(window.EccoClipProgress?.summary(job)||job.status);box.append(info);if(root.id==='video-sequence-controls'&&window.EccoClipProgress){const bars=document.createElement('div');bars.innerHTML=window.EccoClipProgress.html(job,state.records);box.append(bars);}if(!busy(job)){root.append(box);continue;}
   const row=document.createElement('div');row.className='row';
   for(const [action,label] of [[job.pause_requested||job.status==='paused'?'resume':'pause',job.pause_requested||job.status==='paused'?'Resume':'Ⅱ Pause after current clip'],['stop','■ Stop after current clip']]){
    const b=document.createElement('button');b.type='button';b.className='secondary small';b.textContent=label;b.disabled=!!job.stop_requested;
    b.onclick=async()=>{row.querySelectorAll('button').forEach(x=>x.disabled=true);try{await api('longcat/control',{job_id:job.id,action});await refresh();draw();}catch(e){notice(e.message,true);delete root.dataset.signature;draw();}};row.append(b);
   }
   box.append(row);root.append(box);
  }
 }
 function draw(){
  if(typeof state==='undefined')return;
  const enabled=state.config?.longcat?.sequence_controls;
  const form=document.querySelector('#video-form'),panel=document.querySelector('#activity-panel');
  for(const [host,id,jobs] of [[form,'video-sequence-controls',(state.records||[]).filter(j=>(j.source_kind==='audio_video_job'||j.kind==='audio_video_job')&&j.story_id===activeStory).sort((a,b)=>b.created-a.created).slice(0,1)],[panel,'activity-sequence-controls',sequences()]]){
   let root=document.getElementById(id);
   if(!host||!enabled||!jobs.length){root?.remove();continue;}
   if(!root){root=document.createElement('section');root.id=id;root.setAttribute('aria-label','Sequence controls');if(host===form)host.append(root);else host.querySelector('#jobs').before(root);}
   render(root,jobs);
  }
 }
 setInterval(draw,1000);draw();
})();

