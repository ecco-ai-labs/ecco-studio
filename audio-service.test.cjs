const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

test('authenticated storage adapter routes generation, status and playback without the GPU API',async()=>{
 let adapter;const requests=[],key='test-only-workspace-access-key-12345';
 const asset={id:'asset1',kind:'asset',media:'audio',story_id:'story1'};
 const context={
  document:{createElement:()=>({}),head:{append(){}},querySelector:()=>null},
  sessionStorage:{getItem:()=>key},MutationObserver:class{observe(){}},setTimeout(){},
  window:{EccoAudioStudio:{connect(value){adapter=value;}}},
  api(){throw Error('GPU API must not handle audio');},gpuConnected:()=>false,
  LEGACY_STORY:'legacy',AbortSignal,URL,Blob,
  fetch:async(url,options)=>{requests.push({url,options});return{ok:true,
   json:async()=>url.endsWith('/state')?{records:[asset],config:{}}:{id:'job1',status:'queued'},
   headers:{get:()=> 'audio/wav'},arrayBuffer:async()=>new Uint8Array([82,73,70,70]).buffer};}
 };
 vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/storage-client.js','utf8'),context);
 await context.api('state');
 assert.equal(adapter.storageIndependentOfGPU,true);
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
