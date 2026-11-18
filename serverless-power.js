'use strict';
/* Serverless On/Off (owner-approved mock, 15 Nov 2026).
   The GPU icon opens a small popup with one button: Off / On. Pressing it switches and closes the popup.
   On  = the storage server keeps one image, one video and one audio worker running on RunPod and sends each a
         tiny wake-up job so its model is loaded before the first real generation.
   Off = no warm workers; RunPod shuts them down and billing stops.
   Under the button, Auto-off (one setting for the whole workspace, owner request 15 Nov 2026): 30 min (default)
   turns it Off after 30 minutes with no Studio use and nothing generating; Never keeps it On until Off or sign-out.
   Signing in turns it On; signing out turns it Off (unless another browser is using Studio).
   While it is On, a small dot on the GPU icon shows it. The storage server also turns it Off by itself
   when no open Studio has been used for a while, so a forgotten tab never keeps a worker running. */
(()=>{
 const q=s=>document.querySelector(s);
 const ACTIVE_MS=10*60000,BEAT_MS=60000;
 let client=localStorage.getItem('ecco-serverless-client')||'';
 if(!/^[A-Za-z0-9_-]{8,64}$/.test(client)){client='studio-'+crypto.randomUUID().replaceAll('-','');localStorage.setItem('ecco-serverless-client',client);}
 let state={on:false,known:false},busy=false,pending=null,lastInput=Date.now(),popup=null;
 const connection=()=>window.EccoGPUConnection;
 const ready=()=>Boolean(window.EccoStorage?.ready&&connection()?.serverlessPower);
 const log=(event,details)=>window.EccoConnectivityLog?.record(event,details);

 function accept(reply){
  if(!reply||typeof reply.on!=='boolean')return;
  state={...reply,known:true};draw();
  document.dispatchEvent(new CustomEvent('ecco:serverless-power',{detail:{on:state.on}}));
 }
 async function setPower(on,reason){
  if(!ready()){pending={on,reason};return;}
  pending=null;busy=true;const before=state;state={...state,on};draw();
  try{
   const reply=await connection().serverlessPower(on,reason,client);accept(reply);
   log(reply.on?'Serverless turned on':'Serverless turned off',{gpu:'serverless',reason,kept_on_for_others:reply.kept_on_for_others});
  }catch(error){
   state=before;draw();
   log('Serverless On/Off failed',{gpu:'serverless',level:'error',reason,message:error.message});
   if(reason==='button')(window.EccoErrors?.show?window.EccoErrors.show(error,{title:'Serverless could not switch '+(on?'on':'off')}):typeof notice==='function'&&notice(error.message,true));
  }finally{busy=false;draw();}
 }
 async function setAutoOff(minutes){
  if(!ready())return;
  const before=state;state={...state,auto_off_minutes:minutes};busy=true;draw();
  try{accept(await connection().serverlessSettings(minutes,client));log('Serverless auto-off changed',{gpu:'serverless',auto_off_minutes:minutes});}
  catch(error){state=before;(window.EccoErrors?.show?window.EccoErrors.show(error,{title:'Auto-off could not be changed'}):typeof notice==='function'&&notice(error.message,true));}
  finally{busy=false;draw();}
 }
 async function beat(){
  if(!ready())return;
  if(pending)return setPower(pending.on,pending.reason);
  const active=document.visibilityState!=='hidden'&&Date.now()-lastInput<ACTIVE_MS&&Boolean(window.EccoAuth?.user);
  try{accept(await connection().serverlessHeartbeat(active,client));}catch{/* storage briefly unreachable: keep the last state */}
 }

 function icon(){return q('#connected-accelerator');}
 function ensurePopup(){
  if(popup&&popup.isConnected)return popup;
  popup=document.createElement('div');popup.id='serverless-power-popup';popup.setAttribute('role','group');popup.setAttribute('aria-label','Serverless GPU');popup.hidden=true;
  const button=document.createElement('button');button.type='button';button.id='serverless-power-toggle';
  button.onclick=()=>{if(button.disabled)return;const on=!state.on;close(true);setPower(on,'button');};
  const row=document.createElement('div');row.className='serverless-auto-off-row';
  const label=document.createElement('label');label.id='serverless-auto-off-label';label.htmlFor='serverless-auto-off';label.textContent='Auto-off';
  const select=document.createElement('select');select.id='serverless-auto-off';
  select.title='Never: workers keep running (and billing) until someone turns Serverless Off or signs out.';
  for(const [value,text] of [['30','30 min'],['never','Never']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
  select.onchange=()=>setAutoOff(select.value==='never'?null:30);
  row.append(label,select);
  popup.append(button,row);document.body.append(popup);return popup;
 }
 function place(){
  const target=icon();if(!popup||popup.hidden||!target)return;
  const rect=target.getBoundingClientRect(),width=popup.offsetWidth;
  popup.style.top=Math.round(rect.bottom+8)+'px';
  popup.style.left=Math.round(Math.max(8,Math.min(window.innerWidth-width-8,rect.left+rect.width/2-width/2)))+'px';
 }
 function open(){ensurePopup();popup.hidden=false;draw();place();popup.querySelector('button').focus();}
 function close(returnFocus){if(!popup||popup.hidden)return;popup.hidden=true;draw();if(returnFocus)icon()?.focus();}
 function draw(){
  const target=icon();
  if(target){
   if(target.getAttribute('role')!=='button'){target.setAttribute('role','button');target.tabIndex=0;target.setAttribute('aria-haspopup','true');target.setAttribute('aria-controls','serverless-power-popup');}
   const expanded=String(Boolean(popup&&!popup.hidden));if(target.getAttribute('aria-expanded')!==expanded)target.setAttribute('aria-expanded',expanded);
   let dot=target.querySelector('.serverless-power-dot');
   if(!dot){dot=document.createElement('span');dot.className='serverless-power-dot';dot.setAttribute('aria-hidden','true');target.append(dot);}
   dot.hidden=!state.on;target.dataset.serverlessOn=String(state.on);
  }
  const button=popup?.querySelector('button');if(!button)return;
  const label=state.on?'On':'Off';if(button.textContent!==label)button.textContent=label;
  button.setAttribute('aria-pressed',String(state.on));
  button.setAttribute('aria-label','Serverless GPU '+label);
  button.disabled=busy||!ready();
  button.setAttribute('aria-busy',String(busy));
  button.title=ready()?'':'Connect workspace storage first.';
  const select=popup.querySelector('#serverless-auto-off');
  if(select){const value=state.auto_off_minutes===null?'never':'30';if(select.value!==value&&document.activeElement!==select)select.value=value;select.disabled=busy||!ready();}
 }

 document.addEventListener('click',event=>{
  if(event.target.closest?.('#connected-accelerator')){event.preventDefault();popup&&!popup.hidden?close(false):open();return;}
  if(popup&&!popup.hidden&&!popup.contains(event.target))close(false);
 });
 document.addEventListener('keydown',event=>{
  if((event.key==='Enter'||event.key===' ')&&event.target.closest?.('#connected-accelerator')){event.preventDefault();popup&&!popup.hidden?close(true):open();return;}
  if(event.key==='Escape'&&popup&&!popup.hidden){event.preventDefault();close(true);}
 });
 for(const name of ['pointerdown','keydown','wheel','touchstart'])document.addEventListener(name,()=>{lastInput=Date.now();},{passive:true,capture:true});
 window.addEventListener('resize',place);window.addEventListener('scroll',place,true);

 // Sign-in turns Serverless On; sign-out turns it Off. A page reload that restores a session does neither,
 // so a manual Off stays Off.
 document.addEventListener('ecco:signed-in',()=>{lastInput=Date.now();setPower(true,'sign-in');});
 document.addEventListener('ecco:signed-out',()=>{close(false);setPower(false,'sign-out');});
 // Tell Your Story wake-up (owner, 17 Nov 2026): opening Tell Your Story sends one small job to every endpoint except
 // LongCat, so each model is loaded before the first generation. The server sends at most one round every 150 s.
 let lastWake=0;
 function storyWake(){
  if(Date.now()-lastWake<60000||!ready()||!connection()?.serverlessWake)return;
  lastWake=Date.now();
  connection().serverlessWake(client).then(reply=>log('Serverless wake-up for Tell Your Story',{gpu:'serverless',sent:Boolean(reply?.sent),recent:Boolean(reply?.recent)}))
   .catch(error=>{lastWake=0;log('Serverless wake-up failed',{gpu:'serverless',level:'error',message:error.message});});
 }
 document.addEventListener('click',event=>{
  const target=event.target.closest?.('summary,button,a,[role=button],[data-page="director"]');
  if(target&&/^\W*tell your story\b/i.test((target.textContent||'').trim()))storyWake();
 },true);

 const style=document.createElement('style');
 style.textContent='#connection-indicators #connected-accelerator{cursor:pointer;position:relative}'
  +'#connection-indicators #connected-accelerator[aria-expanded=true]::after,#connection-indicators #connected-accelerator[aria-expanded=true]::before{display:none!important}'
  +'#connected-accelerator .serverless-power-dot{position:absolute;top:2px;right:2px;width:7px;height:7px;border-radius:50%;background:var(--ecco-theme-success,#7bcf9b);box-shadow:0 0 0 2px var(--ecco-theme-surface,#252039);pointer-events:none}'
  +'#connected-accelerator .serverless-power-dot[hidden]{display:none}'
  +'#serverless-power-popup{position:fixed;z-index:10002;padding:5px;border-radius:12px;background:var(--ecco-theme-surface,#252039);border:1px solid var(--ecco-theme-border,#51496f);box-shadow:0 8px 20px #0006}'
  +'#serverless-power-popup[hidden]{display:none!important}'
  // Approved exception (mock, 15 Nov 2026): On is an accent-filled pill, so the shared pressed/focused button colors are overridden here.
  +'#serverless-power-popup #serverless-power-toggle{padding:0 12px;border-radius:999px;font-weight:600;cursor:pointer;background:transparent!important;color:var(--ecco-theme-text,#ffffff)!important;border:1px solid var(--ecco-theme-border,#51496f)!important;box-shadow:none!important}'
  +'#serverless-power-popup #serverless-power-toggle[aria-pressed=true]{background:var(--ecco-theme-accent,#ffdc24)!important;color:var(--ecco-theme-contrast,#211b33)!important;border-color:var(--ecco-theme-accent,#ffdc24)!important}'
  +'#serverless-power-toggle:disabled{opacity:.55;cursor:not-allowed}'
  +'#serverless-power-toggle:focus-visible{outline:2px solid var(--ecco-theme-text,#ffffff);outline-offset:2px}'
  +'#serverless-power-popup{display:flex;flex-direction:column;align-items:center;gap:6px}'
  +'#serverless-power-popup .serverless-auto-off-row{display:flex;align-items:center;gap:6px;white-space:nowrap}'
  +'#serverless-auto-off-label{color:var(--ecco-theme-muted,#c7c0dd);font-weight:500;margin:0}'
  +'#serverless-auto-off{padding:0 6px;border-radius:6px}';
 document.head.append(style);

 setInterval(()=>{draw();},2000);
 setInterval(beat,BEAT_MS);
 setTimeout(beat,1500);
 window.EccoServerlessPower={get on(){return state.on;},get known(){return state.known;},set:(on,reason='button')=>setPower(on,reason),open,close,storyWake};
})();
