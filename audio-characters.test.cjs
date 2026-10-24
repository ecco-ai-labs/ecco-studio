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
const planFor=(x,texts)=>({opening:null,segments:texts.map((text,i)=>({character_id:cast(x)[i%cast(x).length].id,text}))});
function mockAI(x,plan){const calls=[];x.w.testUI.setAPI(async(path,body)=>{calls.push({path,body});return {revisions:[{id:'audio_plan',text:JSON.stringify(plan)}],questions:[]};});return calls;}
function brief(x,turns=4){x.q('[data-generate-audio-script]').click();input(x,'[data-instructions]','Discuss the uploaded research in Hindi.');input(x,'[data-script-turns]',String(turns));x.q('#audio-script-instructions form').requestSubmit();}

test('News, podcast and book casts have editable names and stable identities beyond eight characters',async t=>{
 const x=await ready(t);input(x,'[name=genre]','News','change');assert.equal(x.q('[data-character-count]').value,'1');assert.equal(cast(x)[0].name,'Newsreader');
 input(x,'[name=genre]','Podcast','change');assert.equal(cast(x).length,2);assert.deepEqual(cast(x).map(s=>s.name),['Host','Guest']);
 input(x,'[data-character-count]','10','change');assert.equal(cast(x).length,10);const original=cast(x)[9].id;
 input(x,'[data-character-name="'+original+'"]','Grandmother','change');assert.equal(cast(x)[9].name,'Grandmother');
 input(x,'[data-character-count]','2','change');input(x,'[data-character-count]','10','change');assert.equal(cast(x)[9].id,original);assert.equal(cast(x)[9].name,'Grandmother');
 input(x,'[name=model]','indicf5','change');assert.equal(cast(x)[9].name,'Grandmother');assert.equal(cast(x)[9].id,original);
 await x.go('audio');assert.equal(cast(x).length,10);assert.equal(x.q('[data-character-name="'+original+'"] ').value,'Grandmother');assert.deepEqual(x.errors,[]);
});

test('A topic-only podcast opens as a modal, preserves same-voice characters, and applies only on review',async t=>{
 const x=await ready(t);input(x,'[name=genre]','Podcast','change');const actors=cast(x);
 input(x,'[data-character-name="'+actors[0].id+'"]','Asha','change');input(x,'[data-character-name="'+actors[1].id+'"]','Ravi','change');
 x.q('[data-open-controls]').click();x.q('[data-speaker-tab="'+actors[1].id+'"]').click();input(x,'[data-speaker-field=voice]',actors[0].voice,'change');
 const plan=planFor(x,['नमस्ते।','नमस्ते आशा।','क्या नया है?','आइए चर्चा करें।']),calls=mockAI(x,plan);
 brief(x);assert.equal(x.q('#audio-script-instructions').open,true);assert.equal(x.q('#audio-script-instructions').parentElement,x.w.document.body);await tick();
 assert.equal(calls.length,1);assert.equal(calls[0].body.context.language,'Hindi');assert.equal(calls[0].body.context.lines[1].name,'Ravi');
 assert.equal(saved(x).lines[0].text,'');assert.equal(x.q('[data-script-review]').hidden,false);
 input(x,'[data-review-text]','स्वागत है।');x.q('[data-apply-script]').click();assert.equal(saved(x).lines.length,4);assert.equal(saved(x).lines[0].text,'स्वागत है।');assert.equal(saved(x).lines[1].speaker_id,actors[1].id);assert.equal(cast(x).length,2);assert.equal(x.q('#audio-script-instructions'),null);assert.deepEqual(x.errors,[]);
});

test('Applied multi-turn script uses later voice choices, emotion, pitch and speed in generation',async t=>{
 const x=await ready(t);input(x,'[name=genre]','Podcast','change');mockAI(x,planFor(x,['Host speaks.','Guest answers.','Host follows up.','Guest closes.']));brief(x);await tick();x.q('[data-apply-script]').click();
 const guest=cast(x)[1];x.q('[data-speaker-tab="'+guest.id+'"]').click();input(x,'[data-speaker-field=voice]','en_male','change');input(x,'[data-speaker-field=emotion]','happy','change');input(x,'[name=pitch]','2');input(x,'[name=speed]','1.25');
 const calls=[];x.w.EccoAudioStudio.connect({storageIndependentOfGPU:true,status:async()=>({routing_version:1,compute:{cpu:{ready:true,models:['indic-mio']}}}),list:async()=>[],generate:async body=>{calls.push(body);return{id:'voice-job'};},job:async()=>({id:'voice-job',status:'done'}),mediaURL:async()=>'',download:async()=>{}});await tick();
 x.q('#audio-form').requestSubmit();await tick();assert.equal(calls.length,1);assert.equal(calls[0].pitch,2);assert.equal(calls[0].speed,1.25);assert.equal(calls[0].lines[1].voice,'en_male');assert.equal(calls[0].lines[1].emotion,'happy');assert.equal(calls[0].lines[3].voice,'en_male');assert.equal(calls[0].lines.map(l=>l.text).join(' '),'Host speaks. Guest answers. Host follows up. Guest closes.');assert.deepEqual(x.errors,[]);
});

test('Source text is sent as evidence; closing or stale source edits preserve the existing script',async t=>{
 const x=await ready(t);input(x,'[data-single-script]','Keep this narration.');const calls=mockAI(x,planFor(x,['A factual narration.']));
 x.q('[data-generate-audio-script]').click();input(x,'[data-instructions]','Explain the paper in English.');input(x,'[data-script-language]','English','change');input(x,'[data-source-text]','Paper: water boils under these stated conditions.');x.q('#audio-script-instructions form').requestSubmit();await tick();
 assert.match(calls[0].body.context.summary,/water boils/);assert.equal(calls[0].body.context.language,'English');x.q('#audio-script-instructions').close();assert.equal(saved(x).single_text,'Keep this narration.');
 let resolve;x.w.testUI.setAPI(()=>new Promise(r=>resolve=r));x.q('[data-generate-audio-script]').click();x.q('#audio-script-instructions form').requestSubmit();await tick();input(x,'[data-single-script]','New manual edit.');resolve({revisions:[{id:'audio_plan',text:JSON.stringify(planFor(x,['Late suggestion.']))}],questions:[]});await tick();assert.match(x.q('[data-script-status]').textContent,/changed/);assert.equal(saved(x).single_text,'New manual edit.');assert.equal(x.q('[data-script-review]').hidden,true);
});

test('Unknown characters and oversized plans are rejected without modifying draft',async t=>{
 const x=await ready(t);mockAI(x,{opening:null,segments:[{character_id:'invented',text:'Bad assignment.'}]});brief(x);await tick();assert.match(x.q('[data-script-status]').textContent,/invalid character/);assert.equal(saved(x).single_text,'');
 const fn=x.w.EccoAudioScript.validatePlan;assert.throws(()=>fn({opening:null,segments:[{character_id:cast(x)[0].id,text:'a'.repeat(4001)}]},cast(x),1),/4,000/);
 assert.throws(()=>fn({opening:null,segments:[]},cast(x),1),/requested number/);
});

test('News without a source uses cited research before writing a single narrator script',async t=>{
 const x=await ready(t);input(x,'[name=genre]','News','change');const requests=[],plan=planFor(x,['आज की खबरें।']);
 x.w.testUI.setAPI(async(path,body)=>{requests.push({path,body});if(path==='ai/news/research')return {research:{items:[{title:'Verified item',summary:'Supported facts',sources:[{title:'Source',url:'https://example.org/news'}]}]}};return {revisions:[{id:'audio_plan',text:JSON.stringify(plan)}],questions:[]};});
 brief(x);await tick();assert.deepEqual(requests.map(r=>r.path),['ai/news/research','ai/enhance']);assert.match(requests[1].body.context.summary,/Supported facts/);assert.equal(x.q('[data-script-sources] a').href,'https://example.org/news');x.q('[data-apply-script]').click();assert.equal(saved(x).single_text,'आज की खबरें।');
});

test('Text uploads report extraction limits and reject unsupported or unreadable documents',async t=>{
 const x=await ready(t),reader=x.w.EccoAudioScript.readSource;
 const result=await reader({name:'paper.txt',size:24,text:async()=> 'Sample research paper.'});assert.equal(result.text,'Sample research paper.');assert.equal(result.truncated,false);
 const large=await reader({name:'topic.md',size:21000,text:async()=> 'a'.repeat(21000)});assert.equal(large.text.length,20000);assert.equal(large.truncated,true);
 await assert.rejects(reader({name:'paper.exe',size:12}),/PDF, TXT/);await assert.rejects(reader({name:'paper.txt',size:0,text:async()=>''}),/No readable text/);
});

test('Closing a pending script modal and navigating away never applies a late result',async t=>{
 const x=await ready(t);input(x,'[data-single-script]','Original script.');let finish;x.w.testUI.setAPI(()=>new Promise(resolve=>finish=resolve));brief(x);await tick();x.q('#audio-script-instructions').close();
 finish({revisions:[{id:'audio_plan',text:JSON.stringify(planFor(x,['Late script.']))}],questions:[]});await tick();assert.equal(saved(x).single_text,'Original script.');assert.equal(x.q('#audio-script-instructions'),null);
 await x.go('images');assert.equal(x.q('[data-audio-characters]'),null);assert.equal(x.q('[data-generate-audio-script]'),null);assert.ok(x.q('#image-form [data-open-prompt]'));assert.deepEqual(x.errors,[]);
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
 assert.match(x.q('[data-node=model]').textContent,/indic-mio.*2 speaker/);assert.match(x.q('[data-node=source]').textContent,/Podcast/);assert.match(x.q('[data-node=output]').textContent,/CPU/);
});
