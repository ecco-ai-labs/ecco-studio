const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,input,tick}=require('./audio-ui-test-helpers.cjs');
const ids=['compute','models','memory','worker_storage','tools','voices','assets','storage','queue'];
const report=()=>({version:1,ready:true,checks:ids.map(id=>({id,label:id,status:'passed',detail:'Verified by test service'}))});
async function fixture(t){
 const text='The door opened.',draft={model:'chatterbox',compute:'cpu',worker_id:'large',genre:'Story Book Reading',title:'Verification test',presentation:'single',character_count:1,characters_configured:true,speakers:[{id:'n',name:'Narrator',voice:'default',language:'English',emotion:'neutral'}],lines:[{speaker_id:'n',text}],single_text:text};
 const x=await setup({'ecco-active-story':'audio-story','ecco-audio-draft:audio-story':JSON.stringify(draft)});t.after(x.close);x.w.EccoStorage={ready:true};await x.go('audio');const calls=[];
 const adapter={storageIndependentOfGPU:true,status:async()=>({routing_version:1,compute:{cpu:{ready:true,models:['chatterbox']}},instances:[{id:'large',name:'Large CPU',compute:'cpu',ready:true,models:['chatterbox'],sound_models:['moss-soundeffect-v2'],sound_design_version:1,character_controls_version:1}]}),list:async()=>[],generate:async()=>{calls.push('GENERATE');throw Error('Must not generate');},job:async()=>null,mediaURL:async()=>'',download:async()=>{},verify:async body=>{calls.push(body);return report();}};
 x.w.EccoAudioStudio.connect(adapter);await tick();return {...x,adapter,calls};
}
test('Verify Flow exposes progress/check results and sends the exact plan without generating',async t=>{
 const x=await fixture(t);let finish;x.adapter.verify=body=>{x.calls.push(body);return new Promise(r=>finish=r)};
 x.q('[data-verify-audio]').click();assert.equal(x.q('[data-verify-audio]').getAttribute('aria-busy'),'true');assert.equal(x.q('#audio-progress-panel').hidden,false);assert.equal(x.q('[data-check=models]').dataset.status,'checking');assert.equal(x.q('[data-verify-audio]').type,'button');
 x.q('#audio-form').requestSubmit();assert.equal(x.calls.length,1);finish(report());await tick();assert.match(x.q('[data-verification-summary]').textContent,/Verification passed/);assert.equal(x.calls.length,1);assert.equal(x.calls[0].speech.worker_id,'large');assert.equal(x.calls[0].speech.lines[0].text,'The door opened.');assert.equal(x.q('[data-check=memory]').dataset.status,'passed');assert.deepEqual(x.errors,[]);
});
test('failures are named; script edits invalidate previous passes and keep the typed text',async t=>{
 const x=await fixture(t);x.adapter.verify=async()=>{const r=report();r.checks.find(c=>c.id==='models').status='failed';r.checks.find(c=>c.id==='models').detail='Kokoro unavailable';return r;};
 x.q('[data-verify-audio]').click();await tick();assert.match(x.q('[data-verification-summary]').textContent,/1 failed/);assert.match(x.q('[data-check=models]').textContent,/Kokoro unavailable/);
 x.q('[data-audio-tab=script]').click();x.q('[data-final-turn="0"]').focus();const field=input(x,'[data-final-turn="0"]','A new door opened.');assert.equal(x.q('[data-check=models]').dataset.status,'stale');assert.equal(field.value,'A new door opened.');assert.equal(x.w.document.activeElement,field);
});
test('late reports cannot certify changed choices; retry verifies the current script',async t=>{
 const x=await fixture(t);let finish;x.adapter.verify=()=>new Promise(r=>finish=r);x.q('[data-verify-audio]').click();x.q('[data-audio-tab=script]').click();input(x,'[data-final-turn="0"]','Changed while verifying.');finish(report());await tick();assert.doesNotMatch(x.q('[data-verification-summary]').textContent,/Verification passed/);assert.equal(x.q('[data-check=models]').dataset.status,'stale');
 x.adapter.verify=async()=>report();x.q('[data-verify-audio]').click();await tick();assert.match(x.q('[data-verification-summary]').textContent,/Verification passed/);
});
test('disconnected/old/failed services cannot produce a green verification',async t=>{
 const x=await fixture(t);delete x.adapter.verify;x.q('[data-verify-audio]').click();await tick();assert.equal(x.q('[data-check=storage]').dataset.status,'unverified');assert.match(x.q('[data-check=storage]').textContent,/update/);
 x.adapter.verify=async()=>{throw Error('Storage unavailable');};x.q('[data-verify-audio]').click();await tick();assert.equal(x.q('[data-check=connection]').dataset.status,'unverified');
 x.w.EccoAudioStudio.disconnect();x.q('[data-verify-audio]').click();await tick();assert.equal(x.q('[data-check=connection]').dataset.status,'failed');assert.equal(x.q('[data-check=models]').dataset.status,'blocked');assert.deepEqual(x.errors,[]);
});
test('a missing new sound is verified as a description, never treated as an existing file',async t=>{
 const x=await fixture(t);x.q('[data-add-turn-sound]').click();await tick();x.q('[data-verify-audio]').click();await tick();const body=x.calls[0];assert.equal(body.sounds.length,1);assert.equal(body.sounds[0].worker_id,'large');assert.equal(body.sounds[0].model,'moss-soundeffect-v2');assert.equal(body.existing_soundtrack.length,0);assert.equal(body.speech.sound_design_version,1);assert.equal(x.calls.length,1);assert.deepEqual(x.errors,[]);
});
