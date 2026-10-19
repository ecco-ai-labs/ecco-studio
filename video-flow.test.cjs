const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),fs=require('node:fs');
function fixture(){
 const w=new JSDOM('<form id="video-form"><section data-section="model"><div class="generation-section-heading"></div><select id="job-model"><option value="longcat-avatar-1.5">LongCat</option><option value="wan-5b">Wan</option></select></section><section data-section="references"></section><section data-section="prompt"></section><section data-section="controls"></section><div class="generation-footer"><button id="generate-video">Generate</button><p id="video-status"></p></div></form>',{url:'https://example.test',runScripts:'outside-only'}).window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.onclose?.();};
 const records=[{id:'i',kind:'asset',media:'image',title:'Avatar'},{id:'v',kind:'asset',media:'video',title:'Style reference'},{id:'a',kind:'asset',media:'audio',title:'Speech',seconds:6,story_id:'s',settings:{lines:[{text:'Original words'}]}}];
 const ctx={data:{reference_ids:['i'],video_reference_ids:['v'],audio_reference_ids:['a']}},calls=[];
 Object.assign(w,{state:{records},activeStory:'s',renderPage:()=>{},boards:()=>[],media:()=>'',hydrateMedia:()=>{},gpuConnected:()=>true,modelAvailable:()=>true,modelSettings:()=>({resolution:'832x480'}),setGenerationBusy:()=>{},refresh:async()=>{},notice:()=>{},currentStory:()=>({title:'Test'}),modelPayload:()=>({})});
 w.EccoGeneration={context:()=>ctx,trackJob:()=>{}};
 w.api=async(path,body)=>{calls.push({path,body});return path==='ai/enhance'?{revisions:body.fields.map(f=>({id:f.id,text:'Directed shot: '+f.text})),questions:[]}:{id:'job'};};
 w.eval(fs.readFileSync(__dirname+'/video-flow.js','utf8'));return {w,calls,ctx,q:s=>w.document.querySelector(s)};
}
test('ordered steps, existing assets, camera/eye controls and AI video context reach the render',async()=>{
 const {w,calls,q}=fixture();
 assert.deepEqual([...w.document.querySelectorAll('[data-step]')].map(x=>x.dataset.step),['2','3','4','5']);
 assert.equal(q('[data-transcript]').value,'Original words');
 const eye=q('[data-field=eye]');eye.value='Look left then blink';eye.dispatchEvent(new w.Event('input'));
 await q('[data-write]').onclick();assert.equal(calls[0].path,'ai/enhance');assert.deepEqual(Array.from(calls[0].body.video_reference_ids),['v']);assert.match(calls[0].body.fields[0].text,/Look left then blink/);
 await q('#video-form').onsubmit({preventDefault(){}});
 assert.equal(calls[1].path,'longcat/sequence');assert.equal(calls[1].body.shots[0].image_id,'i');assert.equal(calls[1].body.shots[0].seconds,6);assert.match(calls[1].body.shots[0].prompt,/Look left then blink/);assert.deepEqual(Array.from(calls[1].body.audio_ids),['a']);
});
test('changing reference inputs invalidates previously analyzed video direction',async()=>{
 const {calls,q}=fixture();await q('[data-write]').onclick();
 q('[data-brief]').value='A different scene';q('[data-brief]').oninput();
 await q('#video-form').onsubmit({preventDefault(){}});
 assert.equal(calls.length,3);assert.equal(calls[1].path,'ai/enhance');assert.equal(calls[2].path,'longcat/sequence');
});
test('selecting speech does not silently change model; incompatible render gives actionable feedback',async()=>{
 const {calls,q}=fixture();q('#job-model').value='wan-5b';await q('[data-write]').onclick();
 await q('#video-form').onsubmit({preventDefault(){}});
 assert.equal(q('#job-model').value,'wan-5b');assert.equal(calls.length,1);assert.match(q('#video-status').textContent,/Select LongCat/);
});

test('one library selector preserves selections and refreshed assets are visible',async()=>{
 const {w,q}=fixture();
 const old=w.api;w.api=async(path,body)=>path==='state'?{records:w.state.records,config:{}}:old(path,body);
 await q('[data-browse]').onclick();
 assert.equal(w.document.querySelectorAll('[data-asset-choice]').length,1);
 assert.equal(q('[data-asset-choice]').dataset.assetChoice,'i');
 q('[data-cancel]').onclick();q('[data-library]').value='audio';await q('[data-browse]').onclick();
 assert.equal(q('[data-asset-choice]').dataset.assetChoice,'a');
 assert.match(q('[data-list=image]').textContent,/Image Library: Avatar/);
});
test('audio from another story loads all 100 shots in a dropdown with one editor',()=>{
 const {w,q}=fixture();
 w.state.records.find(x=>x.id==='a').story_id='other-story';
 w.state.records.push({id:'b',kind:'board',story_id:'other-story',title:'News',created:1,scenes:Array.from({length:100},(_,i)=>({title:'News '+i,seconds:1}))});
 q('[data-load]').onclick();
 assert.equal(q('[data-shot]').options.length,100);
 assert.equal(w.document.querySelectorAll('[data-shots] fieldset').length,1);
 assert.equal(w.document.querySelectorAll('[data-shots] input[type=checkbox]').length,0);
 assert.equal(q('[data-transcript]').value,'Original words');
 q('[data-shot]').value='99';q('[data-shot]').onchange();assert.equal(q('[data-shot]').value,'99');
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
