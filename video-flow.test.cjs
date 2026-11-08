const {test,afterEach}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),fs=require('node:fs');
const cleanups=[];afterEach(()=>{for(const close of cleanups.splice(0))close();});
function fixture(){
 const w=new JSDOM('<form id="video-form"><section data-section="model"><div class="generation-section-heading"></div><select id="job-model"><option value="longcat-avatar-1.5">LongCat</option><option value="wan-5b">Wan</option></select></section><section data-section="references"></section><section data-section="prompt"></section><section data-section="controls"></section><div class="generation-footer"><button id="generate-video">Generate</button><p id="video-status"></p></div></form>',{url:'https://example.test',runScripts:'outside-only'}).window;
 const observers=[],Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(cb){super(cb);observers.push(this);}};cleanups.push(()=>{observers.forEach(o=>o.disconnect());w.close();});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.onclose?.();};
 const records=[{id:'i',kind:'asset',media:'image',title:'Avatar'},{id:'v',kind:'asset',media:'video',title:'Style reference'},{id:'a',kind:'asset',media:'audio',title:'Speech',seconds:6,story_id:'s',settings:{lines:[{text:'Original words'}]}}];
 const ctx={data:{reference_ids:['i'],video_reference_ids:['v'],audio_reference_ids:['a']}},calls=[];
 Object.assign(w,{state:{records},activeStory:'s',renderPage:()=>{},boards:()=>[],media:()=>'',hydrateMedia:()=>{},gpuConnected:()=>true,modelAvailable:()=>true,modelSettings:()=>({resolution:'832x480'}),setGenerationBusy:()=>{},refresh:async()=>{},notice:()=>{},currentStory:()=>({title:'Test'}),modelPayload:()=>({})});
 ctx.compute={value:'test-gpu'};w.EccoCompute={validate:async()=>({})};w.modelProfiles={selected:{video:'longcat-avatar-1.5'}};w.EccoErrors={show:()=>{}};
 w.EccoGeneration={context:()=>ctx,trackJob:()=>{}};
 w.api=async(path,body)=>{calls.push({path,body});return path==='state'?{records}:path==='ai/enhance'?{revisions:body.fields.map(f=>({id:f.id,text:'Directed shot: '+f.text})),questions:[]}:{id:'job'};};
 w.eval(fs.readFileSync(__dirname+'/video-flow.js','utf8'));return {w,calls,ctx,q:s=>w.document.querySelector(s)};
}
test('ordered steps, existing assets, camera/eye controls and AI video context reach the render',async()=>{
 const {w,calls,q}=fixture();
 assert.deepEqual([...w.document.querySelectorAll('[data-step]')].map(x=>x.dataset.step),['2','3','4']);
 assert.equal(q('[data-transcript]').value,'Original words');
 q('[data-shot-controls]').click();q('[data-control=eye]').value='Look left';q('#video-shot-controls form').dispatchEvent(new w.Event('submit',{cancelable:true}));
 await q('#video-form').onsubmit({preventDefault(){}});assert.equal(calls[0].path,'ai/enhance');assert.deepEqual(Array.from(calls[0].body.video_reference_ids),['v']);assert.match(calls[0].body.fields[0].text,/Look left/);
 assert.equal(calls[1].path,'longcat/sequence');assert.equal(calls[1].body.shots[0].image_id,'i');assert.equal(calls[1].body.shots[0].seconds,6);assert.match(calls[1].body.shots[0].prompt,/Look left/);assert.deepEqual(Array.from(calls[1].body.audio_ids),['a']);
});
test('changing reference inputs invalidates previously analyzed video direction',async()=>{
 const {w,calls,q}=fixture();await q('#video-form').onsubmit({preventDefault(){}});
 q('[data-shot-controls]').click();q('[data-video-prompt]').value='A different scene';q('#video-shot-controls form').dispatchEvent(new w.Event('submit',{cancelable:true}));
 await q('#video-form').onsubmit({preventDefault(){}});
 assert.equal(calls.length,4);assert.equal(calls[2].path,'ai/enhance');assert.equal(calls[3].path,'longcat/sequence');assert.match(calls[2].body.fields[0].text,/A different scene/);
});
test('selecting speech does not silently change model; incompatible render gives actionable feedback',async()=>{
 const {calls,q}=fixture();q('#job-model').value='wan-5b';
 await q('#video-form').onsubmit({preventDefault(){}});
 assert.equal(q('#job-model').value,'wan-5b');assert.equal(calls.length,0);assert.match(q('#video-status').textContent,/Select LongCat/);
});

test('one library selector preserves selections and refreshed assets are visible',async()=>{
 const {w,q}=fixture();
 const old=w.api;w.api=async(path,body)=>path==='state'?{records:w.state.records,config:{}}:old(path,body);
 await q('[data-browse]').onclick();
 assert.equal(w.document.querySelectorAll('[data-asset-choice]').length,1);
 assert.equal(q('[data-asset-choice]').dataset.assetChoice,'i');
 q('[data-cancel]').onclick();q('[data-library]').value='audio';await q('[data-browse]').onclick();
 assert.equal(q('[data-asset-choice]').dataset.assetChoice,'a');
 assert.match(q('[data-list=image]').textContent,/Avatar/);
});
test('audio from another story loads all 100 selectable shots and edits the single selected shot',async()=>{
 const {w,q}=fixture();
 w.state.records.find(x=>x.id==='a').story_id='other-story';
 w.state.records.push({id:'b',kind:'board',story_id:'other-story',title:'News',created:1,scenes:Array.from({length:100},(_,i)=>({title:'News '+i,seconds:1}))});
 await q('[data-browse]').onclick();q('[data-cancel]').click();q('[data-board]').value='b';q('[data-board]').dispatchEvent(new w.Event('change'));
 assert.equal(q('[data-shot]').querySelectorAll('input[type=checkbox]').length,100);
 assert.equal(w.document.querySelectorAll('[data-shots] fieldset').length,0);
 assert.equal(w.document.querySelectorAll('[data-shots] input[type=checkbox]').length,0);
 assert.equal(q('[data-transcript]').value,'Original words');
 for(let i=0;i<99;i++){const c=q('[aria-label="Include shot '+(i+1)+' in video"]');c.checked=false;c.dispatchEvent(new w.Event('change'));}assert.equal(w.document.querySelectorAll('[data-shots] fieldset').length,1);q('[data-shot-controls]').click();assert.ok(q('#video-shot-controls'));assert.equal(q('[data-seconds]').value,'6');
});
test('recorded speech is submitted without requiring AI to rewrite a script',async()=>{
 const {w,q,calls}=fixture();
 const data=JSON.parse(w.localStorage.getItem('ecco-video-flow:s'));data.video_ids=[];
 // Remove the video through the same public UI handler.
 q('[aria-label="Remove video 1"]').onclick();
 await q('#video-form').onsubmit({preventDefault(){}});
 assert.equal(calls.length,1);assert.equal(calls[0].path,'longcat/sequence');
 assert.deepEqual(Array.from(calls[0].body.audio_ids),['a']);assert.equal(q('[data-transcript]').value,'Original words');
});
