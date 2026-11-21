'use strict';
(()=>{
 const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const isSequence=j=>j?.source_kind==='audio_video_job'||j?.kind==='audio_video_job';
 function select(records,story,trackedId){
  const normalize=id=>id||'00000000000000000000000000000001';
  const jobs=records.filter(j=>isSequence(j)&&normalize(j.story_id)===normalize(story)).sort((a,b)=>b.created-a.created);
  const tracked=jobs.find(j=>j.id===trackedId);
  return tracked?[tracked]:jobs.slice(0,1);
 }
 function clips(job,records=[]){
  if(!isSequence(job))return [];
  const ids=job.children||[],count=job.request?.clips?.length||Number(job.progress?.match(/clip \d+ of (\d+)/i)?.[1])||ids.length;
  return Array.from({length:count},(_,i)=>{
   const child=records.find(r=>r.id===ids[i]);
   const done=child?.status==='done'||job.status==='done';
   const active=child?.status==='running';
   const message=child?.progress||(i===ids.length-1?job.progress:'')||'';
   const segment=message.match(/Segment (\d+)\/(\d+)/i),step=message.match(/Generating: step (\d+)\/(\d+)/i);
   let percent=done?100:0,detail='',status=done?'Complete':child?.status==='failed'||child?.status==='error'?'Failed':job.status==='cancelled'?'Stopped':job.status==='paused'?'Paused':'Waiting';
   if(active){
    status='Generating';
    if(segment){
     const n=Number(segment[1]),total=Number(segment[2]);
     const fraction=step&&Number(step[2])>0?Math.min(1,Number(step[1])/Number(step[2])):/Encoding video/.test(message)?1:0;
     if(total>0)percent=Math.max(0,Math.min(99,Math.floor((n-1+fraction)/total*100)));
     detail='Total segments in this clip: '+total+'. Currently generating: segment '+n+'.';
     if(step)detail+=' Step '+step[1]+' of '+step[2]+'.';
     if(/Encoding video/.test(message))detail+=' Saving this segment.';
    }else if(/Loading model/.test(message)){status='Preparing model';detail='Preparing the model before creating this clip.';}
    else {detail='Creating this clip. Waiting for detailed progress.';}
    const stale=message.match(/Last progress (\d+)m ago/);if(stale)detail+=' Last progress update: '+stale[1]+' minutes ago.';
   }
   return {number:i+1,percent,status,detail,active};
  });
 }
 function summary(job){return job.status==='done'?'Video ready':job.status==='failed'?'Video generation failed':job.status==='cancelled'?'Generation stopped':job.status==='paused'?'Generation paused':/Assembling/.test(job.progress||'')?'Combining your clips…':'Creating your video…';}
 function html(job,records){
  const rows=clips(job,records);if(!rows.length)return safe(job.progress||job.status);
  const active=rows.find(r=>r.active);
  return '<div class="clip-progress-list"><div class="clip-progress-summary">Total clips in video: '+rows.length+'. '+(active?'Currently generating: clip '+active.number+'.':safe(summary(job)))+'</div>'+rows.map(r=>'<div class="clip-progress-item"><div class="clip-progress-line"><span>Clip '+r.number+'</span><div class="clip-progress-track" role="progressbar" aria-label="Clip '+r.number+' progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+r.percent+'" aria-valuetext="'+safe(r.status+' '+r.percent+'%')+'"><span style="width:'+r.percent+'%"></span></div><span class="clip-progress-value">'+safe(r.status)+(r.status==='Generating'?' · ~'+r.percent+'%':r.status==='Complete'?' · 100%':'')+'</span></div>'+(r.detail?'<div class="clip-progress-detail">'+safe(r.detail)+'</div>':'')+'</div>').join('')+(job.stop_requested?'<div class="clip-progress-detail">Stopping after the current clip.</div>':job.pause_requested?'<div class="clip-progress-detail">Pausing after the current clip.</div>':'')+'</div>';
 }
 window.EccoClipProgress={isSequence,select,clips,html,summary};
})();
