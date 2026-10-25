const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,input,tick}=require('./audio-ui-test-helpers.cjs');
const status=()=>({routing_version:1,instance_routing_version:1,compute:{cpu:{ready:true,models:['indic-mio']}},instances:[{id:'small',name:'ecco-storage-api',compute:'cpu',ready:true,models:['indic-mio'],cpu_count:2,memory_gb:8},{id:'large',name:'smiling_sapphire_mandrill',compute:'cpu',ready:true,models:['indic-mio'],cpu_count:16,memory_gb:64}]});
test('CPU dropdown sends the selected instance and retains it when unavailable',async t=>{
 const draft={model:'indic-mio',compute:'cpu',title:'CPU routing',genre:'Story Book Reading',presentation:'single',character_count:1,characters_configured:true,speakers:[{id:'n',name:'Narrator',voice:'en_female',language:'Hindi',emotion:'neutral'}],lines:[{speaker_id:'n',text:'एक दिन की बात है।'}],single_text:'एक दिन की बात है।'};
 const x=await setup({'ecco-active-story':'s','ecco-audio-draft:s':JSON.stringify(draft)});t.after(x.close);x.w.EccoStorage={ready:true};await x.go('audio');let state=status();const requests=[];
 x.w.EccoAudioStudio.connect({storageIndependentOfGPU:true,status:async()=>state,list:async()=>[],generate:async body=>{requests.push(body);return{id:'j'};},job:async()=>({id:'j',status:'done'}),mediaURL:async()=>'',download:async()=>{}});await tick();
 const selector='#audio-form [name=compute]';assert.match(x.q(selector).textContent,/smiling_sapphire_mandrill · 16 vCPU \/ 64 GB · Ready/);assert.equal(x.q(selector).value,'cpu:small');
 input(x,selector,'cpu:large','change');x.q('#audio-form').requestSubmit();await tick();await tick();assert.equal(requests.length,1);assert.equal(requests[0].compute,'cpu');assert.equal(requests[0].worker_id,'large');
 state.instances[1]={...state.instances[1],ready:false,reason:'Selected CPU offline'};
 x.q('#audio-form').requestSubmit();await tick();await tick();assert.equal(requests.length,1);assert.equal(x.q(selector).value,'cpu:large');assert.match(x.q(selector).textContent,/64 GB · Unavailable/);assert.match(x.q('#notice').textContent,/Selected CPU offline/);assert.deepEqual(x.errors,[]);
});
test('Voice preview delivery does not inherit chapter reconstruction instructions',async t=>{
 const x=await setup();t.after(x.close);const plan={opening:null,segments:[{character_id:'n',text:'एक जिन्न आया।'}]};let sent;
 const result=await x.w.EccoAudioDirection.refine({plan,cast:[{id:'n',name:'Narrator',voice:'default',language:'Hindi'}],brief:{genre:'Story Book Reading',language:'Hindi',instructions:'ADAPT FULL CHAPTER FROM THE PDF',opening_instructions:'Welcome to a new chapter'},model:{id:'chatterbox'},directionOnly:true,request:async(path,body)=>{sent=body;return{questions:[],revisions:[{id:'audio_directed_script',text:JSON.stringify({...plan,segments:plan.segments.map(p=>({...p,performance:{emotion:'surprise',direction:'Quiet anticipation',pause_before:.4}})),expressiveness:.5})}]};}});
 assert.ok(!JSON.stringify(sent).includes('ADAPT FULL CHAPTER'));assert.ok(!JSON.stringify(sent).includes('Welcome to a new chapter'));assert.match(sent.context.instructions,/delivery-only/);assert.equal(result.segments[0].text,plan.segments[0].text);
});
