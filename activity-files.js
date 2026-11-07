'use strict';
/* Activity outputs use existing authenticated media and recoverable deletion APIs. */
(()=>{
 const q=s=>document.querySelector(s),rows=()=>state?.records||[];
 let selectedJob='',filter='all',deleted=false,query='',signature='',sortBy='created',sortDirection='descending';
 const openedByScope=new Map(),columns=[['name','Name'],['kind','Kind'],['opened','Date Last Opened'],['created','Date Created']];
 const name=a=>a.title||a.name||a.filename||(a.path||'').split('/').pop()||a.prompt||'Untitled '+a.media;
 const kind=a=>({image:'Image',video:'Video',audio:'Audio'}[a.media]||a.media);
 function timestamp(value){if(value==null||value==='')return null;const n=Number(value),t=Number.isFinite(n)?(n<1e12?n*1000:n):Date.parse(value);return Number.isFinite(t)&&Math.abs(t)<=8.64e15?t:null;}
 function scope(){return 'ecco-drive-opened:v1:'+JSON.stringify([window.EccoAuth?.user?.id||'guest',state.config?.storage?.volume||'workspace']);}
 function opened(){const key=scope();if(!openedByScope.has(key)){let saved={};if(window.EccoAuth?.user?.id)try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch{}openedByScope.set(key,new Map(Object.entries(saved||{}).filter(([,t])=>Number.isFinite(t)&&t>0&&t<=8.64e15)));}return openedByScope.get(key);}
 function rememberOpen(a){const dates=opened();dates.set(a.id,Date.now());if(window.EccoAuth?.user?.id)try{localStorage.setItem(scope(),JSON.stringify(Object.fromEntries(dates)));}catch{}signature='';}
 function compare(a,b){let result=0;if(sortBy==='name'||sortBy==='kind'){const value=sortBy==='name'?name:kind;result=String(value(a)).localeCompare(String(value(b)),undefined,{numeric:true,sensitivity:'base'});}else{const value=a=>sortBy==='opened'?(opened().get(a.id)??null):timestamp(a.created??a.created_at),av=value(a),bv=value(b);if(av===null||bv===null)return av===bv?String(a.id).localeCompare(String(b.id)):av===null?1:-1;result=av-bv;}return result*(sortDirection==='descending'?-1:1)||String(a.id).localeCompare(String(b.id));}
 function dateCell(value){const cell=document.createElement('td');cell.className='activity-file-date';if(value===null){cell.textContent='—';return cell;}const date=new Date(value),time=document.createElement('time');time.dateTime=date.toISOString();time.textContent=date.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});time.title=date.toLocaleString();cell.append(time);return cell;}
 function outputIds(id){
  const ids=new Set(),visited=new Set();
  function visit(jid){if(visited.has(jid))return;visited.add(jid);const job=rows().find(r=>r.id===jid);if(!job)return;
   for(const result of Array.isArray(job.result)?job.result:[job.result])if(typeof result==='string')ids.add(result);
   rows().filter(a=>a.kind==='asset'&&a.job_id===jid).forEach(a=>ids.add(a.id));
   for(const child of job.children||[])visit(child);
  }visit(id);return ids;
 }
 function open(id=''){
  mount();selectedJob=id;signature='';const root=q('#activity-files');if(!root.open)root.showModal();render();q('#activity-files-search').focus();
 }
 async function mutate(asset,mode,button){
  if(mode==='purge'&&!confirm('Permanently delete this file and its generated workspace copies? This cannot be undone. External copies and backups are unaffected.'))return;
  button.disabled=true;const message=button.closest('dialog')?.querySelector('[data-file-message]')||q('#activity-files-message');message.style.color='';message.textContent='Saving…';
  try{await api(mode==='purge'?'purge':'trash',mode==='purge'?{asset_id:asset.id,confirmed:true}:{asset_id:asset.id,restore:mode==='restore'});await refresh();q('#activity-file-preview')?.close();signature='';render();q('#activity-files-message').textContent=mode==='purge'?'Permanently deleted from workspace.':mode==='restore'?'Restored.':'Moved to Trash. Switch to Trash to restore or permanently delete.';}
  catch(e){message.textContent=e.message;message.style.color='#ff8080';button.disabled=false;}
 }
 function preview(a){
  let dialog=q('#activity-file-preview');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='activity-file-preview';dialog.setAttribute('aria-label','File preview');document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.querySelector('audio,video')?.pause();dialog.querySelector('img,audio,video')?.removeAttribute('src');const button=[...q('#activity-files-list').querySelectorAll('[data-open-file]')].find(b=>b.dataset.openFile===dialog.dataset.asset);if(q('#activity-files').open)button?.focus({preventScroll:true});});}
  dialog.replaceChildren();dialog.dataset.asset=a.id;
  const head=document.createElement('div');head.className='section-head';const heading=document.createElement('h2');heading.textContent=name(a);const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Close file preview');close.onclick=()=>dialog.close();head.append(heading,close);dialog.append(head);
  const location=document.createElement('p');location.className='help';location.textContent=a.path||a.id;dialog.append(location);
  const player=document.createElement(a.media==='image'?'img':a.media);player.dataset.asset=a.id;player.src=media(a);player.className='activity-file-media';if(a.media==='image')player.alt=name(a);else{player.controls=true;player.preload='metadata';}dialog.append(player);
  const actions=document.createElement('div');actions.className='row';const download=document.createElement('a');download.textContent='Download';download.dataset.asset=a.id;download.href=media(a);download.download=(a.path||a.id).split('/').pop();actions.append(download);
  for(const mode of a.deleted?['restore','purge']:['trash']){const button=document.createElement('button');button.type='button';button.className='small secondary';button.textContent=mode==='restore'?'Restore':mode==='purge'?'Delete permanently':'Move to Trash';button.onclick=()=>mutate(a,mode,button);actions.append(button);}
  const message=document.createElement('p');message.dataset.fileMessage='';message.setAttribute('role','status');dialog.append(actions,message);
  rememberOpen(a);render();dialog.showModal();hydrateMedia();
 }
 function render(){
  const root=q('#activity-files');if(!root||!root.open)return;
  const ids=selectedJob?outputIds(selectedJob):null;
  const candidates=rows().filter(a=>a.kind==='asset'&&!a.purged&&['image','video','audio'].includes(a.media)&&Boolean(a.deleted)===deleted&&(!ids||ids.has(a.id))&&(filter==='all'||a.media===filter));
  const search=query.trim().toLowerCase();
  const assets=(search?candidates.filter(a=>[name(a),a.filename,a.name,a.path,a.id].some(value=>String(value||'').toLowerCase().includes(search))):candidates).sort(compare);
  const dates=opened(),next=JSON.stringify([selectedJob,filter,deleted,search,candidates.length,assets,assets.map(a=>dates.get(a.id)),sortBy,sortDirection,scope(),state.storage_pending]);if(next===signature)return;signature=next;
  q('#activity-files-scope').textContent=selectedJob?'Outputs and intermediate clips for job '+selectedJob:'All workspace images, videos and audio · all stories';
  const list=q('#activity-files-list'),focused=document.activeElement?.dataset.openFile;list.replaceChildren();
  q('#activity-files-count').textContent=assets.length+(search?' of '+candidates.length:'')+' files';
  for(const th of q('#activity-files-table').querySelectorAll('th')){const active=th.dataset.sort===sortBy;th.setAttribute('aria-sort',active?sortDirection:'none');th.querySelector('button').setAttribute('aria-label','Sort by '+columns.find(c=>c[0]===th.dataset.sort)[1]+', '+(active&&sortDirection==='ascending'?'descending':'ascending'));}
  for(const a of assets){const row=document.createElement('tr');row.dataset.assetId=a.id;const file=document.createElement('td'),button=document.createElement('button');button.type='button';button.className='activity-file-name';button.textContent=name(a);button.title=a.path||name(a);button.dataset.openFile=a.id;button.onclick=()=>preview(a);file.append(button);const type=document.createElement('td');type.textContent=kind(a);row.append(file,type,dateCell(dates.get(a.id)??null),dateCell(timestamp(a.created??a.created_at)));list.append(row);}
  if(!assets.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=4;cell.className='help';cell.textContent=state.storage_pending?'Connect storage to browse generated files.':search?'No files match your search.':selectedJob?'No matching saved outputs for this job.':'No matching files.';row.append(cell);list.append(row);}
  if(focused)[...list.querySelectorAll('[data-open-file]')].find(b=>b.dataset.openFile===focused)?.focus({preventScroll:true});
 }
 function mount(){
  const menu=q('[data-category="Activity"] .workspace-menu-items');if(!menu)return;
  if(!q('#activity-files-menu')){const b=document.createElement('button');b.id='activity-files-menu';b.type='button';b.className='secondary';b.textContent='Workspace Drive';b.onclick=()=>{open();menu.closest('details').open=false;};menu.append(b);}
  if(!q('#activity-files')){
   const root=document.createElement('dialog');root.id='activity-files';root.setAttribute('aria-label','Workspace Drive');
   root.innerHTML='<div class="section-head"><h2>Workspace Drive</h2><button type="button" data-close aria-label="Close Workspace Drive">×</button></div><p id="activity-files-scope" class="help"></p><div class="row activity-files-filters"><input id="activity-files-search" type="search" placeholder="Search" aria-label="Search files" autocomplete="off" spellcheck="false" aria-controls="activity-files-list" aria-describedby="activity-files-count"><label>Type<select id="activity-files-type"><option value="all">All files</option><option value="image">Images</option><option value="video">Videos</option><option value="audio">Audio</option></select></label><label>Location<select id="activity-files-location"><option value="active">Workspace</option><option value="trash">Trash</option></select></label></div><button type="button" id="activity-files-all" class="small secondary">All jobs and stories</button><p id="activity-files-count" role="status" aria-live="polite" aria-atomic="true"></p><p id="activity-files-message" role="status"></p><div class="activity-files-table-scroll"><table id="activity-files-table" aria-label="Workspace files"><thead><tr></tr></thead><tbody id="activity-files-list"></tbody></table></div>';
   document.body.append(root);
   for(const [key,label] of columns){const th=document.createElement('th');th.scope='col';th.dataset.sort=key;const button=document.createElement('button');button.type='button';button.className='activity-file-sort';button.append(document.createTextNode(label+' '));for(const [direction,arrow] of [['ascending','↑'],['descending','↓']]){const icon=document.createElement('span');icon.dataset.direction=direction;icon.setAttribute('aria-hidden','true');icon.textContent=arrow;button.append(icon);}button.onclick=()=>{sortDirection=sortBy===key&&sortDirection==='ascending'?'descending':'ascending';sortBy=key;render();};if(key==='opened')button.title='Last opened from Workspace Drive in this browser';th.append(button);q('#activity-files-table thead tr').append(th);}
   root.querySelector('[data-close]').onclick=()=>root.close();q('#activity-files-search').addEventListener('input',e=>{query=e.target.value;render();});q('#activity-files-type').onchange=e=>{filter=e.target.value;render();};q('#activity-files-location').onchange=e=>{deleted=e.target.value==='trash';render();};q('#activity-files-all').onclick=()=>open();
   const style=document.createElement('style');style.textContent=`
#activity-files,#activity-file-preview{width:min(700px,calc(100vw - 32px));max-height:85vh;overflow:auto;background:var(--ecco-theme-surface,#201d44);color:var(--ecco-theme-text,#eeebf5);border:1px solid var(--ecco-theme-border,#605679);border-radius:9px;padding:20px}
#activity-files [hidden]{display:none!important}#activity-files .row,#activity-file-preview .row{display:flex;gap:8px;flex-wrap:wrap}
#activity-files .activity-files-filters{flex-wrap:nowrap;align-items:flex-end;font-size:12px}#activity-files .activity-files-filters>*{flex:1 1 0;min-width:0}#activity-files .activity-files-filters select{min-width:0}
.activity-files-table-scroll{overflow-x:auto}#activity-files-table{width:100%;min-width:560px;border-collapse:collapse;font-size:12px;text-align:left}#activity-files-table th,#activity-files-table td{border-bottom:1px solid var(--ecco-theme-border,#605679);padding:10px 8px;vertical-align:middle}#activity-files-table th:first-child{width:36%}#activity-files-table th:nth-child(2){width:12%}#activity-files-table th:nth-child(n+3){width:26%}
#activity-files #activity-files-table .activity-file-sort,#activity-files #activity-files-table .activity-file-name{font:inherit;text-align:left;background:transparent;color:inherit;border:0;border-radius:0;padding:0!important;box-shadow:none}#activity-files-table .activity-file-sort{font-weight:650;width:100%}#activity-files-table .activity-file-name{color:var(--ecco-theme-accent,var(--accent,#ffdc24));overflow-wrap:anywhere}#activity-files-table .activity-file-sort span{opacity:.4}#activity-files-table th[aria-sort=ascending] [data-direction=ascending],#activity-files-table th[aria-sort=descending] [data-direction=descending]{opacity:1;color:var(--ecco-theme-accent,var(--accent,#ffdc24))}#activity-files-table tbody tr:hover{background:var(--ecco-theme-control,#302a54)}.activity-file-date{color:var(--ecco-theme-muted,var(--muted,#b1acc9))}
#activity-file-preview .activity-file-media{display:block;width:100%;max-height:50vh;object-fit:contain;margin:16px 0}#activity-file-preview h2,#activity-file-preview .help{overflow-wrap:anywhere}
`;document.head.append(style);

  }

 }
 let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;mount();});}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
 document.addEventListener('ecco:auth-change',()=>{q('#activity-file-preview')?.close();q('#activity-files')?.close();signature='';});
 window.addEventListener('storage',e=>{if(e.key===scope()||e.key===null){openedByScope.delete(scope());signature='';render();}});
 setInterval(render,1500);mount();
})();

