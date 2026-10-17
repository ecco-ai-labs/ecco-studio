'use strict';
// Uses the same authenticated storage connection and presentation as the other libraries.
(() => {
 const q=s=>document.querySelector(s),records=()=>state?.records||[];
 const folders=()=>records().filter(r=>r.kind==='audio_folder'&&!r.deleted).sort((a,b)=>a.created-b.created||a.id.localeCompare(b.id));
 const audio=()=>records().filter(r=>r.kind==='asset'&&r.media==='audio'&&!r.deleted).sort((a,b)=>b.created-a.created);
 const links=()=>records().filter(r=>r.kind==='library_item'&&!r.deleted);
 const labelsFor=id=>{const ids=new Set(links().filter(r=>r.asset_id===id).map(r=>r.folder_id));return folders().filter(f=>ids.has(f.id));};
 let selected='all',treeSignature='',pageSignature='';
 const expanded=new Set();
 const signature=()=>JSON.stringify([folders(),audio(),links(),selected,Boolean(state.storage_pending)]);
 function createLabel(after,parentName=''){
  let d=q('#audio-folder-dialog');if(!d){d=document.createElement('dialog');d.id='audio-folder-dialog';document.body.append(d);}
  d.innerHTML='<form class="form"><h2>Create new label</h2><label>Label name<input name="name" required maxlength="80" autocomplete="off"></label><label>Parent label<select name="parent"><option value="">None (top level)</option>'+folders().map(f=>'<option value="'+esc(f.name)+'" '+(f.name===parentName?'selected':'')+'>'+esc(f.name.replaceAll(' / ',' → '))+'</option>').join('')+'</select></label><p role="status"></p><div class="row"><button type="submit">Create label</button><button type="button" class="secondary">Cancel</button></div></form>';
  d.querySelector('[type=button]').onclick=()=>d.close();
  d.querySelector('form').onsubmit=async e=>{
   e.preventDefault();const form=e.target,b=form.querySelector('[type=submit]');b.disabled=true;
   try{const name=form.elements.name.value.trim(),parent=form.elements.parent.value,path=[parent,name].filter(Boolean).join(' / ');
    if(!name||name.includes('/')||path.length>80)throw Error('Enter a label name without slashes, up to 80 characters including its parent.');
    const folder=await api('audio/folders',{name:path});if(folder.deleted)throw Error('This label is in Trash. Restore it or choose another name.');
    await refresh();d.close();sync();if(after)after(folder);
   }catch(error){form.querySelector('[role=status]').textContent=error.message;}finally{b.disabled=false;}
  };d.showModal();d.querySelector('input').focus();
 }
 function labelDialog(id,pending){
  const asset=audio().find(a=>a.id===id);if(!asset)return;
  let d=q('#audio-label-dialog');if(!d){d=document.createElement('dialog');d.id='audio-label-dialog';document.body.append(d);}
  const existing=new Set(labelsFor(id).map(f=>f.id)),chosen=new Set(pending?.labels||existing);
  d.innerHTML='<form class="form"><div class="section-head"><h2>Add labels</h2><button type="button" class="secondary small" data-create>Create new label</button></div><label>Audio name<input name="title" maxlength="160" required value="'+esc(pending?.title??asset.title??'')+'" placeholder="e.g. Opening narration"></label><p class="help">Choose labels to organize this audio in your library.</p><div class="workspace-label-options">'+(folders().map(f=>'<label class="workspace-label-option"><input type="checkbox" name="labels" value="'+f.id+'" '+(chosen.has(f.id)?'checked ':'')+(existing.has(f.id)?'disabled':'')+'><span>'+esc(f.name)+'</span>'+(existing.has(f.id)?'<small>Added</small>':'')+'</label>').join('')||'<p>Create your first label.</p>')+'</div><p role="status"></p><div class="row"><button type="submit">Save name & labels</button><button type="button" class="secondary" data-close>Cancel</button></div></form>';
  d.querySelector('[data-close]').onclick=()=>d.close();
  d.querySelector('[data-create]').onclick=()=>{const form=d.querySelector('form'),pending={title:form.elements.title.value,labels:[...new Set([...existing,...new FormData(form).getAll('labels')])]};createLabel(folder=>{pending.labels.push(folder.id);d.close();labelDialog(id,pending);});};
  d.querySelector('form').onsubmit=async e=>{
   e.preventDefault();const form=e.target,b=form.querySelector('[type=submit]');b.disabled=true;
   try{const title=form.elements.title.value.trim(),folder_ids=[...new Set([...existing,...new FormData(form).getAll('labels')])];
    if(!title)throw Error('Enter an audio name.');if(!folder_ids.length)throw Error('Choose at least one label.');
    await api('audio/labels',{asset_id:id,title,folder_ids});await refresh();d.close();sync();notice('Audio name and labels saved.');
   }catch(error){form.querySelector('[role=status]').textContent=error.message;}finally{b.disabled=false;}
  };d.showModal();
 }
 function uploadDialog(){
  let d=q('#audio-upload-dialog');if(!d){d=document.createElement('dialog');d.id='audio-upload-dialog';document.body.append(d);}
  d.innerHTML='<form class="form"><h2>Upload Audio</h2><label>Audio<input type="file" name="audio" accept="audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/ogg,audio/flac,.wav,.mp3,.m4a,.ogg,.flac" required></label><p class="help">WAV, MP3, M4A, OGG or FLAC · up to 12 MB.</p><audio controls hidden style="width:100%"></audio><p role="status"></p><div class="row"><button type="submit">Upload Audio</button><button type="button" class="secondary">Cancel</button></div></form>';
  let url;const preview=d.querySelector('audio');d.querySelector('[name=audio]').onchange=e=>{if(url)URL.revokeObjectURL(url);const file=e.target.files[0];preview.hidden=!file;if(file){url=URL.createObjectURL(file);preview.src=url;}};
  d.onclose=()=>{preview.pause();if(url)URL.revokeObjectURL(url);};d.querySelector('[type=button]').onclick=()=>d.close();
  d.querySelector('form').onsubmit=async e=>{
   e.preventDefault();const form=e.target,file=form.elements.audio.files[0],b=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]');if(!file)return;
   if(!file.size||file.size>12*1024*1024){status.textContent='Choose an audio file no larger than 12 MB.';return;}
   b.disabled=true;status.textContent='Uploading audio…';
   try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Could not read audio.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
    const asset=await api('audio/upload',{name:file.name,data,story_id:activeStory});await refresh();selected='all';d.close();navigate('audio-library');q('#workspace-audio-library').open=true;labelDialog(asset.id);notice('Audio uploaded. Add a name and labels.');
   }catch(error){status.textContent=error.message;}finally{b.disabled=false;}
  };d.showModal();
 }
 function tree(){
  const group=q('#workspace-library-group .workspace-library-content'),story=q('.project');if(!group||!story)return;
  let library=q('#workspace-audio-library');
  if(!library){library=document.createElement('details');library.id='workspace-audio-library';library.className='workspace-library';library.innerHTML='<summary><span class="library-symbol" aria-hidden="true"></span><span>Audio Library</span></summary><div class="workspace-library-content"></div>';group.append(library);}
  if(library.nextElementSibling!==story)story.before(library);
  const next=signature();if(next===treeSignature)return;treeSignature=next;
  const body=library.querySelector('.workspace-library-content');body.replaceChildren();
  const open=id=>{selected=id;navigate('audio-library');};
  const all=document.createElement('button');all.type='button';all.className='tree-folder';all.textContent='All audio';all.classList.toggle('selected',selected==='all'&&page==='audio-library');all.onclick=()=>open('all');body.append(all);
  const list=folders(),byName=new Map(list.map(f=>[f.name,f])),parentOf=f=>byName.get(f.name.split(' / ').slice(0,-1).join(' / '));
  function append(folder,container){
   const group=document.createElement('div');group.className='tree-label-group';const row=document.createElement('div');row.className='tree-branch-row';const children=document.createElement('div');children.className='tree-branch-children';
   const nested=list.filter(f=>parentOf(f)?.id===folder.id);
   if(nested.length){const toggle=document.createElement('button');toggle.type='button';toggle.className='tree-branch-toggle';const show=()=>{const open=expanded.has(folder.id);children.hidden=!open;toggle.textContent=open?'▾':'▸';toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',(open?'Collapse ':'Expand ')+folder.name);};toggle.onclick=()=>{if(expanded.has(folder.id))expanded.delete(folder.id);else expanded.add(folder.id);show();};show();row.append(toggle);}else{const spacer=document.createElement('span');spacer.className='tree-branch-spacer';row.append(spacer);}
   const button=document.createElement('button');button.type='button';button.className='tree-folder';button.textContent=parentOf(folder)?folder.name.split(' / ').at(-1):folder.name.replaceAll(' / ',' → ');button.title=folder.name;button.classList.toggle('selected',selected===folder.id);button.onclick=()=>open(folder.id);row.append(button);
   if(selected===folder.id){const wrapper=document.createElement('div');wrapper.className='library-selected-row';button.before(wrapper);wrapper.append(button);const remove=document.createElement('button');remove.type='button';remove.className='secondary asset-icon workspace-delete';remove.textContent='×';remove.title='Move '+folder.name+' to Trash';remove.setAttribute('aria-label','Delete '+folder.name);remove.onclick=()=>action(async()=>{await api('trash/folder',{id:folder.id});selected='all';await refresh();sync();});wrapper.append(remove);}
   group.append(row,children);for(const child of nested)append(child,children);container.append(group);
  }
  for(const folder of list.filter(f=>!parentOf(f)))append(folder,body);
  const create=document.createElement('button');create.type='button';create.className='tree-create';create.textContent='+ New Label';create.onclick=()=>createLabel(folder=>{selected=folder.id;for(const parent of folders())if(folder.name.startsWith(parent.name+' / '))expanded.add(parent.id);treeSignature='';navigate('audio-library');library.open=true;},list.find(f=>f.id===selected)?.name||'');body.append(create);
  const upload=document.createElement('button');upload.type='button';upload.className='workspace-upload tree-upload secondary';upload.textContent='Upload Audio';upload.onclick=uploadDialog;body.append(upload);
 }
 function render(){
  const folder=folders().find(f=>f.id===selected);if(selected!=='all'&&!folder)selected='all';
  const ids=new Set(links().filter(r=>r.folder_id===selected).map(r=>r.asset_id)),list=audio().filter(a=>selected==='all'||ids.has(a.id));
  let mode=localStorage.getItem('ecco-audio-library-view')||'large';if(!['small','large','list'].includes(mode))mode='large';
  q('#page').innerHTML='<div class="section-head"><div><h2>'+esc(folder?.name||'All audio')+'</h2><p class="help">'+(state.storage_pending?'Connect your saved workspace from Account → Storage.':list.length+' audio files · available across stories and sessions')+'</p></div><div class="row"><label class="library-view-label">View<select id="audio-library-view"><option value="small">Small icons</option><option value="large">Large icons</option><option value="list">List</option></select></label><button class="secondary" id="audio-create-label">+ New Label</button><button class="secondary" id="audio-library-upload">Upload Audio</button></div></div><div id="audio-library-gallery" class="cards library-view-'+mode+'">'+(list.map(a=>{
   const shell=document.createElement('div');shell.innerHTML=card(a);const item=shell.firstElementChild;item.classList.add('audio-card');const actions=item.querySelector('.actions');
   const labels=document.createElement('div');labels.className='workspace-labels';labels.innerHTML=labelsFor(a.id).map(f=>'<span class="workspace-label">'+esc(f.name)+'</span>').join('');actions.before(labels);
   const add=document.createElement('button');add.type='button';add.className='small secondary';add.dataset.audioLabel=a.id;add.textContent='+ Add label';actions.prepend(add);
   const details=document.createElement('details');details.className='library-card-actions';details.open=mode==='large';const summary=document.createElement('summary');summary.textContent='Actions';actions.before(details);details.append(summary,actions);return shell.innerHTML;
  }).join('')||empty('Your audio library is ready','Upload audio and add labels to organize it.'))+'</div>';
  const view=q('#audio-library-view');view.value=mode;view.onchange=()=>{localStorage.setItem('ecco-audio-library-view',view.value);q('#audio-library-gallery').className='cards library-view-'+view.value;document.querySelectorAll('#audio-library-gallery .library-card-actions').forEach(d=>d.open=view.value==='large');};
  q('#audio-create-label').onclick=()=>createLabel(folder=>{selected=folder.id;navigate('audio-library');});q('#audio-library-upload').onclick=uploadDialog;
  wireCards();document.querySelectorAll('[data-audio-label]').forEach(b=>b.onclick=()=>labelDialog(b.dataset.audioLabel));hydrateMedia();pageSignature=signature();
 }
 function sync(){tree();if(page==='audio-library'&&pageSignature!==signature())render();}
 const oldNavigate=navigate;navigate=function(p){if(p!=='audio-library')return oldNavigate.apply(this,arguments);document.body.classList.remove('workspace-entry-mode');q('#workspace-entry')?.remove();page=p;q('#heading').textContent='Audio Library';document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));treeSignature='';tree();render();};
 const oldStoryControls=storyControls;storyControls=function(...args){const result=oldStoryControls.apply(this,args);sync();return result;};
 tree();
})();
