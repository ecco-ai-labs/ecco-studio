const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,input,tick}=require('./audio-ui-test-helpers.cjs');
const dlg='#audio-guided-dialog';
async function ready(t,intent='podcast',storage={}){
 const x=await setup(storage);t.after(x.close);x.w.EccoWorkspaceUI.startNewStory(x.w.EccoStoryJourneys.get(intent));await tick();
 const realAI=x.w.EccoAI;x.w.EccoAI={...realAI,enabled:true};x.w.EccoStorage={ready:true};return x;
}
const submit=async x=>{x.q(dlg+' form').requestSubmit();await tick();};
const field=(x,key,value)=>input(x,dlg+' [data-value='+key+']',value);
const saved=(x,key)=>JSON.parse(x.w.localStorage.getItem(key));
function mock(x,{names=['Host','Guest'],questions=['Should the discussion include practical examples?'],texts,invalid=false}={}){
 const calls=[];x.w.testUI.setAPI(async(path,body)=>{
  calls.push({path,body});if(path==='stories')return{id:'created-story',...body};
  if(path==='ai/news/research')return{research:{items:[{title:'Test report',summary:'Supported facts',sources:[{title:'Test source',url:'https://example.org/news'}]}]}};
  if(body.fields[0].id==='audio_plan'){
   const count=Number(body.fields[0].text.match(/exactly (\d+)/)[1]),cast=body.context.lines;
   return{revisions:[{id:'audio_plan',text:JSON.stringify({opening:null,segments:Array.from({length:count},(_,i)=>({character_id:invalid?'unknown':cast[i%cast.length].character_id,text:texts?.[i]||'Spoken turn '+(i+1)+'.'}))})}],questions:[]};
  }
  const values={source_review:'The chosen excerpt explains the paper.',working_title:'Paper discussion',character_count:String(names.length),cast_reason:'One host and one guest suit this podcast.'};
  names.forEach((name,i)=>Object.assign(values,{['character_'+(i+1)+'_name']:name,['character_'+(i+1)+'_role']:i?'Guest':'Host',['character_'+(i+1)+'_gender']:'Unspecified',['character_'+(i+1)+'_age_group']:'Adult',['character_'+(i+1)+'_style']:'Professional'}));
  return {revisions:body.fields.map(f=>({id:f.id,text:values[f.id]||''})),questions:body.fields[0].id==='source_review'?questions:[]};
 });return calls;
}
async function open(x){x.q('#story-description-ai [data-generate]').click();await tick();assert.ok(x.q(dlg)?.open);}
async function questions(x){field(x,'instructions','Turn this paper into a helpful audio discussion.');await submit(x);assert.ok(x.q(dlg+' [data-value=audience]'));field(x,'audience','Adults');field(x,'language','Hindi');field(x,'tone','Warm and professional');}
async function review(x){await questions(x);await submit(x);assert.ok(x.q('[data-cast-row]'));await submit(x);assert.ok(x.q('[data-review-turn]'),x.q(dlg+' [data-status]')?.textContent);}

test('All Audio entry journeys open the guided popup; Video keeps its existing popup',async t=>{
 const x=await ready(t);for(const intent of ['audiobook','podcast','audio-drama']){x.w.EccoWorkspaceUI.startNewStory(x.w.EccoStoryJourneys.get(intent));await tick();assert.equal(x.q('#story-setup-form [type=submit]').textContent,'Save and Continue with Script');await open(x);assert.match(x.q(dlg+' nav').textContent,/Source.*Questions.*Characters.*Script/);x.q(dlg+' [data-close]').click();}
 x.w.EccoWorkspaceUI.startNewStory(x.w.EccoStoryJourneys.get('animation'));await tick();x.q('#story-description-ai [data-generate]').click();assert.equal(x.q(dlg),null);assert.ok(x.q('#ai-generation-dialog'));assert.deepEqual(x.errors,[]);
});

test('Only the selected uploaded passage reaches every AI request, then editable turns fill the main page and audio draft',async t=>{
 const x=await ready(t),calls=mock(x);const source=input(x,'[name=sourceText]','SECRET_OUTSIDE beginning. Chosen paper excerpt. SECRET_OUTSIDE ending.');const start=source.value.indexOf('Chosen');source.setSelectionRange(start,start+'Chosen paper excerpt.'.length);
 await open(x);assert.equal(x.q(dlg+' [data-value=source_text]').value,'Chosen paper excerpt.');await questions(x);input(x,'[data-answer="0"]','Include one example.');await submit(x);
 input(x,'[data-cast-row="0"] [data-character-property=name]','Asha');input(x,'[data-cast-row="0"] [data-character-property=gender]','Female');input(x,'[data-cast-row="0"] [data-character-property=age_group]','Middle aged');
 await submit(x);assert.equal(x.q('[name=summary]').value,'');input(x,'[data-review-text]','नमस्ते।');await submit(x);
 assert.equal(x.q(dlg),null);assert.equal(x.q('[name=audio_audience]').value,'Adults');assert.equal(x.q('[name=audio_language]').value,'Hindi');assert.equal(x.q('[name=genre]').value,'Podcast');assert.match(x.q('[name=summary]').value,/Asha: नमस्ते।/);assert.equal(x.q('[name=sourceText]').value,'Chosen paper excerpt.');assert.match(x.q('[name=journey_second]').value,/Female, Middle aged, Professional/);
 for(const call of calls){assert.equal(call.body.story_id,null);assert.equal(JSON.parse(call.body.context.summary).source_text,'Chosen paper excerpt.');assert.ok(!JSON.stringify(call).includes('SECRET_OUTSIDE'));}
 assert.match(calls[2].body.context.instructions,/Include one example/);assert.equal(calls[2].body.context.lines[0].gender,'Female');
 const summary=x.q('[name=summary]');input(x,'[name=summary]',summary.value.replace('नमस्ते।','स्वागत है।'));x.q('#story-setup-form').requestSubmit();await tick();
 const audio=saved(x,'ecco-audio-draft:created-story'),board=saved(x,'ecco-board-draft:created-story');assert.equal(audio.lines[0].text,'स्वागत है।');assert.equal(audio.speakers[0].name,'Asha');assert.equal(audio.speakers[0].gender,'Female');assert.equal(audio.lines[0].speaker_id,audio.speakers[0].id);assert.equal(board.scenes[0].narration,'स्वागत है।');assert.equal(board.scenes[0].audio_character_id,audio.speakers[0].id);assert.deepEqual(x.errors,[]);
});

test('Upload selection is explicit, reusable character sets retain IDs and properties across chapters',async t=>{
 const x=await ready(t,'audiobook'),calls=mock(x,{names:['Narrator','Mira','Grandmother']});await open(x);
 const file={name:'chapter.txt',size:55,text:async()=> 'EXCLUDED chapter one. Chapter two for Mira. EXCLUDED three.'};Object.defineProperty(x.q('[data-file]'),'files',{value:[file]});x.q('[data-file]').dispatchEvent(new x.w.Event('change'));await tick();
 const text=x.q('[data-value=source_text]'),start=text.value.indexOf('Chapter two');text.setSelectionRange(start,start+'Chapter two for Mira.'.length);x.q('[data-select-text]').click();await questions(x);await submit(x);
 input(x,'[data-cast-row="2"] [data-character-property=style]','Kind and patient');input(x,'[data-set-name]','Mira’s family');x.q('[data-save-cast]').click();const set=saved(x,'ecco-audio-character-sets-v1')[0];assert.equal(set.cast.length,3);assert.equal(set.cast[2].style,'Kind and patient');assert.equal(x.q('[data-saved-cast]').value,set.id);
 x.q(dlg).close();x.w.EccoWorkspaceUI.startNewStory(x.w.EccoStoryJourneys.get('audiobook'));await tick();await open(x);await questions(x);await submit(x);input(x,'[data-saved-cast]',set.id,'change');x.q('[data-load-cast]').click();await submit(x);await submit(x);
 const p=JSON.parse(x.q('[name=audio_preparation]').value);assert.equal(p.cast[2].id,set.cast[2].id);assert.equal(p.cast[2].style,'Kind and patient');assert.ok(calls.slice(0,2).every(c=>!JSON.stringify(c).includes('EXCLUDED')));assert.deepEqual(x.errors,[]);
});

test('Cancel, stale main-page edits and late results never overwrite the current script',async t=>{
 const x=await ready(t);input(x,'[name=summary]','Keep this draft.');let finish;x.w.testUI.setAPI(()=>new Promise(resolve=>finish=resolve));await open(x);x.q(dlg+' form').requestSubmit();await tick();x.q(dlg).close();finish({revisions:[],questions:[]});await tick();assert.equal(x.q('[name=summary]').value,'Keep this draft.');
 mock(x);await open(x);await review(x);input(x,'[name=summary]','New manual edit.');await submit(x);assert.match(x.q(dlg+' [data-status]').textContent,/changed/);assert.equal(x.q('[name=summary]').value,'New manual edit.');assert.deepEqual(x.errors,[]);
});

test('Invalid casts, unsupported character assignments and invalid edited transcripts are rejected',async t=>{
 const x=await ready(t);mock(x,{invalid:true});await open(x);await questions(x);await submit(x);input(x,'[data-cast-row="1"] [data-character-property=name]','Host');await submit(x);assert.match(x.q(dlg+' [data-status]').textContent,/different name/);input(x,'[data-cast-row="1"] [data-character-property=name]','Guest');await submit(x);assert.match(x.q(dlg+' [data-status]').textContent,/invalid character/);assert.equal(x.q('[name=summary]').value,'');x.q(dlg).close();
 mock(x);await open(x);await review(x);await submit(x);input(x,'[name=summary]','Unknown: edited words');x.q('#story-setup-form').requestSubmit();await tick();assert.match(x.q('[data-story-status]').textContent,/Character name/);assert.equal(saved(x,'ecco-audio-draft:created-story'),null);
 const cast=JSON.parse(x.q('[name=audio_preparation]').value).cast;assert.throws(()=>x.w.EccoAudioScript.validatePlan({opening:null,segments:[{character_id:cast[0].id,text:'a'.repeat(4001)}]},cast,1),/4,000/);
});

test('Audio Studio uses the same journey, preserves voice choices and resolves latest emotion and pitch on Generate',async t=>{
 const x=await ready(t);await x.go('audio');input(x,'[name=genre]','Podcast','change');const initial=saved(x,'ecco-audio-draft:');mock(x);x.q('[data-generate-audio-script]').click();await review(x);input(x,'[data-review-text]','Welcome to our podcast.');await submit(x);
 let audio=saved(x,'ecco-audio-draft:');assert.equal(audio.speakers[0].id,initial.speakers[0].id);assert.equal(audio.lines[0].text,'Welcome to our podcast.');assert.equal(x.q('[data-character-count]').value,'2');
 x.q('[data-open-controls]').click();x.q('[data-speaker-tab="'+audio.speakers[1].id+'"]').click();input(x,'[data-speaker-field=voice]','en_male','change');input(x,'[data-speaker-field=emotion]','happy','change');input(x,'[name=pitch]','2');input(x,'[name=speed]','1.25');
 const calls=[];x.w.EccoAudioStudio.connect({storageIndependentOfGPU:true,status:async()=>({routing_version:1,compute:{cpu:{ready:true,models:['indic-mio']}}}),list:async()=>[],generate:async body=>{calls.push(body);return{id:'job'};},job:async()=>({id:'job',status:'done'}),mediaURL:async()=>'',download:async()=>{}});await tick();x.q('#audio-form').requestSubmit();await tick();assert.equal(calls.length,1);assert.equal(calls[0].pitch,2);assert.equal(calls[0].speed,1.25);assert.equal(calls[0].lines[1].voice,'en_male');assert.equal(calls[0].lines[1].emotion,'happy');assert.deepEqual(x.errors,[]);
});

test('Topic-only news researches citations, displays them in review, and keeps the last character and turn',async t=>{
 const x=await ready(t),calls=mock(x,{names:['Newsreader']});await open(x);await questions(x);field(x,'genre','News');await submit(x);assert.equal(x.q('[data-remove-character]').disabled,true);await submit(x);assert.equal(x.q('[data-remove-turn]').disabled,true);assert.equal(x.q('[data-news-sources] a').href,'https://example.org/news');assert.ok(calls.some(c=>c.path==='ai/news/research'));await submit(x);assert.match(x.q('[name=summary]').value,/Newsreader:/);
});
