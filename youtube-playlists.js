'use strict';
/* Playlist selection is content management; authorization stays in Connections. */
(()=>{
 const q=s=>document.querySelector(s),cache=new Map();
 function current(){return selectedYouTubeChannel()?.id||'';}
 function selectedTitle(){const select=q('#publish-form [name=playlist_id]');return select?.value?select.selectedOptions[0]?.textContent||'':'';}
 function clearConsent(){const check=q('#publish-form [name=confirmed]');if(check)check.checked=false;}
 function render(){
  const root=q('#youtube-playlists');if(!root)return;
  const id=current(),available=!!id&&!!state.config.youtube_playlists_available,write=available&&!!state.config.youtube_playlist_write;
  const data=cache.get(id),select=root.querySelector('select'),signature=JSON.stringify([id,data?.items||[],write]);
  if(select.dataset.items!==signature){
   const previous=select.dataset.channel===id?select.value:'';
   select.replaceChildren(new Option('No playlist',''),...(data?.items||[]).map(item=>new Option(item.title,item.id)));
   select.value=(data?.items||[]).some(item=>item.id===previous)?previous:'';
   if(select.value!==previous||select.dataset.channel!==id)clearConsent();
   select.dataset.items=signature;select.dataset.channel=id;
  }
  select.disabled=!available||!data?.loaded;
  root.querySelector('[data-refresh]').disabled=!available||!!data?.loading;
  root.querySelector('[data-create]').disabled=!write||!!data?.loading;
  const status=root.querySelector('[role=status]');
  const message=!id?'Connect YouTube in Connections to choose a playlist.':!available?'Playlists are not available yet.':data?.error||(!write?'Enable playlists in Connections to create playlists or add videos.':data?.loading?'Loading playlists…':data?.loaded&&!data.items.length?'No playlists yet. Create your first playlist here.':'');
  if(status.textContent!==message)status.textContent=message;
 }
 async function load(force=false){
  const id=current();if(!id||!state.config.youtube_playlists_available)return;
  let data=cache.get(id);if(data?.loading||(!force&&data?.loaded))return;
  data={...data,items:data?.items||[],loading:true,error:''};cache.set(id,data);render();
  try{
   const result=await api('youtube/playlists');
   if(result.channel_id!==id||!Array.isArray(result.playlists))throw Error('The channel changed. Refresh playlists for the connected channel.');
   data.items=result.playlists.filter(item=>item?.id&&item?.title);data.loaded=true;
  }catch(error){data.error=error.message||'Playlists could not be loaded. Try Refresh.';}
  finally{data.loading=false;if(current()===id){render();updateYouTubeConnection();}}
 }
 function update(){
  const root=q('#youtube-playlists');if(!root)return;
  const signature=JSON.stringify([current(),!!state.config.youtube_playlists_available,!!state.config.youtube_playlist_write]);
  const changed=root.dataset.connection!==signature;root.dataset.connection=signature;
  render();if(changed)void load();
 }
 function create(){
  const id=current();if(!id||!state.config.youtube_playlist_write||cache.get(id)?.loading||q('#youtube-playlist-dialog'))return;
  const dialog=document.createElement('dialog');dialog.id='youtube-playlist-dialog';dialog.setAttribute('aria-labelledby','youtube-playlist-title');
  dialog.innerHTML='<form class="form"><div class="section-head"><h2 id="youtube-playlist-title">Create playlist</h2><button type="button" class="secondary ai-dialog-close" data-close aria-label="Close playlist creation">×</button></div><p data-channel></p><label>Playlist title<input name="title" maxlength="150" required></label><label>Description<textarea name="description" maxlength="5000" rows="3"></textarea></label><label>Visibility<select name="visibility"><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label><label class="inline-check"><input type="checkbox" name="confirmed" required><span>Create this playlist on my YouTube channel with the visibility selected above.</span></label><p role="status" aria-live="polite"></p><button type="submit">Create playlist</button></form>';
  dialog.querySelector('[data-channel]').textContent='Channel: '+selectedYouTubeChannel().title;
  document.body.append(dialog);const form=dialog.querySelector('form');let busy=false;
  form.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{dialog.remove();q('#youtube-playlists [data-create]')?.focus();},{once:true});
  form.onsubmit=async event=>{
   event.preventDefault();if(busy)return;
   const status=form.querySelector('[role=status]');
   if(current()!==id||!state.config.youtube_playlist_write){status.textContent='The channel or permissions changed. Close this dialog and review the destination.';return;}
   if(!form.elements.confirmed.checked){status.textContent='Confirm playlist creation first.';return;}
   busy=true;form.querySelector('[type=submit]').disabled=true;status.textContent='Creating playlist…';
   try{
    const result=await api('youtube/playlists',{channel_id:id,title:form.elements.title.value,description:form.elements.description.value,visibility:form.elements.visibility.value,confirmed:true});
    if(result.channel_id!==id||!result.playlist?.id||!result.playlist?.title)throw Error('Creation was not confirmed. Check YouTube before trying again.');
    const data=cache.get(id)||{items:[],loaded:false};data.items=[...data.items.filter(item=>item.id!==result.playlist.id),result.playlist];data.error='';cache.set(id,data);
    if(current()===id){render();const select=q('#publish-form [name=playlist_id]');if(select){select.value=result.playlist.id;clearConsent();updateYouTubeConnection();}}
    dialog.close();notice('Playlist created on YouTube.');
    // Refresh the complete list after creation; keep the new selection.
    if(current()===id)void load(true);
   }catch(error){status.textContent=error.message||'Creation was not confirmed. Check YouTube before trying again.';}
   finally{busy=false;form.querySelector('[type=submit]').disabled=false;}
  };
  dialog.showModal();form.elements.title.focus();
 }
 function mount(form){
  const root=document.createElement('div');root.id='youtube-playlists';root.dataset.youtubeOnly='playlists';
  root.innerHTML='<label>Playlist (optional)<select name="playlist_id"><option value="">No playlist</option></select></label><div class="row"><button type="button" class="secondary" data-create>Create playlist</button><button type="button" class="secondary" data-refresh>Refresh playlists</button></div><p class="help" role="status" aria-live="polite"></p>';
  form.querySelector('[name=channel_id]').closest('label').after(root);
  root.querySelector('[data-create]').onclick=create;root.querySelector('[data-refresh]').onclick=()=>load(true);
  root.querySelector('select').onchange=()=>{clearConsent();updateYouTubeConnection();};
  update();
 }
 window.EccoYouTubePlaylists={mount,update,selectedTitle};
})();
