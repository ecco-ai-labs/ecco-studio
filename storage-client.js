/* Storage and GPU connections are deliberately independent. No private key is bundled. */
(() => {
 'use strict';
 const endpoint='https://vowmjru85f2gzo-8888.proxy.runpod.net';
 let connecting=false,verified=false;
 let key=localStorage.getItem('ecco-storage-access')||sessionStorage.getItem('ecco-storage-access')||'';
 if(key){localStorage.setItem('ecco-storage-access',key);sessionStorage.setItem('ecco-storage-access',key);}
 const compact=document.createElement('style');compact.textContent='#storage-access-dialog{width:min(480px,calc(100vw - 32px))}#storage-access-dialog .row{justify-content:flex-end;flex-wrap:wrap;gap:8px}#storage-access-dialog .row>button{flex:0 0 auto;padding:6px 10px;font-size:12px;min-height:30px}#storage-access-dialog .storage-key-field{position:relative;display:block}#storage-access-dialog .storage-key-field input{padding-right:42px}#storage-access-dialog .storage-key-toggle{position:absolute;right:5px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:30px;height:30px;padding:5px;background:transparent;color:var(--muted)}#storage-access-dialog .storage-key-toggle svg{width:18px;height:18px}#storage-access-dialog [data-disconnect]{margin-right:auto;background:transparent;color:var(--muted)}';document.head.append(compact);
 const gpuAPI=api;

 const inference=new Set(['images','videos','image-edits','character-sheets','director/create','director/regenerate','video-jobs/cancel']);
 let gpuHealth=[],gpuChecked=0,selectedGPU=localStorage.getItem('ecco-selected-gpu')||'';
 let connectedGPUs;
 try{const saved=JSON.parse(localStorage.getItem('ecco-connected-gpus'));connectedGPUs=new Set(Array.isArray(saved)?saved.filter(id=>typeof id==='string'):[selectedGPU].filter(Boolean));}
 catch{connectedGPUs=new Set([selectedGPU].filter(Boolean));}
 const notifyGPUConnection=()=>document.dispatchEvent(new Event('ecco:gpu-connection-change'));
 const connectionLog=(event,details={})=>window.EccoConnectivityLog?.record(event,details);
 function acceptGPUHealth(value){
  for(const item of value?.gpus||[]){const previous=gpuHealth.find(g=>g.id===item.id);if(!previous||previous.ready!==item.ready){connectionLog(item.ready?'Generation service ready':'Generation service unavailable',{gpu:item.id,level:item.ready?'info':'error',message:item.detail||(item.ready?'Fresh relay heartbeat received.':'No healthy generation service heartbeat. RunPod power state is not verified.'),last_seen:item.last_seen,stage:item.stage||'relay heartbeat'});}}
  gpuHealth=value?.gpus||[];gpuChecked=Date.now();
  notifyGPUConnection();
 }
 const selectedHealth=()=>gpuHealth.find(g=>g.id===selectedGPU);
 const isGPUConnected=id=>Boolean(key)&&Date.now()-gpuChecked<60000&&connectedGPUs.has(id)&&Boolean(gpuHealth.find(g=>g.id===id)?.ready);
 function gpuStatus(gpu){
  if(!key)return {kind:'unchecked',title:'Not checked',detail:'Connect workspace storage to check GPU availability.'};
  if(!gpuChecked||Date.now()-gpuChecked>=60000)return {kind:'unknown',title:connectedGPUs.has(gpu.id)?'Reconnecting':'Not checked',detail:'GPU availability could not be verified. Saved connections are retained and will recover automatically.'};
  const health=gpuHealth.find(g=>g.id===gpu.id);
  if(health?.ready)return {kind:'ready',title:'Available',detail:'Generation service and relay are responding.'};
  if(!health?.last_seen)return {kind:'unknown',title:'No heartbeat',detail:'No relay heartbeat received. RunPod power state is not verified.'};
  if(Date.now()/1000-health.last_seen>=45)return {kind:'unknown',title:connectedGPUs.has(gpu.id)?'Reconnecting':'Heartbeat lost',detail:'Generation relay last seen '+new Date(health.last_seen*1000).toLocaleString()+'. The pod may be running without Studios services.'};
  return {kind:'unknown',title:'Service not ready',detail:health.detail||'Relay is running, but the generation service is not responding.'};
 }
 window.EccoGPUConnection={
  get selectedId(){return selectedGPU;},
  config(id){return isGPUConnected(id)?gpuHealth.find(g=>g.id===id)?.config||{}:{};},
  get connectedIds(){return [...connectedGPUs].filter(isGPUConnected);},
  get ready(){return this.connectedIds.length>0;},
  isConnected:isGPUConnected,
  get savedIds(){return [...connectedGPUs];},
  isRemembered:id=>connectedGPUs.has(id),
  disconnect(id){
   const removed=id?[id]:[...connectedGPUs];for(const gpu of removed)connectedGPUs.delete(gpu);
   localStorage.setItem('ecco-connected-gpus',JSON.stringify([...connectedGPUs]));
   if(!id||selectedGPU===id){selectedGPU='';localStorage.removeItem('ecco-selected-gpu');}
   notifyGPUConnection();connectionLog('GPU disconnected',{gpus:removed,reason:'User requested'});
  },
  status:gpuStatus,
  async checkAll(gpus){
   const started=Date.now();connectionLog('Checking GPU connections',{gpus:gpus.map(g=>g.id),stage:'storage → relay'});
   try{acceptGPUHealth(await storageRequest('gpu/status'));connectionLog('Connection check complete',{duration_ms:Date.now()-started,gpus:gpus.map(g=>({id:g.id,...gpuStatus(g)}))});}catch(error){gpuChecked=0;notifyGPUConnection();connectionLog('Connection check failed',{level:'error',message:error.message,stack:error.stack,duration_ms:Date.now()-started,stage:'storage → relay'});throw error;}
   return gpus.map(gpuStatus);
  },
  async check(gpu){return (await this.checkAll([gpu]))[0];},
  async select(gpu){
   connectionLog('Connect requested',{gpu:gpu.id});
   try{
   const status=await this.check(gpu);if(status.kind!=='ready')throw Error(status.detail);
   connectedGPUs.add(gpu.id);localStorage.setItem('ecco-connected-gpus',JSON.stringify([...connectedGPUs]));
   selectedGPU=gpu.id;localStorage.setItem('ecco-selected-gpu',gpu.id);notifyGPUConnection();await refresh();
   connectionLog('GPU connected',{gpu:gpu.id});
   }catch(error){connectionLog('GPU connection failed',{gpu:gpu.id,level:'error',message:error.message,stack:error.stack});throw error;}
  },
 };
 gpuConnected=()=>window.EccoGPUConnection.ready;
 async function inferenceRequest(path,body){
  const request_id=crypto.randomUUID().replaceAll('-',''),gpu=body?.gpu||selectedGPU;
  if(!connectedGPUs.has(gpu))throw Error('Connect the selected accelerator before generating.');
  if(!isGPUConnected(gpu)){await window.EccoGPUConnection.check({id:gpu});if(!isGPUConnected(gpu))throw Error('Saved GPU connection is temporarily unavailable. No generation was submitted.');}
  connectionLog('Generation dispatch requested',{gpu,path,request_id});
  const payload={gpu,path,body,request_id};
  let accepted;
  // Only retry the same idempotency key; never create a second generation.
  for(let attempt=0;attempt<2;attempt++){try{accepted=await storageRequest('gpu/request',payload);break;}catch(error){connectionLog(attempt?'Generation submission failed':'Retrying generation submission',{gpu,path,request_id,attempt:attempt+1,level:'error',message:error.message,stack:error.stack});if(attempt)throw error;await new Promise(r=>setTimeout(r,1000));}}
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){
   let response;try{response=await storageRequest('gpu/requests/'+gpu+'/'+accepted.id);}
   catch(error){connectionLog('Generation response check failed',{gpu,path,request_id,level:'error',message:error.message});await new Promise(r=>setTimeout(r,2000));continue;}
   if(response.status==='done'){connectionLog('Generation dispatch accepted',{gpu,path,request_id});return response.result;}
   if(response.status==='error'){connectionLog('Generation dispatch failed',{gpu,path,request_id,level:'error',message:response.error});throw Error(response.error);}
   await new Promise(r=>setTimeout(r,700));
  }
  connectionLog('Generation submission unconfirmed',{gpu,path,request_id,level:'error',message:'Response deadline exceeded; no duplicate generation submitted.'});
  throw Error('GPU submission is still unconfirmed. Check Activity before retrying; Studio has not submitted a duplicate.');
 }

 const generation=new Set(['images','videos','image-edits','character-sheets','director/create','director/regenerate','video-jobs/cancel','github/sync','billing/connect','billing/refresh']);
 window.EccoStorage={get ready(){return Boolean(key)&&!connecting;},endpoint,open:dialog,disconnect,reportError,mediaURL:async id=>{if(audioMedia.has(id))return audioMedia.get(id);const access=key,{buffer,mime}=await storageRequest('media/'+encodeURIComponent(id));if(access!==key)throw Error('Storage disconnected.');const url=URL.createObjectURL(new Blob([buffer],{type:mime||'audio/wav'}));audioMedia.set(id,url);return url;}};
 // Present CPU-owned audio jobs through the shared Activity job view.
 // This is a UI projection only; the durable record stays audio_job.
 function audioJobView(job){
  if(job.kind!=='audio_job')return job;
  const status=job.status==='error'?'failed':job.status;
  return {...job,kind:'job',source_kind:'audio_job',label:'Audio · '+(job.title||'Recording'),status,
   progress:job.progress||(status==='running'?'Generating speech':status==='queued'?'Queued':status==='done'?'Audio saved.':''),
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
   generate:body=>api('audio/generate',body),
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
  if(!accessKey)throw Error('Connect your saved workspace from Connections → Storage. No GPU is needed.');
  let response;
  try{
   response=await fetch(endpoint+'/api/'+path,{signal:AbortSignal.any([AbortSignal.timeout(path==='stories/plan'?180000:path.startsWith('ai/')?150000:path.startsWith('media/')?120000:20000),...(options.signal?[options.signal]:[])]),method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+accessKey,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
   if(!response.ok){
    let message=response.status===401?'The private storage key was not accepted.':'Storage request failed (HTTP '+response.status+').';
    try{message=(await response.json()).error||message;}catch{}
    const error=Error(message);error.status=response.status;throw error;
   }
   if(path.startsWith('media/')){const buffer=await response.arrayBuffer();(window.EccoMediaMetadata||(window.EccoMediaMetadata=new Map())).set(decodeURIComponent(path.slice(6)),{size:buffer.byteLength});window.dispatchEvent(new Event('ecco:media-metadata'));return {buffer,mime:response.headers.get('Content-Type')};}
   const data=await response.json();
   if(accessKey!==key&&accessKey!==options.connectingKey)throw Error('Workspace connection changed; stale response ignored.');
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
   if(isGPUConnected(selectedGPU))data.config={...data.config,...selectedHealth().config,youtube_configured:data.config.youtube_configured,youtube_channel:data.config.youtube_channel,youtube_channels:data.config.youtube_channels,youtube_playlists_available:data.config.youtube_playlists_available,youtube_playlist_write:data.config.youtube_playlist_write,publishing_connections:data.config.publishing_connections,youtube_setup_available:data.config.youtube_setup_available,storage:data.config.storage,ai:data.config.ai,ai_story_planner:data.config.ai_story_planner,gpu_relay:data.config.gpu_relay,character_studio:data.config.character_studio,longcat:data.config.longcat};
  }
  return data;
 };
 let errorShown=false;
 function reportError(error){
  verified=false;
  window.EccoErrors.show(error,{title:'Workspace storage error',retryLabel:'Reconnect storage',retry:dialog});
 }
 function counts(){const active=state.records.filter(r=>!r.deleted);return active.filter(r=>r.kind==='asset'&&r.media==='image').length+' images · '+active.filter(r=>r.kind==='story').length+' stories';}
 function disconnect(){connectionLog('Storage disconnected',{reason:'User requested'});key='';notifyGPUConnection();verified=false;audioConnected=false;window.EccoAudioStudio?.disconnect();for(const url of audioMedia.values())URL.revokeObjectURL(url);audioMedia.clear();localStorage.removeItem('ecco-storage-access');sessionStorage.removeItem('ecco-storage-access');for(const url of mediaCache.values())URL.revokeObjectURL(url);mediaCache.clear();state={records:[],config:{models_ready:{}},storage_pending:true};storyControls();navigate('empty');window.EccoYouTube?.update();}
 function dialog(options={}){
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
    const next=await storageRequest('state',undefined,entered,{connectingKey:entered});
    status.textContent='Storage reached. Connecting…';
    // Reuse this response: no second state fetch, and render failures stay visible.
    const previousKey=key;key=entered;
    try{await refresh(next,true);}catch(error){key=previousKey;throw Error('Storage connected, but workspace data could not refresh: '+error.message);}
    localStorage.setItem('ecco-storage-access',key);sessionStorage.setItem('ecco-storage-access',key);verified=true;errorShown=false;connectAudio();form.elements.key.value='';
    notice('Connected · '+counts());modal.close();
   }catch(error){window.EccoErrors.show(error);status.textContent=error.message;status.setAttribute('role','alert');}
   finally{connecting=false;button.disabled=false;button.textContent='Connect storage';close.disabled=false;window.EccoYouTube?.update();}

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
 window.addEventListener('storage',event=>{
  if(event.key==='ecco-storage-access'){
   if(!event.newValue){disconnect();return;}
   key=event.newValue;sessionStorage.setItem('ecco-storage-access',key);refresh();
  }
  if(event.key==='ecco-connected-gpus'){try{connectedGPUs=new Set(JSON.parse(event.newValue||'[]'));}catch{connectedGPUs=new Set();}notifyGPUConnection();}
 });
 window.addEventListener('online',()=>{if(key)refresh();});
 if(key)setTimeout(()=>refresh(),0);
})();



