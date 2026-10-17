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
 function labelDialog(id){const asset=records().find(a=>a.id===id);if(!asset)return;let d=q('#workspace-label-dialog');if(!d){d=document.createElement('dialog');d.id='workspace-label-dialog';document.body.append(d);}const selected=new Set(labelsFor(id).map(f=>f.id));d.innerHTML='<form class="form"><div class="section-head"><h2>Add labels</h2><button type="button" class="secondary small" data-create>Create new label</button></div><p class="help">Choose labels to organize this image in your library.</p><div class="workspace-label-options">'+(folderList().map(f=>`<label class="workspace-label-option"><input type="checkbox" name="labels" value="${f.id}" ${selected.has(f.id)?'checked disabled':''}><span>${html(f.name)}</span>${selected.has(f.id)?'<small>Added</small>':''}</label>`).join('')||'<p>Create your first label.</p>')+'</div><p role="status"></p><div class="row"><button type="submit">Add selected labels</button><button type="button" class="secondary" data-close>Cancel</button></div></form>';d.querySelector('[data-close]').onclick=()=>d.close();d.querySelector('[data-create]').onclick=()=>createFolder(()=>{d.close();labelDialog(id);});d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('[type=submit]');b.disabled=true;try{for(const fid of new FormData(e.target).getAll('labels'))if(!selected.has(fid))await api('library/save',{asset_id:id,folder_id:fid});await refresh();d.close();modernize();notice('Labels added. The image is available in those folders.');}catch(err){d.querySelector('[role=status]').textContent=err.message;}finally{b.disabled=false;}};d.showModal();}
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
   if(nested.length||images.length){
    const toggle=document.createElement('button');toggle.type='button';toggle.className='tree-branch-toggle';toggle.textContent='▸';
    const sync=()=>{const open=expansion.get(key)===true;children.hidden=!open;toggle.textContent=open?'▾':'▸';toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',(open?'Collapse ':'Expand ')+folder.name);};
    toggle.onclick=()=>{expansion.set(key,expansion.get(key)!==true);sync();};sync();row.append(toggle);
   }else{const spacer=document.createElement('span');spacer.className='tree-branch-spacer';row.append(spacer);}
   const label=document.createElement('button');label.type='button';label.className='tree-folder';
   label.textContent=parentOf(folder)?folder.name.split(' / ').at(-1):folder.name.replaceAll(' / ',' → ');label.title=folder.name.replaceAll(' / ',' → ');label.classList.toggle('selected',folder.id===select.value);
   label.onclick=()=>openFolder(folder.id);row.append(label);group.append(row,children);
   for(const child of nested)appendFolder(child,children);
   for(const asset of images){const item=document.createElement('button');item.type='button';item.className='tree-image';item.textContent=asset.title||asset.prompt||'Untitled image';item.title=item.textContent;item.onclick=()=>{openFolder(folder.id);const img=[...document.querySelectorAll('img[data-asset]')].find(el=>el.dataset.asset===asset.id);if(img)img.click();};children.append(item);}
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
   model.disabled=!!asset;
   if(asset){
    if(!model.querySelector('option[value="qwen-image-edit-2511"]')){const o=document.createElement('option');o.value='qwen-image-edit-2511';o.textContent='Qwen Image Edit · reference image';model.append(o);}
    model.value='qwen-image-edit-2511';preview.src=media(asset);
    help.textContent='Describe your changes in Image prompt below. Qwen Image Edit uses this reference and preserves the original.';
    button.textContent='Generate edited image';
   }else{model.value=originalModel;preview.removeAttribute('src');button.textContent=originalText;}
   document.dispatchEvent(new Event('ecco-reference-change'));
  };
  form.addEventListener('submit',async e=>{
   if(!select.value)return;e.preventDefault();e.stopImmediatePropagation();
   const asset=records().find(a=>a.id===select.value&&!a.deleted);if(!asset){notice('This reference is no longer available.',true);return;}
   if(!state.config.models_ready?.['qwen-image-edit-2511']){notice('Qwen Image Edit is not ready on this GPU.',true);return;}
   const prompt=form.elements.prompt.value.trim();if(!prompt)return;
   const style='';
   if(button.disabled)return;
   const story=activeStory;
   submittingImages.add(story);localStorage.removeItem('ecco-image-job:'+story);
   setGenerationBusy(button,true,'Submitting…','Generate edited image');
   const status=form.querySelector('#image-status');
   if(status)status.textContent='Sending your reference-image edit…';
   try{const job=await api('image-edits',{asset_id:asset.id,story_id:story,prompt:prompt+(style?' Visual style: '+style+'.':'')});
    localStorage.setItem('ecco-image-job:'+story,job.id);
    submittingImages.delete(story);
    await refresh();
    notice('Reference edit queued. Your original image is preserved.');
   }catch(err){
    submittingImages.delete(story);
    if(button.isConnected)setGenerationBusy(button,false,'','Generate edited image');
    if(status?.isConnected)status.textContent=err.message+' Check Activity before retrying.';
    notice(err.message,true);
   }
  },true);
 }

 function imageLabels(){document.querySelectorAll('[data-approve]').forEach(b=>{const asset=records().find(r=>r.id===b.dataset.approve);if(asset?.media==='video')b.textContent='Approve & add to Video Library';});document.querySelectorAll('[data-trash]').forEach(b=>{b.textContent='×';b.classList.add('workspace-delete');});document.querySelectorAll('[data-library-save]').forEach(b=>{const id=b.dataset.librarySave;b.textContent='+ Add label';b.onclick=()=>labelDialog(id);const card=b.closest('.card');if(!card)return;let chips=card.querySelector('.workspace-labels');if(!chips){chips=document.createElement('div');chips.className='workspace-labels';b.closest('.actions').before(chips);}const signature=JSON.stringify(labelsFor(id).map(f=>[f.id,f.name]));if(chips.dataset.signature!==signature){chips.dataset.signature=signature;chips.innerHTML=labelsFor(id).map(f=>`<span class="workspace-label">${html(f.name)}</span>`).join('');}});}
 function ribbon(){const header=q('main > header'),right=header?.querySelector('.header-right');if(!right)return;header.classList.add('workspace-ribbon');if(!q('#workspace-menus')){const menus=document.createElement('div');menus.id='workspace-menus';for(const name of ['Billing','Account','Activity']){const d=document.createElement('details');d.className='workspace-menu';d.dataset.category=name;d.innerHTML=`<summary>${name}<span aria-hidden="true">⌄</span></summary><div class="workspace-menu-items"></div>`;d.addEventListener('toggle',()=>{if(d.open)menus.querySelectorAll('details').forEach(other=>{if(other!==d)other.open=false;});});menus.append(d);}right.append(menus);}const target=name=>q(`[data-category="${name}"] .workspace-menu-items`);const move=(node,name)=>{if(node&&node.parentElement!==target(name))target(name).append(node);};if(typeof powerButton!=='undefined')move(powerButton,'Billing');move(q('#settings'),'Account');move(q('#reconnect-gpu'),'Account');move(q('#sync'),'Activity');move(q('#open-comfyui'),'Activity');q('#workspace-menus').querySelectorAll('button,a').forEach(el=>{if(el.dataset.ribbonClose)return;el.dataset.ribbonClose='1';el.addEventListener('click',()=>(()=>{const menu=el.closest('details');if(menu)menu.open=false;})());});}
 let hardwareVerifiedAt=0;
 function acceleratorDisplay(){
  const hardware=typeof state!=='undefined'?state?.config?.accelerator:null;
  const fresh=hardwareVerifiedAt&&Date.now()-hardwareVerifiedAt<45000;
  const names=hardware?.status==='detected'?hardware.devices.map(d=>d.name):[];
  const text=fresh&&names.length?names.join(' + ')+' · Connected':names.length?names.join(' + ')+' · Connection unverified':'Accelerator · Unverified';
  let badge=q('#connected-accelerator');const header=q('main > header .header-right');
  if(!badge&&header){badge=document.createElement('span');badge.id='connected-accelerator';badge.className='badge';badge.setAttribute('role','status');header.prepend(badge);}
  if(badge){badge.textContent=text;badge.title='Hardware detected by the connected Studio server. Connection status does not indicate whether another pod is powered off.';}
  const form=q('#video-form');let status=q('#video-accelerator');
  if(form&&!status){status=document.createElement('p');status.id='video-accelerator';status.className='help';status.setAttribute('role','status');form.prepend(status);}
  if(status)status.textContent=text;
 }
 if(typeof api==='function'){const previous=api;api=async function(path,...args){try{const result=await previous.call(this,path,...args);if(path==='state')hardwareVerifiedAt=Date.now();return result;}catch(error){if(path==='state'){hardwareVerifiedAt=0;acceleratorDisplay();}throw error;}};}
 if(typeof navigate==='function'){const previous=navigate;navigate=function(...args){if(args[0]==='welcome'||(welcomePending&&args[0]==='images')){welcomePending=false;welcomePage();return;}document.body.classList.remove('workspace-entry-mode');if(args[0]==='empty'){page='empty';q('#page')?.replaceChildren();if(q('#heading'))q('#heading').textContent='';document.querySelectorAll('nav button.active').forEach(b=>b.classList.remove('active'));return;}const result=previous.apply(this,args);imageReferencePicker();acceleratorDisplay();return result;};}
 setInterval(acceleratorDisplay,5000);
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
 function productionGroup(){
  const nav=q('nav[aria-label="Production stages"]');if(!nav)return;
  let group=q('#workspace-production-group');
  if(!group){group=disclosure('Tell Your Story','ecco-production-expanded');group.id='workspace-production-group';nav.append(group);group.querySelector('summary').addEventListener('click',()=>{if(!group.open)q('#workspace-new-story')?.click();});}
  const body=group.querySelector('.workspace-library-content');
  let start=q('#workspace-new-story');if(!start){start=document.createElement('button');start.type='button';start.id='workspace-new-story';start.className='tree-create';start.textContent='+ Name of the New Video';start.onclick=()=>{const original=q('#new-story');if(original){original.click();const form=q('#new-story-form');if(form){form.querySelector('h2').textContent='Name of the New Video';const title=form.querySelector('input[name="title"]');title.placeholder='Name of the New Video';title.focus();}nav.querySelectorAll('button.active').forEach(b=>b.classList.remove('active'));start.classList.add('active');}else notice('Wait for the workspace to connect.');};body.prepend(start);}
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

 function activityDrawer(){
  const panel=q('#activity-panel'),toggle=q('#toggle-activity'),close=q('#close-activity');
  if(!panel||!toggle||!close||panel.dataset.arrowDrawer)return;
  panel.dataset.arrowDrawer='1';
  document.body.append(toggle);
  toggle.classList.add('activity-edge-toggle');
  toggle.setAttribute('aria-controls','activity-panel');
  close.textContent='→';close.title='Close Activity & Compute';
  close.setAttribute('aria-label','Close Activity & Compute');
  const setOpen=open=>{
   panel.hidden=!open;panel.inert=!open;
   toggle.textContent=open?'→':'←';
   toggle.title=open?'Close Activity & Compute':'Open Activity & Compute';
   toggle.setAttribute('aria-label',toggle.title);
   toggle.setAttribute('aria-expanded',String(open));
   toggle.classList.toggle('drawer-open',open);
  };
  toggle.onclick=()=>setOpen(panel.hidden);
  close.onclick=()=>{setOpen(false);toggle.focus();};
  setOpen(!panel.hidden);
  const style=document.createElement('style');
  style.textContent=`
   #activity-panel{display:block!important;position:fixed;top:0;right:0;bottom:0;width:min(480px,calc(100vw - 48px));box-sizing:border-box;z-index:90;transform:translateX(0);visibility:visible;transition:transform .25s ease,visibility .25s;overflow-y:auto}
   #activity-panel[hidden]{display:block!important;transform:translateX(100%);visibility:hidden;pointer-events:none}
   #toggle-activity.activity-edge-toggle{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:91;width:40px;height:64px;padding:0;border-radius:10px 0 0 10px;font-size:25px;background:#38305e;color:#eeebf5;border:1px solid #70658c;transition:right .25s ease}
   #toggle-activity.activity-edge-toggle.drawer-open{right:min(480px,calc(100vw - 48px))}
   body.workspace-entry-mode #toggle-activity,body.workspace-entry-mode #activity-panel{display:none!important}
   @media(prefers-reduced-motion:reduce){#activity-panel,#toggle-activity.activity-edge-toggle{transition:none}}
  `;
  document.head.append(style);
 }

 function modernize(){const footer=q('.side-bottom');if(footer&&!q('#workspace-copyright')){const copyright=document.createElement('p');copyright.id='workspace-copyright';copyright.textContent='© '+new Date().getFullYear()+' Ecco Labs AI India Pvt Ltd. All rights reserved.';footer.append(copyright);}document.title='Ecco AI Labs Studios';if(typeof names!=='undefined')for(const key of Object.keys(names))names[key]=names[key].replace(/\bstudio\b/gi,'Studios');document.querySelectorAll('aside small,aside span,aside p').forEach(el=>{if(!el.children.length&&el.textContent.trim().toLowerCase()==='production studio')el.textContent='Studios';});ribbon();activityDrawer();accountCredits();imageReferencePicker();imageTree();storyTree();libraryGroup();productionGroup();educationMenu();videoLibrary();imageLabels();acceleratorDisplay();}
 if(typeof storyControls==='function'){const previous=storyControls;storyControls=function(...args){const result=previous.apply(this,args);modernize();return result;};}
 if(typeof wireCards==='function'){const previous=wireCards;wireCards=function(...args){const result=previous.apply(this,args);imageLabels();return result;};}
 document.addEventListener('click',e=>{document.querySelectorAll('.workspace-menu[open]').forEach(d=>{if(!d.contains(e.target))d.open=false;});});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.workspace-menu[open]').forEach(d=>{d.open=false;d.querySelector('summary').focus();});});
 window.EccoWorkspaceUI={labelDialog,createFolder,uploadDialog};
 modernize();welcomePage();
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

/* Compact Activity drawer control shared by image, video and storyboard pages. */
(()=>{
 const arrow=document.querySelector('#activity-edge-arrow')||document.querySelector('#toggle-activity.activity-edge-toggle');
 function position(){
  const page=document.querySelector('#page');
  if(!page||!arrow)return;
  let bar=page.querySelector('#activity-page-toolbar');
  if(!bar){bar=document.createElement('div');bar.id='activity-page-toolbar';const intro=page.querySelector(':scope > .intro');if(intro)intro.after(bar);else page.prepend(bar);}
  if(arrow.parentElement!==bar)bar.append(arrow);
 }
 new MutationObserver(position).observe(document.querySelector('#page')||document.body,{childList:true,subtree:true});position();
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
  group('Style & scene controls','scene',[form.querySelector('#image-style')?.closest('label'),form.querySelector('#image-scene-controls')]);
  group('Image prompt','prompt',[form.elements.prompt?.closest('label'),form.querySelector('#image-prompt-preview')]);
  group('Advanced settings','advanced',[form.elements.negative?.closest('label'),form.elements.steps?.closest('.row'),form.elements.seed?.closest('label')]);
  heading?.remove();
  const clear=()=>{const key='ecco-image-job:'+activeStory,id=localStorage.getItem(key),job=state?.records.find(r=>r.kind==='job'&&r.id===id);if(job&&['done','failed','cancelled'].includes(job.status)){localStorage.removeItem(key);const status=form.querySelector('#image-status');if(status)status.textContent='';}};
  form.addEventListener('input',clear);form.addEventListener('change',clear);
 }
 new MutationObserver(mount).observe(document.querySelector('#page')||document.body,{childList:true,subtree:true});mount();
})();

/* Original animated branding, welcome screen only. */
(()=>{function mount(){const logo=document.querySelector('#workspace-entry .entry-logo');if(!logo||logo.parentElement.classList.contains('entry-logo-motion'))return;const motion=document.createElement('div');motion.className='entry-logo-motion';logo.before(motion);motion.append(logo);for(let i=0;i<48;i++){const dot=document.createElement('span');dot.className='entry-logo-particle';dot.setAttribute('aria-hidden','true');motion.append(dot);}}new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});mount();})();
