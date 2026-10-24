'use strict';
(() => {
 const modelFor=kind=>kind==='music'?'ace-step-1.5':'moss-soundeffect-v2';
 const models={'moss-soundeffect-v2':'MOSS SoundEffect v2','ace-step-1.5':'ACE-Step 1.5'};
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function mount({box,cue,changed,valid}){
  const area=document.createElement('div');area.className='form';area.dataset.soundGeneration='';
  area.innerHTML='<div class="generation-filter-row"><label>Sound Model<select data-sound-model></select></label><label>Duration (Seconds)<input type="number" data-sound-duration step="1"></label><label>Compute<select data-sound-compute><option value="cpu">CPU</option><option value="a100">A100</option><option value="b200">B200</option></select></label></div><button type="button" class="secondary" data-generate-sound>Generate Sound</button><p class="help" role="status" data-sound-status></p>';
  box.querySelector('[data-field=description]').closest('label').after(area);
  const q=s=>area.querySelector(s),model=modelFor(cue.kind),duration=q('[data-sound-duration]'),compute=q('[data-sound-compute]'),button=q('button'),status=q('[data-sound-status]');
  q('[data-sound-model]').add(new Option(models[model],model));duration.min=cue.kind==='music'?10:1;duration.max=cue.kind==='music'?60:30;duration.value=cue.duration||(cue.kind==='music'?20:5);compute.value=cue.compute||'cpu';
  const collect=()=>{cue.duration=Number(duration.value);cue.compute=compute.value;};collect();duration.oninput=collect;compute.onchange=collect;
  let pending=false;
  button.onclick=async()=>{
   if(pending)return;
   try{
    valid();collect();if(!window.EccoStorage?.ready)throw Error('Connect workspace storage first.');
    if(!cue.description.trim())throw Error('Describe the sound you want to create.');if(!duration.reportValidity())return;
    pending=true;button.disabled=true;button.setAttribute('aria-busy','true');button.innerHTML='<span class="generation-spinner" aria-hidden="true"></span>Checking Worker…';
    const request={kind:cue.kind,description:cue.description.trim(),title:cue.name,model,duration:cue.duration,compute:cue.compute,story_id:activeStory||null};
    const signature=()=>JSON.stringify([cue.kind,cue.description.trim(),cue.name,cue.duration,cue.compute,cue.asset_id]),before=signature();
    const available=await api('audio/status');valid();
    if(!available.compute?.[request.compute]?.sound_models?.includes(model))throw Error(models[model]+' is not installed and verified on '+request.compute.toUpperCase()+'. Your sound description is saved when you Apply.');
    if(signature()!==before)throw Error('The sound changed. Generate again with the current description.');
    const job=await api('audio/sounds/generate',request);if(!job.id)throw Error('The service did not confirm a sound job. Check Activity before retrying.');
    button.innerHTML='<span class="generation-spinner" aria-hidden="true"></span>Generating Sound…';status.textContent='Sound queued. It will be saved to Audio Library even if you close this popup.';
    const started=Date.now();
    while(area.isConnected&&Date.now()-started<1850000){
     const result=await api('audio/jobs/'+encodeURIComponent(job.id));if(!area.isConnected)return;
     if(['error','failed'].includes(result.status))throw Error(result.error||'Sound generation failed.');
     if(result.status==='done'){
      const asset=result.asset;if(!asset?.id||asset.media!=='audio')throw Error('The job finished without a saved sound asset. Check Audio Library.');
      window.EccoAudioLibrary?.remember(asset);valid();
      if(signature()!==before){status.textContent='Sound saved to Audio Library. Your newer edits were kept; choose the saved file if wanted.';return;}
      cue.asset_id=asset.id;changed();return;
     }
     status.textContent=result.progress||'Waiting for the sound worker…';await sleep(2000);
    }
    if(area.isConnected)throw Error('Still processing. Check Activity and Audio Library before submitting another sound.');
   }catch(error){if(area.isConnected)status.textContent=error.message;}
   finally{pending=false;if(area.isConnected){button.disabled=false;button.setAttribute('aria-busy','false');button.textContent='Generate Sound';}}
  };
 }
 window.EccoSoundGeneration={mount,modelFor,models};
})();
