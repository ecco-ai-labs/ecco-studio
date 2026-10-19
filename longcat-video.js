'use strict';
(() => {
 const id='longcat-avatar-1.5';
 const previousCard=card;
 card=function(asset){const html=previousCard(asset);return asset.mode==='longcat'?html.replace('Pan / zoom storyboard preview · silent video','LongCat · synchronized dialogue audio'):html;};
 const originalAvailable=modelAvailable,originalStatus=modelStatus;
 modelAvailable=function(mid){if(mid!==id)return originalAvailable(mid);const pod=localStorage.getItem('ecco-selected-gpu');return !!state?.config?.longcat?.workers?.some(w=>w.pod===pod&&w.ready);};
 modelStatus=function(mid){if(mid!==id)return originalStatus(mid);return modelAvailable(id)?'Ready · audio-driven video on the selected B200.':'Weights installed. Connect a B200 running the LongCat worker.';};
 const previousApi=api;
 api=async function(path,body,...args){
  const result=await previousApi.call(this,path,body,...args);
  if(path==='state')result.records=result.records.map(j=>j.kind==='longcat_job'?{...j,kind:'job',source_kind:'longcat_job'}:j);
  return result;
 };
 const previousRender=renderPage;
 renderPage=function(){
  previousRender.apply(this,arguments);
  const form=document.querySelector('#video-form');if(!form)return;
  const model=form.querySelector('#job-model'),ctx=window.EccoGeneration.context(form);
  const label=document.createElement('label');label.textContent='Dialogue audio';
  const audio=document.createElement('select');audio.setAttribute('aria-label','Dialogue audio');
  audio.add(new Option('Select a recording from Audio Library',''));
  state.records.filter(a=>a.kind==='asset'&&a.media==='audio'&&!a.deleted).forEach(a=>audio.add(new Option(a.title||'Untitled audio',a.id)));
  audio.value=ctx.data.longcat_audio_id||'';
  audio.onchange=()=>{ctx.data.longcat_audio_id=audio.value;localStorage.setItem('ecco-generation-v1:video:'+ctx.story,JSON.stringify(ctx.data));};
  label.append(audio);
  const hint=document.createElement('p');hint.className='help';hint.textContent='One reference image + 0.2–10 seconds of dialogue. The audio determines shot length. Use a clean voice recording.';
  const section=document.createElement('div');section.append(label,hint);form.querySelector('[data-section="references"]').append(section);
  const show=()=>{section.hidden=model.value!==id;};model.addEventListener('change',show);show();
  const originalSubmit=form.onsubmit;
  form.onsubmit=async event=>{
   if(model.value!==id)return originalSubmit.call(form,event);
   event.preventDefault();const button=form.querySelector('#generate-video'),status=form.querySelector('#video-status');
   if(ctx.submitting||button.disabled)return;
   try{
    if(!gpuConnected()){connectGPU(button.id);return;}
    if(!modelAvailable(id))throw Error(modelStatus(id));
    if(ctx.data.reference_library==='video'||ctx.data.reference_ids.length!==1)throw Error('Select exactly one reference image for this dialogue shot.');
    if(!audio.value)throw Error('Select a dialogue recording from Audio Library.');
    const text=form.querySelector('textarea[name="prompt"]').value.trim();
    if(!text)throw Error('Describe the character movement and scene in Prompt.');
    ctx.submitting=true;submittingVideos.add(ctx.story);setGenerationBusy(button,true,'Running Generation','Generate video');
    const job=await api('longcat/generate',{story_id:ctx.story,image_id:ctx.data.reference_ids[0],audio_id:audio.value,
      prompt:window.EccoGeneration.compose(ctx,text),gpu:localStorage.getItem('ecco-selected-gpu'),...modelSettings(id)});
    localStorage.setItem('ecco-video-job:'+ctx.story,job.id);window.EccoGeneration.trackJob('video',ctx.story,job);
    status.textContent='Queued. Follow progress in Activity.';await refresh();
   }catch(error){status.textContent=error.message;notice(error.message,true);}
   finally{ctx.submitting=false;submittingVideos.delete(ctx.story);setGenerationBusy(button,false,'','Generate video');updateVideoStatus();}
  };
 };
})();
