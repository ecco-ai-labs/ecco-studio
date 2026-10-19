/* Storage and GPU connections are deliberately independent. No private key is bundled. */
(() => {
 'use strict';
 const endpoint='https://vowmjru85f2gzo-8888.proxy.runpod.net';
 let connecting=false,verified=false;
 let key=sessionStorage.getItem('ecco-storage-access')||'';
 const compact=document.createElement('style');compact.textContent='#storage-access-dialog{width:min(480px,calc(100vw - 32px))}#storage-access-dialog .row{justify-content:flex-end;flex-wrap:wrap;gap:8px}#storage-access-dialog .row>button{flex:0 0 auto;padding:6px 10px;font-size:12px;min-height:30px}#storage-access-dialog .storage-key-field{position:relative;display:block}#storage-access-dialog .storage-key-field input{padding-right:42px}#storage-access-dialog .storage-key-toggle{position:absolute;right:5px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:30px;height:30px;padding:5px;background:transparent;color:var(--muted)}#storage-access-dialog .storage-key-toggle svg{width:18px;height:18px}#storage-access-dialog [data-disconnect]{margin-right:auto;background:transparent;color:var(--muted)}';document.head.append(compact);
 const gpuAPI=api;

 const inference=new Set(['images','videos','image-edits','character-sheets','director/create','director/regenerate','video-jobs/cancel']);
 let gpuHealth=[],gpuChecked=0,selectedGPU=localStorage.getItem('ecco-selected-gpu')||'';
 function acceptGPUHealth(value){
  gpuHealth=value?.gpus||[];gpuChecked=Date.now();
  if(!selectedGPU){const ready=gpuHealth.filter(g=>g.ready);if(ready.length===1){selectedGPU=ready[0].id;localStorage.setItem('ecco-selected-gpu',selectedGPU);}}
 }
 const selectedHealth=()=>gpuHealth.find(g=>g.id===selectedGPU);
 window.EccoGPUConnection={
  get ready(){return Boolean(key)&&Date.now()-gpuChecked<60000&&Boolean(selectedHealth()?.ready);},
  async check(gpu){
   acceptGPUHealth(await storageRequest('gpu/status'));
   const item=gpuHealth.find(g=>g.id===gpu.id);
   return item?.ready?{kind:'ready',title:'Running · Connected service',detail:'Ready for generation. No connection window required.'}:{kind:'unknown',title:'Unavailable',detail:'Studio reconnects automatically when the GPU service returns.'};
  },
  async select(gpu){const status=await this.check(gpu);if(status.kind!=='ready')throw Error('This accelerator is unavailable.');selectedGPU=gpu.id;localStorage.setItem('ecco-selected-gpu',gpu.id);await refresh();},
 };
 gpuConnected=()=>window.EccoGPUConnection.ready;
 async function inferenceRequest(path,body){
  const request_id=crypto.randomUUID().replaceAll('-',''),gpu=selectedGPU;
  const payload={gpu,path,body,request_id};
  let accepted;
  // Only retry the same idempotency key; never create a second generation.
  for(let attempt=0;attempt<2;attempt++){try{accepted=await storageRequest('gpu/request',payload);break;}catch(error){if(attempt)throw error;await new Promise(r=>setTimeout(r,1000));}}
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){
   let response;try{response=await storageRequest('gpu/requests/'+gpu+'/'+accepted.id);}
   catch(error){await new Promise(r=>setTimeout(r,2000));continue;}
   if(response.status==='done')return response.result;
   if(response.status==='error')throw Error(response.error);
   await new Promise(r=>setTimeout(r,700));
  }
  throw Error('GPU submission is still unconfirmed. Check Activity before retrying; Studio has not submitted a duplicate.');
 }

 const generation=new Set(['images','videos','image-edits','character-sheets','director/create','director/regenerate','video-jobs/cancel','youtube/connect','youtube/publish','github/sync','billing/connect','billing/refresh']);
 window.EccoStorage={get ready(){return Boolean(key)&&!connecting;},endpoint,open:dialog,reportError};
 // Present CPU-owned audio jobs through the shared Activity job view.
 // This is a UI projection only; the durable record stays audio_job.
 function audioJobView(job){
  if(job.kind!=='audio_job')return job;
  const status=job.status==='error'?'failed':job.status;
  return {...job,kind:'job',source_kind:'audio_job',label:'Audio · '+(job.title||'Recording'),status,
   progress:status==='running'?'Running Generation':status==='queued'?'Queued':status==='done'?'Audio saved.':job.progress,
   result:job.asset_ids||job.asset_id};
 }
 const audioMedia=new Map();
 let audioConnected=false;
 function connectAudio(){
  if(audioConnected||!key||!window.EccoAudioStudio)return;
  audioConnected=true;
  window.EccoAudioStudio.connect({
   storageIndependentOfGPU:true,
   status:()=>storageRequest('audio/status'),
   list:async({story_id})=>(await storageRequest('state')).records.filter(a=>a.kind==='asset'&&a.media==='audio'&&!a.deleted&&(a.story_id||LEGACY_STORY)===story_id),
   generate:body=>storageRequest('audio/generate',body),
   job:id=>storageRequest('audio/jobs/'+encodeURIComponent(id)),
   mediaURL:async id=>{
    if(audioMedia.has(id))return audioMedia.get(id);
    const access=key,{buffer,mime}=await storageRequest('media/'+encodeURIComponent(id));
    if(access!==key)throw Error('Storage disconnected.');
    const url=URL.createObjectURL(new Blob([buffer],{type:mime||'audio/wav'}));audioMedia.set(id,url);return url;
   },
   download:async id=>{
    const {buffer,mime}=await storageRequest('media/'+encodeURIComponent(id));
    const url=URL.createObjectURL(new Blob([buffer],{type:mime||'audio/wav'}));
    const link=document.createElement('a');link.href=url;link.download='ecco-audio-'+id+'.wav';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
   }
  });
 }
 async function storageRequest(path,body,accessKey=key,options={}){
  if(!accessKey)throw Error('Connect your saved workspace from Account → Storage. No GPU is needed.');
  let response;
  try{
   response=await fetch(endpoint+'/api/'+path,{signal:AbortSignal.any([AbortSignal.timeout(path==='stories/plan'?180000:path.startsWith('ai/')?150000:path.startsWith('media/')?120000:20000),...(options.signal?[options.signal]:[])]),method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+accessKey,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
   if(!response.ok){
    let message=response.status===401?'The private storage key was not accepted.':'Storage request failed (HTTP '+response.status+').';
    try{message=(await response.json()).error||message;}catch{}
    throw Error(message);
   }
   if(path.startsWith('media/'))return {buffer:await response.arrayBuffer(),mime:response.headers.get('Content-Type')};
   const data=await response.json();
   if(path==='state'&&(!Array.isArray(data.records)||!data.config))throw Error('Storage returned an invalid workspace response.');
   if(path==='state')data.records=data.records.map(audioJobView);
   if(path==='audio/generate'||path.startsWith('audio/jobs/'))return audioJobView(data);
   return data;
  }catch(error){
   if(error.name==='TimeoutError')throw Error(path==='stories/plan'?'AI planning timed out. Your draft was preserved.':path.startsWith('ai/')?'The AI request timed out. Your original text is unchanged; check the connection before retrying.':'Storage did not respond within 20 seconds. Try again.');
   if(error instanceof TypeError)throw Error('Cannot reach storage from this browser. The connection may be blocked or unavailable.');
   throw error;
  }
 }
 api=async function(path,body,options={}){
  if(inference.has(path))return inferenceRequest(path,body);
  if(generation.has(path))return gpuAPI(path,body);
  const data=await storageRequest(path,body,key,options);
  if(path==='state'){
   verified=true;errorShown=false;connectAudio();
   acceptGPUHealth(data.config.gpu_relay);
   if(gpuConnected())data.config={...data.config,...selectedHealth().config,storage:data.config.storage,ai:data.config.ai,ai_story_planner:data.config.ai_story_planner,gpu_relay:data.config.gpu_relay};
  }
  return data;
 };
 let errorShown=false;
 function reportError(error){
  verified=false;
  window.EccoErrors.show(error,{title:'Workspace storage error',retryLabel:'Reconnect storage',retry:dialog});
 }
 function counts(){const active=state.records.filter(r=>!r.deleted);return active.filter(r=>r.kind==='asset'&&r.media==='image').length+' images · '+active.filter(r=>r.kind==='story').length+' stories';}
 function disconnect(){key='';verified=false;audioConnected=false;window.EccoAudioStudio?.disconnect();for(const url of audioMedia.values())URL.revokeObjectURL(url);audioMedia.clear();sessionStorage.removeItem('ecco-storage-access');for(const url of mediaCache.values())URL.revokeObjectURL(url);mediaCache.clear();state={records:[],config:{models_ready:{}},storage_pending:true};storyControls();navigate('empty');}
 function dialog(){
  let modal=document.querySelector('#storage-access-dialog');
  if(!modal){modal=document.createElement('dialog');modal.id='storage-access-dialog';document.body.append(modal);}
  if(modal.open)return;
  if(verified&&key){
   modal.innerHTML='<div class="form"><h2>Workspace storage</h2><p role="status">Connected · '+counts()+'</p><div class="row"><button type="button" class="secondary" data-disconnect>Disconnect</button><button type="button" data-close>Done</button></div></div>';
   modal.querySelector('[data-close]').onclick=()=>modal.close();
   modal.querySelector('[data-disconnect]').onclick=()=>{disconnect();modal.close();};
   modal.showModal();return;
  }
  modal.innerHTML='<form class="form" novalidate><h2>Workspace storage</h2><p>Your images, videos, labels and storyboards live on the RunPod network volume. GPU connection is separate.</p><label>Private storage access key<span class="storage-key-field"><input name="key" type="password" autocomplete="off" spellcheck="false" required><button type="button" class="storage-key-toggle" data-show-key aria-label="Show key" title="Show key" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path data-eye-slash d="M3 3l18 18" style="display:none"/></svg></button></span></label><p role="status"></p><div class="row"><button type="submit">Connect storage</button><button type="button" class="secondary" data-close>Cancel</button><button type="button" class="secondary" data-disconnect>Disconnect storage</button></div></form>';
  modal.querySelector('[data-close]').onclick=()=>modal.close();
  modal.querySelector('[data-disconnect]').hidden=true;
  modal.querySelector('[data-show-key]').onclick=()=>{
   const input=modal.querySelector('input[name=key]'),toggle=modal.querySelector('[data-show-key]'),show=input.type==='password';
   input.type=show?'text':'password';toggle.setAttribute('aria-pressed',String(show));toggle.setAttribute('aria-label',show?'Hide key':'Show key');toggle.title=show?'Hide key':'Show key';toggle.querySelector('[data-eye-slash]').style.display=show?'':'none';
  };
  modal.querySelector('form').onsubmit=async event=>{
   event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]'),status=form.querySelector('[role=status],[role=alert]');
   status.setAttribute('role','status');status.style.color='';
   const entered=form.elements.key.value.trim();
   if(entered.length<32){status.textContent='Paste the complete private storage access key, then click Connect storage.';return;}
   button.disabled=true;button.textContent='Connecting…';status.textContent='Connecting to your saved workspace…';
   connecting=true;
   const close=modal.querySelector('[data-close]');close.disabled=true;
   try{
    const next=await storageRequest('state',undefined,entered);
    status.textContent='Storage reached. Loading your libraries…';
    // Reuse this response: no second state fetch, and render failures stay visible.
    const previousKey=key;key=entered;
    try{await refresh(next,true);navigate('library');}catch(error){key=previousKey;throw Error('Storage connected, but the library could not display: '+error.message);}
    sessionStorage.setItem('ecco-storage-access',key);verified=true;errorShown=false;connectAudio();form.elements.key.value='';
    for(const selector of ['#workspace-library-group','#image-library-nav > details']){const section=document.querySelector(selector);if(section)section.open=true;}
    notice('Connected · '+counts());modal.close();
   }catch(error){window.EccoErrors.show(error);status.textContent=error.message;status.setAttribute('role','alert');}
   finally{connecting=false;button.disabled=false;button.textContent='Connect storage';close.disabled=false;}

  };
  modal.showModal();
 }
 function mount(){const settings=document.querySelector('#settings');if(settings)settings.onclick=()=>window.EccoAI?window.EccoAI.connections():dialog();const target=document.querySelector('[data-category="Account"] .workspace-menu-items');if(!target||document.querySelector('#connect-storage'))return;const button=document.createElement('button');button.id='connect-storage';button.textContent='Storage';button.onclick=()=>{target.closest('details').open=false;dialog();};target.prepend(button);}
 const noticeBox=document.querySelector('#notice');
 function connectNotice(){
  if(!noticeBox||noticeBox.querySelector('button')||!/Connect your (?:saved )?workspace/.test(noticeBox.textContent))return;
  const button=document.createElement('button');button.type='button';button.className='small secondary';button.textContent='Connect storage';button.onclick=dialog;noticeBox.append(' ',button);
 }
 if(noticeBox)new MutationObserver(connectNotice).observe(noticeBox,{childList:true});
 connectNotice();
 mount();new MutationObserver(mount).observe(document.querySelector('main > header'),{childList:true,subtree:true});
 if(key)setTimeout(()=>refresh(),0);
})();


