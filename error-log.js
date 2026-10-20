'use strict';
/* Browser diagnostics: bounded, credential-redacted and retained across refreshes. */
(()=>{
 const KEY='ecco-errors-v1',LIMIT=500,seen=new WeakSet();
 const safeRead=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}};
 let entries=safeRead(KEY,[]);if(!Array.isArray(entries))entries=[];
 let browserId=safeRead('ecco-diagnostic-browser',null)||crypto.randomUUID();
 try{localStorage.setItem('ecco-diagnostic-browser',JSON.stringify(browserId));}catch{}
 const sessionId=crypto.randomUUID();let action='';
 const redact=value=>String(value??'')
  .replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]')
  .replace(/((?:authorization|api[_-]?key|access[_-]?key|password|secret|token)\s*["']?\s*[:=]\s*["']?)[^\s,"'&<>]+/gi,'$1[REDACTED]')
  .replace(/([?&](?:key|token|access_token|api_key|signature|sig)=)[^&#\s]+/gi,'$1[REDACTED]')
  .replace(/\bsk-[A-Za-z0-9_-]+/g,'[REDACTED]');
 function clean(value,visited=new WeakSet()){if(typeof value==='string')return redact(value);if(!value||typeof value!=='object')return value;if(visited.has(value))return '[Circular]';visited.add(value);if(Array.isArray(value))return value.map(v=>clean(v,visited));const out={};for(const [k,v] of Object.entries(value))out[k]=/authorization|password|secret|token|api.?key|access.?key/i.test(k)?'[REDACTED]':clean(v,visited);return out;}
 function context(){let s={},view='',story='';try{s=typeof state==='undefined'?{}:state;view=typeof page==='undefined'?'':page;story=typeof activeStory==='undefined'?'':activeStory;}catch{}
  const u=s.user||s.config?.user||{};
  return {user:{id:u.id||null,name:u.name||null,email:u.email||null,identity:u.email||u.id?'Signed-in user':'Not signed in; browser/session identified',browser_id:browserId,session_id:sessionId},page:location.origin+location.pathname,view,story_id:story,action,browser:navigator.userAgent};
 }
 function record(error,details={}){try{
  if(error&&typeof error==='object'){if(seen.has(error))return;seen.add(error);}
  const issue=window.EccoErrorKnowledge?.lookup(error);
  const item=clean({code:error?.code||null,knowledge_issue:issue?.id||null,possible_cause:issue?.cause||null,id:crypto.randomUUID(),occurred_at:new Date().toISOString(),...context(),source:'application',name:error?.name||'Error',message:error?.message||String(error),stack:error?.stack||null,...details});
  entries.push(item);entries=entries.slice(-LIMIT);
  while(entries.length){try{localStorage.setItem(KEY,JSON.stringify(entries));break;}catch{if(entries.length===1)break;entries.shift();}}
  window.dispatchEvent(new Event('ecco-error-recorded'));return item;
 }catch{ /* Diagnostics must never interrupt the app. */ }}
 window.EccoErrorLog={record,list:()=>entries.slice(),limit:LIMIT,redact};
 document.addEventListener('click',event=>{const b=event.target.closest?.('button,a,summary');if(b)action=redact((b.getAttribute('aria-label')||b.textContent||'').trim().slice(0,200));},true);
 window.addEventListener('error',event=>{if(event.error)record(event.error,{source:'javascript',file:event.filename,line:event.lineno,column:event.colno});else if(event.target!==window)record('Resource failed to load',{source:'resource',file:event.target?.src||event.target?.href||'',element:event.target?.tagName});},true);
 window.addEventListener('unhandledrejection',event=>record(event.reason,{source:'unhandled rejection'}));
 const originalError=console.error.bind(console);console.error=(...args)=>{record(args.find(a=>a instanceof Error)||args.map(a=>typeof a==='string'?a:JSON.stringify(clean(a))).join(' '),{source:'console'});originalError(...args);};
 const originalFetch=window.fetch.bind(window);
 window.fetch=async function(input,init){const url=typeof input==='string'?input:input?.url||String(input),method=init?.method||input?.method||'GET';
  try{const response=await originalFetch(input,init);if(!response.ok){let details={};try{if(response.headers.get('content-type')?.includes('json')){const body=await response.clone().json();details={error:body.error,message:body.message,traceback:body.traceback,details:body.error_details||body.details};}}catch{}
   record('HTTP '+response.status+' '+response.statusText,{source:'request',url,method,status:response.status,response:details});}return response;
  }catch(error){record(error,{source:'network',url,method});throw error;}
 };
 const q=s=>document.querySelector(s);let signature='';
 function render(){const root=q('#ecco-errors-view');if(!root||root.hidden)return;const sig=JSON.stringify(entries);if(signature===sig)return;signature=sig;root.replaceChildren();
  const info=document.createElement('p');info.className='help';info.textContent=entries.length+' errors · latest '+LIMIT+' retained in this browser';root.append(info);
  for(const item of [...entries].reverse()){const row=document.createElement('details'),title=document.createElement('summary');title.textContent=new Date(item.occurred_at).toLocaleString()+' · '+item.message;row.append(title);const pre=document.createElement('pre');pre.textContent=JSON.stringify(item,null,2);row.append(pre);root.append(row);}
  if(!entries.length){const p=document.createElement('p');p.textContent='No errors recorded.';root.append(p);}
 }
 function mount(){const tabs=q('#ecco-activity-tabs');if(!tabs||q('#ecco-errors-tab'))return;
  const b=document.createElement('button');b.id='ecco-errors-tab';b.type='button';b.className='secondary';b.textContent='Errors';b.setAttribute('role','tab');b.setAttribute('aria-selected','false');b.setAttribute('aria-controls','ecco-errors-view');
  const root=document.createElement('section');root.id='ecco-errors-view';root.hidden=true;root.setAttribute('role','tabpanel');tabs.after(root);
  for(const tab of tabs.querySelectorAll('button'))tab.addEventListener('click',()=>{root.hidden=true;});
  b.onclick=()=>{q('#jobs').hidden=true;q('#ecco-debug-view').hidden=true;root.hidden=false;for(const tab of tabs.querySelectorAll('[role=tab]')){tab.setAttribute('aria-selected',String(tab===b));tab.classList.toggle('secondary',tab!==b);}signature='';render();};tabs.append(b);
 }
 const jobVersions=new Map();
 function jobs(){try{if(typeof state==='undefined')return;for(const j of state.records||[]){if(!j.error&&!['failed','error'].includes(j.status))continue;if(!/job/.test(j.kind||''))continue;const sig=JSON.stringify([j.status,j.error,j.error_details]);if(jobVersions.get(j.id)===sig)continue;jobVersions.set(j.id,sig);if(entries.some(e=>e.job_id===j.id&&e.job_signature===sig))continue;
   record(j.error||'Generation failed',{source:'generation worker',job_id:j.id,job_signature:sig,story_id:j.story_id,model:j.model||j.request?.model,gpu:j.gpu||j.request?.pod||j.request?.gpu,occurred_at:new Date((j.error_details?.occurred_at||j.finished||j.updated||j.created)*1000).toISOString(),error_details:j.error_details||null,progress:j.progress});}}
  catch(error){record(error,{source:'error log job collection'});}
 }
 function start(){if(typeof api==='function'){const original=api;api=async function(...args){try{return await original.apply(this,args);}catch(error){record(error,{source:'API',endpoint:args[0]});throw error;}};}const style=document.createElement('style');style.textContent='#ecco-errors-view details{border-bottom:1px solid #605679;padding:10px 0}#ecco-errors-view summary{color:#ff7474;cursor:pointer;overflow-wrap:anywhere}#ecco-errors-view pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}#ecco-errors-view[hidden]{display:none!important}';document.head.append(style);mount();new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});setInterval(()=>{jobs();render();},1500);}
 window.addEventListener('ecco-error-recorded',render);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
