/* Storage and GPU connections are deliberately independent. No private key is bundled. */
(() => {
 'use strict';
 const endpoint='https://vowmjru85f2gzo-8888.proxy.runpod.net';
 let key=sessionStorage.getItem('ecco-storage-access')||'';
 const gpuAPI=api;
 const generation=new Set(['images','videos','image-edits','character-sheets','director/create','director/regenerate','video-jobs/cancel','youtube/connect','youtube/publish','github/sync','billing/connect','billing/refresh']);
 window.EccoStorage={get ready(){return Boolean(key);},endpoint,open:dialog};
 api=async function(path,body){
  if(generation.has(path))return gpuAPI(path,body);
  if(!key)throw Error('Connect your saved workspace from Account → Storage. No GPU is needed.');
  const response=await fetch(endpoint+'/api/'+path,{signal:AbortSignal.timeout(path.startsWith('media/')?120000:20000),method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok){let message='Storage request failed ('+response.status+').';try{message=(await response.json()).error||message;}catch{}throw Error(message);}
  if(path.startsWith('media/'))return {buffer:await response.arrayBuffer(),mime:response.headers.get('Content-Type')};
  const data=await response.json();
  if(path==='state'&&gpuConnected()){
   try{const gpu=await gpuAPI('state');data.config={...data.config,...gpu.config,storage:data.config.storage};}
   catch{data.config.runtime={};}
  }
  return data;
 };
 function dialog(){
  let modal=document.querySelector('#storage-access-dialog');
  if(!modal){modal=document.createElement('dialog');modal.id='storage-access-dialog';document.body.append(modal);}
  modal.innerHTML='<form class="form" novalidate><h2>Workspace storage</h2><p>Your images, videos, labels and storyboards live on the RunPod network volume. GPU connection is separate.</p><label>Private storage access key<input name="key" type="password" autocomplete="off" required></label><p class="help">Kept only for this browser tab’s session. Never sent to GitHub.</p><p role="status"></p><div class="row"><button type="submit">Connect storage</button><button type="button" data-close>Cancel</button><button type="button" data-disconnect>Disconnect storage</button></div></form>';
  modal.querySelector('[data-close]').onclick=()=>modal.close();
  modal.querySelector('[data-disconnect]').onclick=()=>{key='';sessionStorage.removeItem('ecco-storage-access');for(const url of mediaCache.values())URL.revokeObjectURL(url);mediaCache.clear();state={records:[],config:{models_ready:{}},storage_pending:true};storyControls();navigate('empty');modal.close();};
  modal.querySelector('form').onsubmit=async event=>{
   event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]');
   const entered=form.elements.key.value.trim();
   if(entered.length<32){status.textContent='Paste the complete private storage access key, then click Connect storage.';return;}
   button.disabled=true;button.textContent='Connecting…';status.textContent='Connecting to your saved workspace…';
   const old=key;key=entered;
   try{await api('state');status.textContent='Storage reached. Loading your libraries…';if(!await refresh())throw Error('Storage accepted the key, but the libraries could not load. Please try again.');sessionStorage.setItem('ecco-storage-access',key);form.elements.key.value='';modal.close();notice('Saved workspace connected. GPU is not required for library access.');}
   catch(error){key=old;status.textContent=error.name==='TimeoutError'?'Storage did not respond within 20 seconds. Please try again.':error instanceof TypeError?'The browser could not reach storage. Check your network connection and try again.':error.message;}
   finally{button.disabled=false;button.textContent='Connect storage';}
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
