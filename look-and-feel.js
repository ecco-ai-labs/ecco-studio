'use strict';
/* User Preferences > Look and Feel: a live side panel for the master size roster.
   Sizes tab: the size scale (Title, Heading, Text, Control height, Icon, Image).
   Elements tab: every element type, filterable to the current screen, each choosing a size by name.
   Pick on page: hover any element on the real screen, click it, and choose its sizes there.
   Every change previews immediately on the screen. Apply publishes to everyone (administrators). */
(()=>{
 const q=s=>document.querySelector(s);
 const S=()=>window.EccoSizes;
 const DRAFT='ecco-look-and-feel-draft';
 // Look and Feel is only for administrators: people the publishing service names as administrators, or the
 // signed-in Google accounts listed in design-system/look-and-feel-admins.json (used while that service is not deployed).
 let adminList=[];
 fetch('design-system/look-and-feel-admins.json',{cache:'no-cache'}).then(r=>r.ok?r.json():{admins:[]}).then(d=>{adminList=(d.admins||[]).map(e=>String(e).trim().toLowerCase());mountMenu();}).catch(()=>{});
 const listedAdmin=()=>{const e=window.EccoAuth?.user?.email;return !!e&&adminList.includes(String(e).trim().toLowerCase());};
 const isAdmin=()=>canPublish||listedAdmin();
 const token=()=>window.EccoAuth?.user?(sessionStorage.getItem('ecco-user-session')||localStorage.getItem('ecco-user-session')||''):'';
 let canPublish=false,serviceUp=false,live={version:0,roster:null,updatedAt:null,updatedBy:null};
 let draft=null,dirty=false,busy=false,tab='elements',area='screen',search='',picking=false,selected=null,message='',kind='';
 let host=null,root=null,overlay=null,label=null;

 async function request(body){
  const session=token();
  const response=await fetch(S().ENDPOINT,{method:body?'POST':'GET',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000),
   headers:{...(session?{Authorization:'Bearer '+session}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error||'Look and Feel is not available right now.'),{status:response.status});
  return data;
 }
 async function access(){
  // Keep the current answer until the service replies, so the panel is not closed while checking.
  try{const data=await request();live=data;serviceUp=true;canPublish=data.canPublish===true;}catch{serviceUp=false;canPublish=false;}
  mountMenu();if(host)render();
 }
 function mountMenu(){
  const menu=q('[data-category="Activity"] .workspace-menu-items');if(!menu)return;
  let b=q('#look-and-feel-open');
  // Menu buttons have an explicit display, so the entry is removed rather than hidden.
  if(!isAdmin()){b?.remove();if(host&&!host.hidden)close();return;}
  if(!b){b=document.createElement('button');b.type='button';b.id='look-and-feel-open';b.className='secondary';b.textContent='Look and Feel';
   b.onclick=e=>{e.preventDefault();b.closest('details')?.removeAttribute('open');open();};}
  const themes=q('#theme-colors-open');
  if(b.parentElement!==menu)(themes?themes.before(b):menu.append(b));
 }

 /* ---------- state ---------- */
 const clone=v=>JSON.parse(JSON.stringify(v));
 const esc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const fmt=v=>v==null?'':String(+(+v).toFixed(2));
 function saveDraft(){try{if(dirty)sessionStorage.setItem(DRAFT,JSON.stringify(draft));else sessionStorage.removeItem(DRAFT);}catch{}}
 function loadDraft(){try{const d=JSON.parse(sessionStorage.getItem(DRAFT)||'null');if(d){S().validate(d);return d;}}catch{}return null;}
 let pending=0;
 function preview(){
  dirty=true;saveDraft();cancelAnimationFrame(pending);
  pending=requestAnimationFrame(()=>{try{S().apply(draft,{source:'preview'});setMessage('Previewing on your screen. Apply to everyone to keep it.');}catch(err){setMessage(err.message,'error');}updateFooter();if(tab==='elements')counts();});
 }
 function setMessage(t,k=''){message=t;kind=k;const m=root?.getElementById('msg');if(m){m.textContent=t;m.dataset.kind=k;}}
 const T=()=>S().tokens(draft);
 const entriesAll=()=>S().resolved(draft);
 function find(id){return draft.types.find(e=>e.id===id)||(draft.variants||[]).find(e=>e.id===id);}
 function usage(tid){const ref='@'+tid;return S().entries(draft).filter(e=>['font','height','width','icon'].some(k=>e[k]===ref)).length;}

 /* ---------- elements on the current screen ---------- */
 function onScreen(){
  const counts={},all=[];const walk=r=>{for(const el of r.querySelectorAll('*')){if(el===host)continue;all.push(el);if(el.shadowRoot&&el!==host)walk(el.shadowRoot);}};walk(document);
  for(const el of all){
   const r=el.getBoundingClientRect();if(r.width<2||r.height<2)continue;
   if(el.closest('svg,[hidden]'))continue;
   const e=S().classify(draft,el);if(!e)continue;
   const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none')continue;
   (counts[e.id]=counts[e.id]||[]).push(el);
  }
  return counts;
 }
 let screenCounts={};
 function counts(){screenCounts=onScreen();for(const row of root.querySelectorAll('[data-entry]')){const n=(screenCounts[row.dataset.entry]||[]).length;row.querySelector('.count').textContent=n?`${n} on this screen`:'';}}

 /* ---------- options ---------- */
 function options(prop,current,parentName){
  const groups=draft.scale.filter(g=>prop==='font'?g.kind==='font':prop==='icon'?g.kind==='icon':g.kind==='height');
  const none=parentName?`Same as ${parentName}`:prop==='font'?'Keep its own size':'Not set';
  let html=`<option value="">${none}</option>`;
  for(const g of groups)html+=`<optgroup label="${esc(g.name)}">${g.tokens.map(t=>`<option value="@${esc(t.id)}"${current==='@'+t.id?' selected':''}>${esc(g.name)} · ${esc(t.name)} (${fmt(t.value)} px)</option>`).join('')}</optgroup>`;
  if(current!=null&&current!==''&&!String(current).startsWith('@')){const n=S().px(current,T(),prop);html+=`<option value="custom" selected>Custom ${fmt(n)} px</option>`;}
  return html;
 }
 const PROPS=[['font','Text size'],['height','Height'],['width','Width'],['icon','Icon size']];
 function elementRow(e){
  const raw=find(e.id),variant=!!e.of,parent=variant?find(e.of):null;
  return `<div class="el${selected===e.id?' sel':''}" data-entry="${esc(e.id)}">
   <div class="el-head"><div><b>${esc(e.name)}</b>${variant?`<span class="muted"> · variant of ${esc(parent?.name||e.of)}</span>`:''}<div class="muted count"></div></div>
   <button type="button" class="ghost show" data-show="${esc(e.id)}" aria-label="Show ${esc(e.name)} on the screen">Show</button></div>
   <div class="props">${PROPS.map(([p,l])=>{
    const own=raw[p];
    return `<label>${l}<select data-prop="${p}" data-id="${esc(e.id)}" aria-label="${esc(e.name)} ${l.toLowerCase()}">${options(p,own,variant?parent?.name:null)}</select></label>`;}).join('')}</div>
  </div>`;
 }
 function areas(){return [...new Set(S().entries(draft).map(e=>e.area||'Other'))];}
 function renderList(){
  const list=root.getElementById('list');if(!list)return;
  const all=entriesAll().filter(e=>{
   if(search&&!(e.name+' '+(e.examples||[]).join(' ')).toLowerCase().includes(search))return false;
   if(area==='screen')return (screenCounts[e.id]||[]).length>0;
   return area==='all'||(e.area||'Other')===area;
  });
  if(!all.length){list.innerHTML=`<p class="muted">${area==='screen'?'No roster elements are visible on this screen.':'No elements match.'}</p>`;return;}
  const by={};for(const e of all)(by[e.area||'Other']=by[e.area||'Other']||[]).push(e);
  list.innerHTML=Object.entries(by).map(([a,es])=>`<h3>${esc(a)}</h3>${es.map(elementRow).join('')}`).join('');
  for(const row of list.querySelectorAll('[data-entry]')){const n=(screenCounts[row.dataset.entry]||[]).length;row.querySelector('.count').textContent=n?`${n} on this screen`:'';}
 }
 function renderScale(){
  return draft.scale.map(g=>`<section class="cat"><h3>${esc(g.name)}<span class="muted small"> · ${g.kind==='font'?'text size':g.kind==='icon'?'icon size':'height'}</span></h3>
   ${g.tokens.map(t=>{const n=usage(t.id);const sample=g.kind==='font'?`<span class="sample" style="font-size:${t.value}px">Aa</span>`:`<span class="bar" style="${g.kind==='icon'?`width:${t.value}px;`:'width:18px;'}height:${Math.min(t.value,60)}px"></span>`;
    return `<div class="tok" data-tok="${esc(t.id)}"><input class="tname" data-tok="${esc(t.id)}" value="${esc(t.name)}" aria-label="${esc(g.name)} size name" maxlength="40"><input class="tval" type="number" step="${g.kind==='font'?'0.5':'1'}" min="${g.kind==='font'?4:g.kind==='icon'?6:10}" max="${g.kind==='font'?96:g.kind==='icon'?96:1200}" data-tok="${esc(t.id)}" value="${fmt(t.value)}" aria-label="${esc(g.name)} ${esc(t.name)} in pixels"><span class="px">px</span>${sample}${n?`<span class="muted small used">${n} element${n>1?'s':''}</span>`:`<button type="button" class="ghost del" data-del="${esc(t.id)}" aria-label="Delete ${esc(g.name)} ${esc(t.name)} (unused)">Delete</button>`}</div>`;}).join('')}
   <button type="button" class="ghost add" data-add="${esc(g.id)}">Add a ${esc(g.name.toLowerCase())} size</button></section>`).join('');
 }
 /* ---------- theme colors ---------- */
 const COLOR_RE=/^(#[0-9a-fA-F]{3,8}|rgba?\([0-9., %]{1,40}\))$/;
 let colorTheme=null;
 function renderColors(){
  const c=draft.colors;if(!c)return '<p class="muted">Theme colors are not in this roster yet. Use repository default to load them.</p>';
  colorTheme=colorTheme&&c.themes[colorTheme]?colorTheme:(window.EccoTheme?.current&&c.themes[window.EccoTheme.current]?window.EccoTheme.current:'default');
  const th=c.themes[colorTheme];
  const row=(group,key,lab,builtIn)=>{const v=(th[group]||{})[key];const shown=v||builtIn||'transparent';
   return `<div class="crow"><span class="sw" style="background:${esc(shown)}"></span><span class="clab">${esc(lab)}${!v&&builtIn?'<span class="muted small"> · Studio built-in</span>':''}</span><input data-color="${group}:${key}" value="${esc(v||'')}" placeholder="${esc(builtIn||'')}" aria-label="${esc(th.label+' '+lab)}" spellcheck="false"></div>`;};
  return `<p class="muted">Colors for each theme. Picking a theme here also shows it on your screen. Use a hex color like #1f6feb or rgba(…); leave a box empty for Studio's built-in color.</p>
   <label class="themepick">Theme<select id="color-theme" aria-label="Theme to edit">${Object.entries(c.themes).map(([id,t])=>`<option value="${esc(id)}"${id===colorTheme?' selected':''}>${esc(t.label)}</option>`).join('')}</select></label>
   <section class="cat"><h3>Colors</h3>${Object.entries(c.roles).map(([k,r])=>row('colors',k,r.label,r.builtIn)).join('')}</section>
   <section class="cat"><h3>Connection status</h3>${row('status','connected','Connected')}${row('status','disconnected','Not connected')}</section>
   ${th.glass?`<section class="cat"><h3>Backdrop</h3>${[['backdrop','Page backdrop'],['solid','Solid panels'],['highlight','Highlight'],['shadow','Shadow']].map(([k,l])=>row('glass',k,l)).join('')}</section>`:''}
   ${tipSection()}`;
 }
 /* Header tooltips: the same for every theme; colors name a role, so each theme's own color is used. */
 function tipSection(){
  const t=draft.tooltips;if(!t)return '';
  const roles=Object.entries(draft.colors.roles);
  const roleSel=(k,lab)=>`<label class="tiprow">${lab}<select data-tip="${k}" aria-label="Tooltip ${lab.toLowerCase()}">${roles.map(([id,r])=>`<option value="${esc(id)}"${t[k]===id?' selected':''}>${esc(r.label)}</option>`).join('')}</select></label>`;
  const fonts=draft.scale.filter(g=>g.kind==='font').map(g=>`<optgroup label="${esc(g.name)}">${g.tokens.map(x=>`<option value="@${esc(x.id)}"${t.font==='@'+x.id?' selected':''}>${esc(x.name)} · ${fmt(x.value)} px</option>`).join('')}</optgroup>`).join('');
  return `<section class="cat"><h3>Header tooltips</h3><p class="muted small">The hover labels on the header icons, in every theme. Connection tooltips (AI, Storage, GPU) show a dot in the connected / not-connected color above.</p>
   ${roleSel('fill','Fill')}${roleSel('text','Text color')}${roleSel('border','Border')}
   <label class="tiprow">Text size<select data-tip="font" aria-label="Tooltip text size">${fonts}</select></label>
   <label class="tiprow">Dot size<input type="number" min="4" max="20" step="1" data-tip="dot" value="${fmt(t.dot)}" aria-label="Tooltip dot size in pixels"></label>
   <button type="button" class="ghost" id="tip-show">Show a tooltip</button></section>`;
 }
 // Keep one connection tooltip open for a few seconds so the change can be seen.
 let tipTimer=0;
 function showTip(){const el=document.querySelector('#studio-storage-indicator[data-icon-tooltip],#connection-indicators>[data-icon-tooltip]');if(!el)return;el.classList.add('ecco-tooltip-demo');clearTimeout(tipTimer);tipTimer=setTimeout(()=>{el.classList.remove('ecco-tooltip-demo');},4000);}
 function wireColors(){
  const pick=root.getElementById('color-theme');
  if(pick)pick.onchange=()=>{colorTheme=pick.value;const radio=document.querySelector(`#workspace-theme-drawer input[name=ecco-theme][value="${window.CSS.escape(colorTheme)}"]`);if(radio&&!radio.checked){radio.checked=true;radio.dispatchEvent(new Event('change'));}render();};
  for(const el of root.querySelectorAll('[data-tip]'))el.onchange=()=>{const k=el.dataset.tip;let v=el.value;if(k==='dot'){v=+v;if(!(v>=4&&v<=20)){setMessage('The tooltip dot must be between 4 and 20 px.','error');el.value=draft.tooltips.dot;return;}}draft.tooltips[k]=v;preview();showTip();};
  const show=root.getElementById('tip-show');if(show)show.onclick=showTip;
  for(const input of root.querySelectorAll('[data-color]'))input.onchange=()=>{
   const [group,key]=input.dataset.color.split(':'),v=input.value.trim(),th=draft.colors.themes[colorTheme];
   if(v&&group!=='glass'&&!COLOR_RE.test(v)){setMessage(`"${v}" is not a color. Use a hex color like #1f6feb or rgba(…).`,'error');return;}
   if(!v&&group==='status'){setMessage('Connection status colors cannot be empty.','error');input.value=th.status[key];return;}
   th[group]=th[group]||{};if(v)th[group][key]=v;else delete th[group][key];
   preview();input.previousElementSibling.previousElementSibling.style.background=v||input.placeholder||'transparent';
  };
 }
 function updateFooter(){
  const apply=root?.getElementById('apply');if(!apply)return;
  apply.disabled=!canPublish||!dirty||busy;
  root.getElementById('discard').disabled=!dirty;
  root.getElementById('reset').disabled=!canPublish||!live.roster||busy;
  root.getElementById('liveline').textContent=!serviceUp?'Changes stay on your screen until the Look and Feel service is deployed. Copy roster to send them to Claude.':
   !canPublish?'Only administrators can apply changes for everyone.':
   live.version&&live.roster?`Live for everyone: version ${live.version} by ${live.updatedBy||'an administrator'}.`:'Live for everyone: the repository default.';
 }
 function render(){
  if(!root)return;
  if(!draft)draft=loadDraft()||clone(S().state.roster);
  if(!loadDraft())dirty=false;else dirty=true;
  const areaOpts=['screen','all',...areas()].map(a=>`<option value="${esc(a)}"${area===a?' selected':''}>${a==='screen'?'On this screen':a==='all'?'All elements':esc(a)}</option>`).join('');
  root.getElementById('body').innerHTML=tab==='elements'?`
   <div class="filters"><label>Show<select id="area" aria-label="Which elements to show">${areaOpts}</select></label>
   <input id="search" type="search" placeholder="Search elements" aria-label="Search elements" value="${esc(search)}"></div>
   <div id="list"></div><details class="addnew" id="addnew"><summary>Add a new element</summary>${addForm()}</details>`:
   tab==='colors'?renderColors():`<p class="muted">Each size has a name. Change a value here and every element using that name changes.</p>${renderScale()}`;
  for(const t of root.querySelectorAll('[role=tab]'))t.setAttribute('aria-selected',String(t.dataset.tab===tab));
  wire();if(tab==='elements'){screenCounts=onScreen();renderList();wireList();}if(tab==='colors')wireColors();
  updateFooter();setMessage(message,kind);
 }
 function addForm(sel=''){
  return `<form id="addform"><label>Name<input id="add-name" aria-label="Name" required maxlength="80" placeholder="For example: Toolbar chip"></label>
   <label>Kind<select id="add-of" aria-label="Kind"><option value="">New element type</option>${draft.types.map(t=>`<option value="${esc(t.id)}">Variant of ${esc(t.name)}</option>`).join('')}</select></label>
   <label>Page area<input id="add-area" aria-label="Page area" maxlength="40" placeholder="For example: Header" value=""></label>
   <label>Text size<select id="add-font" aria-label="New element text size">${options('font',null)}</select></label>
   <label>Height<select id="add-height" aria-label="New element height">${options('height',null)}</select></label>
   <label class="wide">Applies to: CSS selectors, one per line<textarea id="add-sel" aria-label="Applies to: CSS selectors, one per line" rows="2" required>${esc(sel)}</textarea></label>
   <button type="submit">Add</button></form>`;
 }
 function wire(){
  const b=root.getElementById('body');
  const ar=root.getElementById('area');if(ar)ar.onchange=()=>{area=ar.value;renderList();wireList();};
  const se=root.getElementById('search');if(se)se.oninput=()=>{search=se.value.trim().toLowerCase();renderList();wireList();};
  b.querySelectorAll('.tval').forEach(i=>i.addEventListener('input',()=>{const t=T()[i.dataset.tok];if(i.value===''||!i.checkValidity())return;const g=draft.scale.find(g=>g.id===t.group);g.tokens.find(x=>x.id===t.id).value=+i.value;const sm=i.parentElement.querySelector('.sample,.bar');if(sm){if(sm.classList.contains('sample'))sm.style.fontSize=i.value+'px';else sm.style.height=Math.min(+i.value,60)+'px';}preview();}));
  b.querySelectorAll('.tname').forEach(i=>i.addEventListener('change',()=>{const t=T()[i.dataset.tok],g=draft.scale.find(g=>g.id===t.group);if(i.value.trim())g.tokens.find(x=>x.id===t.id).name=i.value.trim();preview();}));
  b.querySelectorAll('[data-add]').forEach(x=>x.addEventListener('click',()=>{const g=draft.scale.find(g=>g.id===x.dataset.add);const last=g.tokens[g.tokens.length-1];let n=g.tokens.length+1,id;do{id=g.id+'-'+n++;}while(T()[id]);g.tokens.push({id,name:'New size',value:last.value});preview();render();root.querySelector(`.tname[data-tok="${id}"]`)?.focus();}));
  b.querySelectorAll('[data-del]').forEach(x=>x.addEventListener('click',()=>{for(const g of draft.scale)g.tokens=g.tokens.filter(t=>t.id!==x.dataset.del);preview();render();}));
  const form=root.getElementById('addform');
  if(form)form.onsubmit=e=>{
   e.preventDefault();
   const name=root.getElementById('add-name').value.trim(),of=root.getElementById('add-of').value;
   const base=(name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'element').slice(0,40);let id=/^[a-z]/.test(base)?base:'el-'+base,n=2;while(find(id))id=base+'-'+n++;
   const entry={id,name,area:root.getElementById('add-area').value.trim()||'Other',selectors:root.getElementById('add-sel').value.split('\n').map(s=>s.trim()).filter(Boolean),font:root.getElementById('add-font').value||null,height:root.getElementById('add-height').value||null,width:null,added:true};
   if(of)entry.of=of;else entry.contractComponent='container';
   const next=clone(draft);(of?(next.variants=next.variants||[]):next.types).push(entry);
   try{S().validate(next);}catch(err){setMessage(err.message,'error');return;}
   draft=next;selected=id;area='all';search='';preview();render();setMessage(`Added ${name}. Previewing on your screen.`);
   root.querySelector(`[data-entry="${id}"]`)?.scrollIntoView({block:'center'});
  };
 }
 function wireList(){
  const b=root.getElementById('list');if(!b)return;
  b.querySelectorAll('select[data-prop]').forEach(s=>s.addEventListener('change',()=>{const e=find(s.dataset.id);if(s.value==='custom')return;e[s.dataset.prop]=s.value||null;if(!s.value&&e.of)delete e[s.dataset.prop];preview();}));
  b.querySelectorAll('[data-show]').forEach(x=>x.addEventListener('click',()=>flash(x.dataset.show)));
 }

 /* ---------- highlight and pick ---------- */
 function boxes(els,text){
  if(!overlay)return;
  overlay.replaceChildren();
  for(const el of els.slice(0,60)){const r=el.getBoundingClientRect();const d=document.createElement('div');d.className='box';Object.assign(d.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});overlay.append(d);}
  if(text&&els[0]){const r=els[0].getBoundingClientRect();label.textContent=text;label.hidden=false;Object.assign(label.style,{left:Math.max(4,r.left)+'px',top:Math.max(4,r.top-24)+'px'});}else label.hidden=true;
 }
 function flash(id){const els=(onScreen()[id]||[]);if(!els.length){setMessage('That element is not on this screen.');return;}els[0].scrollIntoView({block:'center',behavior:'smooth'});setTimeout(()=>boxes(els),250);setTimeout(()=>{if(!picking)boxes([]);},2200);}
 function describe(el){const e=S().classify(draft,el);const cs=getComputedStyle(el);return e?`${e.name} · ${fmt(parseFloat(cs.fontSize))} px`:`Not in the roster · ${fmt(parseFloat(cs.fontSize))} px`;}
 // Clicks inside the panel are never picked; anything else on the page, including Desk shadow content, is.
 function deepTarget(ev){const path=ev.composedPath();if(path.includes(host))return null;return path.find(n=>n.nodeType===1)||null;}
 function onMove(ev){if(!picking)return;const el=deepTarget(ev);if(!el||el===document.documentElement||el===document.body){boxes([]);return;}boxes([el],describe(el));}
 function onClick(ev){
  if(!picking)return;const el=deepTarget(ev);if(!el)return;
  ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
  const e=S().classify(draft,el);setPicking(false);
  if(e){selected=e.id;tab='elements';area='screen';search='';render();const row=root.querySelector(`[data-entry="${e.id}"]`);row?.scrollIntoView({block:'center'});row?.querySelector('select')?.focus();setMessage(`Picked ${e.name}. Choose its sizes below.`);}
  else{tab='elements';render();const sel=el.id?'#'+el.id:el.tagName.toLowerCase()+[...el.classList].slice(0,2).map(c=>'.'+c).join('');const det=root.getElementById('addnew');det.open=true;root.getElementById('add-sel').value=sel;root.getElementById('add-name').focus();setMessage('That element is not in the roster yet. Name it and choose its sizes to add it.');}
  boxes([el]);setTimeout(()=>boxes([]),1500);
 }
 function setPicking(on){
  picking=on;const b=root.getElementById('pick');b.setAttribute('aria-pressed',String(on));b.textContent=on?'Stop picking':'Pick on page';
  if(on){setMessage('Hover over anything on the screen and click it. Press Escape to stop.');}else boxes([]);
 }
 document.addEventListener('pointermove',onMove,true);
 document.addEventListener('click',onClick,true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&picking){e.stopPropagation();setPicking(false);}},true);
 window.addEventListener('scroll',()=>{if(!picking)boxes([]);},true);

 /* ---------- publish ---------- */
 async function publish(body,done){
  if(busy)return;busy=true;updateFooter();setMessage('Applying…');
  try{
   const data=await request(body);live=data;canPublish=data.canPublish===true;dirty=false;draft=null;saveDraft();
   try{if(data.roster)localStorage.setItem('ecco-look-and-feel-v1',JSON.stringify({roster:data.roster,version:data.version,updatedAt:data.updatedAt,updatedBy:data.updatedBy}));else localStorage.removeItem('ecco-look-and-feel-v1');}catch{}
   if(data.roster)S().apply(data.roster,{source:'published',version:data.version,updatedAt:data.updatedAt,updatedBy:data.updatedBy});else S().apply(await S().loadDefault(),{source:'default'});
   message=done||`Applied to everyone. Version ${data.version} is live.`;kind='success';
  }catch(err){message=err.status===409?err.message:err.status===403?'Only administrators can apply Look and Feel changes.':err.message||'Look and Feel could not be applied.';kind='error';}
  finally{busy=false;render();}
 }

 /* ---------- panel ---------- */
 const CSS=`:host([hidden]){display:none!important}:host{all:initial;position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:2147483000;font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ecco-theme-text,#ecebf5)}
 .panel{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--glass-solid,var(--ecco-theme-surface,#211e39));border-left:1px solid var(--ecco-theme-border,#48405c);box-shadow:-12px 0 32px #0006}
 header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--ecco-theme-border,#48405c)}
 header h2{font-size:16px;margin:0;flex:1}
 .tabs{display:flex;gap:4px;padding:8px 14px 0}
 [role=tab]{font:inherit;font-weight:600;background:none;border:0;border-bottom:2px solid transparent;color:var(--ecco-theme-muted,#b9b3cc);padding:6px 10px;cursor:pointer}
 [role=tab][aria-selected=true]{color:var(--ecco-theme-accent,#ffdc24);border-bottom-color:var(--ecco-theme-accent,#ffdc24)}
 #body{flex:1;overflow:auto;padding:12px 14px;display:grid;gap:10px;align-content:start}
 footer{border-top:1px solid var(--ecco-theme-border,#48405c);padding:10px 14px;display:grid;gap:8px}
 .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
 button{font:inherit;font-size:13px;border-radius:7px;border:1px solid var(--ecco-theme-border,#5b5378);background:var(--ecco-theme-control,#302a43);color:var(--ecco-theme-text,#ecebf5);padding:6px 10px;cursor:pointer}
 button.primary{background:var(--ecco-theme-accent,#ffdc24);color:var(--ecco-theme-contrast,#1d1b2b);border-color:var(--ecco-theme-accent,#ffdc24);font-weight:600}
 button:disabled{opacity:.45;cursor:default}
 button.ghost{background:none}
 button[aria-pressed=true]{background:var(--ecco-theme-accent,#ffdc24);color:var(--ecco-theme-contrast,#1d1b2b);border-color:var(--ecco-theme-accent,#ffdc24)}
 button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible,[role=tab]:focus-visible{outline:2px solid var(--ecco-theme-accent,#ffdc24);outline-offset:1px}
 select,input,textarea{font:inherit;font-size:13px;background:var(--ecco-theme-background,#17152a);color:var(--ecco-theme-text,#ecebf5);border:1px solid var(--ecco-theme-border,#5b5378);border-radius:6px;padding:5px 6px;min-width:0}
 h3{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ecco-theme-muted,#b9b3cc);margin:10px 0 2px}
 .muted{color:var(--ecco-theme-muted,#b9b3cc)}.small{font-size:12px}
 .filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.filters label{display:flex;gap:6px;align-items:center}
 .filters input{flex:1}
 .el{border:1px solid var(--ecco-theme-border,#48405c);border-radius:9px;padding:8px 10px;display:grid;gap:6px}
 .el.sel{border-color:var(--ecco-theme-accent,#ffdc24);box-shadow:0 0 0 1px var(--ecco-theme-accent,#ffdc24)}
 .el-head{display:flex;justify-content:space-between;gap:8px;align-items:start}
 .props{display:grid;grid-template-columns:1fr 1fr;gap:6px}
 .props label{display:grid;gap:2px;font-size:12px;color:var(--ecco-theme-muted,#b9b3cc)}
 .cat{display:grid;gap:6px}
 .tok{display:grid;grid-template-columns:minmax(0,1fr) 64px 18px 44px 88px;gap:6px;align-items:center}
 .tok .del{justify-self:start}
 .sample{color:var(--ecco-theme-text,#ecebf5);line-height:1;text-align:center}
 .bar{display:inline-block;background:var(--ecco-theme-accent,#ffdc24);border-radius:3px;justify-self:center}
 #msg{min-height:1.2em;margin:0;font-size:13px}#msg[data-kind=error]{color:var(--ecco-theme-error,#ff9a8a)}#msg[data-kind=success]{color:var(--ecco-theme-accent,#ffdc24)}
 form{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-top:8px}form label{display:grid;gap:3px;font-size:12px;color:var(--ecco-theme-muted,#b9b3cc)}form .wide{grid-column:1/-1}form button{justify-self:start}
 .addnew summary{cursor:pointer;font-weight:600}
 .overlay{position:fixed;inset:0;pointer-events:none}
 .box{position:fixed;outline:2px solid var(--ecco-theme-accent,#ffdc24);background:color-mix(in srgb,var(--ecco-theme-accent,#ffdc24) 14%,transparent);border-radius:3px}
 .label{position:fixed;background:var(--ecco-theme-accent,#ffdc24);color:var(--ecco-theme-contrast,#1d1b2b);font:600 12px/1 Inter,system-ui,sans-serif;padding:5px 7px;border-radius:5px;pointer-events:none;white-space:nowrap}
 .label[hidden]{display:none}
 @media (prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
.crow{display:grid;grid-template-columns:20px minmax(0,1fr) 140px;gap:8px;align-items:center;margin:4px 0}.crow .sw{width:20px;height:20px;border-radius:5px;border:1px solid #8886}.crow input{width:100%;box-sizing:border-box;font:12px ui-monospace,Menlo,monospace;padding:4px 6px}.themepick{display:flex;gap:8px;align-items:center;margin:6px 0}.tiprow{display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px;align-items:center;margin:5px 0;font-size:13px}.tiprow select,.tiprow input{width:100%;box-sizing:border-box}`;
 function build(){
  host=document.createElement('div');host.id='look-and-feel-panel';
  root=S().attachPlain(host,{mode:'open'});
  root.innerHTML=`<style>${CSS}</style><div class="overlay" id="overlay"></div><div class="label" id="label" hidden></div>
   <div class="panel" role="complementary" aria-labelledby="laf-h">
    <header><h2 id="laf-h">Look and Feel</h2><button type="button" id="pick" aria-pressed="false">Pick on page</button><button type="button" id="close" aria-label="Close Look and Feel">Close</button></header>
    <div class="tabs" role="tablist" aria-label="Look and Feel"><button type="button" role="tab" data-tab="elements" aria-selected="true">Elements</button><button type="button" role="tab" data-tab="scale" aria-selected="false">Sizes</button><button type="button" role="tab" data-tab="colors" aria-selected="false">Colors</button></div>
    <div id="body"></div>
    <footer><p id="msg" role="status"></p><p class="muted small" id="liveline"></p>
     <div class="row"><button type="button" id="discard">Discard changes</button><button type="button" id="copy">Copy roster</button><button type="button" id="reset">Use repository default</button><button type="button" class="primary" id="apply">Apply to everyone</button></div></footer>
   </div>`;
  overlay=root.getElementById('overlay');label=root.getElementById('label');
  root.querySelectorAll('[role=tab]').forEach(t=>t.onclick=()=>{tab=t.dataset.tab;render();});
  root.getElementById('pick').onclick=()=>setPicking(!picking);
  root.getElementById('close').onclick=close;
  root.getElementById('discard').onclick=async()=>{draft=null;dirty=false;saveDraft();await S().refresh();setMessage('Changes discarded.');render();};
  root.getElementById('copy').onclick=async()=>{const text=JSON.stringify(S().validate(draft),null,2)+'\n';try{await navigator.clipboard.writeText(text);setMessage('Roster copied. Paste it to Claude to publish it to github.io.','success');}catch{setMessage('Copy was blocked by the browser. Select the roster in a downloaded file instead.','error');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download='size-roster.json';document.body.append(a);a.click();a.remove();}};
  root.getElementById('reset').onclick=()=>publish({op:'reset',baseVersion:live.version},'The repository default is now live for everyone.');
  root.getElementById('apply').onclick=()=>{let clean;try{clean=S().validate(draft);}catch(err){setMessage(err.message,'error');return;}publish({op:'publish',roster:clean,baseVersion:live.version},null);};
  document.body.append(host);
 }
 async function open(){
  if(!isAdmin())return;
  if(!S().state.roster){await S().ready;if(!S().state.roster)await S().refresh();}
  if(!host)build();host.hidden=false;room(true);
  const restored=loadDraft();if(restored){draft=restored;dirty=true;try{S().apply(draft,{source:'preview'});}catch{}}
  render();root.getElementById('laf-h').focus?.();root.querySelector('[role=tab][aria-selected=true]')?.focus();
  access();
 }
 function room(on){document.body.style.marginRight=on&&innerWidth>900?'min(440px, 100vw)':'';}
 window.addEventListener('resize',()=>{if(host&&!host.hidden)room(true);});
 function close(){setPicking(false);host.hidden=true;room(false);q('#look-and-feel-open')?.focus();}
 // Keep "On this screen" current while the person moves around Studio.
 let rescan=0;new MutationObserver(m=>{if(!host||host.hidden||tab!=='elements'||area!=='screen'||m.every(r=>host.contains(r.target)))return;clearTimeout(rescan);rescan=setTimeout(()=>{screenCounts=onScreen();renderList();wireList();},300);}).observe(document.body,{childList:true,subtree:true});
 const previous=navigate;
 navigate=function(target,...args){if(target==='look-and-feel')return open();return previous.call(this,target,...args);};
 window.EccoLookAndFeel={open,close,access,get canPublish(){return canPublish;}};
 document.addEventListener('ecco:auth-change',access);
 let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mountMenu();});}).observe(document.body,{childList:true,subtree:true});
 access();
})();
