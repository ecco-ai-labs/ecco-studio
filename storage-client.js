/* Storage and GPU connections are deliberately independent. No private key is bundled. */
(() => {
 'use strict';
 const endpoint='https://vowmjru85f2gzo-8888.proxy.runpod.net';
 let connecting=false,verified=false;
 let key=sessionStorage.getItem('ecco-storage-access')||'';
 const compact=document.createElement('style');compact.textContent='#storage-access-dialog{width:min(480px,calc(100vw - 32px))}#storage-access-dialog .row{justify-content:flex-end;flex-wrap:wrap;gap:8px}#storage-access-dialog .row>button{flex:0 0 auto;padding:6px 10px;font-size:12px;min-height:30px}#storage-access-dialog .storage-key-field{position:relative;display:block}#storage-access-dialog .storage-key-field input{padding-right:42px}#storage-access-dialog .storage-key-toggle{position:absolute;right:5px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:30px;height:30px;padding:5px;background:transparent;color:var(--muted)}#storage-access-dialog .storage-key-toggle svg{width:18px;height:18px}#storage-access-dialog [data-disconnect]{margin-right:auto;background:transparent;color:var(--muted)}';document.head.append(compact);
 const gpuAPI=api;
 const generation=new Set(['images','videos','image-edits','character-sheets','director/create','director/regenerate','video-jobs/cancel','youtube/connect','youtube/publish','github/sync','billing/connect','billing/refresh']);
 window.EccoStorage={get ready(){return Boolean(key)&&!connecting;},endpoint,open:dialog,reportError};
 async function storageRequest(path,body,accessKey=key){
  if(!accessKey)throw Error('Connect your saved workspace from Account → Storage. No GPU is needed.');
  let response;
  try{
   response=await fetch(endpoint+'/api/'+path,{signal:AbortSignal.timeout(path.startsWith('media/')?120000:20000),method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+accessKey,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
   if(!response.ok){
    let message=response.status===401?'The private storage key was not accepted.':'Storage request failed (HTTP '+response.status+').';
    try{message=(await response.json()).error||message;}catch{}
    throw Error(message);
   }
   if(path.startsWith('media/'))return {buffer:await response.arrayBuffer(),mime:response.headers.get('Content-Type')};
   const data=await response.json();
   if(path==='state'&&(!Array.isArray(data.records)||!data.config))throw Error('Storage returned an invalid workspace response.');
   return data;
  }catch(error){
   if(error.name==='TimeoutError')throw Error('Storage did not respond within 20 seconds. Try again.');
   if(error instanceof TypeError)throw Error('Cannot reach storage from this browser. The connection may be blocked or unavailable.');
   throw error;
  }
 }
 api=async function(path,body){
  if(generation.has(path))return gpuAPI(path,body);
  const data=await storageRequest(path,body);
  if(path==='state'){
   verified=true;errorShown=false;
   if(gpuConnected()){try{const gpu=await gpuAPI('state');data.config={...data.config,...gpu.config,storage:data.config.storage};}catch{data.config.runtime={};}}
  }
  return data;
 };
 let errorShown=false;
 function reportError(error){
  verified=false;
  window.EccoErrors.show(error,{title:'Workspace storage error',retryLabel:'Reconnect storage',retry:dialog});
 }
 function counts(){const active=state.records.filter(r=>!r.deleted);return active.filter(r=>r.kind==='asset'&&r.media==='image').length+' images · '+active.filter(r=>r.kind==='story').length+' stories';}
 function disconnect(){key='';verified=false;sessionStorage.removeItem('ecco-storage-access');for(const url of mediaCache.values())URL.revokeObjectURL(url);mediaCache.clear();state={records:[],config:{models_ready:{}},storage_pending:true};storyControls();navigate('empty');}
 function dialog(){
  let modal=document.querySelector('#storage-access-dialog');
  if(!modal){modal=document.createElement('dialog');modal.id='storage-access-dialog';document.body.append(modal);}
  if(modal.open)return;
  if(verified&&key){
   modal.innerHTML='<div class="form"><h2>Workspace storage</h2><p role="status">Connected · '+counts()+'</p><p class="help">Saved libraries are available independently of your GPU.</p><div class="row"><button type="button" class="secondary" data-disconnect>Disconnect</button><button type="button" data-close>Done</button></div></div>';
   modal.querySelector('[data-close]').onclick=()=>modal.close();
   modal.querySelector('[data-disconnect]').onclick=()=>{disconnect();modal.close();};
   modal.showModal();return;
  }
  modal.innerHTML='<form class="form" novalidate><h2>Workspace storage</h2><p>Your images, videos, labels and storyboards live on the RunPod network volume. GPU connection is separate.</p><label>Private storage access key<span class="storage-key-field"><input name="key" type="password" autocomplete="off" spellcheck="false" required><button type="button" class="storage-key-toggle" data-show-key aria-label="Show key" title="Show key" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path data-eye-slash d="M3 3l18 18" style="display:none"/></svg></button></span></label><p class="help">Kept only for this browser tab’s session. Never sent to GitHub.</p><p role="status"></p><div class="row"><button type="submit">Connect storage</button><button type="button" class="secondary" data-close>Cancel</button><button type="button" class="secondary" data-disconnect>Disconnect storage</button></div></form>';
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
    sessionStorage.setItem('ecco-storage-access',key);verified=true;errorShown=false;form.elements.key.value='';
    for(const selector of ['#workspace-library-group','#image-library-nav > details']){const section=document.querySelector(selector);if(section)section.open=true;}
    notice('Connected · '+counts());modal.close();
   }catch(error){window.EccoErrors.show(error);status.textContent=error.message;status.setAttribute('role','alert');}
   finally{connecting=false;button.disabled=false;button.textContent='Connect storage';close.disabled=false;}

  };
  modal.showModal();
 }
 function mount(){const settings=document.querySelector('#settings');if(settings)settings.onclick=dialog;const target=document.querySelector('[data-category="Account"] .workspace-menu-items');if(!target||document.querySelector('#connect-storage'))return;const button=document.createElement('button');button.id='connect-storage';button.textContent='Storage';button.onclick=()=>{target.closest('details').open=false;dialog();};target.prepend(button);}
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
