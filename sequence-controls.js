'use strict';
(()=>{
 const busy=j=>['queued','running','paused'].includes(j.status);
 const sequences=()=>state?.records?.filter(j=>(j.source_kind==='audio_video_job'||j.kind==='audio_video_job')&&busy(j))||[];
 function render(root,jobs){
  const signature=JSON.stringify(jobs.map(j=>[j.id,j.status,j.progress,j.pause_requested,j.stop_requested]));
  if(root.dataset.signature===signature)return;root.dataset.signature=signature;root.replaceChildren();
  for(const job of jobs){
   const box=document.createElement('div');box.className='form';box.style.gap='8px';
   const info=document.createElement('p');info.className='help';info.textContent=(job.title||'Video sequence')+' · '+(job.progress||job.status);box.append(info);
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
  for(const [host,id,jobs] of [[form,'video-sequence-controls',sequences().filter(j=>j.story_id===activeStory)],[panel,'activity-sequence-controls',sequences()]]){
   let root=document.getElementById(id);
   if(!host||!enabled||!jobs.length){root?.remove();continue;}
   if(!root){root=document.createElement('section');root.id=id;root.setAttribute('aria-label','Sequence controls');if(host===form)host.append(root);else host.querySelector('#jobs').before(root);}
   render(root,jobs);
  }
 }
 setInterval(draw,1000);draw();
})();

// Display existing restrictions without changing generation parameters.
(()=>{
 function draw(){
  for(const form of document.querySelectorAll('.generation-form')){
   const kind=form.dataset.generationStudio,id=form.querySelector('#job-model,[name=model]')?.value;
   const host=form.querySelector('[data-settings]');if(!host)continue;
   let box=host.querySelector('[data-model-limits]');if(!box){box=document.createElement('div');box.dataset.modelLimits='';box.className='help';host.append(box);}
   let limits=[];
   if(kind==='audio')limits=['Studio: up to 20 spoken lines, 500 characters per line and 4,000 characters per request.'];
   else if(id==='longcat-avatar-1.5')limits=['Studio: maximum seconds per clip is your saved choice (default 10). Up to 60 shots and 20 minutes of source audio per sequence.','Shorter clips reduce retry work; longer clips reduce repeated loading. Longer clip sizes are not yet benchmarked.'];
   else if(id==='wan-a14b')limits=['Studio: 1–6 seconds per shot; up to 60 seconds per render.'];
   else if(id==='wan-5b')limits=['Studio: 1–5 seconds per shot; up to 60 seconds per render.'];
   else if(kind==='image')limits=['Studio: one output per job; up to 4,000 characters for the combined prompt. Resolution choices and sampling-step ranges are shown above.'];
   else if(id==='preview')limits=['Studio: 1–30 seconds per scene.'];
   const text=limits.join(' ');if(box.dataset.text===text)continue;box.dataset.text=text;box.replaceChildren();
   if(text){const title=document.createElement('strong');title.textContent='Model limits';const p=document.createElement('p');p.textContent=text;box.append(title,p);}
  }
 }
 setInterval(draw,1000);draw();
})();
