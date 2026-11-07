'use strict';
/* One compact file browser; original controls and media nodes remain intact. */
(()=>{
 const libraries=[['image','library-gallery'],['audio','audio-library-gallery'],['video','video-library-gallery'],['story','story-library-list'],['workflow','workflow-library-list']];
 const columns=[['title','File Name'],['type','Type'],['created','Date Created'],['accessed','Date Last Accessed']];
 const preferences=new Map(),seen=new WeakMap(),sources=new WeakMap(),details=new WeakMap(),accessByScope=new Map();
 const sizes=window.EccoMediaMetadata||(window.EccoMediaMetadata=new Map());
 const stamp=value=>{if(value==null||value==='')return null;const n=Number(value),t=Number.isFinite(n)?(n<1e12?n*1000:n):Date.parse(value);return Number.isFinite(t)&&Math.abs(t)<=8.64e15?t:null;};
 const bytes=value=>value===null?'—':value<1024?value+' B':value<1048576?(value/1024).toFixed(1)+' KB':(value/1048576).toFixed(1)+' MB';
 const seconds=value=>Number.isFinite(Number(value))&&Number(value)>0?Math.floor(value/60)+':'+String(Math.floor(value%60)).padStart(2,'0'):'—';
 const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}};
 const scope=()=> 'ecco-library-accessed:v1:'+JSON.stringify([window.EccoAuth?.user?.id||'guest',typeof state!=='undefined'?state.config?.storage?.volume||'workspace':'workspace']);
 function accesses(){const key=scope();if(!accessByScope.has(key)){const saved=window.EccoAuth?.user?.id?read(key,{}):{};accessByScope.set(key,new Map(Object.entries(saved).filter(([,t])=>Number.isFinite(t)&&t>0&&t<=8.64e15)));}return accessByScope.get(key);}
 function remember(item){if(!item.id)return;const dates=accesses();dates.set(item.id,Date.now());if(window.EccoAuth?.user?.id)try{localStorage.setItem(scope(),JSON.stringify(Object.fromEntries(dates)));}catch{}schedule();}
 function info(card,kind,records){
  const original=sources.get(card)||card,id=card.dataset.libraryId||original.querySelector('[data-asset]')?.dataset.asset;
  const r=records.get(id)||{},cached=sizes.get(id)||{},rawSize=r.size_bytes??r.file_size??cached.size;
  const file=r.filename||(r.path||'').split('/').pop(),title=r.title||r.name||file||original.querySelector('.text-library-caption strong,.card-body>p,h3')?.textContent||'Untitled';
  const extension=(file||'').match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toUpperCase();
  const type=extension||({image:'Image',audio:'Audio',video:'Video',story:'Story',workflow:'Workflow'}[kind]);
  const remote=stamp(r.last_accessed??r.last_accessed_at),local=accesses().get(id)??null,player=original.querySelector('audio,video');
  return {card,id,r,title,type,created:stamp(r.created??r.created_at),accessed:remote===null?local:Math.max(remote,local||0),size:rawSize!=null&&Number.isFinite(Number(rawSize))?Number(rawSize):null,duration:r.duration||r.settings?.duration||(Number.isFinite(player?.duration)?player.duration:null),model:r.settings?.model||r.model||'',stage:r.stage||(kind==='story'?'saved':''),search:[title,file,r.prompt,r.settings?.model,original.querySelector('.text-library-caption small')?.textContent,...[...original.querySelectorAll('.workspace-label')].map(x=>x.textContent)].filter(Boolean).join(' ').toLowerCase()};
 }
 function metadata(original,item,kind){
  let list=original.querySelector('.library-metadata');if(!list){list=document.createElement('dl');list.className='library-metadata';(original.querySelector('.card-body')||original).append(list);}
  const fields=[['Created',item.created===null?'—':new Date(item.created).toLocaleString()],...(['image','audio','video'].includes(kind)?[['Size',bytes(item.size)]]:[]),...(['audio','video'].includes(kind)?[['Duration',seconds(item.duration)]]:[]),['Model',item.model||'—'],['Status',item.stage==='prod'?'Production':item.stage==='dev'?'Draft':item.stage||'—']];
  const signature=JSON.stringify(fields);if(list.dataset.signature===signature)return;list.dataset.signature=signature;list.replaceChildren();
  for(const [name,value] of fields){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;list.append(dt,dd);}
 }
 let preview=null;
 function closePreview(){preview?.dialog.close();}
 function previewItem(card,kind,trigger,actionsOnly=false){
  const item=details.get(card),original=sources.get(card);if(!item||!original)return;
  const open=original.querySelector('.text-library-open');
  if(open&&!actionsOnly){remember(item);open.click();return;}
  closePreview();
  const dialog=document.createElement('dialog');dialog.className='library-file-preview';dialog.setAttribute('aria-label',item.title);
  const head=document.createElement('div');head.className='section-head';const heading=document.createElement('h2');heading.textContent=item.title;
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Close file preview');close.onclick=()=>dialog.close();head.append(heading,close);dialog.append(head);
  const content=document.createElement('div');content.className='library-preview-content';dialog.append(content);document.body.append(dialog);
  const session={dialog,card,original,trigger};preview=session;original.hidden=false;content.append(original);
  original.querySelectorAll('.library-card-actions').forEach(d=>d.open=true);
  dialog.addEventListener('close',()=>{
   original.querySelectorAll('audio,video').forEach(player=>player.pause());original.hidden=true;card.prepend(original);dialog.remove();
   if(preview===session)preview=null;if(trigger.isConnected)trigger.focus({preventScroll:true});schedule();
  },{once:true});
  dialog.showModal();close.focus();remember(item);
 }
 const icons={image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 5 5 3-3 4 4"/>',audio:'<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',video:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4Z"/>',story:'<path d="M5 3h10l4 4v14H5ZM14 3v5h5M8 12h8M8 16h8"/>',workflow:'<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v9h9M9 6h9v9"/>'};
 function dateCell(cell,value){if(cell.dataset.value===String(value))return;cell.dataset.value=String(value);cell.replaceChildren();if(value===null){cell.textContent='—';return;}const d=new Date(value),time=document.createElement('time');time.dateTime=d.toISOString();time.textContent=d.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});time.title=d.toLocaleString();cell.append(time);}
 function row(item,kind,mode){
  const card=item.card;let original=sources.get(card);if(!original){
   original=document.createElement('div');original.className='library-original';original.hidden=true;
   for(const node of [...card.childNodes])if(!node.matches?.('.publishing-library-choice'))original.append(node);
   card.prepend(original);sources.set(card,original);card.setAttribute('role','row');card.dataset.libraryId=item.id||'';
   const file=document.createElement('div');file.className='library-file-cell';file.setAttribute('role','cell');
   const button=document.createElement('button');button.type='button';button.className='library-file-open';
   button.innerHTML='<span class="library-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">'+icons[kind]+'</svg></span><span class="library-file-name"></span>';
   button.onclick=()=>previewItem(card,kind,button);file.append(button);
   const more=document.createElement('button');more.type='button';more.className='library-file-more';more.textContent='⋮';more.onclick=()=>previewItem(card,kind,more,true);file.append(more);card.append(file);
   for(const key of ['type','created','accessed']){const cell=document.createElement('div');cell.className='library-file-'+key;cell.setAttribute('role','cell');card.append(cell);}
  }
  details.set(card,item);metadata(original,item,kind);
  const file=card.querySelector('.library-file-cell'),choice=card.querySelector(':scope > .publishing-library-choice');if(choice)file.prepend(choice);
  const button=file.querySelector('.library-file-open'),name=button.querySelector('.library-file-name');if(name.textContent!==item.title)name.textContent=item.title;
  button.title=item.title;button.setAttribute('aria-label','Open '+item.title);file.querySelector('.library-file-more').setAttribute('aria-label','Actions for '+item.title);
  const type=card.querySelector('.library-file-type');if(type.textContent!==item.type)type.textContent=item.type;
  dateCell(card.querySelector('.library-file-created'),item.created);dateCell(card.querySelector('.library-file-accessed'),item.accessed);
  // Only icon views need a thumbnail. Reuse the authenticated source, without video playback.
  const source=original.querySelector('img')?.getAttribute('src'),icon=button.querySelector('.library-file-icon');let thumb=icon.querySelector('img');
  if(kind==='image'&&mode!=='list'&&source){if(!thumb){thumb=document.createElement('img');thumb.alt='';thumb.loading='lazy';icon.append(thumb);}if(thumb.getAttribute('src')!==source)thumb.src=source;icon.classList.add('has-thumbnail');}
 }
 function enhance(kind,gallery){
  const header=gallery.parentElement.querySelector(':scope > .section-head');if(!header)return;
  const view=header.querySelector('.library-view-label select'),mode=view?.value||'list';
  gallery.classList.add('library-files');gallery.dataset.fileView=mode;gallery.setAttribute('role','table');gallery.setAttribute('aria-label',kind+' library files');
  if(view&&!view.dataset.fileViewBound){view.dataset.fileViewBound='1';view.setAttribute('aria-label',kind+' library view');view.addEventListener('change',schedule);}
  let prefs=preferences.get(kind);if(!prefs){prefs={sort:'created',direction:'descending',filter:'all',query:''};preferences.set(kind,prefs);}
  let tools=header.querySelector('.library-browser-tools');
  if(!tools){
   tools=document.createElement('div');tools.className='library-browser-tools';tools.innerHTML='<input type="search" placeholder="Search" aria-label="Filter '+kind+' library"><select aria-label="Filter '+kind+' items"><option value="all">All items</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option>'+(['image','audio','video'].includes(kind)?'<option value="dev">Draft</option><option value="prod">Production</option>':'')+'</select><span class="library-filter-count" role="status" aria-live="polite"></span>';
   (header.querySelector(':scope > .row')||header).append(tools);const [search,filter]=tools.querySelectorAll('input,select');search.value=prefs.query;filter.value=prefs.filter;
   search.oninput=()=>{prefs.query=search.value;schedule();};filter.onchange=()=>{prefs.filter=filter.value;schedule();};
  }
  let tableHead=gallery.querySelector(':scope > .library-file-heading');if(!tableHead){
   tableHead=document.createElement('div');tableHead.className='library-file-heading';tableHead.setAttribute('role','row');
   for(const [key,label] of columns){const cell=document.createElement('div');cell.setAttribute('role','columnheader');cell.dataset.sort=key;const button=document.createElement('button');button.type='button';button.textContent=label+' ';button.innerHTML+='<span data-direction="ascending" aria-hidden="true">↑</span><span data-direction="descending" aria-hidden="true">↓</span>';button.onclick=()=>{prefs.direction=prefs.sort===key&&prefs.direction==='ascending'?'descending':'ascending';prefs.sort=key;schedule();};if(key==='accessed')button.title='Workspace access history when available, plus opens in this browser';cell.append(button);tableHead.append(cell);}gallery.prepend(tableHead);
  }
  const records=new Map((typeof state!=='undefined'?state.records:[]).map(r=>[r.id,r]));
  // Local drafts have real timestamps only when their stored record supplies them.
  for(const r of read('ecco-workflow-drafts',[]))if(!records.has(r.id))records.set(r.id,r);
  const cards=[...gallery.children].filter(x=>x.matches('.card'));
  for(const card of cards){const id=card.dataset.libraryId;if(kind==='story'&&!records.has(id))records.set(id,read(id==='pending'?'ecco-new-story-draft':'ecco-story-setup:'+id,{}));}
  const items=cards.map(card=>info(card,kind,records));
  const signature=JSON.stringify([scope(),mode,prefs,items.map(x=>[x.id,x.title,x.type,x.created,x.accessed,x.size,x.duration,x.model,x.stage,x.search,(sources.get(x.card)||x.card).querySelector('img')?.getAttribute('src')])]);
  if(seen.get(gallery)===signature){for(const item of items){const choice=item.card.querySelector(':scope > .publishing-library-choice');if(choice)item.card.querySelector('.library-file-cell')?.prepend(choice);}return;}seen.set(gallery,signature);
  for(const item of items)row(item,kind,mode);
  for(const cell of tableHead.children){const active=cell.dataset.sort===prefs.sort;cell.setAttribute('aria-sort',active?prefs.direction:'none');cell.querySelector('button').setAttribute('aria-label','Sort by '+columns.find(c=>c[0]===cell.dataset.sort)[1]+', '+(active&&prefs.direction==='ascending'?'descending':'ascending'));}
  const sorted=[...items].sort((a,b)=>{const av=a[prefs.sort],bv=b[prefs.sort];if(av===null||bv===null)return av===bv?String(a.id).localeCompare(String(b.id)):av===null?1:-1;const diff=typeof av==='number'?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'});return diff*(prefs.direction==='descending'?-1:1)||String(a.id).localeCompare(String(b.id));});
  const focused=document.activeElement;
  if(sorted.some((x,i)=>cards[i]!==x.card)){for(const item of sorted)gallery.append(item.card);if(focused!==document.activeElement&&gallery.contains(focused))focused.focus({preventScroll:true});}
  let visible=0;const query=prefs.query.trim().toLowerCase(),after=prefs.filter==='week'?Date.now()-7*86400000:prefs.filter==='month'?Date.now()-30*86400000:null;
  for(const item of sorted){const show=(!query||item.search.includes(query))&&(after!==null?item.created!==null&&item.created>=after:prefs.filter==='all'||item.stage===prefs.filter);if(item.card.hidden===show)item.card.hidden=!show;if(show){visible++;item.card.setAttribute('aria-rowindex',String(visible+1));}}
  gallery.setAttribute('aria-rowcount',String(visible+1));
  for(const h of gallery.querySelectorAll(':scope > h3'))h.hidden=true;
  const count=tools.querySelector('.library-filter-count'),text=visible+' / '+items.length;if(count.textContent!==text)count.textContent=text;
  let empty=gallery.querySelector('.library-filter-empty');if(!empty){empty=document.createElement('p');empty.className='help library-filter-empty';empty.textContent='No matching items.';gallery.append(empty);}empty.hidden=!items.length||visible>0;
 }
 let queued=false;function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;if(preview&&!preview.card.isConnected)closePreview();for(const [kind,id] of libraries){const gallery=document.getElementById(id);if(gallery)enhance(kind,gallery);}});}
 new MutationObserver(schedule).observe(document.getElementById('page')||document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
 document.addEventListener('loadedmetadata',schedule,true);window.addEventListener('ecco:media-metadata',schedule);
 document.addEventListener('ecco:auth-change',()=>{closePreview();schedule();});window.addEventListener('storage',e=>{if(e.key===scope()||e.key===null){accessByScope.delete(scope());schedule();}});schedule();
})();
