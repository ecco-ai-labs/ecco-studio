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
  q('#page>.intro').textContent='Choose your scene count and timing, then use AI to adapt the story into scenes. Review and edit each scene before choosing images.';
  const controls=document.createElement('div');controls.id='scene-count-controls';controls.className='row';
  controls.innerHTML='<label>Scenes<span class="row"><button type="button" class="secondary" data-less aria-label="Remove last scene">−</button><input id="scene-count" type="number" min="0" max="60" step="1" aria-label="Number of scenes" style="width:76px"><button type="button" class="secondary" data-more aria-label="Add scene">+</button></span></label><label>All scenes (seconds)<input id="scene-default-seconds" type="number" min="1" max="30" step="1" style="width:110px"></label>';
  split.parentElement.before(controls);sync();
  const count=q('#scene-count'),seconds=q('#scene-default-seconds');
  seconds.value=Number(draft.defaultSeconds)||3;
  const safely=fn=>{try{fn();}catch(error){notice(error.message,true);sync();}};
  count.onchange=()=>safely(()=>resize(Number(count.value)));
  controls.querySelector('[data-more]').onclick=()=>safely(()=>resize(draft.scenes.length+1));
  controls.querySelector('[data-less]').onclick=()=>safely(()=>resize(Math.max(0,draft.scenes.length-1)));
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
  const selectField=element=>{
   q('#page').querySelectorAll('.ai-selected-field').forEach(el=>el.classList.remove('ai-selected-field'));
   selectedField=element;const target=element||controls;target.classList.add('ai-selected-field');
  };
  selectField(selectedField);
  q('#page').addEventListener('focusin',event=>{
   if(event.target.matches('#story-text,#board-title,#scenes textarea,#scenes input[data-subject-field]'))selectField(event.target);
   else if(controls.contains(event.target))selectField(null);
  });
  improve.onclick=()=>{toolbar.open=false;if(selectedField?.isConnected)return window.EccoAI.improveField(selectedField);notice('Select a text field to improve.',true);};
  split.onclick=async()=>{
   toolbar.open=false;
   if(selectedField?.isConnected)return window.EccoAI.generateField(selectedField);
   const count=Number(q('#scene-count').value),story=draft.story.trim(),target=activeStory;
   if(!story)return notice('Add your selected story text first.',true);
   if(count<1)return notice('Choose at least one scene using the + counter.',true);
   if(!state.config.ai_story_planner?.ready)return window.EccoAI?window.EccoAI.connections():notice('Connect to OpenAI and enable AI across Studio in Connections & Storage.',true);
   if(draft.scenes.some(scene=>scene.narration||scene.image_id)&&!confirm('Replace the scene draft with an AI adaptation? Saved revisions remain available.'))return;
   const snapshot=JSON.stringify(draft);split.disabled=true;split.textContent='Planning scenes…';
   try{
    const result=await api('stories/plan',{story,title:draft.title,count,seconds:Number(draft.defaultSeconds)||3});
    if(window.EccoAI&&!window.EccoAI.enabled)throw Error('AI was disabled during planning. Your draft was preserved.');
    if(target!==activeStory||JSON.stringify(draft)!==snapshot)throw Error('The draft changed while AI was planning. Your edits were preserved; run planning again when ready.');
    if(!Array.isArray(result.scenes)||result.scenes.length!==count)throw Error('AI did not return the requested number of scenes. Your draft was preserved.');
    draft.scenes=result.scenes;draft.continuity=result.continuity||'';persistDraft();renderScenes();notice(count+' AI scenes created. Review the narration, action and individual durations.');
   }catch(error){notice(error.message,true);}
   finally{split.disabled=false;split.textContent='Generate with AI';}
  };
  const save=q('#save-board');save.textContent='Save & Continue';save.classList.add('storyboard-save-continue');
  save.onclick=()=>{
   try{
    localStorage.setItem(activeStory?'ecco-board-draft:'+activeStory:'ecco-board-new-draft',JSON.stringify(draft));
    savedBoard=null;navigate('audio');
   }catch(error){notice('Could not save the storyboard draft: '+error.message,true);}
  };
 }
 new MutationObserver(mount).observe(q('#page'),{childList:true,subtree:true});mount();
})();

