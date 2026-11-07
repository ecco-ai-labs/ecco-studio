const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(t){
 const dom=new JSDOM('<dialog id="source" open><button id="apply">Apply Selected Text</button></dialog>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window;t.after(()=>w.close());
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.EccoStorage={ready:true};w.EccoAI={enabled:true};w.eval(fs.readFileSync(__dirname+'/source-compatibility.js','utf8'));
 const calls=[],q=s=>w.document.querySelector(s);let current=true;
 w.api=async(path,body)=>{calls.push({path,body});return {revisions:[{id:'source_compatibility',text:JSON.stringify({verdict:'mismatch',source_kind:'Fictional storybook',reason:'Alibaba and the forty thieves is fiction, not a sports news report.'})}]};};
 return {w,q,calls,invalidate:()=>current=false,review:(text='Alibaba found a hidden cave.')=>w.EccoSourceCompatibility.review({selection:{text,name:'Alibaba.pdf'},story:{title:'Sports News',type:'news',typeLabel:'News',genre:'Sports',brief:'Report the latest match results.'},valid(){if(!current)throw Error('Story Details changed.');},opener:q('#apply')})};
}
test('AI suitability check sends only the selected source and current story intent',async t=>{
 const x=fixture(t);const pending=x.review();await tick();assert.equal(JSON.parse(x.calls[0].body.context.summary).selected_text,'Alibaba found a hidden cave.');assert.equal(x.calls[0].body.mode,'generate');assert.match(x.calls[0].body.fields[0].text,/Return only JSON/);assert.equal(x.calls[0].body.story_id,null);assert.equal(x.calls[0].body.context.title,'Sports News');assert.equal(x.calls[0].body.context.genre,'Sports');assert.match(x.calls[0].body.context.instructions,/fiction.*Sports News/);assert.match(x.q('[data-story]').textContent,/Sports News/);assert.match(x.q('[data-source]').textContent,/Fictional storybook/);assert.equal(x.w.document.activeElement,x.q('[data-choose]'));x.q('[data-choose]').click();assert.equal(await pending,false);assert.equal(x.q('#source').open,true);assert.equal(x.w.document.activeElement,x.q('#apply'));
});
test('a clear mismatch requires explicit Use Anyway',async t=>{
 const x=fixture(t);const pending=x.review();await tick();assert.equal(x.q('[data-use]').textContent,'Use Anyway');x.q('[data-use]').click();assert.equal(await pending,true);assert.equal(x.q('.source-compatibility-dialog'),null);
});
test('matching sources proceed without an unnecessary warning',async t=>{
 const x=fixture(t);x.w.api=async()=>({revisions:[{id:'source_compatibility',text:JSON.stringify({verdict:'match',source_kind:'Sports report',reason:'Reports a match result.'})}]});assert.equal(await x.review(),true);assert.equal(x.q('.source-compatibility-dialog'),null);
});
test('unavailable or malformed AI assessments never imply a verified match',async t=>{
 for(const mode of ['offline','malformed']){const x=fixture(t);if(mode==='offline')x.w.EccoAI.enabled=false;else x.w.api=async()=>({revisions:[{id:'source_compatibility',text:'not json'}]});const pending=x.review();await tick();assert.equal(x.q('[data-title]').textContent,'Source check unavailable');assert.equal(x.q('[data-use]').textContent,'Use Without Checking');x.q('[data-use]').click();assert.equal(await pending,true);}
});
test('stale assessment replies cannot open a warning for another story',async t=>{
 const x=fixture(t);let finish;x.w.api=()=>new Promise(resolve=>finish=resolve);const pending=x.review();x.invalidate();finish({revisions:[]});await assert.rejects(pending,/Story Details changed/);assert.equal(x.q('.source-compatibility-dialog'),null);
});
test('changed Story Details block an old confirmation and parent close cancels it',async t=>{
 const x=fixture(t);const pending=x.review();await tick();x.invalidate();x.q('[data-use]').click();assert.equal(x.q('[data-use]').disabled,true);assert.match(x.q('[role=status]').textContent,/Story Details changed/);x.q('#source').close();assert.equal(await pending,false);assert.equal(x.q('.source-compatibility-dialog'),null);
});

test('full-length story selections fit the enhance request contract without truncation',async t=>{
 const x=fixture(t),selected='A'.repeat(20000);const pending=x.review(selected);await tick();const body=x.calls[0].body;assert.equal(JSON.parse(body.context.summary).selected_text,selected);assert.ok(body.fields[0].text.length<=body.fields[0].max_length);assert.ok(JSON.stringify(body).length<180000);x.q('[data-choose]').click();assert.equal(await pending,false);
});
