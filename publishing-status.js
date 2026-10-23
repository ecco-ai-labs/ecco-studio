'use strict';
/* Durable, credential-free publishing diagnostics, including requests not accepted by the API. */
(()=>{
 const KEY='ecco-publishing-attempts-v1',LIMIT=50,q=s=>document.querySelector(s),busyStates=new Set(['submitting','queued','running']);
 const redact=value=>window.EccoErrorLog?.redact(String(value??''))||String(value??'').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').replace(/([?&](?:token|key|code)=)[^&\s]+/gi,'$1[REDACTED]');
 let attempts=[];try{const saved=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(saved))attempts=saved.filter(a=>a&&typeof a.id==='string'&&typeof a.asset_id==='string').slice(-LIMIT);}catch{}
 // A browser reload cannot tell whether an interrupted request reached the server.
 for(const a of attempts)if(a.status==='submitting')a.status='unknown';
 const records=()=>state?.records||[],asset=id=>records().find(a=>a.kind==='asset'&&a.id===id&&!a.deleted);
 const videoId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id)?id:'';
 function save(){try{localStorage.setItem(KEY,JSON.stringify(attempts.slice(-LIMIT)));}catch{}}
 function latest(id){return [...attempts].reverse().find(a=>a.asset_id===id);}
 function message(a){
  if(a.status==='submitting')return 'Sending upload request…';
  if(a.status==='queued')return 'Queued · waiting for the upload worker';
  if(a.status==='running')return a.progress||'Uploading to YouTube…';
  if(a.status==='done')return 'Uploaded to YouTube · '+(a.visibility||'visibility not reported')+(a.visibility==='private'?' · visible only to authorized viewers':'')+(a.publish_at?' · scheduled for '+new Date(a.publish_at).toLocaleString():'');
  if(a.status==='failed')return 'Upload failed · '+(a.error||'The worker reported a failure.');
  if(a.status==='rejected')return 'Upload not accepted · '+(a.error||'Review the request.');
  return a.error||'Upload status is unknown. Check Activity and YouTube Studio before retrying.';
 }
 function logFailure(a){
  if(!['failed','rejected','unknown'].includes(a.status)||a.logged===a.status)return;
  a.logged=a.status;window.EccoErrorLog?.record(message(a),{source:'YouTube publishing',attempt_id:a.id,job_id:a.job_id||null,asset_id:a.asset_id,channel_id:a.channel_id,status:a.status,endpoint:'youtube/publish'});
 }
 function sync(){
  if(window.EccoStorage?.ready){
   for(const r of records().filter(r=>r.kind==='asset'&&r.media==='video'&&(r.upload_state||r.youtube_id))){
    if(!latest(r.id))attempts.push({id:'recovered-'+r.id,asset_id:r.id,title:r.title||'Video',channel_id:r.youtube_channel_id||'',created:r.updated||r.created||Date.now()/1000,status:r.youtube_id?'done':'unknown',job_id:r.youtube_job_id||'',recovered:true});
   }
   for(const a of attempts){
    const r=asset(a.asset_id),job=records().find(j=>j.kind==='job'&&(j.id===a.job_id||(j.operation==='youtube.publish'&&j.asset_id===a.asset_id)));
    if(job){a.job_id=job.id;a.progress=redact(job.progress||'');a.status=job.status==='cancelled'?'failed':job.status;a.error=job.error?redact(job.error):'';a.last_seen=Date.now();if(job.status==='done')a.video_id=videoId(job.result)||a.video_id;}
    if(r?.youtube_id){a.status='done';a.video_id=videoId(r.youtube_id);a.visibility=r.youtube_visibility||a.visibility;a.publish_at=r.youtube_publish_at||a.publish_at;a.warning=redact(r.youtube_playlist_error||'');a.error='';}
    else if(a.status==='submitting'&&Date.now()/1000-a.created>45){a.status='unknown';a.error='The upload request has not been confirmed. Check Activity before retrying.';}
    else if(['queued','running'].includes(a.status)&&!job&&Date.now()-(a.last_seen||a.created*1000)>90000){a.status='unknown';a.error='The upload job is no longer visible in workspace status. Check YouTube Studio before retrying.';}
    logFailure(a);
   }
  }
  attempts=attempts.slice(-LIMIT);save();render();window.EccoPublishingMedia?.refreshStatus?.();window.EccoPublishingConnection?.();
 }
 function jobs(source=records()){
  const out=source.filter(r=>r.kind==='job'),ids=new Set(attempts.map(a=>a.job_id).filter(Boolean));
  return [...out.filter(j=>!ids.has(j.id)),...attempts.map(a=>{
   const server=out.find(j=>j.id===a.job_id)||{};
   return {...server,id:a.job_id||a.id,kind:'job',operation:'youtube.publish',asset_id:a.asset_id,channel_id:a.channel_id,visibility:a.visibility,playlist_id:a.playlist_id,created:a.created,label:'YouTube · '+a.title,status:a.status,progress:message(a),error:['failed','rejected','unknown'].includes(a.status)?message(a):'',result:a.video_id||server.result,publishing_attempt:a};
  })];
 }
 function renderActivity(){
  const jobsRoot=q('#jobs');if(!jobsRoot||!attempts.length)return;
  let root=q('#publishing-activity-log');if(!root){root=document.createElement('section');root.id='publishing-activity-log';jobsRoot.prepend(root);for(const p of jobsRoot.querySelectorAll(':scope > p.help'))p.remove();}
  const signature=JSON.stringify(attempts);if(root.dataset.signature===signature)return;root.dataset.signature=signature;root.replaceChildren();
  const heading=document.createElement('h3');heading.textContent='YouTube publishing';root.append(heading);
  for(const a of [...attempts].reverse()){
   const row=document.createElement('div');row.className='job publishing-activity-job';row.dataset.attemptId=a.id;
   const name=document.createElement('div');name.textContent=a.title;
   const time=document.createElement('div');time.className='detail';time.textContent=new Date(a.created*1000).toLocaleString();name.append(time);
   const status=document.createElement('div');status.textContent=message(a);if(busyStates.has(a.status)){const spinner=document.createElement('span');spinner.className='publishing-spinner';spinner.setAttribute('aria-hidden','true');status.prepend(spinner);}
   const detail=document.createElement('div');detail.className='detail';detail.textContent=a.job_id?'Job '+a.job_id:'Request '+a.id;status.append(detail);row.append(name,status);root.append(row);
  }
 }
 function render(){
  renderActivity();
  const root=q('#publishing-status');if(!root)return;
  const current=attempts.slice(-5).reverse(),signature=JSON.stringify(current);if(root.dataset.signature===signature)return;root.dataset.signature=signature;
  root.replaceChildren();const heading=document.createElement('h3');heading.textContent='Publishing status';root.append(heading);
  if(!current.length){const p=document.createElement('p');p.className='help';p.textContent='No upload attempts recorded yet.';root.append(p);return;}
  for(const a of current){
   const row=document.createElement('div');row.className='publishing-status-row';row.setAttribute('role','status');
   if(busyStates.has(a.status)){const spinner=document.createElement('span');spinner.className='publishing-spinner';spinner.setAttribute('aria-hidden','true');row.append(spinner);}
   const text=document.createElement('span');text.textContent=a.title+' · '+message(a);row.append(text);
   const detail=document.createElement('small');detail.textContent=new Date(a.created*1000).toLocaleString()+' · '+(a.job_id?'Job '+a.job_id:'Request '+a.id);row.append(detail);
   if(a.video_id){const link=document.createElement('a');link.href='https://www.youtube.com/watch?v='+encodeURIComponent(a.video_id);link.target='_blank';link.rel='noopener';link.textContent='Open on YouTube';row.append(link);}
   if(a.warning){const warning=document.createElement('p');warning.className='help';warning.textContent=a.warning;row.append(warning);}root.append(row);
  }
 }
 function mount(root){
  if(q('#publishing-status'))return;
  const panel=document.createElement('section');panel.id='publishing-status';panel.className='panel form';panel.setAttribute('aria-label','Publishing status');root.querySelector('.publishing-toolbar').after(panel);render();
 }
 const originalApi=api;
 api=async function(path,body,...rest){
  if(path!=='youtube/publish'||!body)return originalApi.call(this,path,body,...rest);
  const previous=latest(body.asset_id);
  if(previous&&busyStates.has(previous.status))throw Error('This video already has an upload in progress. Check Publishing status.');
  const a={id:crypto.randomUUID(),asset_id:body.asset_id,title:String(body.title||asset(body.asset_id)?.title||'Video').slice(0,100),channel_id:body.channel_id||'',playlist_id:body.playlist_id||'',visibility:body.visibility||'private',publish_at:body.publish_at||'',created:Date.now()/1000,status:'submitting'};attempts.push(a);save();render();window.EccoPublishingConnection?.();
  try{
   const result=await originalApi.call(this,path,body,...rest);
   if(!result?.id)throw Error('The service did not return an upload job ID. Check Activity before retrying.');
   a.job_id=result.id;a.status=['queued','running','done','failed'].includes(result.status)?result.status:'queued';a.progress=redact(result.progress||'');a.last_seen=Date.now();if(result.error)a.error=redact(result.error);if(a.status==='done')a.video_id=videoId(result.result);
   return result;
  }catch(error){a.status=error.status>=400&&error.status<500&&error.status!==409?'rejected':'unknown';a.error=redact(error.message);logFailure(a);throw error;}
  finally{save();render();window.EccoPublishingConnection?.();window.EccoPublishingMedia?.refreshStatus?.();}
 };
 window.EccoPublishingStatus={mount,sync,jobs,latest,message,list:()=>attempts.map(a=>({...a})),busy:()=>attempts.filter(a=>busyStates.has(a.status)).length};
 setInterval(sync,1500);
})();
