'use strict';
(() => {
 const serverChecks=[['compute','Selected compute'],['models','Models'],['memory','Memory'],['worker_storage','Worker storage'],['tools','Audio processing tools'],['voices','Voices and languages'],['assets','Existing sound files'],['storage','Recording storage'],['queue','Generation queue']];
 function mount({host,buttonHost,snapshot,build,connected,remote,busy}){
  const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Verify Flow';button.dataset.verifyAudio='';buttonHost.append(button);
  const panel=document.createElement('details');panel.className='generation-settings';panel.dataset.audioVerification='';panel.hidden=true;
  panel.innerHTML='<summary>Flow Verification</summary><div class="generation-settings-body"><p class="help">Checks the current configuration and live resources without generating audio. A pass is not an inference or voice-quality test.</p><p class="help" role="status" data-verification-summary></p><ul data-verification-checks></ul></div>';
  host.prepend(panel);const summary=panel.querySelector('[data-verification-summary]'),list=panel.querySelector('ul');
  let running=false,baseline='',finished=0,stale=false;
  const fingerprint=()=>JSON.stringify(snapshot());
  const current=()=>panel.isConnected&&fingerprint()===baseline&&!stale;
  function row(id,label,status,detail=''){
   let item=[...list.children].find(x=>x.dataset.check===id);
   if(!item){item=document.createElement('li');item.dataset.check=id;item.innerHTML='<strong></strong><span></span>';list.append(item);}
   item.dataset.status=status;
   const prefix={checking:'Checking',passed:'✓ Passed',failed:'✕ Failed',blocked:'Blocked',unverified:'Not verified',stale:'Recheck required'}[status]||'Not verified';
   item.querySelector('strong').textContent=prefix+' — '+label;item.querySelector('span').textContent=detail?' · '+detail:'';
  }
  function invalidate(){if(!baseline||stale)return;if(fingerprint()!==baseline||finished&&Date.now()-finished>=60000){stale=true;summary.textContent='Selections changed or live checks expired. Verify Flow again before relying on these results.';for(const item of list.children)row(item.dataset.check,item.querySelector('strong').textContent.split(' — ').slice(1).join(' — '),'stale');}}
  function refresh(){invalidate();button.disabled=running||busy();}
  button.onclick=async()=>{
   if(running||busy())return;running=true;stale=false;finished=0;baseline=fingerprint();panel.hidden=false;panel.open=true;list.replaceChildren();button.disabled=true;button.setAttribute('aria-busy','true');button.innerHTML='<span class="generation-spinner" aria-hidden="true"></span>Verifying Flow…';summary.textContent='Checking your generation choices…';document.querySelector('[data-audio-tab=progress]')?.click();
   const result=[];const put=(id,label,status,detail)=>{const item=result.find(c=>c.id===id);if(item)Object.assign(item,{label,status,detail});else result.push({id,label,status,detail});row(id,label,status,detail);};
   try{
    row('connection','Workspace connection','checking');
    if(!connected()){put('connection','Workspace connection','failed','Connect workspace storage, then Verify Flow again.');for(const [id,label] of serverChecks)put(id,label,'blocked','Workspace storage is not connected.');}
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
    }else if(connected())for(const [id,label] of serverChecks)put(id,label,'blocked','Fix the script, character or sound-plan check, then verify again.');
    if(!current())return;finished=Date.now();const passed=result.filter(c=>c.status==='passed').length,failed=result.filter(c=>c.status==='failed').length,remaining=result.length-passed-failed;
    summary.textContent=(failed||remaining?'Verification needs attention: ':'Verification passed: ')+passed+' checks passed'+(failed?' · '+failed+' failed':'')+(remaining?' · '+remaining+' not verified':'')+'. Checked '+new Date(finished).toLocaleTimeString()+'.'+(!failed&&!remaining?' Ready for Generate. Availability can change after this check.':' Review the checks above before generating.');
   }finally{running=false;button.setAttribute('aria-busy','false');button.textContent='Verify Flow';refresh();}
  };
  return {refresh,collapse:()=>{panel.open=false;},get running(){return running;}};
 }
 window.EccoAudioVerification={mount};
})();
