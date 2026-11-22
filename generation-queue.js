'use strict';
/* Generation queue screens (owner-approved mock, 20 Nov 2026).
   - Select Model: an optional picker on Story Picture (Quality, Speed, Estimated wait). It stays open after a pick
     and closes with its ✕ or the Select Model button. Qwen-Image-2512 is the default.
   - Queue: a pop-up from the Generation tab with the signed-in user's waiting pictures only: All + one tab per model,
     search on the same row, drag to reorder, Move to top, Cancel and Cancel All. Users see and change only their own jobs.
   The model list and wait times come from the server (/api/image-models), so a model added to the list shows up here. */
(()=>{
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const me=()=>window.EccoAuth?.user?.email||'';
 const ready=()=>typeof api==='function'&&window.EccoStorage?.ready;
 function wait(seconds){seconds=Math.max(0,Math.round(seconds||0));if(seconds<60)return seconds?'~'+seconds+' s':'Next';const m=Math.round(seconds/60);if(m<60)return '~'+m+' min';const h=Math.floor(m/60);return '~'+h+'h '+String(m%60)+'m';}
 function speed(seconds){seconds=Math.round(seconds||0);return seconds<60?'~'+seconds+' s':'~'+Math.round(seconds/60)+' min';}
 let modelsCache={at:0,list:[]};
 async function models(force){
  if(!force&&Date.now()-modelsCache.at<15000&&modelsCache.list.length)return modelsCache.list;
  if(!ready())return modelsCache.list;
  try{const data=await api('image-models');modelsCache={at:Date.now(),list:Array.isArray(data.models)?data.models:[]};}catch{}
  // A model added to the server list also becomes choosable in the picture studio (its settings start from defaults).
  try{for(const m of modelsCache.list){if(m.edit||typeof MODEL_CATALOG!=='object')continue;if(!MODEL_CATALOG[m.id])MODEL_CATALOG[m.id]={name:m.name,defaults:{resolution:'1024x1024',steps:30,cfg:4,seed:42},sizes:['1024x1024']};const cat=MODEL_CATEGORIES?.images?.models;if(cat&&!cat.includes(m.id))cat.push(m.id);}}catch{}
  return modelsCache.list;
 }
 const defaultModel=list=>(list.find(m=>m.default&&!m.edit)||{id:'qwen-image-2512'}).id;

 // ---------- Select Model ----------
 // options: {get:()=>id, set:id=>void, editing:()=>bool}
 function modelPicker(host,options){
  const wrap=document.createElement('div');wrap.className='gq-picker';
  wrap.innerHTML='<button type="button" class="secondary gq-select" aria-haspopup="true" aria-expanded="false">Select Model <span class="gq-chev" aria-hidden="true">⌄</span></button>'
   +'<div class="gq-menu panel" role="group" aria-label="Select Model" hidden><div class="gq-menu-head help"><span></span><span>Quality</span><span>Speed</span><span class="gq-right">Estimated wait</span><button type="button" class="gq-x icon-button" aria-label="Close" title="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="gq-menu-rows" role="radiogroup" aria-label="Picture model"></div></div>';
  host.append(wrap);
  const button=wrap.querySelector('.gq-select'),menu=wrap.querySelector('.gq-menu'),rows=wrap.querySelector('.gq-menu-rows');
  let timer=0;
  async function paint(force){
   const list=await models(force),editing=!!options.editing?.(),chosen=editing?(list.find(m=>m.edit)||{}).id:(options.get()||defaultModel(list));
   const shown=list.filter(m=>editing?m.edit:!m.edit).concat(list.filter(m=>editing?!m.edit:m.edit));
   rows.innerHTML=shown.map(m=>{const off=editing?!m.edit:!!m.edit,on=m.id===chosen,q=Math.max(0,Math.min(5,Number(m.quality)||0));
    const tone=m.waiting>400?'slow':m.waiting>150?'busy':'free';
    return '<button type="button" role="radio" class="gq-row" data-model="'+esc(m.id)+'" aria-checked="'+on+'"'+(off?' disabled':'')+'>'
     +'<span class="gq-name">'+esc(m.name)+(m.default?' <span class="story-detail-default">Default</span>':'')+(m.edit?' <span class="help">(edit tabs only)</span>':'')+'</span>'
     +'<span class="gq-quality"><span class="gq-dots" aria-hidden="true">'+'●'.repeat(q)+'○'.repeat(5-q)+'</span> <span class="help">'+esc(m.quality_label||'')+'</span></span>'
     +'<span class="gq-speed">'+esc(speed(m.seconds))+'</span>'
     +'<span class="gq-right"><span class="gq-wait" data-tone="'+tone+'">Est. '+esc(wait(m.wait_seconds))+'</span><span class="help">'+Number(m.waiting||0).toLocaleString()+' in line</span></span></button>';}).join('');
  }
  function open(show){menu.hidden=!show;button.setAttribute('aria-expanded',String(show));clearInterval(timer);if(show){paint(true);timer=setInterval(()=>{if(!wrap.isConnected)return clearInterval(timer);paint(true);},10000);}}
  button.onclick=()=>open(menu.hidden);
  wrap.querySelector('.gq-x').onclick=()=>{open(false);button.focus();};
  menu.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();open(false);button.focus();}});
  // Picking a model keeps the list open (owner, 20 Nov 2026); ✕ or Select Model closes it.
  rows.onclick=e=>{const row=e.target.closest('[data-model]');if(!row||row.disabled)return;options.set(row.dataset.model);paint();};
  return {refresh:()=>{if(!menu.hidden)paint();}};
 }

 // ---------- Queue pop-up ----------
 // kind 'audio' (owner final mocks, 21 Nov 2026): the same pop-up lists waiting audio recordings from /api/audio/queue.
 // Audio jobs go to RunPod as soon as they are sent, so they cannot be reordered (no Move to top or drag); Cancel stops one.
 const view={tab:'All',search:'',offset:0,data:null,busy:false,drag:null,kind:'image'};
 let dialog=null,poll=0;
 function queueButton(host,{kind='image'}={}){
  const b=document.createElement('button');b.type='button';b.className='secondary gq-queue';b.dataset.genQueue='';b.dataset.kind=kind;b.innerHTML='Queue <span class="gq-count" data-gq-count hidden></span>';
  b.onclick=()=>open(kind);host.prepend(b);refreshCount(b);return b;
 }
 async function refreshCount(b){
  if(!b?.isConnected||!ready())return;
  try{const data=await page({offset:0,limit:1,model:'',search:'',kind:b.dataset.kind||'image'});const n=data.mine?.waiting||0,c=b.querySelector('[data-gq-count]');c.textContent=n.toLocaleString();c.hidden=!n;b.setAttribute('aria-label','Queue'+(n?', '+n+' waiting':''));}catch{}
 }
 function page({offset=view.offset,limit=50,model=view.tab==='All'?'':view.tab,search=view.search,kind=view.kind}={}){
  if(kind==='audio')return api('audio/queue?'+new URLSearchParams({model,search,offset:String(offset),limit:String(limit)}).toString());
  return api('queue?'+new URLSearchParams({owner:me(),model,search,offset:String(offset),limit:String(limit)}).toString());
 }
 function ensureDialog(){
  if(dialog?.isConnected)return dialog;
  dialog=document.createElement('dialog');dialog.id='generation-queue-dialog';dialog.className='gq-dialog';dialog.setAttribute('aria-labelledby','gq-title');
  dialog.innerHTML='<h2 id="gq-title">Queue</h2><p class="help" data-gq-summary></p><div class="gq-progress"><div class="story-gen-track" role="progressbar" aria-label="Your pictures done" aria-valuemin="0" aria-valuemax="100"><span data-gq-bar></span></div><span class="gq-pct" data-gq-pct></span></div>'
   +'<div class="gq-ribbon"><div class="gq-tabs" role="tablist" aria-label="Models" data-gq-tabs></div><label class="gq-search"><span class="sr-only">Search the queue</span><input type="search" placeholder="Search" data-gq-search></label></div>'
   +'<ol class="gq-list" data-gq-list aria-label="Your waiting pictures"></ol><div class="gq-pager" data-gq-pager></div>'
   +'<div class="gq-foot"><button type="button" class="secondary" data-gq-cancel-all>Cancel All</button></div>';
  document.body.append(dialog);
  const search=dialog.querySelector('[data-gq-search]');let t=0;
  search.oninput=()=>{clearTimeout(t);t=setTimeout(()=>{view.search=search.value.trim();view.offset=0;load();},250);};
  dialog.querySelector('[data-gq-cancel-all]').onclick=async()=>{if(!view.data?.mine?.waiting)return;if(view.kind==='audio'){const all=await page({offset:0,limit:50,model:'',search:''});for(const x of all.items||[])await act('generation/stop',{job_id:x.id},{reload:false});return load();}await act('queue/cancel-all',{});};
  dialog.addEventListener('close',()=>{clearInterval(poll);poll=0;document.querySelectorAll('[data-gen-queue]').forEach(refreshCount);});
  const list=dialog.querySelector('[data-gq-list]');
  list.addEventListener('click',e=>{const b=e.target.closest('[data-gq-act]');if(!b)return;const id=b.closest('[data-id]').dataset.id;
   if(b.dataset.gqAct==='top')act('queue/move',{job_id:id,top:true});else if(view.kind==='audio')act('generation/stop',{job_id:id});else act('queue/cancel',{job_ids:[id]});});
  list.addEventListener('dragstart',e=>{const row=e.target.closest('[data-id]');if(!row||view.kind==='audio')return;view.drag=row.dataset.id;e.dataTransfer.effectAllowed='move';row.classList.add('gq-dragging');});
  list.addEventListener('dragend',e=>{e.target.closest('[data-id]')?.classList.remove('gq-dragging');list.querySelectorAll('.gq-over').forEach(x=>x.classList.remove('gq-over'));});
  list.addEventListener('dragover',e=>{const row=e.target.closest('[data-id]');if(!row||!view.drag)return;e.preventDefault();list.querySelectorAll('.gq-over').forEach(x=>x!==row&&x.classList.remove('gq-over'));row.classList.add('gq-over');});
  list.addEventListener('drop',e=>{const row=e.target.closest('[data-id]');if(!row||!view.drag)return;e.preventDefault();const from=view.drag;view.drag=null;if(from!==row.dataset.id)act('queue/move',{job_id:from,before_id:row.dataset.id});});
  // Keyboard reorder on the handle: Alt+Up / Alt+Down move one place among your own jobs.
  list.addEventListener('keydown',e=>{const handle=e.target.closest('.gq-grip');if(!handle||!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const rows=[...list.querySelectorAll('[data-id]')],i=rows.indexOf(handle.closest('[data-id]'));
   if(e.key==='ArrowUp'&&i>0)act('queue/move',{job_id:rows[i].dataset.id,before_id:rows[i-1].dataset.id});else if(e.key==='ArrowDown'&&i<rows.length-1)act('queue/move',{job_id:rows[i+1].dataset.id,before_id:rows[i].dataset.id});});
  return dialog;
 }
 async function act(path,body,{reload=true}={}){if(view.busy)return;view.busy=true;try{await api(path,view.kind==='audio'?body:{gpu:'serverless',...body});}catch(error){window.EccoErrors?.show(error,{title:'The queue could not be changed'});}finally{view.busy=false;}if(reload)load();}
 async function open(kind){
  if(!ready()){window.EccoStorage?.open?.();return;}
  const d=ensureDialog();if(typeof kind==='string'&&kind!==view.kind){view.kind=kind;view.tab='All';view.search='';d.querySelector('[data-gq-search]').value='';}view.offset=0;d.dataset.kind=view.kind;d.querySelector('[data-gq-list]').setAttribute('aria-label',view.kind==='audio'?'Your waiting recordings':'Your waiting pictures');d.querySelector('.gq-progress [role=progressbar]').setAttribute('aria-label',view.kind==='audio'?'Your recordings done':'Your pictures done');if(!d.open)d.showModal();await load();clearInterval(poll);poll=setInterval(()=>{if(!d.open)return clearInterval(poll);if(!view.busy&&!view.drag)load();},4000);
 }
 let loadSeq=0;
 async function load(){
  const d=ensureDialog(),seq=++loadSeq;let data;try{data=await page();}catch(error){if(seq===loadSeq)d.querySelector('[data-gq-summary]').textContent=error.message;return;}
  if(seq!==loadSeq)return;
  view.data=data;const list=view.kind==='audio'?(window.EccoAudioModels||[]).filter(m=>(data.models||[]).includes(m.id)).map(m=>({id:m.id,name:m.name})):await models();
  if(view.kind==='audio')data.items.forEach(x=>{x.model_name=list.find(m=>m.id===x.model)?.name||x.model_name;});
  const mine=data.mine||{},total=(mine.waiting||0)+(mine.running||0)+(mine.done||0),pct=total?Math.round(100*(mine.done||0)/total):0;
  d.querySelector('[data-gq-summary]').textContent=view.tab==='All'?(mine.done||0).toLocaleString()+' of '+total.toLocaleString()+' done · '+(mine.running||0)+' generating · about '+wait(data.last_wait_seconds).replace('~','')+' left'
   :view.tab+': '+data.total.toLocaleString()+' waiting';
  const summaryModel=list.find(m=>m.id===view.tab);if(summaryModel&&view.tab!=='All')d.querySelector('[data-gq-summary]').textContent=summaryModel.name+': '+data.total.toLocaleString()+' waiting';
  d.querySelector('[data-gq-bar]').style.width=Math.max(pct,1)+'%';d.querySelector('[data-gq-pct]').textContent=pct+'%';d.querySelector('.gq-progress [role=progressbar]').setAttribute('aria-valuenow',String(pct));
  // Tabs: All with your count, then one per model in the list (no counts).
  const tabs=[['All','All '+(mine.waiting||0).toLocaleString()],...list.map(m=>[m.id,m.name])];
  d.querySelector('[data-gq-tabs]').innerHTML=tabs.map(([id,label])=>'<button type="button" role="tab" class="gq-tab" data-gq-tab="'+esc(id)+'" aria-selected="'+(view.tab===id)+'" tabindex="'+(view.tab===id?0:-1)+'">'+esc(label)+'</button>').join('');
  d.querySelectorAll('[data-gq-tab]').forEach(b=>b.onclick=()=>{view.tab=b.dataset.gqTab;view.offset=0;d.querySelectorAll('[data-gq-tab]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));load();});
  const rows=d.querySelector('[data-gq-list]');
  rows.innerHTML=data.items.map(x=>'<li class="gq-item" data-id="'+esc(x.id)+'" draggable="true"><span class="gq-grip" tabindex="0" role="button" aria-label="Reorder '+esc(x.name)+' (Alt+Up or Alt+Down)" title="Drag to reorder">⋮⋮</span><span class="gq-place help">'+(x.place||'')+'</span><span class="gq-title" title="'+esc(x.name)+'">'+esc(x.name)+'</span><span class="gq-model help" title="'+esc(x.model_name)+'">'+esc(x.model_name)+'</span><span class="gq-eta help">'+(x.place===1?'Next':'Est. '+esc(wait(x.wait_seconds).replace('~','')))+'</span>'
   +'<span class="gq-acts"><button type="button" class="icon-button" data-gq-act="top" aria-label="Move to top" title="Move to top"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 4h14M12 20V9M7 13l5-5 5 5"/></svg></button><button type="button" class="icon-button" data-gq-act="cancel" aria-label="Remove from the queue" title="Cancel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span></li>').join('');
  const pager=d.querySelector('[data-gq-pager]'),pages=Math.ceil(data.total/50);
  pager.innerHTML=pages>1?'<button type="button" class="secondary" data-gq-page="-1"'+(view.offset?'':' disabled')+'>Previous</button><span class="help">'+(view.offset+1)+'–'+Math.min(data.total,view.offset+50)+' of '+data.total.toLocaleString()+'</span><button type="button" class="secondary" data-gq-page="1"'+(view.offset+50<data.total?'':' disabled')+'>Next</button>':'';
  pager.querySelectorAll('[data-gq-page]').forEach(b=>b.onclick=()=>{view.offset=Math.max(0,view.offset+50*Number(b.dataset.gqPage));load();});
  d.querySelector('[data-gq-cancel-all]').disabled=!mine.waiting;
 }
 window.EccoQueue={modelPicker,queueButton,models,refreshCount,open,parallel:async()=>{try{return (await page({offset:0,limit:1,model:'',search:''})).parallel||1;}catch{return 1;}}};
})();
