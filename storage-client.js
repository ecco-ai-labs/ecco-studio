/* Storage and GPU connections are deliberately independent. No private key is bundled. */
(() => {
 'use strict';
 const endpoint='https://vowmjru85f2gzo-8888.proxy.runpod.net';
 let key=sessionStorage.getItem('ecco-storage-access')||'';
 const gpuAPI=api;
 const generation=new Set(['images','videos','image-edits','character-sheets','director/create','director/regenerate','video-jobs/cancel','youtube/connect','youtube/publish','github/sync','billing/connect','billing/refresh']);
 window.EccoStorage={get ready(){return Boolean(key);},endpoint};
 api=async function(path,body){
  if(generation.has(path))return gpuAPI(path,body);
  if(!key)throw Error('Connect your saved workspace from Account → Storage. No GPU is needed.');
  const response=await fetch(endpoint+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
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
  modal.innerHTML='<form class="form"><h2>Workspace storage</h2><p>Your images, videos, labels and storyboards live on the RunPod network volume. GPU connection is separate.</p><label>Private storage access key<input name="key" type="password" autocomplete="off" required minlength="32"></label><p class="help">Kept only for this browser tab’s session. Never sent to GitHub.</p><p role="status"></p><div class="row"><button type="submit">Connect storage</button><button type="button" data-close>Cancel</button><button type="button" data-disconnect>Disconnect storage</button></div></form>';
  modal.querySelector('[data-close]').onclick=()=>modal.close();
  modal.querySelector('[data-disconnect]').onclick=()=>{key='';sessionStorage.removeItem('ecco-storage-access');for(const url of mediaCache.values())URL.revokeObjectURL(url);mediaCache.clear();state={records:[],config:{models_ready:{}},storage_pending:true};storyControls();navigate('empty');modal.close();};
  modal.querySelector('form').onsubmit=async event=>{
   event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]');button.disabled=true;
   const old=key;key=form.elements.key.value.trim();
   try{await api('state');sessionStorage.setItem('ecco-storage-access',key);form.elements.key.value='';await refresh();modal.close();notice('Saved workspace connected. GPU is not required for library access.');}
   catch(error){key=old;status.textContent=error.message;}finally{button.disabled=false;}
  };
  modal.showModal();
 }
 function mount(){const target=document.querySelector('[data-category="Account"] .workspace-menu-items');if(!target||document.querySelector('#connect-storage'))return;const button=document.createElement('button');button.id='connect-storage';button.textContent='Storage';button.onclick=()=>{target.closest('details').open=false;dialog();};target.prepend(button);}
 mount();new MutationObserver(mount).observe(document.querySelector('main > header'),{childList:true,subtree:true});
 if(key)setTimeout(()=>refresh(),0);
})();
