'use strict';
/* The existing media libraries can act as multi-select publishing pickers. */
(()=>{
 const q=s=>document.querySelector(s),record=id=>(state.records||[]).find(a=>a.id===id&&!a.deleted);
 const attempted=new Map();let picker=null;
 function reason(form){
  const selection=form?.publishingSelection;if(!selection?.items.length)return '';
  if(selection.busy)return 'Queueing selected videos…';
  if(selection.items.some(item=>record(item.id)?.media==='audio'))return 'YouTube requires video. Turn selected audio into a video before publishing.';
  if(selection.items.some(item=>!record(item.id)||record(item.id).media!=='video'||record(item.id).stage!=='prod'))return 'Remove unavailable items and choose approved videos.';
  if(selection.items.some(item=>attempted.get(item.id)==='uncertain'))return 'An upload request was not confirmed. Check Activity before retrying.';
  if(!selection.items.some(item=>!attempted.has(item.id)&&!record(item.id)?.upload_state))return 'Uploads already started. Check Activity for completion.';
  return '';
 }
 function mount(form,items=[]){
  const chooser=form.elements.asset_id,section=document.createElement('section');section.className='publishing-selection';section.setAttribute('aria-label','Selected for publishing');chooser.closest('label').after(section);
  const selection={items:[],busy:false,render,add,snapshot:()=>selection.items.map(item=>({...item}))};form.publishingSelection=selection;
  function render(){
   const title=form.elements.title;title.closest('label').hidden=!!selection.items.length;title.disabled=!!selection.items.length;chooser.required=!selection.items.length;
   section.replaceChildren();section.hidden=!selection.items.length;if(!selection.items.length)return;
   const heading=document.createElement('h3');heading.textContent=selection.items.length+' selected for publishing';section.append(heading);
   for(const item of selection.items){
    const asset=record(item.id),row=document.createElement('div');row.className='publishing-selection-row';
    const label=document.createElement('label'),name=document.createElement('span');name.textContent=asset?.title||'Unavailable item';label.append(name);
    const input=document.createElement('input');input.name='publish-title-'+item.id;input.value=item.title;input.maxLength=100;input.required=true;input.disabled=selection.busy||attempted.has(item.id);input.setAttribute('aria-label','Publishing title for '+name.textContent);input.oninput=()=>{item.title=input.value;form.elements.confirmed.checked=false;};label.append(input);
    const remove=document.createElement('button');remove.type='button';remove.className='secondary small';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+name.textContent+' from publishing');remove.disabled=selection.busy;remove.onclick=()=>{selection.items=selection.items.filter(a=>a.id!==item.id);form.elements.confirmed.checked=false;render();updateYouTubeConnection();chooser.focus();};row.append(label,remove);
    const status=document.createElement('p');status.className='help';status.setAttribute('role','status');status.textContent=attempted.get(item.id)==='queued'?'Upload queued':attempted.get(item.id)==='uncertain'?'Upload request not confirmed. Check Activity.':asset?.media==='audio'?'Audio · a video is required for YouTube':!asset?'Item unavailable':asset.upload_state?'Upload already started':'Video';row.append(status);section.append(row);
   }
   const help=document.createElement('p');help.className='help';help.textContent='Description, visibility, audience and playlist apply to every selected video.';section.append(help);
  }
  function add(ids){
   for(const id of ids){const asset=record(id);if(!asset||selection.items.some(item=>item.id===id))continue;selection.items.push({id,title:(asset.title||'Untitled').slice(0,100)});}
   form.elements.confirmed.checked=false;render();updateYouTubeConnection();
  }
  selection.items=items.filter(item=>record(item.id)).map(item=>({...item}));render();return selection;
 }
 function open(kind,selected,accept,cancel){
  picker={kind,selected:new Set(selected.filter(id=>record(id)?.media===kind)),accept,cancel};
  window.EccoWorkspaceUI.openLibrary(kind);mountLibrary(kind);
 }
 function mountLibrary(kind){
  if(!picker||picker.kind!==kind)return;
  const context=picker,gallery=q('#'+kind+'-library-gallery');if(!gallery)return;
  q('#publishing-library-picker')?.remove();
  const toolbar=document.createElement('div');toolbar.id='publishing-library-picker';toolbar.className='panel form';toolbar.setAttribute('aria-label','Choose media for publishing');
  toolbar.innerHTML='<p>Select one or more items to publish.</p><div class="row"><button type="button" class="secondary" data-all>Select all</button><button type="button" class="secondary" data-clear>Clear selection</button><button type="button" data-add>Add selected</button><button type="button" class="secondary" data-cancel>Cancel</button></div><p class="help" role="status" aria-live="polite"></p>';
  gallery.before(toolbar);const choices=[];
  const sync=()=>{
   for(const choice of choices)choice.checked=context.selected.has(choice.value);
   for(const id of [...context.selected]){const a=record(id);if(!a||a.media!==kind||a.upload_state)context.selected.delete(id);}
   toolbar.querySelector('[data-add]').textContent='Add selected ('+context.selected.size+')';toolbar.querySelector('[data-add]').disabled=!context.selected.size;
   toolbar.querySelector('[data-all]').disabled=!choices.some(choice=>!choice.disabled);
   toolbar.querySelector('[role=status]').textContent=context.selected.size+' selected'+(kind==='audio'?' · YouTube requires these recordings to be turned into videos first.':'');
  };
  for(const card of gallery.querySelectorAll('article.card')){
   card.querySelector('[data-publish-select]')?.remove();const id=card.querySelector('[data-asset]')?.dataset.asset,asset=record(id);if(!asset)continue;
   const label=document.createElement('label');label.className='inline-check publishing-library-choice';label.dataset.publishSelect=id;
   const check=document.createElement('input');check.type='checkbox';check.value=id;check.disabled=!!asset.upload_state||(kind==='video'&&asset.stage!=='prod');check.setAttribute('aria-label','Select '+(asset.title||'Untitled')+' for publishing');
   const text=document.createElement('span');text.textContent=check.disabled?'Upload already started':'Select for publishing';label.append(check,text);card.prepend(label);choices.push(check);
   check.onchange=()=>{if(check.checked)context.selected.add(id);else context.selected.delete(id);sync();};
  }
  const legacyPublish=q('#video-library-publish');if(legacyPublish)legacyPublish.hidden=true;
  toolbar.querySelector('[data-all]').onclick=()=>{choices.filter(choice=>!choice.disabled).forEach(choice=>context.selected.add(choice.value));sync();};
  toolbar.querySelector('[data-clear]').onclick=()=>{context.selected.clear();sync();};
  toolbar.querySelector('[data-add]').onclick=()=>{sync();if(!context.selected.size)return;picker=null;context.accept([...context.selected]);};
  toolbar.querySelector('[data-cancel]').onclick=()=>{picker=null;context.cancel();};
  sync();(choices.find(choice=>!choice.disabled)||toolbar.querySelector('[data-cancel]')).focus();
 }
 async function submit(form,body){
  const selection=form.publishingSelection;
  if(!selection?.items.length)return api('youtube/publish',body);
  if(selection.busy)return;
  const blocked=reason(form);if(blocked)throw Error(blocked);
  if(body.confirmed!==true)throw Error('Review the selected videos and confirm publication first.');
  const pending=selection.items.filter(item=>!attempted.has(item.id)&&!record(item.id)?.upload_state).map(item=>({...item}));
  if(pending.some(item=>!item.title.trim()))throw Error('Enter a title for every selected video.');
  selection.busy=true;selection.render();updateYouTubeConnection();let queued=0;
  try{
   for(const item of pending){
    const payload={...body,asset_id:item.id,title:item.title.trim()};for(const key of Object.keys(payload))if(key.startsWith('publish-title-'))delete payload[key];
    try{await api('youtube/publish',payload);attempted.set(item.id,'queued');queued++;}
    catch(error){attempted.set(item.id,'uncertain');throw Error(queued+' upload(s) queued. '+error.message+' Check Activity before retrying.');}
   }
  }finally{selection.busy=false;selection.render();form.elements.confirmed.checked=false;updateYouTubeConnection();}
  return {queued};
 }
 window.EccoPublishingMedia={mount,open,mountLibrary,reason,submit,hasSelection:form=>!!form?.publishingSelection?.items.length,cancelPicker(){picker=null;}};
})();
