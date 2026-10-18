const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const tick=()=>new Promise(resolve=>setTimeout(resolve,35));
async function setup(storage={}){
 const html=fs.readFileSync(__dirname+'/index.html','utf8');
 const scripts=[...html.matchAll(/<script(?:\s+src="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]?fs.readFileSync(__dirname+'/'+m[1].split('?')[0],'utf8'):m[2]);
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g,''),{runScripts:'outside-only',url:'https://ecco-ai-labs.github.io/ecco-studio/',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
 const observers=[],Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(callback){super(callback);observers.push(this);}};
 w.structuredClone=structuredClone;w.setInterval=()=>0;w.fetch=()=>Promise.reject(Error('No network in UI test'));w.matchMedia=()=>({matches:false,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;
 w.localStorage.setItem('ecco-story-collections-v1',JSON.stringify({collections:[{id:'collection',name:'Stories'}],members:{}}));
 for(const [key,value] of Object.entries(storage))w.localStorage.setItem(key,value);
 w.eval(scripts.join('\n;\n')+`\nwindow.testUI={navigate:p=>navigate(p),refreshStories:()=>storyControls(),addRecords:items=>state.records.push(...items),selectStory(id){activeStory=id;localStorage.setItem('ecco-active-story',id);draft=loadDraft();},getDraft:()=>draft};
 state={records:[{id:'audio-story',kind:'story',title:'Audio Story'},{id:'video-story',kind:'story',title:'Video Story'}],config:{models_ready:{}},storage_pending:false};
 window.testCalls=[];api=async(path,body)=>{window.testCalls.push({path,body});if(path==='stories'){const record={id:'created-story',kind:'story',...body};state.records.push(record);return record;}return {};};refresh=async()=>true;`);
 await tick();w.document.querySelector('#entry-tell-story')?.click();
 const q=s=>w.document.querySelector(s),nav=()=>[...w.document.querySelectorAll('#workspace-production-group .journey-step')].filter(b=>!b.hidden).map(b=>b.dataset.page);
 const choose=async value=>{const field=q('[name=story_format]');field.value=value;field.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();};
 return {w,q,nav,choose,errors,close:()=>{observers.forEach(observer=>observer.disconnect());w.close();},async go(p){w.testUI.navigate(p);await tick();},snapshot:()=>Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]))};
}
test('video references switch libraries, retain each selection, and never submit videos as images',async()=>{
 const x=await setup({'ecco-active-story':'video-story'});
 x.w.testUI.addRecords([{id:'image-1',kind:'asset',media:'image',title:'River frame',story_id:'video-story',stage:'prod'},{id:'video-1',kind:'asset',media:'video',title:'River clip',story_id:'video-story',stage:'prod'},{id:'deleted-clip',kind:'asset',media:'video',title:'Deleted',deleted:true}]);
 await x.go('render');
 let form=x.q('#video-form'),picker=x.q('[data-reference-library]');assert.equal(picker.value,'image');
 x.q('[data-open-library]').click();assert.equal(x.q('#generation-library-picker h2').textContent,'Image Library');
 assert.deepEqual([...x.w.document.querySelectorAll('#generation-library-picker [data-image]')].map(b=>b.dataset.image),['image-1']);
 x.q('[data-image="image-1"]').click();x.q('[data-use]').click();assert.ok(x.q('[data-selected] img'));
 picker.value='video';picker.dispatchEvent(new x.w.Event('change',{bubbles:true}));
 assert.equal(x.q('[data-selected]').children.length,0);x.q('[data-open-library]').click();assert.equal(x.q('#generation-library-picker h2').textContent,'Video Library');
 assert.deepEqual([...x.w.document.querySelectorAll('#generation-library-picker [data-image]')].map(b=>b.dataset.image),['video-1']);
 x.q('[data-image="video-1"]').click();x.q('[data-use]').click();assert.ok(x.q('[data-selected] video'));
 let c=x.w.EccoGeneration.context(form);assert.deepEqual(Array.from(c.data.reference_ids),['image-1']);assert.deepEqual(Array.from(c.data.video_reference_ids),['video-1']);
 const ai=x.w.EccoGeneration.aiContext(form);assert.equal(ai.reference_ids.length,0);assert.equal(ai.context.video_references[0].title,'River clip');
 form.requestSubmit();await tick();assert.equal(x.w.testCalls.length,0);assert.match(x.q('#notice').textContent,/Generation from video references is not connected yet/);
 await x.go('images');await x.go('render');form=x.q('#video-form');picker=x.q('[data-reference-library]');assert.equal(picker.value,'video');assert.ok(x.q('[data-selected] video'));
 picker.value='image';picker.dispatchEvent(new x.w.Event('change',{bubbles:true}));assert.ok(x.q('[data-selected] img'));assert.equal(x.q('[data-selected] video'),null);
 assert.deepEqual(x.errors,[]);x.close();
});
test('Image References keeps the Image Library picker',async()=>{
 const x=await setup();await x.go('images');assert.ok(x.q('[data-section="references"] .generation-section-heading'),JSON.stringify({errors:x.errors,html:x.q('#page').innerHTML.slice(0,1500)}));assert.equal(x.q('[data-section="references"] .generation-section-heading').textContent,'References');assert.equal(x.q('[data-reference-library]'),null);assert.equal(x.q('[data-open-library]').textContent,'Image Library');assert.deepEqual(x.errors,[]);x.close();
});
test('Audio Genre and Recording title belong to a collapsed References dropdown',async()=>{
 const x=await setup();await x.go('audio');const refs=x.q('[data-section="references"]');assert.equal(refs.querySelector('details').open,false);assert.ok(refs.querySelector('[name=genre]'));assert.ok(refs.querySelector('[name=title]'));assert.equal(x.q('[data-settings] [name=genre]'),null);assert.equal(x.q('[data-settings] [name=title]'),null);assert.ok(x.q('[data-settings] [name=speed]'));assert.deepEqual(x.errors,[]);x.close();
});
