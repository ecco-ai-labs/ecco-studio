'use strict';
(() => {
 const q=s=>document.querySelector(s);
 const paragraphs=text=>String(text||'').replace(/\r\n?/g,'\n').split(/\n\s*\n/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
 function sceneTexts(text){
  const result=[];
  for(const paragraph of paragraphs(text)){
   let rest=paragraph;
   while(rest.length>3500){let cut=rest.lastIndexOf(' ',3500);if(cut<1)cut=3500;result.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();}
   if(rest)result.push(rest);
  }
  if(!result.length)throw Error('Add story text before splitting scenes.');
  if(result.length>60)throw Error('This story needs '+result.length+' scenes. The current editor supports 60; divide it into chapters first. Nothing was replaced.');
  return result;
 }
 function persistSource(form){
  const text=form.elements.sourceText?.value;
  if(text)localStorage.setItem('ecco-story-source:'+activeStory,text);
 }
 function mountPDF(){
  const form=q('#story-setup-form');if(!form||q('#story-pdf-tools'))return;
  let saved={};try{saved=JSON.parse(localStorage.getItem(form.dataset.draftKey||'ecco-new-story-draft')||'{}');}catch{}
  const box=document.createElement('section');box.id='story-pdf-tools';box.className='pdf-import-tools';
  box.innerHTML='<div class="row"><button type="button" class="secondary" data-upload>Upload PDF</button><button type="button" class="secondary" data-preview disabled>Preview & Select</button><span data-file-wrap hidden><button type="button" class="secondary" data-remove aria-label="Remove uploaded PDF" title="Remove uploaded PDF" style="padding:2px 6px!important;min-height:24px!important">×</button> <span data-filename></span></span></div><input type="file" accept=".pdf,application/pdf" hidden><p role="status"></p><details><summary>Extracted story text</summary><label>Source text<textarea name="sourceText" rows="5"></textarea></label><p class="help">Full source stays in this browser; only the 4,000-character summary currently syncs to storage. Keep the original PDF.</p></details>';
  form.prepend(box);const input=box.querySelector('input'),status=box.querySelector('[role=status]'),source=box.querySelector('textarea'),open=box.querySelector('[data-preview]');
  source.value=saved.sourceText||'';
  const panel=document.createElement('div');panel.id='story-entry-panel';panel.setAttribute('role','group');panel.setAttribute('aria-label','Story creation options');
  panel.innerHTML='<details class="workspace-menu"><summary>Upload<span aria-hidden="true">⌄</span></summary><div class="workspace-menu-items"></div></details><button type="button" class="secondary" data-story-manual aria-pressed="true">Manual</button>';
  form.before(panel);
  const menu=panel.querySelector('details'),items=panel.querySelector('.workspace-menu-items'),row=box.querySelector('.row');items.append(row);
  box.hidden=true;
  const mode=value=>{panel.dataset.mode=value;panel.querySelector('[data-story-manual]').setAttribute('aria-pressed',String(value==='manual'));box.hidden=value!=='upload';};
  mode('manual');
  panel.querySelector('[data-upload]').onclick=()=>{mode('upload');menu.open=false;input.click();};
  panel.querySelector('[data-preview]').addEventListener('click',()=>{mode('upload');menu.open=false;});
  panel.querySelector('[data-story-manual]').onclick=()=>{mode('manual');menu.open=false;form.elements.summary.focus();};
  let task=null,doc=null,pdfjs=null,pageNumber=1,highlight='',busy=false,observer=null,epoch=0;
  let shells=[],renderQueue=[],rendering=0;
  const dialog=document.createElement('dialog');dialog.className='pdf-story-dialog';dialog.setAttribute('aria-label','Select story from PDF');
  dialog.innerHTML='<div class="pdf-dialog-head"><strong>Select story from PDF</strong><button type="button" class="secondary" data-close>Close</button></div><div class="pdf-page-scroll"></div><label class="pdf-selected-label">Selected story text<textarea data-selected rows="3" placeholder="Highlight text in the PDF to review it here."></textarea></label><div class="row"><button type="button" data-extract disabled>Extract selected text as story</button><span role="status"></span></div>';
  document.body.append(dialog);
  const selected=dialog.querySelector('[data-selected]'),extract=dialog.querySelector('[data-extract]'),note=dialog.querySelector('[role=status]');
  const controls=()=>{extract.disabled=!selected.value.trim()||busy;};
  selected.oninput=controls;
  const capture=()=>{const selection=window.getSelection(),layer=dialog.querySelector('.pdf-page-scroll');highlight=selection&&selection.rangeCount&&layer.contains(selection.anchorNode)&&layer.contains(selection.focusNode)?selection.toString().trim():'';if(highlight)selected.value=highlight;controls();};
  dialog.querySelector('.pdf-page-scroll').addEventListener('mouseup',capture);
  dialog.querySelector('.pdf-page-scroll').addEventListener('keyup',capture);
  const scroll=dialog.querySelector('.pdf-page-scroll');
  async function renderPage(shell, generation){
   if(generation!==epoch||shell.dataset.rendered)return;
   const currentDoc=doc;
   try{
    const page=await currentDoc.getPage(+shell.dataset.page);
    if(generation!==epoch)return;
    const base=page.getViewport({scale:1}),scale=Math.min(1.5,760/base.width),viewport=page.getViewport({scale});
    const canvas=shell.querySelector('canvas'),layer=shell.querySelector('.textLayer');
    shell.style.width=viewport.width+'px';shell.style.height=viewport.height+'px';shell.style.setProperty('--scale-factor',scale);shell.style.setProperty('--total-scale-factor',scale);shell.style.setProperty('--user-unit',1);
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    if(generation!==epoch)return;
    const content=await page.getTextContent();
    if(generation!==epoch)return;
    await new pdfjs.TextLayer({textContentSource:content,container:layer,viewport}).render();
    shell.dataset.rendered='true';shell.removeAttribute('aria-busy');
   }catch(error){if(generation===epoch){shell.removeAttribute('aria-busy');window.EccoErrors?.show('Could not preview page '+shell.dataset.page+': '+error.message);}}
  }
  function pump(){
   while(rendering<2&&renderQueue.length){
    const {shell,generation}=renderQueue.shift();rendering++;
    renderPage(shell,generation).finally(()=>{rendering--;pump();});
   }
  }
  function enqueue(shell){
   if(!shell||shell.dataset.queued||shell.dataset.rendered)return;
   shell.dataset.queued='true';renderQueue.push({shell,generation:epoch});pump();
  }
  const draw=()=>{
   const shell=shells[pageNumber-1];if(!shell)return;
   enqueue(shell);enqueue(shells[pageNumber]);enqueue(shells[pageNumber-2]);
   scroll.scrollTo({top:shell.offsetTop-scroll.offsetTop,behavior:'instant'});
   controls();
  };
  async function preparePages(){
   const generation=epoch,first=await doc.getPage(1);
   if(generation!==epoch)return;
   const base=first.getViewport({scale:1}),viewport=first.getViewport({scale:Math.min(1.5,760/base.width)});
   scroll.replaceChildren();shells=[];
   const fragment=document.createDocumentFragment();
   for(let n=1;n<=doc.numPages;n++){
    const shell=document.createElement('div');shell.className='pdf-story-page';shell.dataset.page=n;
    shell.setAttribute('aria-label','Page '+n);shell.setAttribute('aria-busy','true');
    shell.style.cssText='width:'+viewport.width+'px;height:'+viewport.height+'px;margin:0 auto 16px';
    shell.innerHTML='<canvas></canvas><div class="textLayer"></div>';shells.push(shell);fragment.append(shell);
   }
   scroll.append(fragment);
   observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)enqueue(entry.target);},{root:scroll,rootMargin:'150% 0px'});
   shells.forEach(shell=>observer.observe(shell));draw();
  }
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  open.onclick=()=>{dialog.showModal();draw();};
  panel.querySelector('[data-remove]').onclick=async()=>{
   epoch++;observer?.disconnect();renderQueue=[];shells=[];highlight='';selected.value='';note.textContent='';status.textContent='';
   dialog.close();scroll.replaceChildren();open.disabled=true;input.value='';panel.querySelector('[data-filename]').textContent='';panel.querySelector('[data-file-wrap]').hidden=true;
   const previous=task;task=null;doc=null;controls();if(previous)await previous.destroy().catch(()=>{});
  };
  input.onchange=async()=>{
   const file=input.files[0];if(!file)return;open.disabled=true;
   try{
    status.textContent='Opening PDF…';epoch++;observer?.disconnect();renderQueue=[];highlight='';note.textContent='';
    if(task)await task.destroy().catch(()=>{});
    pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs';
    if(!q('#pdf-story-reader-style')){const link=document.createElement('link');link.id='pdf-story-reader-style';link.rel='stylesheet';link.href='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/web/pdf_viewer.css';document.head.append(link);}
    task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,stopAtErrors:true});doc=await task.promise;
    pageNumber=1;selected.value='';
    panel.querySelector('[data-filename]').textContent=file.name;panel.querySelector('[data-file-wrap]').hidden=false;
    open.disabled=false;status.textContent='';dialog.showModal();await preparePages();
   }catch(error){window.EccoErrors?.show(error);status.textContent=error.name==='PasswordException'?'Upload an unlocked PDF.':'Could not open PDF: '+error.message;}
  };
  extract.onclick=async()=>{
   const text=selected.value.trim();if(!text){note.textContent='Select story text to extract.';return;}
   if((form.elements.summary.value.trim()||source.value.trim())&&!confirm('Replace the current summary and source with your selected passage?'))return;
   const metadata=await doc.getMetadata().catch(()=>null),title=metadata?.info?.Title,file=input.files[0];
   if(!form.elements.title.value.trim())form.elements.title.value=(title&&title!=='Untitled'?title:file.name.replace(/\.pdf$/i,'').replace(/[_-]/g,' ')).slice(0,160);
   source.value=text;form.elements.summary.value=text.length<=4000?text:text.slice(0,3997)+'…';source.dispatchEvent(new Event('input',{bubbles:true}));
   box.querySelector('details').open=true;status.textContent=text.length+' characters extracted from your selection.'+(text.length>4000?' Summary contains an excerpt; the full selection is in Source text.':'')+' Review, then save to continue.';
   dialog.close();form.requestSubmit();
  };
 }
 function mountBoard(){
  const title=q('#board-title');if(!title||q('#source-story-picker'))return;
  const area=document.createElement('div');area.className='row';area.innerHTML='<label>Story<select id="source-story-picker"></select></label>';
  title.closest('label').before(area);
  const picker=area.querySelector('select');
  for(const story of stories()){const o=document.createElement('option');o.value=story.id;o.textContent=story.title;o.selected=story.id===activeStory;picker.append(o);}
  picker.onchange=()=>{persistDraft();activeStory=picker.value;localStorage.setItem('ecco-active-story',activeStory);draft=loadDraft();const source=localStorage.getItem('ecco-story-source:'+activeStory);if(source&&!draft.story)draft.story=source;storyControls();navigate('board');};

 }
 function mountImage(){
  const form=q('#image-form');if(!form||q('#scene-image-source')||!draft.scenes?.length)return;
  const area=document.createElement('div');area.id='scene-image-source';area.className='row';const select=document.createElement('select');select.setAttribute('aria-label','Storyboard scene for image');
  draft.scenes.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent='Scene '+(i+1)+' · '+s.narration.slice(0,65);select.append(o);});
  const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent='Use scene for image prompt';
  b.onclick=()=>{const scene=draft.scenes[+select.value],field=form.elements.prompt;if(field.value.trim()&&!confirm('Replace the current image prompt with this scene?'))return;
   field.value=[draft.title,'Scene: '+scene.narration,scene.motion,scene.shot_size,scene.camera_angle,scene.camera_move].filter(Boolean).join('\n');field.dispatchEvent(new Event('input',{bubbles:true}));notice('Scene prompt loaded. Choose the model, reference and style, then Generate. Approve and assign the result in the storyboard.');
  };area.append(select,b);form.prepend(area);
 }
 function mountAudio(){
  const form=q('#audio-form');if(!form||q('#scene-audio-source')||!draft.scenes?.length)return;
  const area=document.createElement('div');area.id='scene-audio-source';area.className='row';const select=document.createElement('select');select.setAttribute('aria-label','Storyboard scene for audio');
  draft.scenes.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent='Scene '+(i+1)+' · '+s.narration.slice(0,65);select.append(o);});
  const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent='Use scene narration';
  b.onclick=()=>{let text=draft.scenes[+select.value].narration,parts=[];while(text.length>500){let cut=text.lastIndexOf(' ',500);if(cut<1)cut=500;parts.push(text.slice(0,cut));text=text.slice(cut).trim();}if(text)parts.push(text);
   const existing=[...q('#audio-lines').querySelectorAll('textarea')];if(existing.some(x=>x.value.trim())){notice('This audio draft already has text. Clear it or save it before importing a scene.',true);return;}
   if(parts.length>20){notice('Use a shorter narration segment: the audio editor supports 20 lines of 500 characters.',true);return;}
   while(q('#audio-lines').querySelectorAll('textarea').length<parts.length)q('#add-audio-line').click();
   [...q('#audio-lines').querySelectorAll('textarea')].forEach((field,i)=>{field.value=parts[i]||'';field.dispatchEvent(new Event('input',{bubbles:true}));});
   form.elements.title.value=draft.title+' · Scene '+(+select.value+1);form.elements.title.dispatchEvent(new Event('input',{bubbles:true}));notice('Narration loaded. Review speaker, language and emotion for each line. Audio generation requires the audio service.');
  };area.append(select,b);form.prepend(area);
 }
 function mount(){mountPDF();mountBoard();mountImage();mountAudio();}
 new MutationObserver(mount).observe(q('#page'),{childList:true,subtree:true});mount();
})();
