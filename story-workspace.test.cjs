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
test('the top-level Library heading lists all libraries from every story tab and preserves its draft',async()=>{
 for(const tab of [0,1,2]){
  const x=await fixture();await x.start();x.script('Host: Keep my draft.\n\nGuest: Keep mine.');await x.w.EccoStoryWorkspace.select(tab);await tick();
  const draftId=x.saved().localDraftId;
  x.q('#workspace-library-group > summary span:last-child').click();await tick();
  assert.equal(x.w.testState.page(),'library-home');assert.deepEqual([...x.q('#library-home-list').querySelectorAll('.library-home-name')].map(b=>b.textContent),['Story Library','Image Library','Audio Library','Video Library','Workflow Library']);assert.equal(x.q('#heading').textContent,'Library');assert.equal(x.q('#journey-guide').hidden,true);
  assert.equal(x.q('#story-workspace-header').hidden,true);assert.equal(x.w.EccoStoryWorkspace.active,false);
  assert.equal(x.w.document.body.classList.contains('story-simple-mode'),false);
  assert.equal(x.q('#page').hasAttribute('role'),false);assert.equal(x.q('#page').hasAttribute('aria-labelledby'),false);
  assert.match(JSON.parse(x.w.localStorage.getItem('ecco-story-setup:'+draftId)).simple_workspace.script,/Keep my draft/);
  x.w.EccoStoryWorkspace.openSetup(draftId);await tick();assert.equal(x.q('#story-workspace-header').hidden,false);assert.equal(x.w.EccoStoryWorkspace.active,true);
  assert.match(x.saved().simple_workspace.script,/Keep my draft/);assert.deepEqual(x.errors,[]);x.close();
 }
});
test('each Library choice opens and highlights the matching expanded left-nav library',async()=>{
 const x=await fixture();await x.start();
 for(const [kind,selector,route]of [['image','#image-library-nav > details > summary','library'],['audio','#workspace-audio-library > summary','audio-library'],['video','#workspace-video-library > summary','video-library'],['story','.project > details > summary','story-library'],['workflow','#workflow-library > summary','workflow-library']]){
  x.q('#workspace-library-group > summary').click();await tick();assert.equal(x.w.testState.page(),'library-home');assert.equal(x.q('#story-workspace-header').hidden,true);assert.equal(x.q('#journey-guide').hidden,true);
  x.q('#workspace-library-group').open=false;
  x.q('[data-library-destination="'+kind+'"]').click();await tick();assert.equal(x.w.testState.page(),route);assert.ok(x.q('#page').childElementCount>0);assert.equal(x.q('#library-home-list'),null);
  const summary=x.q(selector);assert.equal(x.q('#workspace-library-group').open,true);assert.equal(summary.closest('details').open,true);assert.equal(summary.getAttribute('aria-current'),'page');assert.equal(summary.classList.contains('active'),true);assert.equal(x.w.document.activeElement,summary);assert.equal(x.q('#story-workspace-header').hidden,true);
 }
 assert.deepEqual(x.errors,[]);
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
test('Generate With AI opens an instruction dialog immediately, even without a brief',async()=>{
 const x=await fixture();await x.start();x.q('#page [data-ai]').click();await tick();const dialog=x.q('#ai-generation-dialog');assert.ok(dialog?.open);assert.equal(dialog.querySelector('[name=instructions]').value,'');assert.equal(x.w.testCalls.length,0);assert.deepEqual(x.errors,[]);
});

test('AI shows connection failures inline and does not submit until storage is ready',async()=>{
 const x=await fixture();await x.start();x.w.testStorageReady=false;await requestStoryAI(x,'Write a funny business podcast.');
 assert.match(x.q('#story-simple-ai-status').textContent,/Connect Storage/);assert.equal(x.q('[data-ai-connections]').hidden,false);assert.equal(x.q('#page [data-ai]').disabled,false);assert.equal(x.w.testCalls.length,0);
});
test('AI scopes controls to this story and shows pending, error and retry states',async()=>{
 const x=await fixture();await x.start();const unrelated=x.w.document.createElement('input');unrelated.setAttribute('data-ai','0');x.w.document.body.prepend(unrelated);await x.w.EccoStoryWorkspace.select(1);
 let reject;x.w.testAPI=()=>new Promise((_,r)=>reject=r);await requestStoryAI(x,'Explain business news.');assert.equal(x.q('#page [data-ai]').disabled,true);assert.equal(x.q('#page [data-ai]').textContent,'Generating…');assert.match(x.q('#story-simple-ai-status').textContent,/Writing/);assert.equal(unrelated.disabled,false);
 reject(Error('AI service is unavailable.'));await tick();assert.match(x.q('#story-simple-ai-status').textContent,/AI service is unavailable/);assert.equal(x.q('#page [data-ai]').disabled,false);assert.equal(x.q('#page [data-ai]').textContent,'Generate With AI');assert.deepEqual(x.errors,[]);
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

test('Generate With AI carries Story Details, synchronizes edits immediately and includes them beside the prompt',async()=>{
 const x=await fixture();await x.start();x.q('#page [data-ai]').click();await tick();
 const dialog=x.q('#ai-generation-dialog');assert.ok(dialog.classList.contains('story-generation-dialog'));
 assert.equal(dialog.querySelector('[name=story_type]').value,'podcast');assert.equal(dialog.querySelector('[name=genre]').value,'Business');assert.equal(dialog.querySelector('[name=age_group]').value,'Adults (18+)');assert.equal(dialog.querySelector('[name=language]').value,'English');assert.equal(dialog.querySelector('[name=location]').value,'India');
 for(const [key,value] of Object.entries({story_type:'storybook',genre:'Adventure',age_group:'Children (9–12)',language:'Hindi',location:'Worldwide'}))x.fill(key,value);
 assert.equal(x.w.testCalls.filter(c=>c.path==='ai/enhance').length,0);let saved=x.saved().simple_workspace;assert.equal(saved.type,'storybook');assert.equal(saved.genre,'Adventure');assert.equal(saved.audience,'Children (9–12)');assert.equal(saved.language,'Hindi');assert.equal(saved.location,'Worldwide');
 dialog.close();await x.w.EccoStoryWorkspace.select(0);assert.equal(x.q('[name=type]').value,'storybook');assert.equal(x.q('[name=audience]').value,'Children (9–12)');assert.equal(x.q('[name=language]').value,'Hindi');x.fill('genre','Fantasy');await x.w.EccoStoryWorkspace.select(1);
 x.q('#page [data-ai]').click();await tick();assert.equal(x.q('#ai-generation-dialog [name=genre]').value,'Fantasy');x.q('#ai-generation-dialog [name=instructions]').value='A funny adventure about a lost lantern.';x.q('#ai-generation-dialog form').requestSubmit();await tick();
 const request=x.w.testCalls.find(c=>c.path==='ai/enhance');assert.ok(request);assert.equal(request.body.context.genre,'Fantasy');assert.equal(request.body.context.language,'Hindi');assert.match(request.body.context.instructions,/lost lantern/);const context=JSON.parse(request.body.context.summary);assert.equal(context.story_type,'storybook');assert.equal(context.audience,'Children (9–12)');assert.equal(context.location,'Worldwide');
});

test('Back to Story Details reflects the Story Type changed in the second tab',async()=>{
 const x=await fixture();await x.start('audio','news');await x.w.EccoStoryWorkspace.select(0);await tick();await x.w.EccoStoryWorkspace.select(1);await tick();
 x.q('[data-ai]').click();await tick();x.fill('story_type','storybook');x.q('#ai-generation-dialog').close();await tick();assert.equal(x.saved().simple_workspace.type,'storybook');x.w.EccoNavigation.back();await tick();assert.equal(x.q('#story-simple-details [name=type]').value,'storybook');
});

const ensembleText='Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.';
const ensembleCast=[{id:'n',name:'Narrator',role:'Narration',gender:'Female',language:'English',voice:'en_female',dialect:'Indian English',style:'Warm',emotion:'neutral',delivery:'Clear and measured.'},{id:'a',name:'Ali',role:'Woodcutter',gender:'Male',age_group:'Adult',language:'English',voice:'en_male',dialect:'Indian English',style:'Curious',emotion:'surprise',delivery:'Bright and expressive.'},{id:'m',name:'Morgiana',role:'Resourceful helper',gender:'Female',age_group:'Adult',language:'English',voice:'en_female',dialect:'Indian English',style:'Confident',emotion:'neutral',delivery:'Calm and decisive.'}];
const ensembleSegments=[{character_id:'n',text:'At the cave.'},{character_id:'a',text:'Open sesame!'},{character_id:'m',text:'I will help.'}];
async function sourceHandle(x){let options;x.w.EccoSourcePicker.create=value=>{options=value;return {ready:true,load:async()=>{},destroy(){}};};const input=x.q('[data-file]');Object.defineProperty(input,'files',{value:[{name:'cast.txt',private:'UNSELECTED_PRIVATE'}]});await input.onchange({target:input});return options;}
test('Apply Text automatically identifies the audio cast and passes voices and exact speaker text into Audio Studio',async()=>{
 const x=await fixture();await x.start('audio','news');const source=await sourceHandle(x);source.aiSettings.onChange({story_type:'storybook',genre:'Adventure'});
 const received=[];x.w.testAPI=async(path,body)=>{received.push({path,body});return path==='stories'?{id:'cast-story',kind:'story'}:{revisions:[{id:'story_workspace',text:JSON.stringify({characters:ensembleCast,segments:ensembleSegments,reason:'Narration and two distinct speaking roles.'})}]};};
 assert.equal(received.length,0);source.onApply({text:ensembleText,name:'cast.txt',pages:[2]});await tick();assert.equal(received.length,1);const request=received[0].body,context=JSON.parse(request.context.summary);assert.equal(context.output,'audio');assert.equal(context.story_type,'storybook');assert.equal(context.script,ensembleText);assert.equal(context.source.text,undefined);assert.equal(request.context.lines.length,0);assert.doesNotMatch(JSON.stringify(request),/UNSELECTED_PRIVATE/);assert.match(request.context.instructions,/never replace a multi-character story with a lone narrator/);
 assert.equal(x.q('[data-count]').value,'3');assert.equal(x.q('#story-simple-script').value,ensembleText);assert.equal(x.q('[data-property=appearance]'),null);assert.equal(x.q('[data-character="1"][data-property=voice]').value,'en_male');assert.equal(x.q('[data-character="1"][data-property=dialect]').value,'Indian English');assert.equal(x.q('[data-cast-panel]').getAttribute('aria-busy'),'false');assert.match(x.q('[data-cast-reason]').textContent,/3 audio characters/);assert.equal(x.q('#story-simple-candidate').hidden,true);
 await x.w.EccoStoryWorkspace.select(0);assert.equal(x.q('[name=type]').value,'storybook');assert.equal(x.q('[name=output]').value,'audio');x.fill('type','audio-drama');x.q('[name=type]').dispatchEvent(new x.w.Event('change'));assert.equal(x.saved().simple_workspace.cast.length,3);await x.w.EccoStoryWorkspace.select(2);await tick();const audio=JSON.parse(x.w.localStorage.getItem('ecco-audio-draft:cast-story'));assert.equal(audio.speakers.length,3);assert.equal(audio.speakers[1].voice,'en_male');assert.equal(audio.speakers[1].dialect,'Indian English');assert.equal(audio.lines[1].speaker_id,'a');assert.equal(audio.lines[1].text,'Open sesame!');assert.equal(audio.lines[2].speaker_id,'m');assert.deepEqual(x.errors,[]);
});
test('image characters expose visual properties and exclude audio voices and audio-only library entries',async()=>{
 const x=await fixture();await x.start('image','storybook');const source=await sourceHandle(x);x.w.testAPI=async()=>({revisions:[{id:'story_workspace',text:JSON.stringify({characters:[{id:'a',name:'Ali',appearance:'A woodcutter in a blue tunic.'},{id:'m',name:'Morgiana',appearance:'A woman carrying a lantern.'}],reason:'Two visible characters.'})}]});
 source.onApply({text:'Ali and Morgiana stand at the cave.',name:'cast.txt'});await tick();assert.equal(x.q('[data-count]').value,'2');assert.ok(x.q('[data-property=appearance]'));assert.equal(x.q('[data-property=voice]'),null);assert.equal(x.q('[data-property=dialect]'),null);assert.equal(x.q('[data-property=emotion]'),null);
 x.w.localStorage.setItem('ecco-audio-character-sets-v1',JSON.stringify([{name:'Audio-only speaker',output:'audio',cast:ensembleCast},{name:'Visual cast',output:'image',cast:[{id:'v',name:'Visual'}]}]));x.q('[data-library]').click();await tick();const library=x.q('[aria-label="Choose characters from library"]');assert.doesNotMatch(library.textContent,/Audio-only speaker/);assert.match(library.textContent,/Visual cast/);assert.deepEqual(x.errors,[]);
});
test('a late automatic cast result preserves new script edits and does not change a new story',async()=>{
 const x=await fixture();await x.start('audio','storybook');const source=await sourceHandle(x);let finish;x.w.testAPI=()=>new Promise(r=>finish=r);source.onApply({text:ensembleText,name:'cast.txt'});await tick();assert.equal(x.q('[data-count]').disabled,true);assert.equal(x.q('[data-cast-panel]').getAttribute('aria-busy'),'true');x.script('My newer edit.');finish({revisions:[{id:'story_workspace',text:JSON.stringify({characters:ensembleCast,segments:ensembleSegments})}]});await tick();assert.equal(x.q('#story-simple-script').value,'My newer edit.');assert.equal(x.q('[data-count]').value,'1');assert.equal(x.q('[data-count]').disabled,false);assert.match(x.q('[data-cast-reason]').textContent,/could not finish/);
 source.onApply({text:ensembleText,name:'cast.txt'});await tick();x.w.EccoWorkspaceUI.startNewStory({id:'custom',format:''});await tick();finish({revisions:[{id:'story_workspace',text:JSON.stringify({characters:ensembleCast,segments:ensembleSegments})}]});await tick();assert.equal(x.saved().simple_workspace.cast.length,0);assert.equal(x.saved().simple_workspace.script,'');assert.deepEqual(x.errors,[]);
});
test('source voice assignment rejects rewritten text, reordered dialogue and invented speaker IDs',()=>{
 const plan=M.sourcePlan(ensembleText,ensembleCast,ensembleSegments);assert.equal(plan.segments[2].character_id,'m');
 assert.throws(()=>M.sourcePlan(ensembleText,ensembleCast,[...ensembleSegments].reverse()),/changed source words/);
 assert.throws(()=>M.sourcePlan(ensembleText,ensembleCast,[{character_id:'unknown',text:'Invented.'}]),/valid speakers/);
 assert.throws(()=>M.sourcePlan(ensembleText,ensembleCast,[{character_id:'n',text:'An invented replacement.'}]),/changed source words/);
});
test('cast detection reads the final edited selection and keeps a valid cast even if speaker assignment needs retry',async()=>{
 const x=await fixture();await x.start('audio','storybook');const source=await sourceHandle(x),finalText='Ali and Morgiana enter the cave. The author credit has been removed.';let sent;
 x.w.testAPI=async(path,body)=>{sent=JSON.parse(body.context.summary);return {revisions:[{id:'story_workspace',text:JSON.stringify({characters:ensembleCast,segments:[{character_id:'n',text:'An unwanted rewritten story.'}]})}]};};
 source.onApply({text:finalText,name:'edited.pdf'});await tick();assert.equal(sent.script,finalText);assert.equal(sent.source.text,undefined);assert.equal(x.q('#story-simple-script').value,finalText);assert.equal(x.q('[data-count]').value,'3');assert.match(x.q('#story-simple-ai-status').textContent,/Speaker assignment needs another attempt/);assert.equal(x.saved().simple_workspace.plan,null);
});
