'use strict';
(()=>{
 const prefix='ecco-audio-task-progress:',memory=new Map();
 const key=story=>prefix+(story||'');
 function get(story){if(memory.has(key(story)))return memory.get(key(story));try{const saved=JSON.parse(localStorage.getItem(key(story))||'null');if(saved?.rows){saved.recovered=true;for(const row of saved.rows){if(row.key==='prepare'&&row.status==='running'){row.status='waiting';row.message='';}}memory.set(key(story),saved);}return saved;}catch{return null;}}
 function save(story,run){memory.set(key(story),run);try{localStorage.setItem(key(story),JSON.stringify(run));}catch{}render(document.querySelector('[data-audio-task-progress]'),story);}
 function begin(story,cues=[]){save(story,{id:Date.now(),rows:[{key:'prepare',name:'Preparation',status:'running',message:'Checking generation settings…'},...cues.map((c,i)=>({key:'sound-'+i,name:c.name,status:c.asset_id?'done':'waiting',message:c.asset_id?'Existing sound ready':''})),{key:'speech',name:'Speech',status:'waiting',message:''},{key:'mix',name:'Mix & save',status:'waiting',message:''}]});}
 function prepare(story,message,done=false){const run=get(story),row=run?.rows.find(r=>r.key==='prepare');if(row){row.status=done?'done':'running';row.message=message;save(story,run);}}
 function sounds(story,rows){const run=get(story);if(!run)return;prepare(story,'Preparation complete',true);run.rows=[...run.rows.filter(r=>r.key==='prepare'),...rows,...run.rows.filter(r=>!r.key.startsWith('sound-')&&r.key!=='prepare')];save(story,run);}
 function speech(story,job){const run=get(story);if(!run||!job||run.jobId&&job.id!==run.jobId)return;if(!run.jobId)return;const speech=run.rows.find(r=>r.key==='speech'),mix=run.rows.find(r=>r.key==='mix');if(!speech||!mix)return;
  const text=job.progress||'',match=/Generating speech\s*[·:]\s*(\d+) of (\d+) passages complete/i.exec(text);
  speech.steps=match?{completed:Number(match[1]),total:Number(match[2])}:undefined;
  if(job.status==='done'){speech.status=mix.status='done';speech.message='All passages complete';mix.message='Recording saved';}
  else if(/Mixing music|saving|finaliz/i.test(text)&&job.status==='running'){speech.status='done';speech.message='All passages complete';mix.status='running';mix.message=text;}
  else if(['error','failed','cancelled'].includes(job.status)){const row=mix.status==='running'?mix:speech;row.status=job.status;row.message=job.error||text;}
  else{speech.status=job.status||'queued';speech.message=text||'Waiting for the speech worker…';}
  save(story,run);
 }
 function submitted(story,job){const run=get(story);if(!run)return;prepare(story,'Preparation complete',true);run.jobId=job.id;save(story,run);speech(story,job);}
 function fail(story,error){const run=get(story);if(!run)return;let row=run.rows.find(r=>['error','failed','cancelled'].includes(r.status))||run.rows.find(r=>['running','queued'].includes(r.status))||run.rows.find(r=>r.status==='waiting');if(row){row.status=error.name==='GenerationStopped'?'cancelled':'error';row.message=error.message;}save(story,run);}
 async function recover(story,request){const run=get(story);if(!run?.recovered)return;for(const row of run.rows.filter(r=>r.id&&!['done','error','failed','cancelled'].includes(r.status))){try{const result=await request(row.id);if(get(story)!==run)return;Object.assign(row,{status:result.status,message:result.error||result.progress||'Waiting for worker progress',steps:result.sound_progress});}catch{row.message='Connection interrupted. Waiting to reconnect; last reported progress is retained.';}}if(get(story)===run)save(story,run);}
 function render(root,story){if(!root||root.dataset.story!==String(story||''))return;const run=get(story);root.hidden=!run?.rows?.length;if(root.hidden)return;
  const active=run.rows.find(r=>['running','queued','cancelling'].includes(r.status)),failed=run.rows.find(r=>['error','failed','cancelled'].includes(r.status));
  for(const row of run.rows){let card=[...root.children].find(n=>n.dataset.task===row.key);if(!card){card=document.createElement('div');card.className='audio-task-row';card.dataset.task=row.key;card.innerHTML='<div class="audio-task-heading"><strong data-task-name></strong><span data-task-state></span></div><progress></progress><p data-task-message></p>';root.append(card);}
   card.dataset.status=row.status;card.querySelector('[data-task-name]').textContent=row.name;
   const waiting=row.status==='waiting',done=row.status==='done',error=['error','failed'].includes(row.status);card.querySelector('[data-task-state]').textContent={done:'Complete',running:'Generating',queued:'Queued',waiting:failed?'Blocked':'Waiting',error:'Failed',failed:'Failed',cancelled:'Cancelled',cancelling:'Cancelling'}[row.status]||row.status;
   const bar=card.querySelector('progress');bar.setAttribute('aria-label',row.name+' progress');const s=row.steps,valid=s&&Number.isInteger(s.completed)&&Number.isInteger(s.total)&&s.total>0&&s.completed>=0&&s.completed<=s.total;
   if(done){bar.max=1;bar.value=1;}else if(valid){bar.max=s.total;bar.value=s.completed;}else if(waiting||error||row.status==='cancelled'){bar.max=1;bar.value=0;}else{bar.removeAttribute('value');bar.removeAttribute('max');}
   card.querySelector('[data-task-message]').textContent=waiting?(failed?'Waiting for '+failed.name+' to be resolved.':active?'Waiting for '+active.name+' to finish.':row.key==='mix'?'Waiting for speech to finish.':run.recovered&&!run.jobId?'Generate audio to continue from saved sounds.':'Waiting to start.'):(row.message||'')+(error?' Resolve the reported issue, then Generate audio again; completed sounds will be reused.':'');
  }
  for(const card of [...root.children])if(!run.rows.some(r=>r.key===card.dataset.task))card.remove();
 }
 window.EccoAudioTasks={begin,prepare,sounds,speech,submitted,fail,render,recover};
})();
