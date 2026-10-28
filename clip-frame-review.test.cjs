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
test('repair review replaces only approved IDs and supports undo',async t=>{
 const x=await fixture(t),q=x.q;
 const generated=[];let candidate;
 x.w.testUI.setAPI(async(path,body)=>{
  if(path==='frame-editor/repair-status')return {available:true,workers:[{id:'gpu',available:true}]};
  if(path==='frame-editor/repair'){generated.push(body);candidate={id:body.request_id,asset_id:'film',fps:25,total:750,frames:Object.fromEntries(body.original_frame_ids.map(n=>[n,'data:image/jpeg;base64,/9j/']))};return {id:body.request_id};}
  if(path.startsWith('frame-editor/repairs/'))return {status:'done'};
  if(path.startsWith('frame-editor/repair-candidate/'))return candidate;
  return {};
 });
 q('[data-cf-range]').value='128,132,137-140';q('[data-cf-select-range]').click();await tick();
 q('[data-cf-instructions]').value='Keep the tree rooted';await q('[data-cf-prepare]').onclick();await tick();
 assert.equal(generated.length,0);assert.ok(q('[data-r-target]').textContent.includes('128, 132, 137–140'));
 q('[data-r-worker]').value='gpu';q('[data-r-worker]').dispatchEvent(new x.w.Event('change'));
 await q('[data-r-generate]').onclick();await tick();assert.equal(generated.length,1);
 let saved=await x.w.EccoFrameReview.readDraft('frames:local:video-story:film');assert.equal(Object.keys(saved.doc.replacements).length,0);
 assert.equal(q('[data-r-accept]').disabled,false);q('[data-r-accept]').click();await tick();
 saved=await x.w.EccoFrameReview.readDraft('frames:local:video-story:film');assert.deepEqual(Object.keys(saved.doc.replacements),['128','132','137','138','139','140']);
 assert.equal(q('.cf-repair-dialog'),null);assert.ok(q('#clip-frame-dialog').open);
 q('[data-cf-undo]').click();await q('[data-cf-save]').onclick();await tick();saved=await x.w.EccoFrameReview.readDraft('frames:local:video-story:film');assert.equal(Object.keys(saved.doc.replacements).length,0);
});
test('selected playback displays no intervening frames and entire clip ignores selection',async t=>{
 const x=await fixture(t),q=x.q;
 q('[data-cf-range]').value='3,7,12';q('[data-cf-select-range]').click();await tick();
 q('[data-cf-play-scope]').value='selected';q('[data-cf-play-scope]').dispatchEvent(new x.w.Event('change'));
 const seen=[];const observer=new x.w.MutationObserver(()=>{const m=q('[data-cf-frame-tag]').textContent.match(/#(\d+)/);if(m)seen.push(Number(m[1]));});observer.observe(q('[data-cf-frame-tag]'),{childList:true});
 await q('[data-cf-play]').onclick();await new Promise(r=>setTimeout(r,180));observer.disconnect();
 assert.deepEqual([...new Set(seen)],[3,7,12]);
 q('[data-cf-play-scope]').value='entire';q('[data-cf-play-scope]').dispatchEvent(new x.w.Event('change'));await q('[data-cf-play]').onclick();assert.match(q('[data-cf-frame-tag]').textContent,/#0001/);q('[data-cf-play]').click();
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
