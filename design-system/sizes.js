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
 const LIMITS={font:[4,96],height:[10,200],width:[10,1200]};
 const KEPT=/^calc\(\d{1,2}(\.\d{1,3})?px - 2pt\)$/;

 function value(kind,v){
  if(v===null||v===undefined||v==='')return null;
  if(typeof v==='number'){const [lo,hi]=LIMITS[kind];if(!(v>=lo&&v<=hi))throw new Error(`${kind} must be between ${lo} and ${hi} px.`);return +v.toFixed(3)+'px';}
  if(typeof v==='string'&&kind==='font'&&KEPT.test(v))return v;
  throw new Error(`${kind} must be a number of pixels.`);
 }
 function selector(s){
  if(typeof s!=='string'||!s.trim()||s.length>300||/[{};@\\]|\/\*|<\//.test(s))throw new Error('Selectors must be plain CSS selectors without braces, semicolons, at-rules or comments.');
  if(typeof CSS!=='undefined'&&CSS.supports&&!CSS.supports('selector('+s+')'))throw new Error('Not a valid CSS selector: '+s);
  return s.trim();
 }
 const ID=/^[a-z][a-z0-9-]{1,47}$/;
 /* Returns a clean copy or throws a message a person can act on. */
 function validate(roster){
  if(!roster||typeof roster!=='object'||!Array.isArray(roster.types))throw new Error('The roster needs a list of element types.');
  const ids=new Set(),clean={...roster,types:[],variants:[]};
  const entry=(e,isVariant)=>{
   if(!e||typeof e!=='object')throw new Error('Each element needs a name and selectors.');
   if(!ID.test(e.id||''))throw new Error(`"${e.name||e.id||'An element'}" needs an id of lowercase letters, digits and hyphens.`);
   if(ids.has(e.id))throw new Error(`Two elements share the id "${e.id}".`);ids.add(e.id);
   if(typeof e.name!=='string'||!e.name.trim()||e.name.length>80)throw new Error(`"${e.id}" needs a name of at most 80 characters.`);
   if(!Array.isArray(e.selectors)||!e.selectors.length||e.selectors.length>40)throw new Error(`"${e.name}" needs between 1 and 40 selectors.`);
   const out={...e,name:e.name.trim(),selectors:e.selectors.map(selector)};
   for(const k of ['font','height','width'])value(k,e[k]);
   if(e.excludeInside!==undefined){if(!Array.isArray(e.excludeInside)||e.excludeInside.length>60)throw new Error(`"${e.name}" has an invalid exclusion list.`);out.excludeInside=e.excludeInside.map(selector);}
   if(isVariant&&!clean.types.some(t=>t.id===e.of))throw new Error(`"${e.name}" is a variant of an element type that does not exist.`);
   return out;
  };
  for(const t of roster.types)clean.types.push(entry(t,false));
  for(const v of roster.variants||[])clean.variants.push(entry(v,true));
  if(clean.types.length+clean.variants.length>200)throw new Error('The roster is limited to 200 elements.');
  return clean;
 }
 /* Entries in application order: every type, then every variant. Later entries win. */
 function entries(roster){return [...roster.types,...(roster.variants||[])];}
 function compile(input){
  const roster=validate(input),out=['/* Generated from the Ecco master size roster. Do not edit; change design-system/size-roster.json or use Look and Feel in Studio. */'];
  const list_=entries(roster);
  // An element belongs only to the last roster entry it matches (as classify() does), so each
  // rule skips elements that a later entry claims. A later entry with no size leaves the
  // element's own styles alone instead of inheriting an earlier entry's size.
  const claim=e=>`:where(${e.selectors.join(',')})`+(e.excludeInside?.length?`:not(:where(${e.excludeInside.join(',')}) *)`:'');
  list_.forEach((e,i)=>{
   const font=value('font',e.font),height=value('height',e.height),width=value('width',e.width);
   if(!font&&!height&&!width)return;
   const later=list_.slice(i+1);
   const not=(e.excludeInside?.length?`:not(:where(${e.excludeInside.join(',')}) *)`:'')+(later.length?`:not(${later.map(claim).join(',')})`:'');
   const list=[`${PREFIX}:where(${e.selectors.join(',')})${not}`];
   const decl=[];
   if(font)decl.push(`font-size:${font}!important`);
   if(height)decl.push(`box-sizing:border-box!important`,`height:${height}!important`,`min-height:${height}!important`);
   if(width)decl.push(`width:${width}!important`,`min-width:${width}!important`);
   out.push(`/* ${e.name} (${e.id}) */\n${list.join(',\n')}{${decl.join(';')}}`);
   // Controls with a fixed height drop vertical padding so text stays inside the box.
   const boxes=e.selectors.filter(s=>!FIELD.test(s));
   if(height&&boxes.length)out.push(`${PREFIX}:where(${boxes.join(',')})${not}{padding-top:0!important;padding-bottom:0!important}`);
  });
  return out.join('\n')+'\n';
 }
 /* Which roster entry an element belongs to: the last matching entry, as in the stylesheet. */
 function classify(roster,el){
  let found=null;
  for(const e of entries(roster)){
   if(!e.selectors.some(s=>{try{return el.matches(s);}catch{return false;}}))continue;
   if(e.excludeInside?.length&&e.excludeInside.some(s=>{try{return el.parentElement?.closest(s)||el.getRootNode().host?.closest?.(s);}catch{return false;}}))continue;
   found=e;
  }
  return found;
 }
 const api={PREFIX,validate,compile,classify,entries,value};
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
 Object.assign(api,{ENDPOINT,apply,refresh,ready,loadDefault});
 // Getters must stay live; Object.assign would copy their values once.
 Object.defineProperties(api,{state:{get(){return {...state};},enumerable:true},css:{get(){return css;},enumerable:true}});
 return api;
});
