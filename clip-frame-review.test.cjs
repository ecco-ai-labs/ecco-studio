const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,tick}=require('./audio-ui-test-helpers.cjs');
const {IDBFactory}=require('fake-indexeddb');
async function fixture(t){
 const x=await setup({'ecco-active-story':'video-story'});t.after(()=>x.close());const w=x.w;
 w.indexedDB=new IDBFactory();
 Object.defineProperty(w.HTMLMediaElement.prototype,'duration',{get:()=>30,configurable:true});
 Object.defineProperty(w.HTMLMediaElement.prototype,'readyState',{get:()=>4,configurable:true});
 Object.defineProperty(w.HTMLMediaElement.prototype,'currentTime',{get(){return this._time||0;},set(n){this._time=n;queueMicrotask(()=>this.dispatchEvent(new w.Event('seeked')));},configurable:true});
 for(const prop of ['videoWidth','videoHeight'])Object.defineProperty(w.HTMLVideoElement.prototype,prop,{get:()=>prop==='videoWidth'?1280:720,configurable:true});
 w.HTMLMediaElement.prototype.load=function(){queueMicrotask(()=>this.dispatchEvent(new w.Event('loadeddata')));};
 w.HTMLMediaElement.prototype.play=()=>Promise.resolve();
 w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,/9j/';
 w.URL.createObjectURL=()=> 'blob:fixture';w.URL.revokeObjectURL=()=>{};
 x.w.testUI.addRecords([{id:'film',kind:'asset',media:'video',story_id:'video-story',title:'Munni film',path:'film.mp4',created:1,stage:'prod'}]);
 x.w.testUI.setAPI(async(path,body)=>{x.w.testCalls.push({path,body});if(path==='frame-editor/status')return {available:true};if(path.startsWith('media/'))return {buffer:new Uint8Array([1]),mime:'video/mp4'};return {};});
 await x.go('render');await x.go('render');await w.EccoFrameReview.open({assetId:'film'});await tick();return x;
}
test('frame editor is reachable from Video Review and video AI menu',async t=>{
 const x=await fixture(t);assert.ok(x.q('#video-review-panel [data-frame-review-entry]'));assert.ok(x.q('#video-flow-ai [data-frame-review-entry]'));assert.equal(x.q('[data-cf-grid]').children.length,25);assert.equal(x.q('[data-cf-clips]').children.length,10);
});
test('cherry-pick, remove, reinsert, undo and save preserve source IDs',async t=>{
 const x=await fixture(t),q=x.q;
 q('[data-cf-range]').value='128, 132, 137-140';q('[data-cf-select-range]').click();await tick();
 assert.equal(q('[data-cf-count]').textContent,'6 selected');assert.equal(q('[data-cf-selected]').textContent,'128, 132, 137–140');
 q('[data-cf-remove]').click();assert.equal(q('[data-frame="128"]').dataset.removed,'true');assert.equal(q('[data-frame="129"]').dataset.removed,'false');assert.match(q('[data-cf-impact]').textContent,/29.76s/);
 q('[data-frame="132"]').click();q('[data-cf-restore]').click();assert.equal(q('[data-frame="132"]').dataset.removed,'false');
 q('[data-cf-undo]').click();await tick();assert.equal(q('[data-frame="132"]').dataset.removed,'true');
 q('[data-cf-save]').click();await tick();q('[data-cf-close]').click();await tick();await x.w.EccoFrameReview.open({assetId:'film'});await tick();
 assert.match(q('[data-cf-impact]').textContent,/6 frames removed/);assert.equal(q('[data-cf-undo]').disabled,false);
 assert.equal(x.w.testCalls.filter(c=>['videos','longcat/generate','longcat/sequence','images'].includes(c.path)).length,0);
});
test('repair records exact target IDs and context without starting GPU inference',async t=>{
 const x=await fixture(t),q=x.q;q('[data-cf-range]').value='128-140';q('[data-cf-select-range]').click();await tick();
 assert.match(q('[data-cf-context]').textContent,/118–150|118-150/);q('[data-cf-instructions]').value='Keep the tree rooted';q('[data-cf-prepare]').click();await tick();
 const saved=await x.w.EccoFrameReview.readDraft('frames:local:video-story:film');assert.equal(saved.doc.repairs[0].windows[0].from,118);assert.equal(saved.doc.repairs[0].windows[0].to,150);assert.equal(saved.doc.repairs[0].original_frame_ids.length,13);
 assert.equal(x.w.testCalls.filter(c=>c.path==='frame-editor/export').length,0);
});
test('changing segment length at the final clip and crossing groups is safe',async t=>{
 const x=await fixture(t),q=x.q;q('[data-cf-clips]').lastElementChild.click();q('[data-cf-seconds]').value='4';q('[data-cf-seconds]').dispatchEvent(new x.w.Event('change'));await tick();
 assert.equal(q('[data-cf-clips]').children.length,8);assert.equal(q('[data-cf-grid]').firstElementChild.dataset.frame,'1');
 q('[data-cf-page-size]').value='100';q('[data-cf-page-size]').dispatchEvent(new x.w.Event('change'));await tick();assert.equal(q('[data-cf-grid]').children.length,100);
});
test('definitive export rejection permits retry with the updated edit',async t=>{
 const x=await fixture(t),q=x.q,submitted=[];
 assert.equal(q('[data-cf-export]').disabled,false,JSON.stringify(x.w.testCalls));
 x.w.testUI.setAPI(async(path,body)=>{if(path==='frame-editor/export'){submitted.push(body);if(submitted.length===1)throw Object.assign(Error('Export busy'),{status:429});return {id:body.request_id};}if(path.startsWith('frame-editor/jobs/'))return {status:'failed',error:'fixture'};return {};});
 q('[data-cf-range]').value='128';q('[data-cf-select-range]').click();q('[data-cf-remove]').click();await q('[data-cf-export]').onclick();await tick();
 assert.equal(submitted.length,1,q('[data-cf-status]').textContent);
 assert.equal(q('[data-cf-export]').textContent,'Export edited MP4');
 q('[data-cf-range]').value='132';q('[data-cf-select-range]').click();q('[data-cf-remove]').click();await q('[data-cf-export]').onclick();await tick();
 assert.equal(submitted.length,2);assert.notEqual(submitted[0].request_id,submitted[1].request_id);assert.deepEqual(Array.from(submitted[1].removed),[128,132]);
});
