/* Non-destructive frame review. Source media is never overwritten. AI repairs require an explicit Generate action and a ready worker. */
(() => {
 'use strict';
 const M=window.EccoFrameModel, q=(s,r=document)=>r.querySelector(s);
 let opened=null, database;
 const db=()=>database||(database=new Promise((resolve,reject)=>{
  const request=indexedDB.open('ecco-frame-review',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 }));
 async function readDraft(key){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('drafts').objectStore('drafts').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async function writeDraft(key,value){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('drafts','readwrite');t.objectStore('drafts').put(value,key);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}
 const owner=()=>window.EccoAuth?.user?.sub||window.EccoAuth?.user?.email||'local';
 const currentStory=()=>typeof activeStory==='undefined'?'local':activeStory;
 const records=()=>typeof state==='undefined'?[]:state.records||[];
 const videoAssets=story=>records().filter(a=>a.kind==='asset'&&a.media==='video'&&!a.deleted&&(!story||a.story_id===story)).sort((a,b)=>(b.created||0)-(a.created||0));
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 function waitFor(video,event){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>finish(Error('Video decoding timed out. Try reopening this clip.')),15000);
  const done=()=>finish(),error=()=>finish(Error('This browser could not decode the video. Use a supported MP4.'));
  function finish(e){clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener('error',error);e?reject(e):resolve();}
  video.addEventListener(event,done,{once:true});video.addEventListener('error',error,{once:true});
 });}
 async function seek(video,time){if(Math.abs(video.currentTime-time)<.0001&&video.readyState>=2)return;const ready=waitFor(video,'seeked');video.currentTime=time;await ready;}
 async function load(video,url){const ready=waitFor(video,'loadeddata');video.src=url;video.load();await ready;}
 const time=n=>(Math.max(0,n-1)/M.FPS).toFixed(2)+'s';
 const blank='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#18152b"/><text x="160" y="95" text-anchor="middle" fill="#a9a2bd" font-family="sans-serif" font-size="14">Loading frame…</text></svg>');

 async function open(options={}){
  if(opened?.isConnected){if(!opened.open)opened.showModal();return;}
  const story=options.storyId||currentStory(),identity=owner(),origin=document.activeElement;
  const dialog=document.createElement('dialog');dialog.id='clip-frame-dialog';dialog.setAttribute('aria-label','Clips & Frames');opened=dialog;
  dialog.innerHTML=`
   <header class="cf-head"><div><div class="cf-eyebrow">VIDEO STUDIO / FRAME REVIEW</div><h2>Clips & Frames</h2><p class="cf-subtitle">Review a short segment. Pick the exact frames you want to change.</p></div><button type="button" class="secondary" data-cf-close aria-label="Close frame review">×</button></header>
   <div class="cf-sourcebar"><label>Source video<select data-cf-source><option value="">Choose a video from this story</option></select></label><button type="button" class="secondary" data-cf-upload>Open local video</button><input type="file" data-cf-file accept="video/mp4,video/webm,video/quicktime" hidden><label>Review segments<select data-cf-seconds><option value="3">3 seconds · 75 frames</option><option value="4">4 seconds · 100 frames</option></select></label></div>
   <div class="cf-empty" data-cf-empty><h3>Your video, one frame at a time</h3><p>Choose a library video or open an MP4. Source files stay intact.</p><p class="cf-muted">Cuts, replacements and undo history are saved in this browser.</p></div>
   <section data-cf-work hidden>
    <div class="cf-clipstrip" data-cf-clips role="group" aria-label="Review clips"></div>
    <div class="cf-main"><section aria-label="Frame inspector"><div class="cf-player"><video data-cf-player playsinline preload="auto"></video><img data-cf-replacement alt="Replacement frame" hidden><span class="cf-frame-tag" data-cf-frame-tag></span></div><div class="cf-player-actions"><button type="button" class="secondary" data-cf-prev aria-label="Previous frame">←</button><select data-cf-play-scope aria-label="Playback scope"><option value="entire">Play entire clip</option><option value="selected">Play selected frames</option></select><button type="button" data-cf-play>Play entire clip</button><button type="button" class="secondary" data-cf-next aria-label="Next frame">→</button><select data-cf-compare aria-label="Preview version"><option value="edited">Edited preview</option><option value="original">Original</option></select><span data-cf-position></span></div><p class="cf-muted" data-cf-play-note>Entire clip ignores the selection. Selected playback is a silent, exact-frame inspection preview.</p><p class="cf-muted" data-cf-continuity></p></section>
    <section class="cf-selection" aria-label="Selected frames"><div><h3>Cherry-pick frames</h3><div class="cf-selection-count" data-cf-count>0 selected</div></div><div class="cf-selection-list" data-cf-selected>Click any thumbnail to begin.</div><label>Original frame numbers<input data-cf-range placeholder="128, 132, 137–140" autocomplete="off"></label><div class="cf-actions"><button type="button" class="secondary" data-cf-select-range>Select these</button><button type="button" class="secondary" data-cf-clear>Clear</button></div><p data-cf-impact></p><div class="cf-actions"><button type="button" data-cf-remove disabled>Remove selected</button><button type="button" class="secondary" data-cf-restore disabled>Reinsert</button></div><div class="cf-actions"><button type="button" class="secondary" data-cf-undo disabled>Undo</button><button type="button" class="secondary" data-cf-redo disabled>Redo</button></div></section></div>
    <div class="cf-toolbar"><div><h3 data-cf-grid-title>Frames</h3><p class="cf-muted">Click to select · Shift-click for a range · Double-click to inspect</p></div><div class="cf-actions"><button type="button" class="secondary" data-cf-page-prev aria-label="Previous group of frames">←</button><select data-cf-page-size aria-label="Frames per group"><option value="25">25 frames</option><option value="50">50 frames</option><option value="100">100 frames</option></select><button type="button" class="secondary" data-cf-page-next aria-label="Next group of frames">→</button><button type="button" class="secondary" data-cf-select-page>Select group</button></div></div>
    <progress class="cf-progress" data-cf-progress max="1" value="0" aria-label="Loading frame thumbnails"></progress><div class="cf-grid" data-cf-grid role="group" aria-label="Frame thumbnails"></div><div class="cf-grid-help"><span class="cf-muted" data-cf-page-caption></span><span class="cf-muted">Original frame IDs stay fixed after edits.</span></div>
    <details class="cf-editor-details" data-cf-repair><summary>Repair or replace selected frames</summary><p class="cf-muted" data-cf-context></p><label>Correction<textarea data-cf-instructions maxlength="2000" placeholder="Keep the coconut tree rooted. Preserve Munni’s movement and the camera."></textarea></label><div class="cf-actions"><button type="button" data-cf-prepare>Repair selected frames</button><button type="button" class="secondary" data-cf-resume-repair hidden>Review repair</button><button type="button" class="secondary" data-cf-import>Replace one frame with an image</button><input type="file" data-cf-image accept="image/png,image/jpeg,image/webp" hidden><button type="button" class="secondary" data-cf-original>Restore original image</button></div><p class="cf-muted">Review the generated replacement before choosing Reinsert new frames. Only your selected frame IDs are replaced; context stays intact.</p></details>
    <details class="cf-editor-details"><summary>Clip ending & next clip</summary><p class="cf-muted" data-cf-ending-info></p><label>Ending direction<textarea data-cf-ending maxlength="1000" placeholder="End with Munni reaching the tree, ready to start climbing."></textarea></label><div class="cf-actions"><button type="button" class="secondary" data-cf-boundary>End this clip at the inspected frame</button><button type="button" class="secondary" data-cf-inspect-end>Inspect last frame</button><button type="button" class="secondary" data-cf-save-end>Save ending direction</button></div><p class="cf-muted">These are review boundaries and saved directions. Changing them does not regenerate the source video.</p></details>
   </section><footer class="cf-footer"><p role="status" aria-live="polite" data-cf-status>Ready to open a video.</p><div class="cf-actions"><button type="button" class="secondary" data-cf-save disabled>Save edit</button><button type="button" class="secondary" data-cf-plan disabled>Download edit plan</button><button type="button" data-cf-export disabled>Export edited MP4</button></div></footer>`;
  document.body.append(dialog);dialog.showModal();q('[data-cf-source]',dialog).focus();
  const $=s=>q('[data-cf-'+s+']',dialog),player=$('player'),decoder=document.createElement('video');decoder.muted=true;decoder.preload='auto';decoder.playsInline=true;
  let doc=null,source=null,key='',history=[],future=[],selected=new Set(),anchor=null,current=1,clipIndex=0,page=0,pageSize=25,token=0,sourceToken=0,closed=false,loading=false,playing=false,frameLoop=null,timer=null,saveChain=Promise.resolve(),decodeChain=Promise.resolve(),draftBlob=null,ownedURL=null,capabilities=null,pendingExport=null,repairDraft=null,playSerial=0,selectedPlaying=false;
  const thumbs=new Map();const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const painter=canvas.getContext('2d');
  function message(text){if(!closed)$('status').textContent=text;}
  function fail(error){message(error.message||String(error));}
  const clip=()=>M.clips(doc)[clipIndex];
  const snapshot=()=>JSON.parse(JSON.stringify(doc));
  const isCurrent=()=>!closed&&owner()===identity&&currentStory()===story;
  function assertCurrent(){if(!isCurrent())throw Error('Return to the original story and account before applying this edit.');}
  function payload(){return {source:{id:source.id,name:source.name,duration:source.duration,width:player.videoWidth,height:player.videoHeight},doc:snapshot(),history:history.slice(-30),future:future.slice(-30),blob:draftBlob,pendingExport,repairDraft};}
  function persist(){
   if(!doc||!key)return Promise.resolve();
   const saveKey=key,data=payload();
   saveChain=saveChain.catch(()=>{}).then(()=>writeDraft(saveKey,data));
   return saveChain;
  }
  async function save(){try{assertCurrent();await persist();message('Edit saved in this browser. The source video is unchanged.');}catch(e){fail(e);}}
  function commit(next,text){assertCurrent();history.push(snapshot());if(history.length>30)history.shift();future=[];doc=next;clipIndex=Math.min(clipIndex,doc.ends.length-1);selected.clear();pause();refreshSelection();drawClips();persist().catch(e=>message('Edit is in this tab but could not be saved: '+e.message));message(text);}
  function pause(){playSerial++;selectedPlaying=false;playing=false;player.pause();if(frameLoop!==null&&player.cancelVideoFrameCallback)player.cancelVideoFrameCallback(frameLoop);frameLoop=null;clearTimeout(timer);$('play').textContent=$('play-scope').value==='selected'?'Play selected frames':'Play entire clip';$('play').disabled=$('play-scope').value==='selected'&&!selected.size;}
  function frameTime(n){return Math.min((n-.5)/M.FPS,Math.max(0,source.duration-.001));}
  async function inspect(n){if(!doc)return;pause();current=Math.max(1,Math.min(doc.total,n));const c=clip();if(current<c.start||current>c.end){clipIndex=M.clips(doc).findIndex(c=>current>=c.start&&current<=c.end);page=Math.floor((current-clip().start)/pageSize);drawClips();drawGrid();}refreshInspector();try{await seek(player,frameTime(current));}catch(e){fail(e);}}
  function refreshInspector(){
   const replacement=doc.replacements[current],useReplacement=replacement&&$('compare').value==='edited';
   if(!selectedPlaying){$('replacement').hidden=!useReplacement;player.hidden=!!useReplacement;if(useReplacement)$('replacement').src=replacement.dataUrl;}
   $('frame-tag').textContent='Original #'+String(current).padStart(4,'0')+' · '+time(current)+(doc.removed.includes(current)?' · removed':'');
   $('position').textContent='Clip '+(clipIndex+1)+' / frame '+(current-clip().start+1)+' · '+time(current);
   for(const tile of $('grid').children)tile.dataset.current=String(Number(tile.dataset.frame)===current);
  }
  async function captureFrames(values,edited=true,valid=()=>!closed){
   const result={};const capture=document.createElement('canvas');capture.width=player.videoWidth;capture.height=player.videoHeight;
   for(const n of values){
    if(!valid())throw Error('Preview cancelled.');
    if(edited&&doc.replacements[n]){result[n]=doc.replacements[n].dataUrl;continue;}
    decodeChain=decodeChain.catch(()=>{}).then(async()=>{if(!valid())return;await seek(decoder,frameTime(n));if(!valid())return;capture.getContext('2d').drawImage(decoder,0,0);result[n]=capture.toDataURL('image/jpeg',.88);});await decodeChain;
   }
   return result;
  }
  async function play(){
   if(playing){pause();refreshInspector();return;}
   const c=clip(),scope=$('play-scope').value,edited=$('compare').value==='edited',kept=M.playback(doc,[...selected],c,scope,edited);
   if(!kept.length){message(scope==='selected'?'Select frames to play.':'This clip has no retained frames.');return;}
   pause();const serial=playSerial;playing=true;$('play').disabled=false;$('play').textContent='Pause';
   if(scope==='selected'){
    message('Preparing '+kept.length+' selected frames…');
    const frames=await captureFrames(kept,edited,()=>!closed&&serial===playSerial);
    if(serial!==playSerial||closed)return;
    selectedPlaying=true;player.hidden=true;$('replacement').hidden=false;
    let index=0;const tick=()=>{
     if(!playing||closed||serial!==playSerial)return;
     current=kept[index++];player.currentTime=frameTime(current);$('replacement').src=frames[current];refreshInspector();
     if(index===kept.length){timer=setTimeout(()=>{pause();refreshInspector();message('Selected-frame preview complete. Only '+kept.length+' selected frames played.');},1000/M.FPS);return;}
     timer=setTimeout(tick,1000/M.FPS);
    };message('Playing only selected frames · 25 fps · silent preview');tick();return;
   }
   current=kept[0];await seek(player,(current-1)/M.FPS);if(serial!==playSerial)return;await player.play();
   const tick=()=>{
    if(!playing||closed||serial!==playSerial)return;
    let f=Math.floor((player.currentTime+.00001)*M.FPS)+1;
    if(f>c.end||player.ended){pause();current=kept.at(-1);refreshInspector();return;}
    if(edited&&doc.removed.includes(f)){const next=kept.find(n=>n>f);if(!next){pause();return;}player.currentTime=(next-1)/M.FPS;f=next;}
    current=f;refreshInspector();
    if(player.requestVideoFrameCallback)frameLoop=player.requestVideoFrameCallback(tick);else timer=setTimeout(tick,20);
   };tick();
  }
  async function repairSelected(resume=false){
   try{
    assertCurrent();pause();
    if(!resume){
     const plan=M.repair(doc,[...selected],$('instructions').value);
     if(plan.original_frame_ids.at(-1)-plan.original_frame_ids[0]>=100)throw Error('Repair a span of up to 100 frames (4 seconds) at a time.');
     repairDraft={...plan,request_id:crypto.randomUUID().replaceAll('-',''),asset_id:source.id,story_id:story,total:doc.total,revision:M.revision(doc),replacements:JSON.parse(JSON.stringify(doc.replacements))};await persist();
    }
    if(!repairDraft)return;
    $('resume-repair').hidden=false;
    await window.EccoFrameRepair.open({draft:repairDraft,library:source.library,isCurrent:()=>isCurrent()&&source?.id===repairDraft.asset_id&&M.revision(doc)===repairDraft.revision,
     capture:values=>captureFrames(values,true),persist:()=>persist(),
     accept:candidate=>{assertCurrent();const next=M.acceptRepair(doc,repairDraft,candidate);commit(next,'Repaired frames reinserted at their original positions. Timing and audio are preserved.');repairDraft=null;$('resume-repair').hidden=true;persist().catch(fail);drawGrid();},
     origin:$('prepare')});
   }catch(e){fail(e);}
  }
  function drawClips(){
   $('clips').replaceChildren();
   for(const c of M.clips(doc)){
    const b=document.createElement('button');b.type='button';b.className='cf-clip';b.setAttribute('aria-pressed',String(c.index===clipIndex));b.setAttribute('aria-label','Clip '+(c.index+1)+', frames '+c.start+' to '+c.end);
    const name=document.createElement('strong');name.textContent='Clip '+String(c.index+1).padStart(2,'0');const line=document.createElement('small');line.textContent='#'+c.start+'–'+c.end+' · '+(c.count/M.FPS).toFixed(2)+'s';
    const state=document.createElement('small'),cuts=doc.removed.filter(n=>n>=c.start&&n<=c.end).length;state.textContent=cuts?cuts+' removed':c.index?'Continues clip '+c.index:'Opening';b.append(name,line,state);b.onclick=()=>switchClip(c.index);$('clips').append(b);
   }
   const c=clip();$('continuity').textContent=c.index?'Continues clip '+c.index+' · previous ending #'+(c.start-1)+' · original timing retained until you remove frames.':'Opening clip · choose a clear ending before continuing.';
   $('ending-info').textContent='Current ending: original frame '+c.end+'. '+(c.end<doc.total?'Next clip begins at '+(c.end+1)+'.':'This is the final clip.');
   $('ending').value=doc.endings?.[c.end]||'';
   $('boundary').disabled=c.index===doc.ends.length-1;
  }
  function refreshSelection(){
   if(!doc)return;
   const values=[...selected].sort((a,b)=>a-b),cuts=values.filter(n=>!doc.removed.includes(n)).length;
   $('play').disabled=$('play-scope').value==='selected'&&!values.length;$('count').textContent=values.length+' selected';$('selected').textContent=values.length?M.format(values):'Click any thumbnail to begin.';
   $('impact').textContent=values.length?'Remove: −'+(cuts/M.FPS).toFixed(2)+'s; matching audio is cut on export. Repair or replacement preserves duration.':doc.removed.length+' frames removed · '+(M.keep(doc).length/M.FPS).toFixed(2)+'s edited / '+(doc.total/M.FPS).toFixed(2)+'s original';
   $('remove').disabled=!values.length||loading;$('restore').disabled=!values.some(n=>doc.removed.includes(n))||loading;
   $('undo').disabled=!history.length||loading;$('redo').disabled=!future.length||loading;
   $('import').disabled=values.length!==1||loading;$('original').disabled=!values.some(n=>doc.replacements[n])||loading;$('prepare').disabled=!values.length||loading;
   $('context').textContent=values.length?M.context(values,doc.total).map(w=>'Read #'+w.from+'–'+w.to+'; replace only '+M.format(w.replace)).join(' · '):'Select frames to see their 10-frame context windows.';
   for(const b of $('grid').children){const n=Number(b.dataset.frame);b.setAttribute('aria-pressed',String(selected.has(n)));b.dataset.removed=String(doc.removed.includes(n));b.dataset.replaced=String(!!doc.replacements[n]);const thumb=b.querySelector('img');if(doc.replacements[n])thumb.src=doc.replacements[n].dataUrl;else if(thumbs.has(n))thumb.src=thumbs.get(n);b.setAttribute('aria-label','Frame '+n+', clip frame '+(n-clip().start+1)+(doc.removed.includes(n)?', removed':'')+(doc.replacements[n]?', replaced':''));}
   refreshInspector();
  }
  function choose(n,event={}){
   if(event.shiftKey&&anchor!==null){const a=Math.min(anchor,n),b=Math.max(anchor,n);for(let f=a;f<=b;f++)selected.add(f);}
   else {if(selected.has(n))selected.delete(n);else selected.add(n);anchor=n;}
   inspect(n);refreshSelection();
  }
  const visibleFrames=()=>{const c=clip(),start=c.start+page*pageSize;return Array.from({length:Math.max(0,Math.min(pageSize,c.end-start+1))},(_,i)=>start+i);};
  async function drawGrid(){
   const thisToken=++token,c=clip();page=Math.min(page,Math.max(0,Math.ceil(c.count/pageSize)-1));const frames=visibleFrames();
   $('grid').replaceChildren();$('grid-title').textContent='Clip '+String(clipIndex+1).padStart(2,'0')+' · frames '+frames[0]+'–'+frames.at(-1);
   $('page-caption').textContent='Group '+(page+1)+' of '+Math.ceil(c.count/pageSize)+' · '+c.count+' original frames in this clip';
   $('page-prev').disabled=page===0;$('page-next').disabled=(page+1)*pageSize>=c.count;
   $('progress').max=frames.length;$('progress').value=0;
   for(const n of frames){
    const b=document.createElement('button');b.type='button';b.className='cf-tile';b.dataset.frame=String(n);
    const img=document.createElement('img');img.alt='';img.src=doc.replacements[n]?.dataUrl||thumbs.get(n)||blank;
    const label=document.createElement('span');label.className='cf-tile-label';const number=document.createElement('span');number.textContent='#'+String(n).padStart(4,'0');const timestamp=document.createElement('span');timestamp.textContent=time(n);label.append(number,timestamp);
    const check=document.createElement('span');check.className='cf-check';check.textContent='✓';check.setAttribute('aria-hidden','true');b.append(img,label,check);
    b.onclick=e=>choose(n,e);b.ondblclick=()=>{selected.delete(n);refreshSelection();enlarge(n);};
    b.onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=n+(e.key==='ArrowRight'?1:-1);if(next>=c.start&&next<=c.end){const nextPage=Math.floor((next-c.start)/pageSize);if(nextPage!==page){page=nextPage;drawGrid().then(()=>q('[data-frame="'+next+'"]',dialog)?.focus());}else q('[data-frame="'+next+'"]',dialog)?.focus();inspect(next);}}};$('grid').append(b);
   }
   refreshSelection();
   try{
    for(const [i,n] of frames.entries()){
     if(thisToken!==token||closed)return;
     if(!thumbs.has(n)){decodeChain=decodeChain.catch(()=>{}).then(async()=>{if(thisToken!==token||closed)return;await seek(decoder,frameTime(n));if(thisToken!==token||closed)return;painter.drawImage(decoder,0,0,320,180);thumbs.set(n,canvas.toDataURL('image/jpeg',.78));});await decodeChain;if(thisToken!==token||closed)return;}
     const tile=q('[data-frame="'+n+'"]',dialog);if(tile)tile.querySelector('img').src=doc.replacements[n]?.dataUrl||thumbs.get(n);$('progress').value=i+1;
    }
   }catch(e){if(thisToken===token)fail(e);}
  }
  function switchClip(index){pause();clipIndex=index;page=0;drawClips();inspect(clip().start);drawGrid();}
  async function enlarge(n){
   await inspect(n);const modal=document.createElement('dialog');modal.className='generation-dialog';modal.setAttribute('aria-label','Inspect original frame '+n);modal.style.width='min(1000px,94vw)';modal.style.maxWidth='1000px';
   const heading=document.createElement('div');heading.className='section-head';const h=document.createElement('h2');h.textContent='Original frame '+n+' · '+time(n);const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Close frame inspector');close.onclick=()=>modal.close();heading.append(h,close);
   const img=document.createElement('img');img.style.cssText='width:100%;max-height:70vh;object-fit:contain';img.alt='Frame '+n;
   if(doc.replacements[n]&&$('compare').value==='edited')img.src=doc.replacements[n].dataUrl;
   else{const capture=document.createElement('canvas');capture.width=player.videoWidth;capture.height=player.videoHeight;capture.getContext('2d').drawImage(player,0,0);img.src=capture.toDataURL('image/jpeg',.94);}
   modal.append(heading,img);modal.onclose=()=>{modal.remove();q('[data-frame="'+n+'"]',dialog)?.focus();};document.body.append(modal);modal.showModal();
  }
  async function activate(item,blob=null){
   const serial=++sourceToken;loading=true;token++;pause();$('work').hidden=true;$('empty').hidden=false;message('Opening video…');
   try{
    await persist();
    doc=null;key='';$('save').disabled=true;$('plan').disabled=true;$('export').disabled=true;
    let url=item.url;
    if(blob){if(ownedURL)URL.revokeObjectURL(ownedURL);ownedURL=URL.createObjectURL(blob);url=ownedURL;}
    else if(!url){const a=records().find(a=>a.id===item.id);url=typeof media==='function'&&a?media(a):'';if(!url){const response=await api('media/'+item.id);blob=new Blob([response.buffer],{type:response.mime});if(ownedURL)URL.revokeObjectURL(ownedURL);ownedURL=URL.createObjectURL(blob);url=ownedURL;}}
    if(serial!==sourceToken||closed)return;
    await decodeChain.catch(()=>{});
    if(serial!==sourceToken||closed)return;
    await Promise.all([load(player,url),load(decoder,url)]);
    if(serial!==sourceToken||closed)return;
    if(!Number.isFinite(player.duration)||player.duration<=0)throw Error('This video has no readable duration.');
    source={id:item.id,name:item.name,duration:player.duration,library:!!item.library};draftBlob=item.library?null:blob;
    await refreshSources();$('source').value=source.id;
    const total=Math.round(player.duration*M.FPS);key='frames:'+identity+':'+story+':'+source.id;
    let saved;try{saved=await readDraft(key);}catch(e){message('Browser draft storage is unavailable. Download the edit plan before closing.');}
    doc=saved?.doc?M.validate(saved.doc,total):M.create(total,Number($('seconds').value));history=(saved?.history||[]).slice(-30);future=(saved?.future||[]).slice(-30);pendingExport=saved?.pendingExport||null;repairDraft=saved?.repairDraft||null;$('resume-repair').hidden=!repairDraft;
    $('seconds').value=String(doc.seconds);selected.clear();anchor=null;thumbs.clear();clipIndex=0;page=0;current=1;loading=false;
    $('work').hidden=false;$('empty').hidden=true;$('save').disabled=false;$('plan').disabled=false;
    $('export').disabled=!source.library||!capabilities?.available;
    $('export').textContent=pendingExport?'Check export':'Export edited MP4';
    $('export').title=!source.library?'Open a Video Library asset to export an edited MP4.':!capabilities?.available?'The CPU frame export service is not connected.':'';
    drawClips();inspect(1);drawGrid();message((saved?'Saved edit restored. ':'')+source.name+' · '+total+' frames on a 25 fps review timeline.');
   }catch(e){fail(e);}finally{if(serial===sourceToken)loading=false;}
  }
  async function refreshSources(){
   const select=$('source'),value=select.value;select.replaceChildren(new Option('Choose a video from this story',''));
   videoAssets(story).forEach(a=>select.add(new Option(a.title||'Untitled video',a.id)));if(source&&!source.library)select.add(new Option(source.name+' · local file',source.id));select.value=value;
  }
  async function openFile(file){if(!file)return;if(file.size>150*1024*1024)throw Error('Choose a video smaller than 150 MB.');const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());const id='local-'+[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');$('source').value='';await activate({id,name:file.name,library:false},file);}
  $('close').onclick=()=>dialog.close();$('upload').onclick=()=>$('file').click();$('file').onchange=()=>openFile($('file').files[0]).catch(fail);
  $('source').onchange=()=>{const a=videoAssets(story).find(a=>a.id===$('source').value);if(a)activate({id:a.id,name:a.title||'Untitled video',library:true});};
  $('seconds').onchange=()=>{if(!doc)return;const next=snapshot();next.seconds=Number($('seconds').value);next.ends=M.boundaries(doc.total,next.seconds);next.endings={};commit(next,'Review segments updated. Frame IDs and edits are unchanged.');clipIndex=0;page=0;drawClips();drawGrid();};
  $('prev').onclick=()=>inspect(current-1);$('next').onclick=()=>inspect(current+1);$('play').onclick=()=>play().catch(e=>{const cancelled=e.message==='Preview cancelled.';pause();refreshInspector();if(!cancelled)fail(e);});$('play-scope').onchange=()=>{pause();refreshInspector();};$('compare').onchange=()=>{pause();refreshInspector();};
  $('select-range').onclick=()=>{try{selected=new Set(M.parse($('range').value,doc.total));const first=[...selected][0];if(first){clipIndex=M.clips(doc).findIndex(c=>first>=c.start&&first<=c.end);page=Math.floor((first-clip().start)/pageSize);drawClips();drawGrid();inspect(first);}refreshSelection();}catch(e){fail(e);}};
  $('range').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('select-range').click();}};
  $('clear').onclick=()=>{pause();selected.clear();refreshSelection();};
  $('remove').onclick=()=>{try{const count=[...selected].filter(n=>!doc.removed.includes(n)).length;commit(M.change(doc,'remove',[...selected]),count+' frames removed from this edit. Undo or Reinsert restores them.');}catch(e){fail(e);}};
  $('restore').onclick=()=>{try{commit(M.change(doc,'restore',[...selected]),'Selected frames reinserted at their original positions.');}catch(e){fail(e);}};
  $('undo').onclick=()=>{if(!history.length)return;future.push(snapshot());doc=history.pop();selected.clear();clipIndex=Math.min(clipIndex,doc.ends.length-1);pause();drawClips();drawGrid();persist().catch(fail);message('Undo applied.');};
  $('redo').onclick=()=>{if(!future.length)return;history.push(snapshot());doc=future.pop();selected.clear();clipIndex=Math.min(clipIndex,doc.ends.length-1);pause();drawClips();drawGrid();persist().catch(fail);message('Redo applied.');};
  $('page-size').onchange=()=>{pageSize=Number($('page-size').value);page=0;drawGrid();};$('page-prev').onclick=()=>{page--;drawGrid();};$('page-next').onclick=()=>{page++;drawGrid();};$('select-page').onclick=()=>{pause();visibleFrames().forEach(n=>selected.add(n));refreshSelection();};
  $('prepare').onclick=()=>repairSelected();$('resume-repair').onclick=()=>repairSelected(true);
  $('import').onclick=()=>$('image').click();
  $('image').onchange=async()=>{
   const file=$('image').files[0],target=[...selected][0],sourceId=source?.id;if(!file||selected.size!==1)return;
   try{if(file.size>10*1024*1024)throw Error('Choose an image smaller than 10 MB.');const image=await createImageBitmap(file);if(source?.id!==sourceId||closed){image.close();return;}
    if(Math.abs(image.width/image.height-player.videoWidth/player.videoHeight)>.02){image.close();throw Error('Use an image with the same aspect ratio as the video.');}
    const output=document.createElement('canvas');output.width=player.videoWidth;output.height=player.videoHeight;output.getContext('2d').drawImage(image,0,0,output.width,output.height);image.close();
    const dataUrl=output.toDataURL('image/jpeg',.94);if(dataUrl.length>2800000)throw Error('Replacement image is too large. Choose a smaller image.');
    const next=snapshot();next.replacements[target]={dataUrl,name:file.name};next.removed=next.removed.filter(n=>n!==target);commit(next,'Frame '+target+' replaced. Original image retained in Undo.');inspect(target);
   }catch(e){fail(e);}finally{$('image').value='';}
  };
  $('original').onclick=()=>{const next=snapshot();for(const n of selected)delete next.replacements[n];commit(next,'Original images restored.');};
  $('boundary').onclick=()=>{const c=clip(),nextEnd=doc.ends[c.index+1];if(current<c.start||current>=nextEnd){message('Inspect a frame between '+c.start+' and '+(nextEnd-1)+'.');return;}const next=snapshot();next.ends[c.index]=current;commit(next,'Clip ending updated; the following clip starts at frame '+(current+1)+'.');page=0;drawGrid();};
  $('inspect-end').onclick=()=>inspect(clip().end);
  $('save-end').onclick=()=>{const next=snapshot();next.endings[clip().end]=$('ending').value.trim();commit(next,'Ending direction saved for this clip.');};
  $('save').onclick=save;
  $('plan').onclick=()=>download(new Blob([JSON.stringify({schema:'ecco-frame-edit-v1',source:{asset_id:source.library?source.id:null,name:source.name,duration:source.duration},...snapshot(),continuity:{context_frames:10,retain_previous_ending:true}},null,2)],{type:'application/json'}),'ecco-frame-edit.json');
  $('export').onclick=async()=>{
   const exportSource=source?.id;
   try{assertCurrent();pause();$('export').disabled=true;$('source').disabled=true;$('upload').disabled=true;
    if(!pendingExport)pendingExport={request_id:crypto.randomUUID().replaceAll('-',''),asset_id:source.id,story_id:story,fps:M.FPS,total:doc.total,removed:[...doc.removed],replacements:JSON.parse(JSON.stringify(doc.replacements))};
    await persist();message('Exporting edited video on the CPU…');
    const response=await api('frame-editor/export',pendingExport);
    const poll=async()=>{if(closed||source?.id!==exportSource)return;try{const result=await api('frame-editor/jobs/'+response.id);if(result.status==='done'){pendingExport=null;await persist();message('Edited MP4 saved to Video Library. Original video retained.');if(typeof refresh==='function')await refresh();await refreshSources();$('export').disabled=false;$('export').textContent='Export edited MP4';}else if(result.status==='failed'){pendingExport=null;await persist();message('Export failed: '+result.error);$('export').disabled=false;$('export').textContent='Export edited MP4';}else{message(result.progress||'Exporting edited video…');setTimeout(poll,2000);}}catch(e){message('Export status is uncertain. Check export to resume this same request.');$('export').textContent='Check export';$('export').disabled=false;}};poll();
   }catch(e){if(e.status>=400&&e.status<500&&e.status!==408){pendingExport=null;await persist();}fail(e);$('export').textContent=pendingExport?'Check export':'Export edited MP4';$('export').disabled=false;}
   finally{$('source').disabled=false;$('upload').disabled=false;}
  };
  function authChanged(){if(owner()!==identity)dialog.close();}
  document.addEventListener('ecco:auth-change',authChanged);
  dialog.addEventListener('close',()=>{if(closed)return;closed=true;sourceToken++;token++;pause();persist().catch(()=>{});player.removeAttribute('src');player.load();decoder.removeAttribute('src');decoder.load();if(ownedURL)URL.revokeObjectURL(ownedURL);document.removeEventListener('ecco:auth-change',authChanged);dialog.remove();opened=null;if(origin?.isConnected)origin.focus();},{once:true});
  await refreshSources();
  try{if(typeof api==='function')capabilities=await api('frame-editor/status');}catch{}
  if(closed)return;
  if(options.url)await activate({id:options.id||'preview',name:options.name||'Video',url:options.url,library:false});
  else if(options.assetId){const a=videoAssets(story).find(a=>a.id===options.assetId);if(a){$('source').value=a.id;await activate({id:a.id,name:a.title||'Video',library:true});}}
  else{const first=videoAssets(story)[0];if(first){$('source').value=first.id;await activate({id:first.id,name:first.title||'Video',library:true});}}
 }
 function mount(){
  const review=q('#video-review-panel');
  if(review&&!q('[data-frame-review-entry]',review)){
   const entry=document.createElement('div');entry.className='cf-review-entry';entry.dataset.frameReviewEntry='';entry.innerHTML='<div><strong>Clips & Frames</strong><p class="help">Review short segments. Cherry-pick, remove and reinsert individual frames.</p></div><button type="button" class="secondary">Open frame editor</button>';q('button',entry).onclick=()=>open();review.prepend(entry);
  }
  const menu=q('#video-flow-ai .storyboard-ai-actions');
  if(menu&&!q('[data-frame-review-entry]',menu)){const b=document.createElement('button');b.type='button';b.className='secondary';b.dataset.frameReviewEntry='';b.textContent='Clips & Frames';b.onclick=()=>{menu.closest('details').open=false;open();};menu.append(b);}
  for(const video of document.querySelectorAll('#video-gallery video[data-asset],#production-library video[data-asset],.library-content video[data-asset]')){
   const card=video.closest('.card,article,.library-media-row');if(!card||q('[data-open-frames]',card))continue;const actions=q('.actions,.card-body',card);if(!actions)continue;const b=document.createElement('button');b.type='button';b.className='small secondary';b.dataset.openFrames=video.dataset.asset;b.textContent='Review frames';b.onclick=()=>open({assetId:video.dataset.asset});actions.append(b);
  }
 }
 let queued=false;const schedule=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();});};
 const page=q('#page');if(page)new MutationObserver(schedule).observe(page,{childList:true,subtree:true});schedule();
 window.EccoFrameReview={open,readDraft};
})();
