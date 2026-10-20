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
  mount();selectedJob=id;signature='';const root=q('#activity-files');if(!root.open)root.showModal();render();
 }
 async function mutate(asset,mode,button){
  if(mode==='purge'&&!confirm('Permanently delete this file and its generated workspace copies? This cannot be undone. External copies and backups are unaffected.'))return;
  button.disabled=true;const message=q('#activity-files-message');message.textContent='Saving…';
  try{await api(mode==='purge'?'purge':'trash',mode==='purge'?{asset_id:asset.id,confirmed:true}:{asset_id:asset.id,restore:mode==='restore'});await refresh();signature='';render();q('#activity-files-message').textContent=mode==='purge'?'Permanently deleted from workspace.':mode==='restore'?'Restored.':'Moved to Trash. Switch to Trash to restore or permanently delete.';}
  catch(e){message.textContent=e.message;message.style.color='#ff8080';button.disabled=false;}
 }
 function render(){
  const root=q('#activity-files');if(!root||!root.open)return;
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
  const menu=q('[data-category="Activity"] .workspace-menu-items');if(!menu)return;
  if(!q('#activity-files-menu')){const b=document.createElement('button');b.id='activity-files-menu';b.type='button';b.className='secondary';b.textContent='Files';b.onclick=()=>{open();menu.closest('details').open=false;};menu.append(b);}
  if(!q('#activity-files')){
   const root=document.createElement('dialog');root.id='activity-files';root.setAttribute('aria-label','Files');
   root.innerHTML='<div class="section-head"><h2>Files</h2><button type="button" data-close aria-label="Close Files">×</button></div><p id="activity-files-scope" class="help"></p><div class="row"><label>Type<select id="activity-files-type"><option value="all">All files</option><option value="image">Images</option><option value="video">Videos</option><option value="audio">Audio</option></select></label><label>Location<select id="activity-files-location"><option value="active">Workspace</option><option value="trash">Trash</option></select></label></div><button type="button" id="activity-files-all" class="small secondary">All jobs and stories</button><p id="activity-files-count"></p><p id="activity-files-message" role="status"></p><div id="activity-files-list"></div>';
   document.body.append(root);root.querySelector('[data-close]').onclick=()=>root.close();q('#activity-files-type').onchange=e=>{filter=e.target.value;render();};q('#activity-files-location').onchange=e=>{deleted=e.target.value==='trash';render();};q('#activity-files-all').onclick=()=>open();
   const style=document.createElement('style');style.textContent='#activity-files{width:min(700px,calc(100vw - 32px));max-height:85vh;overflow:auto;background:#201d44;color:#eeebf5;border:1px solid #605679;border-radius:9px;padding:20px}.activity-file{border:1px solid #605679;border-radius:8px;padding:10px;margin:10px 0}.activity-file summary{cursor:pointer;overflow-wrap:anywhere}.activity-file .form{padding-top:10px}#activity-files [hidden]{display:none!important}#activity-files .row{display:flex;gap:8px;flex-wrap:wrap}';document.head.append(style);
  }

 }
 let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;mount();});}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
 setInterval(render,1500);mount();
})();

