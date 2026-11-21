'use strict';
/* Fresh start (owner decision, 20 Nov 2026): refreshing the page (browser reload) or signing off clears everything in every studio
   (stories, Story Picture, Image Studio, Voice Studio, audio and video drafts, Generation screens).
   Kept: sign-in (on refresh), storage connection, theme and settings, the libraries (saved stories are closed, not
   changed), and running or waiting jobs.
   Finished pictures not saved yet go to Image Library under "Draft" first, so nothing is lost.
   This file loads before every other script, so nothing reads a draft before it is cleared. */
(()=>{
 // What is cleared (prefix match): the open story and every unsaved draft, picture inputs, generation screens and
 // studio work in progress. Saved stories keep their own saved copy in Story Library and are simply closed.
 const CLEAR=['ecco-active-story','ecco-new-story-draft','ecco-board-new-draft','ecco-image-job:','ecco-video-job:','ecco-audio-job:',
  'ecco-generation-v1:','ecco-gen-fresh:','ecco-gen-log:','ecco-unsaved-images','ecco-voice-workspace','ecco-director-input','ecco-audio-scene-transfer',
  'ecco-workflow-drafts','ecco-story-page:','ecco-story-recovery:'];
 const PENDING='ecco-pending-drafts';
 const cleared=key=>key!=='ecco-unsaved-images:done'&&(CLEAR.some(k=>key===k||key.startsWith(k))||key==='ecco-audio-draft:');
 function list(store){const out=[];try{for(let i=0;i<store.length;i++)out.push(store.key(i));}catch{}return out;}
 function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
 function clear({signedOff=false}={}){
  // Unsaved finished pictures are remembered for the Draft save before their list is cleared.
  const unsaved=read('ecco-unsaved-images',[]),pending=read(PENDING,[]);
  try{localStorage.setItem(PENDING,JSON.stringify([...new Set([...pending,...unsaved])].slice(-400)));}catch{}
  for(const key of list(localStorage))if(key&&(cleared(key)||(signedOff&&key==='ecco-user-session')))try{localStorage.removeItem(key);}catch{}
  for(const key of list(sessionStorage))if(key&&key.startsWith('ecco-')&&(signedOff||key!=='ecco-user-session'))try{sessionStorage.removeItem(key);}catch{}
 }
 // Only a real refresh starts fresh (owner: "upon refresh or sign off"); opening Studio from a link or a new tab keeps
 // your open work.
 let reloaded=false;try{reloaded=performance.getEntriesByType('navigation')[0]?.type==='reload';}catch{}
 if(reloaded)clear();

 // ---- Draft label: save remembered pictures, and finished pictures of yours that were never saved (last 24 hours) ----
 let saving=false;
 async function saveDrafts(){
  if(saving||typeof api!=='function'||!window.EccoStorage?.ready||typeof state==='undefined'||!state?.records)return;
  saving=true;
  try{
   const records=state.records,me=window.EccoAuth?.user?.email||'',done=new Set(read('ecco-unsaved-images:done',[]));
   const labelled=new Set(records.filter(r=>r.kind==='library_item'&&!r.deleted).map(r=>r.asset_id));
   const live=id=>records.some(r=>r.id===id&&r.kind==='asset'&&r.media==='image'&&!r.deleted);
   const since=Date.now()/1000-24*3600,ids=new Set(read(PENDING,[]));
   if(me)for(const j of records)if(j.kind==='job'&&j.media==='image'&&j.owner===me&&j.status==='done'&&(j.created||0)>since)for(const id of [].concat(j.result||[]))if(typeof id==='string')ids.add(id);
   const todo=[...ids].filter(id=>live(id)&&!labelled.has(id)&&!done.has(id));
   if(!todo.length){localStorage.removeItem(PENDING);return;}
   let folder=records.find(r=>r.kind==='image_folder'&&!r.deleted&&r.name==='Draft');
   if(!folder){const made=await api('library/folders',{name:'Draft'});if(made?.deleted)return;folder=made;}
   for(const id of todo){try{await api('library/save',{asset_id:id,folder_id:folder.id});done.add(id);}catch{}}
   try{localStorage.setItem('ecco-unsaved-images:done',JSON.stringify([...done].slice(-400)));localStorage.removeItem(PENDING);}catch{}
   window.EccoConnectivityLog?.record?.(todo.length+' picture'+(todo.length>1?'s':'')+' saved to Image Library · Draft');
   if(typeof refresh==='function')refresh();
  }catch{}finally{saving=false;}
 }
 // Wait until storage and the records are loaded, then save once.
 let tries=0;const timer=setInterval(()=>{tries++;if(window.EccoStorage?.ready&&typeof state!=='undefined'&&state?.records?.length){clearInterval(timer);saveDrafts();}else if(tries>120)clearInterval(timer);},1000);

 // Sign off: remember unsaved pictures, clear everything (sign-in included) and start again from the beginning.
 async function signedOff(){
  const unsaved=read('ecco-unsaved-images',[]);
  try{localStorage.setItem(PENDING,JSON.stringify([...new Set([...read(PENDING,[]),...unsaved])]));}catch{}
  try{await saveDrafts();}catch{}
  clear({signedOff:true});
  setTimeout(()=>location.reload(),1500);
 }
 document.addEventListener('ecco:signed-out',()=>{void signedOff();});
 window.EccoFreshStart={clear,saveDrafts};
})();
