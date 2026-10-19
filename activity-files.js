'use strict';
/* Activity outputs use existing authenticated media and recoverable deletion APIs. */
(()=>{
 const q=s=>document.querySelector(s),rows=()=>state?.records||[];
 let selectedJob='',filter='all',deleted=false,signature='';
 function outputIds(id){
  const ids=new Set(),visited=new Set();
  function visit(jid){if(visited.has(jid))return;visited.add(jid);const job=rows().find(r=>r.id===jid);if(!job)return;
   for(const result of Array.isArray(job.result)?job.result:[job.result])if(typeof result==='string')ids.add(result);
   rows().filter(a=>a.kind==='asset'&&a.job_id===jid).forEach(a=>ids.add(a.id));
   for(const child of job.children||[])visit(child);
  }visit(id);return ids;
 }
 function open(id=''){
  selectedJob=id;signature='';const root=q('#activity-files');root.hidden=false;
  q('#jobs').hidden=true;q('#ecco-debug-view').hidden=true;
  q('#ecco-activity-tabs').querySelectorAll('[role=tab]').forEach(b=>{const active=b.id==='activity-files-tab';b.setAttribute('aria-selected',String(active));b.classList.toggle('secondary',!active);});render();
 }
 async function mutate(asset,mode,button){
  if(mode==='purge'&&!confirm('Permanently delete this file and its generated workspace copies? This cannot be undone. External copies and backups are unaffected.'))return;
  button.disabled=true;const message=q('#activity-files-message');message.textContent='Saving…';
  try{await api(mode==='purge'?'purge':'trash',mode==='purge'?{asset_id:asset.id,confirmed:true}:{asset_id:asset.id,restore:mode==='restore'});await refresh();signature='';render();q('#activity-files-message').textContent=mode==='purge'?'Permanently deleted from workspace.':mode==='restore'?'Restored.':'Moved to Trash. Switch to Trash to restore or permanently delete.';}
  catch(e){message.textContent=e.message;message.style.color='#ff8080';button.disabled=false;}
 }
 function render(){
  const root=q('#activity-files');if(!root||root.hidden)return;
  const ids=selectedJob?outputIds(selectedJob):null;
  const assets=rows().filter(a=>a.kind==='asset'&&!a.purged&&['image','video','audio'].includes(a.media)&&Boolean(a.deleted)===deleted&&(!ids||ids.has(a.id))&&(filter==='all'||a.media===filter)).sort((a,b)=>b.created-a.created);
  const next=JSON.stringify([selectedJob,filter,deleted,assets]);if(next===signature)return;signature=next;
  q('#activity-files-scope').textContent=selectedJob?'Outputs and intermediate clips for job '+selectedJob:'All workspace images, videos and audio · all stories';
  const list=q('#activity-files-list');list.replaceChildren();
  q('#activity-files-count').textContent=assets.length+' files';
  for(const a of assets){
   const item=document.createElement('details');item.className='activity-file';const summary=document.createElement('summary');summary.textContent=(a.title||a.prompt||'Untitled '+a.media).slice(0,100)+' · '+a.media+(a.stage==='prod'?' · production':'');item.append(summary);
   const body=document.createElement('div');body.className='form';item.append(body);
   const location=document.createElement('p');location.className='help';location.textContent=a.path||a.id;body.append(location);
   item.addEventListener('toggle',()=>{if(!item.open||item.dataset.loaded)return;item.dataset.loaded='1';
    const preview=document.createElement(a.media==='image'?'img':a.media);preview.dataset.asset=a.id;preview.src=media(a);preview.style.cssText='width:100%;max-height:280px;object-fit:contain';
    if(a.media==='image')preview.alt=a.title||'Generated image';else{preview.controls=true;preview.preload='metadata';}body.prepend(preview);hydrateMedia();
   });
   const actions=document.createElement('div');actions.className='row';body.append(actions);
   const download=document.createElement('a');download.textContent='Download';download.dataset.asset=a.id;download.href=media(a);download.download=(a.path||a.id).split('/').pop();actions.append(download);
   for(const mode of deleted?['restore','purge']:['trash']){const b=document.createElement('button');b.type='button';b.className='small secondary';b.textContent=mode==='restore'?'Restore':mode==='purge'?'Delete permanently':'Move to Trash';b.setAttribute('aria-label',b.textContent+' '+(a.title||a.id));b.onclick=()=>mutate(a,mode,b);actions.append(b);}
   list.append(item);
  }
  if(!assets.length){const p=document.createElement('p');p.className='help';p.textContent=state.storage_pending?'Connect storage to browse generated files.':selectedJob?'No matching saved outputs for this job.':'No matching files.';list.append(p);}
  hydrateMedia();
 }
 function mount(){
  const tabs=q('#ecco-activity-tabs');if(!tabs)return;
  if(!q('#activity-files')){
   const b=document.createElement('button');b.id='activity-files-tab';b.type='button';b.className='secondary';b.setAttribute('role','tab');b.setAttribute('aria-selected','false');b.textContent='Files';b.onclick=()=>open();tabs.append(b);
   const root=document.createElement('section');root.id='activity-files';root.hidden=true;root.setAttribute('role','tabpanel');b.setAttribute('aria-controls',root.id);
   root.innerHTML='<p id="activity-files-scope" class="help"></p><div class="row"><label>Type<select id="activity-files-type"><option value="all">All files</option><option value="image">Images</option><option value="video">Videos</option><option value="audio">Audio</option></select></label><label>Location<select id="activity-files-location"><option value="active">Workspace</option><option value="trash">Trash</option></select></label></div><button type="button" id="activity-files-all" class="small secondary">All jobs and stories</button><p id="activity-files-count"></p><p id="activity-files-message" role="status"></p><div id="activity-files-list"></div>';
   tabs.after(root);q('#activity-files-type').onchange=e=>{filter=e.target.value;render();};q('#activity-files-location').onchange=e=>{deleted=e.target.value==='trash';render();};q('#activity-files-all').onclick=()=>open();
   for(const tab of tabs.querySelectorAll('button:not(#activity-files-tab)'))tab.addEventListener('click',()=>{root.hidden=true;});
   const style=document.createElement('style');style.textContent='.activity-file{border:1px solid #605679;border-radius:8px;padding:10px;margin:10px 0}.activity-file summary{cursor:pointer;overflow-wrap:anywhere}.activity-file .form{padding-top:10px}#activity-files [hidden]{display:none!important}#activity-files .row{display:flex;gap:8px;flex-wrap:wrap}';document.head.append(style);
  }
  const debug=q('#ecco-debug-view');if(debug&&!debug.hidden&&!q('#activity-debug-files')){const b=document.createElement('button');b.id='activity-debug-files';b.type='button';b.className='secondary';b.textContent='View / delete generated files';b.onclick=()=>open(q('#ecco-debug-job')?.value||'');debug.prepend(b);}
 }
 let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;mount();});}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
 setInterval(render,1500);mount();
})();
