'use strict';
/* Create Images for Your Story (owner-approved prototype, 2026-11-10).
   Three steps: 1. Image (upload, Image Library or Generate with AI, then Improve with AI drafts),
   2. Enhance Image (one tab per image; controls picked for what the image shows; choices are sent with
   or without a prompt), 3. Publish Images (one Publish button). Model settings stay hidden behind a
   button; Qwen and Serverless are the defaults. The Story workspace's Story Generation tab keeps its
   own image form. */
(()=>{
 const M=window.EccoImageWorkspaceModel;
 const EDIT_MODEL='qwen-image-edit-2511',LIMIT=3,DRAFTS=3;
 const q=(s,r=document)=>r.querySelector(s),all=(s,r=document)=>[...r.querySelectorAll(s)];
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const key=story=>'ecco-image-workspace:'+story;
 let ws=null,wsStory=null,modelOpen=false;const busy={};

 /* ---------- state ---------- */
 const fresh=()=>({step:'image',src:'library',selected:[],active:0,enh:0,generated:[],ai:{},aiPrompt:'',genPrompt:'',genStyle:'',genShape:'',search:'',label:'',enhance:{},final:{},published:false});
 function load(){
  if(wsStory===activeStory&&ws)return ws;
  let saved=null;try{saved=JSON.parse(localStorage.getItem(key(activeStory))||'null');}catch{}
  ws={...fresh(),...(saved&&typeof saved==='object'?saved:{})};wsStory=activeStory;modelOpen=false;return ws;
 }
 function save(){try{localStorage.setItem(key(wsStory),JSON.stringify(ws));}catch{}}
 const record=id=>state.records.find(r=>r.id===id&&r.kind==='asset'&&r.media==='image'&&!r.deleted);
 const title=id=>{const r=record(id);return r?.title||r?.prompt?.slice(0,60)||'Image';};
 // Enhance offers the Popular styles as choices; Generate with AI lists every style by group.
 const styles=()=>{const S=window.EccoImageStyles;return S?.groups?.find(g=>g[0]==='Popular')?.[1]||S?.names?.slice(0,8)||[];};
 const styleGroups=()=>window.EccoImageStyles?.groups||[['Styles',window.EccoImageStyles?.names||[]]];
 function tidy(){
  ws.selected=ws.selected.filter(record).slice(0,LIMIT);ws.generated=ws.generated.filter(record);
  for(const [id,f] of Object.entries(ws.final))if(!record(f))delete ws.final[id];
  ws.active=Math.max(0,Math.min(ws.active,ws.selected.length-1));ws.enh=Math.max(0,Math.min(ws.enh,ws.selected.length-1));
 }
 const finalOf=id=>ws.final[id]||id;
 const ai=id=>ws.ai[id]||(ws.ai[id]={drafts:[],index:0});
 const enh=id=>ws.enhance[id]||(ws.enhance[id]={type:'',analysis:null,choices:{},prompt:'',drafts:[],index:0,compare:'after'});

 /* ---------- model and compute ---------- */
 function imageModel(){const id=modelProfiles.selected.images;return MODEL_CATALOG[id]&&!MODEL_CATALOG[id].pending&&MODEL_CATEGORIES.images.models.includes(id)?id:'qwen-image-2512';}
 const computes=()=>window.EccoCompute?.choices()||[];
 function computeId(){
  const list=computes(),saved=localStorage.getItem('ecco-compute-image');
  if(list.some(g=>g.id===saved))return saved;if(list.some(g=>g.id==='serverless'))return 'serverless';return list[0]?.id||'';
 }
 const computeName=()=>{const id=computeId();return window.EccoGPUPicker?.gpus.find(g=>g.id===id)?.name||'Not connected';};
 const modelName=()=>ws.step==='image'&&ws.src==='generate'||!ws.selected.length?MODEL_CATALOG[imageModel()].name:MODEL_CATALOG[EDIT_MODEL]?.name||'Qwen Image Edit';
 function requireCompute(){const gpu=computeId();if(!gpu)throw Error('Connect Serverless or a GPU in Compute first.');return gpu;}
 async function waitFor(job){
  const started=Date.now();
  for(;;){
   const next=await api('state'),done=next.records?.find(r=>r.kind==='job'&&r.id===job.id);
   if(done&&['error','cancelled'].includes(done.status))throw Error(done.error||'Image generation stopped.');
   if(done?.status==='done'){
    await refresh(next);const ids=Array.isArray(done.result)?done.result:[done.result];
    const made=state.records.filter(r=>r.kind==='asset'&&r.media==='image'&&!r.deleted&&(r.job_id===job.id||ids.includes(r.id))).map(r=>r.id);
    if(!made.length)throw Error('The job finished without an image.');return made;
   }
   if(Date.now()-started>600000)throw Error('The image is still generating. Check Activity before trying again.');
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
 }
 const styled=(prompt,style)=>style&&window.EccoImageStyles?.get(style)?window.EccoImageStyles.prompt(prompt,style):prompt;
 async function generate(prompt,style,resolution){
  const gpu=requireCompute(),model=imageModel();await window.EccoCompute.validate(gpu,model);
  const payload=modelPayload('images',gpu,model);if(resolution&&MODEL_CATALOG[model].sizes?.includes(resolution))payload.resolution=resolution;
  const full=styled(prompt,style);if(full.length>4000)throw Error('Keep the description within 4,000 characters.');
  const job=await api('images',{...payload,prompt:full,negative:style?window.EccoImageStyles.negative('',style):'',story_id:activeStory});
  return waitFor(job);
 }
 async function edit(ids,prompt,style){
  const gpu=requireCompute(),config=await window.EccoCompute.validate(gpu,EDIT_MODEL),settings=modelSettings(EDIT_MODEL);
  if(!config.generation_controls_version&&ids.length>1)throw Error('The connected GPU needs the multi-reference update to use several images. Your choices and prompt are saved.');
  const full=styled(prompt,style);if(full.length>4000)throw Error('Keep the prompt and choices within 4,000 characters.');
  const job=await api('image-edits',{gpu,asset_id:ids[0],asset_ids:ids,prompt:full,story_id:activeStory,...settings});
  return waitFor(job);
 }
 async function run(name,task){
  if(busy[name])return;busy[name]=true;draw();
  try{await task();}catch(error){notice(error.message,true);}finally{busy[name]=false;save();if(page==='images'&&q('#image-workspace'))draw();}
 }

 /* ---------- small pieces ---------- */
 const img=(id,alt,cls='')=>{const r=record(id);return '<img class="'+cls+'" data-asset="'+esc(id)+'" src="'+esc(r?media(r):'')+'" alt="'+esc(alt)+'">';};
 const spinner='<span class="generation-spinner" aria-hidden="true"></span>';
 const tab=(id,label,selected,act,extra='')=>'<button type="button" role="tab" id="'+id+'" aria-selected="'+selected+'" tabindex="'+(selected?0:-1)+'" data-act="'+act+'" '+extra+'>'+label+'</button>';
 const drafts=(list,index,act)=>'<div class="pdf-ai-drafts iw-drafts" role="tablist" aria-label="Drafts">'+[0,1,2].map(i=>'<button type="button" role="tab" class="pdf-ai-draft-tab" aria-selected="'+(i===index)+'" tabindex="'+(i===index?0:-1)+'" data-filled="'+(!!list[i])+'" data-act="'+act+'" data-index="'+i+'">Draft '+(i+1)+'</button>').join('')+'</div>';
 function tile(id,number,act){
  const on=number>0;
  return '<button type="button" class="iw-tile" data-act="'+act+'" data-id="'+esc(id)+'" aria-pressed="'+on+'" aria-label="'+esc(title(id))+(on?', selected '+number:'')+'">'+img(id,'')+(on?'<span class="iw-badge">'+number+'</span>':'')+'<span class="iw-cap help">'+esc(title(id))+'</span></button>';
 }

 /* ---------- step 1: Image ---------- */
 function sourcePane(){
  if(ws.src==='upload')return '<section class="pdf-review-box" aria-labelledby="iw-upload-heading"><strong class="pdf-review-heading" id="iw-upload-heading">Upload an Image</strong><input type="file" accept="image/png,image/jpeg,image/webp" data-upload-file hidden><div class="story-upload-slot"><button type="button" class="story-upload-target" data-act="upload"'+(busy.upload?' disabled aria-busy="true"':'')+'>'+(busy.upload?spinner:'<span class="story-upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg></span>')+(busy.upload?'Uploading…':'Upload Image')+'</button></div><p class="help">PNG, JPG or WebP. Uploads are added to Selected Images and kept in Image Library.</p></section>';
  if(ws.src==='generate'){
   const sizes=MODEL_CATALOG[imageModel()].sizes||[],shapes={'1664x928':'Wide','1328x1328':'Square','928x1664':'Tall'};
   return '<section class="pdf-review-box" aria-labelledby="iw-gen-heading"><strong class="pdf-review-heading" id="iw-gen-heading">What should the image show?</strong><textarea data-input="genPrompt" rows="6" maxlength="3000" aria-labelledby="iw-gen-heading" placeholder="For example: a lighthouse on a black cliff at night, a storm rolling in">'+esc(ws.genPrompt)+'</textarea><div class="iw-pair"><label>Style<select data-input="genStyle"><option value="">No style</option>'+styleGroups().map(([g,list])=>'<optgroup label="'+esc(g)+'">'+list.map(s=>'<option value="'+esc(s)+'"'+(s===ws.genStyle?' selected':'')+'>'+esc(s)+'</option>').join('')+'</optgroup>').join('')+'</select></label>'+(sizes.length?'<label>Shape<select data-input="genShape">'+sizes.map(s=>'<option value="'+s+'"'+(s===ws.genShape?' selected':'')+'>'+esc(shapes[s]||s)+'</option>').join('')+'</select></label>':'')+'</div><button type="button" data-act="generate"'+(busy.generate?' disabled aria-busy="true"':ws.genPrompt.trim()?'':' disabled')+'>'+(busy.generate?spinner+' Generating…':'Generate image')+'</button>'+(ws.generated.length?'<p class="help">Click an image to select it.</p><div class="iw-grid">'+ws.generated.map(id=>tile(id,ws.selected.indexOf(id)+1,'pick')).join('')+'</div>':'')+'</section>';
  }
  const images=state.records.filter(r=>r.kind==='asset'&&r.media==='image'&&!r.deleted).sort((a,b)=>(b.created||0)-(a.created||0));
  const folders=state.records.filter(r=>r.kind==='image_folder'&&!r.deleted);
  const term=ws.search.trim().toLowerCase();
  const shown=images.filter(a=>(!term||(a.title||a.prompt||'').toLowerCase().includes(term))&&(!ws.label||state.records.some(l=>l.kind==='library_item'&&!l.deleted&&l.asset_id===a.id&&l.folder_id===ws.label)));
  return '<section class="pdf-review-box" aria-labelledby="iw-lib-heading"><strong class="pdf-review-heading" id="iw-lib-heading">Image Library</strong><div class="iw-pair"><label>Search<input type="search" data-input="search" value="'+esc(ws.search)+'" placeholder="Find an image"></label><label>Label<select data-input="label"><option value="">All images</option>'+folders.map(f=>'<option value="'+esc(f.id)+'"'+(f.id===ws.label?' selected':'')+'>'+esc(f.name)+'</option>').join('')+'</select></label></div><p class="help">Select up to 3 images. Click again to deselect.</p>'+(shown.length?'<div class="iw-grid iw-library">'+shown.map(a=>tile(a.id,ws.selected.indexOf(a.id)+1,'pick')).join('')+'</div>':'<p class="help">'+(images.length?'No images match.':'Image Library is empty. Upload or generate an image.')+'</p>')+'</section>';
 }
 function selectedPane(){
  const id=ws.selected[ws.active];
  return '<section class="pdf-review-box pdf-selected-label" aria-labelledby="iw-selected-heading"><div class="iw-head"><strong class="pdf-review-heading" id="iw-selected-heading">Selected Images</strong><span class="help">'+ws.selected.length+' of 3</span></div><p class="help">Only these images go to Enhance Image.</p>'+
   (id?'<div class="iw-preview">'+img(id,'Image '+(ws.active+1)+': '+title(id))+'<span class="iw-cap help">Image '+(ws.active+1)+' · '+esc(title(id))+'</span></div>':'<p class="iw-blank help">Choose images from a tab on the left.</p>')+
   '<div class="iw-grid">'+[0,1,2].map(i=>{const s=ws.selected[i];return s?'<div class="iw-slot">'+'<button type="button" class="iw-tile" data-act="show" data-index="'+i+'" aria-pressed="'+(i===ws.active)+'" aria-label="Show image '+(i+1)+': '+esc(title(s))+'">'+img(s,'')+'<span class="iw-badge">'+(i+1)+'</span></button><button type="button" class="iw-remove" data-act="remove" data-index="'+i+'" aria-label="Remove image '+(i+1)+'" title="Remove">×</button></div>':'<div class="iw-empty-slot help">Empty</div>';}).join('')+'</div></section>';
 }
 function improvePane(){
  const id=ws.selected[ws.active],a=id?ai(id):{drafts:[],index:0},shown=a.drafts[a.index];
  return '<section class="pdf-review-box" aria-labelledby="iw-ai-heading"><div class="iw-head"><strong class="pdf-review-heading" id="iw-ai-heading">Improve with AI</strong><button type="button" class="pdf-ai-icon" data-act="improve" aria-label="Improve with AI" title="Improve with AI"'+(!id||busy.improve||!ws.aiPrompt.trim()?' disabled':'')+'>'+(busy.improve?spinner:'<span aria-hidden="true">✦</span>')+'</button></div><textarea data-input="aiPrompt" rows="6" maxlength="2000" aria-label="AI instructions" placeholder="Describe how to change the selected image…">'+esc(ws.aiPrompt)+'</textarea>'+drafts(a.drafts,a.index,'ai-draft')+
   (shown?'<div class="iw-preview iw-preview-small">'+img(shown,'Draft '+(a.index+1))+'<span class="iw-cap help">Draft '+(a.index+1)+'</span></div>':'<p class="iw-blank help">Your AI output will appear here. ✦ fills the next draft, up to 3.</p>')+
   '<div class="iw-row"><button type="button" data-act="use-ai"'+(shown?'':' disabled')+'>Use AI Image</button><button type="button" class="secondary" data-act="clear-ai"'+(shown?'':' disabled')+'>Clear AI Output</button></div></section>';
 }
 function imageStep(){
  const tabs=[['upload','Upload an Image'],['library','Select from Image Library'],['generate','Generate with AI']];
  return '<div class="story-source-tabs" role="tablist" aria-label="Image source">'+tabs.map(([id,label])=>tab('iw-src-'+id,label,ws.src===id,'src','data-src="'+id+'" aria-controls="iw-src-panel"')).join('')+'</div>'+
   '<div class="story-source-panel" role="tabpanel" id="iw-src-panel" aria-labelledby="iw-src-'+ws.src+'"><div class="pdf-selection-layout iw-layout">'+sourcePane()+selectedPane()+improvePane()+'</div></div>';
 }

 /* ---------- step 2: Enhance Image ---------- */
 function controlsPane(id){
  const e=enh(id);
  if(busy['analyze:'+id])return '<p class="help iw-status">'+spinner+' Picking controls for this image…</p>';
  if(!e.type)return '<div class="iw-group"><span id="iw-type-label">What does this image show?</span><div class="iw-options" role="group" aria-labelledby="iw-type-label">'+M.TYPE_IDS.map(t=>'<button type="button" class="iw-chip" data-act="type" data-type="'+t+'">'+M.TYPES[t].name+'</button>').join('')+'</div></div>';
  return M.sections(e.type,styles()).map(s=>'<div class="iw-section"><h3>'+esc(s.title)+'</h3>'+s.groups.map(g=>{
   const value=e.choices[g.key],picked=g.multi?(Array.isArray(value)?value:[]):value?[value]:[],labelId='iw-g-'+g.key;
   return '<div class="iw-group"><span id="'+labelId+'">'+esc(g.label)+(picked.length?'<b>'+esc(picked.join(', '))+'</b>':'')+(g.multi?'<span class="help"> Pick any</span>':'')+'</span><div class="iw-options" role="group" aria-labelledby="'+labelId+'">'+g.options.map(o=>{
    const n=M.optionName(o),on=picked.includes(n),sug=M.isSuggested(e.analysis,g.key,n);
    return g.swatch?'<button type="button" class="iw-swatch'+(sug?' iw-suggested':'')+'" style="--iw-swatch:'+esc(o.hex)+'" data-act="choose" data-key="'+g.key+'" data-value="'+esc(n)+'" aria-pressed="'+on+'" aria-label="'+esc(n)+(sug?', suggested':'')+'" title="'+esc(n)+'"></button>'
     :'<button type="button" class="iw-chip'+(sug?' iw-suggested':'')+'" data-act="choose" data-key="'+g.key+'" data-value="'+esc(n)+'" aria-pressed="'+on+'"'+(sug?' aria-description="Suggested"':'')+'>'+esc(n)+'</button>';
   }).join('')+'</div></div>';
  }).join('')+'</div>').join('');
 }
 function sent(id,number){
  const e=enh(id),list=e.type?M.chosen(e.type,e.choices,styles()):[],prompt=e.prompt.trim();
  const note=!list.length&&!prompt?'Pick a choice or write a prompt.':prompt&&list.length?'Your prompt and your choices are sent together.':prompt?'Only the prompt is sent.':'No prompt: your choices are sent on their own.';
  return '<h3>Sent to generation</h3><span><span class="help">Image · </span>Image '+number+' · '+esc(title(id))+'</span><span><span class="help">Prompt · </span>'+esc(prompt||'None')+'</span><span><span class="help">Choices · </span>'+esc(list.map(c=>c.label+': '+c.value).join('; ')||'None')+'</span><p class="help">'+note+'</p>';
 }
 function enhanceStep(){
  if(!ws.selected.length)return '<p class="iw-blank help">Choose images in step 1 first.</p>';
  const id=ws.selected[ws.enh],number=ws.enh+1,e=enh(id),shown=e.drafts[e.index],before=e.compare==='before';
  const can=e.type&&M.canGenerate(e.prompt,e.type,e.choices,styles())&&e.drafts.length<DRAFTS&&!busy['enhance:'+id];
  return '<div class="story-source-tabs" role="tablist" aria-label="Images to enhance">'+ws.selected.map((s,i)=>tab('iw-enh-'+i,'Image '+(i+1)+' · '+esc(title(s))+(ws.final[s]?' <span class="iw-done">✓</span>':''),i===ws.enh,'enh','data-index="'+i+'" aria-controls="iw-enh-panel"')).join('')+'</div>'+
   '<div class="story-source-panel" role="tabpanel" id="iw-enh-panel" aria-labelledby="iw-enh-'+ws.enh+'"><div class="pdf-selection-layout iw-layout iw-enhance">'+
   '<section class="pdf-review-box" aria-labelledby="iw-preview-heading"><div class="iw-head"><strong class="pdf-review-heading" id="iw-preview-heading">Preview</strong><div class="iw-row" role="group" aria-label="Compare"><button type="button" class="secondary" data-act="compare" data-mode="before" aria-pressed="'+before+'">Before</button><button type="button" class="secondary" data-act="compare" data-mode="after" aria-pressed="'+!before+'">After</button></div></div>'+
   '<div class="iw-preview">'+img(before?id:shown||finalOf(id),(before?'Before':'After')+': '+title(id))+'<span class="iw-cap help">'+(before?'Before':shown?'Draft '+(e.index+1):ws.final[id]?'Enhanced':'Original')+'</span></div>'+
   drafts(e.drafts,e.index,'enh-draft')+'<p class="help">'+(e.drafts.length?e.drafts.length+' of 3 drafts made for this image.':'Generate fills Draft 1. Each run fills the next draft, up to 3.')+'</p>'+
   '<div class="iw-row"><button type="button" data-act="use-draft"'+(shown?'':' disabled')+'>Use Draft '+(e.index+1)+' for Image '+number+'</button><button type="button" class="secondary" data-act="clear-drafts"'+(e.drafts.length?'':' disabled')+'>Clear drafts</button></div></section>'+
   '<section class="pdf-review-box pdf-selected-label" aria-labelledby="iw-controls-heading"><div class="iw-head"><strong class="pdf-review-heading" id="iw-controls-heading">Enhancements</strong>'+(e.type?'<div class="iw-row"><button type="button" class="secondary" data-act="suggest"'+(e.analysis&&Object.keys(e.analysis.suggestions).length?'':' disabled')+'>✦ Use suggestions</button><button type="button" class="secondary" data-act="clear-choices">Clear</button></div>':'')+'</div><p class="help">✦ marks a suggestion. Your choices are sent with or without a prompt.</p><div class="iw-controls">'+controlsPane(id)+'</div></section>'+
   '<section class="pdf-review-box" aria-labelledby="iw-prompt-heading"><div class="iw-head"><strong class="pdf-review-heading" id="iw-prompt-heading">AI Prompt</strong><span class="help">Optional</span></div><div class="iw-group"><span id="iw-refs-label">Refer to an image</span><div class="iw-options" role="group" aria-labelledby="iw-refs-label">'+ws.selected.map((s,i)=>'<button type="button" class="iw-chip" data-act="ref" data-index="'+i+'">Image '+(i+1)+'</button>').join('')+'</div></div>'+
   '<textarea data-input="enhPrompt" rows="5" maxlength="2000" aria-labelledby="iw-prompt-heading" placeholder="For example: make this character look younger, or draw a photo album cover using Image 1 as the background and the character from Image 2 signing.">'+esc(e.prompt)+'</textarea>'+
   '<div class="iw-sent" data-sent aria-live="polite">'+sent(id,number)+'</div><button type="button" data-act="enhance"'+(can?'':' disabled')+(busy['enhance:'+id]?' aria-busy="true"':'')+'>'+(busy['enhance:'+id]?spinner+' Generating…':e.drafts.length>=DRAFTS?'All 3 drafts made':'Generate Draft '+(e.drafts.length+1))+'</button></section>'+
   '</div></div>';
 }

 /* ---------- step 3: Publish Images ---------- */
 function publishStep(){
  if(ws.published)return '<section class="iw-published" role="status"><h2>'+ws.selected.length+(ws.selected.length===1?' image':' images')+' published to Image Library</h2><p class="help">You can pick them in step 1 next time.</p><div class="iw-row"><button type="button" class="secondary" data-act="open-library">Open Image Library</button><button type="button" class="secondary" data-act="again">Create more images</button></div></section>';
  if(!ws.selected.length)return '<p class="iw-blank help">Choose images in step 1 first.</p>';
  return '<div class="story-source-panel"><div class="iw-publish">'+ws.selected.map((id,i)=>'<figure>'+img(finalOf(id),'Image '+(i+1)+': '+title(id))+'<figcaption class="help">Image '+(i+1)+' · '+esc(title(finalOf(id)))+(ws.final[id]?' · enhanced':'')+'</figcaption></figure>').join('')+'</div></div>';
 }

 /* ---------- frame ---------- */
 function settingsBox(){
  if(!modelOpen)return '';
  const models=MODEL_CATEGORIES.images.models.filter(id=>MODEL_CATALOG[id]&&!MODEL_CATALOG[id].pending&&id!=='trellis-2'),model=imageModel(),s=modelSettings(model),gpus=computes(),gpu=computeId();
  return '<section class="iw-model-settings" id="iw-model" role="dialog" aria-labelledby="iw-model-heading"><div class="iw-head"><h2 id="iw-model-heading">Model settings</h2><button type="button" class="secondary" data-act="model" aria-label="Close model settings">×</button></div>'+
   '<label>Image model<select data-setting="model">'+models.map(id=>'<option value="'+id+'"'+(id===model?' selected':'')+'>'+esc(MODEL_CATALOG[id].name)+(id==='qwen-image-2512'?' (default)':'')+'</option>').join('')+'</select></label><p class="help">When an image is selected, '+esc(MODEL_CATALOG[EDIT_MODEL]?.name||'Qwen Image Edit')+' is used automatically.</p>'+
   '<label>Compute<select data-setting="compute"'+(gpus.length?'':' disabled')+'>'+(gpus.length?gpus.map(g=>'<option value="'+esc(g.id)+'"'+(g.id===gpu?' selected':'')+'>'+esc(g.name)+(g.id==='serverless'?' (default)':'')+'</option>').join(''):'<option>Connect Serverless or a GPU in Compute</option>')+'</select></label>'+
   '<div class="iw-pair iw-three"><label>Steps<input type="number" min="5" max="80" data-setting="steps" value="'+esc(s.steps)+'"></label><label>CFG<input type="number" min="1" max="15" step="0.5" data-setting="cfg" value="'+esc(s.cfg)+'"></label><label>Seed<input type="number" min="0" data-setting="seed" value="'+esc(s.seed)+'"></label></div>'+
   '<div class="iw-row iw-end"><button type="button" class="secondary" data-act="reset-model">Reset to defaults</button><button type="button" data-act="model">Done</button></div></section>';
 }
 function foot(){
  if(ws.step==='image')return '<div class="iw-foot"><span class="help">'+ws.selected.length+' selected. You can change them later.</span><button type="button" data-act="step" data-step="enhance"'+(ws.selected.length?'':' disabled')+'>Next: Enhance Image →</button></div>';
  if(ws.step==='enhance')return '<div class="iw-foot"><button type="button" class="secondary" data-act="step" data-step="image">← Back: Image</button><button type="button" data-act="step" data-step="publish">Next: Publish Images →</button></div>';
  return '<div class="iw-foot"><button type="button" class="secondary" data-act="step" data-step="enhance">← Back: Enhance Image</button>'+(ws.published?'':'<button type="button" data-act="publish"'+(ws.selected.length&&!busy.publish?'':' disabled')+(busy.publish?' aria-busy="true"':'')+'>'+(busy.publish?spinner+' Publishing…':'Publish')+'</button>')+'</div>';
 }
 function draw(){
  const root=q('#page');if(!root||page!=='images')return;load();tidy();
  const scroll=window.scrollY,focus=document.activeElement?.closest?.('#image-workspace')?(document.activeElement.dataset.input||document.activeElement.id):'';
  const steps=[['image','1. Image'],['enhance','2. Enhance Image'],['publish','3. Publish Images']];
  root.innerHTML='<div id="image-workspace" class="form"><div class="iw-steps" role="tablist" aria-label="Create images steps">'+steps.map(([id,label])=>tab('iw-step-'+id,label,ws.step===id,'step','data-step="'+id+'" aria-controls="iw-step-panel"')).join('')+'</div>'+
   '<section class="panel form story-editor-panel" id="iw-step-panel" role="tabpanel" aria-labelledby="iw-step-'+ws.step+'"><div class="iw-settings" role="group" aria-label="Model"><span class="iw-pill">Model <b>'+esc(modelName())+'</b></span><span class="iw-pill">Compute <b>'+esc(computeName())+'</b></span><button type="button" class="secondary" data-act="model" aria-expanded="'+modelOpen+'"'+(modelOpen?' aria-controls="iw-model"':'')+'>Model settings</button>'+settingsBox()+'</div>'+
   (ws.step==='image'?imageStep():ws.step==='enhance'?enhanceStep():publishStep())+'</section>'+foot()+'</div>';
  if(focus){const el=q('#image-workspace [data-input="'+focus+'"]')||q('#'+CSS.escape(focus));el?.focus();}
  window.scrollTo(0,scroll);
  if(typeof hydrateMedia==='function')hydrateMedia();
  if(ws.step==='enhance'&&ws.selected.length){const id=ws.selected[ws.enh],e=enh(id);if(!e.type&&!e.tried&&!busy['analyze:'+id])analyze(id);}
 }
 function analyze(id){
  const e=enh(id);e.tried=true;
  if(!window.EccoAI?.enabled){save();draw();return;}
  run('analyze:'+id,async()=>{
   try{
    const result=await api('ai/enhance',{stage:'image',mode:'generate',story_id:activeStory,reference_ids:[finalOf(id)],fields:[{id:'image_enhancement',text:JSON.stringify(M.catalog(styles())),max_length:12000}],context:{}});
    const analysis=M.parseAnalysis(result.revisions?.[0]?.text,styles());e.analysis=analysis;e.type=analysis.type;
   }catch(error){notice(error.message+' Choose what the image shows instead.',true);}
  });
 }

 /* ---------- actions ---------- */
 function select(id){
  const i=ws.selected.indexOf(id);
  if(i>=0){ws.selected.splice(i,1);ws.active=Math.min(ws.active,Math.max(0,ws.selected.length-1));}
  else if(ws.selected.length<LIMIT){ws.selected.push(id);ws.active=ws.selected.length-1;}
  else{notice('Select up to 3 images. Remove one first.',true);return;}
  ws.published=false;
 }
 function act(button){
  const a=button.dataset.act,id=ws.selected[ws.step==='enhance'?ws.enh:ws.active];
  if(a==='step'){ws.step=button.dataset.step;modelOpen=false;}
  else if(a==='src')ws.src=button.dataset.src;
  else if(a==='model')modelOpen=!modelOpen;
  else if(a==='reset-model'){delete modelProfiles.settings[imageModel()];modelProfiles.selected.images='qwen-image-2512';saveModelProfiles();if(computes().some(g=>g.id==='serverless'))localStorage.setItem('ecco-compute-image','serverless');}
  else if(a==='pick')select(button.dataset.id);
  else if(a==='show')ws.active=+button.dataset.index;
  else if(a==='remove'){const i=+button.dataset.index;ws.selected.splice(i,1);ws.active=Math.min(ws.active,Math.max(0,ws.selected.length-1));ws.enh=0;ws.published=false;}
  else if(a==='upload'){q('#image-workspace [data-upload-file]')?.click();return;}
  else if(a==='generate'){
   const prompt=ws.genPrompt.trim();if(!prompt)return;
   return run('generate',async()=>{const ids=await generate(prompt,ws.genStyle,ws.genShape);ws.generated=[...ids,...ws.generated];if(ws.selected.length<LIMIT&&!ws.selected.includes(ids[0])){ws.selected.push(ids[0]);ws.active=ws.selected.length-1;}});
  }
  else if(a==='improve'){
   const prompt=ws.aiPrompt.trim(),target=id;if(!target||!prompt)return;
   const d=ai(target);if(d.drafts.length>=DRAFTS){notice('All three drafts are in use. Clear the AI output, then try again.',true);return;}
   return run('improve',async()=>{const ids=await edit([target],prompt,'');d.drafts.push(ids[0]);d.index=d.drafts.length-1;});
  }
  else if(a==='ai-draft'){if(id)ai(id).index=+button.dataset.index;}
  else if(a==='use-ai'){const d=ai(id),draft=d.drafts[d.index];if(draft){ws.selected[ws.active]=draft;ws.published=false;}}
  else if(a==='clear-ai'){if(id)ws.ai[id]={drafts:[],index:0};}
  else if(a==='enh')ws.enh=+button.dataset.index;
  else if(a==='type'){const e=enh(id);e.type=button.dataset.type;e.choices={};}
  else if(a==='choose'){const e=enh(id),g=M.groups(e.type,styles()).find(x=>x.key===button.dataset.key);if(g)e.choices=M.toggle(e.choices,g,button.dataset.value);}
  else if(a==='suggest'){const e=enh(id);if(e.analysis)e.choices=JSON.parse(JSON.stringify(e.analysis.suggestions));}
  else if(a==='clear-choices')enh(id).choices={};
  else if(a==='ref'){const e=enh(id),label='Image '+(+button.dataset.index+1);e.prompt=(e.prompt&&!/\s$/.test(e.prompt)?e.prompt+' ':e.prompt)+label+' ';}
  else if(a==='compare')enh(id).compare=button.dataset.mode;
  else if(a==='enh-draft')enh(id).index=+button.dataset.index;
  else if(a==='use-draft'){const e=enh(id),draft=e.drafts[e.index];if(draft){ws.final[id]=draft;ws.published=false;e.compare='after';}}
  else if(a==='clear-drafts'){const e=enh(id);e.drafts=[];e.index=0;}
  else if(a==='enhance'){
   const e=enh(id),number=ws.enh+1,target=id;
   if(!e.type||!M.canGenerate(e.prompt,e.type,e.choices,styles()))return;
   const c=M.compose({number,type:e.type,prompt:e.prompt,choices:e.choices,styles:styles()});
   const others=M.referenced(e.prompt,ws.selected.length).filter(n=>n!==number).map(n=>finalOf(ws.selected[n-1]));
   const ids=[finalOf(target),...others].slice(0,LIMIT);
   return run('enhance:'+target,async()=>{const made=await edit(ids,c.prompt,c.style);e.drafts.push(made[0]);e.index=e.drafts.length-1;e.compare='after';});
  }
  else if(a==='publish')return run('publish',publish);
  else if(a==='open-library'){window.EccoLibraryHub?.open('image');return;}
  else if(a==='again'){ws=fresh();}
  save();draw();
 }
 async function publish(){
  const story=state.records.find(r=>r.kind==='story'&&r.id===activeStory),name=String(story?.title||'').replace(/\//g,'-').trim().slice(0,80);
  let folder=name?state.records.find(r=>r.kind==='image_folder'&&!r.deleted&&r.name===name):null;
  for(const id of ws.selected.map(finalOf)){
   const r=record(id);if(r&&r.stage!=='prod')await api('approve',{asset_id:id});
   if(name){if(!folder)folder=await api('library/folders',{name});if(folder&&!folder.deleted)await api('library/save',{asset_id:id,folder_id:folder.id});}
  }
  await refresh();ws.published=true;notice(ws.selected.length+(ws.selected.length===1?' image':' images')+' published to Image Library.');
 }
 function input(el){
  const k=el.dataset.input;
  if(k==='enhPrompt'){const id=ws.selected[ws.enh],e=enh(id);e.prompt=el.value;const box=q('#image-workspace [data-sent]');if(box)box.innerHTML=sent(id,ws.enh+1);const b=q('#image-workspace [data-act=enhance]');if(b&&!busy['enhance:'+id])b.disabled=!(e.type&&M.canGenerate(e.prompt,e.type,e.choices,styles())&&e.drafts.length<DRAFTS);save();return;}
  ws[k]=el.value;save();
  if(k==='genPrompt'&&!busy.generate){const b=q('#image-workspace [data-act=generate]');if(b)b.disabled=!el.value.trim();}
  if(k==='aiPrompt'&&!busy.improve){const b=q('#image-workspace [data-act=improve]');if(b)b.disabled=!ws.selected.length||!el.value.trim();}
  if(k==='search'||k==='label')draw();
 }
 function setting(el){
  const k=el.dataset.setting,model=imageModel();
  if(k==='model'){modelProfiles.selected.images=el.value;saveModelProfiles();}
  else if(k==='compute'){localStorage.setItem('ecco-compute-image',el.value);}
  else{const n=Number(el.value);if(Number.isFinite(n)){modelProfiles.settings[model]={...modelProfiles.settings[model],[k]:n};saveModelProfiles();}}
  draw();
 }
 async function upload(file){
  if(!file)return;
  if(!/^image\/(png|jpeg|webp)$/.test(file.type)){notice('Choose a PNG, JPG or WebP image.',true);return;}
  await run('upload',async()=>{
   const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('The image could not be read.'));r.readAsDataURL(file);});
   const made=await api('images/upload',{name:file.name,data,story_id:activeStory});await refresh();
   if(!state.records.some(r=>r.id===made.id))state.records.push(made);
   if(ws.selected.length<LIMIT){ws.selected.push(made.id);ws.active=ws.selected.length-1;}else notice('Uploaded. Selected Images already has 3; remove one to use it.',true);
  });
 }

 /* ---------- wiring ---------- */
 document.addEventListener('click',e=>{const b=e.target.closest?.('#image-workspace [data-act]');if(b&&!b.disabled){e.preventDefault();act(b);}});
 document.addEventListener('input',e=>{if(e.target.closest?.('#image-workspace')&&e.target.dataset.input&&e.target.tagName!=='SELECT')input(e.target);});
 document.addEventListener('change',e=>{
  if(!e.target.closest?.('#image-workspace'))return;
  if(e.target.matches('[data-upload-file]')){upload(e.target.files[0]);e.target.value='';}
  else if(e.target.dataset.setting)setting(e.target);
  else if(e.target.tagName==='SELECT'&&e.target.dataset.input)input(e.target);
 });
 document.addEventListener('keydown',e=>{
  const t=e.target.closest?.('#image-workspace [role=tab]');if(!t||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  const tabs=all('[role=tab]',t.parentElement),i=tabs.indexOf(t),n=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  e.preventDefault();tabs[n].click();const label=tabs[n].id;requestAnimationFrame(()=>q('#'+CSS.escape(label))?.focus());
 });
 document.addEventListener('ecco:gpu-connection-change',()=>{if(page==='images'&&q('#image-workspace'))draw();});
 const storyMode=()=>window.EccoStoryWorkspace?.active||document.body.classList.contains('story-simple-mode');
 // The new screen opens from the Create Images entry points: the left-nav step, the Story home list and
 // the journey guide's Back/Next. Other flows that open the image page (refine an image, instruction
 // edits, uploads, character handoff) keep the existing image form they fill in.
 let entry=0,open=false;
 const ENTRY='#workspace-production-group [data-page="images"],nav [data-page="images"],#story-home-list [data-story-destination="images"],#journey-guide [data-back],#journey-guide [data-next]';
 document.addEventListener('click',e=>{if(e.target.closest?.(ENTRY))entry=Date.now();},true);
 const previous=imagePage,navigateBefore=navigate;
 navigate=function(target){if(target!=='images'){open=false;entry=0;}return navigateBefore.apply(this,arguments);};
 imagePage=function(){
  const asked=Date.now()-entry<5000;entry=0;
  if(asked)open=true;
  if(storyMode()||!window.EccoImageWorkspaceModel||!open||refinementSource){open=false;return previous.apply(this,arguments);}
  if(!state.storage_pending&&!stories().length){$('#page').innerHTML=empty('Start a new story','Choose + New story in the sidebar, or restore a story from Trash.');return;}
  draw();
 };
 window.EccoImageWorkspace={draw,get state(){return ws;}};
})();
