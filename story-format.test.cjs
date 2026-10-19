const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const tick=()=>new Promise(resolve=>setTimeout(resolve,35));
async function setup(storage={}, {autoConnect=false}={}){
 const html=fs.readFileSync(__dirname+'/index.html','utf8');
 const scripts=[...html.matchAll(/<script(?:\s+src="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]?fs.readFileSync(__dirname+'/'+m[1].split('?')[0],'utf8'):m[2]);
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g,''),{runScripts:'outside-only',url:'https://ecco-ai-labs.github.io/ecco-studio/',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
 const observers=[],Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(callback){super(callback);observers.push(this);}};
 w.testAutoconnect=autoConnect;
 w.fixtureState={records:[{id:'audio-story',kind:'story',title:'Audio Story'},{id:'video-story',kind:'story',title:'Video Story'}],config:{models_ready:{}},storage_pending:false};
 w.structuredClone=structuredClone;w.setInterval=()=>0;w.fetch=async url=>{if(autoConnect&&url.endsWith('/api/state'))return {ok:true,json:async()=>structuredClone(w.fixtureState)};throw Error('No network in UI test');};w.matchMedia=()=>({matches:false,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;
 w.localStorage.setItem('ecco-story-collections-v1',JSON.stringify({collections:[{id:'collection',name:'Stories'}],members:{}}));
 for(const [key,value] of Object.entries(storage))w.localStorage.setItem(key,value);
 if(autoConnect)w.sessionStorage.setItem('ecco-storage-access','mock-storage-session-for-ui-test');
 w.eval(scripts.join('\n;\n')+`\nwindow.testUI={navigate:p=>navigate(p),refreshStories:()=>storyControls(),refreshWorkspace:()=>refresh(),activeStory:()=>activeStory,currentStory:()=>currentStory(),selectStory(id){activeStory=id;localStorage.setItem('ecco-active-story',id);draft=loadDraft();window.EccoWorkspaceUI.selectJourneyStory(id);},getDraft:()=>draft};
 if(!window.testAutoconnect){
 state={records:[{id:'audio-story',kind:'story',title:'Audio Story'},{id:'video-story',kind:'story',title:'Video Story'}],config:{models_ready:{}},storage_pending:false};
 window.testCalls=[];api=async(path,body)=>{window.testCalls.push({path,body});if(path==='stories'){const record={id:'created-story',kind:'story',...body};state.records.push(record);return record;}return {};};refresh=async()=>true;}`);
 await tick();
 const q=s=>w.document.querySelector(s),nav=()=>[...w.document.querySelectorAll('#workspace-production-group .journey-step')].filter(b=>!b.hidden).map(b=>b.dataset.page);
 const choose=async value=>{const field=q('[name=story_format]');field.value=value;field.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();};
 return {w,q,nav,choose,errors,close:()=>{observers.forEach(observer=>observer.disconnect());w.close();},async go(p){w.testUI.navigate(p);await tick();},snapshot:()=>Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]))};
}
test('new stories require a format and immediately show the matching steps without duplicates',async()=>{
 const x=await setup();await x.go('story-setup');
 assert.equal(x.q('[name=story_format]').required,true);assert.equal(x.q('[name=story_format]').validity.valueMissing,true);
 assert.deepEqual(x.nav(),['story-setup','board','audio','images','render','journey-preview']);assert.equal(x.q('#story-setup-form').querySelector(':scope > label').dataset.storyFormat,'');
 await x.choose('audio');assert.deepEqual(x.nav(),['story-setup','board','audio']);
 await x.choose('video');assert.deepEqual(x.nav(),['story-setup','board','audio','images','render','journey-preview']);
 await x.choose('audio');assert.deepEqual(x.nav(),['story-setup','board','audio']);assert.match(x.q('#journey-guide').textContent,/STEP 1 OF 3/);
 assert.deepEqual(x.errors,[]);x.close();
});
test('saving an audio story retains its format and finishes the journey at Audio Studio',async()=>{
 const x=await setup();await x.go('story-setup');await x.choose('audio');
 const form=x.q('#story-setup-form');form.elements.collection_id.value='collection';form.elements.title.value='My Audio Story';form.elements.summary.value='A short story.';
 form.requestSubmit();await tick();await tick();
 assert.equal(x.w.testCalls.filter(c=>c.path==='stories').length,1);
 assert.equal(JSON.parse(x.w.localStorage.getItem('ecco-story-description:created-story')).story_format,'audio');
 assert.equal(x.w.testUI.getDraft().story_format,'audio');assert.match(x.q('#journey-guide').textContent,/STEP 2 OF 3/);
 assert.equal(x.q('#journey-guide').textContent.includes('AI storyboard & previews'),false);
 x.q('#journey-guide [data-next]').click();await tick();assert.ok(x.q('#audio-form'));assert.match(x.q('#journey-guide').textContent,/STEP 3 OF 3/);
 assert.equal(x.q('#journey-guide [data-next]'),null);assert.equal(x.q('#journey-guide').textContent.includes('Assign images'),false);
 const saved=x.snapshot();assert.deepEqual(x.errors,[]);x.close();
 const restored=await setup(saved);assert.equal(restored.nav().length,6);restored.w.testUI.selectStory('created-story');await restored.go('audio');assert.deepEqual(restored.nav(),['story-setup','board','audio']);assert.match(restored.q('#journey-guide').textContent,/STEP 3 OF 3/);restored.close();
});
test('switching saved stories restores each journey and leaves their scene drafts intact',async()=>{
 const saved={'ecco-story-description:audio-story':JSON.stringify({cloudId:'audio-story',story_format:'audio',title:'Audio Story'}),'ecco-board-draft:audio-story':JSON.stringify({title:'Audio Story',story:'Narration',story_format:'audio',scenes:[{narration:'Keep me',seconds:3,image_id:''}]}),'ecco-story-description:video-story':JSON.stringify({cloudId:'video-story',story_format:'video',title:'Video Story'})};
 const x=await setup(saved);x.w.testUI.selectStory('audio-story');await x.go('board');assert.equal(x.nav().length,3);
 x.w.testUI.selectStory('video-story');await x.go('board');assert.equal(x.nav().length,6);x.q('#journey-guide [data-next]').click();await tick();assert.match(x.q('#journey-guide').textContent,/STEP 3 OF 6/);assert.match(x.q('#journey-guide [data-next]').textContent,/images/i);
 x.w.testUI.selectStory('audio-story');await x.go('story-setup');assert.equal(x.q('[name=story_format]').value,'audio');assert.equal(x.w.testUI.getDraft().scenes[0].narration,'Keep me');
 await x.choose('video');assert.equal(x.nav().length,6);assert.equal(x.w.testUI.getDraft().scenes[0].narration,'Keep me');assert.deepEqual(x.errors,[]);x.close();
});
test('older stories keep their Video journey and board-only format preferences survive editing',async()=>{
 const x=await setup({'ecco-board-draft:audio-story':JSON.stringify({title:'Audio Story',story:'Narration',story_format:'audio',scenes:[]})});
 x.w.testUI.selectStory('video-story');await x.go('board');assert.equal(x.nav().length,6);
 x.w.testUI.selectStory('audio-story');await x.go('story-setup');assert.equal(x.q('[name=story_format]').value,'audio');assert.equal(x.nav().length,3);assert.deepEqual(x.errors,[]);x.close();
});
test('opening an audio story from Story Library goes to its storyboard instead of image generation',async()=>{
 const x=await setup({'ecco-story-description:audio-story':JSON.stringify({cloudId:'audio-story',story_format:'audio',title:'Audio Story'})});
 x.w.testUI.refreshStories();await tick();
 [...x.w.document.querySelectorAll('.project .tree-folder')].find(button=>button.textContent.includes('Audio Story')).click();await tick();
 assert.equal(x.q('#heading').textContent,'Storyboard');assert.equal(x.q('#image-form'),null);assert.deepEqual(x.nav(),['story-setup','board','audio']);assert.match(x.q('#journey-guide').textContent,/STEP 2 OF 3/);assert.deepEqual(x.errors,[]);x.close();
});


test('entry and libraries keep the full menu until an Audio story is explicitly selected',async()=>{
 const x=await setup({'ecco-active-story':'audio-story','ecco-story-description:audio-story':JSON.stringify({cloudId:'audio-story',story_format:'audio',title:'Audio Story'})});
 assert.equal(x.nav().length,6);
 x.q('#entry-tell-story').click();await tick();assert.equal(x.nav().length,6);
 await x.go('library');assert.equal(x.nav().length,6);
 x.w.testUI.refreshStories();await tick();
 [...x.w.document.querySelectorAll('.project .tree-folder')].find(button=>button.textContent.includes('Audio Story')).click();await tick();
 assert.deepEqual(x.nav(),['story-setup','board','audio']);
 x.w.testUI.selectStory('video-story');await x.go('board');assert.equal(x.nav().length,6);
 assert.deepEqual(x.errors,[]);x.close();
});
test('clearing Audio format restores all six steps',async()=>{
 const x=await setup();await x.go('story-setup');await x.choose('audio');assert.equal(x.nav().length,3);
 await x.choose('');assert.equal(x.nav().length,6);assert.match(x.q('#journey-guide').textContent,/STEP 1 OF 6/);
 assert.deepEqual(x.errors,[]);x.close();
});


test('refresh with a restored storage session starts unselected and keeps saved stories intact',async()=>{
 const stored={
  'ecco-active-story':'audio-story',
  'ecco-selected-collection':'collection',
  'ecco-story-description:audio-story':JSON.stringify({cloudId:'audio-story',story_format:'audio',title:'Audio Story',summary:'Keep my summary'}),
  'ecco-board-draft:audio-story':JSON.stringify({title:'Audio Story',story:'Keep my script',story_format:'audio',scenes:[{narration:'Keep my scene',seconds:5}]}),
  'ecco-audio-draft:audio-story':JSON.stringify({title:'Keep my recording',text:'Saved audio script'})
 };
 const x=await setup(stored,{autoConnect:true});
 assert.equal(x.w.EccoStorage.ready,true);
 assert.equal(x.w.testUI.activeStory(),'');assert.equal(x.w.testUI.currentStory().id,null);
 assert.equal(x.q('#story-picker').value,'');assert.equal(x.q('#story-picker').selectedOptions[0].textContent,'Choose a story');
 assert.equal(x.q('#delete-story').disabled,true);assert.equal(x.q('.project .tree-folder.selected'),null);
 assert.equal(x.nav().length,6);
 for(const [key,value] of Object.entries(stored).filter(([key])=>key.includes('draft:')||key.includes('description:')))assert.equal(x.w.localStorage.getItem(key),value);
 x.q('#entry-tell-story').click();await tick();
 await x.go('story-setup');assert.equal(x.q('[name=story_format]').value,'');assert.equal(x.q('[name=title]').value,'');assert.equal(x.nav().length,6);
 [...x.w.document.querySelectorAll('.project .tree-folder')].find(button=>button.textContent.includes('Audio Story')).click();await tick();
 assert.equal(x.w.testUI.activeStory(),'audio-story');assert.equal(x.nav().length,3);assert.equal(x.w.testUI.getDraft().scenes[0].narration,'Keep my scene');
 await x.w.testUI.refreshWorkspace();await tick();assert.equal(x.w.testUI.activeStory(),'audio-story');assert.equal(x.nav().length,3);
 const saved=x.snapshot();assert.deepEqual(x.errors,[]);x.close();
 const reloaded=await setup(saved,{autoConnect:true});
 assert.equal(reloaded.w.testUI.activeStory(),'');assert.equal(reloaded.nav().length,6);assert.equal(reloaded.q('.project .tree-folder.selected'),null);
 [...reloaded.w.document.querySelectorAll('.project .tree-folder')].find(button=>button.textContent.includes('Video Story')).click();await tick();
 assert.equal(reloaded.w.testUI.activeStory(),'video-story');assert.equal(reloaded.nav().length,6);assert.deepEqual(reloaded.errors,[]);reloaded.close();
});

test('a remembered unsaved Audio draft does not choose the new session format or discard scenes',async()=>{
 const stored={
  'ecco-new-story-draft':JSON.stringify({title:'Unfinished draft',summary:'Keep this idea',story_format:'audio'}),
  'ecco-board-new-draft':JSON.stringify({title:'Unfinished draft',story:'Keep this idea',story_format:'audio',scenes:[{narration:'Keep this unsaved scene',seconds:4}]})
 };
 const x=await setup(stored,{autoConnect:true});assert.equal(x.nav().length,6);
 for(const [key,value] of Object.entries(stored))assert.equal(x.w.localStorage.getItem(key),value);
 await x.go('story-setup');assert.equal(x.q('[name=story_format]').value,'');assert.equal(x.q('[name=title]').value,'Unfinished draft');assert.equal(x.nav().length,6);
 assert.equal(x.w.testUI.getDraft().scenes[0].narration,'Keep this unsaved scene');
 await x.choose('audio');assert.equal(x.nav().length,3);
 await x.choose('video');assert.equal(x.nav().length,6);assert.deepEqual(x.errors,[]);x.close();
});
