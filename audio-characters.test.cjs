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
 Object.defineProperty(w.document,'currentScript',{value:{src:'https://ecco-ai-labs.github.io/ecco-studio/ecco-desk.js'}});
 const observers=[],Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(callback){super(callback);observers.push(this);}};
 w.CSSStyleDeclaration.prototype[Symbol.iterator]=function*(){for(let i=0;i<this.length;i++)yield this.item(i);};w.structuredClone=structuredClone;w.setInterval=()=>0;w.fetch=()=>Promise.reject(Error('No network in UI test'));w.matchMedia=()=>({matches:false,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLMediaElement.prototype.pause=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.confirm=()=>true;
 w.localStorage.setItem('ecco-story-collections-v1',JSON.stringify({collections:[{id:'collection',name:'Stories'}],members:{}}));
 for(const [key,value] of Object.entries(storage))w.localStorage.setItem(key,value);
 w.eval(scripts.join('\n;\n')+`\nwindow.testUI={setAPI:fn=>{api=fn;},setConfig:config=>{state.config={...state.config,...config};},navigate:p=>navigate(p),refreshStories:()=>storyControls(),addRecords:items=>state.records.push(...items),selectStory(id){activeStory=id;localStorage.setItem('ecco-active-story',id);draft=loadDraft();},getDraft:()=>draft,setGPU:ready=>{gpuConnected=()=>ready;}};
 state={records:[{id:'audio-story',kind:'story',title:'Audio Story'},{id:'video-story',kind:'story',title:'Video Story'}],config:{models_ready:{}},storage_pending:false};
 window.testCalls=[];api=async(path,body)=>{window.testCalls.push({path,body});if(path==='stories'){const record={id:'created-story',kind:'story',...body};state.records.push(record);return record;}return {};};refresh=async()=>true;`);
 await tick();w.document.querySelector('#entry-tell-story')?.click();
 if(storage['ecco-active-story'])w.testUI.selectStory(storage['ecco-active-story']);
 const q=s=>w.document.querySelector(s),nav=()=>[...w.document.querySelectorAll('#workspace-production-group .journey-step')].filter(b=>!b.hidden).map(b=>b.dataset.page);
 const choose=async value=>{const field=q('[name=story_format]');field.value=value;field.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();};
 return {w,q,nav,choose,errors,close:()=>{observers.forEach(observer=>observer.disconnect());w.close();},async go(p){w.testUI.navigate(p);await tick();},snapshot:()=>Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]))};
}
const input=(x,selector,value,event='input')=>{const field=x.q(selector);assert.ok(field,selector);field.value=value;field.dispatchEvent(new x.w.Event(event,{bubbles:true}));return field;};

const saved=x=>JSON.parse(x.w.localStorage.getItem('ecco-audio-draft:audio-story'));
async function ready(t,extra={}){const x=await setup({'ecco-active-story':'audio-story',...extra});t.after(()=>x.close());await x.go('audio');x.w.EccoAI={enabled:true};x.w.EccoStorage={ready:true};return x;}
const cast=x=>saved(x).speakers.slice(0,saved(x).character_count);

test('News, podcast and book casts have editable names and stable identities beyond eight characters',async t=>{
 const x=await ready(t);input(x,'[name=genre]','News','change');assert.equal(x.q('[data-character-count]').value,'1');assert.equal(cast(x)[0].name,'Newsreader');
 input(x,'[name=genre]','Podcast','change');assert.equal(cast(x).length,2);assert.deepEqual(cast(x).map(s=>s.name),['Host','Guest']);
 input(x,'[data-character-count]','10','change');assert.equal(cast(x).length,10);const original=cast(x)[9].id;
 input(x,'[data-character-name="'+original+'"]','Grandmother','change');assert.equal(cast(x)[9].name,'Grandmother');
 input(x,'[data-character-count]','2','change');input(x,'[data-character-count]','10','change');assert.equal(cast(x)[9].id,original);assert.equal(cast(x)[9].name,'Grandmother');
 input(x,'[name=model]','indicf5','change');assert.equal(cast(x)[9].name,'Grandmother');assert.equal(cast(x)[9].id,original);
 await x.go('audio');assert.equal(cast(x).length,10);assert.equal(x.q('[data-character-name="'+original+'"] ').value,'Grandmother');assert.deepEqual(x.errors,[]);
});

test('Text uploads report extraction limits and reject unsupported or unreadable documents',async t=>{
 const x=await ready(t),reader=x.w.EccoAudioScript.readSource;
 const result=await reader({name:'paper.txt',size:24,text:async()=> 'Sample research paper.'});assert.equal(result.text,'Sample research paper.');assert.equal(result.truncated,false);
 const large=await reader({name:'topic.md',size:21000,text:async()=> 'a'.repeat(21000)});assert.equal(large.text.length,20000);assert.equal(large.truncated,true);
 await assert.rejects(reader({name:'paper.exe',size:12}),/PDF, TXT/);await assert.rejects(reader({name:'paper.txt',size:0,text:async()=>''}),/No readable text/);
});

test('Workflow scheduling stays unavailable until the connected service advertises it',async t=>{
 const x=await ready(t);input(x,'[name=genre]','Podcast','change');x.q('#save-audio-workflow').click();await tick();
 assert.equal(x.q('[data-run-workflow]').disabled,true);assert.match(x.q('[data-status]').textContent,/workspace service update/);
 assert.match(x.q('.audio-workflow-flow').textContent,/Podcast topic/);
 const w=x.w;w.testUI.setConfig({audio_workflows:{available:true}});x.w.EccoAudioWorkflow.show();await tick();
 assert.equal(x.q('[data-run-workflow]').disabled,false);
});

test('Workflow activation first saves a snapshot and uses explicit enable; Run Now keeps saved schedules',async t=>{
 const x=await ready(t);input(x,'[name=genre]','News','change');x.w.testUI.setConfig({audio_workflows:{available:true}});
 const calls=[];x.w.testUI.setAPI(async(path,body)=>{calls.push({path,body});if(path.endsWith('/save')){const record={...body,kind:'workflow',status:'paused',unsaved_changes:false,version:1};x.w.testUI.addRecords([record]);return record;}return {id:body.id,kind:'workflow',workflow_type:'audio',name:'News',status:'active',source_mode:'news',next_run:'2026-10-25T00:00:00Z',audio_snapshot:{speakers:[]}};});
 x.q('#save-audio-workflow').click();await tick();x.q('[data-enable-workflow]').click();await tick();
 assert.deepEqual(calls.map(c=>c.path),['audio/workflows/save','audio/workflows/control']);assert.equal(calls[1].body.action,'enable');assert.equal(calls[0].body.audio_snapshot.character_count,1);
 calls.length=0;x.q('[data-run-workflow]').click();await tick();assert.deepEqual(calls.map(c=>c.path),['audio/workflows/control']);assert.equal(calls[0].body.action,'run');assert.ok(calls[0].body.request_id);
});

test('Workflow model editor retains only active characters and uses model-specific voice options',async t=>{
 const x=await ready(t);input(x,'[name=genre]','Podcast','change');input(x,'[data-character-count]','4','change');input(x,'[data-character-count]','2','change');x.q('#save-audio-workflow').click();await tick();x.q('[data-node=model]').click();await tick();
 assert.equal(x.w.document.querySelectorAll('#audio-workflow-step fieldset').length,2);input(x,'[name=audio_model]','indicf5','change');assert.equal(x.q('[name=voice_0] option').value,'kan_f');assert.equal(x.q('[name=language_0]').value,'Hindi');x.q('#audio-workflow-step form').requestSubmit();await tick();assert.equal(x.q('#audio-workflow-step'),null);
});


test('Save as Workflow copies the current audio setup when no story is selected',async t=>{
 const x=await setup();t.after(()=>x.close());await x.go('audio');input(x,'[name=genre]','Podcast','change');x.q('#save-audio-workflow').click();await tick();
 assert.match(x.q('[data-node=model]').textContent,/indic-mio.*2 speaker/);assert.match(x.q('[data-node=source]').textContent,/Podcast/);assert.match(x.q('[data-node=output]').textContent,/CPU/);x.q('[data-node=source]').click();await tick();assert.equal(x.q('[name=lookback]').disabled,true);assert.match(x.q('[name=prompt]').parentElement.textContent,/Topic \/ Paper Instructions/);
});
