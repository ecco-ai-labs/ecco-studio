const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
function setup(t,handler){
 const dom=new JSDOM(['image','audio','video'].map(k=>`<form id="${k}-form"><button id="generate-${k}">Generate ${k}</button></form>`).join(''),{runScripts:'outside-only',url:'https://studio.example'}),w=dom.window;
 const observers=[],Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(cb){super(cb);observers.push(this)}};t.after(async()=>{await new Promise(r=>setImmediate(r));observers.forEach(o=>o.disconnect());w.close()});w.handler=handler;w.eval("var activeStory='s',state={records:[]};var api=(...args)=>window.handler(...args);var refresh=async()=>{const result=await api('state');state.records=result.records};var notice=()=>{};");
 w.EccoGeneration={jobId:()=>null};w.eval(fs.readFileSync('generation-stop.js','utf8'));
 w.eval('window.call=(...args)=>api(...args);window.rows=rows=>state.records=rows');return w;
}
test('each studio has an accessible idle Stop button that never submits the form',t=>{
 const w=setup(t,async()=>({records:[]}));for(const kind of ['image','audio','video']){const b=w.document.getElementById('stop-'+kind);assert.equal(b.type,'button');assert.equal(b.getAttribute('aria-label'),`${kind==='audio'?'Cancel':'Stop'} ${kind} generation`);assert.equal(b.disabled,true);}
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
 await w.EccoGenerationStop.stop('audio','s');assert.deepEqual(calls,['target']);assert.equal(w.document.getElementById('stop-audio').textContent,'Cancelling…');
});
test('a failed cancellation remains retryable',async t=>{
 let attempts=0;const row={id:'a',kind:'job',media:'audio',story_id:'s',status:'running'};
 const w=setup(t,async(p,b)=>{if(p==='generation/stop'){if(++attempts===1)throw Error('Offline');return{id:b.job_id,status:'cancelled'}}return{records:[{...row,status:'cancelled'}]}});w.rows([row]);
 await w.EccoGenerationStop.stop('audio','s');assert.equal(w.document.getElementById('stop-audio').disabled,false);await w.EccoGenerationStop.stop('audio','s');assert.equal(attempts,2);
});

test('Cancel is available in Progress and sound popups, including a recovered sound job',async t=>{
 const calls=[],w=setup(t,async(p,b)=>{if(p==='generation/stop'){calls.push(b.job_id);return{id:b.job_id,status:'cancelled'}}return{records:[]}});
 w.document.body.insertAdjacentHTML('beforeend','<section id="audio-progress-panel"><button data-cancel-generation="audio"></button></section><dialog open><button data-cancel-generation="audio"></button></dialog>');
 const token=w.EccoGenerationStop.begin('audio','s');await w.EccoGenerationStop.track('audio','s',{id:'resumed-sound',status:'running',task:'sound'});
 for(const b of w.document.querySelectorAll('[data-cancel-generation]')){assert.equal(b.textContent,'Cancel');assert.equal(b.disabled,false);assert.equal(b.type,'button');}
 w.document.querySelector('dialog button').click();await new Promise(r=>setImmediate(r));
 assert.deepEqual(calls,['resumed-sound']);assert.throws(()=>w.EccoGenerationStop.assert(token),/Stopped/);
 w.EccoGenerationStop.finish(token);for(const b of w.document.querySelectorAll('[data-cancel-generation]'))assert.equal(b.disabled,true);
});
test('Completed sound status from polling is not cancelled and a sound can resume after polling fails',async t=>{
 const calls=[],w=setup(t,async(p,b)=>{if(p==='generation/stop'){calls.push(b.job_id);return{id:b.job_id,status:'cancelled'}}if(p.startsWith('audio/jobs/'))return{status:'done'};return{records:[]}});
 const token=w.EccoGenerationStop.begin('audio','s');await w.EccoGenerationStop.track('audio','s',{id:'saved-sound',status:'queued',task:'sound'});
 await w.call('audio/jobs/saved-sound');await w.EccoGenerationStop.track('audio','s',{id:'still-running',status:'running',task:'sound'});
 w.EccoGenerationStop.finish(token);const generate=w.document.getElementById('generate-audio');generate.disabled=false;w.EccoGenerationStop.update();assert.equal(generate.disabled,false);
 await w.EccoGenerationStop.stop('audio','s');assert.deepEqual(calls,['still-running']);
});
for(const resumed of [false,true])test(`Cancel stops ${resumed?'resumed':'new'} automatic sound job and preserves completed cues`,async t=>{
 let finishPoll,startPoll;const polling=new Promise(r=>startPoll=r),cancelled=[],submissions=[];
 const w=setup(t,async(p,b)=>{
  if(p==='audio/status')return{compute:{cpu:{ready:true,sound_models:['moss-soundeffect-v2']}}};
  if(p==='audio/sounds/generate'){submissions.push(b);return{id:'lunch-bell',status:'queued'};}
  if(p==='audio/jobs/lunch-bell'){startPoll();return new Promise(r=>finishPoll=r);}
  if(p==='generation/stop'){cancelled.push(b.job_id);return{id:b.job_id,status:'cancelled'};}
  return{records:[]};
 });
 w.EccoStorage={ready:true};w.EccoAudioLibrary={remember:()=>{}};w.EccoSoundDesign={key:()=> 'script',validate:()=>{},prepare:()=>{}};
 w.eval(fs.readFileSync('audio-sound-generation.js','utf8'));w.document.body.insertAdjacentHTML('beforeend','<section><button data-cancel-generation="audio"></button></section>');
 const cue={name:'Lunch Bell',kind:'effect',description:'A lunch bell',duration:1,asset_id:''},plan={enabled:true,speech_key:'script',cues:[{...cue,name:'Saved cue',asset_id:'saved-file'},cue,{...cue,name:'Next cue'}]};
 if(resumed){const request=w.EccoSoundGeneration.soundRequest(cue,{compute:'cpu',worker_id:'',story_id:'s'});w.localStorage.setItem('ecco-sound-jobs-v1',JSON.stringify({[JSON.stringify(request)]:{id:'lunch-bell',status:'queued'}}));}
 const token=w.EccoGenerationStop.begin('audio','s'),result=w.EccoSoundGeneration.ensure({plan,lines:[],assets:[{id:'saved-file'}],compute:'cpu',worker_id:'',story_id:'s',valid:()=>w.EccoGenerationStop.assert(token),changed:()=>{},progress:()=>{}});
 await polling;const button=w.document.querySelector('[data-cancel-generation]');assert.equal(button.disabled,false);button.click();await new Promise(r=>setImmediate(r));finishPoll({id:'lunch-bell',status:'cancelled'});
 await assert.rejects(result,e=>e.name==='GenerationStopped'&&!/Generate audio again/.test(e.message));w.EccoGenerationStop.finish(token);
 assert.deepEqual(cancelled,['lunch-bell']);assert.equal(submissions.length,resumed?0:1);assert.equal(plan.cues[0].asset_id,'saved-file');assert.equal(plan.cues[1].asset_id,'');assert.equal(button.disabled,true);
});
