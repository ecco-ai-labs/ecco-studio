'use strict';
(() => {
 const q=s=>document.querySelector(s),key='ecco-story-collections-v1';
 const read=()=>{try{return JSON.parse(localStorage.getItem(key))||{collections:[],members:{}};}catch{return {collections:[],members:{}};}};
 let selected=localStorage.getItem('ecco-selected-collection')||'';
 const save=data=>localStorage.setItem(key,JSON.stringify(data));
 function assign(id,collection){const data=read();if(collection&&data.collections.some(c=>c.id===collection))data.members[id]=collection;else delete data.members[id];save(data);}
 function titleName(story){try{return JSON.parse(localStorage.getItem('ecco-board-draft:'+story.id)||'{}').title||story.title;}catch{return story.title;}}
 function createStory(select){
  const dialog=document.createElement('dialog');dialog.innerHTML='<form class="form"><h2>New Story</h2><label>Story name<input name="name" required maxlength="160" autofocus></label><div class="row"><button type="submit">Create</button><button type="button" class="secondary" data-cancel>Cancel</button></div></form>';
  document.body.append(dialog);dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
  dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const name=e.target.elements.name.value.trim();if(!name)return;const data=read(),existing=data.collections.find(c=>c.name.toLowerCase()===name.toLowerCase());selected=existing?.id||crypto.randomUUID();if(!existing)data.collections.push({id:selected,name});save(data);localStorage.setItem('ecco-selected-collection',selected);options(select,selected,select.dataset.emptyLabel);select.dispatchEvent(new Event('change',{bubbles:true}));dialog.close();};dialog.showModal();
 }
 function options(select,value,empty='Choose a Story'){
  select.replaceChildren(new Option(empty,''));for(const c of read().collections)select.add(new Option(c.name,c.id));select.add(new Option('+ New Story','__new_story__'));select.value=value||'';select.dataset.previous=select.value;select.dataset.emptyLabel=empty;
  if(!select.dataset.createBound){select.dataset.createBound='1';const handle=e=>{if(select.value==='__new_story__'){e.stopImmediatePropagation();select.value=select.dataset.previous||'';createStory(select);}else select.dataset.previous=select.value;};select.addEventListener('input',e=>{if(select.value==='__new_story__')e.stopImmediatePropagation();});select.addEventListener('change',handle);}
 }
 function selectTitle(id){persistDraft();activeStory=id;localStorage.setItem('ecco-active-story',id);draft=loadDraft();selected=read().members[id]||'';localStorage.setItem('ecco-selected-collection',selected);storyControls();navigate('board');}
 function show(){
  page='story-collections';q('#heading').textContent='Story';
  document.querySelectorAll('.journey-step').forEach(b=>b.classList.toggle('active',b.dataset.page==='story-collections'));
  const data=read();q('#page').innerHTML='<div class="form"><label>Story<select id="collection-select"></select></label><p class="help">Collection organization is saved in this browser. Story content stays in workspace storage.</p><div class="section-head"><h2>Story Titles</h2><button type="button" id="collection-new-title" class="secondary">New Story Title</button></div><div id="collection-titles" class="form"></div></div>';
  const picker=q('#collection-select');options(picker,selected,'Unassigned Story Titles');
  picker.onchange=()=>{selected=picker.value;localStorage.setItem('ecco-selected-collection',selected);show();};
  const list=q('#collection-titles'),titles=stories().filter(story=>(data.members[story.id]||'')===selected);
  for(const story of titles){const row=document.createElement('div');row.className='row';const open=document.createElement('button');open.type='button';open.className='secondary';open.textContent=titleName(story);open.onclick=()=>selectTitle(story.id);const move=document.createElement('select');move.setAttribute('aria-label','Story for '+story.title);options(move,data.members[story.id],'Unassigned');move.onchange=()=>{assign(story.id,move.value);show();};row.append(open,move);list.append(row);}
  if(!titles.length)list.textContent='No Story Titles here yet.';
  q('#collection-new-title').onclick=()=>{persistDraft();activeStory='';localStorage.setItem('ecco-active-story','');localStorage.removeItem('ecco-new-story-draft');navigate('story-setup');};
 }
 function mount(){
  const form=q('#story-setup-form');if(form&&!form.elements.collection_id){const label=document.createElement('label');label.textContent='Story';const picker=document.createElement('select');picker.name='collection_id';label.append(picker);form.prepend(label);let saved={};try{saved=JSON.parse(localStorage.getItem(form.dataset.draftKey)||'{}');}catch{}options(picker,saved.collection_id||selected);picker.required=true;}
  const source=q('#source-story-picker');if(source&&!q('#board-collection')){
   const label=source.closest('label');if(label.firstChild?.nodeType===3)label.firstChild.textContent='Story Title';
   const parentLabel=document.createElement('label');parentLabel.textContent='Story';const parent=document.createElement('select');parent.id='board-collection';parentLabel.append(parent);label.before(parentLabel);
   const current=read(),collection=current.members[activeStory]||'';options(parent,collection,'Unassigned');
   const update=()=>{const membership=read().members;source.replaceChildren(new Option('Choose a Story Title',''));for(const story of stories().filter(s=>(membership[s.id]||'')===parent.value))source.add(new Option(titleName(story),story.id));source.value=activeStory;};update();
   parent.onchange=()=>{selected=parent.value;localStorage.setItem('ecco-selected-collection',selected);update();const first=source.options[1];if(first)selectTitle(first.value);else show();};
   source.onchange=()=>selectTitle(source.value);
  }
 }
 window.EccoStoryCollections={assign,show};
 let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();});}).observe(document.body,{childList:true,subtree:true});mount();
})();
