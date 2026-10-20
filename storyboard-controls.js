'use strict';
(() => {
 const q=s=>document.querySelector(s);
 const blank=()=>({image_id:'',seconds:Number(draft.defaultSeconds)||3,motion:'Slow cinematic camera movement',narration:''});
 function sync(){const input=q('#scene-count');if(input)input.value=draft.scenes.length;}
 const previousRender=renderScenes;
 renderScenes=function(...args){const result=previousRender.apply(this,args);sync();return result;};
 function resize(count){
  if(!Number.isInteger(count)||count<0||count>60)throw Error('Choose between 0 and 60 scenes.');
  if(count<draft.scenes.length&&draft.scenes.slice(count).some(s=>s.image_id||s.narration)&&!confirm('Remove the last '+(draft.scenes.length-count)+' scenes from this draft?')){sync();return;}
  while(draft.scenes.length<count)draft.scenes.push(blank());
  draft.scenes.length=count;persistDraft();renderScenes();
 }
 function mount(){
  const split=q('#split');if(!split||q('#scene-count-controls'))return;
  q('#page>.intro')?.remove();
  const controls=document.createElement('div');controls.id='scene-count-controls';controls.className='row';
  controls.innerHTML='<label>Scenes<input id="scene-count" type="number" min="0" max="60" step="1" aria-label="Number of scenes" style="width:76px"></label><label>Seconds per Scenes<input id="scene-default-seconds" type="number" min="1" max="30" step="1" style="width:110px"></label>';
  split.parentElement.before(controls);sync();
  const count=q('#scene-count'),seconds=q('#scene-default-seconds');
  seconds.value=Number(draft.defaultSeconds)||3;
  const safely=fn=>{try{fn();}catch(error){notice(error.message,true);sync();}};
  count.onchange=()=>safely(()=>resize(Number(count.value)));
  q('#add-scene').hidden=true;
  seconds.onchange=()=>safely(()=>{
   const value=Number(seconds.value);if(!Number.isFinite(value)||value<1||value>30)throw Error('Choose a duration from 1 to 30 seconds.');
   draft.defaultSeconds=value;draft.scenes.forEach(scene=>scene.seconds=value);persistDraft();renderScenes();
  });
  split.textContent='Generate with AI';split.className='secondary';
  const toolbar=document.createElement('details');toolbar.id='storyboard-ai-toolbar';toolbar.className='storyboard-ai-floating';
  toolbar.innerHTML='<summary aria-label="AI assistance">AI</summary><div class="storyboard-ai-actions"></div>';
  q('#page').append(toolbar);toolbar.querySelector('div').append(split);
  const improve=document.createElement('button');improve.type='button';improve.className='secondary';improve.textContent='Improve with AI';toolbar.querySelector('div').append(improve);
  let selectedField=q('#story-text');
  const selectField=(element,target=element)=>{
   q('#page').querySelectorAll('.ai-selected-field').forEach(el=>el.classList.remove('ai-selected-field'));
   selectedField=element;target?.classList.add('ai-selected-field');
  };
  selectField(selectedField);
  q('#page').addEventListener('focusin',event=>{
   if(event.target.matches('#story-text,#board-title,#scenes textarea,#scenes input[data-subject-field],#scenes input[data-field="title"]'))selectField(event.target);
   else if(controls.contains(event.target))selectField(null,event.target);
  });
  improve.onclick=()=>{toolbar.open=false;if(selectedField?.isConnected)return window.EccoAI.improveField(selectedField);notice('Select a text field to improve.',true);};
  split.onclick=async()=>{
   toolbar.open=false;
   if(selectedField?.isConnected)return window.EccoAI.generateField(selectedField);
   const count=Number(q('#scene-count').value),story=draft.story.trim(),target=activeStory,snapshot=JSON.stringify(draft);
   const isValid=()=>split.isConnected&&target===activeStory&&JSON.stringify(draft)===snapshot;
   return window.EccoAI.requestGeneration({label:'Storyboard · '+count+' scenes',key:'storyboard:scene-plan',isValid,onGenerate:async options=>{
    if(!story)return notice('Add your selected story text first.',true);
    if(count<1)return notice('Choose at least one scene.',true);
    if(!window.EccoStorage?.ready||!window.EccoAI.enabled)return window.EccoAI.connections();
    if(draft.scenes.some(scene=>scene.narration||scene.image_id)&&!confirm('Replace the scene draft with an AI adaptation? Saved revisions remain available.'))return;
    split.disabled=true;split.textContent='Planning scenes…';
    try{
     const capability=await window.EccoAI.refresh();
     if(!capability.enabled)throw Error('Enable AI in Connections before generating scenes.');
     const supportsInstructions=capability.generation_modes?.includes('generate');
     if(!supportsInstructions&&window.EccoAI.generationInstructions(options))throw Error('Custom scene instructions need the prepared AI service update. Your instructions and draft are saved.');
     if(!isValid())throw Error('The draft changed. Reopen Generate with AI for the current story.');
     const seconds=Number(draft.defaultSeconds)||3;
     const contract='Create a JSON object with continuity (string) and scenes (array), containing exactly '+count+' scenes of '+seconds+' seconds each. Each scene must contain title, narration, motion, shot_size, camera_angle and camera_move strings. Keep these JSON keys in English. Use at most 4000 characters for narration and 2000 for motion per scene. Preserve characters, causal order, key events and the original ending. Return only JSON, without code fences.';
     const journey=window.EccoStoryJourneys?.current();const direction=journey?window.EccoStoryJourneys.brief(storyDescription()):'';
     const audioRule=journey&&storyboardIsAudio()?' Audio-only script: narration contains spoken words only; creative instructions are never spoken. For audiobooks preserve the supplied chapter wording verbatim; do not summarize. Keep motion nonempty as a production note; camera fields may be empty.':'';
     const brief=contract+audioRule+'\nWorkflow: '+(journey?.label||'')+'\nCreative direction: '+direction+'\n'+window.EccoAI.generationInstructions(options);
     const result=supportsInstructions?await api('ai/enhance',{stage:'storyboard',mode:'generate',story_id:activeStory||null,fields:[{id:'scene_plan',text:brief,max_length:100000}],context:{title:draft.title,summary:story,count,seconds,language:options.language,instructions:brief},review_only:false}):{revisions:[{id:'scene_plan',text:JSON.stringify(await api('stories/plan',{story,title:draft.title,count,seconds}))}]};
     if(!window.EccoAI.enabled)throw Error('AI was disabled during planning. Your draft was preserved.');
     if(!isValid())throw Error('The draft changed while AI was planning. Your edits were preserved; run planning again when ready.');
     if(result.questions?.length)throw Error(result.questions.join(' '));
     if(!Array.isArray(result.revisions)||result.revisions.length!==1||result.revisions[0].id!=='scene_plan'||typeof result.revisions[0].text!=='string')throw Error('AI returned an invalid scene plan. Your draft was preserved.');
     let planned;try{planned=JSON.parse(result.revisions[0].text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('AI returned an invalid scene plan. Your draft was preserved.');}
     const fields=['title','narration','motion','shot_size','camera_angle','camera_move'];
     if(!Array.isArray(planned.scenes)||planned.scenes.length!==count||typeof planned.continuity!=='string'||planned.scenes.some(scene=>!scene||fields.some(name=>typeof scene[name]!=='string')||!scene.motion.trim()||scene.narration.length>4000||scene.motion.length>2000))throw Error('AI did not return the requested scene plan. Your draft was preserved.');
     draft.scenes=planned.scenes.map(scene=>({...Object.fromEntries(fields.map(name=>[name,scene[name]])),image_id:'',seconds}));draft.continuity=planned.continuity;persistDraft();renderScenes();notice(count+' AI scenes created. Review the narration, action and individual durations.');
    }catch(error){notice(error.message,true);}
    finally{split.disabled=false;split.textContent='Generate with AI';}
   }});
  };
  const save=q('#save-board');save.textContent='Save & Continue to Create Voices and Sounds';save.classList.add('storyboard-save-continue');save.parentElement.classList.add('storyboard-save-row');
  save.onclick=()=>{
   if(window.EccoStoryJourneys?.current()&&window.EccoJourneyFlow){window.EccoJourneyFlow.advance('audio',save);return;}
   try{
    localStorage.setItem(activeStory?'ecco-board-draft:'+activeStory:'ecco-board-new-draft',JSON.stringify(draft));
    savedBoard=null;navigate('audio');
   }catch(error){notice('Could not save the storyboard draft: '+error.message,true);}
  };
 }
 new MutationObserver(mount).observe(q('#page'),{childList:true,subtree:true});mount();
})();



