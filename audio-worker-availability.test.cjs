const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,input,tick}=require('./audio-ui-test-helpers.cjs');
async function fixture(t){
 const draft={model:'chatterbox',compute:'cpu',worker_id:'large',genre:'Story Book Reading',title:'Availability',presentation:'single',character_count:1,characters_configured:true,speakers:[{id:'n',name:'Narrator',model:'kokoro',voice:'af_heart',language:'English',emotion:'neutral'}],lines:[{speaker_id:'n',text:'The door opened.'}],single_text:'The door opened.',sound_design:{enabled:true,speech_key:JSON.stringify(['The door opened.']),cues:[{name:'Door',kind:'effect',description:'A wooden door opens.',duration:1,start:0,end:0,asset_id:'',compute:'cpu',level_db:-14,fade:.1,duck:true,loop:false}]}};
 const x=await setup({'ecco-active-story':'audio-story','ecco-audio-draft:audio-story':JSON.stringify(draft)});t.after(x.close);x.w.EccoStorage={ready:true};
 const status={routing_version:1,compute:{cpu:{ready:true,models:['chatterbox','kokoro'],sound_models:['moss-soundeffect-v2']}},instances:[{id:'small',name:'Small',compute:'cpu',ready:true,models:['chatterbox'],sound_models:[]},{id:'large',name:'smiling_sapphire_mandrill',compute:'cpu',ready:true,models:['chatterbox','kokoro'],sound_models:['moss-soundeffect-v2'],mixed_models_version:1}]};
 x.w.testUI.setAPI(async path=>{if(path==='audio/status')return status;throw Error('Unexpected '+path);});await x.go('audio');
 const adapter={storageIndependentOfGPU:true,status:async()=>status,list:async()=>[],generate:async()=>{throw Error('Must not generate');},job:async()=>null,mediaURL:async()=>'',download:async()=>{}};
 x.w.EccoAudioStudio.connect(adapter);await tick();await tick();return {...x,status,adapter,read:()=>JSON.parse(x.w.localStorage.getItem('ecco-audio-draft:audio-story'))};
}
test('exact selected CPU gates models and voices without changing saved choices or focus',async t=>{
 const x=await fixture(t);x.q('[data-open-controls]').click();const model=x.q('[data-character-model]'),voice=x.q('[data-speaker-field=voice]');
 assert.equal(model.querySelector('[value=kokoro]').disabled,false);assert.equal(model.querySelector('[value=indic-parler]').disabled,true);
 voice.focus();const before=JSON.stringify(x.read().speakers);input(x,'#audio-form [name=compute]','cpu:small','change');
 assert.equal(x.w.document.activeElement,voice);assert.equal(model.value,'kokoro');assert.equal(model.querySelector('[value=kokoro]').disabled,true);assert.equal(voice.disabled,true);assert.equal(x.q('[data-preview-voice]').disabled,true);assert.match(x.q('[data-character-model-status]').textContent,/Not installed/);assert.equal(JSON.stringify(x.read().speakers),before);
 input(x,'#audio-form [name=compute]','cpu:large','change');assert.equal(model.querySelector('[value=kokoro]').disabled,false);assert.equal(voice.disabled,false);assert.equal(voice.value,'af_heart');assert.equal(JSON.stringify(x.read().speakers),before);assert.deepEqual(x.errors,[]);
});
test('sound creation follows selected CPU while library/upload and typed cue text remain available',async t=>{
 const x=await fixture(t),button=x.q('[data-generate-sound]'),description=x.q('[data-inline-cue] [data-field=description]');
 assert.equal(button.disabled,false);input(x,'[data-inline-cue] [data-field=description]','A softly creaking door.');description.focus();
 input(x,'#audio-form [name=compute]','cpu:small','change');assert.equal(button.disabled,true);assert.equal(x.q('[data-sound-model] option').disabled,true);assert.equal(x.q('[data-sound-compute]').value,'cpu:small');assert.equal(x.q('[data-inline-asset]').disabled,false);assert.equal(x.q('[data-inline-upload]').disabled,false);assert.equal(description.value,'A softly creaking door.');assert.equal(x.w.document.activeElement,description);
 input(x,'#audio-form [name=compute]','cpu:large','change');assert.equal(button.disabled,false);assert.equal(x.q('[data-sound-compute]').value,'cpu:large');assert.deepEqual(x.errors,[]);
});
test('disconnect and failed health checks remove stale availability, then reconnect restores it',async t=>{
 const x=await fixture(t);x.q('[data-open-controls]').click();x.w.EccoAudioStudio.disconnect();assert.equal(x.q('[data-character-model] [value=kokoro]').disabled,true);assert.equal(x.q('[data-generate-sound]').disabled,true);assert.equal(x.read().worker_id,'large');
 x.w.EccoAudioStudio.connect({...x.adapter,status:async()=>{throw Error('Health check failed');}});await tick();assert.equal(x.q('[data-preview-voice]').disabled,true);
 x.w.EccoAudioStudio.connect(x.adapter);await tick();assert.equal(x.q('[data-character-model] [value=kokoro]').disabled,false);assert.equal(x.q('[data-generate-sound]').disabled,false);assert.deepEqual(x.errors,[]);
});
