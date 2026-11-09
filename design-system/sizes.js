'use strict';
/* Master size roster runtime.
   design-system/size-roster.json is the default roster. An administrator can publish a
   replacement from Studio > User Preferences > Look and Feel; every Studio and Desk page
   then compiles that roster into one stylesheet. The same compile() writes
   design-system/sizes.css (node scripts/size_roster.mjs) for the first paint. */
(function(root,factory){
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;else root.EccoSizes=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
 // Five IDs that never exist: the rules outrank page styles, including their !important
 // declarations, while every roster entry keeps the same specificity so roster order decides.
 const PREFIX=':is(*,#ecco-size#ecco-size#ecco-size#ecco-size#ecco-size) ';
 const FIELD=/^(input|select|textarea)\b/;
 const PROPS=['font','height','width','icon'];
 const LIMITS={font:[4,96],height:[10,1200],width:[10,1200],icon:[6,96]};
 const KEPT=/^calc\(\d{1,2}(\.\d{1,3})?px - 2pt\)$/;
 const ID=/^[a-z][a-z0-9-]{1,47}$/;
 /* The size scale: named sizes ("Heading 2", "Text Small", "Control Medium") grouped into
    categories. Elements refer to a size by "@id"; changing it changes every element using it. */
 function tokens(roster){const map={};for(const g of roster.scale||[])for(const t of g.tokens||[])map[t.id]={...t,group:g.id,groupName:g.name,kind:g.kind};return map;}
 function number(kind,v){const [lo,hi]=LIMITS[kind];if(typeof v!=='number'||!(v>=lo&&v<=hi))throw new Error(`${kind} must be between ${lo} and ${hi} px.`);return v;}
 /* A size in px (number), or null. Resolves "@token" and kept calc() sizes. */
 function px(v,map,kind='font'){
  if(v===null||v===undefined||v==='')return null;
  if(typeof v==='number')return v;
  if(typeof v==='string'&&v.startsWith('@')){const t=map[v.slice(1)];if(!t)throw new Error(`The size "${v.slice(1)}" is not in the size scale.`);return t.value;}
  if(typeof v==='string'&&kind==='font'&&KEPT.test(v))return +(parseFloat(v.slice(5))-8/3).toFixed(3);
  throw new Error(`${kind} must be a size from the scale or a number of pixels.`);
 }
 /* The CSS value for a size: a scale size becomes its custom property. */
 function cssValue(kind,v,map){
  if(v===null||v===undefined||v==='')return null;
  if(typeof v==='string'&&v.startsWith('@')){px(v,map,kind);return `var(--ecco-size-${v.slice(1)})`;}
  if(typeof v==='string'&&kind==='font'&&KEPT.test(v))return v;
  return +number(kind,px(v,map,kind)).toFixed(3)+'px';
 }
 const value=(kind,v,map={})=>cssValue(kind,v,map);
 function selector(s){
  if(typeof s!=='string'||!s.trim()||s.length>300||/[{};@\\]|\/\*|<\//.test(s))throw new Error('Selectors must be plain CSS selectors without braces, semicolons, at-rules or comments.');
  if(typeof CSS!=='undefined'&&CSS.supports&&!CSS.supports('selector('+s+')'))throw new Error('Not a valid CSS selector: '+s);
  return s.trim();
 }
 function text(v,max,what){if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(`${what} needs a name of at most ${max} characters.`);return v.trim();}
 /* Returns a clean copy or throws a message a person can act on. */
 function validate(roster){
  if(!roster||typeof roster!=='object'||!Array.isArray(roster.types))throw new Error('The roster needs a list of element types.');
  const clean={...roster,scale:[],types:[],variants:[]},ids=new Set(),tids=new Set();
  if(roster.scale!==undefined&&!Array.isArray(roster.scale))throw new Error('The size scale must be a list of categories.');
  for(const g of roster.scale||[]){
   if(!g||!ID.test(g.id||''))throw new Error('Each size category needs an id of lowercase letters, digits and hyphens.');
   if(!['font','height','icon'].includes(g.kind))throw new Error(`"${g.name||g.id}" must be a font, height or icon category.`);
   if(!Array.isArray(g.tokens)||!g.tokens.length||g.tokens.length>20)throw new Error(`"${g.name||g.id}" needs between 1 and 20 sizes.`);
   const out={id:g.id,name:text(g.name,40,'A size category'),kind:g.kind,tokens:[]};
   for(const t of g.tokens){
    if(!t||!ID.test(t.id||''))throw new Error(`Each size in "${out.name}" needs an id of lowercase letters, digits and hyphens.`);
    if(tids.has(t.id))throw new Error(`Two sizes share the id "${t.id}".`);tids.add(t.id);
    out.tokens.push({id:t.id,name:text(t.name,40,`A size in "${out.name}"`),value:number(g.kind==='font'?'font':g.kind==='icon'?'icon':'height',t.value)});
   }
   clean.scale.push(out);
  }
  if(clean.scale.length>12)throw new Error('The size scale is limited to 12 categories.');
  const map=tokens(clean);
  const entry=(e,isVariant)=>{
   if(!e||typeof e!=='object')throw new Error('Each element needs a name and selectors.');
   if(!ID.test(e.id||''))throw new Error(`"${e.name||e.id||'An element'}" needs an id of lowercase letters, digits and hyphens.`);
   if(ids.has(e.id))throw new Error(`Two elements share the id "${e.id}".`);ids.add(e.id);
   const name=text(e.name,80,`"${e.id}"`);
   if(!Array.isArray(e.selectors)||!e.selectors.length||e.selectors.length>40)throw new Error(`"${name}" needs between 1 and 40 selectors.`);
   const out={...e,name,selectors:e.selectors.map(selector)};
   for(const k of PROPS){try{cssValue(k,e[k],map);}catch(err){throw new Error(`"${name}": ${err.message}`);}}
   if(e.area!==undefined&&(typeof e.area!=='string'||e.area.length>40))throw new Error(`"${name}" has an invalid page area.`);
   if(e.excludeInside!==undefined){if(!Array.isArray(e.excludeInside)||e.excludeInside.length>60)throw new Error(`"${name}" has an invalid exclusion list.`);out.excludeInside=e.excludeInside.map(selector);}
   if(isVariant&&!clean.types.some(t=>t.id===e.of))throw new Error(`"${name}" is a variant of an element type that does not exist.`);
   return out;
  };
  for(const t of roster.types)clean.types.push(entry(t,false));
  for(const v of roster.variants||[])clean.variants.push(entry(v,true));
  if(clean.types.length+clean.variants.length>200)throw new Error('The roster is limited to 200 elements.');
  return clean;
 }
 /* Entries in application order: every type, then every variant. Later entries win.
    A variant inherits every size it leaves empty from the element type it refines. */
 function entries(roster){
  const types=roster.types,byId=Object.fromEntries(types.map(t=>[t.id,t]));
  return [...types,...(roster.variants||[]).map(v=>{const t=byId[v.of]||{},out={...v};for(const k of PROPS)out[k]=v[k]??t[k]??null;return out;})];
 }
 /* Entries with every size resolved to pixels (for checks and editors). */
 function resolved(roster){const map=tokens(roster);return entries(roster).map(e=>{const out={...e};for(const k of PROPS)out[k+'Px']=px(e[k],map,k);return out;});}
 function compile(input){
  const roster=validate(input),map=tokens(roster);
  const out=['/* Generated from the Ecco master size roster. Do not edit; change design-system/size-roster.json or use Look and Feel in Studio. */'];
  if(Object.keys(map).length)out.push(`:root{${Object.values(map).map(t=>`--ecco-size-${t.id}:${+t.value.toFixed(3)}px`).join(';')}}`);
  const list_=entries(roster);
  // An element belongs only to the last roster entry it matches (as classify() does), so each
  // rule skips elements that a later entry claims. A later entry with no size leaves the
  // element's own styles alone instead of inheriting an earlier entry's size.
  const claim=e=>`:where(${e.selectors.join(',')})`+(e.excludeInside?.length?`:not(:where(${e.excludeInside.join(',')}) *)`:'');
  list_.forEach((e,i)=>{
   const font=cssValue('font',e.font,map),height=cssValue('height',e.height,map),width=cssValue('width',e.width,map),icon=cssValue('icon',e.icon,map);
   if(!font&&!height&&!width&&!icon)return;
   const later=list_.slice(i+1);
   const not=(e.excludeInside?.length?`:not(:where(${e.excludeInside.join(',')}) *)`:'')+(later.length?`:not(${later.map(claim).join(',')})`:'');
   const target=`${PREFIX}:where(${e.selectors.join(',')})${not}`;
   const decl=[];
   if(font)decl.push(`font-size:${font}!important`);
   if(height)decl.push(`box-sizing:border-box!important`,`height:${height}!important`,`min-height:${height}!important`);
   if(width)decl.push(`width:${width}!important`,`min-width:${width}!important`);
   out.push(`/* ${e.name} (${e.id}) */`);
   if(decl.length)out.push(`${target}{${decl.join(';')}}`);
   // Controls and fields with a fixed height drop vertical padding so text stays inside the box.
   const boxes=e.selectors.filter(s=>!/^textarea\b/.test(s));
   if(height&&boxes.length)out.push(`${PREFIX}:where(${boxes.join(',')})${not}{padding-top:0!important;padding-bottom:0!important}`);
   if(icon)out.push(`${target} svg{width:${icon}!important;height:${icon}!important;min-width:${icon}!important}`);
  });
  return out.join('\n')+'\n';
 }
 /* Which roster entry an element belongs to: the last matching entry, as in the stylesheet. */
 function classify(roster,el){
  let found=null;
  for(const e of resolved(roster)){
   if(!e.selectors.some(s=>{try{return el.matches(s);}catch{return false;}}))continue;
   if(e.excludeInside?.length&&e.excludeInside.some(s=>{try{return el.parentElement?.closest(s)||el.getRootNode().host?.closest?.(s);}catch{return false;}}))continue;
   found=e;
  }
  return found;
 }
 const api={PREFIX,validate,compile,classify,entries,resolved,tokens,px,value};
 if(typeof document==='undefined')return api;

 /* ---------- Browser runtime ---------- */
 const ENDPOINT='https://vowmjru85f2gzo-8888.proxy.runpod.net/api/look-and-feel';
 const CACHE='ecco-look-and-feel-v1';
 const script=document.currentScript,base=new URL('.',script?.src||location.href);
 const styles=new Set();let css='',state={roster:null,source:'default',version:0,updatedAt:null,updatedBy:null};
 function styleFor(target){const s=document.createElement('style');s.dataset.eccoSizeRoster='';s.textContent=css;styles.add(s);target.append(s);return s;}
 let docStyle=null;
 function write(next){
  css=next;
  if(!docStyle){docStyle=styleFor(document.head||document.documentElement);}
  for(const s of styles){if(s.isConnected)s.textContent=css;else styles.delete(s);}
  // The static first-paint sheet carries the repository roster; the live roster replaces it.
  document.querySelectorAll('link[data-ecco-size-roster]').forEach(l=>{l.disabled=true;});
  // Keep the live roster after every page stylesheet in the document.
  if(docStyle.parentNode&&docStyle!==docStyle.parentNode.lastElementChild)docStyle.parentNode.append(docStyle);
 }
 // Shadow-DOM interfaces (Ecco Desk) get the same roster when they attach.
 const attach=Element.prototype.attachShadow;
 Element.prototype.attachShadow=function(init){const shadow=attach.call(this,init);styleFor(shadow);return shadow;};
 function apply(roster,meta={}){
  const clean=validate(roster);write(compile(clean));
  state={roster:clean,source:meta.source||'preview',version:meta.version||0,updatedAt:meta.updatedAt||null,updatedBy:meta.updatedBy||null};
  document.dispatchEvent(new CustomEvent('ecco:look-and-feel',{detail:{...state}}));
  return clean;
 }
 let defaultRoster=null;
 async function loadDefault(){
  if(defaultRoster)return defaultRoster;
  const r=await fetch(new URL('size-roster.json',base),{cache:'no-cache'});if(!r.ok)throw new Error('The default roster could not be loaded.');
  defaultRoster=validate(await r.json());return defaultRoster;
 }
 function remember(published){try{if(published)localStorage.setItem(CACHE,JSON.stringify(published));else localStorage.removeItem(CACHE);}catch{/* Storage can be unavailable. */}}
 async function fetchPublished(){
  const r=await fetch(ENDPOINT,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(data.error||'Look and Feel could not be loaded.'),{status:r.status});
  return data;
 }
 async function refresh(){
  const def=await loadDefault().catch(()=>null);
  let published=null;
  try{const data=await fetchPublished();published=data.roster?{roster:data.roster,version:data.version,updatedAt:data.updatedAt,updatedBy:data.updatedBy}:null;remember(published);}
  catch{/* Keep the cached or default roster while the service is unreachable. */try{published=JSON.parse(localStorage.getItem(CACHE)||'null');}catch{published=null;}}
  try{if(published)return apply(published.roster,{source:'published',...published});}catch{remember(null);}
  if(def)return apply(def,{source:'default'});
  return null;
 }
 // First paint: a cached published roster applies before the network answers.
 try{const cached=JSON.parse(localStorage.getItem(CACHE)||'null');if(cached)apply(cached.roster,{source:'published',...cached});}catch{remember(null);}
 const ready=refresh();
 // Tools that must not take the roster (the Look and Feel panel itself) use a plain shadow root.
 const attachPlain=(el,init)=>attach.call(el,init);
 Object.assign(api,{ENDPOINT,apply,refresh,ready,loadDefault,attachPlain});
 // Getters must stay live; Object.assign would copy their values once.
 Object.defineProperties(api,{state:{get(){return {...state};},enumerable:true},css:{get(){return css;},enumerable:true}});
 return api;
});
