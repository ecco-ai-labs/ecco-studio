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
