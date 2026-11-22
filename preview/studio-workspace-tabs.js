'use strict';
/* Shared right-hand workspace navigation; retain original forms and media nodes. */
(()=>{
 const choices=new Map(),q=s=>document.querySelector(s);
 function bind(root,kind,panels){
  const nav=document.createElement('div');nav.className='studio-workspace-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label',kind+' workspace');
  const names={script:'Final Script',progress:'Progress',review:'Review'},key=kind+':'+activeStory;
  function select(name,focus=false){choices.set(key,name);for(const tab of nav.children){const yes=tab.dataset.workspaceTab===name;tab.setAttribute('aria-selected',String(yes));tab.tabIndex=yes?0:-1;panels[tab.dataset.workspaceTab].hidden=!yes;if(yes&&focus)tab.focus();}}
  Object.entries(panels).forEach(([name,panel],i)=>{const tab=document.createElement('button');tab.type='button';tab.id=kind+'-workspace-tab-'+name;tab.dataset.workspaceTab=name;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panel.id);tab.textContent=names[name];panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);panel.tabIndex=0;tab.onclick=()=>select(name);tab.onkeydown=e=>{const n=e.key==='ArrowRight'?(i+1)%3:e.key==='ArrowLeft'?(i+2)%3:e.key==='Home'?0:e.key==='End'?2:null;if(n!==null){e.preventDefault();select(Object.keys(panels)[n],true);}};nav.append(tab);});
  root.prepend(nav);select(choices.get(key)||'script');return select;
 }
 function mount(kind){
  const form=q('#'+kind+'-form'),gallery=q('#'+kind+'-gallery');if(!form||!gallery||form.dataset.workspaceTabs)return;
  const host=gallery.parentElement;if(!host||host===form)return;form.dataset.workspaceTabs='true';host.classList.add('studio-workspace');
  const review=document.createElement('section');review.id=kind+'-review-panel';review.append(...host.childNodes);
  const script=document.createElement('section');script.id=kind+'-final-script-panel';script.className='form';
  const progress=document.createElement('section');progress.id=kind+'-progress-panel';progress.innerHTML='<span class="generation-spinner" data-workspace-spinner hidden aria-hidden="true"></span><div data-workspace-status role="status" aria-live="polite"></div>';
  host.append(script,progress,review);const select=bind(host,kind,{script,progress,review});
  form.addEventListener('submit',()=>select('progress'));
  if(kind==='image'){
   script.innerHTML='<label>Image prompt<textarea data-final-image-prompt rows="8" maxlength="4000"></textarea></label><details><summary>Full generation prompt</summary><pre data-composed-prompt></pre></details><button type="button" class="secondary" data-edit-prompt>Generate / Improve with AI</button>';
   script.querySelector('[data-final-image-prompt]').oninput=e=>{const source=window.EccoGeneration?.context(form)?.prompt?.querySelector('[data-generation-prompt]');if(source){source.value=e.target.value;source.dispatchEvent(new Event('input',{bubbles:true}));}};
   script.querySelector('[data-edit-prompt]').onclick=()=>form.querySelector('[data-open-prompt]')?.click();
  }else script.innerHTML='<section data-final-speech class="form"><div class="section-head"><h3>Audio script</h3><button type="button" class="secondary" data-edit-speech>Edit</button></div><textarea readonly rows="5" aria-label="Final audio script"></textarea></section><div data-final-shots class="form"></div>';
  if(kind==='video')script.querySelector('[data-edit-speech]').onclick=()=>q('#video-flow [data-open-script]')?.click();
 }
 function refresh(){
  const audio=q('#audio-review-results [role=tablist]');if(audio&&!audio.classList.contains('studio-workspace-tabs')){audio.classList.add('studio-workspace-tabs');audio.classList.remove('audio-speaker-tabs');for(const tab of audio.children)tab.classList.remove('secondary');}
  for(const kind of ['image','video']){
   mount(kind);const form=q('#'+kind+'-form'),panel=q('#'+kind+'-final-script-panel');if(!form||!panel)continue;
   const status=form.querySelector('#'+kind+'-status'),mirror=q('#'+kind+'-progress-panel [data-workspace-status]');
   if(status&&mirror){status.dataset.studioStatusSource='';if(mirror.innerHTML!==status.innerHTML)mirror.innerHTML=status.innerHTML;}
   const spinner=q('#'+kind+'-progress-panel [data-workspace-spinner]'),busy=q('#generate-'+kind)?.getAttribute('aria-busy')==='true';if(spinner)spinner.hidden=!busy;
   if(kind==='video'){const controls=q('#video-sequence-controls'),progress=q('#video-progress-panel');if(controls&&controls.parentElement!==progress)progress.append(controls);}
   if(kind==='image'){
    const c=window.EccoGeneration?.context(form),source=c?.prompt?.querySelector('[data-generation-prompt]'),edit=panel.querySelector('[data-final-image-prompt]');
    if(source&&document.activeElement!==edit&&edit.value!==source.value)edit.value=source.value;
    const text=c&&source?window.EccoGeneration.compose(c,source.value):'',pre=panel.querySelector('[data-composed-prompt]');if(pre.textContent!==text)pre.textContent=text;
   }else{
    const plan=q('#video-flow')?.eccoFinalScript?.();if(!plan)continue;
    const speech=panel.querySelector('[data-final-speech]');speech.hidden=!plan.speech;if(speech.querySelector('textarea').value!==plan.speech)speech.querySelector('textarea').value=plan.speech;
    const shots=panel.querySelector('[data-final-shots]'),signature=JSON.stringify(plan.shots.map(({edit,...shot})=>shot));
    if(shots.dataset.signature!==signature){shots.dataset.signature=signature;shots.replaceChildren();for(const [i,shot] of plan.shots.entries()){const section=document.createElement('section');section.className='form';const head=document.createElement('div');head.className='section-head';const title=document.createElement('h3');title.textContent=(i+1)+'. '+shot.title+' · '+shot.seconds+'s';const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Shot Controls';button.onclick=shot.edit;head.append(title,button);const text=document.createElement('p');text.textContent=shot.prompt;section.append(head,text);shots.append(section);}}
   }
  }
 }
 let queued=false;function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;refresh();});}
 new MutationObserver(schedule).observe(q('#page'),{childList:true,subtree:true});
 document.addEventListener('input',schedule);document.addEventListener('change',schedule);setInterval(refresh,1000);schedule();
})();
