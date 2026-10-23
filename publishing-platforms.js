'use strict';
/* Shared publishing layout; existing YouTube publishing keeps its original handlers. */
(()=>{
 const icons={"youtube":"<svg aria-hidden=\"true\" focusable=\"false\" fill=\"currentColor\" role=\"img\" viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z\"/></svg>","tiktok":"<svg aria-hidden=\"true\" focusable=\"false\" fill=\"currentColor\" role=\"img\" viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z\"/></svg>","instagram":"<svg aria-hidden=\"true\" focusable=\"false\" fill=\"currentColor\" role=\"img\" viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077\"/></svg>","meta":"<svg aria-hidden=\"true\" focusable=\"false\" fill=\"currentColor\" role=\"img\" viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z\"/></svg>","whatsapp":"<svg aria-hidden=\"true\" focusable=\"false\" fill=\"currentColor\" role=\"img\" viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z\"/></svg>","x":"<svg aria-hidden=\"true\" focusable=\"false\" fill=\"currentColor\" role=\"img\" viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z\"/></svg>"};
 const platforms=[['youtube','YouTube'],['tiktok','TikTok'],['instagram','Instagram'],['whatsapp','WhatsApp'],['meta','Meta'],['x','X']];
 // Connection metadata comes from the authenticated CPU state, never platform tabs.
 function destinations(){
  if(!window.EccoStorage?.ready)return [];
  const entries=youtubeChannels().map(channel=>({...channel,platform:'youtube'}));
  for(const entry of Array.isArray(state.config.publishing_connections)?state.config.publishing_connections:[]){
   if(entry?.connected===true&&entry.id&&entry.title&&entry.platform!=='youtube'&&platforms.some(([id])=>id===entry.platform))entries.push(entry);
  }
  return entries.filter((entry,index)=>entries.findIndex(other=>other.id===entry.id&&other.platform===entry.platform)===index);
 }
 function openConnections(entry={platform:'youtube'}){
  window.EccoAI?.connections();
  if(entry.platform==='youtube'){
   document.querySelector('#connect-youtube')?.focus();
  }else document.querySelector('#publishing-connection-'+entry.platform)?.focus();
 }
 function mountConnections(root){
  for(const [id,name] of platforms.filter(([id])=>id!=='youtube')){
   const row=document.createElement('section');row.id='publishing-connection-'+id;row.className='connection';row.tabIndex=-1;
   row.innerHTML='<div class="connection-heading"><h3>'+icons[id]+' '+name+'</h3><button type="button" class="secondary" disabled>Unavailable</button></div><p class="help" data-publishing-status></p>';
   root.append(row);
  }
  update();
 }
 function mountIndicator(panel,before){
  let control=document.querySelector('#studio-publishing-control');
  if(!control){
   control=document.createElement('div');control.id='studio-publishing-control';
   control.innerHTML='<button type="button" id="studio-publishing-icon" aria-haspopup="dialog"></button><details id="publishing-connection-menu" class="workspace-menu" hidden><summary aria-label="Connected publishing channels" aria-controls="publishing-connection-items" aria-expanded="false"><span aria-hidden="true">▾</span></summary><div class="workspace-menu-items" id="publishing-connection-items" role="group" aria-label="Connected publishing channels"></div></details>';
   panel.insertBefore(control,before||null);
   const menu=control.querySelector('details'),summary=menu.querySelector('summary');
   control.querySelector('button').onclick=()=>openConnections(destinations()[0]);
   const close=focus=>{menu.open=false;summary.setAttribute('aria-expanded','false');if(focus)summary.focus();};
   menu.addEventListener('toggle',()=>summary.setAttribute('aria-expanded',String(menu.open)));
   menu.addEventListener('keydown',event=>{
    const buttons=[...menu.querySelectorAll('button')];
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||!buttons.length)return;
    event.preventDefault();menu.open=true;
    const index=buttons.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowDown'?(index+1)%buttons.length:index<0?buttons.length-1:(index+buttons.length-1)%buttons.length;
    buttons[next].focus();
   });
   document.addEventListener('pointerdown',event=>{if(!control.contains(event.target))close(false);});
   control.addEventListener('focusout',event=>{if(!control.contains(event.relatedTarget))close(false);});
  }
  update();
 }
 function update(){
  const entries=destinations(),control=document.querySelector('#studio-publishing-control');
  if(control){
   const primary=entries[0],button=control.querySelector('#studio-publishing-icon'),platform=primary?.platform||'youtube';
   const name=platforms.find(([id])=>id===platform)[1];
   if(button.dataset.provider!==platform){button.innerHTML=icons[platform];button.dataset.provider=platform;}
   button.dataset.connected=String(!!primary);button.title=primary?name+': '+primary.title+' · Connected':'YouTube: Not connected';button.setAttribute('aria-label',button.title+' — open Connections');
   const menu=control.querySelector('details'),items=menu.querySelector('.workspace-menu-items'),signature=JSON.stringify(entries);
   if(items.dataset.entries!==signature){
    const focusInside=items.contains(document.activeElement);items.replaceChildren();
    for(const entry of entries){
     const item=document.createElement('button');item.type='button';item.dataset.connected='true';item.innerHTML=icons[entry.platform];
     const label=document.createElement('span');label.textContent=platforms.find(([id])=>id===entry.platform)[1]+' · '+(entry.handle||entry.title)+' · Connected';item.append(label);
     item.onclick=()=>{menu.open=false;openConnections(entry);};items.append(item);
    }
    items.dataset.entries=signature;if(focusInside)button.focus();
   }
   menu.hidden=entries.length<2;if(menu.hidden)menu.open=false;
  }
  for(const [id] of platforms.filter(([id])=>id!=='youtube')){
   const row=document.querySelector('#publishing-connection-'+id);if(!row)continue;
   const connected=entries.filter(entry=>entry.platform===id),button=row.querySelector('button'),status=row.querySelector('[data-publishing-status]');
   button.dataset.connected=String(!!connected.length);const label=connected.length?'Connected':'Unavailable',message=connected.length?connected.map(entry=>entry.handle||entry.title).join(', '):'Integration is not available yet.';
   if(button.textContent!==label)button.textContent=label;if(status.textContent!==message)status.textContent=message;
  }
 }
 window.EccoPublishing={mountIndicator,mountConnections,update};
 const connectionPanel=document.querySelector('#connection-indicators');if(connectionPanel)mountIndicator(connectionPanel,document.querySelector('#connection-panel-menu'));
 const original=publishPage;
 let instance=0,pendingLibraryDraft=null;
 names.publish='Publishing';
 publishPage=function(...args){
  const result=original.apply(this,args),root=document.querySelector('#page'),prefix='publishing-'+(++instance);
  const youtube=document.createElement('div');youtube.className='publishing-youtube';youtube.append(...root.childNodes);
  const tabs=document.createElement('div');tabs.className='publishing-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Publishing platforms');
  const toolbar=document.createElement('div');toolbar.className='publishing-toolbar';
  const publish=document.createElement('button');publish.type='button';publish.textContent='Publish';const reason=document.createElement('span');reason.id=prefix+'-reason';reason.className='help';reason.setAttribute('role','status');publish.setAttribute('aria-describedby',reason.id);toolbar.append(reason,publish);
  const form=youtube.querySelector('#publish-form'),oldSubmit=form?.querySelector('button:not([type="button"])');
  const youtubeReady=()=>Boolean(form&&selectedYouTubeChannel()&&(!form.elements.playlist_id?.value||state.config.youtube_playlist_write)&&!window.EccoPublishingMedia?.reason(form)&&(window.EccoPublishingMedia?.hasSelection(form)||assets().some(a=>a.media==='video'&&a.stage==='prod'&&!a.upload_state)));
  oldSubmit?.remove();
  let selectedPlatform='youtube';
  publish.onclick=()=>{if(selectedPlatform==='youtube'&&youtubeReady())form.requestSubmit();};
  const panels=[];
  function select(index,focus=false){
   selectedPlatform=platforms[index][0];publish.disabled=selectedPlatform!=='youtube'||!youtubeReady();const message=selectedPlatform!=='youtube'?platforms[index][1]+' publishing is not available yet.':!youtubeChannels().length?'Connect a YouTube channel in Connections.':!selectedYouTubeChannel()?'Choose a YouTube channel.':form.elements.playlist_id?.value&&!state.config.youtube_playlist_write?'Enable playlists in Connections before publishing to a playlist.':window.EccoPublishingMedia?.reason(form)?window.EccoPublishingMedia.reason(form):!window.EccoPublishingMedia?.hasSelection(form)&&!assets().some(a=>a.media==='video'&&a.stage==='prod'&&!a.upload_state)?'Approve a video in Production library to publish.':'';publish.title=message||'Publish to '+platforms[index][1];if(reason.textContent!==message)reason.textContent=message;reason.hidden=!message;
   [...tabs.children].forEach((button,i)=>{button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;panels[i].hidden=i!==index;});
   if(focus)tabs.children[index].focus();
  }
  platforms.forEach(([id,name],index)=>{
   const button=document.createElement('button');button.type='button';button.className='secondary';button.dataset.platform=id;button.id=prefix+'-tab-'+id;button.setAttribute('role','tab');button.setAttribute('aria-controls',prefix+'-panel-'+id);button.innerHTML=icons[id]+'<span>'+name+'</span>';
   const panel=id==='youtube'?youtube:document.createElement('section');panel.classList.add('publishing-panel');panel.id=prefix+'-panel-'+id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);panel.tabIndex=0;
   if(id!=='youtube'){
    const draft=form.cloneNode(true);draft.removeAttribute('id');draft.dataset.platform=id;draft.querySelector('[name=channel_id]')?.closest('label').remove();draft.querySelectorAll('[data-youtube-only]').forEach(node=>node.remove());
    draft.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    // Keep draft fields editable without routing another platform to YouTube.
    draft.onsubmit=event=>event.preventDefault();
    const visibility=draft.querySelector('[name="visibility"]');
    const choices={tiktok:[['private','Only me'],['friends','Friends'],['public','Everyone']],instagram:[['account','Account audience']],whatsapp:[['recipients','Selected recipients']],meta:[['public','Public'],['friends','Friends'],['private','Only me']],x:[['account','Account audience']]};
    visibility.replaceChildren(...choices[id].map(([value,label])=>new Option(label,value)));
    const audience=draft.querySelector('[name="made_for_kids"]').closest('label');
    audience.innerHTML='Destination<input name="destination" placeholder="'+({tiktok:'TikTok account',instagram:'Instagram account',whatsapp:'Recipient or group',meta:'Facebook page or profile',x:'X account'}[id])+'">';
    draft.querySelector('[name="confirmed"]+span').textContent='I reviewed the selected items and authorize their publication to '+name+' with the destination and visibility selected above.';
    panel.append(draft);
   }
   panels.push(panel);button.onclick=()=>select(index);
   button.onkeydown=event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%platforms.length;else if(event.key==='ArrowLeft')next=(index+platforms.length-1)%platforms.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=platforms.length-1;else return;event.preventDefault();select(next,true);};
   tabs.append(button);
  });
  window.EccoPublishingConnection=()=>{if(root.contains(tabs))select(platforms.findIndex(p=>p[0]===selectedPlatform));};
  root.append(toolbar,tabs,...panels);select(0);
  const saved=pendingLibraryDraft;pendingLibraryDraft=null;window.EccoPublishingMedia?.cancelPicker();
  if(saved&&saved.story===(currentStory().id||'')){
   panels.forEach((panel,index)=>{
    const draft=panel.querySelector('form'),values=saved.forms[index];if(!draft||!values)return;
    for(const [name,value] of Object.entries(values)){
     const field=draft.elements.namedItem(name);
     if(!field||name==='confirmed'||name==='channel_id')continue;
     if(name==='playlist_id'&&values.channel_id!==draft.elements.channel_id?.value)continue;
     field.value=value;
    }
    draft.querySelector('[name=visibility]')?.dispatchEvent(new Event('change'));
    draft.elements.confirmed.checked=false;
   });
   select(Math.max(0,platforms.findIndex(([id])=>id===saved.platform)));
   updateYouTubeConnection();
  }
  panels.forEach((panel,index)=>{
   const draft=panel.querySelector('form'),chooser=draft?.elements.asset_id;if(!chooser)return;
   const selection=window.EccoPublishingMedia?.mount(draft,saved&&saved.story===(currentStory().id||'')?saved.selections?.[index]||[]:[]);
   const libraries=document.createElement('optgroup');libraries.label='Libraries';
   for(const [kind,label] of [['video','Open Video Library…'],['audio','Open Audio Library…']]){
    const option=new Option(label,'library:'+kind);option.dataset.library=kind;libraries.append(option);
   }
   chooser.append(libraries);let previous=chooser.value;
   chooser.addEventListener('change',()=>{
    const kind=chooser.selectedOptions[0]?.dataset.library;
    if(!kind){previous=chooser.value;draft.elements.confirmed.checked=false;if(chooser.value)selection?.add([chooser.value]);return;}
    chooser.value=previous;
    pendingLibraryDraft={story:currentStory().id||'',platform:selectedPlatform,forms:panels.map(item=>Object.fromEntries(new FormData(item.querySelector('form')))),selections:panels.map(item=>item.querySelector('form').publishingSelection?.snapshot()||[])};
    const savedDraft=pendingLibraryDraft;
    if(window.EccoPublishingMedia)window.EccoPublishingMedia.open(kind,selection.items.map(item=>item.id),ids=>{
     const existing=savedDraft.selections[index].filter(item=>state.records.find(a=>a.id===item.id)?.media!==kind);
     savedDraft.selections[index]=[...existing,...ids.map(id=>savedDraft.selections[index].find(item=>item.id===id)||{id,title:(state.records.find(a=>a.id===id)?.title||'Untitled').slice(0,100)})];
     pendingLibraryDraft=savedDraft;navigate('publish');document.querySelector('.publishing-panel:not([hidden]) .publishing-selection input')?.focus();
    },()=>{pendingLibraryDraft=savedDraft;navigate('publish');document.querySelector('.publishing-panel:not([hidden]) [name=asset_id]')?.focus();});
    else window.EccoWorkspaceUI?.openLibrary(kind);
   });
  });
  window.EccoPublishingConnection?.();
  return result;
 };
})();
