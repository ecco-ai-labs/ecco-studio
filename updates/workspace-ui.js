'use strict';
/* Enhances the existing Studio controls; keeps their API and event handlers. */
(()=>{
 const q=s=>document.querySelector(s);
 const expansion=new Map();
 let selectedVideoId='';
 let welcomePending=true;
 function selectionToolbar(body,name,button){const selected=body.querySelector('.tree-folder.selected');if(!selected||!button)return;const row=document.createElement('div');row.className='library-selected-row';selected.before(row);row.append(selected);button.hidden=false;button.className='secondary asset-icon workspace-delete';button.textContent='×';button.title='Move '+name+' to Trash';button.setAttribute('aria-label','Delete '+name);row.append(button);}
 const records=()=>typeof state!=='undefined'&&state?state.records:[];
 const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const folderList=()=>records().filter(r=>r.kind==='image_folder'&&!r.deleted).sort((a,b)=>a.created-b.created||a.id.localeCompare(b.id));
 const labelsFor=id=>{const ids=new Set(records().filter(r=>r.kind==='library_item'&&r.asset_id===id&&!r.deleted).map(r=>r.folder_id));return folderList().filter(f=>ids.has(f.id));};
 function disclosure(title,key){const d=document.createElement('details');d.className='workspace-library';d.open=expansion.get(key)===true;d.innerHTML=`<summary><span class="library-symbol" aria-hidden="true"></span><span>${title}</span></summary><div class="workspace-library-content"></div>`;d.addEventListener('toggle',()=>expansion.set(key,d.open));return d;}
 function createFolder(after,parentName=''){let d=q('#workspace-folder-dialog');if(!d){d=document.createElement('dialog');d.id='workspace-folder-dialog';document.body.append(d);}d.innerHTML='<form class="form"><h2>Create new label</h2><label>Label name<input name="name" required maxlength="80" autocomplete="off"></label><label>Parent label<select name="parent"><option value="">None (top level)</option>'+folderList().map(f=>'<option value="'+html(f.name)+'" '+(f.name===parentName?'selected':'')+'>'+html(f.name.replaceAll(' / ',' → '))+'</option>').join('')+'</select></label><p role="status"></p><div class="row"><button type="submit">Create label</button><button type="button" class="secondary">Cancel</button></div></form>';d.querySelector('[type=button]').onclick=()=>d.close();d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('[type=submit]');b.disabled=true;try{if(!e.target.elements.name.value.trim())throw Error('Enter a label name.');if([e.target.elements.parent.value,e.target.elements.name.value.trim()].filter(Boolean).join(' / ').length>80)throw Error('The full label path must be 80 characters or fewer.');if(e.target.elements.name.value.includes('/'))throw Error('Use the parent selector to create nested labels.');const folder=await api('library/folders',{name:[e.target.elements.parent.value,e.target.elements.name.value.trim()].filter(Boolean).join(' / ')});if(folder.deleted)throw Error('A library with this name is in Trash. Restore it or choose another name.');await refresh();d.close();modernize();if(after)after(folder);}catch(err){d.querySelector('[role=status]').textContent=err.message;}finally{b.disabled=false;}};d.showModal();d.querySelector('input').focus();}
 function labelDialog(id){const asset=records().find(a=>a.id===id);if(!asset)return;let d=q('#workspace-label-dialog');if(!d){d=document.createElement('dialog');d.id='workspace-label-dialog';document.body.append(d);}const selected=new Set(labelsFor(id).map(f=>f.id));d.innerHTML='<form class="form"><div class="section-head"><h2>Add labels</h2><button type="button" class="secondary small" data-create>Create new label</button></div><label>Image name<input name="image_name" maxlength="160" required value="'+html(asset.title&&(asset.title!==asset.prompt||asset.settings?.model==='uploaded-image')?asset.title:'')+'" placeholder="e.g. Pankaj cartoon portrait"></label><p class="help">Choose labels to organize this image in your library.</p><div class="workspace-label-options">'+(folderList().map(f=>`<label class="workspace-label-option"><input type="checkbox" name="labels" value="${f.id}" ${selected.has(f.id)?'checked disabled':''}><span>${html(f.name)}</span>${selected.has(f.id)?'<small>Added</small>':''}</label>`).join('')||'<p>Create your first label.</p>')+'</div><p role="status"></p><div class="row"><button type="submit">Save name & labels</button><button type="button" class="secondary" data-close>Cancel</button></div></form>';d.querySelector('[data-close]').onclick=()=>d.close();d.querySelector('[data-create]').onclick=()=>createFolder(()=>{d.close();labelDialog(id);});d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('[type=submit]');b.disabled=true;try{const name=e.target.elements.image_name.value.trim();if(!name)throw Error('Enter an image name.');const folderIds=[...new Set([...selected,...new FormData(e.target).getAll('labels')])];if(!folderIds.length)throw Error('Choose at least one label.');for(const fid of folderIds){const saved=await api('library/save',{asset_id:id,folder_id:fid,title:name});if(saved.image_title!==name)throw Error('Labels saved, but image naming needs the Studio service to reload its update. Your name has not been saved yet.');}await refresh();d.close();modernize();notice('Image name and labels saved.');}catch(err){d.querySelector('[role=status]').textContent=err.message;}finally{b.disabled=false;}};d.showModal();}
 function uploadDialog(){let d=q('#workspace-upload-dialog');if(!d){d=document.createElement('dialog');d.id='workspace-upload-dialog';document.body.append(d);}d.innerHTML='<form class="form"><h2>Upload image</h2><label>Picture or object image<input type="file" name="image" accept="image/png,image/jpeg,image/webp" required></label><p class="help">PNG, JPEG or WebP · up to 12 MB and 20 megapixels. Your original upload is preserved when you edit a copy.</p><input type="hidden" name="next" value="label"><p role="status"></p><div class="row"><button type="submit">Upload image</button><button type="button" class="secondary">Cancel</button></div></form>';d.querySelector('[type=button]').onclick=()=>d.close();d.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.target,file=form.elements.image.files[0],button=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]');if(!file)return;if(file.size>12*1024*1024){status.textContent='Choose an image no larger than 12 MB.';return;}button.disabled=true;status.textContent='Uploading image…';try{const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(Error('Could not read this file.'));r.onload=()=>resolve(String(r.result).split(',')[1]);r.readAsDataURL(file);});const asset=await api('images/upload',{name:file.name,data,story_id:activeStory});await refresh();d.close();navigate('images');modernize();if(form.elements.next.value==='edit')editImageDialog(asset.id);else labelDialog(asset.id);notice('Image uploaded. Add labels to keep it in your library.');}catch(err){status.textContent=err.message;}finally{button.disabled=false;}};d.showModal();}
 function imageTree(){
  const box=q('#image-library-nav'),select=q('#library-folder-nav');if(!box||!select)return;
  const assets=records().filter(a=>a.kind==='asset'&&a.media==='image'&&!a.deleted);
  const links=records().filter(r=>r.kind==='library_item'&&!r.deleted);
  const signature=JSON.stringify([folderList().map(f=>[f.id,f.name,f.created]),select.value,assets.map(a=>[a.id,a.title,a.created]),links.map(r=>[r.asset_id,r.folder_id])]);
  if(box.dataset.workspaceSignature===signature&&box.querySelector('.workspace-library'))return;
  const previous=box.querySelector('.workspace-library');
  const wasOpen=previous?.open;
  box.dataset.workspaceSignature=signature;
  for(const el of [...box.children])if(!el.classList.contains('workspace-library'))el.hidden=true;
  previous?.remove();
  const d=disclosure('Image library','ecco-image-library-tree-v2');if(wasOpen!==undefined)d.open=wasOpen;
  const body=d.querySelector('.workspace-library-content');
  const openFolder=id=>{select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));imageTree();};
  const folders=folderList(),byName=new Map(folders.map(f=>[f.name,f]));
  const parentOf=f=>byName.get(f.name.split(' / ').slice(0,-1).join(' / '));
  function appendFolder(folder,container){
   const group=document.createElement('div');group.className='tree-label-group';
   const row=document.createElement('div');row.className='tree-branch-row';
   const children=document.createElement('div');children.className='tree-branch-children';
   const nested=folders.filter(f=>parentOf(f)?.id===folder.id);
   const ids=new Set(links.filter(r=>r.folder_id===folder.id).map(r=>r.asset_id));
   const images=assets.filter(a=>ids.has(a.id)).sort((a,b)=>a.created-b.created);
   const key='label:'+folder.id;
   if(nested.length){
    const toggle=document.createElement('button');toggle.type='button';toggle.className='tree-branch-toggle';toggle.textContent='▸';
    const sync=()=>{const open=expansion.get(key)===true;children.hidden=!open;toggle.textContent=open?'▾':'▸';toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',(open?'Collapse ':'Expand ')+folder.name);};
    toggle.onclick=()=>{expansion.set(key,expansion.get(key)!==true);sync();};sync();row.append(toggle);
   }else{const spacer=document.createElement('span');spacer.className='tree-branch-spacer';row.append(spacer);}
   const label=document.createElement('button');label.type='button';label.className='tree-folder';
   label.textContent=parentOf(folder)?folder.name.split(' / ').at(-1):folder.name.replaceAll(' / ',' → ');label.title=folder.name.replaceAll(' / ',' → ');label.classList.toggle('selected',folder.id===select.value);
   label.onclick=()=>openFolder(folder.id);row.append(label);group.append(row,children);
   for(const child of nested)appendFolder(child,children);

   container.append(group);
  }
  for(const folder of folders.filter(f=>!parentOf(f)))appendFolder(folder,body);
  const create=document.createElement('button');create.type='button';create.className='tree-create';create.textContent='+ New Label';
  create.onclick=()=>createFolder(folder=>{const parts=folder.name.split(' / ');for(let i=1;i<parts.length;i++){const parent=folderList().find(f=>f.name===parts.slice(0,i).join(' / '));if(parent)expansion.set('label:'+parent.id,true);}box.dataset.workspaceSignature='';imageTree();const current=q('#image-library-nav .workspace-library');if(current)current.open=true;},folderList().find(f=>f.id===select.value)?.name||'');body.append(create);
  const selected=folderList().find(f=>f.id===select.value);if(selected){const remove=document.createElement('button');remove.type='button';remove.onclick=()=>{action(async()=>{await api('trash/folder',{id:selected.id});select.value='all';select.dispatchEvent(new Event('change',{bubbles:true}));await refresh();modernize();});};selectionToolbar(body,selected.name,remove);}
  box.append(d);
  let upload=q('.workspace-upload');if(!upload){upload=document.createElement('button');upload.type='button';upload.className='workspace-upload tree-upload secondary';upload.textContent='Upload image';upload.onclick=uploadDialog;}upload.hidden=false;body.append(upload);
 }
 function storyTree(){
  const box=q('.project'),select=q('#story-picker');if(!box||!select||box.querySelector('.workspace-library'))return;
  const remove=q('#delete-story');if(remove)remove.onclick=()=>action(async()=>{await api('stories/archive',{story_id:activeStory});await refresh();draft=loadDraft();navigate('images');notice('Story moved to Trash.');});const d=disclosure('Story Library','ecco-story-library-expanded'),body=d.querySelector('.workspace-library-content');
  for(const el of [...box.children])el.hidden=true;
  const storyRecords=records().filter(r=>r.kind==='story'&&!r.deleted);
  const options=[...select.options].sort((a,b)=>(storyRecords.find(r=>r.id===a.value)?.created||0)-(storyRecords.find(r=>r.id===b.value)?.created||0));
  const selected=options.find(o=>o.value===select.value);
  for(const option of options){const b=document.createElement('button');b.type='button';b.className='tree-folder';b.textContent='− '+option.textContent;b.classList.toggle('selected',option.value===select.value);b.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));};body.append(b);}
  let localStories=[];try{localStories=JSON.parse(localStorage.getItem('ecco-saved-story-setups')||'[]');}catch{}
  for(const story of localStories){
   const b=document.createElement('button');b.type='button';b.className='tree-folder';
   b.textContent='− '+story.title;b.title=story.genre?story.genre+' · Saved in this browser':'Saved in this browser';
   b.onclick=()=>{document.body.classList.remove('workspace-entry-mode');storySetupPage(story.id);page='story-library-detail';librarySelection();};
   body.append(b);
  }
  if(selected)selectionToolbar(body,selected.textContent,remove);
  box.append(d);
 }


 function imageReferencePicker(){
  const form=q('#image-form'),model=q('#job-model');if(!form||!model||q('#studio-reference-image'))return;
  const saved=new Set(records().filter(r=>r.kind==='library_item'&&!r.deleted).map(r=>r.asset_id));
  const images=records().filter(r=>r.kind==='asset'&&r.media==='image'&&!r.deleted&&saved.has(r.id));
  const area=document.createElement('div');area.innerHTML='<label>Use image<select id="studio-reference-image"><option value="">None — create a new image</option>'+images.map(a=>'<option value="'+html(a.id)+'">'+html((labelsFor(a.id).map(f=>f.name).join(', ')||'Library')+' / '+(a.title||'Untitled image'))+'</option>').join('')+'</select></label><img class="refine-preview" hidden alt="Selected reference image"><p class="help" data-reference-help hidden></p>';
  model.closest('label').after(area);
  const select=area.querySelector('select'),preview=area.querySelector('img'),help=area.querySelector('p'),button=form.querySelector('#generate-image')||form.querySelector('button[type="submit"]');
  const originalModel=model.value,originalText=button.textContent;
  select.hidden=true;
  const choose=document.createElement('button');choose.type='button';choose.className='secondary';choose.textContent='Browse Image Library';select.closest('label').append(choose);
  const clear=document.createElement('button');clear.type='button';clear.className='small secondary';clear.textContent='Remove reference';clear.hidden=true;area.append(clear);
  clear.onclick=()=>{select.value='';select.onchange();choose.textContent='Browse Image Library';clear.hidden=true;};
  choose.onclick=()=>{
   let dialog=q('#studio-library-picker');if(!dialog){dialog=document.createElement('dialog');dialog.id='studio-library-picker';document.body.append(dialog);}
   dialog.innerHTML='<div class="form"><div class="section-head"><h2>Image Library</h2><button type="button" class="secondary" data-close>Close</button></div><p class="help">Open a label and select an image to use as your reference.</p><div data-library-tree></div></div>';
   dialog.querySelector('[data-close]').onclick=()=>dialog.close();
   const folders=folderList(),byName=new Map(folders.map(f=>[f.name,f]));
   const parentOf=f=>byName.get(f.name.split(' / ').slice(0,-1).join(' / '));
   const links=records().filter(r=>r.kind==='library_item'&&!r.deleted);
   const append=(folder,container)=>{
    const group=document.createElement('details');group.className='workspace-library';group.open=true;
    const summary=document.createElement('summary');summary.textContent=parentOf(folder)?folder.name.split(' / ').at(-1):folder.name;group.append(summary);
    const body=document.createElement('div');body.className='workspace-library-content';group.append(body);
    for(const child of folders.filter(f=>parentOf(f)?.id===folder.id))append(child,body);
    const ids=new Set(links.filter(l=>l.folder_id===folder.id).map(l=>l.asset_id));
    const items=images.filter(a=>ids.has(a.id)).sort((a,b)=>a.created-b.created);
    for(const asset of items){
     const item=document.createElement('button');item.type='button';item.className='secondary';item.setAttribute('aria-label','Use '+(asset.title||'Untitled image'));
     const thumb=document.createElement('img');thumb.src=media(asset);thumb.alt='';thumb.width=100;thumb.height=100;thumb.loading='lazy';
     const name=document.createElement('span');name.textContent=asset.title||'Untitled image';item.append(thumb,name);
     item.onclick=()=>{select.value=asset.id;select.onchange();choose.textContent='Change image · '+(asset.title||'Selected image');clear.hidden=false;dialog.close();};body.append(item);
    }
    if(!items.length&&!folders.some(f=>parentOf(f)?.id===folder.id)){const empty=document.createElement('p');empty.className='help';empty.textContent='No images in this label.';body.append(empty);}
    container.append(group);
   };
   for(const folder of folders.filter(f=>!parentOf(f)))append(folder,dialog.querySelector('[data-library-tree]'));
   dialog.showModal();
  };
  select.onchange=()=>{
   const asset=images.find(a=>a.id===select.value);preview.hidden=!asset;help.hidden=!asset;
   model.disabled=false;
   for(const option of model.options){if(option.dataset.originalDisabled===undefined)option.dataset.originalDisabled=String(option.disabled);option.disabled=asset?option.value!=='qwen-image-edit-2511':option.dataset.originalDisabled==='true';}
   if(asset){
    if(!model.querySelector('option[value="qwen-image-edit-2511"]')){const o=document.createElement('option');o.value='qwen-image-edit-2511';o.textContent='Qwen Image Edit · reference image';model.append(o);}
    model.value='qwen-image-edit-2511';preview.src=media(asset);
    help.textContent='Qwen Image Edit is the only reference-editing model currently connected. Other models are unavailable for this operation. Describe your changes below; the original is preserved.';
    button.textContent='Generate edited image';
   }else{model.value=originalModel;preview.removeAttribute('src');button.textContent=originalText;}
   document.dispatchEvent(new Event('ecco-reference-change'));
  };
  form.addEventListener('submit',async e=>{
   if(!select.value)return;e.preventDefault();e.stopImmediatePropagation();
   const asset=records().find(a=>a.id===select.value&&!a.deleted);if(!asset){notice('This reference is no longer available.',true);return;}
   if(!state.config.models_ready?.['qwen-image-edit-2511']){notice('Qwen Image Edit is not ready on this GPU.',true);return;}
   const prompt=form.elements.prompt.value.trim();if(!prompt)return;
   if(button.disabled)return;
   const story=activeStory;
   submittingImages.add(story);localStorage.removeItem('ecco-image-job:'+story);
   setGenerationBusy(button,true,'Submitting…','Generate edited image');
   const status=form.querySelector('#image-status');
   if(status)status.textContent='Sending your reference-image edit…';
   try{const job=await api('image-edits',{asset_id:asset.id,story_id:story,prompt});
    localStorage.setItem('ecco-image-job:'+story,job.id);submittingImages.delete(story);
    await refresh();notice('Reference edit queued. Your original image is preserved.');
   }catch(err){submittingImages.delete(story);if(button.isConnected)setGenerationBusy(button,false,'','Generate edited image');if(status?.isConnected)status.textContent=err.message;notice(err.message,true);}
  },true);
 }

 function imageLabels(){document.querySelectorAll('[data-approve]').forEach(b=>{const asset=records().find(r=>r.id===b.dataset.approve);if(asset?.media==='video')b.textContent='Approve & add to Video Library';});document.querySelectorAll('[data-trash]').forEach(b=>{b.textContent='×';b.classList.add('workspace-delete');});document.querySelectorAll('[data-library-save]').forEach(b=>{const id=b.dataset.librarySave;b.textContent='+ Add label';b.onclick=()=>labelDialog(id);const card=b.closest('.card');if(!card)return;let chips=card.querySelector('.workspace-labels');if(!chips){chips=document.createElement('div');chips.className='workspace-labels';b.closest('.actions').before(chips);}const signature=JSON.stringify(labelsFor(id).map(f=>[f.id,f.name]));if(chips.dataset.signature!==signature){chips.dataset.signature=signature;chips.innerHTML=labelsFor(id).map(f=>`<span class="workspace-label">${html(f.name)}</span>`).join('');}});}
 function ribbon(){const header=q('main > header'),right=header?.querySelector('.header-right');if(!right)return;header.classList.add('workspace-ribbon');if(!q('#workspace-menus')){const menus=document.createElement('div');menus.id='workspace-menus';for(const name of ['Billing','Account','Activity']){const d=document.createElement('details');d.className='workspace-menu';d.dataset.category=name;d.innerHTML=`<summary>${name}<span aria-hidden="true">⌄</span></summary><div class="workspace-menu-items"></div>`;d.addEventListener('toggle',()=>{if(d.open)menus.querySelectorAll('details').forEach(other=>{if(other!==d)other.open=false;});});menus.append(d);}right.append(menus);}const target=name=>q(`[data-category="${name}"] .workspace-menu-items`);const move=(node,name)=>{if(node&&node.parentElement!==target(name))target(name).append(node);};if(typeof powerButton!=='undefined')move(powerButton,'Billing');move(q('#settings'),'Account');move(q('#reconnect-gpu'),'Account');move(q('#sync'),'Activity');move(q('#open-comfyui'),'Activity');move(q('#toggle-activity'),'Activity');q('#workspace-menus').querySelectorAll('button,a').forEach(el=>{if(el.dataset.ribbonClose)return;el.dataset.ribbonClose='1';el.addEventListener('click',()=>el.closest('details').open=false);});}
 let hardwareVerifiedAt=0;
 function acceleratorDisplay(){
  const hardware=typeof state!=='undefined'?state?.config?.accelerator:null;
  const fresh=hardwareVerifiedAt&&Date.now()-hardwareVerifiedAt<45000;
  const names=hardware?.status==='detected'?hardware.devices.map(d=>d.name):[];
  const isConnected=typeof gpuConnected==='function'&&gpuConnected();
  const text=!isConnected?'Accelerator not connected':fresh&&names.length?names.join(' + ')+' · Connected':names.length?names.join(' + ')+' · Connection unverified':'Accelerator · Unverified';
  let badge=q('#connected-accelerator');const header=q('main > header .header-right');
  if(!badge&&header){badge=document.createElement('button');badge.type='button';badge.id='connected-accelerator';badge.className='badge';badge.onclick=()=>connectGPU('accelerator-status');header.prepend(badge);}
  if(badge){badge.classList.toggle('accelerator-connected',Boolean(isConnected&&fresh&&names.length));badge.textContent=text;badge.title=!isConnected?'Connect an accelerator':fresh&&names.length?'Accelerator connected and verified':'Accelerator connection is unverified';}
  const form=q('#video-form');let status=q('#video-accelerator');
  if(form&&!status){status=document.createElement('p');status.id='video-accelerator';status.className='help';status.setAttribute('role','status');form.prepend(status);}
  if(status)status.textContent=text;
 }
 if(typeof api==='function'){const previous=api;api=async function(path,...args){try{const result=await previous.call(this,path,...args);if(path==='state')hardwareVerifiedAt=Date.now();return result;}catch(error){if(path==='state'){hardwareVerifiedAt=0;acceleratorDisplay();}throw error;}};}
 if(typeof navigate==='function'){const previous=navigate;navigate=function(...args){if(args[0]==='welcome'||(welcomePending&&args[0]==='images')){welcomePending=false;welcomePage();return;}document.body.classList.remove('workspace-entry-mode');if(args[0]==='story-setup'){welcomePending=false;storySetupPage();return;}if(args[0]==='empty'){page='empty';q('#page')?.replaceChildren();if(q('#heading'))q('#heading').textContent='';document.querySelectorAll('nav button.active').forEach(b=>b.classList.remove('active'));return;}const result=previous.apply(this,args);imageReferencePicker();acceleratorDisplay();return result;};}
 setInterval(acceleratorDisplay,5000);

 function librarySelection(){
  const selectors={'library':'#image-library-nav > details > summary','video-library':'#workspace-video-library > summary','audio-library':'#workspace-audio-library > summary','story-library':'.project > details > summary','story-library-detail':'.project > details > summary'};
  const selected=selectors[page];
  document.querySelectorAll('#workspace-library-group summary').forEach(el=>{
   const active=!!selected&&el.matches(selected);el.classList.toggle('active',active);
   if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
  const start=q('#workspace-new-story');if(start)start.classList.toggle('active',page==='story-setup');
 }
 function libraryOverview(kind){
  document.body.classList.remove('workspace-entry-mode');q('#workspace-entry')?.remove();
  page=kind+'-library';q('#heading').textContent=kind==='video'?'Video Library':'Story Library';
  document.querySelectorAll('nav button.active').forEach(b=>b.classList.remove('active'));
  if(kind==='video'){
   const list=records().filter(r=>r.kind==='asset'&&r.media==='video'&&r.stage==='prod'&&!r.deleted);
   q('#page').innerHTML='<div class="section-head"><h2>Video Library</h2><button type="button" id="video-library-upload" class="secondary">Upload Video</button></div><div class="cards">'+(list.map(card).join('')||'<p class="help">No saved videos.</p>')+'</div>';
   q('#video-library-upload').onclick=uploadVideoDialog;wireCards();
  }else{
   q('#page').innerHTML='<div class="section-head"><h2>Story Library</h2></div><div id="story-library-list" class="form"></div>';
   const list=q('#story-library-list'),entries=[...document.querySelectorAll('.project .workspace-library-content > button.tree-folder')];
   for(const entry of entries){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=entry.textContent.replace(/^− /,'');b.onclick=()=>{entry.click();if(page==='story-setup')page='story-library-detail';librarySelection();};list.append(b);}
   if(!entries.length)list.innerHTML='<p class="help">No saved stories.</p>';
  }
  librarySelection();
 }
 document.addEventListener('click',event=>{
  const summary=event.target.closest('summary');if(!summary)return;
  if(summary.matches('#image-library-nav > details > summary'))navigate('library');
  else if(summary.matches('#workspace-video-library > summary'))libraryOverview('video');
  else if(summary.matches('#workspace-audio-library > summary'))navigate('audio-library');
  else if(summary.matches('.project > details > summary'))libraryOverview('story');
  librarySelection();
 });
 new MutationObserver(librarySelection).observe(document.body,{childList:true,subtree:true});
 const selectionStyle=document.createElement('style');selectionStyle.textContent='#workspace-library-group summary.active{color:var(--accent,#ffdc24)!important;background:#38305e;border-radius:6px;box-shadow:inset 3px 0 var(--accent,#ffdc24)}';document.head.append(selectionStyle);
 function libraryGroup(){
  const image=q('#image-library-nav'),story=q('.project');if(!image||!story)return;
  let group=q('#workspace-library-group');
  if(!group){group=disclosure('Library','ecco-library-group-expanded');group.id='workspace-library-group';image.before(group);}
  const content=group.querySelector('.workspace-library-content');
  if(image.parentElement!==content)content.append(image);if(story.parentElement!==content)content.append(story);
  const trash=q('#workspace-trash'),footer=q('.side-bottom');if(trash&&footer&&trash.nextElementSibling!==footer)footer.before(trash);
 }
 function publishMenu(){
  const video=records().find(r=>r.id===selectedVideoId&&r.kind==='asset'&&r.media==='video'&&r.stage==='prod'&&!r.deleted);
  if(video){persistDraft();activeStory=video.story_id||LEGACY_STORY;localStorage.setItem('ecco-active-story',activeStory);draft=loadDraft();lastSignature='';storyControls();}
  let dialog=q('#workspace-publish-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='workspace-publish-dialog';document.body.append(dialog);}
  dialog.innerHTML='<div class="form"><div class="section-head"><h2>Publish on YouTube</h2><button type="button" class="secondary" data-close>Close</button></div><p data-video></p><div data-publish-controls></div></div>';dialog.style.width='min(1000px,94vw)';
  dialog.querySelector('[data-video]').textContent=video?'Selected video: '+(video.title||'Untitled video'):'Select a reviewed, approved video from Video Library before uploading. You can connect your YouTube channel below.';
  const preview=document.createElement('video');preview.controls=true;preview.hidden=!video;preview.src=video?media(video):'';preview.style.cssText='width:100%;max-height:260px';dialog.querySelector('[data-video]').after(preview);dialog.onclose=()=>preview.pause();dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  const pageNode=q('#page'),previous=[...pageNode.childNodes];previous.forEach(n=>n.remove());
  try{publishPage();dialog.querySelector('[data-publish-controls]').append(...pageNode.childNodes);}
  finally{pageNode.replaceChildren(...previous);}
  const select=dialog.querySelector('select[name="asset_id"]');if(select&&video){select.value=video.id;select.disabled=true;const fixed=document.createElement('input');fixed.type='hidden';fixed.name='asset_id';fixed.value=video.id;select.after(fixed);}
  dialog.showModal();
 }
 function uploadVideoDialog(){
  let d=q('#workspace-upload-video-dialog');if(!d){d=document.createElement('dialog');d.id='workspace-upload-video-dialog';document.body.append(d);}
  d.innerHTML='<form class="form"><h2>Upload Video</h2><label>Video<input name="video" type="file" accept="video/mp4,video/webm,.mp4,.webm" required></label><p class="help">MP4 or WebM · up to 12 MB.</p><label>Story<select name="story_id">'+stories().map(story=>'<option value="'+html(story.id)+'" '+(story.id===activeStory?'selected':'')+'>'+html(story.title)+'</option>').join('')+'</select></label><video controls style="width:100%;max-height:260px" hidden></video><label class="inline-check"><input name="reviewed" type="checkbox" required><span>I have reviewed this finished video and approve adding it to Video Library.</span></label><p role="status"></p><div class="row"><button type="submit">Upload Video</button><button type="button" class="secondary">Cancel</button></div></form>';
  let objectURL;const preview=d.querySelector('video');d.querySelector('[name="video"]').onchange=e=>{if(objectURL)URL.revokeObjectURL(objectURL);const file=e.target.files[0];preview.hidden=!file;if(file){objectURL=URL.createObjectURL(file);preview.src=objectURL;}d.querySelector('[name="reviewed"]').checked=false;};
  d.onclose=()=>{preview.pause();if(objectURL)URL.revokeObjectURL(objectURL);};d.querySelector('[type="button"]').onclick=()=>d.close();
  d.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.target,file=form.elements.video.files[0],button=form.querySelector('[type="submit"]'),status=form.querySelector('[role="status"]');if(!file)return;if(file.size>12*1024*1024){status.textContent='Choose a video no larger than 12 MB.';return;}button.disabled=true;status.textContent='Uploading video…';try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Could not read video.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});const asset=await api('images/upload',{media:'video',name:file.name,data,story_id:form.elements.story_id.value,reviewed:form.elements.reviewed.checked});selectedVideoId=asset.id;await refresh();d.close();videoLibrary();q('#workspace-video-library').open=true;notice('Video uploaded to Video Library.');}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
  d.showModal();
 }
 function videoLibrary(){
  const group=q('#workspace-library-group .workspace-library-content');if(!group)return;
  let library=q('#workspace-video-library');if(!library){library=disclosure('Video Library','ecco-video-library');library.id='workspace-video-library';group.append(library);}const story=q('.project');if(story&&library.nextElementSibling!==story)story.before(library);
  const list=records().filter(r=>r.kind==='asset'&&r.media==='video'&&r.stage==='prod'&&!r.deleted&&stories().some(story=>story.id===(r.story_id||LEGACY_STORY)));
  if(!list.some(v=>v.id===selectedVideoId))selectedVideoId='';
  const signature=JSON.stringify(list.map(v=>[v.id,v.title,v.upload_state]));if(library.dataset.signature===signature+selectedVideoId)return;library.dataset.signature=signature+selectedVideoId;
  const body=library.querySelector('.workspace-library-content');body.replaceChildren();
  const upload=document.createElement('button');upload.type='button';upload.className='workspace-upload tree-upload secondary';upload.textContent='Upload Video';upload.onclick=uploadVideoDialog;body.append(upload);
  if(!list.length){const empty=document.createElement('p');empty.className='help';empty.textContent='Reviewed and approved videos appear here.';body.append(empty);}
  const choices=document.createElement('div');choices.className='video-publish-choices';choices.setAttribute('role','radiogroup');choices.setAttribute('aria-label','Video to publish on YouTube');body.append(choices);
  for(const video of list){
   const row=document.createElement('div');row.className='video-publish-row';
   const label=document.createElement('label');label.className='video-publish-choice';
   const radio=document.createElement('input');radio.type='radio';radio.name='youtube-library-video';radio.value=video.id;radio.checked=video.id===selectedVideoId;
   const title=document.createElement('span');title.textContent=video.title||'Untitled video';label.append(radio,title);row.append(label);
   radio.onchange=()=>{if(!radio.checked)return;selectedVideoId=video.id;library.dataset.signature=signature+selectedVideoId;publish.disabled=false;publish.title='Publish '+(video.title||'selected video')+' on YouTube';};
   const remove=document.createElement('button');remove.type='button';remove.className='workspace-delete';remove.textContent='×';remove.setAttribute('aria-label','Delete video '+(video.title||'Untitled video'));remove.onclick=()=>action(async()=>{await api('trash',{asset_id:video.id});if(selectedVideoId===video.id)selectedVideoId='';await refresh();videoLibrary();notice('Video moved to Trash.');});row.append(remove);choices.append(row);
  }
  const footer=document.createElement('div');footer.id='workspace-youtube-row';
  const publish=document.createElement('button');publish.id='workspace-youtube';publish.type='button';publish.className='secondary tree-upload';publish.textContent='Publish on YouTube';publish.disabled=!selectedVideoId;publish.title=selectedVideoId?'Publish the selected video on YouTube':'Select one video to publish';publish.onclick=()=>{if(!selectedVideoId)return;publishMenu();};footer.append(publish);body.append(footer);
 }

 function storySetupPage(savedId){
  page='story-setup';
  q('#workspace-entry')?.remove();
  q('#heading').textContent='Name Of Your Story';
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.id==='workspace-new-story'));
  const key=savedId?'ecco-story-setup:'+savedId:'ecco-new-story-draft';
  let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
  const genres=['Romantic','Horror','Scientific','Science Fiction','Documentary','Educational','Animation','Action','Adventure','Comedy','Drama','Fantasy','Mystery','Thriller','Other'];
  q('#page').innerHTML='<form id="story-setup-form" class="form"><label>Name Of Your Story<input name="title" maxlength="160" required placeholder="Enter your story name"></label><label>Genre<select name="genre"><option value="">Select a genre</option>'+genres.map(g=>'<option>'+g+'</option>').join('')+'</select></label><label>Story idea / summary<textarea name="summary" maxlength="4000" placeholder="Describe your story, characters and setting"></textarea></label><div class="row"><button type="submit">Save story</button></div><p role="status" data-story-status></p></form>';
  const form=q('#story-setup-form'),status=form.querySelector('[data-story-status]');
  for(const name of ['title','genre','summary'])form.elements[name].value=saved[name]||'';
  const save=()=>{const data=Object.fromEntries(new FormData(form));localStorage.setItem(key,JSON.stringify(data));status.textContent='Draft saved in this browser.';return data;};
  form.addEventListener('input',save);form.addEventListener('change',save);
  form.onsubmit=async event=>{
   event.preventDefault();
   const data=save(),button=form.querySelector('[type="submit"]');button.disabled=true;
   status.textContent='Saving story…';
   try{
    let savedStories=JSON.parse(localStorage.getItem('ecco-saved-story-setups')||'[]');
    const id=savedId||crypto.randomUUID();
    localStorage.setItem('ecco-story-setup:'+id,JSON.stringify(data));
    savedStories=savedStories.filter(s=>s.id!==id);savedStories.push({id,title:data.title,genre:data.genre});
    localStorage.setItem('ecco-saved-story-setups',JSON.stringify(savedStories));
    savedId=id;
    q('.project .workspace-library')?.remove();storyTree();
    status.textContent='Saved to Story Library in this browser. Cloud storage is not connected yet.';
   }catch(error){status.textContent='Could not save story: '+error.message;}

   finally{button.disabled=false;}
  };
 }

 function productionGroup(){
  const nav=q('nav[aria-label="Production stages"]');if(!nav)return;
  let group=q('#workspace-production-group');
  if(!group){group=disclosure('Tell Your Story','ecco-production-expanded');group.id='workspace-production-group';nav.append(group);}
  const body=group.querySelector('.workspace-library-content');
  let start=q('#workspace-new-story');if(!start){start=document.createElement('button');start.type='button';start.id='workspace-new-story';start.className='tree-create';start.textContent='+ Name Of Your Story';start.onclick=()=>navigate('story-setup');body.prepend(start);}
  for(const button of [...nav.querySelectorAll('button[data-page]')]){
   const page=button.dataset.page;
   if(['characters','review','publish'].includes(page)){button.remove();continue;}
   if(page==='models'){const activity=q('[data-category="Activity"] .workspace-menu-items');if(activity){button.hidden=false;button.textContent='Models & Settings';activity.prepend(button);}continue;}
   button.hidden=false;const title=({director:'Story Narration',images:'Image Studios',board:'Storyboard',render:'Video Studios'})[page]||names[page]||page;button.textContent='− '+title;if(button.parentElement!==body)body.append(button);
  }
  const models=q('#model-nav');if(models)models.hidden=true;
  q('#workspace-publish')?.remove();
  if(typeof names!=='undefined')names.publish='Publish to Video';
 }
 function educationMenu(){
  const menus=q('#workspace-menus'),list=q('#checklist');if(!menus||!list)return;
  let menu=q('#education-menu');if(!menu){menu=document.createElement('details');menu.id='education-menu';menu.className='workspace-menu';menu.innerHTML='<summary>Education and Learning<span aria-hidden="true">⌄</span></summary><div class="workspace-menu-items education-content"><h3>Day 1 checklist</h3></div>';menu.addEventListener('toggle',()=>{if(menu.open)menus.querySelectorAll('details').forEach(other=>{if(other!==menu)other.open=false;});});menus.append(menu);}
  const body=menu.querySelector('.education-content');if(list.parentElement!==body){const heading=list.parentElement.querySelector('.eyebrow');if(heading)heading.remove();body.append(list);}
 }
 function welcomePage(){
  page='welcome';document.body.classList.add('workspace-entry-mode');
  let entry=q('#workspace-entry');if(!entry){entry=document.createElement('section');entry.id='workspace-entry';entry.setAttribute('aria-label','Ecco AI Labs Studios');const logo=q('aside .brand img')||q('aside img');const brand=document.createElement('img');brand.className='entry-logo';brand.src=logo?.src||'logo.png';brand.alt='Ecco AI Labs logo';const title=document.createElement('h1');title.innerHTML='Ecco AI Labs<span class="entry-subtitle">Studios</span>';const button=document.createElement('button');button.id='entry-tell-story';button.type='button';button.textContent='Tell Your Story';button.onclick=()=>{welcomePending=false;document.body.classList.remove('workspace-entry-mode');navigate('empty');};const copyright=document.createElement('p');copyright.className='entry-copyright';copyright.textContent='© '+new Date().getFullYear()+' Ecco Labs AI India Pvt Ltd. All rights reserved.';entry.append(brand,title,button,copyright);document.body.append(entry);}
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
 }
 document.addEventListener('click',e=>{if(e.target.closest('button'))welcomePending=false;},true);
 function creditsDialog(){let d=q('#workspace-credits-dialog');if(!d){d=document.createElement('dialog');d.id='workspace-credits-dialog';document.body.append(d);}d.innerHTML='<div class="form"><div class="section-head"><h2>Credits &amp; Usage</h2><button type="button" class="secondary" data-close>Close</button></div><p class="help">Your generation allowance and usage.</p><dl class="credits-details"><dt>Starting allowance</dt><dd>500 credits per user</dd><dt>Available balance</dt><dd>Available after sign-in is connected</dd><dt>Credits used</dt><dd>Not tracked yet</dd><dt>Renewal</dt><dd>Not configured</dd></dl><p role="status">Per-user quotas are not active yet. Google Workspace sign-in and server-side credit tracking must be connected before credits can be granted or deducted.</p></div>';d.querySelector('[data-close]').onclick=()=>d.close();d.showModal();}
 function accountCredits(){const menu=q('[data-category="Account"] .workspace-menu-items');if(!menu||q('#workspace-credits'))return;const b=document.createElement('button');b.id='workspace-credits';b.type='button';b.textContent='Credits & Usage';b.onclick=()=>{menu.closest('details').open=false;creditsDialog();};menu.prepend(b);}
 function modernize(){const footer=q('.side-bottom');if(footer&&!q('#workspace-copyright')){const copyright=document.createElement('p');copyright.id='workspace-copyright';copyright.textContent='© '+new Date().getFullYear()+' Ecco Labs AI India Pvt Ltd. All rights reserved.';footer.append(copyright);}document.title='Ecco AI Labs Studios';if(typeof names!=='undefined')for(const key of Object.keys(names))names[key]=names[key].replace(/\bstudio\b/gi,'Studios');document.querySelectorAll('aside small,aside span,aside p').forEach(el=>{if(!el.children.length&&el.textContent.trim().toLowerCase()==='production studio')el.textContent='Studios';});ribbon();accountCredits();imageReferencePicker();imageTree();storyTree();libraryGroup();productionGroup();educationMenu();videoLibrary();imageLabels();acceleratorDisplay();}
 if(typeof storyControls==='function'){const previous=storyControls;storyControls=function(...args){const result=previous.apply(this,args);modernize();return result;};}
 if(typeof wireCards==='function'){const previous=wireCards;wireCards=function(...args){const result=previous.apply(this,args);imageLabels();return result;};}
 document.addEventListener('click',e=>{document.querySelectorAll('.workspace-menu[open]').forEach(d=>{if(!d.contains(e.target))d.open=false;});});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.workspace-menu[open]').forEach(d=>{d.open=false;d.querySelector('summary').focus();});});
 window.EccoWorkspaceUI={labelDialog,createFolder,uploadDialog};
 modernize();welcomePage();
})();
(()=>{
 const icon='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg>';
 const deleted=()=>state.records.filter(r=>r.deleted&&!r.purged&&['story','board','board_draft','asset','image_folder','audio_folder'].includes(r.kind));
 function trashIcon(){let b=document.querySelector('#workspace-trash');if(!b){b=document.createElement('button');b.id='workspace-trash';b.className='secondary asset-icon';b.title='Trash';b.setAttribute('aria-label','Trash');b.innerHTML=icon;b.onclick=()=>navigate('trash');document.querySelector('.side-bottom').before(b);}const old=document.querySelector('#view-trash');if(old)old.hidden=true;}
 const oldStories=storyControls;storyControls=function(...args){const r=oldStories.apply(this,args);trashIcon();return r;};
 const oldBoards=renderSavedBoards;renderSavedBoards=function(...args){const r=oldBoards.apply(this,args);document.querySelectorAll('[data-load-board]').forEach(load=>{const id=load.dataset.loadBoard;const record=state.records.find(r=>r.id===id);if(record?.deleted){load.parentElement.remove();return;}if(load.parentElement.querySelector('[data-delete-board]'))return;const b=document.createElement('button');b.type='button';b.className='small secondary';b.dataset.deleteBoard=id;b.setAttribute('aria-label','Delete storyboard '+record?.title);b.title='Move revision to Trash';b.textContent='×';b.classList.add('workspace-delete');b.onclick=()=>action(async()=>{await api('trash/board',{id});notice('Storyboard revision moved to Trash.');});load.after(b);});return r;};
 const oldBoardPage=boardPage;boardPage=function(...args){const r=oldBoardPage.apply(this,args);const save=document.querySelector('#save-board');if(save){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent='×';b.classList.add('workspace-delete');b.title='Delete current storyboard';b.setAttribute('aria-label','Delete current storyboard');b.onclick=()=>action(async()=>{const storyAtDelete=activeStory;await api('trash/draft',{story_id:storyAtDelete,draft:structuredClone(draft)});draft={title:currentStory().title||'',story:'',scenes:[]};persistDraft();boardPage();notice('Current storyboard moved to Trash.');});save.after(b);}return r;};
 trashPage=function(){const items=deleted();document.querySelector('#page').innerHTML='<div class="section-head"><h2>Trash · all stories</h2><button id="empty-workspace-trash" class="secondary" '+(!items.length?'disabled':'')+'>Empty Trash ('+items.length+')</button></div><p class="help">Restore deleted items here. Empty Trash permanently removes the listed items and their local files; references to deleted images are removed from saved storyboards and characters. External copies and backups are unaffected.</p><div id="trash-items">'+items.map(r=>'<article class="panel section-head"><div><strong>'+esc(r.title||r.prompt||r.name||'Untitled image')+'</strong><p class="help">'+esc(r.kind==='board_draft'?'Current storyboard':r.kind==='board'?'Saved storyboard':r.kind==='asset'?(r.media||'Image'):r.kind)+'</p></div><button class="secondary" data-restore-item="'+r.id+'">Restore</button></article>').join('')+'</div>'+(items.length?'':'<p>Trash is empty.</p>');
 document.querySelectorAll('[data-restore-item]').forEach(b=>b.onclick=()=>action(async()=>{const r=items.find(r=>r.id===b.dataset.restoreItem);if(r.kind==='story')await api('stories/archive',{story_id:r.id,restore:true});else if(r.kind==='asset')await api('trash',{asset_id:r.id,restore:true});else if(r.kind==='image_folder'||r.kind==='audio_folder')await api('trash/folder',{id:r.id,restore:true});else if(r.kind==='board')await api('trash/board',{id:r.id,restore:true});else{const key='ecco-board-draft:'+r.story_id;const existing=JSON.parse(localStorage.getItem(key)||'null');if(existing&&(existing.scenes?.length||existing.story)){await api('trash/draft',{story_id:r.story_id,draft:existing});}const restored=await api('trash/restore-draft',{id:r.id});localStorage.setItem(key,JSON.stringify(restored.draft));if(activeStory===r.story_id)draft=restored.draft;}notice('Restored.');}));
 document.querySelector('#empty-workspace-trash').onclick=()=>{if(!confirm('Permanently delete all '+items.length+' items shown in Trash? Their local files and image references will be removed. This cannot be undone.'))return;action(async()=>{const result=await api('trash/empty',{ids:items.map(r=>r.id),confirmed:true});notice(result.purged_count+' items permanently deleted.');});};
 };
 trashIcon();
})();

/* Activity drawer edge control. */
(()=>{
 const panel=document.querySelector('#activity-panel'),original=document.querySelector('#toggle-activity'),close=document.querySelector('#close-activity');
 if(!panel||!original||!close||document.querySelector('#activity-edge-arrow'))return;
 const arrow=document.createElement('button');arrow.id='activity-edge-arrow';arrow.type='button';arrow.setAttribute('aria-controls','activity-panel');document.body.append(arrow);
 const sync=()=>{const open=!panel.hidden;panel.inert=!open;arrow.textContent=open?'→':'←';arrow.title=open?'Close Activity & Compute':'Open Activity & Compute';arrow.setAttribute('aria-label',arrow.title);arrow.setAttribute('aria-expanded',String(open));arrow.classList.toggle('drawer-open',open);};
 arrow.onclick=()=>{original.click();sync();};close.textContent='→';close.title='Close Activity & Compute';close.setAttribute('aria-label','Close Activity & Compute');close.onclick=()=>{panel.hidden=true;original.setAttribute('aria-expanded','false');sync();arrow.focus();};
 new MutationObserver(sync).observe(panel,{attributes:true,attributeFilter:['hidden']});sync();
 const style=document.createElement('style');style.textContent=`
 #toggle-activity{display:none!important}
 #activity-panel{display:block!important;position:fixed;top:0;right:0;bottom:0;width:min(480px,calc(100vw - 48px));box-sizing:border-box;z-index:90;transform:translateX(0);visibility:visible;transition:transform .25s ease,visibility .25s;overflow-y:auto}
 #activity-panel[hidden]{display:block!important;transform:translateX(100%);visibility:hidden;pointer-events:none}
 #activity-edge-arrow{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:91;width:40px;height:64px;padding:0;border-radius:10px 0 0 10px;font-size:25px;background:#38305e;color:#eeebf5;border:1px solid #70658c;transition:right .25s ease}
 #activity-edge-arrow.drawer-open{right:min(480px,calc(100vw - 48px))}
 body.workspace-entry-mode #activity-edge-arrow,body.workspace-entry-mode #activity-panel{display:none!important}
 @media(prefers-reduced-motion:reduce){#activity-panel,#activity-edge-arrow{transition:none}}
 `;document.head.append(style);
})();


/* Compose image instructions from the visible form for both creation and edits. */
(()=>{
 const fields=[
  ['background','Background',['Family room','Studio backdrop','Garden','City street','Beach','Transparent background']],
  ['posture','Posture',['Standing','Sitting','Lying down','Walking','Running','Jumping']],
  ['age','Age',['Young','Adult','Older adult']],
  ['gender','Gender',['Female','Male','Androgynous']],
  ['ethnicity','Ethnicity',['South Asian','East Asian','Southeast Asian','Middle Eastern','Black / African','White / European','Latino / Hispanic','Mixed heritage']]
 ];
 const q=s=>document.querySelector(s);
 function values(){const form=q('#image-form');if(!form)return {};const out={};for(const [key] of fields)out[key]=form.elements['image_'+key]?.value.trim()||'';return out;}
 function genre(){const e=q('#image-style')||q('#image-form [name="image_style"]');if(!e||!e.value)return '';const label=e.selectedOptions?.[0]?.textContent?.trim()||e.value;return /as described|unspecified|keep original/i.test(label)?'':label;}
 function compose(prompt,reference,style,settings){
  const lines=[];
  if(reference)lines.push('Edit the supplied reference image. The prompt and every selected control describe changes to this image, not an unrelated new image. Keep the same main subject, recognizable identity and species, except for changes explicitly requested below. Preserve unspecified details.');
  if(prompt.trim())lines.push('Requested scene or changes: '+prompt.trim());
  const looks={'3D animation':'Stylized three-dimensional animated-film rendering, sculpted rounded forms, expressive features, physically shaded materials and cinematic lighting','Cartoon':'Hand-drawn cartoon illustration with simplified shapes, expressive outlines and flat or cel-shaded colors','Origami':'Folded-paper art with visible creases, geometric paper planes and paper texture','Clay / claymation':'Handmade clay figures, tactile clay surfaces and stop-motion miniature-set lighting','Human / realistic portrait':'Anatomically realistic human portrait with natural skin texture and lifelike lighting','Photographic':'Photorealistic photography with natural textures and believable camera optics','Anime':'Japanese anime illustration with clean line art and cel shading','Watercolor':'Watercolor painting with translucent washes and visible paper texture','Oil painting':'Traditional oil painting with visible brushwork and rich pigments','Pixel art':'Pixel art with a limited palette and crisp deliberate pixel shapes'};
  if(style)lines.push('Required visual style / genre: '+style+'. '+(looks[style]||'')+'. Apply this style to the entire image, including the subject and background.');
  for(const [key,label] of fields)if(settings[key])lines.push(label+': '+settings[key]+'.');
  if(settings.gender||settings.ethnicity)lines.push('Apply gender and ethnicity instructions only to human subjects; do not change an animal into a person.');
  if(settings.age)lines.push('Interpret age appropriately for the subject species.');
  lines.push('Use the selected controls as explicit requirements, overriding conflicting descriptions of those attributes in the free-text prompt.');
  return lines.join('\n');
 }
 function preview(){const form=q('#image-form'),output=q('#image-effective-prompt');if(!form||!output)return;const reference=!!q('#studio-reference-image')?.value;output.value=compose(form.elements.prompt.value,reference,genre(),values());}
 function mount(){
  const form=q('#image-form');if(!form||q('#image-scene-controls'))return;
  const section=document.createElement('fieldset');section.id='image-scene-controls';
  const legend=document.createElement('legend');legend.textContent='Scene controls';section.append(legend);
  const hint=document.createElement('p');hint.className='help';hint.textContent='Leave a box blank to keep the original detail, or leave it unspecified for a new image. Choose a suggestion or type your own.';section.append(hint);
  for(const [key,title,options] of fields){const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');input.name='image_'+key;input.placeholder='Keep original / unspecified';input.setAttribute('list','image-options-'+key);input.autocomplete='off';const list=document.createElement('datalist');list.id='image-options-'+key;for(const value of options){const option=document.createElement('option');option.value=value;list.append(option);}label.append(input,list);section.append(label);}
  const anchor=(q('#image-style')||form.elements.prompt)?.closest('label');if(anchor)anchor.after(section);else form.prepend(section);
  const details=document.createElement('details');details.id='image-prompt-preview';const summary=document.createElement('summary');summary.textContent='Instructions sent to the model';const output=document.createElement('textarea');output.id='image-effective-prompt';output.readOnly=true;output.rows=8;output.setAttribute('aria-label','Instructions sent to the model');details.append(summary,output);section.after(details);
  form.addEventListener('input',preview);form.addEventListener('change',preview);form.addEventListener('click',()=>queueMicrotask(preview));preview();
 }
 if(typeof api==='function'){const previous=api;api=async function(path,payload,...rest){if((path==='images'||path==='image-edits')&&payload&&q('#image-form')){const settings=values(),style=genre();payload={...payload,prompt:compose(String(payload.prompt||''),path==='image-edits'||!!payload.source_asset_id,style,settings)};}return previous.call(this,path,payload,...rest);};}
 const observer=new MutationObserver(()=>{mount();});observer.observe(q('#page')||document.body,{childList:true,subtree:true});mount();
 document.addEventListener('ecco-reference-change',preview);
 window.EccoImageInstructions={compose};
})();

/* Reveal Activity & Compute at the right edge without reserving page space. */
(()=>{
 const arrow=document.querySelector('#activity-edge-arrow');
 if(!arrow)return;
 document.body.append(arrow);
 const style=document.createElement('style');
 style.textContent=`
 body > #activity-edge-arrow{position:fixed;right:0;top:50%;width:34px;height:48px;min-width:34px;padding:0;border-radius:8px 0 0 8px;font-size:21px;color:var(--accent,#ffdc24);transform:translate(110%,-50%);opacity:0;pointer-events:none;transition:transform .2s ease,opacity .2s ease,right .25s ease}
 body > #activity-edge-arrow.edge-near,body > #activity-edge-arrow.drawer-open,body > #activity-edge-arrow:focus-visible{transform:translate(0,-50%);opacity:1;pointer-events:auto}
 body > #activity-edge-arrow.drawer-open{right:min(480px,calc(100vw - 48px))}
 body > #activity-edge-arrow.has-active-jobs{width:56px}
 @media(hover:none),(pointer:coarse){body > #activity-edge-arrow{transform:translate(0,-50%);opacity:.65;pointer-events:auto}body > #activity-edge-arrow.drawer-open{opacity:1}}
 @media(prefers-reduced-motion:reduce){body > #activity-edge-arrow{transition:none}}
 `;
 document.head.append(style);
 document.addEventListener('pointermove',event=>{
  if(event.pointerType==='touch')return;
  const threshold=arrow.classList.contains('edge-near')?76:16;
  arrow.classList.toggle('edge-near',event.clientX>=document.documentElement.clientWidth-threshold);
 },{passive:true});
 document.documentElement.addEventListener('pointerleave',()=>arrow.classList.remove('edge-near'));
})();

/* Collapsible image control sections; edits clear only old completion notices. */
(()=>{
 const expansion=new Map();
 function mount(){
  const form=document.querySelector('#image-form');if(!form||form.dataset.collapsibleControls)return;
  if(!form.querySelector('#image-scene-controls'))return;
  form.dataset.collapsibleControls='1';
  const children=[...form.children],heading=form.querySelector('h2');
  const group=(title,key,nodes)=>{const present=nodes.filter(Boolean);if(!present.length)return;const details=document.createElement('details');details.className='image-control-section';details.open=expansion.get(key)??true;const summary=document.createElement('summary');summary.textContent=title;const body=document.createElement('div');body.className='image-control-body';details.append(summary,body);present[0].before(details);for(const node of present)body.append(node);details.addEventListener('toggle',()=>expansion.set(key,details.open));};
  const at=children.indexOf(heading);if(at>0)group('Model & reference image','model',children.slice(0,at));
  {const style=form.querySelector('#image-style')?.closest('label'),scene=form.querySelector('#image-scene-controls');const trigger=document.createElement('button');trigger.type='button';trigger.className='secondary';trigger.textContent='Scene controls';trigger.setAttribute('aria-haspopup','dialog');const dialog=document.createElement('dialog');dialog.className='scene-controls-dialog';dialog.setAttribute('aria-label','Scene controls');const body=document.createElement('div');body.className='form';const title=document.createElement('h2');title.textContent='Scene controls';const close=document.createElement('button');close.type='button';close.textContent='Done';body.append(title);(style||scene).before(trigger);if(style)body.append(style);body.append(scene,close);dialog.append(body);form.append(dialog);trigger.onclick=()=>dialog.showModal();close.onclick=()=>dialog.close();dialog.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName!=='BUTTON'){e.preventDefault();dialog.close();}});const count=()=>{const n=[...scene.querySelectorAll('input')].filter(i=>i.value.trim()).length;trigger.textContent='Scene controls'+(n?' · '+n+' selected':'');};dialog.addEventListener('input',count);}
  group('Image prompt','prompt',[form.elements.prompt?.closest('label'),form.querySelector('#image-prompt-preview')]);
  group('Advanced settings','advanced',[form.elements.negative?.closest('label'),form.elements.steps?.closest('.row'),form.elements.seed?.closest('label')]);
  heading?.remove();
  const clear=()=>{const key='ecco-image-job:'+activeStory,id=localStorage.getItem(key),job=state?.records.find(r=>r.kind==='job'&&r.id===id);if(job&&['done','failed','cancelled'].includes(job.status)){localStorage.removeItem(key);const status=form.querySelector('#image-status');if(status)status.textContent='';}};
  form.addEventListener('input',clear);form.addEventListener('change',clear);
 }
 new MutationObserver(mount).observe(document.querySelector('#page')||document.body,{childList:true,subtree:true});mount();
})();

/* Visible background work and prompt-assistant connection status. */
(()=>{
 function update(){
  const active=typeof state!=='undefined'&&state?.records?.filter(r=>r.kind==='job'&&['queued','running'].includes(r.status))||[];
  for(const arrow of document.querySelectorAll('#activity-edge-arrow,#toggle-activity.activity-edge-toggle')){
   const busy=active.length>0;arrow.classList.toggle('has-active-jobs',busy);let dots=arrow.querySelector('.activity-working-dots');if(busy&&!dots){dots=document.createElement('span');dots.className='activity-working-dots';dots.setAttribute('aria-hidden','true');dots.textContent='...';arrow.append(dots);}if(!busy&&dots)dots.remove();arrow.title=busy?active.length+' generation job(s) queued or running':'Activity & Compute';
  }
  for(const job of document.querySelectorAll('#jobs .job')){const status=[...job.querySelectorAll('.detail')].find(e=>/^(running|queued)$/.test(e.textContent.trim()));if(status&&!status.querySelector('.job-working-dots')){const dots=document.createElement('span');dots.className='job-working-dots';dots.textContent=' ...';dots.setAttribute('aria-hidden','true');status.append(dots);}}
  for(const form of document.querySelectorAll('#image-form,#video-form')){if(form.querySelector('.ai-prompt-assist'))continue;const prompt=form.elements.prompt;if(!prompt)continue;const button=document.createElement('button');button.type='button';button.className='small secondary ai-prompt-assist';button.textContent='✦ AI';button.title='AI prompt assistant · not connected';button.setAttribute('aria-label','AI prompt assistant — not connected');prompt.closest('label').after(button);button.onclick=()=>{let dialog=document.querySelector('#ai-prompt-connection');if(!dialog){dialog=document.createElement('dialog');dialog.id='ai-prompt-connection';dialog.innerHTML='<div class="form"><h2>AI prompt assistant</h2><p>Not connected yet. OpenAI API integration requires a server-side API key and separate usage billing. A self-hosted open-source text model is another option; it uses your compute.</p><p>No prompt has been sent and no generation has started.</p><button type="button">Close</button></div>';document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();}dialog.showModal();};}
 }
 setInterval(update,1000);update();
})();

/* Keep animated branding scoped to the welcome screen. */
(()=>{function mount(){const logo=document.querySelector('#workspace-entry .entry-logo');if(!logo||logo.parentElement.classList.contains('entry-logo-motion'))return;const motion=document.createElement('div');motion.className='entry-logo-motion';logo.before(motion);motion.append(logo);for(let i=0;i<48;i++){const dot=document.createElement('span');dot.className='entry-logo-particle';dot.setAttribute('aria-hidden','true');motion.append(dot);}}new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});mount();})();

/* Job diagnostics: explicit job input/output evidence, never raw configuration. */
(()=>{
 const q=s=>document.querySelector(s),safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let captured={};try{captured=JSON.parse(localStorage.getItem('ecco-job-debug')||'{}');}catch{}let chosen='',signature='';
 const oldApi=api;api=async function(path,payload,...rest){if(!['images','image-edits','videos','render'].includes(path)||!payload)return oldApi.call(this,path,payload,...rest);const submission={prompt:q('#image-form #image-effective-prompt')?.value||payload.prompt||'',model:payload.model||q('#job-model')?.value||'',reference_ids:[payload.asset_id||payload.source_asset_id].filter(Boolean),submitted_at:Date.now()};const result=await oldApi.call(this,path,payload,...rest);if(result?.id){captured[result.id]=submission;const ids=Object.keys(captured);for(const id of ids.slice(0,Math.max(0,ids.length-30)))delete captured[id];try{localStorage.setItem('ecco-job-debug',JSON.stringify(captured));}catch{}}return result;};
 function render(){const root=q('#ecco-debug-view');if(!root||root.hidden||typeof state==='undefined'||!state)return;const jobs=state.records.filter(r=>r.kind==='job').sort((a,b)=>b.created-a.created).slice(0,30);if(!jobs.some(j=>j.id===chosen))chosen=jobs[0]?.id||'';const job=jobs.find(j=>j.id===chosen),asset=job&&state.records.find(a=>a.kind==='asset'&&(a.id===job.result||a.job_id===job.id)),input=captured[chosen],refIds=asset?.settings?.reference_ids||input?.reference_ids||[],refs=refIds.map(id=>state.records.find(a=>a.id===id)).filter(Boolean);const sig=JSON.stringify({jobs,chosen,asset,input,refs});if(sig===signature)return;signature=sig;
 root.innerHTML='<label>Inspect job<select id="ecco-debug-job">'+jobs.map(j=>'<option value="'+safe(j.id)+'" '+(j.id===chosen?'selected':'')+'>'+safe(new Date(j.created*1000).toLocaleTimeString()+' · '+j.label+' · '+j.status)+'</option>').join('')+'</select></label>'+(job?'<dl class="debug-facts"><dt>Job ID</dt><dd>'+safe(job.id)+'</dd><dt>Status</dt><dd>'+safe(job.status)+'</dd><dt>Progress</dt><dd>'+safe(job.progress||'—')+'</dd><dt>Model</dt><dd>'+safe(asset?.settings?.model||input?.model||'Not recorded for this job')+'</dd><dt>Elapsed</dt><dd>'+safe(job.seconds===undefined?'—':job.seconds.toFixed(1)+' seconds')+'</dd><dt>Output ID</dt><dd>'+safe(asset?.id||job.result||'No output yet')+'</dd></dl>'+(job.error?'<p class="debug-error">'+safe(job.error)+'</p>':'')+'<h3>Reference image sent</h3>'+(refs.length?refs.map(a=>'<figure><img class="debug-image" src="'+safe(media(a))+'" alt="Reference: '+safe(a.title||a.id)+'"><figcaption>'+safe(a.title||a.id)+' · '+safe(a.id)+'</figcaption></figure>').join(''):'<p class="help">'+(input&&!refIds.length?'No reference image recorded in this submission.':'Reference details unavailable for this job.')+'</p>')+'<h3>Submitted prompt</h3><textarea readonly rows="8" aria-label="Submitted prompt">'+safe(asset?.prompt||input?.prompt||'Prompt not recorded for this older job. New submissions will capture it here.')+'</textarea><h3>Output preview</h3>'+(asset?.media==='image'?'<img class="debug-image" src="'+safe(media(asset))+'" alt="Generated output">':asset?.media==='video'?'<video class="debug-image" src="'+safe(media(asset))+'" controls preload="metadata"></video>':'<p class="help">No output asset available.</p>')+(asset?.settings?'<h3>Recorded generation settings</h3><pre>'+safe(JSON.stringify(asset.settings,null,2))+'</pre>':''):'<p>No generation jobs yet.</p>');q('#ecco-debug-job').onchange=e=>{chosen=e.target.value;signature='';render();};
 }
 function mount(){const panel=q('#activity-panel'),jobs=q('#jobs');if(!panel||!jobs||q('#ecco-activity-tabs'))return;const tabs=document.createElement('div');tabs.id='ecco-activity-tabs';tabs.className='row';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Activity panel views');tabs.innerHTML='<button type="button" role="tab" aria-selected="true" aria-controls="jobs">Activity</button><button type="button" role="tab" aria-selected="false" aria-controls="ecco-debug-view" class="secondary">Debugging</button>';const root=document.createElement('section');root.id='ecco-debug-view';root.hidden=true;root.setAttribute('role','tabpanel');jobs.before(tabs);jobs.after(root);for(const button of tabs.children)button.onclick=()=>{const debugging=button.textContent==='Debugging';jobs.hidden=debugging;root.hidden=!debugging;for(const b of tabs.children){b.setAttribute('aria-selected',String(b===button));b.classList.toggle('secondary',b!==button);}render();};}
 new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});setInterval(render,1000);mount();
})();

/* Accelerator color reflects its actual connection state. */
(()=>{const style=document.createElement('style');style.textContent=`
#connected-accelerator{background:transparent!important;color:#eeebf5!important;border:1px solid transparent;box-shadow:none}
#connected-accelerator.accelerator-connected{background:var(--accent,#ffdc24)!important;color:#19152b!important}
#connected-accelerator:focus-visible{outline:2px solid #eeebf5;outline-offset:3px}
`;document.head.append(style);})();

