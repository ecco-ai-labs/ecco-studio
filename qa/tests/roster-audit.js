/* Browser-side master size roster audit, shared by ROSTER checks.
   Every visible control, heading, label and text element must take its size from the
   roster: either it belongs to a roster element type (and has exactly that type's size),
   or it has no type of its own and inherits its size from the element around it.
   An element with any other size is unregistered: add its type to design-system/size-roster.json
   (or through Studio > User Preferences > Look and Feel). */
export function rosterAudit(){
 const S=window.EccoSizes,roster=S.state.roster;
 if(!roster)return {error:'No roster is loaded.'};
 const SKIP='svg,canvas,video,audio,iframe,.textLayer,.annotationLayer,[aria-hidden="true"],.laf-sample,option';
 const CONTROL='button,summary,[role=button],[role=tab],[role=option],[role=menuitem],input,select,textarea';
 const px=v=>typeof v==='number'?v:typeof v==='string'&&/^calc\((\d+(?:\.\d+)?)px - 2pt\)$/.test(v)?+RegExp.$1-8/3:null;
 const all=[];const walk=root=>{for(const el of root.querySelectorAll('*')){all.push(el);if(el.shadowRoot)walk(el.shadowRoot);}};walk(document);
 const visible=el=>{const r=el.getBoundingClientRect();if(r.width<2||r.height<2)return false;const cs=getComputedStyle(el);return cs.visibility!=='hidden'&&cs.display!=='none'&&+cs.opacity!==0;};
 const ownText=el=>[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
 const parentOf=el=>el.parentElement||el.getRootNode().host||null;
 const label=el=>{const id=el.id?'#'+el.id:'';const cls=[...el.classList].slice(0,2).map(c=>'.'+c).join('');const host=el.getRootNode().host;return (host?(host.id?'#'+host.id:host.tagName.toLowerCase())+'::shadow ':'')+el.tagName.toLowerCase()+id+cls;};
 const problems=[];let checked=0;
 for(const el of all){
  if(el.closest(SKIP)||el.matches(SKIP)||el.matches('input[type=checkbox],input[type=radio],input[type=range],input[type=file],input[type=color],input[type=hidden]'))continue;
  const tracked=el.matches(CONTROL)||/^(H[1-6]|LABEL|LEGEND)$/.test(el.tagName)||ownText(el);
  if(!tracked||!visible(el))continue;
  checked++;
  const cs=getComputedStyle(el),font=parseFloat(cs.fontSize),entry=S.classify(roster,el);
  const text=(el.innerText||el.value||el.getAttribute('aria-label')||el.placeholder||'').replace(/\s+/g,' ').trim().slice(0,40);
  if(entry){
   const want=px(entry.font);
   if(want!==null&&Math.abs(font-want)>0.05)problems.push({element:label(el),text,type:entry.id,issue:`font ${font}px, roster says ${+want.toFixed(2)}px`});
   if(typeof entry.height==='number'&&!/^inline/.test(cs.display)){const h=el.getBoundingClientRect().height;if(Math.abs(h-entry.height)>1)problems.push({element:label(el),text,type:entry.id,issue:`height ${Math.round(h)}px, roster says ${entry.height}px`});}
   continue;
  }
  const parent=parentOf(el),inherited=parent?parseFloat(getComputedStyle(parent).fontSize):font;
  if(Math.abs(font-inherited)>0.05)problems.push({element:label(el),parent:parent?label(parent):'',text,type:null,issue:`unregistered: ${font}px is not in the roster (surrounding text is ${+inherited.toFixed(2)}px)`});
 }
 return {checked,problems};
}
