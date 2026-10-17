/* DOM regression tests; no network requests or real credentials. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/ai-assistant.js','utf8');
const delay=()=>new Promise(resolve=>setTimeout(resolve,20));
async function setup({enabled=true,form='image-form',fields='<textarea name="prompt">A red scooter</textarea>',stage='images',handler}={}){
 const dom=new JSDOM('<button id="settings">Connections & Storage</button><dialog id="connection-dialog"><h2></h2><div id="connections"></div></dialog><section id="page"><form id="'+form+'">'+fields+'<button type="submit" id="submit">Continue</button></form></section>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only'});
 const w=dom.window,calls=[],errors=[];let submits=0;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.state={records:[],config:{}};w.page=stage;w.activeStory='story-a';w.refinementSource=null;w.draft={scenes:[]};w.notice=()=>{};
 w.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 w.EccoStorage={ready:true,open:()=>{}};w.EccoErrors={show:e=>errors.push(String(e?.message||e))};w.boards=()=>[];
 let status={connected:true,enabled,model:'gpt-6-astra'};
 w.api=async(path,body)=>{calls.push({path,body});if(path==='ai/status')return status;if(path==='ai/settings'){status={...status,...body};return status;}if(path==='ai/connect')return status;if(handler)return handler(path,body);return {model:'gpt-6-astra',notes:['Refined'],questions:[],revisions:body.fields.map(f=>({id:f.id,text:f.text+' refined'}))};};
 const target=w.document.querySelector('form');target.onsubmit=e=>{e.preventDefault();submits++;e.submitter.disabled=true;};
 w.eval(source);await delay();
 return {dom,w,calls,errors,target,get submits(){return submits;},click:()=>w.document.querySelector('#submit').click(),close:()=>w.close()};
}
test('AI off preserves original text and normal submit behavior',async()=>{
 const x=await setup({enabled:false});x.click();await delay();assert.equal(x.submits,1);assert.equal(x.target.elements.prompt.value,'A red scooter');assert.equal(x.calls.filter(c=>c.path==='ai/enhance').length,0);x.close();
});
test('enabled AI refines once, submits once, and preserves generation busy lock',async()=>{
 const x=await setup();x.click();x.click();await delay();assert.equal(x.submits,1);assert.equal(x.target.elements.prompt.value,'A red scooter refined');assert.equal(x.calls.filter(c=>c.path==='ai/enhance').length,1);assert.equal(x.w.document.querySelector('#submit').disabled,true);x.close();
});
test('AI failure leaves text intact and never starts the action',async()=>{
 const x=await setup({handler:()=>{throw Error('Quota reached');}});x.click();await delay();assert.equal(x.submits,0);assert.equal(x.target.elements.prompt.value,'A red scooter');assert.match(x.errors[0],/Quota reached/);assert.equal(x.w.document.querySelector('#submit').disabled,false);x.close();
});
test('draft edits during AI review are not overwritten',async()=>{
 let resolve;const x=await setup({handler:()=>new Promise(r=>resolve=r)});x.click();await delay();x.target.elements.prompt.value='Changed by user';resolve({model:'test',notes:[],questions:[],revisions:[{id:'field_0',text:'Stale result'}]});await delay();assert.equal(x.submits,0);assert.equal(x.target.elements.prompt.value,'Changed by user');assert.match(x.errors[0],/changed during/);x.close();
});
test('turning the global switch off cancels application of an in-flight result',async()=>{
 let resolve;const x=await setup({handler:()=>new Promise(r=>resolve=r)});x.click();await delay();x.w.EccoAI.connections();await delay();const toggle=x.w.document.querySelector('#enable-studio-ai');toggle.checked=false;toggle.dispatchEvent(new x.w.Event('change'));await delay();resolve({model:'test',notes:[],questions:[],revisions:[{id:'field_0',text:'Stale result'}]});await delay();assert.equal(x.submits,0);assert.equal(x.target.elements.prompt.value,'A red scooter');assert.equal(x.w.EccoAI.enabled,false);x.close();
});
test('clarification questions block submission without modifying the draft',async()=>{
 const x=await setup({handler:(p,b)=>({model:'test',notes:[],questions:['Which character drives?'],revisions:b.fields.map(f=>({id:f.id,text:'Do not apply'}))})});x.click();await delay();assert.equal(x.submits,0);assert.equal(x.target.elements.prompt.value,'A red scooter');assert.match(x.errors[0],/Which character drives/);x.close();
});
test('one control covers story, storyboard, audio, character and publishing forms',async()=>{
 for(const [form,fields,stage] of [
  ['story-setup-form','<textarea name="summary">A story</textarea>','story'],
  ['director-form','<textarea name="story">A shot sequence</textarea>','storyboard'],
  ['audio-form','<div class="audio-line"><select data-field="language"><option>Hindi</option></select><textarea data-field="text" maxlength="500">नमस्ते</textarea></div>','audio'],
  ['character-form','<textarea name="description">Red coat</textarea>','character'],
  ['publish-form','<input name="title" value="Film"><textarea name="description">A film</textarea>','publish']]){
  const x=await setup({form,fields});x.click();await delay();assert.equal(x.submits,1,form);assert.equal(x.calls.find(c=>c.path==='ai/enhance').body.stage,stage);x.close();
 }
});
test('connection key is cleared immediately and never persisted in browser storage',async()=>{
 const x=await setup();x.w.EccoAI.connections();await delay();x.w.document.querySelector('#connect-openai').click();const form=x.w.document.querySelector('#openai-key-dialog form'),key='sk-test-only-never-real';form.elements.api_key.value=key;form.querySelector('[type=submit]').click();await delay();assert.equal(form.elements.api_key.value,'');assert.equal(x.w.localStorage.length,0);assert.equal(x.w.sessionStorage.length,0);assert.equal(x.calls.find(c=>c.path==='ai/connect').body.api_key,key);x.close();
});
