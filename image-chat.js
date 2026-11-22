// Image Studio (owner request, 21 Nov 2026): replaces the three-step Create Images screen when Image Studio is opened.
// One box: words, a photo (+), the camera or a dropped file. Optional helpers shape the prompt, the picture shape and
// what the helper needs. Then every message edits the picture, always from the clean original with all changes so far
// (chained edits drift by the 5th step). Tap the picture to aim a change at one spot. Undo, before/after, versions,
// download and Save to Image Library. Old workspace: window.EccoImageWorkspace.open() (kept for its tools and tests).
(()=>{
 const KEY='ecco-image-chat',EDIT_MODEL='qwen-image-edit-2511',UNSAVED='ecco-unsaved-images';
 const q=(s,r=document)=>r.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const SHAPES={wide:['Wide','1664x928'],square:['Square','1328x1328'],tall:['Tall','928x1664']};
 // Helpers: label, placeholder, shapes (first is the default), fields [key,label,example], photo (needs a photo), add(fields) prompt words.
 const HELPERS=[
  {id:'poster',label:'Poster',ph:'What is the poster for?',shapes:['tall','square','wide'],fields:[['title','Title','Grand Opening'],['when','Date and time','Fri 7 pm']],
   add:v=>'Poster layout with clear space at the top for the title'+(v.title?' "'+v.title+'"':'')+(v.when?' and a line for "'+v.when+'"':'')+'; bold focal image; balanced composition; print quality.'},
  {id:'ad',label:'Ad campaign',ph:'What are you advertising?',photo:true,shapes:['wide','square','tall'],fields:[['line','Headline','Made for the long way home']],
   add:v=>'Advertising photography of the exact product from the photo, unchanged shape, colour and logo; premium lighting; space for the headline'+(v.line?' "'+v.line+'"':'')+'.'},
  {id:'comic',label:'Comic',ph:'What is the story?',shapes:['square','tall','wide'],fields:[['cast','Characters','Mila the inventor, Bolt the robot'],['look','Look','Bold ink, flat colours']],
   add:v=>(v.look||'Bold ink comic art, flat vibrant colours')+(v.cast?'; characters: '+v.cast:'')+'; no text in the art.'},
  {id:'movie',label:'Movie frames',ph:'What happens in the scene?',shapes:['wide','tall'],fields:[['cast','Cast','A panda and a fox']],
   add:v=>'3D animated film still, cinematic lighting, film camera framing'+(v.cast?'; cast: '+v.cast:'')+'.'},
  {id:'story',label:'Storybook',ph:'What is the story about?',shapes:['square','tall','wide'],fields:[['hero','Main character','A little fox in a red scarf']],
   add:v=>'Warm picture-book illustration'+(v.hero?' of '+v.hero:'')+'; quiet area left for words.'},
  {id:'product',label:'Product photos',ph:'What is the product?',photo:true,shapes:['square','tall','wide'],fields:[['bg','Background','White studio']],
   add:v=>'The exact product from the photo, unchanged; '+(v.bg||'clean white studio')+' background; soft shadows; marketplace quality.'},
  {id:'retouch',label:'Photo retouch',ph:'What should change in your photo?',photo:true,shapes:[],fields:[['keep','Must not change','Faces']],
   add:v=>'Edit only what is asked; keep '+(v.keep||'faces, identity and composition')+' exactly as in the original photo.'},
  {id:'headshot',label:'Headshots',ph:'Where will you use them?',photo:true,shapes:[],fields:[['look','Look','Navy blazer, office background']],
   add:v=>'Professional headshot of the same person as the photo, identical face; '+(v.look||'business attire, soft studio light')+'.'}];
 const SUGGEST=['Warmer light','Make it night','Blur the background','Add soft rain'];
 const blank=()=>({phase:'start',draft:'',helper:'',shape:'',fields:{},photo:'',versions:[],view:0,dot:null,compare:false,error:''});
 let s=load(),open=false,entry=0,busy=null,lastHtml='',cam=null;
 function load(){try{return {...blank(),...JSON.parse(localStorage.getItem(KEY)||'{}'),compare:false,error:''};}catch{return blank();}}
 function save(){try{const {compare,error,...keep}=s;localStorage.setItem(KEY,JSON.stringify(keep));}catch{}}
 const helper=()=>HELPERS.find(h=>h.id===s.helper)||null;
 const rec=id=>state?.records?.find(r=>r.id===id&&!r.deleted);
 const cur=()=>s.versions[s.view]||s.versions[s.versions.length-1];
 const src=id=>{const r=rec(id);return r?(typeof media==='function'?media(r):'')||(typeof thumbURL==='function'?thumbURL(r):''):'';};
 function unsaved(add,remove){let l;try{l=JSON.parse(localStorage.getItem(UNSAVED))||[];}catch{l=[];}const set=new Set(l);(add||[]).forEach(i=>set.add(i));(remove||[]).forEach(i=>set.delete(i));try{localStorage.setItem(UNSAVED,JSON.stringify([...set].slice(-400)));}catch{}}
 function gpu(){const list=window.EccoCompute?.choices()||[],saved=localStorage.getItem('ecco-compute-image');if(list.some(g=>g.id===saved))return saved;if(list.some(g=>g.id==='serverless'))return 'serverless';const id=list[0]?.id;if(!id)throw Error('Connect Serverless or a GPU in Compute first.');return id;}
 function imageModel(){const id=modelProfiles?.selected?.images;return MODEL_CATALOG[id]&&!MODEL_CATALOG[id].pending&&MODEL_CATEGORIES.images.models.includes(id)?id:'qwen-image-2512';}
 // Where on the picture a tap landed, in words the edit model understands.
 const spot=d=>(d.y<1/3?'top':d.y<2/3?'middle':'bottom')+' '+(d.x<1/3?'left':d.x<2/3?'centre':'right');
 const where=d=>d?' (only in the '+spot(d).replace('middle centre','centre')+' of the picture)':'';
 // Every edit starts from the clean original and lists every change so far, so quality does not drift.
 function editPrompt(changes){const h=helper();return (h?.photo?h.add(s.fields)+'\n':'')+'Change the picture as follows and keep everything else exactly the same:\n'+changes.map((c,i)=>(i+1)+'. '+c).join('\n');}
 async function waitFor(job){
  const t=Date.now();
  for(;;){
   const next=await api('state'),done=next.records?.find(r=>r.kind==='job'&&r.id===job.id);
   if(done&&['error','cancelled'].includes(done.status))throw Error(done.error||'The picture stopped.');
   if(done?.status==='done'){await refresh(next);const ids=Array.isArray(done.result)?done.result:[done.result];const made=state.records.find(r=>r.kind==='asset'&&r.media==='image'&&!r.deleted&&(r.job_id===job.id||ids.includes(r.id)));if(!made)throw Error('The job finished without a picture.');return made.id;}
   if(Date.now()-t>600000)throw Error('Still drawing. Check Activity before trying again.');
   await new Promise(r=>setTimeout(r,2000));
  }
 }
 async function work(label,task){
  if(busy)return;busy={label,t:Date.now()};s.error='';draw(true);const tick=setInterval(()=>{const el=q('#image-chat [data-elapsed]');if(el&&busy)el.textContent=Math.round((Date.now()-busy.t)/1000)+' s';},1000);
  try{await task();}catch(e){s.error=e.message||String(e);}finally{clearInterval(tick);busy=null;save();if(open)draw(true);}
 }
 async function generate(prompt){
  const g=gpu(),model=imageModel();await window.EccoCompute.validate(g,model);
  const h=helper(),shape=SHAPES[s.shape||h?.shapes?.[0]||'wide']?.[1],p=modelPayload('images',g,model);
  if(shape&&(MODEL_CATALOG[model].sizes?.includes(shape)||state.config?.image_sizes?.[model]?.includes(shape)))p.resolution=shape;
  const full=String(prompt).trim()+(h?'. '+h.add(s.fields):'');if(full.length>4000)throw Error('Keep the description within 4,000 characters.');
  const id=await waitFor(await api('images',{...p,prompt:full,story_id:activeStory}));unsaved([id]);return id;
 }
 async function edit(original,changes){
  const g=gpu();await window.EccoCompute.validate(g,EDIT_MODEL);
  const full=editPrompt(changes);if(full.length>4000)throw Error('Too many changes for one picture. Save this one and start a new picture from it.');
  const id=await waitFor(await api('image-edits',{...modelSettings(EDIT_MODEL),gpu:g,asset_id:original,asset_ids:[original],prompt:full,story_id:activeStory}));unsaved([id]);return id;
 }
 function start(){
  const text=(q('#ic-words')?.value??s.draft).trim(),h=helper();s.draft=text;
  if(!text&&!s.photo){s.error='Type what you want, or add a photo.';return draw(true);}
  if(h?.photo&&!s.photo){s.error=h.label+' starts from your photo. Add one with + or the camera.';return draw(true);}
  work(s.photo?'Changing your photo':'Drawing your picture',async()=>{
   if(s.photo){s.versions=[{id:s.photo,text:'Your photo'}];s.phase='work';s.view=0;if(text){const id=await edit(s.photo,[text]);s.versions.push({id,text});s.view=1;}}
   else{const id=await generate(text);s.versions=[{id,text}];s.view=0;s.phase='work';}
   s.draft='';
  });
 }
 function change(text){
  text=String(text||'').trim();if(!text||busy)return;
  // Changing an older version drops the versions after it (the strip shows one line of history).
  s.versions=s.versions.slice(0,s.view+1);const c=text+where(s.dot),changes=[...s.versions.slice(1).map(v=>v.change||v.text),c];
  s.dot=null;s.draft='';
  work('Working on: '+text,async()=>{const id=await edit(s.versions[0].id,changes);s.versions.push({id,text,change:c});s.view=s.versions.length-1;});
 }
 async function upload(file){
  if(!file||!/^image\//.test(file.type)){s.error='Choose a picture file.';return draw(true);}
  if(file.size>20e6){s.error='Pictures up to 20 MB.';return draw(true);}
  const data=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]);r.onerror=()=>no(r.error);r.readAsDataURL(file);});
  work('Adding your photo',async()=>{const made=await api('images/upload',{name:file.name||'photo.png',data,story_id:activeStory});await refresh();unsaved([made.id]);s.photo=made.id;});
 }
 async function camOpen(){
  try{cam=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});draw(true);const v=q('#ic-cam');if(v){v.srcObject=cam;await v.play().catch(()=>{});}}
  catch{s.error='The camera is not available. Allow camera access in the browser, or add a photo with +.';draw(true);}
 }
 function camStop(){cam?.getTracks().forEach(t=>t.stop());cam=null;}
 function snap(){
  const v=q('#ic-cam');if(!v||!v.videoWidth)return;const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;
  const x=c.getContext('2d');x.translate(c.width,0);x.scale(-1,1);x.drawImage(v,0,0);camStop();
  c.toBlob(b=>upload(new File([b],'camera.png',{type:'image/png'})),'image/png');
 }
 async function download(){
  const v=cur();if(!v)return;
  try{const r=await api('media/'+v.id),url=URL.createObjectURL(new Blob([r.buffer],{type:r.mime}));const a=document.createElement('a');a.href=url;a.download='ecco-picture-'+(s.view+1)+'.'+((r.mime||'').split('/')[1]||'png');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);}
  catch(e){s.error=e.message;draw(true);}
 }
 function saveToLibrary(){const v=cur();if(!v)return;work('Saving to Image Library',async()=>{const r=rec(v.id);if(!r||r.stage!=='prod')await api('approve',{asset_id:v.id});unsaved([],[v.id]);await refresh();v.saved=true;});}

 /* ---------- screen ---------- */
 const chip=(label,attrs,on)=>'<button type="button" class="ic-chip"'+(on?' aria-pressed="true"':on===false?' aria-pressed="false"':'')+' '+attrs+'>'+esc(label)+'</button>';
 const round=(label,act,text,cls='')=>'<button type="button" class="ic-round '+cls+'" data-ic="'+act+'" aria-label="'+esc(label)+'">'+text+'</button>';
 function box(placeholder){
  const photo=s.photo?'<span class="ic-photo"><img data-asset="'+esc(s.photo)+'" src="'+esc(src(s.photo))+'" alt="Your photo"><button type="button" class="ic-x" data-ic="unphoto" aria-label="Remove photo">×</button></span>':'';
  return '<div class="ic-box">'+photo+round('Add a photo','photo','+','ic-add')+'<textarea id="ic-words" rows="1" aria-label="What are we making?" placeholder="'+esc(placeholder)+'">'+esc(s.draft)+'</textarea>'+round('Take a picture','camera',camIcon,'ic-add')+round('Go','go','→','ic-go')+'</div>';
 }
 const camIcon='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 4 7.5 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2.5L15 4H9Zm3 5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/></svg>';
 function startView(){
  const h=helper(),shapes=h?h.shapes:['wide','square','tall'],shape=s.shape||shapes[0];
  const opts=h?'<div class="ic-opts" role="group" aria-label="'+esc(h.label)+' details">'+(shapes.length?'<div class="ic-row" role="group" aria-label="Shape">'+shapes.map(k=>chip(SHAPES[k][0],'data-ic="shape" data-v="'+k+'"',k===shape)).join('')+'</div>':'')+
   h.fields.map(([k,l,ex])=>'<label class="ic-field">'+esc(l)+'<input data-field="'+k+'" value="'+esc(s.fields[k]||'')+'" placeholder="'+esc(ex)+'"></label>').join('')+'</div>':'';
  return '<div class="ic-start"><h1>What are we making?</h1>'+box(h?h.ph:'Describe it, or add a photo')+
   '<p class="help">Optional · start from a helper</p><div class="ic-row ic-helpers" role="group" aria-label="Helpers">'+HELPERS.map(x=>chip(x.label,'data-ic="helper" data-v="'+x.id+'"',x.id===s.helper)).join('')+'</div>'+opts+'</div>';
 }
 function workView(){
  const v=cur(),shown=s.compare?s.versions[0]:v,dot=s.dot?'<span class="ic-dot" style="left:'+(s.dot.x*100).toFixed(1)+'%;top:'+(s.dot.y*100).toFixed(1)+'%"></span>':'';
  const wait=busy?'<div class="ic-busy" role="status"><span>'+esc(busy.label)+'</span><span data-elapsed>'+Math.round((Date.now()-busy.t)/1000)+' s</span></div>':'';
  const strip=s.versions.length>1?'<div class="ic-row ic-strip" role="group" aria-label="Versions">'+s.versions.map((x,i)=>'<button type="button" class="ic-ver" data-ic="view" data-v="'+i+'" aria-pressed="'+(i===s.view)+'" aria-label="'+(i?'Version '+(i+1)+': '+esc(x.text):'Original')+'"><img data-thumb="'+esc(x.id)+'" src="'+esc(src(x.id))+'" alt=""><span>'+(i?i+1:'O')+'</span></button>').join('')+'</div>':'';
  const said=s.versions.slice(1,s.view+1).map(x=>'<li>'+esc(x.text)+'</li>').join('');
  return '<div class="ic-work"><div class="ic-stage"><div class="ic-pic" data-ic="tap" title="Tap to aim the next change at one spot"><img data-asset="'+esc(shown.id)+'" src="'+esc(src(shown.id))+'" alt="'+esc(s.compare?'Original':v.text)+'">'+dot+wait+'</div>'+
   '<div class="ic-row ic-tools" role="group" aria-label="Picture">'+
   (s.versions.length>1?'<button type="button" class="ic-tool" data-ic="undo"'+(busy?' disabled':'')+'>Undo</button><button type="button" class="ic-tool" data-ic="compare" aria-pressed="'+s.compare+'">Before / after</button>':'')+
   '<button type="button" class="ic-tool" data-ic="download">Download</button><button type="button" class="ic-tool" data-ic="save"'+(busy?' disabled':'')+'>'+(v.saved?'Saved ✓':'Save to Image Library')+'</button><button type="button" class="ic-tool" data-ic="new">New picture</button></div>'+strip+'</div>'+
   '<div class="ic-chat">'+(said?'<ol class="ic-said" aria-label="Your changes">'+said+'</ol>':'<p class="help">Say what to change. Tap the picture first to change one spot.</p>')+
   (s.dot?'<p class="help">Next change goes to the '+esc(spot(s.dot))+' <button type="button" class="ic-tool" data-ic="undot">Clear spot</button></p>':'')+
   '<div class="ic-row" role="group" aria-label="Suggestions">'+SUGGEST.map(t=>chip(t,'data-ic="suggest" data-v="'+esc(t)+'"')).join('')+'</div>'+
   '<div class="ic-box"><textarea id="ic-words" rows="1" aria-label="What should change?" placeholder="What should change?">'+esc(s.draft)+'</textarea>'+round('Send','send','→','ic-go')+'</div></div></div>';
 }
 function draw(force){
  const root=q('#page');if(!root||page!=='images'||!open)return;
  if(s.phase==='work'&&!s.versions.length)s.phase='start';
  const camera=cam?'<div class="ic-camera" role="dialog" aria-label="Camera"><video id="ic-cam" playsinline muted></video><div class="ic-row"><button type="button" class="ic-tool" data-ic="snap">Take picture</button><button type="button" class="ic-tool" data-ic="camclose">Cancel</button></div></div>':'';
  const startBusy=busy&&s.phase==='start'?'<div class="ic-busy" role="status"><span>'+esc(busy.label)+'</span><span data-elapsed>0 s</span></div>':'';
  const html='<div id="image-chat">'+(s.phase==='work'?workView():startView()+startBusy)+(s.error?'<p class="error" role="alert">'+esc(s.error)+'</p>':'')+camera+'<input type="file" id="ic-file" accept="image/*" hidden></div>';
  if(!force&&html===lastHtml&&q('#image-chat',root))return;
  const focused=document.activeElement?.id==='ic-words',caret=focused?document.activeElement.selectionStart:null;
  if(cam&&q('#ic-cam'))return;// do not tear down a live camera preview
  root.innerHTML=html;lastHtml=html;if(focused){const t=q('#ic-words');t?.focus();try{t.setSelectionRange(caret,caret);}catch{}}
  if(typeof hydrateMedia==='function')hydrateMedia();
 }
 function act(e){
  const b=e.target.closest('[data-ic]');if(!b||!q('#image-chat')?.contains(b))return;const a=b.dataset.ic,v=b.dataset.v;
  if(a==='tap'){if(busy||s.compare)return;const img=b.querySelector('img'),r=img.getBoundingClientRect();if(!r.width)return;s.dot={x:Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))};save();return draw(true);}
  if(a==='go')return start();
  if(a==='send')return change(q('#ic-words')?.value);
  if(a==='suggest')return change(v);
  if(a==='photo')return q('#ic-file')?.click();
  if(a==='camera')return camOpen();
  if(a==='snap')return snap();
  if(a==='camclose'){camStop();return draw(true);}
  if(a==='unphoto')s.photo='';
  if(a==='helper'){s.helper=s.helper===v?'':v;s.shape='';s.fields={};}
  if(a==='shape')s.shape=v;
  if(a==='view'){s.view=+v;s.compare=false;}
  if(a==='undo'&&s.versions.length>1){s.versions.pop();s.view=s.versions.length-1;s.compare=false;}
  if(a==='compare')s.compare=!s.compare;
  if(a==='undot')s.dot=null;
  if(a==='download')return download();
  if(a==='save')return saveToLibrary();
  if(a==='new'){const keep={helper:s.helper};s=blank();Object.assign(s,keep);}
  s.error='';save();draw(true);
 }
 document.addEventListener('click',act);
 document.addEventListener('input',e=>{if(e.target.id==='ic-words'){s.draft=e.target.value;save();}const f=e.target.dataset?.field;if(f&&e.target.closest('#image-chat')){s.fields[f]=e.target.value;save();}});
 document.addEventListener('keydown',e=>{if(e.target.id==='ic-words'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();s.phase==='work'?change(e.target.value):start();}});
 document.addEventListener('change',e=>{if(e.target.id==='ic-file'){upload(e.target.files?.[0]);e.target.value='';}});
 document.addEventListener('dragover',e=>{if(e.target.closest?.('#image-chat'))e.preventDefault();});
 document.addEventListener('drop',e=>{if(!e.target.closest?.('#image-chat'))return;e.preventDefault();const f=e.dataTransfer?.files?.[0];if(f){if(s.phase==='work'){s=blank();}upload(f);}});

 /* ---------- routing: Image Studio entries open this screen ---------- */
 const ENTRY='#workspace-image-studio-node,#workspace-studios-group [data-page="images"],nav [data-page="images"]';
 document.addEventListener('click',e=>{if(e.target.closest?.(ENTRY))entry=Date.now();},true);
 const storyMode=()=>window.EccoStoryWorkspace?.active||document.body.classList.contains('story-simple-mode');
 const before=imagePage,navBefore=navigate;
 navigate=function(target){if(target!=='images'){open=false;camStop();lastHtml='';}return navBefore.apply(this,arguments);};
 imagePage=function(){
  if(Date.now()-entry<5000){entry=0;open=!storyMode();lastHtml='';}
  if(!open)return before.apply(this,arguments);
  draw();
 };
 function openChat(){window.EccoStoryWorkspace?.leave?.();entry=Date.now();navigate('images');}
 // The Studios entry now opens this screen; the old workspace stays reachable for its own tools.
 const old=window.EccoImageWorkspace;if(old){const oldOpen=old.open;old.open=function(){open=false;return oldOpen.apply(this,arguments);};}
 window.EccoImageChat={open:openChat,draw,get state(){return s;},get busy(){return busy;},helpers:HELPERS};
})();
