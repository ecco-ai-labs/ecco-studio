'use strict';
/* Shared local-only document preview. Only an explicit selection leaves this component. */
(()=>{
 function create({onApply,title='Select story from PDF',selectedLabel='Selected story text',applyLabel='Extract selected text as story',maxSelection=Infinity}){
  const dialog=document.createElement('dialog');dialog.className='pdf-story-dialog';dialog.setAttribute('aria-label',title);
  dialog.innerHTML='<div class="pdf-dialog-head"><strong></strong><button type="button" class="secondary" data-close>Close</button></div><div data-document-selection class="form" hidden><div class="generation-filter-row"><label>PDF Pages<input data-pages placeholder="e.g. 10–12, 15"></label><button type="button" class="secondary" data-select-pages>Select Pages</button></div><div class="generation-filter-row"><label>Chapter<input data-chapter maxlength="160" placeholder="e.g. Chapter 1, or its title"></label><button type="button" class="secondary" data-find-chapter>Find Chapter with AI</button></div><p class="help">Page numbers refer to PDF pages. Review the selected text before Apply.</p></div><div class="pdf-page-scroll" tabindex="0" aria-label="Document preview"></div><label class="pdf-selected-label"><span></span><textarea data-selected rows="3" placeholder="Highlight text in the document to review it here."></textarea></label><div class="row"><button type="button" data-extract disabled></button><span role="status" aria-live="polite"></span></div>';
  dialog.querySelector('strong').textContent=title;dialog.querySelector('.pdf-selected-label span').textContent=selectedLabel;dialog.querySelector('[data-extract]').textContent=applyLabel;
  document.body.append(dialog);
  const scroll=dialog.querySelector('.pdf-page-scroll'),selected=dialog.querySelector('[data-selected]'),extract=dialog.querySelector('[data-extract]'),note=dialog.querySelector('[role=status]');
  let task=null,doc=null,pdfjs=null,file=null,metadataTitle='',ready=false,busy=false,disposed=false,epoch=0,opener=null,observer=null,shells=[],renderQueue=[],rendering=0,selectionMeta={},pageText=null,selectionEpoch=0;
  const controls=()=>{dialog.querySelectorAll('[data-document-selection] input,[data-document-selection] button').forEach(el=>el.disabled=busy||!ready);extract.disabled=!ready||busy||!selected.value.trim()||selected.value.trim().length>maxSelection;};
  const reportSelection=()=>{const count=selected.value.trim().length;note.textContent=count>maxSelection?'Select at most '+maxSelection.toLocaleString()+' characters. Your selection has '+count.toLocaleString()+'.':count?count.toLocaleString()+' characters selected. Only this text will be used.':'';controls();};
  selected.oninput=()=>{selectionMeta={};selectionEpoch++;reportSelection();};
  const capture=()=>{const selection=window.getSelection();if(selection?.rangeCount&&scroll.contains(selection.anchorNode)&&scroll.contains(selection.focusNode)){const text=selection.toString().trim();if(text){selected.value=text;selectionMeta={};selectionEpoch++;}}reportSelection();};
  scroll.addEventListener('mouseup',capture);scroll.addEventListener('keyup',capture);
  async function renderPage(shell,generation){
   if(generation!==epoch||shell.dataset.rendered)return;const currentDoc=doc;
   try{
    const page=await currentDoc.getPage(+shell.dataset.page);if(generation!==epoch)return;
    const base=page.getViewport({scale:1}),scale=Math.min(1.5,760/base.width),viewport=page.getViewport({scale});
    const canvas=shell.querySelector('canvas'),layer=shell.querySelector('.textLayer');
    shell.style.width=viewport.width+'px';shell.style.height=viewport.height+'px';shell.style.setProperty('--scale-factor',scale);shell.style.setProperty('--total-scale-factor',scale);shell.style.setProperty('--user-unit',1);
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;if(generation!==epoch)return;
    const content=await page.getTextContent();if(generation!==epoch)return;
    await new pdfjs.TextLayer({textContentSource:content,container:layer,viewport}).render();if(generation!==epoch)return;
    shell.dataset.rendered='true';shell.removeAttribute('aria-busy');
   }catch(error){if(generation===epoch){shell.removeAttribute('aria-busy');note.textContent='Could not preview page '+shell.dataset.page+': '+error.message;}}
  }
  function pump(){while(rendering<2&&renderQueue.length){const {shell,generation}=renderQueue.shift();rendering++;renderPage(shell,generation).finally(()=>{rendering--;pump();});}}
  function enqueue(shell){if(!shell||shell.dataset.queued||shell.dataset.rendered)return;shell.dataset.queued='true';renderQueue.push({shell,generation:epoch});pump();}
  async function preparePages(generation){
   const first=await doc.getPage(1);if(generation!==epoch)return;
   const base=first.getViewport({scale:1}),viewport=first.getViewport({scale:Math.min(1.5,760/base.width)}),fragment=document.createDocumentFragment();
   for(let n=1;n<=doc.numPages;n++){
    const shell=document.createElement('div');shell.className='pdf-story-page';shell.dataset.page=n;shell.setAttribute('aria-label','Page '+n);shell.setAttribute('aria-busy','true');
    shell.style.cssText='width:'+viewport.width+'px;height:'+viewport.height+'px;margin:0 auto 16px';shell.innerHTML='<canvas></canvas><div class="textLayer"></div>';shells.push(shell);fragment.append(shell);
   }
   scroll.append(fragment);
   observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)enqueue(entry.target);},{root:scroll,rootMargin:'150% 0px'});
   shells.forEach(shell=>observer.observe(shell));enqueue(shells[0]);enqueue(shells[1]);
  }
  function open(from){if(disposed)return;opener=from||document.activeElement;if(!dialog.open)dialog.showModal();scroll.focus();}
  function clear(){epoch++;selectionEpoch++;selectionMeta={};pageText=null;dialog.querySelector('[data-document-selection]').hidden=true;observer?.disconnect();observer=null;renderQueue=[];shells=[];file=null;doc=null;ready=false;busy=false;metadataTitle='';selected.value='';note.textContent='';scroll.replaceChildren();controls();const previous=task;task=null;if(previous)void previous.destroy().catch(()=>{});if(dialog.open)dialog.close();}
  async function load(chosen,from){
   if(disposed)throw Error('Reopen the source picker.');
   if(!chosen||chosen.size>20*1024*1024)throw Error('Choose a PDF or text document smaller than 20 MB.');
   const extension=chosen.name.split('.').pop().toLowerCase();if(!['pdf','txt','md'].includes(extension))throw Error('Upload a PDF, TXT or Markdown document.');
   clear();const generation=epoch;busy=true;controls();open(from);note.textContent='Opening document…';
   try{
    if(extension==='pdf'){
     const library=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs');if(generation!==epoch)return;
     pdfjs=library;pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs';
     if(!document.querySelector('#pdf-story-reader-style')){const link=document.createElement('link');link.id='pdf-story-reader-style';link.rel='stylesheet';link.href='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/web/pdf_viewer.css';document.head.append(link);}
     const bytes=await chosen.arrayBuffer();if(generation!==epoch)return;
     task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,stopAtErrors:true});doc=await task.promise;if(generation!==epoch)return;
     await preparePages(generation);if(generation!==epoch)return;
     const metadata=await doc.getMetadata().catch(()=>null);if(generation!==epoch)return;metadataTitle=metadata?.info?.Title||'';
    }else{
     const text=(await chosen.text()).replace(/\u0000/g,'');if(generation!==epoch)return;if(!text.trim())throw Error('No readable text was found.');
     const preview=document.createElement('div');preview.className='source-text-preview';preview.dir='auto';preview.textContent=text;scroll.append(preview);
    }
    file=chosen;ready=true;dialog.querySelector('[data-document-selection]').hidden=!doc;note.textContent='Highlight the text to use, review your selection below, then apply it.';
   }catch(error){if(generation===epoch){note.textContent=error.name==='PasswordException'?'Upload an unlocked PDF.':'Could not open document: '+error.message;throw error;}}
   finally{if(generation===epoch){busy=false;controls();}}
  }
  async function pdfText(){
   if(pageText)return pageText;const generation=epoch,currentDoc=doc,result=[];
   for(let n=1;n<=currentDoc.numPages;n++){const page=await currentDoc.getPage(n),content=await page.getTextContent();if(generation!==epoch||disposed)throw Error('The document changed. Reopen the selection.');result.push(window.EccoSourceChapters.lines(content.items));}
   pageText=result;return result;
  }
  async function selectDocument(kind){
   if(busy||!ready||!doc)return;const generation=epoch,token=++selectionEpoch;
   const assertCurrent=()=>{if(disposed||generation!==epoch||token!==selectionEpoch||!dialog.open)throw Error('The document selection changed. Nothing was applied.');};
   const button=dialog.querySelector(kind==='pages'?'[data-select-pages]':'[data-find-chapter]'),idle=button.textContent;
   selected.value='';selectionMeta={};busy=true;controls();button.setAttribute('aria-busy','true');button.innerHTML='<span class="generation-spinner" aria-hidden="true"></span>'+(kind==='pages'?'Selecting Pages…':'Finding Chapter…');note.textContent=kind==='pages'?'Extracting only the requested PDF pages…':'Locating and verifying chapter boundaries…';
   try{
    let selection;
    if(kind==='pages'){
     const value=dialog.querySelector('[data-pages]').value.replace(/[–—]/g,'-').trim(),numbers=new Set();
     if(!value)throw Error('Enter PDF page numbers, for example 10–12.');
     for(const part of value.split(',')){const match=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!match)throw Error('Use page numbers or ranges, for example 10–12, 15.');const a=Number(match[1]),b=Number(match[2]||match[1]);if(a<1||b<a||b>doc.numPages)throw Error('Choose pages between 1 and '+doc.numPages+'.');for(let n=a;n<=b;n++)numbers.add(n);}
     const pages=[...numbers].sort((a,b)=>a-b),texts=[];for(const n of pages){const page=await doc.getPage(n);texts.push(window.EccoSourceChapters.lines((await page.getTextContent()).items).join('\n'));assertCurrent();}selection={text:texts.join('\n\n').trim(),pages,selection_label:'PDF pages '+pages.join(', ')};
    }else{
     if(!window.EccoStorage?.ready||!window.EccoAI?.enabled)throw Error('Connect AI and workspace storage to find a chapter. You can still select PDF pages manually.');
     const pages=await pdfText();assertCurrent();selection=await window.EccoSourceChapters.locate({pages,chapter:dialog.querySelector('[data-chapter]').value,request:api,maxSelection,assertCurrent});
    }
    assertCurrent();if(!selection.text)throw Error('No readable text was found in that selection.');if(selection.text.length>maxSelection)throw Error('The selection exceeds '+maxSelection.toLocaleString()+' characters. Choose a smaller passage; nothing was truncated.');
    selected.value=selection.text;selectionMeta={pages:selection.pages,selection_label:selection.selection_label};note.textContent=selection.selection_label+' · '+selection.text.length.toLocaleString()+' characters. Review the beginning and end, then Apply.';selected.focus();
   }catch(error){if(generation===epoch&&token===selectionEpoch&&!disposed)note.textContent=error.message;}
   finally{if(generation===epoch&&!disposed){busy=false;button.textContent=idle;button.setAttribute('aria-busy','false');controls();}}
  }
  dialog.querySelector('[data-select-pages]').onclick=()=>selectDocument('pages');dialog.querySelector('[data-find-chapter]').onclick=()=>selectDocument('chapter');
  extract.onclick=()=>{if(extract.disabled)return;try{onApply({text:selected.value.trim(),name:file.name,title:metadataTitle&&metadataTitle!=='Untitled'?metadataTitle:file.name.replace(/\.[^.]+$/,'').replace(/[_-]/g,' '),scope:'selected',...selectionMeta});dialog.close();}catch(error){note.textContent=error.message;}};
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{selectionEpoch++;if(opener?.isConnected)opener.focus();});
  return {load,open,clear,get ready(){return ready;},get name(){return file?.name||'';},destroy(){disposed=true;clear();dialog.remove();}};
 }
 window.EccoSourcePicker={create};
})();
