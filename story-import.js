'use strict';
(() => {
 const q=s=>document.querySelector(s);
 let mainPicker=null,mainForm=null;
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
  if(mainForm&&!mainForm.isConnected){mainPicker?.destroy();mainPicker=null;mainForm=null;}
  const form=q('#story-setup-form');if(!form||q('#story-pdf-tools'))return;
  let saved={};try{saved=JSON.parse(localStorage.getItem(form.dataset.draftKey||'ecco-new-story-draft')||'{}');}catch{}
  const box=document.createElement('section');box.id='story-pdf-tools';box.className='pdf-import-tools';
  box.innerHTML='<div class="row"><button type="button" class="secondary" data-upload>Upload PDF</button><button type="button" class="secondary" data-preview disabled>Preview & Select</button><span data-file-wrap hidden><button type="button" class="secondary" data-remove aria-label="Remove uploaded PDF" title="Remove uploaded PDF" style="padding:2px 6px!important;min-height:24px!important">×</button> <span data-filename></span></span></div><input type="file" accept=".pdf,application/pdf" hidden><p role="status"></p><details><summary>Extracted story text</summary><label>Source text<textarea name="sourceText" rows="5"></textarea></label></details>';
  form.prepend(box);const input=box.querySelector('input'),status=box.querySelector('[role=status]'),source=box.querySelector('textarea'),open=box.querySelector('[data-preview]');
  source.value=saved.sourceText||'';
  const panel=document.createElement('div');panel.id='story-entry-panel';panel.setAttribute('role','group');panel.setAttribute('aria-label','Story creation options');
  panel.innerHTML='<div class="story-source-controls" role="group" aria-label="Story source"><button type="button" class="secondary" data-story-library>Story Library</button><button type="button" class="secondary" data-story-manual aria-pressed="false">Manual</button><details class="workspace-menu"><summary>Upload<span aria-hidden="true">⌄</span></summary><div class="workspace-menu-items"></div></details></div>';
  form.before(panel);
  const format=form.elements.story_format;
  if(format&&(!form.dataset.intent||form.dataset.intentFormatChoice==='true')){
   format.closest('label').classList.add('story-format-source');if(form.dataset.intent)format.closest('label').hidden=true;format.tabIndex=-1;format.setAttribute('aria-hidden','true');
   const control=document.createElement('div');control.className='story-format-control';control.setAttribute('role','group');control.setAttribute('aria-label','Story Format');
   control.innerHTML='<div class="story-format-options"><button type="button" class="secondary" data-story-format-option="audio" aria-pressed="false">Audio</button><button type="button" class="secondary" data-story-format-option="video" aria-pressed="false">Video</button></div>';
   const buttons=[...control.querySelectorAll('button')];
   const sync=()=>buttons.forEach(button=>{const selected=button.dataset.storyFormatOption===format.value;button.setAttribute('aria-pressed',String(selected));button.classList.toggle('is-selected',selected);});
   buttons.forEach(button=>button.onclick=()=>{format.value=button.dataset.storyFormatOption;format.dispatchEvent(new Event('change',{bubbles:true}));});
   format.addEventListener('input',sync);format.addEventListener('change',sync);format.addEventListener('invalid',event=>{event.preventDefault();buttons[0].focus();notice('Choose Audio or Video.');});
   panel.prepend(control);sync();
  }
  const menu=panel.querySelector('details'),items=panel.querySelector('.workspace-menu-items'),row=box.querySelector('.row');items.append(row);
  box.hidden=true;
  const mode=value=>{panel.dataset.mode=value;panel.querySelector('[data-story-manual]').setAttribute('aria-pressed',String(value==='manual'));box.hidden=value!=='upload';};
  mode('manual');
  panel.querySelector('[data-upload]').onclick=()=>{mode('upload');menu.open=false;input.click();};
  panel.querySelector('[data-preview]').addEventListener('click',()=>{mode('upload');menu.open=false;});
  panel.querySelector('[data-story-manual]').onclick=()=>{mode('manual');menu.open=false;form.elements.summary.focus();};
  panel.querySelector('[data-story-library]').onclick=()=>navigate('story-library');
  mainForm=form;
  const picker=window.EccoSourcePicker.create({onApply({text,name:filename,title}){
   if(!form.isConnected)throw Error('Reopen Upload from the current story.');
   if(!form.elements.title.value.trim())form.elements.title.value=title.slice(0,160);
   for(const [name,value]of [['audio_source_scope','selected'],['audio_source_name',filename]]){let field=form.elements[name];if(!field){field=document.createElement('input');field.type='hidden';field.name=name;form.append(field);}field.value=value;}
   source.value=text;form.elements.summary.value=text.length<=4000?text:text.slice(0,3997)+'…';source.dispatchEvent(new Event('input',{bubbles:true}));
   box.querySelector('details').open=true;status.textContent=text.length+' characters extracted from your selection.'+(text.length>4000?' Summary contains an excerpt; the full selection is in Source text.':'')+' Review, then save to continue.';
   if(form.elements.story_format.value!=='audio')form.requestSubmit();
  }});mainPicker=picker;
  open.onclick=()=>picker.open(menu.querySelector('summary'));
  panel.querySelector('[data-remove]').onclick=()=>{picker.clear();open.disabled=true;input.value='';panel.querySelector('[data-filename]').textContent='';panel.querySelector('[data-file-wrap]').hidden=true;status.textContent='';};
  input.onchange=async()=>{
   const file=input.files[0];if(!file)return;open.disabled=true;status.textContent='Opening PDF…';
   try{await picker.load(file,menu.querySelector('summary'));if(!form.isConnected)return;panel.querySelector('[data-filename]').textContent=picker.name;panel.querySelector('[data-file-wrap]').hidden=!picker.ready;open.disabled=!picker.ready;status.textContent='';}
   catch(error){if(form.isConnected){window.EccoErrors?.show(error);status.textContent=error.name==='PasswordException'?'Upload an unlocked PDF.':'Could not open PDF: '+error.message;}}
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
 function mountAudio(){window.EccoAudioStudio?.mountScenePicker();}
 function mount(){mountPDF();mountBoard();mountImage();mountAudio();}
 new MutationObserver(mount).observe(q('#page'),{childList:true,subtree:true});mount();
})();


