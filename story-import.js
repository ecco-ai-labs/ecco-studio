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
  box.innerHTML='<div class="row"><button type="button" class="secondary" data-upload>Upload PDF</button><button type="button" class="secondary" data-preview disabled>Preview & select</button><span data-filename></span></div><input type="file" accept=".pdf,application/pdf" hidden><p role="status"></p><details><summary>Extracted story text</summary><label>Source text<textarea name="sourceText" rows="5" maxlength="60000"></textarea></label><p class="help">Full source stays in this browser; only the 4,000-character summary currently syncs to storage. Keep the original PDF.</p></details>';
  form.prepend(box);const input=box.querySelector('input'),status=box.querySelector('[role=status]'),source=box.querySelector('textarea'),open=box.querySelector('[data-preview]');
  source.value=saved.sourceText||'';
  box.querySelector('[data-upload]').onclick=()=>input.click();
  let task=null,doc=null,pdfjs=null,pageNumber=1,highlight='',busy=false;
  const dialog=document.createElement('dialog');dialog.className='pdf-story-dialog';dialog.setAttribute('aria-label','Select story from PDF');
  dialog.innerHTML='<div class="pdf-dialog-head"><strong>Select story from PDF</strong><button type="button" class="secondary" data-close>Close</button></div><div class="row pdf-page-controls"><button type="button" class="secondary" data-prev>Previous</button><label>Page <select data-page aria-label="PDF page"></select></label><span data-total></span><button type="button" class="secondary" data-next>Next</button><button type="button" class="secondary" data-add disabled>Add highlighted text</button></div><p class="help">Drag across the PDF text to highlight a passage. Add passages from other pages if needed, then extract your selection.</p><div class="pdf-page-scroll"><div class="pdf-story-page"><canvas></canvas><div class="textLayer"></div></div></div><label class="pdf-selected-label">Selected story text<textarea data-selected rows="3" maxlength="60000" placeholder="Highlight a passage above, then Add highlighted text."></textarea></label><div class="row"><button type="button" data-extract disabled>Extract selected text as story</button><span role="status"></span></div>';
  document.body.append(dialog);
  const selected=dialog.querySelector('[data-selected]'),extract=dialog.querySelector('[data-extract]'),note=dialog.querySelector('[role=status]'),add=dialog.querySelector('[data-add]'),pageSelect=dialog.querySelector('[data-page]');
  const controls=()=>{extract.disabled=!selected.value.trim()||busy;add.disabled=!highlight.trim()||busy;dialog.querySelector('[data-prev]').disabled=busy||pageNumber<=1;dialog.querySelector('[data-next]').disabled=busy||!doc||pageNumber>=doc.numPages;pageSelect.disabled=busy;};
  selected.oninput=controls;
  const capture=()=>{const selection=window.getSelection(),layer=dialog.querySelector('.textLayer');highlight=selection&&selection.rangeCount&&layer.contains(selection.anchorNode)&&layer.contains(selection.focusNode)?selection.toString().trim():'';controls();};
  dialog.querySelector('.pdf-page-scroll').addEventListener('mouseup',capture);
  dialog.querySelector('.pdf-page-scroll').addEventListener('keyup',capture);
  const draw=async()=>{
   if(!doc||busy)return;busy=true;highlight='';controls();note.textContent='Loading page '+pageNumber+'…';
   try{
    const page=await doc.getPage(pageNumber),base=page.getViewport({scale:1}),scale=Math.min(1.5,760/base.width),viewport=page.getViewport({scale});
    const shell=dialog.querySelector('.pdf-story-page'),canvas=shell.querySelector('canvas'),layer=shell.querySelector('.textLayer');
    shell.style.width=viewport.width+'px';shell.style.height=viewport.height+'px';shell.style.setProperty('--scale-factor',scale);shell.style.setProperty('--total-scale-factor',scale);shell.style.setProperty('--user-unit',1);
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);layer.replaceChildren();
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    const content=await page.getTextContent();
    await new pdfjs.TextLayer({textContentSource:content,container:layer,viewport}).render();
    note.textContent=content.items.some(i=>i.str?.trim())?'Highlight the text you want to use.':'No selectable text on this page. A scanned PDF needs OCR first.';
    pageSelect.value=String(pageNumber);
   }catch(error){note.textContent='Could not preview this page: '+error.message;}
   finally{busy=false;controls();}
  };
  dialog.querySelector('[data-prev]').onclick=()=>{if(pageNumber>1){pageNumber--;draw();}};
  dialog.querySelector('[data-next]').onclick=()=>{if(doc&&pageNumber<doc.numPages){pageNumber++;draw();}};
  pageSelect.onchange=()=>{pageNumber=+pageSelect.value;draw();};
  add.onclick=()=>{if(!highlight)return;const text=[selected.value.trim(),highlight].filter(Boolean).join('\n\n');if(text.length>60000){note.textContent='Select up to 60,000 characters per chapter.';return;}selected.value=text;highlight='';controls();note.textContent=selected.value.length+' characters selected.';};
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  open.onclick=()=>{dialog.showModal();draw();};
  input.onchange=async()=>{
   const file=input.files[0];if(!file)return;open.disabled=true;
   try{
    if(file.size>20*1024*1024)throw Error('Choose a PDF smaller than 20 MB.');
    status.textContent='Opening PDF…';
    if(task)await task.destroy().catch(()=>{});
    pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs';
    if(!q('#pdf-story-reader-style')){const link=document.createElement('link');link.id='pdf-story-reader-style';link.rel='stylesheet';link.href='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/web/pdf_viewer.css';document.head.append(link);}
    task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,stopAtErrors:true});doc=await task.promise;
    if(doc.numPages>100)throw Error('Use a chapter of 100 pages or fewer.');
    pageNumber=1;selected.value='';pageSelect.replaceChildren();for(let n=1;n<=doc.numPages;n++){const option=document.createElement('option');option.value=n;option.textContent=n;pageSelect.append(option);}
    dialog.querySelector('[data-total]').textContent='of '+doc.numPages;box.querySelector('[data-filename]').textContent=file.name;
    open.disabled=false;status.textContent='PDF ready. Select a passage to create your story.';dialog.showModal();await draw();
   }catch(error){status.textContent=error.name==='PasswordException'?'Upload an unlocked PDF.':'Could not open PDF: '+error.message;}
  };
  extract.onclick=async()=>{
   const text=selected.value.trim();if(!text||text.length>60000){note.textContent='Choose 1–60,000 characters.';return;}
   if((form.elements.summary.value.trim()||source.value.trim())&&!confirm('Replace the current summary and source with your selected passage?'))return;
   const metadata=await doc.getMetadata().catch(()=>null),title=metadata?.info?.Title,file=input.files[0];
   if(!form.elements.title.value.trim())form.elements.title.value=(title&&title!=='Untitled'?title:file.name.replace(/\.pdf$/i,'').replace(/[_-]/g,' ')).slice(0,160);
   source.value=text;form.elements.summary.value=text.length<=4000?text:text.slice(0,3997)+'…';source.dispatchEvent(new Event('input',{bubbles:true}));
   box.querySelector('details').open=true;status.textContent=text.length+' characters extracted from your selection.'+(text.length>4000?' Summary contains an excerpt; the full selection is in Source text.':'')+' Review, then save to continue.';
   dialog.close();
  };
 }
 function mountBoard(){
  const title=q('#board-title');if(!title||q('#source-story-picker'))return;
  const area=document.createElement('div');area.className='row';area.innerHTML='<label>Story<select id="source-story-picker"></select></label><button type="button" class="secondary" id="source-ai-plan">AI storyboard & shot previews</button>';
  title.closest('label').before(area);
  const picker=area.querySelector('select');
  for(const story of stories()){const o=document.createElement('option');o.value=story.id;o.textContent=story.title;o.selected=story.id===activeStory;picker.append(o);}
  picker.onchange=()=>{persistDraft();activeStory=picker.value;localStorage.setItem('ecco-active-story',activeStory);draft=loadDraft();const source=localStorage.getItem('ecco-story-source:'+activeStory);if(source&&!draft.story)draft.story=source;storyControls();navigate('board');};
  area.querySelector('button').onclick=()=>{persistDraft();if(draft.story.length>12000){notice('The AI planner supports 12,000 characters and up to 10 shots. Use one chapter or a shorter adaptation.',true);return;}
   navigate('director');const form=q('#director-form');if(form){form.elements.title.value=draft.title;form.elements.story.value=draft.story;form.dispatchEvent(new Event('input',{bubbles:true}));}
  };
  const split=q('#split');if(split)split.onclick=()=>{
   try{const parts=sceneTexts(draft.story);if(draft.scenes.length&&!confirm('Replace the current scene draft? Saved revisions are preserved.'))return;
    draft.scenes=parts.map(text=>({image_id:'',seconds:3,motion:'Slow cinematic camera movement, consistent character and lighting',narration:text}));
    persistDraft();renderScenes();notice(parts.length+' editable scenes created from paragraphs. Review timing, dialogue and camera directions; this split does not call AI.');
   }catch(error){notice(error.message,true);}
  };
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
