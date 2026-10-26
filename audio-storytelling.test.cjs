const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,input,tick}=require('./audio-ui-test-helpers.cjs');
const reply=(id,value)=>({questions:[],revisions:[{id,text:JSON.stringify(value)}]});
const directed=body=>{const draft=JSON.parse(body.context.summary).draft;const cue=p=>({...p,performance:{emotion:'happy',direction:'Warm and curious; pause before the surprise.',pause_before:.6}});return reply('audio_directed_script',{opening:draft.opening?cue(draft.opening):null,segments:draft.segments.map(cue),expressiveness:body.context.lines[0].voice==='default'?.7:null});};
async function fixture(t,model='chatterbox'){
 const initial={model,title:'Test story',genre:'Story Book Reading',presentation:'conversation',character_count:2,characters_configured:true,speakers:[{id:'a',name:'Mira',voice:model==='chatterbox'?'default':'en_female',language:'Hindi',emotion:'neutral'},{id:'b',name:'Grandmother',voice:model==='chatterbox'?'default':'en_male',language:'Hindi',emotion:'neutral'}],lines:[{speaker_id:'a',text:'पहले यह था। यहाँ मज़ेदार बात होगी। आखिर में यह है।'},{speaker_id:'b',text:'दूसरे किरदार की बात वही रहे।'}],single_text:''};
 const x=await setup({'ecco-active-story':'audio-story','ecco-audio-draft:audio-story':JSON.stringify(initial)});t.after(x.close);x.w.EccoAI={...x.w.EccoAI,enabled:true};x.w.EccoStorage={ready:true};await x.go('audio');return x;
}
test('Each character has one accessible settings tab; values survive switches and reach generation independently',async t=>{
 const x=await fixture(t),requests=[];x.w.testUI.setAPI(async(path,body)=>directed(body));
 x.w.EccoAudioStudio.connect({storageIndependentOfGPU:true,status:async()=>({routing_version:1,compute:{cpu:{ready:true,models:['chatterbox'],character_controls_version:1}}}),list:async()=>[],generate:async body=>{requests.push(body);return{id:'j'};},job:async()=>({id:'j',status:'done'}),mediaURL:async()=>'',download:async()=>{}});await tick();
 x.q('[data-open-controls]').click();assert.equal(x.q('#generation-controls-dialog h2').textContent,'Additional Controls');assert.equal(x.q('[role=tablist][aria-label=Characters]').children.length,2);
 input(x,'[data-speaker-field=pitch]','-2','change');input(x,'[data-speaker-field=speed]','0.9','change');input(x,'[data-speaker-field=delivery_style]','Storyteller','change');input(x,'[data-speaker-field=delivery]','Warm storyteller for children.');
 x.q('[data-speaker-tab=b]').click();assert.equal(x.q('[data-speaker-field=pitch]').value,'');input(x,'[data-speaker-field=pitch]','2','change');input(x,'[data-speaker-field=speed]','1.1','change');input(x,'[data-speaker-field=exaggeration]','0.6','change');
 x.q('[data-speaker-tab=b]').dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.equal(x.q('[data-speaker-field=pitch]').value,'-2');assert.equal(x.w.document.activeElement,x.q('[data-speaker-tab=a]'));assert.equal(x.q('[data-speaker-field=delivery_style]').value,'Storyteller');
 assert.equal(x.q('[data-speaker-field=pitch]').closest('dialog').id,'generation-controls-dialog');x.q('#generation-controls-dialog').close();x.q('#audio-form').requestSubmit();await tick();await tick();
 assert.equal(requests.length,1);assert.equal(requests[0].character_controls_version,1);assert.deepEqual(Array.from(requests[0].lines,l=>l.pitch),[-2,2]);assert.deepEqual(Array.from(requests[0].lines,l=>l.speed),[.9,1.1]);assert.equal(requests[0].lines[0].emotion,'neutral');assert.equal(requests[0].lines[1].exaggeration,.6);assert.equal(requests[0].lines[0].pause_before,.6);assert.deepEqual(x.errors,[]);
});
test('Spoken script popup edits keep numbered Final Script turns and opening in sync',async t=>{
 const x=await fixture(t);x.q('[data-open-controls]').click();x.q('[data-edit-script-structure]').click();
 const words=input(x,'#audio-lines [data-line="1"] [data-field=text]','The merchant laughed and caught his hat.');
 assert.equal(x.q('[data-final-turn="1"]').value,words.value);
 assert.equal(x.q('#audio-lines [data-line="1"] [data-field=text]'),words);
 input(x,'[data-opening-text]','Welcome to our adventure.');
 assert.equal(x.q('[data-final-turn="0"]').value,'Welcome to our adventure.');
 assert.equal(x.q('[data-final-turn="2"]').value,words.value);
 input(x,'[data-opening-speaker]','b','change');
 assert.match(x.q('[data-final-turn="0"]').parentElement.textContent,/Grandmother/);
 x.q('#generation-prompt-dialog [data-close]').click();
 assert.equal(x.q('#generation-prompt-dialog').open,false);
 assert.equal(x.q('[data-final-turn="2"]').value,words.value);
 assert.deepEqual(x.errors,[]);
});
test('An old worker cannot silently drop different character pitch settings',async t=>{
 const x=await fixture(t),requests=[];x.w.EccoAudioStudio.connect({storageIndependentOfGPU:true,status:async()=>({routing_version:1,compute:{cpu:{ready:true,models:['chatterbox']}}}),list:async()=>[],generate:async body=>{requests.push(body);return{id:'j'};},job:async()=>({status:'done'}),mediaURL:async()=>'',download:async()=>{}});await tick();x.q('[data-open-controls]').click();input(x,'[data-speaker-field=pitch]','-2','change');x.q('#generation-controls-dialog').close();x.q('#audio-form').requestSubmit();await tick();assert.equal(requests.length,0);assert.match(x.q('#notice').textContent,/character-controls update/);
});
test('Selected-text improvement sends only the selected passage and replaces precisely that range',async t=>{
 const x=await fixture(t),calls=[];x.w.testUI.setAPI(async(path,body)=>{calls.push(body);return{questions:[],revisions:[{id:'selected_audio_text',text:'अरे वाह, यह तो मज़ेदार हो गया!'}]};});
 const field=x.q('[data-final-turn="0"]'),before=field.value,start=before.indexOf('यहाँ'),end=before.indexOf(' आखिर');field.focus();field.setSelectionRange(start,end);field.dispatchEvent(new x.w.Event('select'));x.q('[data-improve-selection]').click();
 const dialog=x.q('#audio-selection-ai');assert.equal(dialog.querySelector('[data-selected-text]').value,before.slice(start,end));assert.ok(dialog.querySelector('[data-instructions]').compareDocumentPosition(dialog.querySelector('[data-selected-text]'))&4);
 input(x,'#audio-selection-ai [data-instructions]','Make this sentence more fun for children.');dialog.querySelector('form').requestSubmit();await tick();assert.equal(calls.length,1);assert.equal(calls[0].story_id,null);assert.equal(calls[0].fields[0].text,before.slice(start,end));assert.ok(!JSON.stringify(calls[0]).includes('दूसरे किरदार'));assert.ok(!JSON.stringify(calls[0]).includes('पहले यह था'));
 dialog.querySelector('[data-apply]').click();const draft=JSON.parse(x.w.localStorage.getItem('ecco-audio-draft:audio-story'));assert.equal(draft.lines[0].text,before.slice(0,start)+'अरे वाह, यह तो मज़ेदार हो गया!'+before.slice(end));assert.equal(draft.lines[1].text,'दूसरे किरदार की बात वही रहे।');assert.equal(draft.lines[0].speaker_id,'a');assert.match(x.q('[data-script-edit-status]').textContent,/Generate audio/);assert.deepEqual(x.errors,[]);
});
test('A late selected-text result cannot overwrite manual edits',async t=>{
 const x=await fixture(t);let finish;x.w.testUI.setAPI(()=>new Promise(resolve=>finish=resolve));const field=x.q('[data-final-turn="0"]');field.setSelectionRange(0,5);field.dispatchEvent(new x.w.Event('select'));x.q('[data-improve-selection]').click();input(x,'#audio-selection-ai [data-instructions]','Simplify');x.q('#audio-selection-ai form').requestSubmit();input(x,'[data-final-turn="0"]','A new manual draft.');finish({questions:[],revisions:[{id:'selected_audio_text',text:'Wrong late value'}]});await tick();assert.equal(x.q('#audio-selection-ai [data-apply]').hidden,true);assert.match(x.q('#audio-selection-ai [role=status]').textContent,/script changed/);assert.equal(field.value,'A new manual draft.');
});
test('Chapter selection excludes the contents, earlier material and next chapter, including mid-page boundaries',async t=>{
 const x=await fixture(t),pages=[['Contents','Chapter 1 ........ 5','Chapter 2 ........ 7'],['Preface','EXCLUDED preface'],['Chapter 1','The merchant arrived.','He rested.'],['The genie appeared.','Chapter 2','EXCLUDED next chapter']];let calls=0;
 const selection=await x.w.EccoSourceChapters.locate({pages,chapter:'Chapter 1',maxSelection:20000,request:async(path,body)=>{calls++;if(body.fields[0].id==='chapter_location')return reply('chapter_location',{chapter_title:'Chapter 1',start:{page:3,line:1,text:'Chapter 1'},end:{page:4,line:2,text:'Chapter 2'},ends_at_document_end:false});return reply('chapter_verification',{valid:true,reason:'Actual body headings verified.'});}});
 assert.equal(calls,2);assert.equal(selection.text,'Chapter 1\nThe merchant arrived.\nHe rested.\n\nThe genie appeared.');assert.deepEqual(Array.from(selection.pages),[3,4]);assert.ok(!selection.text.includes('EXCLUDED'));
 assert.throws(()=>x.w.EccoSourceChapters.extract(pages,{chapter_title:'Chapter 1',start:{page:3,line:1,text:'Invented heading'},end:{page:4,line:2,text:'Chapter 2'}},20000),/could not be verified/);
 await assert.rejects(x.w.EccoSourceChapters.locate({pages,chapter:'Chapter 1',request:async(path,body)=>body.fields[0].id==='chapter_location'?reply('chapter_location',{chapter_title:'Chapter 1',start:{page:1,line:2,text:'Chapter 1 ........ 5'},end:{page:1,line:3,text:'Chapter 2 ........ 7'}}):reply('chapter_verification',{valid:false,reason:'This is the contents, not the chapter body.'})}),/contents/);
});
test('Chatterbox casting uses the default voice for Hindi instead of arbitrary cross-language samples, while other model defaults stay stable',async t=>{
 const x=await fixture(t),models=x.w.EccoAudioModels;assert.equal(x.w.EccoAudioDirection.defaultVoice(models.find(m=>m.id==='chatterbox'),'Hindi',2),'default');assert.equal(x.w.EccoAudioDirection.defaultVoice(models[0],'Hindi',1),'en_male');
 const guide=x.w.EccoAudioDirection.guidance({genre:'Story Book Reading',audience:'Children (6–8)',language:'Hindi'});assert.match(guide,/not a plot summary/);assert.match(guide,/familiar concrete words/);assert.match(guide,/everyday spoken phrasing/);
});
test('Chapter verification receives all interior pages, not only boundary neighbors',async t=>{
 const x=await fixture(t),pages=[['Preface'],['Chapter 1','Start'],['First event'],['Essential middle event'],['Last event'],['Ending','Chapter 2'],['Next chapter']];
 const selection=await x.w.EccoSourceChapters.locate({pages,chapter:'Chapter 1',maxSelection:20000,request:async(path,body)=>{
  if(body.fields[0].id==='chapter_location')return reply('chapter_location',{chapter_title:'Chapter 1',start:{page:2,line:1,text:'Chapter 1'},end:{page:6,line:2,text:'Chapter 2'}});
  const evidence=JSON.parse(body.context.summary).pages;
  assert.deepEqual(evidence.map(p=>p.page),[1,2,3,4,5,6,7]);assert.equal(evidence[3].lines[0].text,'Essential middle event');
  return reply('chapter_verification',{valid:true,reason:'All intervening pages verified.'});
 }});
 assert.match(selection.text,/Essential middle event/);assert.ok(!selection.text.includes('Chapter 2'));
});
module.exports={directed};
test('Chapter dialogue can retain more than twenty short speaker turns',async t=>{
 const x=await fixture(t);const cast=[{id:'a',name:'Mira'},{id:'b',name:'Grandmother'}];
 const plan={opening:{character_id:'a',text:'A chapter begins.'},segments:Array.from({length:40},(_,i)=>({character_id:i%2?'a':'b',text:'A short spoken reply.'}))};
 assert.equal(x.w.EccoAudioScript.validatePlan(plan,cast,40).segments.length,40);
 assert.throws(()=>x.w.EccoAudioScript.validatePlan({...plan,segments:Array.from({length:81},(_,i)=>({character_id:i%2?'a':'b',text:'A reply.'}))},cast),/80 speech/);
});
