const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const M=require('./story-workspace-model.js');
const tick=()=>new Promise(r=>setTimeout(r,30));
const instances=new Set();afterEach(()=>{for(const close of instances)close();});
async function fixture(storage={}){
 const html=fs.readFileSync('index.html','utf8');
 const scripts=[...html.matchAll(/<script(?:\s+src="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)].map(m=>'Object.defineProperty(document,"currentScript",{configurable:true,value:'+JSON.stringify(m[1]?{src:new URL(m[1],'https://studio.test/').href}:null)+'});\n'+(m[1]?fs.readFileSync(m[1].split('?')[0],'utf8'):m[2]));
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g,''),{runScripts:'outside-only',url:'https://studio.test/',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;
 const observers=[],Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(cb){super(cb);observers.push(this);}};
 let alive=true;const microtask=w.queueMicrotask.bind(w);w.queueMicrotask=cb=>microtask(()=>{if(alive)cb();});
 const close=()=>{alive=false;observers.forEach(o=>o.disconnect());w.close();instances.delete(close);};instances.add(close);
 w.CSSStyleDeclaration.prototype[Symbol.iterator]=function*(){for(let i=0;i<this.length;i++)yield this.item(i);};w.structuredClone=structuredClone;w.setInterval=()=>0;w.fetch=async()=>{throw Error('Network disabled in test');};w.matchMedia=()=>({matches:false,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLMediaElement.prototype.pause=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 for(const[k,v]of Object.entries(storage))w.localStorage.setItem(k,v);
 w.eval(scripts.join('\n;\n')+`\nstate={records:[],config:{models_ready:{}},storage_pending:false};refresh=async()=>true;window.testCalls=[];window.testAPI=async(path,body)=>{window.testCalls.push({path,body});if(path==='stories')return {id:'story-'+window.testCalls.filter(c=>c.path==='stories').length,kind:'story',created:1,...body};return {};};api=(...args)=>window.testAPI(...args);window.testStorageReady=true;window.testAIEnabled=true;Object.defineProperty(window.EccoStorage,'ready',{get:()=>window.testStorageReady});Object.defineProperty(window.EccoAI,'enabled',{get:()=>window.testAIEnabled});window.testState={page:()=>page,story:()=>activeStory,records:x=>state.records=x,navigate:p=>navigate(p)};`);
 const workspaceStyle=w.document.createElement('style');workspaceStyle.textContent=fs.readFileSync('story-workspace.css','utf8');w.document.head.append(workspaceStyle);
 await tick();const q=s=>w.document.querySelector(s);
 const fill=(name,value)=>{const input=q('[name="'+name+'"]');assert.ok(input,name);input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));input.dispatchEvent(new w.Event('change',{bubbles:true}));};
 async function start(output='audio',type='podcast') {w.EccoWorkspaceUI.startNewStory({id:'custom',format:''});await tick();for(const [k,v]of Object.entries({title:'Business Today',output,type,genre:'Business',audience:'Adults (18+)',language:'English',location:'India',recurrence:'recurring'}))fill(k,v);await w.EccoStoryWorkspace.select(1);await tick();}
 return {w,q,fill,start,errors,close,snapshot:()=>Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)])),script(value){const input=q('#story-simple-script');input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));},saved:()=>JSON.parse(w.localStorage.getItem(w.testState.story()?'ecco-story-description:'+w.testState.story():'ecco-new-story-draft'))};
}
async function requestStoryAI(x,instructions){x.q('#page [data-ai]').click();await tick();const form=x.q('#ai-generation-dialog form');assert.ok(form);if(instructions!==undefined)form.elements.instructions.value=instructions;form.requestSubmit();await tick();}
test('speaker labels never become spoken words and edited directions survive unchanged turns',()=>{
 const cast=[{id:'a',name:'Motu'},{id:'b',name:'Patlu'}],previous={segments:[{character_id:'a',text:'Hello!',performance:{emotion:'happy'}}]};
 assert.deepEqual(M.parseScript('Motu: Hello!\n\nPatlu: Hi!',cast,previous).segments,[{character_id:'a',text:'Hello!',performance:{emotion:'happy'}},{character_id:'b',text:'Hi!'}]);
 assert.throws(()=>M.parseScript('Unknown: Hello!',cast),/character name/);
 assert.throws(()=>M.parseScript('Motu: '+ 'x'.repeat(4001),cast),/4,000/);
});
test('unchanged scenes preserve existing images and camera edits',()=>{
 const scene={title:'Market',narration:'Hello',motion:'Walk',image_id:'saved-image',camera_move:'Orbit',seconds:4};
 const retained=M.reconcileScenes([{...scene,image_id:'',seconds:3,camera_move:'Static'}],[scene])[0];assert.equal(retained.image_id,'saved-image');assert.equal(retained.seconds,4);assert.equal(retained.camera_move,'Orbit');
 assert.equal(M.reconcileScenes([{...scene,narration:'Changed',image_id:''}],[scene])[0].image_id,'');
});
test('three tabs autosave all details, keep drafts isolated and reopen after refresh',async()=>{
 const x=await fixture();await x.start();x.script('Host: Welcome.\n\nGuest: Good morning.');
 assert.equal(x.q('#story-workspace-header').querySelectorAll('[role=tab]').length,3);
 assert.equal(x.saved().simple_workspace.location,'India');
 await x.w.EccoStoryWorkspace.select(0);assert.equal(x.q('[name=genre]').value,'Business');await x.w.EccoStoryWorkspace.select(1);assert.match(x.q('#story-simple-script').value,/Good morning/);
 const localId=x.saved().localDraftId,storage=x.snapshot();x.close();const y=await fixture(storage);y.w.EccoStoryWorkspace.openSetup(localId);await tick();assert.match(y.q('#story-simple-script').value,/Good morning/);
 y.w.EccoWorkspaceUI.startNewStory({id:'custom',format:''});await tick();assert.equal(y.q('[name=title]').value,'');assert.equal(y.saved().simple_workspace.script,'');assert.deepEqual(y.errors,[]);
});
test('podcast routes directly to audio with two speakers, preserves later edits, and never generates implicitly',async()=>{
 const x=await fixture();await x.start();x.script('Host: Welcome to business news.\n\nGuest: Here are today’s headlines.');await x.w.EccoStoryWorkspace.select(2);await tick();
 assert.ok(x.q('#audio-form'));assert.equal(x.w.testState.page(),'audio');const id=x.w.testState.story(),key='ecco-audio-draft:'+id;
 let audio=JSON.parse(x.w.localStorage.getItem(key));assert.equal(audio.speakers.length,2);assert.equal(audio.lines[0].text,'Welcome to business news.');assert.equal(audio.script_brief.genre,'Business');assert.match(audio.script_brief.instructions,/India/);
 assert.equal(x.w.testCalls.some(c=>/generate|^images$|^videos$/.test(c.path)),false);
 await x.w.EccoStoryWorkspace.select(1);x.script('Host: Changed opening.\n\nGuest: Same answer.');await x.w.EccoStoryWorkspace.select(2);await tick();audio=JSON.parse(x.w.localStorage.getItem(key));assert.equal(audio.lines[0].text,'Changed opening.');
 assert.equal(x.w.testCalls.filter(c=>c.path==='stories').length,1);assert.deepEqual(x.errors,[]);
});
test('image and video choices open their own studios inside tab three',async()=>{
 for(const [output,selector]of [['image','#image-form'],['video','#video-form']]){const x=await fixture();await x.start(output,'storybook');x.script('A child discovers a secret garden.');await x.w.EccoStoryWorkspace.select(2);await tick();assert.ok(x.q(selector),output);assert.equal(x.q('#story-simple-tab-2').getAttribute('aria-selected'),'true');assert.equal(x.w.testCalls.some(c=>c.path==='images'||c.path==='videos'),false);assert.deepEqual(x.errors,[]);x.close();}
});
test('a late AI response cannot replace an edited story or cast',async()=>{
 const x=await fixture();await x.start();x.script('Host: Original.\n\nGuest: Original.');let resolve;
 x.w.testAPI=()=>new Promise(r=>resolve=r);await requestStoryAI(x);x.script('Host: My new edit.\n\nGuest: Keep me.');resolve({revisions:[{id:'story_workspace',text:'{}'}]});await tick();assert.match(x.q('#story-simple-script').value,/My new edit/);assert.match(x.q('#story-simple-error').textContent,/changed/);assert.equal(x.q('#story-simple-candidate').hidden,true);
});
test('AI suggestions require review and Apply, and receive only the selected source',async()=>{
 const x=await fixture();await x.start('audio','storybook');let sourceOptions;x.w.EccoSourcePicker.create=options=>{sourceOptions=options;return {ready:true,load:async()=>options.onApply({text:'Selected source passage.',name:'sample.pdf',pages:[2],selection_label:'Page 2'}),destroy(){}};};const upload=x.q('[data-file]');Object.defineProperty(upload,'files',{value:[{name:'sample.pdf',wholeDocument:'Unselected private passage.'}]});await upload.onchange({target:upload});const cast=x.saved().simple_workspace.cast;
 x.w.testAPI=async(path,body)=>{x.w.testCalls.push({path,body});return {revisions:[{id:'story_workspace',text:JSON.stringify({characters:cast,reason:'One narrator fits this story.',segments:[{character_id:cast[0].id,text:'A funny story.'}],scenes:[]})}]};};
 await requestStoryAI(x);assert.equal(x.q('#story-simple-script').value,'Selected source passage.');assert.equal(x.q('#story-simple-candidate').hidden,false);const sent=JSON.stringify(x.w.testCalls[0].body);assert.match(sent,/Selected source passage/);assert.doesNotMatch(sent,/Unselected private passage/);x.q('#story-simple-candidate button').click();await tick();assert.match(x.q('#story-simple-script').value,/A funny story/);assert.deepEqual(x.errors,[]);
});
test('unconfirmed story save blocks duplicate submission and retains all input',async()=>{
 const x=await fixture();await x.start('image','storybook');x.script('A garden.');let saves=0;x.w.testAPI=async()=>{saves++;throw Error('Response lost');};await x.w.EccoStoryWorkspace.select(2);await x.w.EccoStoryWorkspace.select(2);assert.equal(saves,1);assert.equal(x.q('#story-simple-script').value,'A garden.');assert.match(x.q('#story-simple-error').textContent,/not confirmed/);
});
test('changing output keeps the audio draft and routes to the newly chosen studio',async()=>{
 const x=await fixture();await x.start();x.script('Host: Welcome.\n\nGuest: Hello.');await x.w.EccoStoryWorkspace.select(2);await tick();const key='ecco-audio-draft:'+x.w.testState.story(),old=x.w.localStorage.getItem(key);
 await x.w.EccoStoryWorkspace.select(0);x.fill('output','image');await x.w.EccoStoryWorkspace.select(2);await tick();assert.ok(x.q('#image-form'));assert.equal(x.w.localStorage.getItem(key),old);assert.deepEqual(x.errors,[]);
});
test('video script edits rebuild scenes while audio preparation and next episodes keep visual content isolated',async()=>{
 const x=await fixture();await x.start('video','storybook');x.script('The child opens a gate.');await x.w.EccoStoryWorkspace.select(2);await tick();const id=x.w.testState.story();
 await x.w.EccoStoryWorkspace.select(1);x.script('The child enters a garden.');await x.w.EccoStoryWorkspace.select(2);await tick();assert.equal(JSON.parse(x.w.localStorage.getItem('ecco-board-draft:'+id)).scenes[0].narration,'The child enters a garden.');
 [...x.q('#story-simple-media').querySelectorAll('button')].find(b=>b.textContent==='Prepare Audio').click();await tick();await x.w.EccoStoryWorkspace.select(1);assert.equal(x.q('#story-simple-script').value,'The child enters a garden.');await x.w.EccoStoryWorkspace.select(2);await tick();
 x.q('[data-next-episode]').click();await tick();const next=x.saved().simple_workspace;assert.equal(next.script,'');assert.equal(next.audioScript,'');assert.equal(next.scenes.length,0);assert.equal(next.output,'video');assert.equal(next.cast.length,1);assert.deepEqual(x.errors,[]);
});
test('publishing stays in the third tab and requires an approved result from this story',async()=>{
 const x=await fixture();await x.start('video','storybook');x.script('A child plays.');await x.w.EccoStoryWorkspace.select(2);await tick();assert.equal(x.q('[data-publish]').disabled,true);const id=x.w.testState.story();
 x.w.testState.records([{id:'ready-video',kind:'asset',media:'video',stage:'prod',story_id:id,title:'Preview',created:1,path:'preview.mp4'}]);await x.w.EccoStoryWorkspace.select(2);await tick();assert.equal(x.q('[data-publish]').disabled,false);x.q('[data-publish]').click();await tick();assert.equal(x.w.testState.page(),'publish');assert.equal(x.q('#story-simple-tab-2').getAttribute('aria-selected'),'true');assert.equal(x.w.testCalls.some(c=>/publish|youtube/.test(c.path)),false);assert.deepEqual(x.errors,[]);
});

test('left navigation stays visible and direct Library entry removes the story tabs',async()=>{
 const x=await fixture();await x.start();x.script('Host: Keep my draft.\n\nGuest: Keep mine.');
 const nav=x.q('#workspace-production-group');assert.ok(nav);assert.notEqual(x.w.getComputedStyle(nav).display,'none');
 x.w.EccoWorkspaceUI.openLibrary('video');await tick();assert.equal(x.w.testState.page(),'video-library');assert.equal(x.q('#story-workspace-header').hidden,true);assert.equal(x.w.EccoStoryWorkspace.active,false);assert.ok(x.q('#video-library-gallery'));assert.match(x.saved().simple_workspace.script,/Keep my draft/);
});
test('the parent Library heading leaves every story tab and preserves the draft',async()=>{
 const x=await fixture();await x.start();x.script('Host: Keep this story.\n\nGuest: Keep my answer.');
 for(const tab of [0,1,2]){
  if(!x.w.EccoStoryWorkspace.active)x.w.EccoStoryWorkspace.open();
  await x.w.EccoStoryWorkspace.select(tab);await tick();
  const library=x.q('#workspace-library-group'),summary=library.querySelector(':scope > summary');
  library.open=false;summary.focus();summary.click();await tick();
  assert.equal(library.open,true);assert.equal(x.w.document.activeElement,summary);
  assert.equal(x.w.testState.page(),'story-library');assert.equal(x.q('#story-workspace-header').hidden,true);assert.equal(x.w.EccoStoryWorkspace.active,false);
  assert.ok(x.q('#story-library-list'));assert.match(x.saved().simple_workspace.script,/Keep this story/);
  summary.click();await tick();assert.equal(library.open,false);assert.equal(x.q('#story-workspace-header').hidden,true);
 }
 x.w.EccoStoryWorkspace.open();await x.w.EccoStoryWorkspace.select(1);await tick();assert.match(x.q('#story-simple-script').value,/Keep my answer/);assert.deepEqual(x.errors,[]);
});
test('New Story ignores orphaned audio content and starts with no selected story details',async()=>{
 const orphan=JSON.stringify({speakers:[{id:'old',name:'Previous speaker'}],lines:[{speaker_id:'old',text:'Previous story content'}]});
 const x=await fixture({'ecco-audio-draft:':orphan});x.w.EccoWorkspaceUI.startNewStory({id:'',format:''});await tick();
 for(const name of ['title','output','type','genre','audience','language','location','recurrence'])assert.equal(x.q('[name="'+name+'"]').value,'',name);
 assert.equal(x.saved().simple_workspace.script,'');assert.equal(x.saved().simple_workspace.cast.length,0);assert.equal(x.w.localStorage.getItem('ecco-audio-draft:'),orphan);
});
test('new story detaches the previous document picker without deleting its saved draft',async()=>{
 const x=await fixture();await x.start('image','storybook');let destroyed=0;
 x.w.EccoSourcePicker.create=options=>({ready:true,load:async()=>options.onApply({text:'Old selected passage.',name:'old.pdf',pages:[1]}),destroy(){destroyed++;}});
 const file=x.q('[data-file]');Object.defineProperty(file,'files',{value:[{name:'old.pdf'}]});await file.onchange({target:file});const previous=x.saved().localDraftId;
 await x.start('image','storybook');assert.equal(x.q('[data-preview]').hidden,true);assert.equal(x.q('#story-simple-script').value,'');assert.equal(destroyed,1);assert.match(JSON.parse(x.w.localStorage.getItem('ecco-story-setup:'+previous)).simple_workspace.script,/Old selected passage/);
});
test('Generate with AI opens an instruction dialog immediately, even without a brief',async()=>{
 const x=await fixture();await x.start();x.q('#page [data-ai]').click();await tick();const dialog=x.q('#ai-generation-dialog');assert.ok(dialog?.open);assert.equal(dialog.querySelector('[name=instructions]').value,'');assert.equal(x.w.testCalls.length,0);assert.deepEqual(x.errors,[]);
});

test('AI shows connection failures inline and does not submit until storage is ready',async()=>{
 const x=await fixture();await x.start();x.w.testStorageReady=false;await requestStoryAI(x,'Write a funny business podcast.');
 assert.match(x.q('#story-simple-ai-status').textContent,/Connect Storage/);assert.equal(x.q('[data-ai-connections]').hidden,false);assert.equal(x.q('#page [data-ai]').disabled,false);assert.equal(x.w.testCalls.length,0);
});
test('AI scopes controls to this story and shows pending, error and retry states',async()=>{
 const x=await fixture();await x.start();const unrelated=x.w.document.createElement('input');unrelated.setAttribute('data-ai','0');x.w.document.body.prepend(unrelated);await x.w.EccoStoryWorkspace.select(1);
 let reject;x.w.testAPI=()=>new Promise((_,r)=>reject=r);await requestStoryAI(x,'Explain business news.');assert.equal(x.q('#page [data-ai]').disabled,true);assert.equal(x.q('#page [data-ai]').textContent,'Generating…');assert.match(x.q('#story-simple-ai-status').textContent,/Writing/);assert.equal(unrelated.disabled,false);
 reject(Error('AI service is unavailable.'));await tick();assert.match(x.q('#story-simple-ai-status').textContent,/AI service is unavailable/);assert.equal(x.q('#page [data-ai]').disabled,false);assert.equal(x.q('#page [data-ai]').textContent,'Generate with AI');assert.deepEqual(x.errors,[]);
});
test('a new story has fresh AI instructions and cannot receive the previous response',async()=>{
 const x=await fixture();await x.start();let resolve;x.w.testAPI=()=>new Promise(r=>resolve=r);await requestStoryAI(x,'Old story instructions');
 await x.start('image','storybook');x.q('#page [data-ai]').click();await tick();assert.equal(x.q('#ai-generation-dialog [name=instructions]').value,'');x.q('#ai-generation-dialog').close();
 resolve({revisions:[{id:'story_workspace',text:'{}'}]});await tick();assert.equal(x.q('#story-simple-script').value,'');assert.equal(x.q('#story-simple-ai-status').textContent,'');assert.equal(x.q('#page [data-ai]').disabled,false);
});
test('library navigation and minimized popup restoration preserve the exact workspace draft',async()=>{
 const x=await fixture();await x.start();x.script('Host: My draft.\n\nGuest: My answer.');const context=x.w.EccoWorkspaceUI.capturePopupContext();context.suspend();x.w.EccoWorkspaceUI.openLibrary('video');await tick();assert.equal(x.q('#story-workspace-header').hidden,true);
 context.restore();await tick();assert.equal(x.q('#story-workspace-header').hidden,false);assert.equal(x.w.EccoStoryWorkspace.active,true);assert.equal(x.q('#story-simple-script').value,'Host: My draft.\n\nGuest: My answer.');assert.deepEqual(x.errors,[]);
});
