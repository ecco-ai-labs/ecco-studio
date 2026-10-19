const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const tick=()=>new Promise(resolve=>setTimeout(resolve,35));
async function setup(storage={}, {autoConnect=false,records=null}={}){
 const html=fs.readFileSync(__dirname+'/index.html','utf8');
 const scripts=[...html.matchAll(/<script(?:\s+src="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]?fs.readFileSync(__dirname+'/'+m[1].split('?')[0],'utf8'):m[2]);
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g,''),{runScripts:'outside-only',url:'https://ecco-ai-labs.github.io/ecco-studio/',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
 const observers=[],Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(callback){super(callback);observers.push(this);}};
 w.testAutoconnect=autoConnect;
 w.fixtureState={records:records||[{id:'audio-story',kind:'story',title:'Audio Story'},{id:'video-story',kind:'story',title:'Video Story'}],config:{models_ready:{}},storage_pending:false};
 w.structuredClone=structuredClone;w.setInterval=()=>0;w.fetch=async url=>{if(autoConnect&&url.endsWith('/api/state'))return {ok:true,json:async()=>structuredClone(w.fixtureState)};throw Error('No network in UI test');};w.matchMedia=()=>({matches:false,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;
 w.localStorage.setItem('ecco-story-collections-v1',JSON.stringify({collections:[{id:'collection',name:'Stories'}],members:{}}));
 for(const [key,value] of Object.entries(storage))w.localStorage.setItem(key,value);
 if(autoConnect)w.sessionStorage.setItem('ecco-storage-access','mock-storage-session-for-ui-test');
 w.eval(scripts.join('\n;\n')+`\nwindow.testUI={navigate:p=>navigate(p),refreshStories:()=>storyControls(),refreshWorkspace:()=>refresh(),activeStory:()=>activeStory,currentStory:()=>currentStory(),selectStory(id){activeStory=id;localStorage.setItem('ecco-active-story',id);draft=loadDraft();window.EccoWorkspaceUI.selectJourneyStory(id);},getDraft:()=>draft,setAPI(fn){api=fn;}};
 if(!window.testAutoconnect){
 state=window.fixtureState;
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
 await x.go('story-setup');assert.equal(x.q('[name=story_format]').value,'');assert.equal(x.q('[name=title]').value,'');assert.equal(x.nav().length,6);
 await x.go('story-library');x.q('[data-local-story-id]').click();await tick();
 assert.equal(x.q('[name=title]').value,'Unfinished draft');assert.equal(x.q('[name=story_format]').value,'audio');assert.equal(x.nav().length,3);
 assert.equal(x.w.testUI.getDraft().scenes[0].narration,'Keep this unsaved scene');
 await x.choose('audio');assert.equal(x.nav().length,3);
 await x.choose('video');assert.equal(x.nav().length,6);assert.deepEqual(x.errors,[]);x.close();
});


test('entry links to a story-only icon library without selecting a story',async()=>{
 const records=[{id:'arabian',kind:'story',title:'Arabian Nights',summary:'A tale of a merchant and a genie.'},{id:'news',kind:'story',title:'Finance News',summary:'Today’s finance headlines.'}];
 const x=await setup({}, {autoConnect:true,records});
 x.q('#entry-tell-story').click();await tick();assert.equal(x.q('#heading').textContent,'');assert.equal(x.q('#open-story-library'),null);assert.equal(x.q('#page').textContent.trim(),'');assert.equal(x.w.testUI.activeStory(),'');
 await x.go('story-setup');x.q('[data-story-library]').click();await tick();assert.equal(x.q('#heading').textContent,'Story Library');assert.equal(x.q('#story-library-list .text-library-card').querySelector('svg')!==null,true);
 assert.equal(x.q('#story-library-list').querySelectorAll('.text-library-card').length,2);assert.equal(x.q('#image-form'),null);assert.equal(x.w.testUI.activeStory(),'');
 x.q('[data-story-id="arabian"]').click();await tick();assert.equal(x.q('#heading').textContent,'Storyboard');assert.equal(x.q('#story-text').value,'A tale of a merchant and a genie.');assert.equal(x.q('#image-form'),null);
 await x.go('story-library');x.q('[data-story-id="news"]').click();await tick();assert.equal(x.q('#story-text').value,'Today’s finance headlines.');
 await x.go('story-library');x.q('[data-story-id="arabian"]').click();await tick();assert.equal(x.q('#story-text').value,'A tale of a merchant and a genie.');assert.deepEqual(x.errors,[]);x.close();
});

test('foreign-owned description and scene caches cannot appear under Arabian Nights',async()=>{
 const records=[{id:'arabian',kind:'story',title:'Arabian Nights',summary:'A tale of a merchant and a genie.'},{id:'news',kind:'story',title:'Finance News',summary:'Finance updates.'}];
 const x=await setup({'ecco-story-description:arabian':JSON.stringify({cloudId:'news',title:'Finance News',genre:'News',news_topic:'Finance',summary:'Foreign finance summary'}),'ecco-board-draft:arabian':JSON.stringify({story_id:'news',title:'Finance News',story:'Foreign finance narration',scenes:[{narration:'Foreign news'}]})},{autoConnect:true,records});
 x.w.EccoWorkspaceUI.openStory('arabian');await tick();assert.equal(x.q('#story-text').value,'A tale of a merchant and a genie.');assert.ok(x.w.localStorage.getItem('ecco-story-recovery:ownership:arabian'));
 await x.go('story-setup');assert.equal(x.q('[name=genre]').value,'');assert.equal(x.q('[name=summary]').value,'A tale of a merchant and a genie.');assert.ok(x.w.localStorage.getItem('ecco-story-recovery:description:arabian'));assert.deepEqual(x.errors,[]);x.close();
});

test('new stories are blank and saved drafts remain separately selectable',async()=>{
 const x=await setup({'ecco-new-story-draft':JSON.stringify({title:'News draft',genre:'News',news_topic:'Finance',summary:'Finance script',story_format:'audio'}),'ecco-board-new-draft':JSON.stringify({title:'News draft',story:'Finance script',scenes:[{narration:'A news scene'}]})});
 await x.go('story-setup');assert.equal(x.q('[name=title]').value,'');assert.equal(x.q('[name=genre]').value,'');assert.equal(x.q('[name=summary]').value,'');assert.equal(x.q('[name=story_format]').value,'');
 await x.go('story-library');x.q('[data-local-story-id]').click();await tick();assert.equal(x.q('[name=title]').value,'News draft');assert.equal(x.q('[name=summary]').value,'Finance script');assert.equal(x.w.testUI.getDraft().scenes[0].narration,'A news scene');
 assert.deepEqual(x.errors,[]);x.close();
});

test('a delayed story save does not take over a different selected story',async()=>{
 const x=await setup();await x.go('story-setup');await x.choose('audio');const form=x.q('#story-setup-form');form.elements.collection_id.value='collection';form.elements.title.value='Pending story';form.elements.summary.value='Pending script';
 let finish;x.w.testUI.setAPI(async path=>{if(path==='stories')return new Promise(resolve=>finish=resolve);return {};});form.requestSubmit();await tick();
 x.w.EccoWorkspaceUI.openStory('video-story');await tick();finish({id:'pending-story'});await tick();await tick();
 assert.equal(x.w.testUI.activeStory(),'video-story');assert.equal(x.q('#board-title').value,'Video Story');assert.equal(JSON.parse(x.w.localStorage.getItem('ecco-board-draft:pending-story')).story,'Pending script');assert.deepEqual(x.errors,[]);x.close();
});

test('story delete buttons archive the clicked story without opening its editor',async()=>{
 const x=await setup();x.w.testUI.setAPI(async(path,body)=>{x.w.testCalls.push({path,body});if(path==='stories/archive')x.w.fixtureState.records.find(row=>row.id===body.story_id).deleted=!body.restore;return {};});await x.go('story-library');
 x.q('#story-library-list [aria-label="Delete Video Story"]').click();await tick();await tick();
 assert.deepEqual(JSON.parse(JSON.stringify(x.w.testCalls[0])),{path:'stories/archive',body:{story_id:'video-story'}});assert.equal(x.q('[data-story-id="video-story"]'),null);assert.equal(x.w.testUI.activeStory(),'');assert.equal(x.q('#image-form'),null);
 await x.go('trash');assert.match(x.q('#trash-items').textContent,/Video Story/);assert.deepEqual(x.errors,[]);x.close();
});

test('workflow library shows icons and reversible delete controls without opening a default workflow',async()=>{
 const x=await setup({'ecco-workflow-drafts':JSON.stringify([{id:'workflow-a',name:'Evening headlines',prompt:'Review today’s headlines',count:5,duration:60}])});
 await x.go('workflow-library');assert.equal(x.q('#workflow-form'),null);assert.ok(x.q('#workflow-library-list svg'));assert.equal(x.w.testUI.activeStory(),'');
 x.q('#workflow-library-list [aria-label="Delete Evening headlines"]').click();await tick();assert.equal(x.q('#workflow-library-list .text-library-card'),null);
 await x.go('trash');x.q('[aria-label="Restore Evening headlines"]').click();await tick();await x.go('workflow-library');assert.ok(x.q('#workflow-library-list .text-library-card'));
 x.q('#workflow-library-new').click();await tick();assert.equal(x.q('#workflow-form [name=name]').value,'');assert.equal(x.q('#workflow-form [name=prompt]').value,'');assert.equal(x.w.testCalls.length,0);assert.deepEqual(x.errors,[]);x.close();
});

test('Research Prompt starts with the selected story script without making an AI request',async()=>{
 const x=await setup({'ecco-board-draft:audio-story':JSON.stringify({story_id:'audio-story',title:'Audio Story',story:'Research recent Tamil cinema releases and write the scenes in Hindi.',scenes:[]})});
 x.w.EccoWorkspaceUI.openStory('audio-story');await tick();x.q('[data-web-research]').click();await tick();
 assert.equal(x.q('#news-research-dialog [data-prompt]').value,x.q('#story-text').value);assert.equal(x.w.testCalls.length,0);assert.deepEqual(x.errors,[]);x.close();
});

test('selecting a saved story does not empty a separate unfinished draft; deleting that draft is reversible',async()=>{
 const x=await setup({'ecco-new-story-draft':JSON.stringify({title:'Unfinished narration',summary:'Keep these words',story_format:'audio'}),'ecco-board-new-draft':JSON.stringify({title:'Unfinished narration',story:'Keep these words',scenes:[{narration:'Keep this scene'}]})});
 x.w.EccoWorkspaceUI.openStory('video-story');await tick();await x.go('story-library');x.q('[data-local-story-id]').click();await tick();assert.equal(x.w.testUI.getDraft().scenes[0].narration,'Keep this scene');
 await x.go('story-library');x.q('#story-library-list [aria-label="Delete Unfinished narration"]').click();await tick();assert.equal(x.q('[data-local-story-id]'),null);
 await x.go('trash');x.q('[aria-label="Restore Unfinished narration"]').click();await tick();await x.go('story-library');x.q('[data-local-story-id]').click();await tick();assert.equal(x.w.testUI.getDraft().scenes[0].narration,'Keep this scene');assert.deepEqual(x.errors,[]);x.close();
});

test('Story Format is a separate Audio/Video toggle immediately before Upload with no default',async()=>{
 const x=await setup();await x.go('story-setup');const panel=x.q('#story-entry-panel'),control=x.q('.story-format-control');
 assert.equal(panel.firstElementChild,control);assert.equal(control.nextElementSibling.className,'story-source-controls');assert.deepEqual([...control.nextElementSibling.children].map(node=>node.textContent.trim()),['Story Library','Manual','Upload⌄Upload PDFPreview & Select×']);
 assert.equal(control.querySelectorAll('[aria-pressed="true"]').length,0);
 control.querySelector('[data-story-format-option="audio"]').click();await tick();assert.equal(x.q('[name=story_format]').value,'audio');assert.equal(x.nav().length,3);assert.equal(control.querySelector('[aria-pressed="true"]').textContent,'Audio');
 control.querySelector('[data-story-format-option="video"]').click();await tick();assert.equal(x.q('[name=story_format]').value,'video');assert.equal(x.nav().length,6);assert.deepEqual(x.errors,[]);x.close();
});

test('creating a storyboard from research applies selected results without a replacement dialog',async()=>{
 const x=await setup({'ecco-board-draft:audio-story':JSON.stringify({story_id:'audio-story',title:'Audio Story',story:'Existing script',scenes:[{narration:'Existing scene'}]})},{autoConnect:true});
 Object.defineProperty(x.w.EccoAI,'enabled',{get:()=>true});x.w.confirm=()=>{throw Error('Unexpected replacement confirmation');};
 x.w.testUI.setAPI(async(path)=>{
  if(path==='ai/status')return {news_research:true};
  if(path==='ai/news/research')return {signature:'test-signature',research:{items:Array.from({length:10},(_,i)=>({title:'Item '+i,summary:'Summary '+i,sources:[]}))}};
  if(path==='ai/news/storyboard')return {scenes:Array.from({length:10},(_,i)=>({title:'Item '+i,narration:'Updated narration '+i,seconds:3})),researched_at:'test'};
  throw Error('Unexpected API path '+path);
 });
 x.w.EccoWorkspaceUI.openStory('audio-story');await tick();x.q('[data-web-research]').click();await tick();x.q('[data-research]').click();await tick();x.q('[data-create]').click();await tick();
 assert.match(x.q('#story-text').value,/Updated narration 0/);assert.equal(x.w.testUI.getDraft().scenes.length,10);assert.equal(x.q('#news-research-dialog').open,false);assert.deepEqual(x.errors,[]);x.close();
});


test('the Story Library control beside Manual and Upload opens the library without selecting a story',async()=>{
 const x=await setup();await x.go('story-setup');x.q('[data-story-library]').click();await tick();assert.equal(x.q('#heading').textContent,'Story Library');assert.equal(x.w.testUI.activeStory(),'');assert.equal(x.q('#story-setup-form'),null);assert.deepEqual(x.errors,[]);x.close();
});
