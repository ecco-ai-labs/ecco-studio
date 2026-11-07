const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,tick}=require('../audio-ui-test-helpers.cjs');
test('real Audio and Video library renderers expose right-side controls and list metadata',async()=>{
 const x=await setup();try{
 x.w.testUI.addRecords(['audio','video'].map(media=>({id:media+'-fixture',kind:'asset',media,stage:'prod',story_id:'video-story',title:'Test '+media,path:media+'/test',created:1700000000,size_bytes:8192,duration:12,settings:{model:'test-model'}})));
 for(const kind of ['audio','video']){
 x.w.EccoWorkspaceUI.openLibrary(kind);await tick();const view=x.q('#'+kind+'-library-view');view.value='list';view.dispatchEvent(new x.w.Event('change',{bubbles:true}));await tick();
 assert.ok(x.q('#page>.section-head .library-browser-tools'));assert.match(x.q('#'+kind+'-library-gallery .library-metadata').textContent,/8.0 KB/);assert.match(x.q('#'+kind+'-library-gallery .library-metadata').textContent,/0:12/);
 assert.ok(x.q('#'+kind+'-library-gallery').className.includes('list'));
 }
 }finally{x.close();}
});
test('all libraries open in List, offer ordered icon views and preserve row identity across views',async()=>{
 const x=await setup({'ecco-library-view':'large','ecco-audio-library-view':'large','ecco-video-library-view':'large','ecco-story-library-view':'large','ecco-workflow-library-view':'large'});try{
 x.w.testUI.addRecords(['image','audio','video'].map(media=>({id:media+'-view',kind:'asset',media,stage:'prod',story_id:'video-story',title:'Test '+media,path:media+'/test.png',created:1700000000,settings:{}})));
 x.w.testUI.addRecords([{id:'workflow-view',kind:'workflow',name:'Example workflow',created:1700000000}]);
 for(const kind of ['image','audio','video','story','workflow']){
 if(kind==='video')x.w.EccoWorkspaceUI.openLibrary(kind);else x.w.testUI.navigate(kind==='image'?'library':kind+'-library');await tick();const view=x.q('#page .library-view-label select'),gallery=x.q('#page .library-files');assert.equal(view.value,'list');assert.deepEqual([...view.options].map(o=>o.textContent),['List','Small icons','Large icons']);const row=gallery.querySelector('.card'),original=row.querySelector('.library-original');
 for(const mode of ['small','large','list']){view.value=mode;view.dispatchEvent(new x.w.Event('change'));await tick();assert.equal(gallery.dataset.fileView,mode);assert.equal(gallery.querySelector('.card'),row);assert.equal(row.querySelector('.library-original'),original);}
 view.value='large';view.dispatchEvent(new x.w.Event('change'));await tick();if(kind==='video')x.w.EccoWorkspaceUI.openLibrary(kind);else x.w.testUI.navigate(kind==='image'?'library':kind+'-library');await tick();assert.equal(x.q('#page .library-view-label select').value,'list');
 }
 }finally{x.close();}
});
test('image preview keeps nested full-size dialog and restores the file opener',async()=>{
 const x=await setup();try{
 x.w.testUI.addRecords([{id:'image-preview',kind:'asset',media:'image',stage:'prod',story_id:'video-story',title:'Image preview',path:'image/preview.png',created:1700000000,settings:{}}]);
 await x.go('library');const file=x.q('.library-file-open');file.focus();file.click();await tick();const outer=x.q('.library-file-preview');assert.ok(outer.open);
 outer.querySelector('img[data-asset]').click();await tick();assert.ok(x.q('#full-image-dialog').open);x.q('#viewer-close').click();await tick();assert.ok(outer.open);
 outer.querySelector('[aria-label="Close file preview"]').click();await tick();assert.equal(x.q('.library-file-preview'),null);assert.equal(x.w.document.activeElement,file);
 }finally{x.close();}
});
test('background refresh preserves active icon view while reopening defaults to List',async()=>{
 const x=await setup();try{
 for(const kind of ['image','audio']){await x.go(kind==='image'?'library':'audio-library');const view=x.q('#page .library-view-label select');view.value='small';view.dispatchEvent(new x.w.Event('change'));await tick();
 x.w.testUI.addRecords([{id:kind+'-refresh',kind:'asset',media:kind,stage:'prod',story_id:'video-story',title:'New file',path:kind+'/refresh',created:1700000000,settings:{}}]);x.w.testUI.refreshStories();await tick();assert.equal(x.q('#page .library-view-label select').value,'small');}
 }finally{x.close();}
});
