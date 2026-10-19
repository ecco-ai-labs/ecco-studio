const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/workflow-start.js','utf8');
function setup(){
 const dom=new JSDOM('<h1 id="heading"></h1><div id="page"><button id="workflow-library-new">New Workflow</button><button id="new-audio-workflow">New Audio Workflow</button></div><div id="workflow-library"><button class="tree-folder">New workflow</button><article class="text-library-row"><button class="tree-folder" id="saved">Saved workflow</button></article></div>',{runScripts:'outside-only'});
 const w=dom.window;w.page='workflow-library';w.calls=[];w.EccoWorkflows={show:()=>w.calls.push('video'),showLibrary:()=>w.calls.push('library')};w.EccoAudioWorkflow={show:()=>w.calls.push('audio')};
 w.document.querySelector('#workflow-library-new').onclick=()=>w.calls.push('legacy');
 w.document.querySelector('#saved').onclick=()=>w.calls.push('saved');
 w.eval(source);return w;
}
for(const type of ['audio','video'])test(type+' starts through the shared first step',()=>{
 const w=setup();w.document.querySelector('#workflow-library-new').click();
 assert.equal(w.document.querySelector('[data-continue]').disabled,true);assert.equal(w.calls.length,0);
 w.document.querySelector('[value='+type+']').click();w.document.querySelector('[data-continue]').click();assert.deepEqual(w.calls,[type]);
});
test('sidebar creation uses the choice screen; existing workflow opens directly',()=>{
 const w=setup();w.document.querySelector('#saved').click();assert.deepEqual(w.calls,['saved']);
 w.document.querySelector('#workflow-library > .tree-folder').click();assert.ok(w.document.querySelector('#workflow-start'));
 w.document.querySelector('[data-cancel]').click();assert.deepEqual(w.calls,['saved','library']);
});
test('duplicate Audio entry is hidden',()=>{
 const w=setup();assert.equal(w.getComputedStyle(w.document.querySelector('#new-audio-workflow')).display,'none');
});
