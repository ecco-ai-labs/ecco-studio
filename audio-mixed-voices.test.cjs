const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,input,tick}=require('./audio-ui-test-helpers.cjs');
async function fixture(t,brief){
 const draft={model:'chatterbox',title:'Mixed voice acceptance',genre:'Story Book Reading',presentation:'conversation',character_count:2,characters_configured:true,speakers:[{id:'a',name:'Narrator',voice:'default',language:'English',emotion:'neutral'},{id:'b',name:'Merchant',voice:'default',language:'English',emotion:'neutral'}],lines:[{speaker_id:'a',text:'The merchant walked into the quiet room.'},{speaker_id:'b',text:'At last I am home, he said with a smile.'}],single_text:''};
 if(brief)draft.script_brief=brief;
 const x=await setup({'ecco-active-story':'audio-story','ecco-audio-draft:audio-story':JSON.stringify(draft)});t.after(x.close);await x.go('audio');
 const requests=[],status={routing_version:1,compute:{cpu:{ready:true,models:['chatterbox','kokoro','voxcpm2','indic-parler'],mixed_models_version:1,character_controls_version:1,sound_design_version:1}}};
 const adapter={storageIndependentOfGPU:true,status:async()=>status,list:async()=>[],generate:async body=>{requests.push(body);return{id:'job-'+requests.length};},job:async id=>({id,status:'done',asset_id:'asset-'+id}),mediaURL:async id=>'https://media.example.test/'+id+'.wav',download:async()=>{}};
 x.w.EccoAudioStudio.connect(adapter);await tick();x.q('[data-open-controls]').click();
 return Object.assign(x,{requests,adapter,status,read:()=>JSON.parse(x.w.localStorage.getItem('ecco-audio-draft:audio-story'))});
}
test('Per-character models survive default-model changes, tab switches and submit in story order',async t=>{
 const x=await fixture(t);input(x,'[data-character-model]','kokoro','change');input(x,'[data-speaker-field=voice]','af_heart','change');input(x,'[data-speaker-field=pitch]','2','change');
 x.q('[data-speaker-tab=b]').click();assert.equal(x.q('[data-character-model]').value,'');
 input(x,'[data-character-model]','chatterbox','change');input(x,'[data-speaker-field=exaggeration]','0.7','change');
 input(x,'#audio-form [name=model]','indic-mio','change');
 assert.equal(x.read().speakers[0].model,'kokoro');assert.equal(x.read().speakers[0].voice,'af_heart');assert.equal(x.read().speakers[1].model,'chatterbox');
 x.q('#generation-controls-dialog').close();x.q('#audio-form').requestSubmit();await tick();await tick();
 assert.equal(x.requests.length,1);assert.equal(x.requests[0].mixed_models_version,1);assert.deepEqual(Array.from(x.requests[0].lines,l=>l.model),['kokoro','chatterbox']);assert.equal(x.requests[0].lines[0].pitch,2);assert.equal(x.requests[0].lines[1].exaggeration,.7);assert.deepEqual(x.errors,[]);
});
test('Voice choices follow character language and return to the saved model voice',async t=>{
 const x=await fixture(t);input(x,'[data-character-model]','kokoro','change');input(x,'[data-speaker-field=voice]','bf_emma','change');input(x,'[data-character-model]','chatterbox','change');input(x,'[data-character-model]','kokoro','change');assert.equal(x.q('[data-speaker-field=voice]').value,'bf_emma');
 input(x,'[data-speaker-field=language]','Hindi','change');const voices=[...x.q('[data-speaker-field=voice]').options].map(o=>o.value);assert.deepEqual(voices,['hf_alpha','hf_beta','hm_omega','hm_psi']);assert.ok(voices.includes(x.read().speakers[0].voice));
});
test('Listen generates one short selected-model sample and reuses it without changing the script',async t=>{
 const x=await fixture(t);input(x,'[data-character-model]','kokoro','change');input(x,'[data-speaker-field=voice]','af_heart','change');const before=x.read().lines;
 x.q('[data-preview-voice]').click();await tick();await tick();assert.equal(x.requests.length,1);assert.equal(x.requests[0].model,'kokoro');assert.equal(x.requests[0].compute,'cpu');assert.equal(x.requests[0].lines[0].voice,'af_heart');assert.equal(x.requests[0].lines.length,1);assert.equal(x.q('#audio-voice-preview-dialog audio').hidden,false);
 x.q('#audio-voice-preview-dialog [data-close]').click();assert.equal(x.q('#generation-controls-dialog').open,true);x.q('[data-preview-voice]').click();await tick();assert.equal(x.requests.length,1);assert.deepEqual(x.read().lines,before);
 x.q('#audio-voice-preview-dialog [data-close]').click();input(x,'[data-speaker-field=voice]','af_bella','change');x.q('[data-preview-voice]').click();await tick();assert.equal(x.requests.length,2);assert.equal(x.requests[1].lines[0].voice,'af_bella');
});
test('Reopening a pending sample resumes its job; an unavailable model never submits',async t=>{
 const x=await fixture(t);input(x,'[data-character-model]','kokoro','change');x.adapter.job=async id=>({id,status:'running',progress:'Generating speech'});x.q('[data-preview-voice]').click();await tick();assert.equal(x.requests.length,1);x.q('#audio-voice-preview-dialog [data-close]').click();x.adapter.job=async id=>({id,status:'done',asset_id:'completed'});x.q('[data-preview-voice]').click();await tick();assert.equal(x.requests.length,1);assert.equal(x.q('#audio-voice-preview-dialog audio').hidden,false);
 x.q('#audio-voice-preview-dialog [data-close]').click();input(x,'[data-character-model]','voxcpm2','change');x.status.compute.cpu.models=['chatterbox','kokoro'];x.q('[data-preview-voice]').click();await tick();assert.equal(x.requests.length,1);assert.match(x.q('#audio-voice-preview-dialog [role=status]').textContent,/Not installed and verified/);
});
test('Audience, genre and tone are visible, drive delivery review and survive the final request without becoming speech',async t=>{
 const x=await fixture(t,{audience:'Children (6–12)',tone:'Playful',language_style:'Everyday / Conversational',narration_style:'Engaging storyteller',language:'English'}),ai=[];
 x.w.EccoAI={...x.w.EccoAI,enabled:true};x.w.testUI.setAPI(async(path,body)=>{ai.push(body);const p=JSON.parse(body.context.summary).draft;return {questions:[],revisions:[{id:'audio_directed_script',text:JSON.stringify({...p,segments:p.segments.map(s=>({...s,performance:{emotion:'happy',direction:'Curious and playful, with a pause before the surprise.',pause_before:.5}})),expressiveness:.65})}]};});
 assert.match(x.q('[data-generation-directions]').textContent,/Children \(6–12\)/);assert.match(x.q('[data-generation-directions]').textContent,/Story Book Reading/);assert.match(x.q('[data-generation-directions]').textContent,/Engaging storyteller/);
 const before=x.read().lines.map(l=>l.text);x.q('#generation-controls-dialog').close();x.q('#audio-form').requestSubmit();await tick();await tick();
 assert.equal(ai.length,1);assert.match(ai[0].context.instructions,/Children \(6–12\)/);assert.match(ai[0].context.instructions,/Playful/);
 assert.equal(x.requests.length,1);assert.equal(x.requests[0].performance_brief.audience,'Children (6–12)');assert.equal(x.requests[0].performance_brief.narration_style,'Engaging storyteller');assert.equal(x.requests[0].exaggeration,.65);assert.deepEqual(Array.from(x.requests[0].lines,l=>l.text),before);assert.deepEqual(x.errors,[]);
});
