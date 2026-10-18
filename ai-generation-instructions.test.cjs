/* DOM regression tests; no network requests or real credentials. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/ai-assistant.js','utf8');
const delay=()=>new Promise(resolve=>setTimeout(resolve,25));
async function setup({enabled=true,form='image-form',fields='<label>Image prompt<textarea name="prompt">A red scooter</textarea></label>',stage='images',handler,extra='',generationModes=['generate']}={}){
 const dom=new JSDOM('<button id="settings">Connections</button><dialog id="connection-dialog"><h2></h2><div id="connections"></div></dialog><section id="page"><form id="'+form+'">'+fields+'<button type="submit" id="submit">Generate</button></form>'+extra+'</section>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only'});
 const w=dom.window,calls=[],errors=[];let submits=0;const observers=[],Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(callback){super(callback);observers.push(this);}};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.structuredClone=structuredClone;w.state={records:[],config:{}};w.page=stage;w.activeStory='story-a';w.refinementSource=null;w.draft={scenes:[]};w.notice=()=>{};
 w.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 w.EccoStorage={ready:true,open:()=>{}};w.EccoErrors={show:e=>errors.push(String(e?.message||e))};
 let status={connected:true,enabled,model:'gpt-6.1-sol',generation_modes:generationModes};
 w.api=async(path,body)=>{calls.push({path,body});if(path==='ai/status')return status;if(path==='ai/settings'){status={...status,...body};return status;}if(path==='ai/connect')return status;if(handler)return handler(path,body);return {model:'gpt-6.1-sol',notes:['Refined'],questions:[],revisions:body.fields.map(f=>({id:f.id,text:f.text+' refined'}))};};
 const target=w.document.querySelector('form');target.onsubmit=e=>{e.preventDefault();submits++;e.submitter.disabled=true;};
 w.eval(source);await delay();
 return {dom,w,calls,errors,target,get submits(){return submits;},click:()=>w.document.querySelector('#submit').click(),improve:(i=0)=>w.document.querySelectorAll('.ai-prompt-assist')[i].click(),apply:()=>w.document.querySelector('[data-apply]').click(),close:()=>{observers.forEach(o=>o.disconnect());w.close();}};
}

function options(x,language='Hindi',instructions='Use natural dialogue and a dramatic tone.'){
 const form=x.w.document.querySelector('#ai-generation-dialog form');form.elements.language.value=language;form.elements.language.dispatchEvent(new x.w.Event('change'));form.elements.instructions.value=instructions;return form;
}
test('Generate asks for instructions before an AI call, sends Hindi, and waits for Apply',async()=>{
 const x=await setup({fields:'<label>Prompt<textarea name="prompt">A river story</textarea></label><input name="negative" value="blur">'});x.target.dataset.generationStudio='image';
 x.w.EccoAI.generateField(x.target.elements.prompt);assert.equal(x.w.document.querySelector('#ai-generation-dialog').open,true);assert.equal(x.calls.filter(c=>c.path==='ai/enhance').length,0);
 options(x).requestSubmit();await delay();const request=x.calls.find(c=>c.path==='ai/enhance').body;assert.equal(request.mode,'generate');assert.equal(request.context.language,'Hindi');assert.match(request.context.instructions,/natural dialogue/);assert.match(request.context.instructions,/Write the generated text in Hindi/);assert.equal(x.target.elements.prompt.value,'A river story');assert.equal(x.submits,0);
 x.apply();assert.equal(x.target.elements.prompt.value,'A river story refined');assert.equal(x.target.elements.negative.value,'blur');assert.equal(x.calls.filter(c=>c.path==='ai/enhance').length,1);x.close();
});
test('Cancel and stale fields cause no AI request or draft replacement',async()=>{
 for(const stale of [false,true]){const x=await setup();x.w.EccoAI.generateField(x.target.elements.prompt);const form=options(x);if(stale){x.target.elements.prompt.value='Changed';form.requestSubmit();assert.match(x.w.document.querySelector('[data-generation-status]').textContent,/changed/);}else form.querySelector('[data-cancel]').click();await delay();assert.equal(x.calls.filter(c=>c.path==='ai/enhance').length,0);assert.equal(x.target.elements.prompt.value,stale?'Changed':'A red scooter');x.close();}
});
test('custom and remembered languages work across generation fields',async()=>{
 const x=await setup({form:'audio-form',fields:'<label>Dialogue<textarea data-field="text">Hello</textarea></label>'});const text=x.target.querySelector('textarea');x.w.EccoAI.generateField(text);let form=options(x,'other','Write a short greeting.');form.elements.other_language.value='Hindi and Urdu';form.requestSubmit();await delay();assert.equal(x.calls.find(c=>c.path==='ai/enhance').body.context.language,'Hindi and Urdu');x.w.document.querySelector('#ai-review-dialog [data-cancel]').click();x.w.EccoAI.generateField(text);form=x.w.document.querySelector('#ai-generation-dialog form');assert.equal(form.elements.language.value,'other');assert.equal(form.elements.other_language.value,'Hindi and Urdu');x.close();
});
test('story, storyboard, image, audio and video Generate use the same instruction popup',async()=>{
 for(const [form,fields,stage] of [['story-setup-form','<label>Summary<textarea name="summary">A story</textarea></label>','story'],['unused-form','<label>Scene<textarea id="story-text">A scene</textarea></label>','board'],['image-form','<label>Prompt<textarea name="prompt">A frame</textarea></label>','images'],['audio-form','<label>Dialogue<textarea data-field="text">Hello</textarea></label>','audio'],['video-form','<label>Motion<textarea name="prompt">Walk</textarea></label>','render']]){
  const x=await setup({form,fields,stage});x.w.EccoAI.generateField(x.target.querySelector('textarea'));assert.ok(x.w.document.querySelector('#ai-generation-dialog[open]'),form);assert.equal(x.calls.filter(c=>c.path==='ai/enhance').length,0,form);x.close();
 }
});
async function boardSetup(invalid=false,legacy=false){
 const scene={title:'दृश्य',narration:'नमस्ते',motion:'Slow pan',shot_size:'wide',camera_angle:'eye level',camera_move:'pan'};
 const x=await setup({form:'unused-form',stage:'board',generationModes:legacy?[]:['generate'],fields:'<label>Title<input id="board-title"></label><label>Story<textarea id="story-text">A river story</textarea></label><div class="row"><button type="button" id="split">Split</button><button type="button" id="add-scene">Add</button></div><div id="scenes"></div><div class="row"><button type="button" id="save-board">Save</button></div>',handler:path=>path==='stories/plan'?{continuity:'Same characters',scenes:[scene,scene]}:({revisions:[{id:'scene_plan',text:invalid?'bad JSON':JSON.stringify({continuity:'Same characters',scenes:[scene,scene]})}],questions:[]})});
 x.w.draft={title:'River',story:'A river story',defaultSeconds:3,scenes:[]};x.w.renderScenes=()=>{};x.w.persistDraft=()=>{};x.w.confirm=()=>true;
 x.w.eval(fs.readFileSync(__dirname+'/storyboard-controls.js','utf8'));await delay();const count=x.w.document.querySelector('#scene-count');count.value=2;count.dispatchEvent(new x.w.Event('change',{bubbles:true}));count.focus();x.w.document.querySelector('#split').click();return x;
}
test('scene planning sends instructions and language through the existing AI endpoint',async()=>{
 const x=await boardSetup();assert.equal(x.calls.filter(c=>c.path==='ai/enhance').length,0);options(x,'Hindi','Keep the narration conversational.').requestSubmit();await delay();await delay();
 const request=x.calls.find(c=>c.path==='ai/enhance').body;assert.equal(request.context.language,'Hindi');assert.equal(request.context.count,2);assert.match(request.fields[0].text,/conversational/);assert.equal(x.w.draft.scenes.length,2);assert.equal(x.w.draft.scenes[0].narration,'नमस्ते');assert.equal(x.w.draft.scenes[0].seconds,3);assert.equal(x.w.draft.scenes[0].image_id,'');assert.equal(x.w.draft.story,'A river story');x.close();
});
test('invalid scene output preserves the existing scene draft',async()=>{
 const x=await boardSetup(true),before=JSON.stringify(x.w.draft);options(x).requestSubmit();await delay();await delay();assert.equal(JSON.stringify(x.w.draft),before);x.close();
});

test('existing scene planning still works on older services without custom instructions',async()=>{
 const x=await boardSetup(false,true);options(x,'','').requestSubmit();await delay();await delay();assert.equal(x.calls.filter(c=>c.path==='stories/plan').length,1);assert.equal(x.w.draft.scenes[0].narration,'नमस्ते');x.close();
});
test('older services do not silently ignore custom scene instructions',async()=>{
 const x=await boardSetup(false,true),before=JSON.stringify(x.w.draft);options(x).requestSubmit();await delay();await delay();assert.equal(x.calls.filter(c=>['stories/plan','ai/enhance'].includes(c.path)).length,0);assert.equal(JSON.stringify(x.w.draft),before);x.close();
});
