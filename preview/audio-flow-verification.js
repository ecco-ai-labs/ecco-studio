'use strict';
(() => {
 const serverChecks=[['compute','Selected compute'],['models','Models'],['memory','Memory'],['worker_storage','Worker storage'],['tools','Audio processing tools'],['voices','Voices and languages'],['assets','Existing sound files'],['storage','Recording storage'],['queue','Generation queue']];
 function resolution(id,status,detail){
  if(status==='stale')return 'Run Verify Flow again to check your current selections and resources.';
  if(status==='blocked')return '';
  if(!['failed','blocked','unverified'].includes(status))return '';
  if(/needs? .*update|must be updated|update the selected worker|invalid verification result|no complete verification/i.test(detail))return 'Refresh Studio. If this remains, ask your administrator to update the workspace service and selected worker, then verify again.';
  if(/OpenAI|AI connection|speaking instructions/i.test(detail)||id==='ai')return 'Open Connections → AI and connect OpenAI, then run Verify Flow again.';
  if(/storage is not connected|connect workspace storage/i.test(detail))return 'Open Connections → Storage, connect your workspace, then run Verify Flow again.';
  if(id==='connection'||/cannot reach|could not be reached|storage unavailable|connection changed/i.test(detail))return 'Check Connections → Storage and reconnect if needed. Once the service responds, run Verify Flow again.';
  if(status==='blocked'&&/script|character|sound-plan/i.test(detail))return 'Resolve the Script, characters and sound plan check first, then verify again.';
  if(status==='blocked')return 'Select an available worker under Compute, then run Verify Flow again.';
  if(id==='models')return 'Choose an enabled model in Additional Controls for each character, or select a CPU that supports these models. For sounds, choose an available sound model or attach a file from Audio Library.';
  if(id==='compute')return 'Under Compute, select the intended CPU and confirm it is available. If it is offline, reconnect it in Connections before verifying again.';
  if(id==='memory')return /16 GiB/.test(detail)?'Select a CPU with at least 16 GiB RAM for new sound generation.':/VRAM/.test(detail)?'Select a CPU with reported memory, or have the selected GPU’s free VRAM checked before generating.':'Wait for other work to finish or select a CPU with more available memory, then verify again.';
  if(id==='worker_storage')return 'Free temporary or shared storage on the selected worker, or choose another worker with sufficient space, then verify again.';
  if(id==='storage')return 'Check Connections → Storage. Ensure the workspace has free space and write access; ask your administrator to restore access if needed.';
  if(id==='tools')return 'Ask your administrator to install or repair FFmpeg and FFprobe on the selected worker, then verify again.';
  if(id==='voices')return 'Open Additional Controls → the character’s tab and choose a supported voice and language. Missing voice reference files must be restored on the worker.';
  if(id==='assets')return 'In Final Script, open the affected sound cue and choose a playable file from Audio Library, upload a replacement, or remove the cue.';
  if(id==='queue')return 'Wait for an active generation to finish, or use Cancel in Progress to stop your current generation, then verify again.';
  if(id.startsWith('sound-'))return 'In Final Script, open this sound cue and correct its description, duration, model or timing, then verify again.';
  if(/unique name/i.test(detail))return 'Give each character a different, nonempty name in Characters, then verify again.';
  if(/voice|language/i.test(detail))return 'Open Additional Controls and select a supported model, voice and language for the affected character.';
  if(/sound cue|sound plan|sound timing/i.test(detail))return 'In Final Script, add or review the sound cues and their timing before running Verify Flow again.';
  return 'Review Final Script and Additional Controls, correct the issue described above, then run Verify Flow again.';
 }
 function mount({host,buttonHost,snapshot,build,connected,remote,busy}){
  const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Verify Flow';button.dataset.verifyAudio='';buttonHost.prepend(button);
  const panel=document.createElement('details');panel.className='generation-settings';panel.dataset.audioVerification='';panel.hidden=true;
  panel.innerHTML='<summary>Flow Verification</summary><div class="generation-settings-body"><p class="help">Checks your setup and live resources before generation. Audio quality is assessed after generation.</p><p role="status" data-verification-summary></p><div class="audio-verification-filters" role="group" aria-label="Filter verification checks"><label>Status<select data-filter-status><option value="">All statuses</option><option value="failed">Failed</option><option value="unverified">Not verified / errors</option><option value="blocked">Blocked</option><option value="passed">Passed</option><option value="checking">Checking</option><option value="stale">Recheck required</option></select></label><label>Column<select data-filter-column><option value="all">All columns</option><option value="label">Check</option><option value="detail">Details</option><option value="resolution">Resolution</option></select></label><label>Filter text<input type="search" data-filter-text placeholder="Search checks…"></label><button type="button" class="secondary" data-clear-filters>Clear filters</button></div><p class="help" role="status" data-filter-count></p><ul role="list" aria-label="Flow verification checks" data-verification-checks></ul></div>';
  host.append(panel);const summary=panel.querySelector('[data-verification-summary]'),list=panel.querySelector('ul');
  let running=false,baseline='',finished=0,stale=false;
  const fingerprint=()=>JSON.stringify(snapshot());
  const current=()=>panel.isConnected&&fingerprint()===baseline&&!stale;
  const statusFilter=panel.querySelector('[data-filter-status]'),columnFilter=panel.querySelector('[data-filter-column]'),textFilter=panel.querySelector('[data-filter-text]'),filterCount=panel.querySelector('[data-filter-count]');
  function applyView(){
   const rank={failed:0,unverified:1,blocked:2,stale:3,checking:4,passed:5},items=[...list.children],ordered=items.slice().sort((a,b)=>(rank[a.dataset.status]??1)-(rank[b.dataset.status]??1)||Number(a.dataset.order)-Number(b.dataset.order));
   ordered.forEach((item,index)=>{if(list.children[index]!==item)list.insertBefore(item,list.children[index]||null);});
   const query=textFilter.value.trim().toLocaleLowerCase(),column=columnFilter.value;let visible=0,hiddenFailures=0;
   for(const item of ordered){const fields={label:item.dataset.label,detail:item.querySelector('[data-check-detail]').textContent,resolution:item.querySelector('[data-check-resolution] span').textContent};
    const text=column==='all'?Object.values(fields).join(' '):fields[column]||'';
    item.hidden=!!(statusFilter.value&&item.dataset.status!==statusFilter.value||query&&!text.toLocaleLowerCase().includes(query));
    if(!item.hidden)visible++;else if(item.dataset.status==='failed')hiddenFailures++;
   }
   filterCount.textContent=(visible?'Showing '+visible+' of '+items.length+' checks.':'No checks match your filters.')+(hiddenFailures?' '+hiddenFailures+' failed checks hidden by filters.':'');
  }
  statusFilter.onchange=columnFilter.onchange=textFilter.oninput=applyView;
  panel.querySelector('[data-clear-filters]').onclick=()=>{statusFilter.value='';columnFilter.value='all';textFilter.value='';applyView();};
  function row(id,label,status,detail=''){
   let item=[...list.children].find(x=>x.dataset.check===id);
   if(!item){item=document.createElement('li');item.dataset.check=id;item.dataset.order=String(list.children.length);item.innerHTML='<div class="audio-check-heading"><strong data-check-label></strong><span class="audio-check-state"><span data-check-icon aria-hidden="true"></span><span data-check-state></span></span></div><p data-check-detail></p><p data-check-resolution><strong>To resolve: </strong><span></span></p>';list.append(item);}
   item.dataset.status=status;item.dataset.label=label;
   item.querySelector('[data-check-label]').textContent=label;
   item.querySelector('[data-check-icon]').textContent={checking:'…',passed:'✓',failed:'✕',blocked:'!',unverified:'?',stale:'↻'}[status]||'?';
   item.querySelector('[data-check-state]').textContent={checking:'Checking',passed:'Passed',failed:'Failed',blocked:'Blocked',unverified:'Not verified',stale:'Recheck required'}[status]||'Not verified';
   const description=item.querySelector('[data-check-detail]');description.textContent=detail;description.hidden=!detail||status==='blocked';item.title=status==='blocked'?detail:'';
   const fix=resolution(id,status,detail),suggestion=item.querySelector('[data-check-resolution]');suggestion.querySelector('span').textContent=fix;suggestion.hidden=!fix;applyView();
  }
  function invalidate(){if(!baseline||stale)return;if(fingerprint()!==baseline||finished&&Date.now()-finished>=60000){stale=true;summary.dataset.status='stale';summary.textContent='Selections changed or live checks expired. Run Verify Flow again.';for(const item of [...list.children])row(item.dataset.check,item.dataset.label,'stale');}}
  function refresh(){invalidate();button.disabled=running||busy();}
  button.onclick=async()=>{
   if(running||busy())return;running=true;stale=false;finished=0;baseline=fingerprint();panel.hidden=false;panel.open=true;list.replaceChildren();button.disabled=true;button.setAttribute('aria-busy','true');button.innerHTML='<span class="generation-spinner" aria-hidden="true"></span>Verifying Flow…';summary.dataset.status='checking';summary.textContent='Checking your generation choices…';document.querySelector('[data-audio-tab=progress]')?.click();
   const result=[];const put=(id,label,status,detail)=>{const item=result.find(c=>c.id===id);if(item)Object.assign(item,{label,status,detail});else result.push({id,label,status,detail});row(id,label,status,detail);};
   try{
    row('connection','Workspace connection','checking');
    if(!connected())put('connection','Workspace connection','failed','Workspace storage is not connected.');
    else put('connection','Workspace connection','unverified','Connection configured; waiting for an authenticated service response.');
    let payload=null;
    try{row('local','Script, characters and sound plan','checking');payload=build();put('local','Script, characters and sound plan','passed','Character assignments, script limits, voice choices and cue timing are valid.');}
    catch(error){put('local','Script, characters and sound plan','failed',error.message);}
    if(payload&&connected()){
     for(const [id,label] of serverChecks)row(id,label,'checking');
     try{
      const report=await remote(payload);
      if(!current())return;
      if(report?.version!==1||!Array.isArray(report.checks)||!serverChecks.every(([id])=>report.checks.some(c=>c.id===id)))throw Error('The storage service needs the Flow Verification update. No complete verification was returned.');
      put('connection','Workspace connection','passed','The authenticated workspace verification service responded.');
      for(const check of report.checks){if(!['passed','failed','blocked','unverified'].includes(check.status))throw Error('The service returned an invalid verification result.');put(check.id,check.label,check.status,check.detail);}
     }catch(error){if(!current())return;put('connection','Workspace connection','unverified',error.message||'The verification service could not be reached.');for(const [id,label] of serverChecks)put(id,label,'unverified',error.message||'Cannot reach the verification service.');}
    }else for(const [id,label] of serverChecks)put(id,label,'blocked',connected()?'Fix the script, character or sound-plan check, then verify again.':'Workspace storage is not connected.');
    if(!current())return;finished=Date.now();const passed=result.filter(c=>c.status==='passed').length,failed=result.filter(c=>c.status==='failed').length,remaining=result.length-passed-failed;
    summary.dataset.status=failed?'failed':remaining?'unverified':'passed';
    summary.textContent=(failed||remaining?'Verification needs attention: ':'Verification passed: ')+passed+' checks passed'+(failed?' · '+failed+' failed':'')+(remaining?' · '+remaining+' not verified':'')+'. Checked '+new Date(finished).toLocaleTimeString()+'.'+(!failed&&!remaining?' Ready for Generate. Availability can change after this check.':' Follow the resolutions below, then verify again.');
   }finally{running=false;button.setAttribute('aria-busy','false');button.textContent='Verify Flow';refresh();}
  };
  return {refresh,collapse:()=>{panel.open=false;},get running(){return running;}};
 }
 window.EccoAudioVerification={mount};
})();
