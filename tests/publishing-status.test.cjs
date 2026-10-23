const {test}=require('node:test'),assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),{join}=require('node:path'),{JSDOM}=require('jsdom');
function setup(saved){
 const dom=new JSDOM('<div id="connection-indicators"></div><div id="page"></div><aside id="activity-panel"><div id="jobs"></div></aside>',{runScripts:'outside-only',url:'https://ecco-ai-labs.github.io/ecco-studio/'}),w=dom.window;
 w.$=s=>w.document.querySelector(s);w.esc=s=>String(s??'');w.names={};w.EccoStorage={ready:true};w.state={config:{youtube_configured:true,youtube_channel:{id:'UC-owner',title:'Owner'}},records:[{kind:'asset',id:'asset-a',media:'video',stage:'prod',title:'My film',created:1700000000}]};w.assets=()=>w.state.records.filter(r=>r.kind==='asset');w.currentStory=()=>({id:'story',title:'Story'});w.notice=()=>{};w.action=async fn=>fn();w.setInterval=()=>0;
 let handler=async()=>({id:'job-a',status:'queued'});w.api=(...args)=>handler(...args);w.logged=[];w.EccoErrorLog={record:(e,d)=>w.logged.push({message:e.message||String(e),...d}),redact:s=>s.replace(/Bearer\s+\S+/g,'Bearer [REDACTED]')};
 const source=readFileSync(join(__dirname,'../studio.js'),'utf8');w.eval(source.slice(source.indexOf('function connectYouTube('),source.indexOf('function navigate(p)')));
 for(const file of ['publishing-platforms.js','youtube-playlists.js','publishing-library.js'])w.eval(readFileSync(join(__dirname,'../'+file),'utf8'));
 if(saved)w.localStorage.setItem('ecco-publishing-attempts-v1',saved);w.eval(readFileSync(join(__dirname,'../publishing-status.js'),'utf8'));w.publishPage();return {dom,w,setHandler:f=>handler=f};
}
const body={asset_id:'asset-a',title:'My film',channel_id:'UC-owner',visibility:'private',confirmed:true,made_for_kids:false};
test('submission is immediately visible with spinner, then follows real progress and links the confirmed upload',async t=>{
 const {dom,w,setHandler}=setup();t.after(()=>dom.window.close());let resolve;setHandler(()=>new Promise(r=>resolve=r));const request=w.api('youtube/publish',body);
 assert.match(w.$('#publishing-status').textContent,/Sending upload request/);assert.match(w.$('#jobs').textContent,/My film/);assert.equal(w.$('.publishing-toolbar button').getAttribute('aria-busy'),'true');assert.ok(w.$('.publishing-toolbar .publishing-spinner'));
 resolve({id:'job-a',status:'queued'});await request;assert.match(w.$('#jobs').textContent,/job-a/);
 w.state.records.push({kind:'job',id:'job-a',status:'running',progress:'Uploading: 38%',created:Date.now()/1000});w.EccoPublishingStatus.sync();assert.match(w.$('#publishing-status').textContent,/Uploading: 38%/);
 Object.assign(w.state.records[0],{upload_state:'uploaded',youtube_id:'abcdefghijk',youtube_visibility:'private'});Object.assign(w.state.records[1],{status:'done',result:'abcdefghijk'});w.EccoPublishingStatus.sync();
 assert.match(w.$('#publishing-status').textContent,/Uploaded to YouTube · private/);assert.equal(w.$('#publishing-status a').href,'https://www.youtube.com/watch?v=abcdefghijk');assert.equal(w.$('.publishing-toolbar button').getAttribute('aria-busy'),'false');assert.equal(w.$('.publishing-toolbar .publishing-spinner'),null);
 assert.equal(w.EccoPublishingStatus.jobs().filter(j=>j.id==='job-a').length,1);assert.equal(w.logged.length,0);
});
test('a request rejected before job creation remains in Activity, Debugging data and Errors without a spinner',async t=>{
 const {dom,w,setHandler}=setup();t.after(()=>dom.window.close());setHandler(async()=>{throw Object.assign(Error('Invalid title'),{status:400});});await assert.rejects(w.api('youtube/publish',body),/Invalid title/);
 assert.match(w.$('#jobs').textContent,/Upload not accepted.*Invalid title/);assert.match(w.$('#publishing-status').textContent,/Invalid title/);const job=w.EccoPublishingStatus.jobs()[0];assert.equal(job.operation,'youtube.publish');assert.equal(job.asset_id,'asset-a');assert.equal(job.channel_id,'UC-owner');assert.equal(job.status,'rejected');assert.equal(w.logged[0].endpoint,'youtube/publish');assert.equal(w.EccoPublishingStatus.busy(),0);
});
test('worker failure updates persistent history and logs the same job once',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());await w.api('youtube/publish',body);w.state.records.push({kind:'job',id:'job-a',status:'failed',error:'Upload quota exceeded'});w.EccoPublishingStatus.sync();w.EccoPublishingStatus.sync();
 assert.match(w.$('#publishing-status').textContent,/Upload failed.*quota/);assert.equal(w.logged.length,1);assert.equal(w.logged[0].job_id,'job-a');assert.equal(w.EccoPublishingStatus.busy(),0);
});
test('existing successful uploads are recovered with visibility and URL, without resubmitting',t=>{
 const {dom,w,setHandler}=setup();t.after(()=>dom.window.close());let calls=0;setHandler(()=>{calls++;});Object.assign(w.state.records[0],{upload_state:'uploaded',youtube_id:'abcdefghijk',youtube_visibility:'public',youtube_channel_id:'UC-owner'});w.EccoPublishingStatus.sync();
 assert.match(w.$('#publishing-status').textContent,/Uploaded to YouTube · public/);assert.match(w.$('#jobs').textContent,/My film/);assert.equal(w.EccoPublishingStatus.jobs()[0].result,'abcdefghijk');assert.equal(calls,0);
});
test('unknown requests survive refresh, redact errors and never infer success or automatically retry',async t=>{
 const {dom,w,setHandler}=setup();t.after(()=>dom.window.close());setHandler(async()=>{throw Error('Network failed Bearer private-test-value');});await assert.rejects(w.api('youtube/publish',body));const saved=w.localStorage.getItem('ecco-publishing-attempts-v1');assert.equal(saved.includes('private-test-value'),false);
 const second=setup(saved);t.after(()=>second.dom.window.close());second.w.EccoPublishingStatus.sync();assert.equal(second.w.EccoPublishingStatus.list()[0].status,'unknown');assert.equal(second.w.$('#publishing-status a'),null);assert.equal(second.w.EccoPublishingStatus.busy(),0);
});
test('status refresh preserves per-video title edits and keyboard focus',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());const form=w.$('#publish-form');form.publishingSelection.add(['asset-a']);const title=form.querySelector('[name="publish-title-asset-a"]');title.value='Edited title';title.dispatchEvent(new w.Event('input'));title.focus();await w.api('youtube/publish',body);w.EccoPublishingStatus.sync();assert.equal(w.document.activeElement,title);assert.equal(title.value,'Edited title');
});
test('stale reserved assets are reported as unknown rather than silently disappearing',t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());w.state.records[0].upload_state='reserved';w.EccoPublishingStatus.sync();assert.match(w.$('#publishing-status').textContent,/status is unknown/);assert.equal(w.$('#publishing-status a'),null);assert.equal(w.EccoPublishingStatus.busy(),0);
});
test('Debugging renders publishing details for a request that never became a worker job',async t=>{
 const {dom,w,setHandler}=setup();t.after(()=>dom.window.close());setHandler(async()=>{throw Object.assign(Error('Invalid audience'),{status:400});});await assert.rejects(w.api('youtube/publish',body));
 const observers=[],NativeObserver=w.MutationObserver;w.MutationObserver=class{constructor(cb){const observer=new NativeObserver(cb);observers.push(observer);return observer;}};const source=readFileSync(join(__dirname,'../updates/workspace-ui.js'),'utf8');const start=source.indexOf('/* Job diagnostics:');const end=source.indexOf('/* Accelerator color',start);w.eval(source.slice(start,end));
 const tab=[...w.$('#ecco-activity-tabs').children].find(b=>b.textContent==='Debugging');tab.click();const view=w.$('#ecco-debug-view');assert.match(view.textContent,/YouTube publishing/);assert.match(view.textContent,/UC-owner/);assert.match(view.textContent,/Invalid audience/);assert.match(view.textContent,/private/);assert.doesNotMatch(view.textContent,/Submitted prompt/);observers.forEach(observer=>observer.disconnect());
});
