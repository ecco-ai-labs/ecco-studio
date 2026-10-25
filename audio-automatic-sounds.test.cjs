const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,input,tick}=require('./audio-ui-test-helpers.cjs');
const lines=[{text:'The door opened. Welcome inside.',speaker_id:'a'},{text:'A quiet room waited.',speaker_id:'b'}];
const sound=(name,start=0,asset_id='')=>({name,kind:'effect',description:'A soft '+name,duration:1,start,end:start,phrase:start?'':'The door opened.',asset_id,compute:'cpu',level_db:-14,fade:.1,duck:true,loop:false});
const asset=id=>({id,kind:'asset',media:'audio',title:id,created:1});
const status={routing_version:1,instances:[{id:'cpu-one',name:'CPU One',compute:'cpu',ready:true,models:['indic-mio'],sound_models:['moss-soundeffect-v2','ace-step-1.5'],sound_design_version:1}],compute:{cpu:{ready:true,models:['indic-mio'],sound_models:['moss-soundeffect-v2'],sound_design_version:1}}};
async function fixture(t,cues=[sound('Door'),sound('Wind',1)]){
 const draft={title:'Sound flow test',model:'indic-mio',compute:'cpu',worker_id:'cpu-one',genre:'Story Book Reading',presentation:'conversation',character_count:2,characters_configured:true,speakers:[{id:'a',name:'Narrator',language:'English',voice:'en_female',emotion:'neutral'},{id:'b',name:'Merchant',language:'English',voice:'en_male',emotion:'neutral'}],lines,single_text:'',sound_design:{enabled:!!cues.length,cues,speech_key:JSON.stringify(lines.map(l=>l.text))}};
 const x=await setup({'ecco-active-story':'audio-story','ecco-audio-draft:audio-story':JSON.stringify(draft)});t.after(x.close);x.w.EccoStorage={ready:true};x.w.testUI.addRecords([asset('existing')]);const calls=[];let job={id:'speech',status:'done'};
 x.w.testUI.setAPI(async(path,body)=>{if(path==='audio/status')return status;calls.push({path,body});if(path==='audio/sounds/generate')return{id:body.title};if(path.startsWith('audio/jobs/'))return{status:'done',asset:asset(path.slice(11)+'-file')};throw Error(path);});
 await x.go('audio');const adapter={storageIndependentOfGPU:true,status:async()=>status,list:async()=>[],generate:async body=>{calls.push({path:'speech',body});return{id:'speech'};},job:async()=>job,mediaURL:async()=> 'https://audio.example/sound.wav',download:async()=>{}};
 x.w.EccoAudioStudio.connect(adapter);await tick();return {...x,calls,adapter,setJob:value=>job=value,draft:()=>JSON.parse(x.w.localStorage.getItem('ecco-audio-draft:audio-story'))};
}
test('Generate audio creates missing sounds in order, keeps existing files, then submits phrase-timed mix on selected CPU',async t=>{
 const x=await fixture(t,[sound('Door'),sound('Wind',1),sound('Keep',1,'existing')]);x.q('#audio-form').requestSubmit();await tick();await tick();
 assert.deepEqual(x.calls.filter(c=>c.path==='audio/sounds/generate').map(c=>[c.body.title,c.body.worker_id,c.body.compute]),[['Door','cpu-one','cpu'],['Wind','cpu-one','cpu']]);
 const mix=x.calls.find(c=>c.path==='speech').body;assert.equal(mix.soundtrack.length,3);assert.equal(mix.soundtrack[0].start_edge,'end');assert.equal(mix.lines[0].text,'The door opened.');assert.deepEqual(Array.from(mix.soundtrack,c=>c.asset_id),['Door-file','Wind-file','existing']);assert.deepEqual(x.draft().sound_design.cues.map(c=>c.asset_id),['Door-file','Wind-file','existing']);assert.deepEqual(x.errors,[]);
});
test('A failed sound retains successful assignments and retry generates only the failed sound',async t=>{
 const x=await fixture(t);let fail=true;const submitted=[];
 x.w.testUI.setAPI(async(path,body)=>{if(path==='audio/status')return status;if(path==='audio/sounds/generate'){submitted.push(body.title);return{id:body.title};}if(path==='audio/jobs/Wind'&&fail)return{status:'error',error:'Temporary model failure'};return{status:'done',asset:asset(path.slice(11)+'-file')};});
 x.q('#audio-form').requestSubmit();await tick();assert.equal(x.calls.filter(c=>c.path==='speech').length,0);assert.equal(x.draft().sound_design.cues[0].asset_id,'Door-file');assert.match(x.q('#audio-job-status').textContent,/Wind.*Temporary model failure/);
 fail=false;x.q('#audio-form').requestSubmit();await tick();assert.deepEqual(submitted,['Door','Wind','Wind']);assert.equal(x.calls.filter(c=>c.path==='speech').length,1);assert.deepEqual(x.errors,[]);
});
test('Confirmed jobs resume after a failed poll without creating another sound job',async t=>{
 const x=await fixture(t,[sound('Door')]);let fail=true,count=0;
 x.w.testUI.setAPI(async(path)=>{if(path==='audio/status')return status;if(path==='audio/sounds/generate'){count++;return{id:'door-job'};}if(fail)throw Error('Connection interrupted');return{status:'done',asset:asset('door-file')};});
 x.q('#audio-form').requestSubmit();await tick();assert.equal(count,1);fail=false;await x.go('images');await x.go('audio');await tick();x.q('#audio-form').requestSubmit();await tick();assert.equal(count,1);assert.equal(x.draft().sound_design.cues[0].asset_id,'door-file');assert.equal(x.calls.filter(c=>c.path==='speech').length,1);
});
test('An uncertain submission is not submitted twice, and stale scripts cannot receive late sounds',async t=>{
 const x=await fixture(t,[sound('Door')]);let count=0;
 x.w.testUI.setAPI(async(path)=>{if(path==='audio/status')return status;if(path==='audio/sounds/generate'){count++;throw Error('Lost response');}});
 x.q('#audio-form').requestSubmit();await tick();x.q('#audio-form').requestSubmit();await tick();assert.equal(count,1);assert.match(x.q('#audio-job-status').textContent,/not confirmed/);
});
test('An edit while generation runs preserves text and places the late result only in Audio Library',async t=>{
 const x=await fixture(t,[sound('Door')]);let finish;
 x.w.testUI.setAPI(async(path)=>path==='audio/status'?status:path==='audio/sounds/generate'?{id:'door-job'}:new Promise(resolve=>finish=resolve));
 x.q('#audio-form').requestSubmit();await tick();input(x,'[data-final-turn="0"]','A different action.');finish({status:'done',asset:asset('late-door')});await tick();
 assert.equal(x.draft().lines[0].text,'A different action.');assert.equal(x.draft().sound_design.cues[0].asset_id,'');assert.ok(x.w.EccoAudioLibrary.items().some(a=>a.id==='late-door'));assert.equal(x.calls.filter(c=>c.path==='speech').length,0);
});
test('Final Script has spoken overview first, numbered turns, inline library assignment and exact selected-phrase sound creation',async t=>{
 const x=await fixture(t,[]);const panel=x.q('#audio-final-script-panel');assert.equal(x.q('#audio-form [data-section=prompt]'),null);assert.ok(panel.querySelector('[data-section=prompt]'));assert.ok(panel.querySelector('[data-section=prompt]').compareDocumentPosition(panel.querySelector('[data-final-turns]'))&4);
 assert.match(x.q('[data-final-turn-row="0"] label').textContent,/Turn 1 · Narrator/);assert.match(x.q('[data-final-turn-row="1"] label').textContent,/Turn 2 · Merchant/);
 const field=x.q('[data-final-turn="0"]');field.focus();field.setSelectionRange(0,16);x.q('[data-final-turn-row="0"] [data-add-turn-sound]').focus();x.q('[data-final-turn-row="0"] [data-add-turn-sound]').click();assert.ok(x.q('[data-inline-cue]').open);assert.equal(x.draft().sound_design.cues[0].phrase,'The door opened.');
 input(x,'[data-inline-asset]','existing','change');assert.equal(x.draft().sound_design.cues[0].asset_id,'existing');assert.equal(field.value,lines[0].text);
 x.q('[data-open-prompt]').click();assert.equal(x.q('#generation-prompt-dialog').open,true);x.q('#generation-prompt-dialog').close();
 field.focus();field.setSelectionRange(0,3);field.dispatchEvent(new x.w.Event('select'));x.q('[data-improve-selection]').click();assert.equal(x.q('#audio-selection-ai [data-selected-text]').value,'The');x.q('#audio-selection-ai').close();assert.deepEqual(x.errors,[]);
});
test('Progress bar reflects only real worker passage counts and uses an indeterminate bar without counts',async t=>{
 const x=await fixture(t,[]);x.setJob({id:'speech',status:'running',progress:'Generating speech · 1 of 14 passages complete'});x.q('#audio-form').requestSubmit();await tick();
 const bar=x.q('[data-speech-progress]');assert.equal(bar.hidden,false);assert.equal(bar.value,1);assert.equal(bar.max,14);assert.equal(x.q('[data-speech-count]').textContent,'Generating Speech: 1 of 14 passages complete');
 x.setJob({id:'speech',status:'running',progress:'Generating speech'});x.w.EccoAudioStudio.connect(x.adapter);await tick();assert.equal(bar.hasAttribute('value'),false);assert.match(x.q('[data-speech-count]').textContent,/waiting for the first passage update/);
 x.setJob({id:'speech',status:'running',progress:'Mixing music and effects'});x.w.EccoAudioStudio.connect(x.adapter);await tick();assert.equal(bar.hidden,true);assert.match(x.q('#audio-job-status').textContent,/Mixing/);assert.deepEqual(x.errors,[]);
});
