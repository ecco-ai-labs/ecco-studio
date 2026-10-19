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
 w.structuredClone=structuredClone;w.setInterval=()=>0;w.fetch=()=>Promise.reject(Error('No network in UI test'));w.matchMedia=()=>({matches:false,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLMediaElement.prototype.pause=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.confirm=()=>true;
 w.localStorage.setItem('ecco-story-collections-v1',JSON.stringify({collections:[{id:'collection',name:'Stories'}],members:{}}));
 for(const [key,value] of Object.entries(storage))w.localStorage.setItem(key,value);
 w.eval(scripts.join('\n;\n')+`\nwindow.testUI={setAPI:fn=>{api=fn;},navigate:p=>navigate(p),refreshStories:()=>storyControls(),addRecords:items=>state.records.push(...items),selectStory(id){activeStory=id;localStorage.setItem('ecco-active-story',id);draft=loadDraft();},getDraft:()=>draft,setGPU:ready=>{gpuConnected=()=>ready;}};
 state={records:[{id:'audio-story',kind:'story',title:'Audio Story'},{id:'video-story',kind:'story',title:'Video Story'}],config:{models_ready:{}},storage_pending:false};
 window.testCalls=[];api=async(path,body)=>{window.testCalls.push({path,body});if(path==='stories'){const record={id:'created-story',kind:'story',...body};state.records.push(record);return record;}return {};};refresh=async()=>true;`);
 await tick();w.document.querySelector('#entry-tell-story')?.click();
 if(storage['ecco-active-story'])w.testUI.selectStory(storage['ecco-active-story']);
 const q=s=>w.document.querySelector(s),nav=()=>[...w.document.querySelectorAll('#workspace-production-group .journey-step')].filter(b=>!b.hidden).map(b=>b.dataset.page);
 const choose=async value=>{const field=q('[name=story_format]');field.value=value;field.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();};
 return {w,q,nav,choose,errors,close:()=>{observers.forEach(observer=>observer.disconnect());w.close();},async go(p){w.testUI.navigate(p);await tick();},snapshot:()=>Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]))};
}
const input=(x,selector,value,event='input')=>{const field=x.q(selector);assert.ok(field,selector);field.value=value;field.dispatchEvent(new x.w.Event(event,{bubbles:true}));return field;};
test('Audio compute offers CPU, A100 and B200, starts on CPU on every visit, and preserves its position',async()=>{
 const x=await setup({'ecco-active-story':'audio-story','ecco-audio-draft:audio-story':JSON.stringify({compute:'a100',lines:[{text:'Saved script.'}]})});await x.go('audio');
 assert.deepEqual([...x.q('#audio-form').querySelectorAll(':scope > .generation-section')].slice(0,3).map(s=>s.dataset.section),['model','compute','references']);
 assert.equal(x.q('[name=compute]').value,'cpu');
 assert.deepEqual([...x.q('[name=compute]').options].map(o=>[o.value,o.textContent]),[['cpu','CPU'],['a100','A100'],['b200','B200']]);
 assert.match(x.q('[data-audio-compute-status]').textContent,/Connect workspace storage/);
 input(x,'[name=compute]','b200','change');assert.equal(audioDraft(x).compute,'b200');
 const snapshot=x.snapshot();await x.go('images');assert.equal(x.q('[name=compute]'),null);await x.go('audio');assert.equal(x.q('[name=compute]').value,'cpu');
 x.close();const reloaded=await setup(snapshot);await reloaded.go('audio');assert.equal(reloaded.q('[name=compute]').value,'cpu');
 reloaded.w.testUI.selectStory('video-story');await reloaded.go('audio');assert.equal(reloaded.q('[name=compute]').value,'cpu');reloaded.close();
});
test('Audio and previews honor explicit A100 or B200 choices and never fall back from unavailable compute',async()=>{
 const x=await setup({'ecco-active-story':'audio-story'});await x.go('audio');const {calls,adapter}=connect(x);x.w.testUI.setGPU(false);
 input(x,'[data-single-script]','नमस्ते।');
 for(const target of ['a100','b200']){
  input(x,'[name=compute]',target,'change');x.q('#generate-audio').click();await tick();assert.equal(calls.at(-1).compute,target);assert.equal(x.q('#gpu-picker-dialog'),null);
  x.q('[data-preview-voice]').click();input(x,'#audio-voice-preview-dialog textarea','नमस्ते।');x.q('#audio-voice-preview-generate').click();await tick();assert.equal(calls.at(-1).compute,target);x.q('#audio-voice-preview-dialog [data-close]').click();
 }
 assert.equal(calls.length,4);
 input(x,'[name=compute]','cpu','change');x.q('#audio-form').requestSubmit();await tick();assert.equal(calls.length,4);assert.match(x.q('#notice').textContent,/CPU audio generation is not enabled/);
 input(x,'[name=compute]','a100','change');adapter.status=async()=>({routing_version:1,compute:{a100:{ready:false},b200:{ready:true}}});x.q('#audio-form').requestSubmit();await tick();assert.equal(calls.length,4);assert.match(x.q('#notice').textContent,/A100 audio worker is not connected/);
 adapter.status=async()=>({ready:true});x.q('#audio-form').requestSubmit();await tick();assert.equal(calls.length,4);assert.match(x.q('#notice').textContent,/needs an update/);
 x.close();
});
const audioDraft=x=>JSON.parse(x.w.localStorage.getItem('ecco-audio-draft:audio-story'));
test('CPU readiness is live and model-specific, and CPU generation needs no GPU connection',async()=>{
 const x=await setup({'ecco-active-story':'audio-story'});await x.go('audio');const {calls,adapter}=connect(x);x.w.testUI.setGPU(false);
 adapter.status=async()=>({routing_version:1,compute:{cpu:{ready:true,models:['indic-mio']},a100:{ready:false},b200:{ready:true}}});
 input(x,'[name=compute]','cpu','change');input(x,'[data-single-script]','नमस्ते।');x.q('#generate-audio').click();await tick();
 assert.equal(calls.length,1);assert.equal(calls[0].compute,'cpu');assert.equal(x.q('[data-audio-compute-status]').textContent,'CPU connected');
 input(x,'#audio-form [name=model]','chatterbox','change');assert.match(x.q('[data-audio-compute-status]').textContent,/not available on CPU/);
 x.q('#audio-form').requestSubmit();await tick();assert.equal(calls.length,1);assert.match(x.q('#notice').textContent,/not enabled on CPU/);x.close();
});
const connect=x=>{const calls=[],adapter={storageIndependentOfGPU:true,status:async()=>({routing_version:1,compute:{a100:{ready:true},cpu:{ready:false,reason:'CPU audio generation is not enabled yet.'},b200:{ready:true}}}),list:async()=>[],generate:async body=>{calls.push(body);return{id:'test-job'};},job:async()=>({id:'test-job',status:'done',asset_id:'test-audio'}),mediaURL:async()=> 'https://media.example.test/audio.wav',download:async()=>{}};input(x,'[name=compute]','a100','change');x.w.testUI.setGPU(true);x.w.EccoAudioStudio.connect(adapter);return{calls,adapter};};
test('Audio controls use named speakers, all 23 model languages, four real voices and AI delivery guidance',async()=>{
 const x=await setup({'ecco-active-story':'audio-story'});await x.go('audio');x.q('[data-open-controls]').click();
 assert.equal(x.q('#generation-controls-dialog h2').textContent,'Additional Controls');
 assert.equal(x.q('[data-audio-presentation]').value,'single');
 assert.equal(x.q('[data-speaker-field=language]').options.length,23);
 for(const language of ['Hindi','Urdu','English','Tamil','Punjabi'])assert.ok([...x.q('[data-speaker-field=language]').options].some(o=>o.value===language));
 assert.deepEqual([...x.q('[data-speaker-field=voice]').options].map(o=>o.value),['en_female','en_male','jp_female','jp_male']);
 input(x,'[data-audio-presentation]','conversation','change');
 assert.equal(x.w.document.querySelectorAll('[data-speaker-tab]').length,2);
 assert.doesNotMatch(x.q('#audio-form').textContent,/Line [12]/);
 input(x,'[data-speaker-field=language]','English','change');
 assert.ok([...x.q('[data-speaker-field=dialect]').options].some(o=>o.value==='Irish English'));
 assert.ok([...x.q('[data-speaker-field=dialect]').options].some(o=>o.value==='Australian English'));
 assert.ok([...x.q('[data-speaker-field=dialect]').options].some(o=>o.value==='British English'));
 input(x,'[data-speaker-field=language]','Hindi','change');input(x,'[data-speaker-field=mixed_language]','Punjabi','change');input(x,'[data-speaker-field=voice]','en_male','change');
 input(x,'[data-speaker-field=delivery]','Speak softly with a feminine delivery.');
 const context=x.w.EccoGeneration.aiContext(x.q('#audio-form')).context;
 assert.match(context.instructions,/Hindi mixed naturally with Punjabi/);assert.match(context.instructions,/Speak softly with a feminine delivery/);
 assert.match(x.q('.audio-direction-note').textContent,/does not offer exact accent control/);
 assert.deepEqual(x.errors,[]);x.close();
});
test('Existing multilingual dialogue survives migration and mode switching; single and conversation drafts remain editable',async()=>{
 const original={title:'Saved dialogue',lines:[{text:'नमस्ते।',language:'Hindi',voice:'en_male',emotion:'happy'},{text:'Welcome!',language:'English',voice:'en_female',emotion:'neutral'}]};
 const x=await setup({'ecco-active-story':'audio-story','ecco-audio-draft:audio-story':JSON.stringify(original)});await x.go('audio');
 assert.equal(x.q('[data-audio-presentation]').value,'conversation');assert.equal(x.w.document.querySelectorAll('#audio-lines textarea').length,2);
 assert.equal(x.q('#audio-lines textarea').value,original.lines[0].text);
 input(x,'[data-audio-presentation]','single','change');assert.match(x.q('[data-single-script]').value,/नमस्ते/);assert.match(x.q('[data-single-script]').value,/Welcome/);
 input(x,'[data-single-script]','Single narrator draft.');input(x,'[data-audio-presentation]','conversation','change');
 assert.deepEqual([...x.w.document.querySelectorAll('#audio-lines textarea')].map(e=>e.value),original.lines.map(l=>l.text));
 input(x,'[data-audio-presentation]','single','change');assert.equal(x.q('[data-single-script]').value,'Single narrator draft.');
 await x.go('images');await x.go('audio');assert.equal(x.q('[data-single-script]').value,'Single narrator draft.');assert.equal(audioDraft(x).speakers[0].voice,'en_male');
 assert.deepEqual(x.errors,[]);x.close();
});
test('A long single script becomes valid existing-service speech segments without exposing line controls',async()=>{
 const x=await setup({'ecco-active-story':'audio-story'});await x.go('audio');const {calls}=connect(x);
 const text='नमस्ते दुनिया। '.repeat(60).trim();input(x,'[data-single-script]',text);input(x,'[data-speaker-field=voice]','en_male','change');
 x.q('#audio-form').requestSubmit();await tick();
 assert.equal(calls.length,1);assert.ok(calls[0].lines.length>1);assert.ok(calls[0].lines.every(l=>l.text.length<=500&&l.voice==='en_male'));
 assert.equal(calls[0].lines.map(l=>l.text).join(' '),text);assert.equal(calls[0].story_id,'audio-story');
 assert.ok(calls[0].lines.every(l=>Object.keys(l).sort().join(',')==='emotion,language,text,voice'));
 assert.deepEqual(x.errors,[]);x.close();
});
test('Conversation generation assigns each turn to its selected speaker and keeps direction notes out of spoken text',async()=>{
 const x=await setup({'ecco-active-story':'audio-story'});await x.go('audio');const {calls}=connect(x);
 input(x,'[data-audio-presentation]','conversation','change');input(x,'#audio-lines textarea','Hello from the host.');x.q('#add-audio-line').click();
 const second=x.w.document.querySelectorAll('#audio-lines textarea')[1];second.value='Hello from the guest.';second.dispatchEvent(new x.w.Event('input',{bubbles:true}));
 x.q('[data-speaker-tab="speaker-1"]').click();input(x,'[data-speaker-field=language]','English','change');input(x,'[data-speaker-field=dialect]','Irish English','change');input(x,'[data-speaker-field=delivery]','Friendly and confident.');
 x.q('#audio-form').requestSubmit();await tick();assert.equal(calls.length,1);
 assert.deepEqual(Array.from(calls[0].lines,l=>({text:l.text,voice:l.voice,language:l.language})),[{text:'Hello from the host.',voice:'en_female',language:'Hindi'},{text:'Hello from the guest.',voice:'en_male',language:'English'}]);
 assert.doesNotMatch(JSON.stringify(calls[0]),/Friendly|Irish/);assert.match(x.w.EccoAudioStudio.aiContext().instructions,/Irish English/);assert.equal(x.w.EccoGeneration.aiContext(x.q('#audio-form'),second).context.language,'English');
 assert.deepEqual(x.errors,[]);x.close();
});
test('Voice preview is explicit, uses selected voice settings and does not change the script or main generation',async()=>{
 const x=await setup({'ecco-active-story':'audio-story'});await x.go('audio');const {calls}=connect(x);
 input(x,'[data-single-script]','Keep my script.');input(x,'[data-speaker-field=voice]','en_male','change');input(x,'[data-speaker-field=emotion]','happy','change');
 x.q('[data-preview-voice]').click();assert.equal(calls.length,0);assert.equal(x.q('#audio-voice-preview-dialog audio').hidden,true);
 x.q('#audio-voice-preview-generate').click();assert.equal(calls.length,0);
 input(x,'#audio-voice-preview-dialog textarea','नमस्ते!');x.q('#audio-voice-preview-generate').click();await tick();
 assert.equal(calls.length,1);assert.equal(calls[0].lines[0].voice,'en_male');assert.equal(calls[0].lines[0].emotion,'happy');assert.equal(calls[0].lines[0].text,'नमस्ते!');
 assert.equal(x.q('#audio-voice-preview-dialog audio').hidden,false);assert.equal(x.q('#audio-voice-preview-dialog audio').src,'https://media.example.test/audio.wav');
 assert.equal(x.q('[data-single-script]').value,'Keep my script.');assert.equal(x.w.localStorage.getItem('ecco-audio-job:audio-story'),null);
 x.q('#audio-voice-preview-dialog [data-close]').click();assert.equal(x.q('#audio-voice-preview-dialog'),null);
 assert.deepEqual(x.errors,[]);x.close();
});
test('Late preview results cannot open media after leaving Audio',async()=>{
 const x=await setup({'ecco-active-story':'audio-story'});await x.go('audio');const {adapter}=connect(x);let finish,mediaCalls=0;
 adapter.job=()=>new Promise(resolve=>finish=resolve);adapter.mediaURL=async()=>{mediaCalls++;return 'https://media.example.test/audio.wav';};
 x.q('[data-preview-voice]').click();input(x,'#audio-voice-preview-dialog textarea','Hello.');x.q('#audio-voice-preview-generate').click();await tick();
 await x.go('images');finish({status:'done',asset_id:'late-audio'});await tick();assert.equal(mediaCalls,0);assert.equal(x.q('#audio-voice-preview-dialog'),null);assert.deepEqual(x.errors,[]);x.close();
});
test('Scene narration imports into one script and preserves existing text',async()=>{
 const x=await setup({'ecco-active-story':'audio-story'});await x.go('audio');const text='A longer scene narration. '.repeat(30);
 x.w.EccoAudioStudio.importScript(text);assert.equal(x.q('[data-single-script]').value,text);assert.equal(x.w.document.querySelectorAll('#audio-lines textarea').length,1);
 assert.throws(()=>x.w.EccoAudioStudio.importScript('Replace me'),/already has text/);assert.equal(x.q('[data-single-script]').value,text);assert.deepEqual(x.errors,[]);x.close();
});

test('Selected scenes become one ordered audio plan with per-scene voices and separate title pause',async()=>{
 const scenes=[{title:'First news',narration:'Fact one.'},{title:'Second news',narration:'Fact two.'},{title:'Third news',narration:'Fact three.'}];
 const x=await setup({'ecco-active-story':'audio-story','ecco-board-draft:audio-story':JSON.stringify({scenes})});await x.go('audio');const {calls}=connect(x);
 x.q('[data-select-scenes]').click();x.w.document.querySelectorAll('#audio-scenes-dialog input').forEach(el=>el.checked=true);x.q('#audio-scenes-dialog [data-apply]').click();assert.equal(audioDraft(x).source_scenes.length,3);
 x.w.EccoAI={enabled:true};x.w.EccoStorage={ready:true};x.w.plan={opening:{text:'आज की तीन खबरें।',voice:'en_female'},segments:[{scene_number:1,text:'पहली खबर।',voice:'en_female'},{scene_number:2,text:'दूसरी खबर।',voice:'en_male'},{scene_number:3,text:'तीसरी खबर।',voice:'en_female'}]};
 x.w.testUI.setAPI(async(path,body)=>{x.w.aiRequest=body;return {revisions:[{id:'audio_plan',text:JSON.stringify(x.w.plan)}],questions:[]};});
 x.w.EccoAudioStudio.generateScript();input(x,'[data-instructions]','Hindi with Urdu and English. First female, second male.');x.q('#audio-script-instructions form').requestSubmit();await tick();
 assert.ok(x.w.aiRequest,x.w.document.body.textContent.slice(-2500));assert.deepEqual(Array.from(x.w.aiRequest.context.scenes,s=>s.scene_number),[1,2,3]);assert.match(x.w.aiRequest.context.instructions,/First female, second male/);
 assert.equal(audioDraft(x).presentation,'conversation');assert.equal(x.q('[data-opening-text]').value,'आज की तीन खबरें।');assert.equal(x.w.document.querySelectorAll('[data-turn-speaker]').length,3);
 x.q('#audio-form').requestSubmit();await tick();assert.equal(calls.length,1);assert.equal(calls[0].lines.length,4);assert.deepEqual(Array.from(calls[0].lines,l=>l.voice),['en_female','en_female','en_male','en_female']);assert.equal(calls[0].lines[1].pause_before,2);assert.doesNotMatch(JSON.stringify(calls[0].lines),/First female|Hindi with Urdu/);
 assert.deepEqual(x.errors,[]);x.close();
});
test('Changed source scenes are rejected before script generation',async()=>{
 const x=await setup({'ecco-active-story':'audio-story','ecco-board-draft:audio-story':JSON.stringify({scenes:[{title:'Original',narration:'Original facts.'}]})});await x.go('audio');x.q('[data-select-scenes]').click();x.q('#audio-scenes-dialog input').checked=true;x.q('#audio-scenes-dialog [data-apply]').click();
 x.w.localStorage.setItem('ecco-board-draft:audio-story',JSON.stringify({scenes:[{title:'Different',narration:'Other facts.'}]}));x.w.EccoAudioStudio.generateScript();assert.equal(x.q('#audio-script-instructions'),null);assert.equal(audioDraft(x).single_text,'');x.close();
});


test('All three audio models appear in generation and Models & Settings with synchronized selection',async()=>{
 const x=await setup({'ecco-active-story':'audio-story'});await x.go('audio');
 assert.deepEqual([...x.q('[name=model]').options].map(o=>o.value),['indic-mio','chatterbox','indicf5']);
 input(x,'[name=model]','chatterbox','change');await x.go('models');
 assert.equal(x.q('[data-category=voice]').value,'chatterbox');
 input(x,'[data-category=voice]','indicf5','change');await x.go('audio');
 assert.equal(x.q('[name=model]').value,'indicf5');assert.equal(x.q('[data-speaker-field=language]').options.length,11);
 assert.equal(x.q('[data-speaker-field=voice]').options.length,7);assert.equal(x.q('[data-speaker-field=emotion]'),null);
 assert.deepEqual(x.errors,[]);x.close();
});
test('Switching audio models preserves script and restores model-specific speaker choices',async()=>{
 const x=await setup({'ecco-active-story':'audio-story'});await x.go('audio');
 input(x,'[data-single-script]','Keep this exact narration.');input(x,'[data-speaker-field=language]','Urdu','change');input(x,'[data-speaker-field=voice]','en_male','change');
 input(x,'[name=model]','chatterbox','change');assert.equal(x.q('[data-speaker-field=language]').options.length,23);
 assert.equal(x.q('[data-speaker-field=voice]').options.length,8);assert.equal(x.q('[data-speaker-field=language]').value,'Hindi');
 assert.ok(![...x.q('[data-speaker-field=language]').options].some(o=>o.value==='Urdu'));
 input(x,'[name=model]','indic-mio','change');assert.equal(x.q('[data-speaker-field=language]').value,'Urdu');assert.equal(x.q('[data-speaker-field=voice]').value,'en_male');
 assert.equal(x.q('[data-single-script]').value,'Keep this exact narration.');assert.deepEqual(x.errors,[]);x.close();
});
test('Chatterbox generation and preview carry model, voice, language and expressiveness',async()=>{
 const x=await setup({'ecco-active-story':'audio-story'});await x.go('audio');const {calls}=connect(x);
 input(x,'[name=model]','chatterbox','change');input(x,'[data-speaker-field=language]','English','change');input(x,'[data-speaker-field=voice]','mar_m','change');
 input(x,'[data-expressiveness]','0.8');input(x,'[data-single-script]','Welcome to Ecco.');x.q('#audio-form').requestSubmit();await tick();
 assert.equal(calls[0].model,'chatterbox');assert.equal(calls[0].exaggeration,0.8);assert.equal(calls[0].lines[0].voice,'mar_m');assert.equal(calls[0].lines[0].language,'English');
 x.q('[data-preview-voice]').click();input(x,'#audio-voice-preview-dialog textarea','Hello.');x.q('#audio-voice-preview-generate').click();await tick();
 assert.equal(calls[1].model,'chatterbox');assert.equal(calls[1].exaggeration,0.8);assert.deepEqual(x.errors,[]);x.close();
});

