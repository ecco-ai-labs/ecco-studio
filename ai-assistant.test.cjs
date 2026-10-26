/* DOM regression tests; no network requests or real credentials. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/ai-assistant.js','utf8');
const delay=()=>new Promise(resolve=>setTimeout(resolve,25));
async function setup({enabled=true,form='image-form',fields='<label>Image prompt<textarea name="prompt">A red scooter</textarea></label>',stage='images',handler,extra=''}={}){
 const dom=new JSDOM('<button id="settings">Connections</button><dialog id="connection-dialog"><h2></h2><div id="connections"></div></dialog><section id="page"><form id="'+form+'">'+fields+'<button type="submit" id="submit">Generate</button></form>'+extra+'</section>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only'});
 const w=dom.window,calls=[],errors=[];let submits=0;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.structuredClone=structuredClone;w.state={records:[],config:{}};w.page=stage;w.activeStory='story-a';w.refinementSource=null;w.draft={scenes:[]};w.notice=()=>{};
 w.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 w.EccoStorage={ready:true,open:()=>{}};w.EccoErrors={show:e=>errors.push(String(e?.message||e))};
 let status={connected:true,enabled,model:'gpt-6.1-sol'};
 w.api=async(path,body)=>{calls.push({path,body});if(path==='ai/status')return status;if(path==='ai/settings'){status={...status,...body};return status;}if(path==='ai/connect')return status;if(handler)return handler(path,body);return {model:'gpt-6.1-sol',notes:['Refined'],questions:[],revisions:body.fields.map(f=>({id:f.id,text:f.text+' refined'}))};};
 const target=w.document.querySelector('form');target.onsubmit=e=>{e.preventDefault();submits++;e.submitter.disabled=true;};
 w.eval(fs.readFileSync(__dirname+'/ai-text-refinement.js','utf8'));w.eval(source);await delay();
 return {dom,w,calls,errors,target,get submits(){return submits;},click:()=>w.document.querySelector('#submit').click(),improve:(i=0)=>{w.document.querySelectorAll('.ai-prompt-assist')[i].click();const f=w.document.querySelector('#ai-review-dialog form');if(f){f.querySelector('[data-instructions]').value='Make this clearer and more engaging.';f.requestSubmit();}},apply:()=>w.document.querySelector('[data-apply]').click(),close:()=>w.close()};
}
test('Save and Generate submit unchanged text without an automatic paid AI call',async()=>{
 for(const enabled of [true,false]){const x=await setup({enabled});x.click();await delay();assert.equal(x.submits,1);assert.equal(x.target.elements.prompt.value,'A red scooter');assert.equal(x.calls.filter(c=>c.path==='ai/enhance').length,0);assert.equal(x.w.document.querySelector('#submit').disabled,true);x.close();}
});
test('the shared improvement popup asks first, refines repeatedly and applies only the exact selection',async()=>{
 const x=await setup();try{
  const field=x.target.elements.prompt;field.focus();field.setSelectionRange(2,5);x.w.EccoAI.improveField(field);
  const dialog=x.w.document.querySelector('[data-ai-text-refinement]');assert.ok(dialog);assert.equal(dialog.querySelector('[data-selected-text]').value,'red');assert.equal(x.calls.filter(c=>c.path==='ai/enhance').length,0);
  dialog.querySelector('[data-instructions]').value='Make the color richer.';dialog.querySelector('form').requestSubmit();await delay();assert.equal(x.calls.find(c=>c.path==='ai/enhance').body.fields[0].text,'red');assert.match(x.calls.find(c=>c.path==='ai/enhance').body.context.instructions,/color richer/);
  dialog.querySelector('[data-instructions]').value='Refine again.';dialog.querySelector('form').requestSubmit();await delay();assert.equal(x.calls.filter(c=>c.path==='ai/enhance').at(-1).body.fields[0].text,'red refined');dialog.querySelector('[data-apply]').click();assert.equal(field.value,'A red refined refined scooter');
 }finally{x.close();}
});
test('ambient control is compact, accessible, persistent and never submits',async()=>{
 const x=await setup();const b=x.w.document.querySelector('.ai-prompt-assist');assert.equal(b.type,'button');assert.equal(b.textContent,'Improve with AI');assert.equal(b.getAttribute('aria-label'),'Improve image prompt with AI');assert.ok(x.target.elements.prompt.getAttribute('aria-labelledby'));x.improve();await delay();assert.equal(x.submits,0);assert.equal(x.target.elements.prompt.value,'A red scooter');assert.equal(x.w.document.querySelectorAll('.ai-prompt-assist').length,1);x.close();
});
test('suggestion is editable and Apply changes only the selected field and fires draft events',async()=>{
 const x=await setup({fields:'<label>Image prompt<textarea name="prompt">A red scooter</textarea></label><label>Negative prompt<input name="negative" value="blur"></label>'});let inputs=0,changes=0;x.target.elements.prompt.addEventListener('input',()=>inputs++);x.target.elements.prompt.addEventListener('change',()=>changes++);
 x.improve();await delay();assert.equal(x.w.document.querySelector('#ai-review-dialog').open,true);assert.equal(x.target.elements.prompt.value,'A red scooter');const suggestion=x.w.document.querySelector('[data-suggestion]');suggestion.value='My edited suggestion';suggestion.dispatchEvent(new x.w.Event('input'));x.apply();assert.equal(x.target.elements.prompt.value,'My edited suggestion');assert.equal(x.target.elements.negative.value,'blur');assert.equal(inputs,1);assert.equal(changes,1);assert.equal(x.submits,0);assert.equal(x.w.document.querySelector('#ai-review-dialog'),null);x.click();await delay();assert.equal(x.submits,1);assert.equal(x.calls.filter(c=>c.path==='ai/enhance').length,1);x.close();
});
test('Cancel and closing the review leave original text unchanged',async()=>{
 const x=await setup();x.improve();await delay();x.w.document.querySelector('[data-cancel]').click();assert.equal(x.target.elements.prompt.value,'A red scooter');assert.equal(x.submits,0);x.close();
});
test('disconnected or disabled AI opens the existing connection control',async()=>{
 const x=await setup({enabled:false});x.improve();await delay();assert.equal(x.w.document.querySelector('#connection-dialog').open,true);assert.equal(x.calls.filter(c=>c.path==='ai/enhance').length,0);assert.equal(x.submits,0);x.close();
});
test('empty prompt does not call AI',async()=>{
 const x=await setup({fields:'<label>Prompt<textarea name="prompt"></textarea></label>'});x.improve();await delay();assert.equal(x.calls.filter(c=>c.path==='ai/enhance').length,0);x.close();
});
test('API failure leaves text and generation controls intact',async()=>{
 const x=await setup({handler:()=>{throw Error('Quota reached');}});x.improve();await delay();assert.equal(x.target.elements.prompt.value,'A red scooter');assert.match(x.w.document.querySelector('[data-apply-status]').textContent,/Quota reached/);assert.equal(x.w.document.querySelector('#submit').disabled,false);assert.equal(x.w.document.querySelector('.ai-prompt-assist').disabled,false);x.close();
});
test('rapid clicks produce one AI request',async()=>{
 let resolve;const x=await setup({handler:()=>new Promise(r=>resolve=r)});x.improve();x.improve();await delay();assert.equal(x.calls.filter(c=>c.path==='ai/enhance').length,1);resolve({model:'test',notes:[],questions:[],revisions:[{id:'field_prompt',text:'Refined'}]});await delay();x.close();
});
test('editing the draft while waiting rejects the stale result',async()=>{
 let resolve;const x=await setup({handler:()=>new Promise(r=>resolve=r)});x.improve();await delay();x.target.elements.prompt.value='Changed by user';resolve({model:'test',notes:[],questions:[],revisions:[{id:'field_prompt',text:'Stale result'}]});await delay();assert.equal(x.target.elements.prompt.value,'Changed by user');assert.match(x.w.document.querySelector('[data-apply-status]').textContent,/draft or selection changed/);x.close();
});
test('Apply rejects changed fields, references, story selection, and AI connection',async()=>{
 for(const change of ['field','reference','story','disabled']){
  const x=await setup({fields:'<label>Prompt<textarea name="prompt">A red scooter</textarea></label><select id="studio-reference-image"><option value="a">A</option><option value="b">B</option></select>'});x.improve();await delay();
  if(change==='field')x.target.elements.prompt.value='Changed';if(change==='reference')x.w.document.querySelector('#studio-reference-image').value='b';if(change==='story')x.w.activeStory='story-b';if(change==='disabled'){x.w.EccoAI.connections();await delay();const toggle=x.w.document.querySelector('#enable-studio-ai');toggle.checked=false;toggle.dispatchEvent(new x.w.Event('change'));await delay();}
  x.apply();assert.equal(x.target.elements.prompt.value,change==='field'?'Changed':'A red scooter');assert.match(x.w.document.querySelector('[data-apply-status]').textContent,/changed/);x.close();
 }
});
test('clarification stays visible and cannot be applied',async()=>{
 const x=await setup({handler:(p,b)=>({model:'test',notes:[],questions:['Which character drives?'],revisions:b.fields.map(f=>({id:f.id,text:'Do not apply'}))})});x.improve();await delay();assert.match(x.w.document.querySelector('.ai-questions').textContent,/Which character drives/);assert.equal(x.w.document.querySelector('[data-apply]').disabled,true);assert.equal(x.target.elements.prompt.value,'A red scooter');x.close();
});
test('new and removed audio dialogue fields receive exactly one control each',async()=>{
 const x=await setup({form:'audio-form',fields:'<div class="audio-line"><label>Dialogue<textarea data-field="text" maxlength="500">नमस्ते</textarea></label></div>'});const line=x.target.querySelector('.audio-line').cloneNode(true);line.querySelector('.ai-prompt-toolbar').remove();line.querySelector('textarea').removeAttribute('aria-labelledby');line.querySelector('label').prepend('Dialogue');x.target.append(line);await delay();assert.equal(x.target.querySelectorAll('.ai-prompt-assist').length,2);line.remove();await delay();assert.equal(x.target.querySelectorAll('.ai-prompt-assist').length,1);x.close();
});
test('story, image edits, composition, audio, characters, workflows and publish fields use the right stage',async()=>{
 for(const [form,fields,stage] of [
  ['story-setup-form','<textarea name="summary">A story</textarea>','story'],['new-story-form','<textarea name="summary">A story</textarea>','story'],
  ['director-form','<textarea name="story">A shot sequence</textarea>','storyboard'],['edit-image-form','<textarea name="prompt">Change the coat</textarea>','image'],['compose-characters','<textarea name="prompt">Two characters</textarea>','image'],
  ['audio-form','<div class="audio-line"><select data-field="language"><option>Hindi</option></select><textarea data-field="text" maxlength="500">नमस्ते</textarea></div>','audio'],['character-form','<textarea name="description">Red coat</textarea>','character'],
  ['workflow-form','<textarea name="prompt">Research news</textarea>','story'],['publish-form','<input name="title" value="Film"><textarea name="description">A film</textarea>','publish']]){
  const x=await setup({form,fields});x.improve();await delay();assert.equal(x.submits,0,form);assert.equal(x.calls.find(c=>c.path==='ai/enhance').body.stage,stage,form);x.apply();assert.match(x.target.querySelector('textarea,input').value,/refined$/,form);x.close();
 }
});
test('storyboard motion, narration, director shots and object instructions have ambient controls',async()=>{
 for(const [extra,count] of [
  ['<label>Story<textarea id="story-text">Story</textarea></label><div id="scenes"><label>Motion<textarea data-field="motion">Walk</textarea></label><label>Narration<textarea data-field="narration">Hello</textarea></label></div>',3],
  ['<div class="director-shot"><label>Action<textarea data-dfield="action">Walk</textarea></label><label>Frame<textarea data-dfield="frame">Doorway</textarea></label></div>',2],
  ['<dialog open><div id="oe-ai-fields"><label>Expression<input value="Smile"></label></div><label>Instruction<textarea id="oe-instruction">Keep background</textarea></label></dialog>',2]]){
   const x=await setup({form:'unused-form',fields:'',stage:'board',extra});assert.equal(x.w.document.querySelectorAll('.ai-prompt-assist').length,count);x.improve();await delay();assert.equal(x.errors.length,0);x.apply();assert.equal(x.errors.length,0);x.close();
 }
});
test('read-only source and review fields never gain improvement controls',async()=>{
 const x=await setup({fields:'<textarea name="prompt">Prompt</textarea><textarea name="prompt" readonly>Original source</textarea>'});assert.equal(x.target.querySelectorAll('.ai-prompt-assist').length,1);x.improve();await delay();assert.equal(x.w.document.querySelector('#ai-review-dialog').querySelectorAll('.ai-prompt-assist').length,0);x.close();
});
test('malformed and overlength API suggestions cannot overwrite a prompt',async()=>{
 for(const revisions of [[{id:'wrong',text:'Wrong'}],[{id:'field_prompt',text:'x'.repeat(21)}]]){
  const x=await setup({fields:'<textarea name="prompt" maxlength="20">Original</textarea>',handler:()=>({model:'test',notes:[],questions:[],revisions})});x.improve();await delay();assert.equal(x.target.elements.prompt.value,'Original');assert.match(x.w.document.querySelector('[data-apply-status]').textContent,/invalid suggestion/);x.close();
 }
});
test('negative prompt requests include the positive prompt and selected references',async()=>{
 const x=await setup({fields:'<label>Image prompt<textarea name="prompt">Red scooter</textarea></label><label>Negative prompt<input name="negative" value="Blur"></label><select id="studio-reference-image"><option value="ref-1">Reference</option></select>'});x.improve(1);await delay();const body=x.calls.find(c=>c.path==='ai/enhance').body;assert.equal(body.fields[0].id,'field_negative');assert.equal(body.context.summary,'Red scooter');assert.deepEqual(Array.from(body.reference_ids),['ref-1']);x.close();
});
test('connection key is cleared immediately and never persisted in browser storage',async()=>{
 const x=await setup();x.w.EccoAI.connections();await delay();x.w.document.querySelector('#connect-openai').click();const form=x.w.document.querySelector('#openai-key-dialog form'),key='sk-test-only-never-real';form.elements.api_key.value=key;form.querySelector('[type=submit]').click();await delay();assert.equal(form.elements.api_key.value,'');assert.equal(x.w.localStorage.length,0);assert.equal(x.w.sessionStorage.length,0);assert.equal(x.calls.find(c=>c.path==='ai/connect').body.api_key,key);x.close();
});

test('Connections mounts YouTube alongside AI, Storage and GPU without opening publishing',async()=>{
 const x=await setup();let mounted=0,updated=0;
 x.w.EccoYouTube={mount:root=>{mounted++;const row=x.w.document.createElement('section');row.id='youtube-connection';root.append(row);},update:()=>updated++};
 x.w.EccoAI.connections();await delay();assert.equal(mounted,1);assert.ok(updated>0);assert.ok(x.w.document.querySelector('#connections #youtube-connection'));assert.ok(x.w.document.querySelector('#connections [data-storage]'));x.close();
});

test('API key opens blank, unlocks on user focus and keeps a chosen key until explicit connect',async()=>{
 const x=await setup();
 try{
  x.w.EccoAI.open();
  let dialog=x.w.document.querySelector('#openai-key-dialog'),input=dialog.querySelector('[name=api_key]');
  assert.equal(input.value,'');assert.equal(input.readOnly,true);
  assert.equal(x.w.document.activeElement,dialog.querySelector('h2'));
  assert.equal(input.autocomplete,'current-password');
  input.value='unwanted-autofill';input.focus();
  assert.equal(input.value,'');assert.equal(input.readOnly,false);
  input.value='sk-test-user-selected';input.dispatchEvent(new x.w.Event('input',{bubbles:true}));
  input.blur();input.focus();
  assert.equal(input.value,'sk-test-user-selected');
  assert.equal(x.calls.filter(c=>c.path==='ai/connect').length,0);
  dialog.querySelector('[type=submit]').click();await delay();
  assert.equal(x.calls.find(c=>c.path==='ai/connect').body.api_key,'sk-test-user-selected');
  assert.equal(input.value,'');
  x.w.EccoAI.open();input=dialog.querySelector('[name=api_key]');
  assert.equal(input.value,'');assert.equal(input.readOnly,true);
  input.dispatchEvent(new x.w.Event('pointerdown'));
  assert.equal(input.readOnly,false);
  input.value='sk-test-cancelled';dialog.close();assert.equal(input.value,'');
 }finally{x.close();}
});
