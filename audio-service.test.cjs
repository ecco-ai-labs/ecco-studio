const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

test('authenticated storage adapter routes generation, status and playback without the GPU API',async()=>{
 let adapter;const requests=[],key='test-only-workspace-access-key-12345';
 const asset={id:'asset1',kind:'asset',media:'audio',story_id:'story1'};
 const jobs=['running','done','error'].map((status,i)=>({id:'audio'+i,kind:'audio_job',title:'Narration',status,error:status==='error'?'Worker failed':'',asset_ids:status==='done'?['asset1']:[]}));
 const context={
  document:{createElement:()=>({}),head:{append(){}},querySelector:()=>null},
  localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>key},MutationObserver:class{observe(){}},setTimeout(){},
  window:{EccoAudioStudio:{connect(value){adapter=value;}}},
  api(){throw Error('GPU API must not handle audio');},gpuConnected:()=>false,
  LEGACY_STORY:'legacy',AbortSignal,URL,Blob,
  fetch:async(url,options)=>{requests.push({url,options});return{ok:true,
   json:async()=>url.endsWith('/state')?{records:[asset,...jobs],config:{}}:{id:'job1',kind:'audio_job',status:'queued'},
   headers:{get:()=> 'audio/wav'},arrayBuffer:async()=>new Uint8Array([82,73,70,70]).buffer};}
 };
 vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/storage-client.js','utf8'),context);
 const view=await context.api('state');
 assert.equal(view.records[1].kind,'job');
 assert.equal(view.records[1].source_kind,'audio_job');
 assert.equal(view.records[1].progress,'Running Generation');
 assert.equal(view.records[1].label,'Audio · Narration');
 assert.equal(view.records[2].progress,'Audio saved.');
 assert.equal(view.records[3].status,'failed');
 assert.equal(jobs[0].kind,'audio_job');
 assert.equal(adapter.storageIndependentOfGPU,true);
 await adapter.status();
 assert.ok(requests.some(r=>r.url.endsWith('/api/audio/status')));
 assert.equal((await adapter.list({story_id:'story1'}))[0].id,'asset1');
 assert.equal((await adapter.generate({lines:[{text:'Hello'}]})).id,'job1');
 await adapter.job('job1');
 const url=await adapter.mediaURL('asset1');assert.ok(url.startsWith('blob:'));
 URL.revokeObjectURL(url);
 assert.ok(requests.some(r=>r.url.endsWith('/api/audio/generate')&&r.options.method==='POST'));
 assert.ok(requests.some(r=>r.url.endsWith('/api/audio/jobs/job1')));
 assert.ok(requests.every(r=>r.options.headers.Authorization==='Bearer '+key));
 assert.ok(requests.every(r=>!r.url.includes(key)));
});


test('audio spinner remains active through queued/running and clears on completion or failure',()=>{
 const source=fs.readFileSync(__dirname+'/audio-studio.js','utf8');
 const update=source.slice(source.indexOf(' function update(){'),source.indexOf(' function render(){'));
 const helper=fs.readFileSync(__dirname+'/studio.js','utf8').split('\n').find(s=>s.startsWith('function setGenerationBusy('));
 const button={setAttribute(k,v){this[k]=v;}},status={};
 const context={page:'audio',story:'story1',activeStory:'story1',signature:'[]',submitting:false,
  q:s=>s==='#generate-audio'?button:s==='#audio-job-status'?status:{},
  window:{EccoGeneration:{jobId:()=> 'job1',results:()=>[]}},state:{records:[]},
  audioAssets:()=>[],showComputeStatus(){},esc:s=>s,render(){throw Error('Unexpected render');}};
 vm.createContext(context);vm.runInContext(helper+'\n'+update+'\nthis.runUpdate=update;',context);
 for(const state of ['queued','running','done','failed']){
  context.lastJob={id:'job1',status:state,error:state==='failed'?'Worker failed':''};context.runUpdate();
  const busy=['queued','running'].includes(state);
  assert.equal(button.disabled,busy);assert.equal(button['aria-busy'],String(busy));
  assert.equal(button.innerHTML.includes('generation-spinner'),busy);
  if(state==='running')assert.equal(status.textContent,'Running Generation');
  if(state==='done')assert.equal(status.textContent,'Audio saved.');
  if(state==='failed')assert.equal(status.textContent,'Generation failed · Worker failed');
 }
});

test('Delete moves generated audio to recoverable Trash and removes its review card',async()=>{
 const source=fs.readFileSync(__dirname+'/audio-studio.js','utf8');
 const hydrate=source.slice(source.indexOf(' async function hydrateAudio(){'),source.indexOf(' async function poll(){'));
 const calls=[],button={dataset:{deleteAudio:'asset1'}};
 const context={service:{},document:{querySelectorAll:selector=>selector==='[data-delete-audio]'?[button]:[]},
  recordings:[{id:'asset1'},{id:'asset2'}],api:async(...args)=>calls.push(args),update(){},refresh:async()=>{},notice(){}};
 vm.createContext(context);vm.runInContext(hydrate+'\nthis.hydrate=hydrateAudio;',context);
 await context.hydrate();await button.onclick();
 assert.equal(calls[0][0],'trash');assert.equal(calls[0][1].asset_id,'asset1');
 assert.equal(context.recordings.length,1);assert.equal(context.recordings[0].id,'asset2');
});

