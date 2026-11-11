'use strict';
/* One Library screen for stories, images, audio, video and workflows.
   Items, labels and actions come from the existing records and endpoints; labels nest with
   the stored "Parent / Child" names and any item can carry several labels. */
(()=>{
 const cssq=v=>String(v).replace(/[^\w-]/g,c=>'\\'+c);
 const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const records=()=>typeof state!=='undefined'&&state?state.records:[];
 const storage=()=>(typeof state!=='undefined'&&state?.config?.storage)||{};
 const when=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 const stamp=t=>{t=Number(t);return Number.isFinite(t)&&t>0?when.format(new Date(t*1000)):'';};
 const extension=p=>{const e=String(p||'').split('?')[0].split('.').pop();return e&&e.length<=5&&e!==p?e.toUpperCase():'';};
 const ICON={
  image:'M3 4h18v16H3z M9 10a2 2 0 1 0 0-.01 M21 16l-5-5-8 9',
  audio:'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  video:'M5 3l14 9-14 9z',
  story:'M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z',
  workflow:'M4 5h6v5H4z M14 14h6v5h-6z M10 7.5h4a2 2 0 0 1 2 2V14'
 };
 const FOLDER_ICON='M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';
 const KINDS={
  story:{title:'Stories',plural:'stories',singular:'story',heading:'Story Library',page:'story-library',folder:'story_folder',upload:'New Story',add:'Upload story file'},
  image:{title:'Images',plural:'images',singular:'image',heading:'Image library',page:'library',folder:'image_folder',upload:'Upload images',add:'Add images',asset:true},
  audio:{title:'Audio',plural:'audio clips',singular:'audio clip',heading:'Audio Library',page:'audio-library',folder:'audio_folder',upload:'Upload audio',add:'Add audio',asset:true},
  video:{title:'Video',plural:'videos',singular:'video',heading:'Video Library',page:'video-library',folder:'video_folder',upload:'Upload video',add:'Add video',asset:true},
  workflow:{title:'Workflows',plural:'workflows',singular:'workflow',heading:'Workflow Library',page:'workflow-library',folder:'workflow_folder',upload:'New workflow',add:'New workflow'}
 };
 const ORDER=['story','image','audio','video','workflow'];
 const PAGE_KIND=Object.fromEntries(ORDER.map(k=>[KINDS[k].page,k]));
 const HUES=['#2b3f6e','#5a3a5e','#2f5a58','#6a4a2a','#3c3a7a','#5a2f3f','#35604a'];
 const hue=id=>{let h=0;for(const c of String(id))h=(h*31+c.charCodeAt(0))>>>0;return HUES[h%HUES.length];};
 const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
 const ui=Object.fromEntries(ORDER.map(k=>[k,{filters:[],q:'',type:'all',sort:'new',view:localStorage.getItem('ecco-library-view-'+k)==='grid'?'grid':'list',sel:'',page:1}]));
 const expanded=new Set(read('ecco-library-hub-open',[]));
 let current='image',menu=false,newOpen=false,newParent='',toastTimer=null,renaming=null;

 /* ---------- data ---------- */
 const labelsReady=kind=>Boolean(storage().library_labels)||kind==='image'||kind==='audio';
 const removeReady=()=>Boolean(storage().library_labels);
 const folders=kind=>records().filter(r=>r.kind===KINDS[kind].folder&&!r.deleted).sort((a,b)=>(a.created||0)-(b.created||0)||a.id.localeCompare(b.id));
 const leaf=f=>f.name.split(' / ').at(-1);
 const parentOf=(f,list)=>{const name=f.name.split(' / ').slice(0,-1).join(' / ');return name?list.find(x=>x.name===name):null;};
 const path=f=>f.name.replaceAll(' / ',' › ');
 function scope(kind,f){const list=folders(kind);return new Set(list.filter(x=>x.id===f.id||x.name.startsWith(f.name+' / ')).map(x=>x.id));}
 function items(kind){
  const list=folders(kind),ids=new Set(list.map(f=>f.id)),byItem=new Map();
  for(const l of records().filter(r=>r.kind==='library_item'&&!r.deleted&&ids.has(r.folder_id))){if(!byItem.has(l.asset_id))byItem.set(l.asset_id,[]);byItem.get(l.asset_id).push(l.folder_id);}
  let out=[];
  if(kind==='image')out=records().filter(a=>a.kind==='asset'&&a.media==='image'&&!a.deleted).map(a=>({id:a.id,name:a.title&&(a.title!==a.prompt||a.settings?.model==='uploaded-image')?a.title:'Generated image',raw:a.title??'',type:extension(a.path)||'IMG',created:a.created,asset:a,cloud:true}));
  else if(kind==='audio')out=records().filter(a=>a.kind==='asset'&&a.media==='audio'&&!a.deleted).map(a=>({id:a.id,name:a.title||a.prompt||'Audio',raw:a.title??'',type:extension(a.path)||'AUDIO',created:a.created,asset:a,cloud:true}));
  else if(kind==='video')out=(window.EccoVideoLibrary?.assets()||[]).map(a=>({id:a.id,name:a.title||a.prompt||'Video',raw:a.title??'',type:extension(a.path)||'VIDEO',created:a.created,asset:a,cloud:true}));
  else if(kind==='story'){
   if(!state.storage_pending)out=stories().filter(s=>!s.deleted).map(s=>({id:s.id,name:s.title||'Untitled story',raw:s.title??'',type:'Story',created:s.created,cloud:true}));
   const drafts=window.EccoWorkspaceUI?.localStoryDrafts?.()||[];
   out=out.concat(drafts.map(d=>({id:d.id,name:d.title||'Untitled draft',raw:d.title??'',type:'Draft',created:d.updated||d.created||0,local:true})));
  }else if(kind==='workflow'){
   out=(window.EccoWorkflows?.rows?.()||[]).map(w=>{const cloud=records().some(r=>r.id===w.id&&r.kind==='workflow');return {id:w.id,name:w.name||'Untitled workflow',raw:w.name??'',type:w.workflow_type==='audio'?'Audio':'Workflow',created:w.created||w.updated||0,cloud,local:!cloud};});
  }
  for(const it of out){it.labels=byItem.get(it.id)||[];it.kind=kind;}
  return out;
 }
 const hook=(kind,it)=>kind==='story'?(it.local?' data-local-story-id="'+esc(it.id)+'"':' data-story-id="'+esc(it.id)+'"'):kind==='workflow'?' data-workflow-id="'+esc(it.id)+'"':' data-asset-id="'+esc(it.id)+'"';
 function visible(kind){
  const s=ui[kind],all=items(kind),list=folders(kind);
  let out=all;
  for(const id of s.filters){const f=list.find(x=>x.id===id);if(!f)continue;const ok=scope(kind,f);out=out.filter(it=>it.labels.some(l=>ok.has(l)));}
  if(s.type!=='all')out=out.filter(it=>it.type===s.type);
  const text=s.q.trim().toLowerCase();if(text)out=out.filter(it=>it.name.toLowerCase().includes(text));
  out=out.slice().sort((a,b)=>s.sort==='old'?(a.created||0)-(b.created||0):s.sort==='name'?a.name.localeCompare(b.name):s.sort==='namedesc'?b.name.localeCompare(a.name):(b.created||0)-(a.created||0));
  return {all,out,list};
 }
 const labelText=(it,list)=>{const names=it.labels.map(id=>list.find(f=>f.id===id)).filter(Boolean).map(leaf);return names.length?names.join(' · '):'No labels';};
 function count(kind,f,all,list){const ok=scope(kind,f);return all.filter(it=>it.labels.some(l=>ok.has(l))).length;}

 /* ---------- feedback ---------- */
 function toast(message){
  let t=q('.lh-toast');if(!t){t=document.createElement('div');t.className='lh-toast';t.setAttribute('role','status');document.body.append(t);}
  t.textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.remove(),2800);
 }
 const fail=error=>{try{notice(error?.message||String(error),true);}catch{toast(error?.message||'Something went wrong.');}};
 async function guard(work){try{await work();}catch(error){fail(error);}}

 /* ---------- actions ---------- */
 async function reload(){await refresh();lastSignature='';sync();}
 async function assign(kind,item,folderId){
  if(kind==='image')await api('library/save',{asset_id:item.id,folder_id:folderId});
  else if(kind==='audio')await api('audio/labels',{asset_id:item.id,folder_ids:[folderId],title:item.name});
  else await api('library/labels/assign',{library:kind,item_id:item.id,folder_ids:[folderId]});
 }
 async function createLabel(kind,name,parent){
  const clean=name.trim();
  if(!clean||clean.includes('/')||[parent,clean].filter(Boolean).join(' / ').length>80)throw Error('Enter a label name without slashes, up to 80 characters including its parent.');
  const full=[parent,clean].filter(Boolean).join(' / ');
  const made=kind==='image'?await api('library/folders',{name:full}):kind==='audio'?await api('audio/folders',{name:full}):await api('library/labels/create',{library:kind,name:full});
  if(made.deleted)throw Error('This label is in Trash. Restore it or choose another name.');
  return made;
 }
 async function renameItem(item,name){
  const clean=name.trim();if(!clean||clean===item.raw)return;
  if(!storage().rename_available)throw Error('Renaming saved items requires the storage service update. Your existing name is unchanged.');
  await api('library/rename',{id:item.id,name:clean,expected_name:item.raw});
  await reload();toast('Name saved');
 }
 async function removeItem(kind,item){
  if(KINDS[kind].asset)await api('trash',{asset_id:item.id,restore:false});
  else if(kind==='story'){if(item.local){window.EccoWorkspaceUI.deleteLocalStory(item.id);return;}await window.EccoWorkspaceUI.deleteStory(item.id);return;}
  else if(kind==='workflow'){await window.EccoWorkflows.remove(item.id);return;}
  await reload();toast('Moved to Trash. You can restore it.');
 }
 function primary(kind,item){
  if(kind==='image')return lightbox(item);
  if(kind==='story'){if(item.local){document.body.classList.remove('workspace-entry-mode');window.EccoWorkspaceUI.openLocalStory(item.id);return;}return window.EccoWorkspaceUI.openStory(item.id);}
  if(kind==='workflow')return window.EccoWorkflows.show(item.id);
  if(kind==='video'){
   const v=item.asset;persistDraft();activeStory=v.story_id||LEGACY_STORY;localStorage.setItem('ecco-active-story',activeStory);draft=loadDraft();lastSignature='';storyControls();navigate('publish');
   const select=q('#publish-form [name="asset_id"]');if(select){select.value=v.id;select.dispatchEvent(new Event('change'));}
  }
 }
 const primaryLabel={image:'Open full size',story:'Open story',workflow:'Open workflow',video:'Publish video'};
 // Full-size viewer with back and forward arrows (owner request, 10 November 2026). The order is the
 // Library grid's current order, filters and search; Left and Right arrow keys step too.
 const ARROW={prev:'M15 5l-7 7 7 7',next:'M9 5l7 7-7 7'};
 function arrow(dir,label,disabled){
  return '<button type="button" class="lh-viewer-step" data-step="'+dir+'" aria-label="'+label+'"'+(disabled?' disabled':'')+'><svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+ARROW[dir]+'"/></svg></button>';
 }
 /* Preloading (owner request, 11 November 2026): the media loader asks for this list once it has nothing on screen
    left to load, so likely-next pictures are ready before they are needed. From the moment Studio opens: the first
    page of Images and Video (their small thumbnails). While browsing a library: its next and previous pages. In the
    full-size view: the next and previous pictures. Thumbnails only when storage offers them; never whole libraries. */
 let viewerNeighbours=[],warmMemo={key:'',list:[]};
 function warmList(){
  if(typeof state==='undefined'||!state||state.storage_pending)return [];
  const inLibrary=Boolean(PAGE_KIND[page])&&(current==='image'||current==='video');
  const key=JSON.stringify([state.records.length,state.cursor??null,inLibrary&&current,['image','video'].map(k=>[ui[k].filters,ui[k].q,ui[k].type,ui[k].sort,ui[k].page]),viewerNeighbours]);
  if(key===warmMemo.key)return warmMemo.list;
  const list=viewerNeighbours.map(id=>({id,type:'media'}));
  if(inLibrary){const out=visible(current).out,n=ui[current].page||1;for(const p of [n+1,n-1])if(p>=1)for(const it of out.slice((p-1)*PAGE_SIZE,p*PAGE_SIZE))list.push({id:it.id,type:'thumb'});}
  for(const k of ['image','video'])for(const it of visible(k).out.slice(0,PAGE_SIZE))list.push({id:it.id,type:'thumb'});
  warmMemo={key,list};return list;
 }
 function lightbox(item){
  let d=q('#library-hub-viewer');if(!d){d=document.createElement('dialog');d.id='library-hub-viewer';d.className='lh-viewer';document.body.append(d);}
  const list=visible('image').out.slice(),ids=list.map(it=>it.id);let index=Math.max(0,ids.indexOf(item.id));if(!ids.includes(item.id)){list.unshift(item);ids.unshift(item.id);index=0;}
  const show=i=>{
   index=i;const it=list[index],first=index===0,last=index===list.length-1;d.dataset.current=it.id;viewerNeighbours=[list[index+1]?.id,list[index-1]?.id].filter(Boolean);
   const head=d.querySelector('.lh-viewer-head');
   const title='<strong>'+esc(it.name)+'</strong>'+(list.length>1?'<span class="help lh-viewer-count" aria-live="polite">'+(index+1)+' of '+list.length+'</span>':'');
   if(head){head.querySelector('.lh-viewer-title').innerHTML=title;}
   const body='<img data-asset="'+esc(it.id)+'" alt="'+esc(it.name)+'" src="'+esc(media(it.asset))+'">';
   if(!head)d.innerHTML='<div class="lh-viewer-head"><div class="lh-viewer-title">'+title+'</div></div><div class="lh-viewer-body">'+(list.length>1?arrow('prev','Previous image',first):'')+'<div class="lh-viewer-frame">'+body+'</div>'+(list.length>1?arrow('next','Next image',last):'')+'</div>';
   else d.querySelector('.lh-viewer-frame').innerHTML=body;
   const prev=d.querySelector('[data-step=prev]'),next=d.querySelector('[data-step=next]');
   if(prev){prev.disabled=first;prev.onclick=()=>{if(index>0)show(index-1);};}
   if(next){next.disabled=last;next.onclick=()=>{if(index<list.length-1)show(index+1);};}
   const focused=document.activeElement;if(focused?.disabled)(first?next:prev)?.focus();
   hydrate();
  };
  d.innerHTML='';show(index);
  d.onkeydown=e=>{if(e.target.closest('input,select,textarea'))return;if(e.key==='ArrowLeft'&&index>0){e.preventDefault();show(index-1);}else if(e.key==='ArrowRight'&&index<list.length-1){e.preventDefault();show(index+1);}};
  d.onclose=()=>{viewerNeighbours=[];const last=d.dataset.current||item.id,n=pageOf('image',last);if(n&&n!==ui.image.page&&current==='image'){ui.image.page=n;results();}const opener=q('.lh [data-pick="'+cssq(last)+'"]')||q('.lh [data-pick="'+cssq(item.id)+'"]');opener?.focus();};
  d.showModal();
 }
 function renameLabelDialog(kind,folder){
  const d=document.createElement('dialog');d.className='lh-dialog';
  d.innerHTML='<form class="form"><h2>Rename label</h2><label>Label name<input name="name" required maxlength="80" autocomplete="off"></label><p role="alert"></p><div class="row"><button type="submit">Save</button><button type="button" class="secondary" data-cancel>Cancel</button></div></form>';
  const input=d.querySelector('input'),form=d.querySelector('form'),alert=d.querySelector('[role=alert]');input.value=leaf(folder);
  d.querySelector('[data-cancel]').onclick=()=>d.close();d.onclose=()=>d.remove();
  form.onsubmit=async e=>{e.preventDefault();const name=input.value.trim();if(!name||name.includes('/')){alert.textContent='Enter a name without slashes.';return;}
   try{if(!storage().rename_available)throw Error('Renaming saved items requires the storage service update. Your existing name is unchanged.');
    await api('library/rename',{id:folder.id,name,expected_name:folder.name});await reload();d.close();toast('Label renamed');}catch(err){alert.textContent=err.message||'Could not rename. Try again.';}};
  document.body.append(d);d.showModal();input.focus();input.select();
 }

 /* ---------- rendering: page ---------- */
 const sel=(kind)=>{const s=ui[kind];return items(kind).find(i=>i.id===s.sel);};
 const icon=(d,size=40)=>'<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="'+d+'"/></svg>';
 // Library at scale (10 November 2026): tiles show small thumbnails, never full files. Pictures use the storage
 // service's thumbnail; videos its poster frame (an icon until then, or if none). Audio, stories and workflows keep
 // their icon, so no file downloads for a tile. A tile shimmers until its thumbnail arrives.
 const thumbs=it=>typeof thumbURL==='function'?thumbURL(it.asset):media(it.asset);
 const posters=()=>Boolean(storage().video_thumbnails);
 function loading(kind,it){return (kind==='image'||(kind==='video'&&posters()))&&!thumbs(it)?' media-loading':'';}
 function thumb(kind,it,size){
  if(kind==='image')return '<img data-thumb="'+esc(it.id)+'" alt="" src="'+esc(thumbs(it))+'">';
  // Until the storage service offers poster frames, keep the earlier frame preview from the video itself.
  if(kind==='video')return posters()?icon(ICON.video,size)+'<img class="lh-poster" data-thumb="'+esc(it.id)+'" alt="" src="'+esc(thumbs(it))+'">':'<video data-asset="'+esc(it.id)+'" muted preload="metadata" playsinline tabindex="-1" aria-hidden="true" src="'+esc(media(it.asset))+'"></video>';
  return icon(ICON[kind],size);
 }
 /* Pages (owner-approved mock-up, 10 November 2026): 60 items a page in every library, the same page bar
    everywhere, back and forth by Previous/Next, page numbers or a typed page. */
 const PAGE_SIZE=60;
 const fmt=n=>Number(n).toLocaleString('en-US');
 function pageInfo(kind,count){const s=ui[kind],pages=Math.max(1,Math.ceil(count/PAGE_SIZE));s.page=Math.min(Math.max(1,s.page||1),pages);return {page:s.page,pages,start:(s.page-1)*PAGE_SIZE,end:Math.min(count,s.page*PAGE_SIZE)};}
 function pageOf(kind,id){const i=visible(kind).out.findIndex(it=>it.id===id);return i<0?null:Math.floor(i/PAGE_SIZE)+1;}
 function pager(kind,count,p){
  if(count<=PAGE_SIZE)return '';
  const nums=[...new Set([1,p.page-2,p.page-1,p.page,p.page+1,p.page+2,p.pages])].filter(n=>n>=1&&n<=p.pages).sort((a,b)=>a-b);
  let last=0,links='';
  for(const n of nums){if(n-last>1)links+='<span class="lh-pager-gap" aria-hidden="true">…</span>';links+=n===p.page?'<button type="button" class="lh-page-num" aria-current="page" aria-label="Page '+fmt(n)+', current">'+fmt(n)+'</button>':'<button type="button" class="lh-page-num" data-act="page-go" data-page="'+n+'" aria-label="Page '+fmt(n)+'">'+fmt(n)+'</button>';last=n;}
  const arrow=d=>'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+(d==='prev'?'M15 5l-7 7 7 7':'M9 5l7 7-7 7')+'"/></svg>';
  return '<nav class="lh-pager" aria-label="'+esc(KINDS[kind].title)+' pages"><span class="lh-pager-status" role="status" aria-live="polite">Showing '+fmt(p.start+1)+'–'+fmt(p.end)+' of '+fmt(count)+'</span>'
   +'<button type="button" class="lh-page-step" data-act="page-prev" aria-label="Previous page"'+(p.page===1?' disabled':'')+'>'+arrow('prev')+'Previous</button>'+links
   +'<button type="button" class="lh-page-step" data-act="page-next" aria-label="Next page"'+(p.page===p.pages?' disabled':'')+'>Next'+arrow('next')+'</button>'
   +'<span class="lh-pager-jump"><label for="lh-page-input">Page</label><input id="lh-page-input" type="number" inputmode="numeric" min="1" max="'+p.pages+'" value="'+p.page+'"><button type="button" class="secondary" data-act="page-jump">Go</button><span class="lh-muted">of '+fmt(p.pages)+'</span></span></nav>';
 }
 function pagerBottom(kind,count,p){
  if(count<=PAGE_SIZE)return '';
  return '<nav class="lh-pager lh-pager-bottom" aria-label="'+esc(KINDS[kind].title)+' pages, bottom"><button type="button" class="lh-page-step" data-act="page-prev"'+(p.page===1?' disabled':'')+'>Previous</button><span>Page '+fmt(p.page)+' of '+fmt(p.pages)+'</span><button type="button" class="lh-page-step" data-act="page-next"'+(p.page===p.pages?' disabled':'')+'>Next</button></nav>';
 }
 function goPage(kind,n,focus){
  const s=ui[kind],{out}=visible(kind),pages=Math.max(1,Math.ceil(out.length/PAGE_SIZE));
  s.page=Math.min(Math.max(1,Math.round(Number(n))||1),pages);results();
  const root=q('#page .lh');if(!root)return;
  root.querySelector('.lh-results')?.scrollIntoView({block:'start',behavior:'instant'});
  (root.querySelector(focus==='next'?'.lh-pager [data-act=page-next]:not(:disabled)':focus==='prev'?'.lh-pager [data-act=page-prev]:not(:disabled)':'.lh-pager [aria-current=page]')||root.querySelector('.lh-pager [aria-current=page]'))?.focus();
 }
 function shell(kind){
  const K=KINDS[kind],s=ui[kind],{all}=visible(kind),types=[...new Set(all.map(i=>i.type))].sort();
  if(s.type!=='all'&&!types.includes(s.type))s.type='all';
  q('#page').innerHTML='<div class="lh" data-kind="'+kind+'">'
   +'<div class="lh-top"><nav class="lh-crumb" aria-label="Breadcrumb"></nav><button type="button" class="lh-primary" data-act="upload">'+esc(K.upload)+'</button></div>'
   +'<div class="lh-head"><h2 class="lh-title"></h2><div class="lh-meta"><span class="lh-count" role="status"></span><span class="lh-label-tools"></span></div></div>'
   +'<div class="lh-tools"><label class="sr" for="lh-search">Search '+esc(K.plural)+'</label><input id="lh-search" type="search" placeholder="Search '+esc(K.plural)+'" value="'+esc(s.q)+'">'
   +'<label class="sr" for="lh-type">Type</label><select id="lh-type"><option value="all">All types</option>'+types.map(t=>'<option value="'+esc(t)+'"'+(t===s.type?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select>'
   +'<label class="sr" for="lh-sort">Sort by</label><select id="lh-sort"><option value="new"'+(s.sort==='new'?' selected':'')+'>Newest first</option><option value="old"'+(s.sort==='old'?' selected':'')+'>Oldest first</option><option value="name"'+(s.sort==='name'?' selected':'')+'>Name A to Z</option><option value="namedesc"'+(s.sort==='namedesc'?' selected':'')+'>Name Z to A</option></select>'
   +'<div class="lh-seg" role="group" aria-label="View"><button type="button" data-act="view" data-view="grid">Grid</button><button type="button" data-act="view" data-view="list">List</button></div></div>'
   +'<div class="lh-chips" hidden></div>'
   +'<div class="lh-body"><div class="lh-results"></div><aside class="lh-details" aria-label="Details" hidden></aside></div></div>';
 }
 function results(){
  const kind=current,K=KINDS[kind],s=ui[kind],root=q('#page .lh');if(!root||root.dataset.kind!==kind)return;
  const {all,out,list}=visible(kind);
  const filters=s.filters.map(id=>list.find(f=>f.id===id)).filter(Boolean);
  s.filters=filters.map(f=>f.id);
  const title=filters.length?filters.map(leaf).join(' + '):'All '+K.plural;
  root.querySelector('.lh-title').textContent=title;
  const crumb=root.querySelector('.lh-crumb');crumb.hidden=!filters.length;
  crumb.innerHTML='<button type="button" data-act="clear" class="'+(filters.length?'link':'now')+'"'+(filters.length?'':' aria-current="page"')+'>'+esc(K.title)+'</button>'+(filters.length?'<span aria-hidden="true">›</span><span class="now">'+esc(filters.length===1?path(filters[0]):filters.map(leaf).join(' + '))+'</span>':'');
  root.querySelector('.lh-count').textContent=state.storage_pending&&K.asset?'Connect your saved workspace from Account → Storage.':out.length+' '+(out.length===1?K.singular:K.plural);
  const tools=root.querySelector('.lh-label-tools');
  tools.innerHTML=filters.length===1&&labelsReady(kind)?'<button type="button" class="link" data-act="rename-label">Rename label</button><button type="button" class="link" data-act="delete-label">Delete label</button>':'';
  const chips=root.querySelector('.lh-chips');chips.hidden=!filters.length;
  chips.innerHTML=filters.length?'<span class="lh-muted">Items with all of:</span>'+filters.map(f=>'<span class="lh-chip on">'+esc(leaf(f))+'<button type="button" data-act="chip-x" data-id="'+esc(f.id)+'" aria-label="Remove filter '+esc(path(f))+'">×</button></span>').join('')+'<button type="button" class="link" data-act="clear">Clear all</button>':'';
  root.querySelectorAll('[data-act=view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===s.view)));
  const box=root.querySelector('.lh-results'),p=pageInfo(kind,out.length),shown=out.slice(p.start,p.end);
  if(!out.length){
   const searching=Boolean(s.q.trim()||s.type!=='all'||filters.length);
   box.innerHTML='<div class="lh-empty"><p>'+(searching?'Nothing matches your search and filters.':'Nothing here yet.')+'</p>'+(searching?'<button type="button" class="secondary" data-act="reset">Reset search and filters</button>':'')+'</div>';
  }else if(s.view==='grid'){
   box.innerHTML=pager(kind,out.length,p)+'<div class="lh-grid">'+shown.map(it=>'<button type="button" class="lh-card" data-act="pick"'+hook(kind,it)+' data-pick="'+esc(it.id)+'" aria-pressed="'+(s.sel===it.id)+'"><span class="lh-thumb'+loading(kind,it)+'" style="background:'+hue(it.id)+'">'+thumb(kind,it,40)+'</span>'+(s.sel===it.id?'<span class="lh-tick" aria-hidden="true">✓</span>':'')+'<span class="lh-card-text"><span class="lh-name">'+esc(it.name)+'</span><span class="lh-sub">'+esc(it.type+(it.created?' · '+stamp(it.created).split(', ').slice(0,2).join(', '):''))+'</span><span class="lh-lab">'+esc(labelText(it,list))+'</span></span></button>').join('')
    +'<button type="button" class="lh-add" data-act="add-card"><span>'+esc(K.add)+'</span><small>'+(kind==='story'?'Import a story you already wrote':K.asset?'Browse for files':'Start a new one')+'</small></button></div>'+pagerBottom(kind,out.length,p);
  }else{
   box.innerHTML=pager(kind,out.length,p)+'<div class="lh-list" role="table" aria-label="'+esc(K.title)+'"><div class="lh-row lh-headrow" role="row"><span role="columnheader">Name</span><span role="columnheader">Labels</span><span role="columnheader">Type</span><span role="columnheader">Created</span></div>'
    +shown.map(it=>'<button type="button" class="lh-row" role="row" data-act="pick"'+hook(kind,it)+' data-pick="'+esc(it.id)+'" aria-pressed="'+(s.sel===it.id)+'"><span class="lh-rowname"><span class="lh-mini'+loading(kind,it)+'" style="background:'+hue(it.id)+'">'+thumb(kind,it,16)+'</span><span class="lh-name">'+esc(it.name)+'</span></span><span class="lh-lab">'+esc(labelText(it,list))+'</span><span>'+esc(it.type)+'</span><span>'+esc(stamp(it.created))+'</span></button>').join('')+'</div>'+pagerBottom(kind,out.length,p);
  }
  details(kind,list);
  if(K.asset)hydrate();
 }
 function details(kind,list){
  const root=q('#page .lh'),aside=root.querySelector('.lh-details'),K=KINDS[kind],item=sel(kind);
  if(!item){aside.hidden=true;aside.innerHTML='';return;}
  aside.hidden=false;
  const can=item.cloud&&labelsReady(kind),own=item.labels.map(id=>list.find(f=>f.id===id)).filter(Boolean);
  let preview;
  if(kind==='image')preview='<img data-asset="'+esc(item.id)+'" alt="'+esc(item.name)+'" src="'+esc(media(item.asset))+'">';
  else if(kind==='video')preview='<video data-asset="'+esc(item.id)+'" controls preload="metadata" src="'+esc(media(item.asset))+'"></video>';
  else if(kind==='audio')preview=icon(ICON.audio,52)+'<audio data-asset="'+esc(item.id)+'" controls preload="none" src="'+esc(media(item.asset))+'"></audio>';
  else preview=icon(ICON[kind],52);
  const rows=[];const walk=(p,d)=>{list.filter(f=>(parentOf(f,list)?.id||'')===p).forEach(f=>{rows.push({f,d});walk(f.id,d+1);});};walk('',0);
  aside.innerHTML='<div class="lh-dhead"><h3>Details</h3><button type="button" data-act="close-details" aria-label="Close details">×</button></div>'
   +'<div class="lh-preview" style="background:'+hue(item.id)+'">'+preview+'</div>'
   +'<div class="lh-field"><label for="lh-name">Name</label><input id="lh-name" type="text" maxlength="160" value="'+esc(item.raw||item.name)+'"'+(item.cloud?'':' readonly')+'>'+(item.cloud?'':'<small>Saved in this browser. Open it to save it to your workspace.</small>')+'</div>'
   +'<dl class="lh-facts"><div><dt>Type</dt><dd>'+esc(item.type)+'</dd></div><div><dt>Created</dt><dd>'+esc(stamp(item.created)||'—')+'</dd></div></dl>'
   +'<div class="lh-labels"><div class="lh-flabel">Labels</div><div class="lh-chips-row">'
   +own.map(f=>'<span class="lh-chip">'+esc(path(f))+(can&&removeReady()?'<button type="button" data-act="label-remove" data-id="'+esc(f.id)+'" aria-label="Remove label '+esc(path(f))+'">×</button>':'')+'</span>').join('')
   +(can?'<button type="button" class="lh-addlabel" data-act="label-menu" aria-expanded="'+menu+'">+ Add label</button>':'')
   +(!can&&!own.length?'<span class="lh-muted">'+(item.cloud?'Labels need the storage service update.':'Labels are available once it is saved.')+'</span>':'')
   +'</div>'
   +(can&&menu?'<div class="lh-menu" role="group" aria-label="Choose labels">'+(rows.length?rows.map(({f,d})=>{const on=item.labels.includes(f.id),locked=on&&!removeReady();return '<button type="button" aria-pressed="'+on+'" data-act="label-toggle" data-id="'+esc(f.id)+'"'+(locked?' disabled':'')+' style="padding-left:'+(10+d*18)+'px"><span class="lh-box" aria-hidden="true">'+(on?'✓':'')+'</span>'+esc(leaf(f))+'</button>';}).join(''):'<p class="lh-muted">Create your first label in the sidebar.</p>')+'</div>':'')
   +'</div>'
   +'<div class="lh-actions">'+(primaryLabel[kind]?'<button type="button" class="lh-primary" data-act="primary">'+esc(primaryLabel[kind])+'</button>':'')
   +(K.asset?'<a class="lh-btn" data-asset="'+esc(item.id)+'" href="'+esc(media(item.asset))+'" download="'+esc((item.name||'download')+(item.type&&item.type.length<=5&&/^[A-Z0-9]+$/.test(item.type)?'.'+item.type.toLowerCase():''))+'">Download</a>':'')
   +'<button type="button" class="lh-danger" data-act="delete">Delete '+esc(K.singular)+'</button></div>';
 }
 function hydrate(){if(typeof hydrateMedia==='function')hydrateMedia();}

 /* ---------- rendering: sidebar ---------- */
 function ensureNav(){
  const host=q('#workspace-library-group>.workspace-library-content');if(!host)return null;
  let nav=q('#library-hub-nav');if(!nav){nav=document.createElement('div');nav.id='library-hub-nav';host.prepend(nav);bindNav(nav);}
  else if(nav.parentElement!==host)host.prepend(nav);
  return nav;
 }
 function renderNav(){
  const nav=ensureNav();if(!nav||typeof state==='undefined'||!state)return;
  const onPage=Boolean(PAGE_KIND[page]),s=ui[current],list=folders(current),all=items(current);
  const rows=[];const walk=(p,d)=>{list.filter(f=>(parentOf(f,list)?.id||'')===p).forEach(f=>{rows.push({f,d});if(expanded.has(f.id))walk(f.id,d+1);});};walk('',0);
  const hasKids=f=>list.some(x=>x.name.startsWith(f.name+' / ')&&x.name.split(' / ').length===f.name.split(' / ').length+1);
  const topLevel=list.filter(f=>!f.name.includes(' / '));
  const html='<nav aria-label="Libraries" class="lh-libs">'+ORDER.map(k=>'<button type="button" data-lib="'+k+'" aria-current="'+(onPage&&k===current?'page':'false')+'"><span>'+esc(KINDS[k].title)+'</span><small>'+items(k).length+'</small></button>').join('')+'</nav>'
   +'<nav aria-label="Labels" class="lh-tree"><div class="lh-treehead">Labels</div>'
   +'<button type="button" class="lh-node" data-act="nav-all" aria-pressed="'+(onPage&&!s.filters.length)+'"><span class="lh-node-text"><span>All '+esc(KINDS[current].plural)+'</span></span><small>'+all.length+'</small></button>'
   +rows.map(({f,d})=>{const open=expanded.has(f.id),kids=hasKids(f),on=s.filters.includes(f.id);
     return '<div class="lh-trow" style="padding-left:'+(d*16)+'px">'+(kids?'<button type="button" class="lh-toggle" data-act="nav-toggle" data-id="'+esc(f.id)+'" aria-expanded="'+open+'" aria-label="'+(open?'Collapse ':'Expand ')+esc(path(f))+'"><span aria-hidden="true">'+(open?'−':'+')+'</span></button>':'<span class="lh-spacer"></span>')
      +'<button type="button" class="lh-node" data-act="nav-label" data-id="'+esc(f.id)+'" aria-pressed="'+on+'" title="'+esc(path(f))+'"><span class="lh-node-text"><span>'+esc(leaf(f))+'</span></span><small>'+count(current,f,all,list)+'</small></button></div>';}).join('')
   +(labelsReady(current)?(newOpen?'<form class="lh-new" data-form="new-label"><label for="lh-new-name">Label name</label><input id="lh-new-name" type="text" maxlength="80" autocomplete="off" placeholder="e.g. Villains"><label for="lh-new-parent">Inside</label><select id="lh-new-parent"><option value="">Top level</option>'+topLevel.map(f=>'<option value="'+esc(f.name)+'"'+(f.name===newParent?' selected':'')+'>'+esc(f.name)+'</option>').join('')+'</select><button type="button" class="link" data-act="new-cancel">Cancel</button></form>':'<button type="button" class="lh-newbtn" data-act="new-open">+ New label</button>'):'<p class="lh-muted lh-pad">Labels for '+esc(KINDS[current].plural)+' need the storage service update.</p>')
   +'</nav>';
  const key=html;if(nav.dataset.key===key)return;nav.dataset.key=key;
  const active=document.activeElement,focusId=nav.contains(active)?(active.id||''):'';
  nav.innerHTML=html;
  if(focusId){q('#'+focusId)?.focus();}
 }
 function bindNav(nav){
  nav.addEventListener('click',event=>{
   const lib=event.target.closest('[data-lib]');
   if(lib){const kind=lib.dataset.lib;navigate(KINDS[kind].page);return;}
   const b=event.target.closest('[data-act]');if(!b)return;
   const act=b.dataset.act;
   if(act==='nav-all'){ui[current].filters=[];ui[current].sel='';ui[current].page=1;if(!PAGE_KIND[page])navigate(KINDS[current].page);else{results();renderNav();}}
   else if(act==='nav-label'){const s=ui[current];s.filters=s.filters.includes(b.dataset.id)?s.filters.filter(x=>x!==b.dataset.id):s.filters.concat([b.dataset.id]);s.sel='';s.page=1;if(!PAGE_KIND[page])navigate(KINDS[current].page);else{results();renderNav();}}
   else if(act==='nav-toggle'){const id=b.dataset.id;expanded.has(id)?expanded.delete(id):expanded.add(id);localStorage.setItem('ecco-library-hub-open',JSON.stringify([...expanded]));renderNav();}
   else if(act==='new-open'){newOpen=true;newParent=ui[current].filters.length===1?(folders(current).find(f=>f.id===ui[current].filters[0])?.name||''):'';renderNav();q('#lh-new-name')?.focus();}
   else if(act==='new-cancel'){newOpen=false;renderNav();}
  });
  nav.addEventListener('submit',event=>{
   const form=event.target.closest('[data-form=new-label]');if(!form)return;event.preventDefault();
   const name=form.querySelector('#lh-new-name').value,parent=form.querySelector('#lh-new-parent').value;
   if(!name.trim()){newOpen=false;renderNav();return;}
   guard(async()=>{const made=await createLabel(current,name,parent);await reload();newOpen=false;for(const p of folders(current))if(made.name.startsWith(p.name+' / '))expanded.add(p.id);localStorage.setItem('ecco-library-hub-open',JSON.stringify([...expanded]));toast('Label "'+made.name.split(' / ').at(-1)+'" created');renderNav();if(PAGE_KIND[page])results();});
  });
  nav.addEventListener('change',event=>{if(event.target.id==='lh-new-parent')newParent=event.target.value;});
 }

 /* ---------- page events ---------- */
 document.addEventListener('click',event=>{
  const root=event.target.closest('#page .lh');if(!root)return;
  const b=event.target.closest('[data-act]');if(!b)return;
  const kind=root.dataset.kind,s=ui[kind],act=b.dataset.act;
  if(act==='pick'){s.sel=s.sel===b.dataset.pick?'':b.dataset.pick;menu=false;results();root.querySelector('[data-pick="'+cssq(b.dataset.pick)+'"]')?.focus();}
  else if(act==='view'){s.view=b.dataset.view;localStorage.setItem('ecco-library-view-'+kind,s.view);results();}
  else if(act==='clear'){s.filters=[];s.sel='';s.page=1;results();renderNav();}
  else if(act==='chip-x'){s.filters=s.filters.filter(x=>x!==b.dataset.id);s.sel='';s.page=1;results();renderNav();}
  else if(act==='page-prev')goPage(kind,(s.page||1)-1,'prev');
  else if(act==='page-next')goPage(kind,(s.page||1)+1,'next');
  else if(act==='page-go')goPage(kind,b.dataset.page);
  else if(act==='page-jump'){const input=root.querySelector('#lh-page-input');if(input)goPage(kind,input.value);}
  else if(act==='reset'){s.filters=[];s.q='';s.type='all';s.sel='';s.page=1;shell(kind);results();renderNav();}
  else if(act==='close-details'){s.sel='';menu=false;results();}
  else if(act==='label-menu'){menu=!menu;results();}
  else if(act==='label-toggle'){const item=sel(kind);if(!item)return;const id=b.dataset.id,has=item.labels.includes(id);
   guard(async()=>{if(has)await api('library/labels/remove',{library:kind,item_id:item.id,folder_id:id});else await assign(kind,item,id);await reload();toast(has?'Label removed':'Label added');});}
  else if(act==='label-remove'){const item=sel(kind);if(!item)return;
   guard(async()=>{await api('library/labels/remove',{library:kind,item_id:item.id,folder_id:b.dataset.id});await reload();toast('Label removed');});}
  else if(act==='primary'){const item=sel(kind);if(item)guard(()=>primary(kind,item));}
  else if(act==='delete'){const item=sel(kind);if(item){s.sel='';menu=false;guard(()=>removeItem(kind,item));}}
  else if(act==='rename-label'){const f=folders(kind).find(x=>x.id===s.filters[0]);if(f)renameLabelDialog(kind,f);}
  else if(act==='delete-label'){const f=folders(kind).find(x=>x.id===s.filters[0]);if(f)guard(async()=>{await api('trash/folder',{id:f.id});s.filters=[];await reload();toast('Label moved to Trash. You can restore it.');});}
  else if(act==='upload')guard(()=>upload(kind));
  else if(act==='add-card')guard(()=>kind==='story'?window.EccoWorkspaceUI.uploadStoryDialog():upload(kind));
 });
 document.addEventListener('input',event=>{
  if(event.target.id!=='lh-search')return;const root=event.target.closest('#page .lh');if(!root)return;ui[root.dataset.kind].q=event.target.value;ui[root.dataset.kind].page=1;results();
 });
 document.addEventListener('keydown',event=>{if(event.target.id!=='lh-page-input'||event.key!=='Enter')return;const root=event.target.closest('#page .lh');if(!root)return;event.preventDefault();goPage(root.dataset.kind,event.target.value);});
 document.addEventListener('change',event=>{
  const root=event.target.closest('#page .lh');if(!root)return;const kind=root.dataset.kind,s=ui[kind];
  if(event.target.id==='lh-type'){s.type=event.target.value;s.page=1;results();}
  else if(event.target.id==='lh-sort'){s.sort=event.target.value;s.page=1;results();}
  else if(event.target.id==='lh-name'){const item=sel(kind);if(item&&item.cloud)guard(()=>renameItem(item,event.target.value));}
 });
 function upload(kind){
  const inherit=async asset=>{
   const s=ui[kind],ids=s.filters.slice();await reload();
   const item=items(kind).find(i=>i.id===asset.id);
   if(item&&ids.length&&labelsReady(kind)){for(const id of ids){try{await assign(kind,item,id);}catch(error){fail(error);break;}}await reload();}
   s.sel=asset.id;s.page=pageOf(kind,asset.id)||s.page;results();renderNav();toast('Added to '+(ids.length?ids.map(id=>folders(kind).find(f=>f.id===id)).filter(Boolean).map(leaf).join(' + '):'All '+KINDS[kind].plural));
  };
  if(kind==='image')return window.EccoWorkspaceUI.uploadDialog(inherit);
  if(kind==='audio')return window.EccoAudioLibrary.upload(inherit);
  if(kind==='video')return window.EccoWorkspaceUI.uploadVideoDialog();
  if(kind==='story')return window.EccoWorkspaceUI.startNewStory();
  if(kind==='workflow')return window.EccoWorkflowStart?window.EccoWorkflowStart.show():window.EccoWorkflows.show();
 }

 /* ---------- entry points ---------- */
 function open(kind){
  if(!KINDS[kind])return;
  current=kind;const K=KINDS[kind];
  window.EccoStoryWorkspace?.leave?.();
  document.body.classList.remove('workspace-entry-mode');q('#workspace-entry')?.remove();
  notice('');page=K.page;q('#heading').textContent=K.heading;
  qa('nav button.active').forEach(b=>b.classList.remove('active'));
  ui[kind].sel='';menu=false;newOpen=false;
  shell(kind);results();renderNav();
 }
 const previousNavigate=navigate;
 navigate=function(target,...args){if(PAGE_KIND[target]&&target!=='story-library')return open(PAGE_KIND[target]);return previousNavigate.call(this,target,...args);};
 if(window.EccoWorkspaceUI)window.EccoWorkspaceUI.openLibrary=kind=>open(kind);
 let lastSignature='';
 function sync(){
  if(typeof state==='undefined'||!state)return;
  // With a change cursor (library at scale) the cursor alone says whether anything changed; no 250,000-item scan.
  const sig=Number.isFinite(state.cursor)?JSON.stringify([current,state.cursor,(window.EccoWorkflows?.rows?.()||[]).length,(window.EccoWorkspaceUI?.localStoryDrafts?.()||[]).length,state.storage_pending,Boolean(storage().library_labels)]):JSON.stringify([current,ORDER.map(k=>[folders(k).map(f=>[f.id,f.name]),items(k).map(i=>[i.id,i.name,i.labels])]),state.storage_pending,Boolean(storage().library_labels)]);
  renderNav();
  if(sig===lastSignature)return;lastSignature=sig;
  if(PAGE_KIND[page]&&current===PAGE_KIND[page]){const active=document.activeElement;if(active&&active.closest&&active.closest('#page .lh')&&['INPUT','SELECT'].includes(active.tagName))return;shell(current);results();}
 }
 const previousControls=storyControls;
 storyControls=function(...args){const result=previousControls.apply(this,args);sync();return result;};
 let queued=false;
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;if(!q('#library-hub-nav'))renderNav();});}).observe(document.body,{childList:true,subtree:true});
 window.EccoLibraryHub={open,sync,warmList,kinds:()=>ORDER.slice(),get current(){return current;}};
 renderNav();
})();
