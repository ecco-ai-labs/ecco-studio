'use strict';
/* Shared library controls preserve card actions, media elements and selections. */
(()=>{
 const libraries=[['image','library-gallery'],['audio','audio-library-gallery'],['video','video-library-gallery'],['story','story-library-list'],['workflow','workflow-library-list']];
 const preferences=new Map(),seen=new WeakMap(),sizes=window.EccoMediaMetadata||(window.EccoMediaMetadata=new Map()),pending=new Set();
 const stamp=value=>{if(!value)return null;const n=Number(value);const t=Number.isFinite(n)?(n<1e12?n*1000:n):Date.parse(value);return Number.isFinite(t)?t:null;};
 const bytes=value=>value===null?'—':value<1024?value+' B':value<1048576?(value/1024).toFixed(1)+' KB':(value/1048576).toFixed(1)+' MB';
 const seconds=value=>Number.isFinite(Number(value))&&Number(value)>0?Math.floor(value/60)+':'+String(Math.floor(value%60)).padStart(2,'0'):'—';
 function info(card){
  const id=card.dataset.libraryId||card.querySelector('[data-asset]')?.dataset.asset;
  const r=(typeof state!=='undefined'?state.records:[])?.find(r=>r.id===id)||{};
  const cached=sizes.get(id)||{},rawSize=r.size_bytes??r.file_size??cached.size;
  const size=rawSize!=null&&Number.isFinite(Number(rawSize))?Number(rawSize):null;
  const player=card.querySelector('audio,video');
  return {id,r,title:r.title||r.name||card.querySelector('.text-library-caption strong,.card-body>p,h3')?.textContent||'Untitled',created:stamp(r.created||r.created_at),size,duration:r.duration||r.settings?.duration||(Number.isFinite(player?.duration)?player.duration:null),model:r.settings?.model||r.model||'',stage:r.stage||(r.kind==='story'?'saved':''),search:[r.title,r.name,r.prompt,r.settings?.model,card.querySelector('.text-library-caption small')?.textContent,...[...card.querySelectorAll('.workspace-label')].map(x=>x.textContent)].filter(Boolean).join(' ').toLowerCase()};
 }
 function metadata(card,item,kind){
  let list=card.querySelector('.library-metadata');if(!list){list=document.createElement('dl');list.className='library-metadata';(card.querySelector('.card-body')||card).append(list);}
  const fields=[['Created',item.created===null?'—':new Date(item.created).toLocaleString()],...(['image','audio','video'].includes(kind)?[['Size',bytes(item.size)]]:[]),...(['audio','video'].includes(kind)?[['Duration',seconds(item.duration)]]:[]),['Model',item.model||'—'],['Status',item.stage==='prod'?'Production':item.stage==='dev'?'Draft':item.stage||'—']];
  const signature=JSON.stringify(fields);if(list.dataset.signature===signature)return;list.dataset.signature=signature;list.replaceChildren();
  for(const [name,value] of fields){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;list.append(dt,dd);}
  // Existing local blobs supply exact size without another storage download.
  const src=card.querySelector('audio,video,img')?.getAttribute('src');
  if(item.id&&item.size===null&&src?.startsWith('blob:')&&!pending.has(src)){
   pending.add(src);fetch(src).then(r=>r.blob()).then(blob=>{sizes.set(item.id,{...sizes.get(item.id),size:blob.size});schedule();}).catch(()=>{});
  }
 }
 function enhance(kind,gallery){
  const header=gallery.parentElement.querySelector(':scope > .section-head');if(!header)return;
  let prefs=preferences.get(kind);if(!prefs){prefs={sort:'newest',filter:'all',query:''};preferences.set(kind,prefs);}
  let tools=header.querySelector('.library-browser-tools');
  if(!tools){
   tools=document.createElement('div');tools.className='library-browser-tools';tools.innerHTML='<input type="search" placeholder="Filter library" aria-label="Filter '+kind+' library"><select aria-label="Filter '+kind+' items"><option value="all">All items</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option>'+(['image','audio','video'].includes(kind)?'<option value="dev">Draft</option><option value="prod">Production</option>':'')+'</select><select aria-label="Sort '+kind+' library"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="az">Name A–Z</option><option value="za">Name Z–A</option>'+(['image','audio','video'].includes(kind)?'<option value="largest">Largest first</option><option value="smallest">Smallest first</option>':'')+'</select><span class="library-filter-count" role="status" aria-live="polite"></span>';
   header.append(tools);const [search,filter,sort]=tools.querySelectorAll('input,select');search.value=prefs.query;filter.value=prefs.filter;sort.value=prefs.sort;
   search.oninput=()=>{prefs.query=search.value;schedule();};filter.onchange=()=>{prefs.filter=filter.value;schedule();};sort.onchange=()=>{prefs.sort=sort.value;schedule();};
  }
  const cards=[...gallery.children].filter(x=>x.matches('.card'));const items=cards.map(card=>({card,...info(card)}));
  const signature=JSON.stringify([prefs,items.map(x=>[x.id,x.title,x.created,x.size,x.duration,x.model,x.stage,x.search])]);
  if(seen.get(gallery)===signature)return;seen.set(gallery,signature);
  for(const item of items)metadata(item.card,item,kind);
  const value=(a,b,key,desc)=>{if(a[key]===null&&b[key]===null)return 0;if(a[key]===null)return 1;if(b[key]===null)return -1;return (a[key]-b[key])*(desc?-1:1);};
  const sorted=[...items].sort((a,b)=>{const s=prefs.sort;return (s==='az'||s==='za'?a.title.localeCompare(b.title,undefined,{numeric:true,sensitivity:'base'})*(s==='za'?-1:1):s==='largest'||s==='smallest'?value(a,b,'size',s==='largest'):value(a,b,'created',s==='newest'))||String(a.id).localeCompare(String(b.id));});
  const current=cards.map(c=>c);if(sorted.some((x,i)=>current[i]!==x.card))for(const item of sorted)gallery.append(item.card);
  let visible=0;const query=prefs.query.trim().toLowerCase();
  for(const item of sorted){const f=prefs.filter,after=f==='week'?Date.now()-7*86400000:f==='month'?Date.now()-30*86400000:null;const show=(!query||(item.title.toLowerCase()+' '+item.search).includes(query))&&(after!==null?item.created!==null&&item.created>=after:f==='all'||item.stage===f);if(item.card.hidden===show)item.card.hidden=!show;if(show)visible++;}
  // Group labels no longer describe the global sort; collection remains on each story row.
  for(const h of gallery.querySelectorAll(':scope > h3'))h.hidden=true;
  const count=tools.querySelector('.library-filter-count'),text=visible+' / '+items.length;if(count.textContent!==text)count.textContent=text;
  let empty=gallery.querySelector('.library-filter-empty');if(!empty){empty=document.createElement('p');empty.className='help library-filter-empty';empty.textContent='No matching items.';gallery.append(empty);}empty.hidden=!items.length||visible>0;
 }
 let queued=false;function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;for(const [kind,id] of libraries){const gallery=document.getElementById(id);if(gallery)enhance(kind,gallery);}});}
 new MutationObserver(schedule).observe(document.getElementById('page')||document.body,{childList:true,subtree:true});
 document.addEventListener('loadedmetadata',schedule,true);window.addEventListener('ecco:media-metadata',schedule);schedule();
})();
