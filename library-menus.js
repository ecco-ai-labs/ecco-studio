'use strict';
(()=>{
 const q=s=>document.querySelector(s),preferences='ecco-library-heading-names';
 const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}};
 let activeMenu=null,opener=null;
 function closeMenu(focus=false){activeMenu?.remove();activeMenu=null;if(opener){opener.setAttribute('aria-expanded','false');if(focus&&opener.isConnected)opener.focus();}opener=null;}
 function targetFor(row){
  if(row.dataset.renameView){
   const key=row.dataset.renameView,text=row.querySelector('.tree-folder');
   return {name:read(preferences,{})[key]||key,local:true,save:async name=>{const names=read(preferences,{});names[key]=name;localStorage.setItem(preferences,JSON.stringify(names));text.textContent=name;}};
  }
  if(row.tagName==='SUMMARY'){
   const text=[...row.children].find(n=>n.tagName==='SPAN'&&!n.classList.contains('library-symbol'));
   if(!text)return null;
   const original=row.dataset.renameHeading||(row.dataset.renameHeading=text.textContent);
   return {name:read(preferences,{})[original]||original,local:true,save:async name=>{const names=read(preferences,{});names[original]=name;localStorage.setItem(preferences,JSON.stringify(names));text.textContent=name;}};
  }
  const folderName=row.querySelector('.tree-folder')?.title;
  const folderKind=row.closest('#workspace-audio-library')?'audio_folder':'image_folder';
  const folderRecord=folderName?state.records.find(r=>r.kind===folderKind&&r.name===folderName.replaceAll(' → ',' / ')&&!r.deleted):null;
  const id=row.dataset.renameId||row.dataset.libraryId||row.querySelector('input[type=radio]')?.value||folderRecord?.id;
  const record=state.records.find(r=>r.id===id&&!r.deleted);
  if(record){
   const field=['image_folder','audio_folder','workflow'].includes(record.kind)?'name':'title';
   const folder=record.kind.endsWith('_folder'),original=record[field]||'';
   return {name:folder?original.split(' / ').at(-1):original,limit:folder?80:160,save:async name=>{
    if(!state.config.storage?.rename_available)throw Error('Renaming saved items requires the storage service update. Your existing name is unchanged.');
    await api('library/rename',{id,name,expected_name:original});
    if(record.kind==='story'){
     for(const key of ['ecco-board-draft:'+id,'ecco-story-description:'+id]){const value=read(key,null);if(value){value.title=name;localStorage.setItem(key,JSON.stringify(value));}}
     if(activeStory===id)draft.title=name;
    }
    await refresh();
    if(['library','audio-library','story-library','workflow-library'].includes(page))navigate(page);
   }};
  }
  if(row.dataset.renameKind==='workflow'||row.closest('#workflow-library')){
   const list=read('ecco-workflow-drafts',[]),item=list.find(r=>r.id===id);if(!item)return null;
   return {name:item.name||'',local:true,save:async name=>{const latest=read('ecco-workflow-drafts',[]);const item=latest.find(r=>r.id===id);if(!item)throw Error('This workflow is no longer available.');item.name=name;localStorage.setItem('ecco-workflow-drafts',JSON.stringify(latest));row.querySelector('strong').textContent=name;}};
  }
  const key=id==='pending'?'ecco-new-story-draft':'ecco-story-setup:'+id;
  const item=read(key,null);if(!item)return null;
  return {name:item.title||'Untitled draft',local:true,save:async name=>{
   const latest=read(key,null);if(!latest)throw Error('This draft is no longer available.');
   latest.title=name;if(latest.boardDraft)latest.boardDraft.title=name;localStorage.setItem(key,JSON.stringify(latest));
   const pending=read('ecco-new-story-draft',{});if(id==='pending'||pending.localDraftId===id){pending.title=name;localStorage.setItem('ecco-new-story-draft',JSON.stringify(pending));const board=read('ecco-board-new-draft',{});board.title=name;localStorage.setItem('ecco-board-new-draft',JSON.stringify(board));}
   storyControls();navigate('story-library');
  }};
 }
 function renameDialog(target,trigger){
  const dialog=document.createElement('dialog');dialog.className='library-rename-dialog';
  dialog.innerHTML='<form class="form"><h2>Rename label</h2><label>Label name<input name="name" required autocomplete="off"></label><p class="help" data-scope></p><p role="alert"></p><div class="row"><button type="submit">Save</button><button type="button" class="secondary" data-cancel>Cancel</button></div></form>';
  const input=dialog.querySelector('input'),form=dialog.querySelector('form'),save=dialog.querySelector('[type=submit]'),cancel=dialog.querySelector('[data-cancel]'),error=dialog.querySelector('[role=alert]');
  input.value=target.name;input.maxLength=target.limit||160;dialog.querySelector('[data-scope]').textContent=target.local?'Saved in this browser.':'Saved to your workspace.';
  let busy=false;cancel.onclick=()=>dialog.close();dialog.oncancel=e=>{if(busy)e.preventDefault();};dialog.onclose=()=>{dialog.remove();if(trigger.isConnected)trigger.focus();};
  form.onsubmit=async e=>{e.preventDefault();if(busy)return;const name=input.value.trim();if(!name){error.textContent='Enter a name.';return;}busy=true;save.disabled=cancel.disabled=true;save.textContent='Saving…';error.textContent='';
   try{await target.save(name);dialog.close();}catch(err){error.textContent=err.message||'Could not rename. Try again.';}finally{busy=false;save.disabled=cancel.disabled=false;save.textContent='Save';}
  };
  document.body.append(dialog);dialog.showModal();input.focus();input.select();
 }
 function deleteFor(row){
  const existing=row.querySelector('.workspace-delete,.text-library-delete');
  if(existing)return ()=>existing.click();
  const name=row.querySelector('.tree-folder')?.title;
  const kind=row.closest('#workspace-audio-library')?'audio_folder':'image_folder';
  const record=name?state.records.find(r=>r.kind===kind&&r.name===name.replaceAll(' → ',' / ')&&!r.deleted):null;
  if(record)return async()=>{await api('trash/folder',{id:record.id});await refresh();if(['library','audio-library'].includes(page))navigate(page);};
  return null;
 }
 function attach(row){
  if(row.parentElement?.id==='workspace-library-group')return;
  if(row.dataset.libraryMenuAttached)return;
  const target=targetFor(row);if(!target)return;
  row.classList.add('library-has-menu');row.dataset.libraryMenuAttached='1';
  const button=document.createElement('button');button.type='button';button.className='library-more';button.textContent='⋮';button.title='Label options';button.setAttribute('aria-label','Options for '+target.name);button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');
  button.onclick=event=>{
   event.preventDefault();event.stopPropagation();const wasOpen=opener===button;closeMenu();if(wasOpen)return;
   const current=targetFor(row);if(!current)return;
   opener=button;button.setAttribute('aria-expanded','true');activeMenu=document.createElement('div');activeMenu.className='library-options-menu';activeMenu.setAttribute('role','menu');
   const rename=document.createElement('button');rename.type='button';rename.setAttribute('role','menuitem');rename.textContent='Rename';rename.onclick=()=>{closeMenu();renameDialog(current,button);};activeMenu.append(rename);
   const remove=document.createElement('button');remove.type='button';remove.setAttribute('role','menuitem');remove.textContent='Delete';const deletion=deleteFor(row);remove.disabled=!deletion;if(!deletion)remove.title='This built-in library view cannot be deleted.';
   remove.onclick=async()=>{remove.disabled=true;try{await deletion();closeMenu();}catch(err){remove.disabled=false;let error=activeMenu?.querySelector('[role=alert]');if(!error&&activeMenu){error=document.createElement('p');error.setAttribute('role','alert');activeMenu.append(error);}if(error)error.textContent=err.message||'Could not delete. Try again.';}};activeMenu.append(remove);document.body.append(activeMenu);
   const rect=button.getBoundingClientRect();activeMenu.style.left=Math.max(8,Math.min(rect.right,innerWidth-168))+'px';activeMenu.style.top=Math.max(8,Math.min(rect.bottom,innerHeight-100))+'px';rename.focus();
  };row.append(button);
 }
 function mount(){
  const root=q('#workspace-library-group');if(!root)return;
  root.querySelector(':scope > .library-more')?.remove();
  const heading=root.querySelector(':scope > summary');if(heading){heading.classList.remove('library-has-menu');heading.querySelector('.library-more')?.remove();}

  for(const row of root.querySelectorAll('summary,.tree-branch-row,.text-library-row,.video-publish-row')){
   if(row===heading)continue;
   if(row.tagName==='SUMMARY'){const target=targetFor(row),text=[...row.children].find(n=>n.tagName==='SPAN'&&!n.classList.contains('library-symbol'));if(target&&text.textContent!==target.name)text.textContent=target.name;}
   attach(row);
  }
  // All Audio is a persistent view label, rather than a saved asset.
  const all=root.querySelector('#workspace-audio-library .tree-folder[data-library-marker]');
  if(all&&!all.closest('.tree-branch-row')&&!all.parentElement.classList.contains('library-view-row')){
   const wrapper=document.createElement('div');wrapper.className='library-view-row';wrapper.dataset.renameView='All Audio';all.before(wrapper);wrapper.append(all);
  }
  const view=root.querySelector('.library-view-row');if(view){const target=targetFor(view),label=view.querySelector('.tree-folder');if(label.textContent!==target.name)label.textContent=target.name;attach(view);}
 }
 document.addEventListener('click',e=>{if(activeMenu&&!activeMenu.contains(e.target)&&!opener?.contains(e.target))closeMenu();});
 document.addEventListener('keydown',e=>{if(activeMenu&&e.key==='Escape'){e.preventDefault();closeMenu(true);}});
 window.addEventListener('resize',()=>closeMenu());window.addEventListener('scroll',()=>closeMenu(),true);
 let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;mount();});}).observe(document.body,{childList:true,subtree:true});
 const css=document.createElement('style');css.textContent=`
 body>aside #workspace-library-group details:has(>.library-more){position:relative}
 body>aside #workspace-library-group .library-has-menu{position:relative;padding-right:30px!important}
 body>aside #workspace-library-group .library-more{position:absolute!important;right:0!important;top:2px!important;left:auto!important;width:26px!important;min-width:26px!important;height:28px!important;min-height:0!important;padding:0!important;border:0!important;background:transparent!important;color:#fff!important;font-size:22px!important;line-height:26px!important;z-index:3}
 body>aside #workspace-library-group .library-more::before{display:none!important}
 body>aside #workspace-library-group .library-more:hover{background:#302a54!important}
 .library-options-menu{position:fixed;z-index:10000;min-width:150px;padding:5px;border:1px solid #514b69;border-radius:7px;background:#201c30;box-shadow:0 8px 24px #0008}
 .library-options-menu button{display:block;width:100%;min-height:0!important;text-align:left;color:white;background:transparent;padding:6px 10px!important;font-size:12px!important;line-height:18px!important;font-weight:500!important}
 .library-options-menu button:disabled{opacity:.4;cursor:not-allowed}
 .library-options-menu [role=alert]{font-size:12px;color:#ff7272;max-width:220px}
 #workspace-library-group .library-has-menu .workspace-delete,#workspace-library-group .library-selected-row>.workspace-delete{display:none!important}
 .library-options-menu button:hover,.library-options-menu button:focus-visible{background:#38305e}
 .library-rename-dialog{width:min(420px,calc(100vw - 32px))}.library-rename-dialog [role=alert]{color:#ff7272}
 `;document.head.append(css);mount();
})();
