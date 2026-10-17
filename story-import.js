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
  const box=document.createElement('section');box.id='story-pdf-tools';box.className='panel form';
  box.innerHTML='<h3>Start from a PDF</h3><div class="row"><button type="button" class="secondary" data-upload>Upload PDF</button><button type="button" class="secondary" data-extract disabled>Extract story</button></div><input type="file" accept=".pdf,application/pdf" hidden><p role="status"></p><p class="help">Text PDFs · up to 20 MB / 100 pages. Read locally in your browser; scanned pages need OCR and are not supported yet.</p><details><summary>Review full extracted story</summary><label>Source text<textarea name="sourceText" rows="12" maxlength="60000"></textarea></label><p class="help">The summary is limited to 4,000 characters. Full source text is retained in this browser for storyboard editing; it is not yet synced to workspace storage. Keep your original PDF.</p></details>';
  form.prepend(box);const input=box.querySelector('input'),status=box.querySelector('[role=status]'),extract=box.querySelector('[data-extract]'),source=box.querySelector('textarea');
  source.value=saved.sourceText||'';
  box.querySelector('[data-upload]').onclick=()=>input.click();
  input.onchange=()=>{extract.disabled=!input.files.length;status.textContent=input.files[0]?.name||'';};
  extract.onclick=async()=>{
   const file=input.files[0];if(!file)return;
   if((form.elements.summary.value.trim()||source.value.trim())&&!confirm('Replace the current summary and extracted source with this PDF?'))return;
   extract.disabled=true;let task;
   try{
    if(file.size>20*1024*1024)throw Error('Choose a PDF smaller than 20 MB.');
    status.textContent='Loading PDF reader…';
    const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs';
    task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,stopAtErrors:true});
    const doc=await task.promise;if(doc.numPages>100)throw Error('Choose a chapter of 100 pages or fewer.');
    const pages=[];let total=0;
    for(let n=1;n<=doc.numPages;n++){
     status.textContent='Extracting page '+n+' of '+doc.numPages+'…';
     const page=await doc.getPage(n),content=await page.getTextContent();let lines=[],line='',lastY=null,lastH=0;
     for(const item of content.items){if(!('str' in item))continue;const y=item.transform?.[5],h=Math.abs(item.height||12);
      if(lastY!==null&&y!==undefined&&Math.abs(y-lastY)>Math.max(2,h*.4)){if(line.trim())lines.push(line.trim());if(Math.abs(y-lastY)>Math.max(h,lastH)*1.7)lines.push('');line='';}
      line+=(line?' ':'')+item.str;lastY=y;lastH=h;
      if(item.hasEOL){if(line.trim())lines.push(line.trim());line='';}
     }
     if(line.trim())lines.push(line.trim());const text=lines.join('\n').trim();total+=text.length;
     if(total>60000)throw Error('This PDF exceeds 60,000 characters. Import a chapter at a time; no text was replaced.');
     if(!text)throw Error('Page '+n+' has no extractable text. Use a text PDF or run OCR first; partial imports are not applied.');
     pages.push(text);page.cleanup();
    }
    const text=pages.join('\n\n');if(!text.trim())throw Error('No text found. This PDF may need OCR.');
    const metadata=await doc.getMetadata().catch(()=>null),title=metadata?.info?.Title;
    if(!form.elements.title.value.trim())form.elements.title.value=(title&&title!=='Untitled'?title:file.name.replace(/\.pdf$/i,'').replace(/[_-]/g,' ')).slice(0,160);
    source.value=text;
    form.elements.summary.value=text.length<=4000?text:text.slice(0,3997)+'…';
    source.dispatchEvent(new Event('input',{bubbles:true}));
    box.querySelector('details').open=true;
    status.textContent=doc.numPages+' pages extracted. Review the title and summary'+(text.length>4000?' (an excerpt, not an AI summary)':'')+', then Save & continue to storyboard.';
   }catch(error){status.textContent=error.name==='PasswordException'?'This PDF is password protected. Upload an unlocked copy.':'Could not extract story: '+error.message;}
   finally{if(task)await task.destroy().catch(()=>{});extract.disabled=false;}
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
