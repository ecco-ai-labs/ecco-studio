'use strict';
/* Enhances the existing Studio controls; keeps their API and event handlers. */
(()=>{
 const q=s=>document.querySelector(s);
 const expansion=new Map();
 function selectionToolbar(body,name,button){const selected=body.querySelector('.tree-folder.selected');if(!selected||!button)return;const row=document.createElement('div');row.className='library-selected-row';selected.before(row);row.append(selected);button.hidden=false;button.className='secondary asset-icon workspace-delete';button.textContent='×';button.title='Move '+name+' to Trash';button.setAttribute('aria-label','Delete '+name);row.append(button);}
 const records=()=>typeof state!=='undefined'&&state?state.records:[];
 const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const folderList=()=>records().filter(r=>r.kind==='image_folder'&&!r.deleted).sort((a,b)=>a.created-b.created||a.id.localeCompare(b.id));
 const labelsFor=id=>{const ids=new Set(records().filter(r=>r.kind==='library_item'&&r.asset_id===id&&!r.deleted).map(r=>r.folder_id));return folderList().filter(f=>ids.has(f.id));};
 function disclosure(title,key){const d=document.createElement('details');d.className='workspace-library';d.open=expansion.get(key)===true;d.innerHTML=`<summary><span class="library-symbol" aria-hidden="true"></span><span>${title}</span></summary><div class="workspace-library-content"></div>`;d.addEventListener('toggle',()=>expansion.set(key,d.open));return d;}
 function createFolder(after,parentName=''){let d=q('#workspace-folder-dialog');if(!d){d=document.createElement('dialog');d.id='workspace-folder-dialog';document.body.append(d);}d.innerHTML='<form class="form"><h2>Create new label</h2><label>Label name<input name="name" required maxlength="80" autocomplete="off"></label><label>Parent label<select name="parent"><option value="">None (top level)</option>'+folderList().map(f=>'<option value="'+html(f.name)+'" '+(f.name===parentName?'selected':'')+'>'+html(f.name.replaceAll(' / ',' → '))+'</option>').join('')+'</select></label><p role="status"></p><div class="row"><button type="submit">Create label</button><button type="button" class="secondary">Cancel</button></div></form>';d.querySelector('[type=button]').onclick=()=>d.close();d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('[type=submit]');b.disabled=true;try{if(!e.target.elements.name.value.trim())throw Error('Enter a label name.');if([e.target.elements.parent.value,e.target.elements.name.value.trim()].filter(Boolean).join(' / ').length>80)throw Error('The full label path must be 80 characters or fewer.');if(e.target.elements.name.value.includes('/'))throw Error('Use the parent selector to create nested labels.');const folder=await api('library/folders',{name:[e.target.elements.parent.value,e.target.elements.name.value.trim()].filter(Boolean).join(' / ')});if(folder.deleted)throw Error('A library with this name is in Trash. Restore it or choose another name.');await refresh();d.close();modernize();if(after)after(folder);}catch(err){d.querySelector('[role=status]').textContent=err.message;}finally{b.disabled=false;}};d.showModal();d.querySelector('input').focus();}
 function labelDialog(id){const asset=records().find(a=>a.id===id);if(!asset)return;let d=q('#workspace-label-dialog');if(!d){d=document.createElement('dialog');d.id='workspace-label-dialog';document.body.append(d);}const selected=new Set(labelsFor(id).map(f=>f.id));d.innerHTML='<form class="form"><div class="section-head"><h2>Add labels</h2><button type="button" class="secondary small" data-create>Create new label</button></div><p class="help">Choose labels to organize this image in your library.</p><div class="workspace-label-options">'+(folderList().map(f=>`<label class="workspace-label-option"><input type="checkbox" name="labels" value="${f.id}" ${selected.has(f.id)?'checked disabled':''}><span>${html(f.name)}</span>${selected.has(f.id)?'<small>Added</small>':''}</label>`).join('')||'<p>Create your first label.</p>')+'</div><p role="status"></p><div class="row"><button type="submit">Add selected labels</button><button type="button" class="secondary" data-close>Cancel</button></div></form>';d.querySelector('[data-close]').onclick=()=>d.close();d.querySelector('[data-create]').onclick=()=>createFolder(()=>{d.close();labelDialog(id);});d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('[type=submit]');b.disabled=true;try{for(const fid of new FormData(e.target).getAll('labels'))if(!selected.has(fid))await api('library/save',{asset_id:id,folder_id:fid});await refresh();d.close();modernize();notice('Labels added. The image is available in those folders.');}catch(err){d.querySelector('[role=status]').textContent=err.message;}finally{b.disabled=false;}};d.showModal();}
 function uploadDialog(){let d=q('#workspace-upload-dialog');if(!d){d=document.createElement('dialog');d.id='workspace-upload-dialog';document.body.append(d);}d.innerHTML='<form class="form"><h2>Upload image</h2><label>Picture or object image<input type="file" name="image" accept="image/png,image/jpeg,image/webp" required></label><p class="help">PNG, JPEG or WebP · up to 12 MB and 20 megapixels. Your original upload is preserved when you edit a copy.</p><label>Next step<select name="next"><option value="label">Add to image library</option><option value="edit">Edit image first</option></select></label><p role="status"></p><div class="row"><button type="submit">Upload image</button><button type="button" class="secondary">Cancel</button></div></form>';d.querySelector('[type=button]').onclick=()=>d.close();d.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.target,file=form.elements.image.files[0],button=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]');if(!file)return;if(file.size>12*1024*1024){status.textContent='Choose an image no larger than 12 MB.';return;}button.disabled=true;status.textContent='Uploading image…';try{const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(Error('Could not read this file.'));r.onload=()=>resolve(String(r.result).split(',')[1]);r.readAsDataURL(file);});const asset=await api('images/upload',{name:file.name,data,story_id:activeStory});await refresh();d.close();navigate('images');modernize();if(form.elements.next.value==='edit')editImageDialog(asset.id);else labelDialog(asset.id);notice('Image uploaded. Add labels to keep it in your library.');}catch(err){status.textContent=err.message;}finally{button.disabled=false;}};d.showModal();}
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
  for(const folder of folderList().slice().sort((a,b)=>{const path=f=>{const parts=f.name.split(' / ');return parts.map((_,i)=>folderList().find(x=>x.name===parts.slice(0,i+1).join(' / '))?.created||f.created);};const aa=path(a),bb=path(b);for(let i=0;i<Math.min(aa.length,bb.length);i++){if(aa[i]!==bb[i])return aa[i]-bb[i];}return aa.length-bb.length;})){
   const group=document.createElement('div');group.className='tree-label-group';
   const label=document.createElement('button');label.type='button';label.className='tree-folder';
   const parts=folder.name.split(' / ');group.style.marginLeft=((parts.length-1)*14)+'px';label.textContent='− '+parts.at(-1);label.title=folder.name.replaceAll(' / ',' → ');label.classList.toggle('selected',folder.id===select.value);label.onclick=()=>openFolder(folder.id);group.append(label);
   const ids=new Set(links.filter(r=>r.folder_id===folder.id).map(r=>r.asset_id));
   for(const asset of assets.filter(a=>ids.has(a.id)).sort((a,b)=>a.created-b.created)){
    const item=document.createElement('button');item.type='button';item.className='tree-image';
    item.textContent='−− '+(asset.title||asset.prompt||'Untitled image');item.title=asset.title||asset.prompt||'Open image';
    item.onclick=()=>{openFolder(folder.id);const img=[...document.querySelectorAll('img[data-asset]')].find(el=>el.dataset.asset===asset.id);if(img)img.click();};group.append(item);
   }
   const add=document.createElement('button');add.type='button';add.className='tree-create';add.textContent='+ Sublabel';add.setAttribute('aria-label','Add sublabel to '+folder.name);add.onclick=()=>createFolder(null,folder.name);group.append(add);body.append(group);
  }
  const create=document.createElement('button');create.type='button';create.className='tree-create';create.textContent='+ New Label';
  create.onclick=()=>createFolder(()=>{const current=q('#image-library-nav .workspace-library');if(current)current.open=true;});body.append(create);
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
 function imageLabels(){document.querySelectorAll('[data-trash]').forEach(b=>{b.textContent='×';b.classList.add('workspace-delete');});document.querySelectorAll('[data-library-save]').forEach(b=>{const id=b.dataset.librarySave;b.textContent='+ Add label';b.onclick=()=>labelDialog(id);const card=b.closest('.card');if(!card)return;let chips=card.querySelector('.workspace-labels');if(!chips){chips=document.createElement('div');chips.className='workspace-labels';b.closest('.actions').before(chips);}const signature=JSON.stringify(labelsFor(id).map(f=>[f.id,f.name]));if(chips.dataset.signature!==signature){chips.dataset.signature=signature;chips.innerHTML=labelsFor(id).map(f=>`<span class="workspace-label">${html(f.name)}</span>`).join('');}});}
 function ribbon(){const header=q('main > header'),right=header?.querySelector('.header-right');if(!right)return;header.classList.add('workspace-ribbon');if(!q('#workspace-menus')){const menus=document.createElement('div');menus.id='workspace-menus';for(const name of ['Billing','Account','Activity']){const d=document.createElement('details');d.className='workspace-menu';d.dataset.category=name;d.innerHTML=`<summary>${name}<span aria-hidden="true">⌄</span></summary><div class="workspace-menu-items"></div>`;d.addEventListener('toggle',()=>{if(d.open)menus.querySelectorAll('details').forEach(other=>{if(other!==d)other.open=false;});});menus.append(d);}right.append(menus);}const target=name=>q(`[data-category="${name}"] .workspace-menu-items`);const move=(node,name)=>{if(node&&node.parentElement!==target(name))target(name).append(node);};if(typeof powerButton!=='undefined')move(powerButton,'Billing');move(q('#settings'),'Account');move(q('#reconnect-gpu'),'Account');move(q('#sync'),'Activity');move(q('#open-comfyui'),'Activity');move(q('#toggle-activity'),'Activity');q('#workspace-menus').querySelectorAll('button,a').forEach(el=>{if(el.dataset.ribbonClose)return;el.dataset.ribbonClose='1';el.addEventListener('click',()=>el.closest('details').open=false);});}
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
 if(typeof navigate==='function'){const previous=navigate;navigate=function(...args){const result=previous.apply(this,args);acceleratorDisplay();return result;};}
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
  let d=q('#workspace-publish-dialog');if(!d){d=document.createElement('dialog');d.id='workspace-publish-dialog';document.body.append(d);}
  const list=stories(),videos=records().filter(r=>r.kind==='asset'&&r.media==='video'&&!r.deleted&&list.some(s=>s.id===(r.story_id||LEGACY_STORY)));
  d.innerHTML='<div class="form"><h2>Publish to Video</h2><p class="help">Choose a video from Story Library. Review videos in Video Studio before publishing.</p><div class="workspace-publish-list"></div><button type="button" class="secondary" data-close>Close</button></div>';
  const body=d.querySelector('.workspace-publish-list');
  for(const story of list){const items=videos.filter(v=>(v.story_id||LEGACY_STORY)===story.id);if(!items.length)continue;const h=document.createElement('h3');h.textContent=story.title;body.append(h);
   for(const video of items){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=(video.title||'Untitled video')+(video.upload_state?' · '+video.upload_state:video.stage==='prod'?' · Ready to publish':' · Review first');button.onclick=()=>{persistDraft();activeStory=story.id;localStorage.setItem('ecco-active-story',activeStory);draft=loadDraft();lastSignature='';d.close();storyControls();if(video.stage==='prod'&&!video.upload_state){navigate('publish');const select=q('#publish-form select[name="asset_id"]');if(select)select.value=video.id;}else{navigate('render');notice(video.upload_state?'This video already has a publishing status: '+video.upload_state:'Review and approve this video in Video Studio, then select it here to publish.');}};body.append(button);}
  }
  if(!videos.length)body.textContent='No videos in Story Library yet. Create a video in Video Studio to get started.';
  d.querySelector('[data-close]').onclick=()=>d.close();d.showModal();
 }
 function productionGroup(){
  const nav=q('nav[aria-label="Production stages"]');if(!nav)return;
  let group=q('#workspace-production-group');
  if(!group){group=disclosure('Tell Your Story','ecco-production-expanded');group.id='workspace-production-group';nav.append(group);}
  const body=group.querySelector('.workspace-library-content');
  for(const button of [...nav.querySelectorAll('button[data-page]')]){
   const page=button.dataset.page;
   if(['characters','review','publish'].includes(page)){button.remove();continue;}
   if(page==='models'){const activity=q('[data-category="Activity"] .workspace-menu-items');if(activity){button.hidden=false;button.textContent='Models & Settings';activity.prepend(button);}continue;}
   button.hidden=false;const title=page==='director'?'Story Narration':button.textContent.trim().replace(/^(?:−\\s*|\\d+\\s*)/,'');button.textContent='− '+title;if(button.parentElement!==body)body.append(button);
  }
  const models=q('#model-nav');if(models)models.hidden=true;
  let publish=q('#workspace-publish');if(!publish){publish=document.createElement('button');publish.id='workspace-publish';publish.type='button';publish.title='Publish to Video';publish.setAttribute('aria-label','Publish to Video');publish.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></svg><span>Publish to Video</span>';publish.onclick=publishMenu;group.after(publish);}
  if(typeof names!=='undefined')names.publish='Publish to Video';
 }
 function educationMenu(){
  const menus=q('#workspace-menus'),list=q('#checklist');if(!menus||!list)return;
  let menu=q('#education-menu');if(!menu){menu=document.createElement('details');menu.id='education-menu';menu.className='workspace-menu';menu.innerHTML='<summary>Education and learning<span aria-hidden="true">⌄</span></summary><div class="workspace-menu-items education-content"><h3>Day 1 checklist</h3></div>';menu.addEventListener('toggle',()=>{if(menu.open)menus.querySelectorAll('details').forEach(other=>{if(other!==menu)other.open=false;});});menus.append(menu);}
  const body=menu.querySelector('.education-content');if(list.parentElement!==body){const heading=list.parentElement.querySelector('.eyebrow');if(heading)heading.remove();body.append(list);}
 }
 function modernize(){ribbon();imageTree();storyTree();libraryGroup();productionGroup();educationMenu();imageLabels();acceleratorDisplay();}
 if(typeof storyControls==='function'){const previous=storyControls;storyControls=function(...args){const result=previous.apply(this,args);modernize();return result;};}
 if(typeof wireCards==='function'){const previous=wireCards;wireCards=function(...args){const result=previous.apply(this,args);imageLabels();return result;};}
 document.addEventListener('click',e=>{document.querySelectorAll('.workspace-menu[open]').forEach(d=>{if(!d.contains(e.target))d.open=false;});});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.workspace-menu[open]').forEach(d=>{d.open=false;d.querySelector('summary').focus();});});
 window.EccoWorkspaceUI={labelDialog,createFolder,uploadDialog};
 modernize();
})();
