/* A repair candidate remains separate from the edit until explicit acceptance. */
(() => {
 'use strict';
 const M=window.EccoFrameModel;
 async function open({draft,library,isCurrent,capture,persist,accept,origin}){
  const dialog=document.createElement('dialog');dialog.className='generation-dialog cf-repair-dialog';dialog.setAttribute('aria-label','Repair selected frames');
  dialog.innerHTML=`<div class="section-head"><h2>Repair selected frames</h2><button type="button" data-r-close aria-label="Close repair">×</button></div>
   <p data-r-target></p><p class="help" data-r-context></p>
   <label>Correction<textarea data-r-prompt maxlength="2000" placeholder="Describe what should change and what must stay the same."></textarea></label>
   <label>Repair compute<select data-r-worker><option value="">Choose a ready repair worker</option></select></label><p class="help" data-r-ready>Checking repair worker…</p><div class="actions"><button type="button" data-r-generate>Generate corrected frames</button><button type="button" class="secondary" data-r-check hidden>Check repair</button></div>
   <p role="status" aria-live="polite" data-r-status></p>
   <section data-r-review hidden><div class="cf-repair-pair"><figure><figcaption>Current edit</figcaption><img data-r-before alt="Original selected frame"></figure><figure><figcaption>AI repair candidate</figcaption><img data-r-after alt="Repaired selected frame"></figure></div>
   <div class="actions"><button type="button" class="secondary" data-r-prev aria-label="Previous repaired frame">←</button><button type="button" data-r-play>Play selected frames</button><button type="button" class="secondary" data-r-next aria-label="Next repaired frame">→</button><span data-r-position></span></div><label>Inspect replacement<input data-r-slider type="range" min="0" step="1" value="0"></label>
   <p class="help">Compare the same original frame IDs. Preview is silent at 25 fps. Generate again to refine the correction.</p></section>
   <div class="actions"><button type="button" data-r-accept disabled>Reinsert new frames</button></div><p class="help">Reinsertion replaces only the selected IDs and restores them if removed. Other frames and audio stay unchanged. Undo reverses the replacement. Closing this window keeps the request; use Review repair to resume.</p>`;
  document.body.append(dialog);dialog.showModal();
  const $=key=>dialog.querySelector('[data-r-'+key+']'),targets=draft.original_frame_ids;
  let closed=false,busy=false,timer=null,pollTimer=null,index=0,playing=false,before={},candidate=draft.candidate||null,ready=null;
  $('target').textContent=targets.length+' selected · original frames '+M.format(targets);
  $('context').textContent='Context: #'+Math.max(1,targets[0]-10)+'–'+Math.min(draft.total,targets.at(-1)+10)+'. Only selected frames will be replaced. AI preview: 480p.';
  $('prompt').value=draft.instructions;$('slider').max=String(targets.length-1);
  const message=text=>{if(!closed)$('status').textContent=text;};
  function stop(){clearTimeout(timer);playing=false;$('play').textContent='Play selected frames';}
  function show(){const n=targets[index];$('before').src=before[n]||'';$('after').src=candidate?.frames[n]||'';$('position').textContent='Original #'+n+' · '+(index+1)+' / '+targets.length;$('slider').value=String(index);$('prev').disabled=index===0;$('next').disabled=index===targets.length-1;}
  function controls(){if(closed)return;$('generate').disabled=busy||!library||!ready?.workers?.some(w=>w.id===$('worker').value&&w.available);$('prompt').disabled=busy;$('accept').disabled=busy||!candidate;$('check').hidden=!draft.submitted||!!candidate||draft.failed;}
  async function display(){
   if(!candidate||closed)return;before=await capture(targets);if(closed)return;
   $('review').hidden=false;show();controls();message('Candidate ready for review. Your edit has not changed.');
  }
  async function poll(){
   if(closed)return;
   try{
    if(!isCurrent())throw Error('Return to the original story and account to review this repair.');
    const job=await api('frame-editor/repairs/'+draft.request_id);if(closed)return;
    message(job.progress||job.status);
    if(job.status==='done'){
     candidate=await api('frame-editor/repair-candidate/'+draft.request_id);if(closed)return;
     draft.candidate=candidate;busy=false;await persist();await display();
    }else if(job.status==='failed'){
     busy=false;draft.failed=true;await persist();message(job.error||'Repair failed. You can retry with the same or revised instructions.');controls();
    }else{busy=true;controls();pollTimer=setTimeout(poll,2500);}
   }catch(e){busy=false;message(e.message+' Use Check repair to resume this request.');controls();$('generate').disabled=!!draft.submitted&&!draft.failed;}
  }
  $('generate').onclick=async()=>{
   if(busy)return;
   try{
    if(!isCurrent())throw Error('Return to the original story and account before generating.');
    if(!library)throw Error('Open a Video Library asset to generate repairs. Local review does not upload your video.');
    const prompt=$('prompt').value.trim();if(!prompt)throw Error('Describe the correction first.');
    if(draft.submitted&&!draft.failed&&!candidate){await poll();return;}
    if(draft.submitted){draft.request_id=crypto.randomUUID().replaceAll('-','');draft.candidate=null;candidate=null;draft.failed=false;$('review').hidden=true;}
    stop();busy=true;controls();draft.instructions=prompt;
    const worker=await api('frame-editor/repair-status');ready=worker;
    if(!worker.workers?.some(w=>w.id===$('worker').value&&w.available))throw Error(worker.reason||'The repair worker is not ready.');
    draft.worker_id=$('worker').value;draft.submitted=true;await persist();
    message('Submitting selected frames and context…');
    await api('frame-editor/repair',{request_id:draft.request_id,asset_id:draft.asset_id,story_id:draft.story_id,total:draft.total,fps:25,original_frame_ids:targets,instructions:prompt,replacements:draft.replacements,worker_id:draft.worker_id});await poll();
   }catch(e){busy=false;if(e.status>=400&&e.status<500&&e.status!==408){draft.failed=true;await persist();}message(e.message);controls();if(draft.submitted&&!draft.failed)$('generate').disabled=true;}
  };
  $('check').onclick=()=>{clearTimeout(pollTimer);poll();};
  $('accept').onclick=()=>{try{if(!isCurrent())throw Error('Return to the original story and account before reinserting.');accept(candidate);dialog.close();}catch(e){message(e.message);}};
  $('prev').onclick=()=>{stop();index=Math.max(0,index-1);show();};$('next').onclick=()=>{stop();index=Math.min(targets.length-1,index+1);show();};$('slider').oninput=()=>{stop();index=Number($('slider').value);show();};
  $('play').onclick=()=>{if(playing){stop();return;}playing=true;index=0;$('play').textContent='Pause';const tick=()=>{show();if(index===targets.length-1){timer=setTimeout(stop,40);return;}index++;timer=setTimeout(tick,40);};tick();};
  $('close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{closed=true;stop();clearTimeout(pollTimer);dialog.remove();origin?.focus();},{once:true});
  $('worker').onchange=controls;$('prompt').focus();controls();
  try{ready=await api('frame-editor/repair-status');if(closed)return;for(const w of ready.workers||[]){const option=new Option(w.id+(w.available?' · ready':' · '+w.reason),w.id);option.disabled=!w.available;$('worker').add(option);}$('worker').value=draft.worker_id||window.EccoGPUConnection?.selectedId||'';$('ready').textContent=!library?'Choose a Video Library asset for AI repair. Local videos remain on this device.':ready.available?'Repair worker ready · WAN VACE 1.3B · 480p candidate. Generation uses the running GPU.':ready.reason||'Repair worker unavailable. Start the configured repair worker to generate candidates.';controls();}catch(e){$('ready').textContent='Repair service unavailable: '+e.message;}
  if(candidate){try{await display();}catch(e){message(e.message);}}
  else if(draft.submitted&&!draft.failed)await poll();
 }
 window.EccoFrameRepair={open};
})();
