const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,input,tick}=require('./audio-ui-test-helpers.cjs');
const line={text:'The merchant rested. A Jinn appeared. He stepped back.',voice:'en_female',language:'Hindi',emotion:'neutral'};
const cue={kind:'effect',description:'A gentle magical arrival',asset_id:'sound-asset',start:0,end:0,phrase:'A Jinn appeared.',level_db:-14,duck:false,loop:false,fade:.1};
const assets=[{id:'sound-asset',kind:'asset',media:'audio',title:'Magic arrival',created:1}];
async function fixture(t){const x=await setup({'ecco-active-story':'audio-story'});t.after(x.close);x.w.testUI.addRecords(assets);await x.go('audio');input(x,'[data-final-turn="0"]',line.text);return x;}
test('A phrase trigger splits speech at the exact words and preserves voice settings and pauses',async t=>{
 const x=await fixture(t),design=x.w.EccoSoundDesign,lines=[{...line,speed:.9,pitch:2,pause_before:.7},{...line,text:'Next passage.'}];
 const prepared=design.prepare({enabled:true,cues:[cue],speech_key:design.key(lines)},lines,assets);
 assert.deepEqual(Array.from(prepared.lines,l=>l.text),['The merchant rested. A Jinn appeared.','He stepped back.','Next passage.']);assert.equal(prepared.lines[1].pause_before,0);assert.equal(prepared.lines[0].pause_before,.7);assert.equal(prepared.lines[1].pitch,2);assert.equal(prepared.soundtrack[0].start_line,0);assert.equal(prepared.soundtrack[0].start_edge,'end');assert.equal(prepared.soundtrack[0].end_line,1);
 assert.throws(()=>design.prepare({enabled:true,cues:[cue],speech_key:'old'},lines,assets),/script changed/);
 assert.throws(()=>design.prepare({enabled:true,cues:[{...cue,asset_id:''}],speech_key:design.key(lines)},lines,assets),/Choose or upload/);
 assert.throws(()=>design.validate([{...cue,phrase:'not present'}],lines,{assets}),/exactly once/);
});
test('Sound-design AI sees only the final spoken script and current library labels, then user applies',async t=>{
 const x=await fixture(t),calls=[];x.w.EccoAI={enabled:true};x.w.EccoStorage={ready:true};x.w.testUI.setAPI(async(path,body)=>{calls.push(body);return{questions:[],revisions:[{id:'sound_cues',text:JSON.stringify({cues:[cue]})}]};});
 x.q('[data-open-sounds]').click();input(x,'[data-direction]','A magical arrival, gentle for children.');x.q('[data-suggest]').click();await tick();assert.equal(calls.length,1);assert.equal(calls[0].story_id,null);const context=JSON.parse(calls[0].context.summary);assert.equal(context.passages[0].text,line.text);assert.equal(context.audio_library[0].title,'Magic arrival');assert.equal(x.q('[data-field=phrase]').value,cue.phrase);assert.equal(x.q('[data-field=asset_id]').value,'sound-asset');x.q('#audio-sound-design form').requestSubmit();assert.equal(x.q('#audio-sound-design'),null);assert.match(x.q('[data-sound-summary]').textContent,/1 sound cues · 1 audio files/);
 assert.equal(JSON.parse(x.w.localStorage.getItem('ecco-audio-draft:audio-story')).sound_design.cues[0].phrase,cue.phrase);assert.deepEqual(x.errors,[]);
});
test('A late sound suggestion cannot replace manually edited cues',async t=>{
 const x=await fixture(t);let finish;x.w.EccoAI={enabled:true};x.w.EccoStorage={ready:true};x.w.testUI.setAPI(()=>new Promise(resolve=>finish=resolve));x.q('[data-open-sounds]').click();x.q('[data-suggest]').click();x.q('[data-add]').click();input(x,'[data-field=description]','Keep my custom sound');finish({revisions:[{id:'sound_cues',text:JSON.stringify({cues:[cue]})}]});await tick();assert.equal(x.q('[data-field=description]').value,'Keep my custom sound');assert.match(x.q('#audio-sound-design [role=status]').textContent,/edits are preserved/);
});
test('Older audio service cannot silently discard a soundtrack',async t=>{
 const x=await fixture(t),requests=[];x.w.EccoAudioStudio.connect({storageIndependentOfGPU:true,status:async()=>({routing_version:1,compute:{cpu:{ready:true,models:['indic-mio']}}}),list:async()=>[],generate:async r=>{requests.push(r);return{id:'j'};},job:async()=>({status:'done'}),mediaURL:async()=>'',download:async()=>{}});await tick();
 x.q('[data-open-sounds]').click();x.q('[data-add]').click();input(x,'[data-field=asset_id]','sound-asset','change');x.q('[data-enabled]').checked=true;x.q('#audio-sound-design form').requestSubmit();x.q('#audio-form').requestSubmit();await tick();assert.equal(requests.length,0);assert.match(x.q('#notice').textContent,/Update the audio service/);
});
