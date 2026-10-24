'use strict';
(() => {
 const q=s=>document.querySelector(s), key='ecco-workflow-drafts';
 const read=()=>{try{return JSON.parse(localStorage.getItem(key)||'[]');}catch{return [];}};
 const rows=()=>{const removed=new Set(window.EccoWorkspaceUI.localTrashItems().filter(item=>item.kind==='workflow').map(item=>item.id)),cloud=state.records.filter(r=>r.kind==='workflow'&&!r.deleted);return [...cloud.map(c=>{const local=read().find(r=>r.id===c.id&&r.unsaved_changes&&r.updated>c.updated);return local||c;}),...read().filter(r=>!cloud.some(c=>c.id===r.id))].filter(row=>!removed.has(row.id));};
 const defaults=()=>({id:crypto.randomUUID(),name:'',prompt:'',count:10,duration:120,time:'05:00',timezone:'America/Los_Angeles',avatar_id:'',voice:'',channel:'',schedule_requested:false,status:'draft'});
 const images=()=>state.records.filter(r=>r.kind==='asset'&&r.media==='image'&&!r.deleted);
 const videos=()=>state.records.filter(r=>r.kind==='asset'&&r.media==='video'&&r.stage==='prod'&&!r.deleted);
 function localSave(data){const list=read().filter(r=>r.id!==data.id);list.push(data);localStorage.setItem(key,JSON.stringify(list));}
 function options(list,value){return '<option value="">Choose</option>'+list.map(a=>'<option value="'+esc(a.id)+'" '+(a.id===value?'selected':'')+'>'+esc(a.title||a.prompt||a.id)+'</option>').join('');}
 async function removeWorkflow(id){const workflow=rows().find(row=>row.id===id);if(!workflow)return;if(workflow.workflow_type==='audio'&&state.records.some(r=>r.id===id&&r.kind==='workflow')){try{await api('audio/workflows/control',{id,action:'pause'});await refresh();}catch(error){notice('Could not pause this schedule; it has not been removed. '+error.message,true);return;}}window.EccoWorkspaceUI.trashLocalItem('workflow',id,workflow.name||'Untitled workflow',workflow);nav();showLibrary();notice('Workflow moved to this browser’s Trash.');}
 function showLibrary(){
  document.body.classList.remove('workspace-entry-mode');q('#workspace-entry')?.remove();page='workflow-library';q('#heading').textContent='Workflow Library';
  q('#page').innerHTML='<div class="section-head"><h2>Workflow Library</h2><div class="row"><label class="library-view-label"><select id="workflow-library-view" aria-label="Workflow library view"><option value="small">Small icons</option><option value="large">Large icons</option><option value="list">List</option></select></label><button type="button" class="secondary" id="workflow-library-new">New Workflow</button></div></div><div id="workflow-library-list" class="cards text-library-gallery"></div>';
  const gallery=q('#workflow-library-list'),view=q('#workflow-library-view');
  for(const workflow of rows())gallery.append(window.EccoWorkspaceUI.libraryCard({id:workflow.id,title:workflow.name||'Untitled workflow',kind:'workflow',open:()=>show(workflow.id),remove:()=>removeWorkflow(workflow.id)}));
  if(!rows().length)gallery.innerHTML='<p class="help">No saved workflows.</p>';
  view.value=localStorage.getItem('ecco-workflow-library-view')||'small';if(!view.value)view.value='small';
  const apply=()=>{gallery.className='cards text-library-gallery library-'+view.value;localStorage.setItem('ecco-workflow-library-view',view.value);};view.onchange=apply;apply();
  q('#workflow-library-new').onclick=()=>show();
 }
 function show(id){
  const audioWorkflow=rows().find(r=>r.id===id&&r.workflow_type==='audio');if(audioWorkflow&&window.EccoAudioWorkflow)return window.EccoAudioWorkflow.show(audioWorkflow);
  page='workflow-detail';q('#heading').textContent='Workflow';
  const w=rows().find(r=>r.id===id)||defaults();
  q('#page').innerHTML='<div class="section-head"><h2>'+esc(w.name||'New Workflow')+'</h2><button type="button" id="workflow-new" class="secondary">New workflow</button></div><form id="workflow-form" class="form panel"><label>Name<input name="name" required maxlength="160"></label><label>Research / story instructions<textarea name="prompt" rows="4" required></textarea></label><div class="row"><label>News items / scenes<input name="count" type="number" min="1" max="60"></label><label>Total seconds<input name="duration" type="number" min="10" max="1800"></label></div><div><button type="button" class="secondary" id="workflow-avatar-picker">Avatar from Image Library</button><p id="workflow-avatar-summary" class="help"></p></div><label>Voice / language<input name="voice" type="hidden"><details id="workflow-voice" class="story-type-dropdown"><summary>Choose voice / language</summary><div class="story-type-options"><div data-voice-options></div><div data-voice-custom hidden><input type="text" maxlength="160" placeholder="Enter voice / language" aria-label="Custom voice / language"><div class="row"><button type="button" class="secondary" data-use>Use once</button><button type="button" class="secondary" data-remember>Add to dropdown</button></div></div></div></details></label><label>YouTube channel<input name="channel" placeholder="Channel URL or ID"></label><details><summary>Schedule and automation</summary><div class="row"><label>Daily at<input name="time" type="time"></label><label>Timezone<select name="timezone"><option value="America/Los_Angeles">Pacific local time (changes with daylight saving)</option><option value="Etc/GMT+8">PST fixed UTC−8</option><option value="UTC">UTC</option></select></label></div><label>Approved quality sample<select name="approved_video_id"></select></label><label style="display:flex;flex-direction:row;gap:8px"><input name="schedule_requested" type="checkbox" style="width:auto">Request unattended generation and publishing after services are connected</label></details><div class="row"><button type="submit">Save workflow</button><button type="button" class="secondary" id="workflow-start">Start this story</button></div><p role="status" id="workflow-save-status"></p></form><section class="panel"><h3>Workflow</h3><p>Research → review 10 scenes → scene audio → avatar video → approve sample → YouTube</p></section>';
  let avatarIds=[...new Set(Array.isArray(w.avatar_ids)?w.avatar_ids:[w.avatar_id].filter(Boolean))];
  const form=q('#workflow-form');form.elements.approved_video_id.innerHTML=options(videos(),w.approved_video_id);
  for(const [name,value]of Object.entries(w))if(form.elements[name]){if(form.elements[name].type==='checkbox')form.elements[name].checked=!!value;else form.elements[name].value=value;}
  const data=()=>({...w,...Object.fromEntries(new FormData(form)),avatar_ids:[...avatarIds],avatar_id:avatarIds[0]||'',count:+form.elements.count.value,duration:+form.elements.duration.value,schedule_requested:form.elements.schedule_requested.checked});
  form.oninput=()=>{localSave(data());q('#workflow-save-status').textContent='Draft saved in this browser. Not scheduled.';};
  voiceDropdown(form);
  const avatarSummary=()=>{q('#workflow-avatar-summary').textContent=avatarIds.length?avatarIds.length+' selected · '+avatarIds.map(id=>images().find(a=>a.id===id)?.title||'Unavailable image').join(', '):'No images selected';};avatarSummary();
  q('#workflow-avatar-picker').onclick=()=>pickAvatars(avatarIds,ids=>{avatarIds=ids;avatarSummary();form.oninput();});
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


 function voiceDropdown(form){
  const control=form.querySelector('#workflow-voice'),summary=control.querySelector('summary'),list=control.querySelector('[data-voice-options]'),editor=control.querySelector('[data-voice-custom]'),input=editor.querySelector('input'),field=form.elements.voice;
  const languages=['Hindi','Urdu','English','Tamil','Punjabi','Assamese','Bengali','Bodo','Dogri','Gujarati','Kannada','Kashmiri','Konkani','Maithili','Malayalam','Manipuri','Marathi','Nepali','Odia','Sanskrit','Santali','Sindhi','Telugu'],presets=languages.flatMap(language=>['Voice A · feminine','Voice B · masculine'].map(voice=>language+' — '+voice));
  let saved=[];try{const value=JSON.parse(localStorage.getItem('ecco-custom-workflow-voices')||'[]');if(Array.isArray(value))saved=value.filter(v=>typeof v==='string');}catch{}
  const update=()=>{summary.textContent=field.value||'Choose voice / language';};
  const choose=value=>{field.value=value;update();control.open=false;editor.hidden=true;field.dispatchEvent(new Event('input',{bubbles:true}));summary.focus();};
  function render(){
   list.replaceChildren();
   for(const value of [...new Set([...presets,...saved,...(field.value?[field.value]:[])])]){
    const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=value;button.onclick=()=>choose(value);list.append(button);
   }
   const add=document.createElement('button');add.type='button';add.className='secondary';add.textContent='Other…';add.onclick=()=>{editor.hidden=false;input.focus();};list.append(add);
  }
  const use=remember=>{const value=input.value.trim();if(!value)return input.focus();if(remember&&!saved.includes(value)){saved.push(value);localStorage.setItem('ecco-custom-workflow-voices',JSON.stringify(saved));}choose(value);render();};
  editor.querySelector('[data-use]').onclick=()=>use(false);editor.querySelector('[data-remember]').onclick=()=>use(true);
  input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();use(false);}};
  control.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();control.open=false;summary.focus();}};
  document.addEventListener('click',event=>{if(control.isConnected&&!control.contains(event.target))control.open=false;});render();update();
 }

 function pickAvatars(selected,onSelect){
  q('#workflow-avatar-dialog')?.remove();
  const dialog=document.createElement('dialog');dialog.id='workflow-avatar-dialog';dialog.setAttribute('aria-label','Choose avatar images');
  dialog.style.cssText='width:min(900px,92vw);max-height:85vh;overflow:auto';
  dialog.innerHTML='<div class="form"><div class="section-head"><h2>Image Library</h2><button type="button" class="secondary" data-cancel>×</button></div><p>Select one or more images.</p><div data-tree></div><div class="row"><button type="button" data-apply>Use selected images</button><button type="button" class="secondary" data-cancel>Cancel</button><span data-count role="status"></span></div></div>';
  document.body.append(dialog);
  const available=images(),chosen=new Set(selected.filter(id=>available.some(a=>a.id===id)));
  const folders=state.records.filter(r=>r.kind==='image_folder'&&!r.deleted).sort((a,b)=>a.created-b.created||a.id.localeCompare(b.id));
  const byName=new Map(folders.map(f=>[f.name,f])),parent=f=>byName.get(f.name.split(' / ').slice(0,-1).join(' / '));
  const links=state.records.filter(r=>r.kind==='library_item'&&!r.deleted),inputs=[];
  const count=()=>{dialog.querySelector('[data-count]').textContent=chosen.size+' selected';for(const input of inputs)input.checked=chosen.has(input.value);};
  const addImages=(items,body)=>{const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px';body.append(grid);
   for(const asset of items.sort((a,b)=>a.created-b.created)){
    const label=document.createElement('label');label.style.cssText='display:flex;flex-direction:column;gap:6px;cursor:pointer;padding:8px;background:#38305e;border-radius:8px';
    const input=document.createElement('input');input.type='checkbox';input.value=asset.id;input.style.width='auto';input.setAttribute('aria-label',asset.title||'Untitled image');inputs.push(input);
    const thumb=document.createElement('img');thumb.src=media(asset);thumb.alt='';thumb.loading='lazy';thumb.style.cssText='width:100%;height:120px;object-fit:contain';
    const title=document.createElement('span');title.textContent=asset.title||'Untitled image';
    input.onchange=()=>{input.checked?chosen.add(asset.id):chosen.delete(asset.id);count();};label.append(input,thumb,title);grid.append(label);
   }
  };
  const append=(folder,container)=>{const group=document.createElement('details');group.className='workspace-library';group.open=true;const summary=document.createElement('summary');summary.textContent=parent(folder)?folder.name.split(' / ').at(-1):folder.name;group.append(summary);
   const body=document.createElement('div');body.className='workspace-library-content';group.append(body);
   for(const child of folders.filter(f=>parent(f)?.id===folder.id))append(child,body);
   const ids=new Set(links.filter(l=>l.folder_id===folder.id).map(l=>l.asset_id));addImages(available.filter(a=>ids.has(a.id)),body);container.append(group);
  };
  const tree=dialog.querySelector('[data-tree]');for(const f of folders.filter(f=>!parent(f)))append(f,tree);
  const labeled=new Set(links.filter(l=>folders.some(f=>f.id===l.folder_id)).map(l=>l.asset_id)),unlabeled=available.filter(a=>!labeled.has(a.id));
  if(unlabeled.length){const heading=document.createElement('h3');heading.textContent='Unlabelled images';tree.append(heading);addImages(unlabeled,tree);}
  if(!available.length)tree.textContent='No images in your library yet.';
  dialog.querySelectorAll('[data-cancel]').forEach(b=>{b.setAttribute('aria-label',b.textContent==='×'?'Close image library':'Cancel');b.onclick=()=>dialog.close();});
  dialog.querySelector('[data-apply]').onclick=()=>{onSelect([...chosen]);dialog.close();};
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});count();dialog.showModal();
 }

 function nav(){
  const root=q('#workspace-library-group>.workspace-library-content');if(!root)return;
  let group=q('#workflow-library');if(!group){group=document.createElement('details');group.id='workflow-library';group.className='workspace-library';group.style.order='0';group.innerHTML='<summary><span class="library-symbol"></span><span>Workflow Library</span></summary><div class="workspace-library-content"></div>';root.prepend(group);group.querySelector('summary').addEventListener('click',()=>{showLibrary();});}
  const signature=JSON.stringify(rows().map(w=>[w.id,w.name]));if(group.dataset.signature!==signature){group.dataset.signature=signature;const content=group.querySelector('div');content.replaceChildren();for(const w of rows()){const item=window.EccoWorkspaceUI.libraryCard({id:w.id,title:w.name||'Untitled workflow',kind:'workflow',compact:true,open:()=>show(w.id),remove:()=>removeWorkflow(w.id)});item.querySelector('.text-library-open').classList.add('tree-folder');content.append(item);}const b=document.createElement('button');b.type='button';b.className='tree-folder';b.textContent='New workflow';b.onclick=()=>show();content.append(b);}
 }
 function genres(){
  const form=q('#story-setup-form'),select=form?.elements.genre;if(!select||form.querySelector('[data-custom-genre]'))return;
  let saved=[];try{saved=JSON.parse(localStorage.getItem('ecco-custom-genres')||'[]');}catch{}
  saved.forEach(value=>{if(![...select.options].some(o=>o.value===value))select.add(new Option(value,value),select.options.length-1);});
  const wrap=document.createElement('details');wrap.dataset.customGenre='true';wrap.className='story-type-dropdown';
  wrap.innerHTML='<summary aria-label="Story type"></summary><div class="story-type-options"><div data-types></div><div data-custom-entry hidden><input name="custom_genre" maxlength="80" placeholder="Enter a custom type" aria-label="Custom story type"><div class="row"><button type="button" class="secondary" data-use>Use once</button><button type="button" class="secondary" data-remember>Add to dropdown</button></div></div></div>';
  select.hidden=true;select.style.display='none';select.after(wrap);
  const summary=wrap.querySelector('summary'),choices=wrap.querySelector('[data-types]'),entry=wrap.querySelector('[data-custom-entry]'),input=entry.querySelector('input');
  let existing={};try{existing=JSON.parse(localStorage.getItem(form.dataset.draftKey)||'{}');}catch{}
  input.value=existing.custom_genre||'';
  if([...select.options].some(o=>o.value===existing.genre))select.value=existing.genre;
  const update=()=>{summary.textContent=select.value==='Other'&&input.value.trim()?input.value.trim():select.selectedOptions[0]?.textContent||'Select a genre';input.required=select.value==='Other';};
  const choose=value=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));update();};
  function renderOptions(){
   choices.replaceChildren();
   [...select.options].filter(o=>o.value).forEach(option=>{const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=option.textContent;button.onclick=()=>{
    if(option.value==='Other'){choose('Other');entry.hidden=false;input.focus();}
    else{choose(option.value);entry.hidden=true;wrap.open=false;summary.focus();}
   };choices.append(button);});
  }
  const use=remember=>{const value=input.value.trim();if(!value)return input.focus();
   if(remember){if(!saved.includes(value)){saved.push(value);localStorage.setItem('ecco-custom-genres',JSON.stringify(saved));}if(![...select.options].some(o=>o.value===value))select.add(new Option(value,value),select.options.length-1);renderOptions();choose(value);}
   else choose('Other');
   wrap.open=false;summary.focus();
  };
  entry.querySelector('[data-use]').onclick=()=>use(false);entry.querySelector('[data-remember]').onclick=()=>use(true);
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();use(false);}});
  wrap.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();wrap.open=false;summary.focus();}});
  document.addEventListener('click',event=>{if(wrap.isConnected&&!wrap.contains(event.target))wrap.open=false;});
  select.addEventListener('change',update);entry.hidden=select.value!=='Other';renderOptions();update();

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
 function audioTransfer(){
  const value=sessionStorage.getItem('ecco-audio-scene-transfer'),box=q('#scene-audio-source');if(value===null||!box)return;
  sessionStorage.removeItem('ecco-audio-scene-transfer');box.querySelector('select').value=value;box.querySelector('button').click();
 }
 let pending=false;
 function mount(){nav();genres();audioTransfer();}
 new MutationObserver(()=>{if(pending)return;pending=true;queueMicrotask(()=>{pending=false;mount();});}).observe(document.body,{childList:true,subtree:true});
 mount();window.EccoWorkflows={show,showLibrary};
 const previousNavigate=navigate;navigate=function(target,...args){if(target==='workflow-library')return showLibrary();return previousNavigate(target,...args);};
})();


