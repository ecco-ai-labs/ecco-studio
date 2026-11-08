'use strict';
/* User Preferences > Look and Feel: administrators edit the master size roster and apply it
   to every Studio and Desk page. Element types are sized once; every instance follows. */
(()=>{
 const q=s=>document.querySelector(s);
 const S=()=>window.EccoSizes;
 const token=()=>window.EccoAuth?.user?(sessionStorage.getItem('ecco-user-session')||localStorage.getItem('ecco-user-session')||''):'';
 let canPublish=false,live={version:0,roster:null,updatedAt:null,updatedBy:null,history:[]},draft=null,dirty=false,busy=false,message='',messageKind='';

 async function request(body){
  const session=token();
  const response=await fetch(S().ENDPOINT,{method:body?'POST':'GET',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000),
   headers:{...(session?{Authorization:'Bearer '+session}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error||'Look and Feel is not available right now.'),{status:response.status});
  return data;
 }
 async function access(){
  canPublish=false;
  if(token()){try{const data=await request();live=data;canPublish=data.canPublish===true;}catch{canPublish=false;}}
  mountMenu();
 }
 function mountMenu(){
  const menu=q('[data-category="Activity"] .workspace-menu-items');if(!menu)return;
  let b=q('#look-and-feel-open');
  // Menu buttons are styled with an explicit display, so the entry is removed rather than hidden.
  if(!canPublish){b?.remove();return;}
  if(!b){b=document.createElement('button');b.type='button';b.id='look-and-feel-open';b.className='secondary';b.textContent='Look and Feel';
   b.onclick=e=>{e.preventDefault();b.closest('details')?.removeAttribute('open');navigate('look-and-feel');};}
  const themes=q('#theme-colors-open');
  if(b.parentElement!==menu)(themes?themes.before(b):menu.append(b));
 }

 const px=v=>typeof v==='number'?v:(typeof v==='string'&&/^calc\((\d+(?:\.\d+)?)px - 2pt\)$/.test(v)?+(+RegExp.$1-8/3).toFixed(2):null);
 const clone=v=>JSON.parse(JSON.stringify(v));
 const slug=name=>{const base=(name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'element').slice(0,40);let id=base.match(/^[a-z]/)?base:'el-'+base,n=2;const used=new Set(S().entries(draft).map(e=>e.id));while(used.has(id))id=base+'-'+n++;return id;};
 function esc(t){return String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
 function when(t){if(!t)return '';const d=new Date(t);return isNaN(d)?'':d.toLocaleString([], {dateStyle:'medium',timeStyle:'short'});}

 function setMessage(text,kind=''){message=text;messageKind=kind;const m=q('#laf-message');if(m){m.textContent=text;m.dataset.kind=kind;}}
 function liveLine(){
  return live.version&&live.roster?`Live for everyone: version ${live.version}, applied by ${esc(live.updatedBy||'an administrator')} ${esc(when(live.updatedAt))}.`
   :live.version?`Live for everyone: the repository default (version ${live.version}, set by ${esc(live.updatedBy||'an administrator')} ${esc(when(live.updatedAt))}).`
   :'Live for everyone: the repository default.';
 }
 function sizeInput(entry,kind,label){
  const v=entry[kind],n=px(v),kept=typeof v==='string';
  return `<label class="laf-size"><span>${label}</span><input type="number" inputmode="decimal" step="0.5" min="${kind==='font'?4:10}" max="${kind==='font'?96:kind==='height'?200:1200}" data-id="${esc(entry.id)}" data-kind="${kind}" value="${n??''}" placeholder="auto" aria-label="${esc(entry.name)} ${label.toLowerCase()} in pixels">${kept?'<small class="help">original</small>':''}</label>`;
 }
 function row(entry,variant){
  const n=px(entry.font);
  const sample=esc((entry.examples||[])[0]||entry.name);
  return `<tr data-row="${esc(entry.id)}"${variant?' class="laf-variant"':''}>
   <th scope="row"><input class="laf-name" data-id="${esc(entry.id)}" value="${esc(entry.name)}" aria-label="Element name" maxlength="80">${variant?`<small class="help">Variant of ${esc(S().entries(draft).find(t=>t.id===entry.of)?.name||entry.of)}</small>`:''}${entry.added?'<small class="laf-new">New</small>':''}</th>
   <td>${sizeInput(entry,'font','Font')}</td><td>${sizeInput(entry,'height','Height')}</td><td>${sizeInput(entry,'width','Width')}</td>
   <td class="laf-sample-cell"><span class="laf-sample" style="font-size:${n?n+'px':'inherit'} !important">${sample}</span></td>
   <td><details class="laf-selectors"><summary>${entry.selectors.length} selector${entry.selectors.length>1?'s':''}</summary><textarea data-id="${esc(entry.id)}" aria-label="${esc(entry.name)} selectors, one per line" rows="${Math.min(8,entry.selectors.length+1)}">${esc(entry.selectors.join('\n'))}</textarea></details></td>
   <td><button type="button" class="secondary laf-remove" data-id="${esc(entry.id)}" aria-label="Remove ${esc(entry.name)}">Remove</button></td></tr>`;
 }
 function render(){
  const root=q('#page');if(!root||page!=='look-and-feel')return;
  if(!draft)draft=clone(S().state.roster||{types:[],variants:[]});
  const focus=document.activeElement?.closest('#look-and-feel')?{sel:document.activeElement.dataset.kind?`[data-id="${document.activeElement.dataset.id}"][data-kind="${document.activeElement.dataset.kind}"]`:document.activeElement.id?'#'+document.activeElement.id:null}:null;
  root.innerHTML=`<section id="look-and-feel" aria-labelledby="heading">
   <p class="help">Each element type is sized once here and every screen follows it. New screens use these sizes automatically. A new kind of element must be added here.</p>
   <p class="help" id="laf-live">${liveLine()}</p>
   ${canPublish?'':'<p class="help">Only administrators can apply changes.</p>'}
   <div class="laf-actions">
    <button type="button" id="laf-add-open" class="secondary" aria-expanded="false" aria-controls="laf-add">Add element</button>
    <button type="button" id="laf-preview" class="secondary"${dirty?'':' disabled'}>Preview on my screen</button>
    <button type="button" id="laf-discard" class="secondary"${dirty?'':' disabled'}>Discard changes</button>
    <button type="button" id="laf-reset" class="secondary"${canPublish&&live.roster?'':' disabled'}>Use repository default</button>
    <button type="button" id="laf-export" class="secondary">Download roster</button>
    <button type="button" id="laf-apply"${canPublish&&dirty&&!busy?'':' disabled'}>Apply to everyone</button>
   </div>
   <p id="laf-message" role="status" data-kind="${messageKind}">${esc(message)}</p>
   <form id="laf-add" class="panel" hidden>
    <h3>Add element</h3>
    <div class="laf-add-grid">
     <label for="laf-add-name">Name<input id="laf-add-name" aria-label="Name" required maxlength="80" placeholder="For example: Toolbar chip"></label>
     <label for="laf-add-kind">Kind<select id="laf-add-kind" aria-label="Kind"><option value="">New element type</option>${draft.types.map(t=>`<option value="${esc(t.id)}">Variant of ${esc(t.name)}</option>`).join('')}</select></label>
     <label for="laf-add-font">Font (px)<input id="laf-add-font" aria-label="Font (px)" type="number" step="0.5" min="4" max="96"></label>
     <label for="laf-add-height">Height (px)<input id="laf-add-height" aria-label="Height (px)" type="number" step="1" min="10" max="200"></label>
     <label for="laf-add-width">Width (px)<input id="laf-add-width" aria-label="Width (px)" type="number" step="1" min="10" max="1200"></label>
     <label class="laf-wide" for="laf-add-selectors">Applies to: CSS selectors, one per line<textarea id="laf-add-selectors" aria-label="Applies to: CSS selectors, one per line" rows="3" required placeholder=".toolbar-chip"></textarea></label>
    </div>
    <div class="laf-actions"><button type="submit">Add to list</button><button type="button" class="secondary" id="laf-add-cancel">Cancel</button></div>
   </form>
   <div class="laf-table"><table>
    <caption class="help">Element types first, then their variants. When an element matches several rows, the lower row wins.</caption>
    <thead><tr><th scope="col">Element</th><th scope="col">Font</th><th scope="col">Height</th><th scope="col">Width</th><th scope="col">Sample</th><th scope="col">Applies to</th><th scope="col"><span class="laf-sr">Remove</span></th></tr></thead>
    <tbody>${draft.types.map(t=>row(t,false)).join('')}${(draft.variants||[]).map(v=>row(v,true)).join('')}</tbody>
   </table></div>
  </section>`;
  wire();
  if(focus?.sel)root.querySelector(focus.sel)?.focus();
 }
 function changed(){dirty=true;setMessage('Changes are not applied yet.');for(const id of ['laf-preview','laf-discard'])q('#'+id).disabled=false;q('#laf-apply').disabled=!canPublish||busy;}
 function find(id){return S().entries(draft).find(e=>e.id===id);}
 function wire(){
  const root=q('#look-and-feel');
  root.querySelectorAll('input[data-kind]').forEach(input=>input.addEventListener('change',()=>{
   const e=find(input.dataset.id),kind=input.dataset.kind;
   e[kind]=input.value===''?null:+input.value;delete e.keptCurrent;
   if(kind==='font'){const s=input.closest('tr').querySelector('.laf-sample');s.style.setProperty('font-size',input.value?input.value+'px':'inherit','important');input.parentElement.querySelector('small')?.remove();}
   changed();
  }));
  root.querySelectorAll('.laf-name').forEach(input=>input.addEventListener('change',()=>{find(input.dataset.id).name=input.value.trim();changed();}));
  root.querySelectorAll('.laf-selectors textarea').forEach(t=>t.addEventListener('change',()=>{const e=find(t.dataset.id);e.selectors=t.value.split('\n').map(s=>s.trim()).filter(Boolean);t.closest('details').querySelector('summary').textContent=e.selectors.length+' selector'+(e.selectors.length===1?'':'s');changed();}));
  root.querySelectorAll('.laf-remove').forEach(b=>b.onclick=()=>{
   const id=b.dataset.id;
   if(draft.types.some(t=>t.id===id)&&(draft.variants||[]).some(v=>v.of===id)){setMessage('Remove this element\'s variants first.','error');return;}
   draft.types=draft.types.filter(t=>t.id!==id);draft.variants=(draft.variants||[]).filter(v=>v.id!==id);dirty=true;setMessage('Removed. Changes are not applied yet.');render();
  });
  const form=q('#laf-add'),open=q('#laf-add-open');
  open.onclick=()=>{form.hidden=!form.hidden;open.setAttribute('aria-expanded',String(!form.hidden));if(!form.hidden)q('#laf-add-name').focus();};
  q('#laf-add-cancel').onclick=()=>{form.hidden=true;open.setAttribute('aria-expanded','false');open.focus();};
  form.onsubmit=e=>{
   e.preventDefault();
   const name=q('#laf-add-name').value.trim(),of=q('#laf-add-kind').value,num=id=>q(id).value===''?null:+q(id).value;
   const entry={id:slug(name),name,selectors:q('#laf-add-selectors').value.split('\n').map(s=>s.trim()).filter(Boolean),font:num('#laf-add-font'),height:num('#laf-add-height'),width:num('#laf-add-width'),added:true};
   if(of)entry.of=of;else entry.contractComponent='container';
   const next=clone(draft);(of?(next.variants=next.variants||[]):next.types).push(entry);
   try{S().validate(next);}catch(err){setMessage(err.message,'error');return;}
   draft=next;dirty=true;setMessage(`Added ${name}. Changes are not applied yet.`);render();q(`tr[data-row="${entry.id}"] .laf-name`)?.focus();
  };
  q('#laf-preview').onclick=()=>{try{S().apply(draft,{source:'preview'});setMessage('Previewing on this screen only. Apply to everyone to keep it, or Discard changes.');}catch(err){setMessage(err.message,'error');}};
  q('#laf-discard').onclick=async()=>{draft=null;dirty=false;setMessage('Changes discarded.');await S().refresh();render();};
  q('#laf-export').onclick=()=>{
   try{const blob=new Blob([JSON.stringify(S().validate(draft),null,2)+'\n'],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='size-roster.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);setMessage('Downloaded. Replace design-system/size-roster.json in the repository with it to make this the default.');}
   catch(err){setMessage(err.message,'error');}
  };
  q('#laf-reset').onclick=()=>publish({op:'reset',baseVersion:live.version},'The repository default is now live for everyone.');
  q('#laf-apply').onclick=()=>{let clean;try{clean=S().validate(draft);}catch(err){setMessage(err.message,'error');return;}publish({op:'publish',roster:clean,baseVersion:live.version},null);};
 }
 async function publish(body,done){
  if(busy)return;busy=true;q('#laf-apply').disabled=true;setMessage('Applying…');
  try{
   const data=await request(body);live=data;canPublish=data.canPublish===true;dirty=false;draft=null;
   if(data.roster)S().apply(data.roster,{source:'published',version:data.version,updatedAt:data.updatedAt,updatedBy:data.updatedBy});
   try{if(data.roster)localStorage.setItem('ecco-look-and-feel-v1',JSON.stringify({roster:data.roster,version:data.version,updatedAt:data.updatedAt,updatedBy:data.updatedBy}));else localStorage.removeItem('ecco-look-and-feel-v1');}catch{}
   if(!data.roster)S().apply(await S().loadDefault(),{source:'default'});
   message=done||`Applied to everyone. Version ${data.version} is live.`;messageKind='success';
  }catch(err){message=err.status===409?err.message:err.status===403?'Only administrators can apply Look and Feel changes.':err.message||'Look and Feel could not be applied.';messageKind='error';}
  finally{busy=false;render();}
 }
 async function open(){
  window.EccoStoryWorkspace?.leave?.();
  document.body.classList.remove('workspace-entry-mode');q('#workspace-entry')?.remove();
  page='look-and-feel';q('#heading').textContent='Look and Feel';document.title='Look and Feel · ECCO AI Labs Studio';
  document.querySelectorAll('nav button.active').forEach(b=>b.classList.remove('active'));
  if(!dirty)draft=null;
  if(!S().state.roster){q('#page').innerHTML='<p class="help">Loading Look and Feel…</p>';await S().ready;if(!S().state.roster)await S().refresh();}
  if(page!=='look-and-feel')return;
  render();
  if(token())request().then(data=>{live=data;canPublish=data.canPublish===true;if(page==='look-and-feel'&&!dirty){draft=null;render();}}).catch(err=>{setMessage(err.message,'error');});
 }
 const previous=navigate;
 navigate=function(target,...args){if(target==='look-and-feel')return open();return previous.call(this,target,...args);};
 window.EccoLookAndFeel={open,access,get canPublish(){return canPublish;}};
 document.addEventListener('ecco:auth-change',access);
 document.addEventListener('ecco:look-and-feel',()=>{if(page==='look-and-feel'&&!dirty){draft=null;}});
 let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mountMenu();});}).observe(document.body,{childList:true,subtree:true});
 access();
})();
