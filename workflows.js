'use strict';
(() => {
 const q=s=>document.querySelector(s), key='ecco-workflow-drafts';
 const read=()=>{try{return JSON.parse(localStorage.getItem(key)||'[]');}catch{return [];}};
 const rows=()=>{const cloud=state.records.filter(r=>r.kind==='workflow'&&!r.deleted);return [...cloud,...read().filter(r=>!cloud.some(c=>c.id===r.id))];};
 const defaults=()=>({id:crypto.randomUUID(),name:'Daily finance news',prompt:'Get the top 10 finance news stories around the world from the last 24 hours. Write one factual news segment per item, with source links.',count:10,duration:120,time:'05:00',timezone:'America/Los_Angeles',avatar_id:'',voice:'',channel:'',schedule_requested:false,status:'draft'});
 const images=()=>state.records.filter(r=>r.kind==='asset'&&r.media==='image'&&!r.deleted);
 const videos=()=>state.records.filter(r=>r.kind==='asset'&&r.media==='video'&&r.stage==='prod'&&!r.deleted);
 function localSave(data){const list=read().filter(r=>r.id!==data.id);list.push(data);localStorage.setItem(key,JSON.stringify(list));}
 function options(list,value){return '<option value="">Choose</option>'+list.map(a=>'<option value="'+esc(a.id)+'" '+(a.id===value?'selected':'')+'>'+esc(a.title||a.prompt||a.id)+'</option>').join('');}
 function show(id){
  page='workflow-library';q('#heading').textContent='Workflow Library';
  const w=rows().find(r=>r.id===id)||defaults();
  q('#page').innerHTML='<div class="section-head"><h2>'+esc(w.name)+'</h2><button type="button" id="workflow-new" class="secondary">New workflow</button></div><form id="workflow-form" class="form panel"><label>Name<input name="name" required maxlength="160"></label><label>Research / story instructions<textarea name="prompt" rows="4" required></textarea></label><div class="row"><label>News items / scenes<input name="count" type="number" min="1" max="60"></label><label>Total seconds<input name="duration" type="number" min="10" max="1800"></label></div><label>Avatar from Image Library<select name="avatar_id"></select></label><label>Voice / language<input name="voice" placeholder="English news presenter"></label><label>YouTube channel<input name="channel" placeholder="Channel URL or ID"></label><details><summary>Schedule and automation</summary><div class="row"><label>Daily at<input name="time" type="time"></label><label>Timezone<select name="timezone"><option value="America/Los_Angeles">Pacific local time (changes with daylight saving)</option><option value="Etc/GMT+8">PST fixed UTC−8</option><option value="UTC">UTC</option></select></label></div><label>Approved quality sample<select name="approved_video_id"></select></label><label style="display:flex;flex-direction:row;gap:8px"><input name="schedule_requested" type="checkbox" style="width:auto">Request unattended generation and publishing after services are connected</label><p class="help">Not scheduled. Audio, avatar lip-sync, video assembly and the automation runner must be connected before unattended publishing can run.</p></details><div class="row"><button type="submit">Save workflow</button><button type="button" class="secondary" id="workflow-start">Start this story</button></div><p role="status" id="workflow-save-status"></p></form><section class="panel"><h3>Workflow</h3><p>Research → review 10 scenes → scene audio → avatar video → approve sample → YouTube</p><p class="help">10 items in 1–2 minutes gives each item about 6–12 seconds. Longer narration needs more time.</p></section>';
  const form=q('#workflow-form');form.elements.avatar_id.innerHTML=options(images(),w.avatar_id);form.elements.approved_video_id.innerHTML=options(videos(),w.approved_video_id);
  for(const [name,value]of Object.entries(w))if(form.elements[name]){if(form.elements[name].type==='checkbox')form.elements[name].checked=!!value;else form.elements[name].value=value;}
  const data=()=>({...w,...Object.fromEntries(new FormData(form)),count:+form.elements.count.value,duration:+form.elements.duration.value,schedule_requested:form.elements.schedule_requested.checked});
  form.oninput=()=>{localSave(data());q('#workflow-save-status').textContent='Draft saved in this browser. Not scheduled.';};
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;try{
   const value=data();localSave(value);
   if(!state.config.workflows?.available)throw Error('Workflow draft saved in this browser. Workspace saving requires the workflow backend update; no schedule is running.');
   const saved=await api('workflows/save',{...value,id:state.records.some(r=>r.id===value.id&&r.kind==='workflow')?value.id:undefined});
   localStorage.setItem(key,JSON.stringify(read().filter(r=>r.id!==value.id)));await refresh();show(saved.id);
   q('#workflow-save-status').textContent='Saved to workspace. Automation blocked until the required services are connected.';
  }catch(error){notice(error.message,true);}finally{button.disabled=false;}};
  q('#workflow-new').onclick=()=>show();
  q('#workflow-start').onclick=async()=>{if(!form.reportValidity())return;const value=data();localSave(value);const button=q('#workflow-start');button.disabled=true;try{
   const created=await api('stories',{title:value.name,summary:value.prompt});await refresh();activeStory=created.id;localStorage.setItem('ecco-active-story',activeStory);
   draft={title:value.name,story:value.prompt,scenes:[],defaultSeconds:value.duration/value.count,workflow:value};persistDraft();navigate('board');
  }catch(error){notice(error.message,true);}finally{button.disabled=false;}};
 }
 function nav(){
  const root=q('#workspace-library-group>.workspace-library-content');if(!root)return;
  let group=q('#workflow-library');if(!group){group=document.createElement('details');group.id='workflow-library';group.className='workspace-library';group.style.order='0';group.innerHTML='<summary><span class="library-symbol"></span><span>Workflow Library</span></summary><div class="workspace-library-content"></div>';root.prepend(group);group.querySelector('summary').addEventListener('click',()=>{if(!group.open)show();});}
  const signature=JSON.stringify(rows().map(w=>[w.id,w.name]));if(group.dataset.signature!==signature){group.dataset.signature=signature;const content=group.querySelector('div');content.replaceChildren();for(const w of rows()){const b=document.createElement('button');b.type='button';b.className='tree-folder';b.textContent='− '+w.name;b.onclick=()=>show(w.id);content.append(b);}const b=document.createElement('button');b.type='button';b.className='tree-folder';b.textContent='+ New workflow';b.onclick=()=>show();content.append(b);}
 }
 function genres(){
  const form=q('#story-setup-form'),select=form?.elements.genre;if(!select||form.querySelector('[data-custom-genre]'))return;
  let saved=[];try{saved=JSON.parse(localStorage.getItem('ecco-custom-genres')||'[]');}catch{}
  saved.forEach(value=>{if(![...select.options].some(o=>o.value===value))select.add(new Option(value,value),select.options.length-1);});
  const wrap=document.createElement('div');wrap.dataset.customGenre='true';wrap.innerHTML='<label>Custom type<input name="custom_genre" maxlength="80" placeholder="For example, Finance news"></label><button type="button" class="secondary">Add to dropdown</button>';select.closest('label').after(wrap);
  const update=()=>{wrap.hidden=select.value!=='Other';wrap.querySelector('input').required=!wrap.hidden;};
  select.addEventListener('change',update);update();
  try{const existing=JSON.parse(localStorage.getItem(form.dataset.draftKey)||'{}');wrap.querySelector('input').value=existing.custom_genre||'';if([...select.options].some(o=>o.value===existing.genre))select.value=existing.genre;update();}catch{}
  wrap.querySelector('button').onclick=()=>{const value=wrap.querySelector('input').value.trim();if(!value)return notice('Enter a custom type.',true);if(!saved.includes(value)){saved.push(value);localStorage.setItem('ecco-custom-genres',JSON.stringify(saved));select.add(new Option(value,value),select.options.length-1);}select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));};
  const research=document.createElement('button');research.type='button';research.className='secondary';research.textContent='Research news & create storyboard';form.elements.summary.closest('label').after(research);
  research.onclick=()=>researchNews({prompt:form.elements.summary.value,count:10,duration:120,title:form.elements.title.value},research);
 }
 async function researchNews(settings,button){
  if(!settings.prompt.trim())return notice('Enter your news instructions first.',true);
  if(!state.config.workflows?.news_research)return notice('News research requires the workflow backend update. Your instructions are preserved.',true);
  if(!window.EccoAI?.enabled)return window.EccoAI?.connections();
  button.disabled=true;const old=button.textContent;button.textContent='Researching news…';
  try{
   const result=await api('news/research',settings);
   const created=await api('stories',{title:settings.title||result.title,summary:result.summary});await refresh();
   activeStory=created.id;localStorage.setItem('ecco-active-story',activeStory);
   draft={title:settings.title||result.title,story:result.scenes.map(s=>s.narration).join('\n\n'),scenes:result.scenes,workflow:settings,defaultSeconds:settings.duration/settings.count};persistDraft();navigate('board');
  }catch(error){notice(error.message,true);}finally{button.disabled=false;button.textContent=old;}
 }
 function board(){
  if(!q('#scene-count-controls')||q('#workflow-research'))return;
  const b=document.createElement('button');b.id='workflow-research';b.type='button';b.className='secondary';b.textContent='Research current news';q('#scene-count-controls').append(b);
  b.onclick=()=>researchNews({...draft.workflow,prompt:draft.workflow?.prompt||draft.story,title:draft.title,count:draft.scenes.length||draft.workflow?.count||10,duration:draft.workflow?.duration||120},b);
 }
 function sourceLinks(){
  const root=q('#scenes');if(!root)return;
  root.querySelectorAll('.scene').forEach((card,i)=>{const scene=draft.scenes[i];if(!scene||card.querySelector('[data-scene-next]'))return;
   const footer=document.createElement('div');footer.dataset.sceneNext='true';footer.className='row';
   for(const source of scene.sources||[]){if(!/^https?:\/\//.test(source.url))continue;const a=document.createElement('a');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=source.title||source.url;footer.append(a);}
   const audio=document.createElement('button');audio.type='button';audio.className='secondary';audio.textContent='Use scene for audio';audio.onclick=()=>{sessionStorage.setItem('ecco-audio-scene-transfer',String(i));navigate('audio');};footer.append(audio);card.append(footer);
  });
 }
 function audioTransfer(){
  const value=sessionStorage.getItem('ecco-audio-scene-transfer'),box=q('#scene-audio-source');if(value===null||!box)return;
  sessionStorage.removeItem('ecco-audio-scene-transfer');box.querySelector('select').value=value;box.querySelector('button').click();
 }
 let pending=false;
 function mount(){nav();genres();board();sourceLinks();audioTransfer();}
 new MutationObserver(()=>{if(pending)return;pending=true;queueMicrotask(()=>{pending=false;mount();});}).observe(document.body,{childList:true,subtree:true});
 mount();window.EccoWorkflows={show};
})();
