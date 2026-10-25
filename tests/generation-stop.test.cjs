const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
function setup(t,handler){
 const dom=new JSDOM(['image','audio','video'].map(k=>`<form id="${k}-form"><button id="generate-${k}">Generate ${k}</button></form>`).join(''),{runScripts:'outside-only',url:'https://studio.example'}),w=dom.window;
 const observers=[],Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(cb){super(cb);observers.push(this)}};t.after(async()=>{await new Promise(r=>setImmediate(r));observers.forEach(o=>o.disconnect());w.close()});w.handler=handler;w.eval("var activeStory='s',state={records:[]};var api=(...args)=>window.handler(...args);var refresh=async()=>{const result=await api('state');state.records=result.records};var notice=()=>{};");
 w.EccoGeneration={jobId:()=>null};w.eval(fs.readFileSync('generation-stop.js','utf8'));
 w.eval('window.call=(...args)=>api(...args);window.rows=rows=>state.records=rows');return w;
}
test('each studio has an accessible idle Stop button that never submits the form',t=>{
 const w=setup(t,async()=>({records:[]}));for(const kind of ['image','audio','video']){const b=w.document.getElementById('stop-'+kind);assert.equal(b.type,'button');assert.equal(b.getAttribute('aria-label'),`Stop ${kind} generation`);assert.equal(b.disabled,true);}
});
test('Stop during preparation prevents a new generation request',async t=>{
 const calls=[],w=setup(t,async p=>{calls.push(p);return{records:[]}}),token=w.EccoGenerationStop.begin('audio','s');
 await w.EccoGenerationStop.stop('audio','s');assert.throws(()=>w.EccoGenerationStop.assert(token),/Stopped/);
 await assert.rejects(w.call('audio/generate',{story_id:'s'}),/Stopped/);assert.deepEqual(calls,['state']);
});
test('a late accepted submission is stopped by exact job ID',async t=>{
 let accept;const calls=[],w=setup(t,async(p,b)=>{calls.push([p,b]);if(p==='images')return new Promise(r=>accept=r);if(p==='generation/stop')return{id:b.job_id,status:'cancelled'};return{records:[]}});
 w.EccoGenerationStop.begin('image','s');const request=w.call('images',{story_id:'s'});await w.EccoGenerationStop.stop('image','s');accept({id:'late',status:'queued'});
 await assert.rejects(request,/Stopped/);assert.deepEqual(calls.filter(c=>c[0]==='generation/stop').map(c=>JSON.parse(JSON.stringify(c[1]))),[{job_id:'late'}]);
});
test('reload recovery cancels only active jobs for this story and media',async t=>{
 const rows=[{id:'target',kind:'job',media:'audio',story_id:'s',status:'running'},{id:'old',kind:'job',media:'audio',story_id:'s',status:'done'},{id:'other',kind:'job',media:'audio',story_id:'elsewhere',status:'running'},{id:'video',kind:'job',media:'video',story_id:'s',status:'running'}],calls=[];
 const w=setup(t,async(p,b)=>{if(p==='generation/stop'){calls.push(b.job_id);return{id:b.job_id,status:'cancelling'}}return{records:rows}});w.rows(rows);
 await w.EccoGenerationStop.stop('audio','s');assert.deepEqual(calls,['target']);assert.equal(w.document.getElementById('stop-audio').textContent,'Stopping…');
});
test('a failed cancellation remains retryable',async t=>{
 let attempts=0;const row={id:'a',kind:'job',media:'audio',story_id:'s',status:'running'};
 const w=setup(t,async(p,b)=>{if(p==='generation/stop'){if(++attempts===1)throw Error('Offline');return{id:b.job_id,status:'cancelled'}}return{records:[{...row,status:'cancelled'}]}});w.rows([row]);
 await w.EccoGenerationStop.stop('audio','s');assert.equal(w.document.getElementById('stop-audio').disabled,false);await w.EccoGenerationStop.stop('audio','s');assert.equal(attempts,2);
});
