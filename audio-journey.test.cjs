const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,input,tick}=require('./audio-ui-test-helpers.cjs');
const dlg='#audio-guided-dialog';
const directedReply=body=>{const plan=JSON.parse(body.context.summary).draft,part=p=>({...p,performance:{emotion:'neutral',direction:'Natural audience-appropriate narration.',pause_before:.35}});return{questions:[],revisions:[{id:'audio_directed_script',text:JSON.stringify({opening:plan.opening?part(plan.opening):null,segments:plan.segments.map(part),expressiveness:null})}]};};

async function ready(t,intent='podcast',storage={}){
 const x=await setup(storage);t.after(x.close);x.w.EccoWorkspaceUI.startNewStory(x.w.EccoStoryJourneys.get(intent));await tick();
 const realAI=x.w.EccoAI;x.w.EccoAI={...realAI,enabled:true};x.w.EccoStorage={ready:true};return x;
}
const submit=async x=>{x.q(dlg+' form').requestSubmit();await tick();};
const field=(x,key,value)=>input(x,dlg+' [data-value='+key+']',value);
const saved=(x,key)=>JSON.parse(x.w.localStorage.getItem(key));

test('new audiobooks isolate unsaved audio scripts while earlier drafts remain recoverable',async t=>{
 const legacy={lines:[{text:'Earlier unsaved audio',language:'Hindi',voice:'en_female',emotion:'neutral'}]};
 const x=await ready(t,'audiobook',{'ecco-audio-draft:':JSON.stringify(legacy)});
 input(x,'[name=title]','First draft');const first=saved(x,'ecco-new-story-draft').localDraftId;
 await x.go('audio');assert.equal(x.q('[data-final-turn]').value,'');
 input(x,'[data-final-turn]','Keep this first audiobook.');
 x.w.EccoWorkspaceUI.startNewStory(x.w.EccoStoryJourneys.get('audiobook'));await tick();
 const second=saved(x,'ecco-new-story-draft').localDraftId;assert.notEqual(first,second);
 await x.go('audio');assert.equal(x.q('[data-final-turn]').value,'');
 assert.equal(saved(x,'ecco-audio-draft:local:'+first).single_text,'Keep this first audiobook.');
 assert.equal(saved(x,'ecco-audio-draft:').lines[0].text,'Earlier unsaved audio');
 await x.go('story-library');x.q('[data-local-story-id="'+first+'"]').click();await tick();await x.go('audio');
 assert.equal(x.q('[data-final-turn]').value,'Keep this first audiobook.');assert.deepEqual(x.errors,[]);
});
function mock(x,{names=['Host','Guest'],questions=['Should the discussion include practical examples?'],texts,invalid=false}={}){
 const calls=[];x.w.testUI.setAPI(async(path,body)=>{
  calls.push({path,body});if(body?.fields?.[0].id==='audio_directed_script')return directedReply(body);if(path==='stories')return{id:'created-story',...body};
  if(path==='ai/news/research')return{research:{items:[{title:'Test report',summary:'Supported facts',sources:[{title:'Test source',url:'https://example.org/news'}]}]}};
  if(body.fields[0].id==='sound_cues')return {revisions:[{id:'sound_cues',text:JSON.stringify({cues:[{name:'Jinn Arrival',kind:'effect',description:'A gentle magical whoosh',asset_id:'',start:0,end:0,phrase:'',level_db:-14,fade:.1,duck:false,loop:false}]})}]};
  if(body.fields[0].id==='selected_audio_text')return {revisions:[{id:'selected_audio_text',text:body.fields[0].text+' improved'}]};
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
 for(const call of calls){assert.equal(call.body.story_id,null);assert.equal((JSON.parse(call.body.context.summary).source||JSON.parse(call.body.context.summary)).source_text,'Chosen paper excerpt.');assert.ok(!JSON.stringify(call).includes('SECRET_OUTSIDE'));}
 assert.equal(calls[0].body.context.language,'English');assert.equal(calls[1].body.context.language,'English');assert.equal(calls[2].body.context.language,'Hindi');assert.equal(calls[2].body.context.lines[0].language,'Hindi');assert.match(calls[2].body.context.instructions,/Include one example/);assert.equal(calls[2].body.context.lines[0].gender,'Female');
 const summary=x.q('[name=summary]');input(x,'[name=summary]',summary.value.replace('नमस्ते।','स्वागत है।'));x.q('#story-setup-form').requestSubmit();await tick();
 const audio=saved(x,'ecco-audio-draft:created-story'),board=saved(x,'ecco-board-draft:created-story');assert.equal(audio.lines[0].text,'स्वागत है।');assert.equal(audio.speakers[0].name,'Asha');assert.equal(audio.speakers[0].gender,'Female');assert.equal(audio.lines[0].speaker_id,audio.speakers[0].id);assert.equal(board.scenes[0].narration,'स्वागत है।');assert.equal(board.scenes[0].audio_character_id,audio.speakers[0].id);assert.deepEqual(x.errors,[]);
});

test('Upload selection is explicit, reusable character sets retain IDs and properties across chapters',async t=>{
 const x=await ready(t,'audiobook'),calls=mock(x,{names:['Narrator','Mira','Grandmother']});await open(x);
 const file={name:'chapter.txt',size:55,text:async()=> 'EXCLUDED chapter one. Chapter two for Mira. EXCLUDED three.'};Object.defineProperty(x.q('[data-file]'),'files',{value:[file]});x.q('[data-file]').dispatchEvent(new x.w.Event('change'));await tick();
 const picker=x.q('dialog[aria-label="Select Source Text"]'),text=picker.querySelector('.source-text-preview').firstChild,start=text.textContent.indexOf('Chapter two');const range=x.w.document.createRange();range.setStart(text,start);range.setEnd(text,start+'Chapter two for Mira.'.length);x.w.getSelection().removeAllRanges();x.w.getSelection().addRange(range);picker.querySelector('.pdf-page-scroll').dispatchEvent(new x.w.MouseEvent('mouseup',{bubbles:true}));picker.querySelector('[data-extract]').click();await questions(x);await submit(x);
 input(x,'[data-cast-row="2"] [data-character-property=style]','Kind and patient');input(x,'[data-set-name]','Mira’s family');x.q('[data-save-cast]').click();const set=saved(x,'ecco-audio-character-sets-v1')[0];assert.equal(set.cast.length,3);assert.equal(set.cast[2].style,'Kind and patient');assert.equal(x.q('[data-saved-cast]').value,set.id);
 x.q(dlg).close();x.w.EccoWorkspaceUI.startNewStory(x.w.EccoStoryJourneys.get('audiobook'));await tick();await open(x);await questions(x);await submit(x);input(x,'[data-saved-cast]',set.id,'change');x.q('[data-load-cast]').click();await submit(x);await submit(x);
 const p=JSON.parse(x.q('[name=audio_preparation]').value);assert.equal(p.cast[2].id,set.cast[2].id);assert.equal(p.cast[2].style,'Kind and patient');assert.ok(calls.slice(0,2).every(c=>!JSON.stringify(c).includes('EXCLUDED')));assert.deepEqual(x.errors,[]);
});

test('Cancel, stale main-page edits and late results never overwrite the current script',async t=>{
 const x=await ready(t);input(x,'[name=summary]','Keep this draft.');let finish;x.w.testUI.setAPI(()=>new Promise(resolve=>finish=resolve));await open(x);x.q(dlg+' form').requestSubmit();await tick();x.q(dlg).close();finish({revisions:[],questions:[]});await tick();assert.equal(x.q('[name=summary]').value,'Keep this draft.');
 mock(x);await open(x);await review(x);input(x,'[name=summary]','New manual edit.');await submit(x);assert.match(x.q(dlg+' [data-status]').textContent,/changed/);assert.equal(x.q('[name=summary]').value,'New manual edit.');assert.deepEqual(x.errors,[]);
});

test('Closing the guided popup restores focus to its visible AI menu control',async t=>{
 const x=await ready(t),menu=x.q('#story-description-ai');menu.open=true;menu.querySelector('[data-generate]').focus();await open(x);x.q(dlg).close();assert.equal(x.w.document.activeElement,menu.querySelector('summary'));
});

test('Invalid casts, unsupported character assignments and invalid edited transcripts are rejected',async t=>{
 const x=await ready(t);mock(x,{invalid:true});await open(x);await questions(x);await submit(x);input(x,'[data-cast-row="1"] [data-character-property=name]','Host');await submit(x);assert.match(x.q(dlg+' [data-status]').textContent,/different name/);input(x,'[data-cast-row="1"] [data-character-property=name]','Guest');await submit(x);assert.match(x.q(dlg+' [data-status]').textContent,/invalid character/);assert.equal(x.q('[name=summary]').value,'');x.q(dlg).close();
 mock(x);await open(x);await review(x);await submit(x);input(x,'[name=summary]','Unknown: edited words');x.q('#story-setup-form').requestSubmit();await tick();assert.match(x.q('[data-story-status]').textContent,/Character name/);assert.equal(saved(x,'ecco-audio-draft:created-story'),null);
 const cast=JSON.parse(x.q('[name=audio_preparation]').value).cast;assert.throws(()=>x.w.EccoAudioScript.validatePlan({opening:null,segments:[{character_id:cast[0].id,text:'a'.repeat(4001)}]},cast,1),/4,000/);
});

test('Audio Studio uses the same journey, preserves voice choices and resolves latest emotion and pitch on Generate',async t=>{
 const x=await ready(t);await x.go('audio');input(x,'[name=genre]','Podcast','change');const draftKey='ecco-audio-draft:local:'+saved(x,'ecco-new-story-draft').localDraftId;const initial=saved(x,draftKey);mock(x);x.q('[data-generate-audio-script]').click();await review(x);input(x,'[data-review-text]','Welcome to our podcast.');await submit(x);
 let audio=saved(x,draftKey);assert.equal(audio.speakers[0].id,initial.speakers[0].id);assert.equal(audio.lines[0].text,'Welcome to our podcast.');assert.equal(x.q('[data-character-count]').value,'2');
 x.q('[data-open-controls]').click();x.q('[data-speaker-tab="'+audio.speakers[1].id+'"]').click();input(x,'[data-speaker-field=voice]','en_male','change');input(x,'[data-speaker-field=emotion]','happy','change');input(x,'[name=pitch]','2');input(x,'[name=speed]','1.25');
 const calls=[];x.w.EccoAudioStudio.connect({storageIndependentOfGPU:true,status:async()=>({routing_version:1,compute:{cpu:{ready:true,models:['indic-mio']}}}),list:async()=>[],generate:async body=>{calls.push(body);return{id:'job'};},job:async()=>({id:'job',status:'done'}),mediaURL:async()=>'',download:async()=>{}});await tick();x.q('#audio-form').requestSubmit();await tick();assert.equal(calls.length,1);assert.equal(calls[0].pitch,2);assert.equal(calls[0].speed,1.25);assert.equal(calls[0].lines[1].voice,'en_male');assert.equal(calls[0].lines[1].emotion,'happy');assert.deepEqual(x.errors,[]);
});

test('Topic-only news researches citations, displays them in review, and keeps the last character and turn',async t=>{
 const x=await ready(t),calls=mock(x,{names:['Newsreader']});await open(x);await questions(x);field(x,'genre','News');await submit(x);assert.equal(x.q('[data-remove-character]').disabled,true);await submit(x);assert.equal(x.q('[data-remove-turn]').disabled,true);assert.equal(x.q('[data-news-sources] a').href,'https://example.org/news');assert.ok(calls.some(c=>c.path==='ai/news/research'));await submit(x);assert.match(x.q('[name=summary]').value,/Newsreader:/);
});

const scriptReply=body=>body.fields[0].id==='audio_directed_script'?directedReply(body):({questions:[],revisions:[{id:'audio_plan',text:JSON.stringify({opening:null,segments:Array.from({length:Number(body.fields[0].text.match(/exactly (\d+)/)[1])},(_,i)=>({character_id:body.context.lines[i%body.context.lines.length].character_id,text:'नमस्ते, चलिए बात करते हैं।'}))})}]});

test('Generate Script spins while waiting; clarification stays in place and preserves earlier answers and characters',async t=>{
 const x=await ready(t);mock(x);await open(x);await questions(x);input(x,'[data-answer="0"]','Use one practical example.');await submit(x);
 input(x,'[data-cast-row="0"] [data-character-property=name]','Asha');const originalField=x.q('[data-cast-row="0"] [data-character-property=name]');
 let finish,requests=[];x.w.testUI.setAPI((path,body)=>{requests.push(body);return new Promise(resolve=>finish=resolve);});
 x.q(dlg+' form').requestSubmit();assert.ok(x.q(dlg+' [data-next] .generation-spinner'));assert.equal(x.q(dlg+' [data-next]').textContent,'Generating Script…');assert.equal(x.q(dlg+' [data-next]').getAttribute('aria-busy'),'true');assert.equal(x.q(dlg+' [data-next]').disabled,true);
 x.q(dlg+' form').requestSubmit();assert.equal(requests.length,1);finish({questions:['Should this excerpt end at the cliffhanger?'],revisions:[]});await tick();
 assert.match(x.q('[aria-current=step]').textContent,/3. Characters/);assert.equal(x.q('[data-cast-row="0"] [data-character-property=name]'),originalField);assert.equal(originalField.value,'Asha');assert.equal(x.q(dlg+' [data-next] .generation-spinner'),null);assert.equal(x.q(dlg+' [data-next]').disabled,false);assert.match(x.q('[data-script-clarifications]').textContent,/cliffhanger/);
 await submit(x);assert.equal(requests.length,1);assert.match(x.q(dlg+' [data-status]').textContent,/Answer the Script Clarifications/);
 input(x,'[data-script-answer="0"]','Yes. Use only the selected excerpt.');x.w.testUI.setAPI(async(path,body)=>{requests.push(body);return scriptReply(body);});await submit(x);
 assert.match(requests[1].context.instructions,/Use one practical example/);assert.match(requests[1].context.instructions,/Yes. Use only the selected excerpt/);assert.equal(requests[1].context.lines[0].name,'Asha');assert.match(x.q('[aria-current=step]').textContent,/4. Script/);assert.equal(x.q(dlg+' [data-next]').textContent,'Apply');assert.equal(x.q(dlg+' [data-next] .generation-spinner'),null);assert.equal(x.q('[name=summary]').value,'');
});

test('A script request failure clears the spinner and allows retry without changing screens or cast',async t=>{
 const x=await ready(t);mock(x);await open(x);await questions(x);await submit(x);const castField=x.q('[data-character-property=name]');x.w.testUI.setAPI(async()=>{throw Error('Connection interrupted.');});await submit(x);
 assert.equal(x.q('[data-character-property=name]'),castField);assert.match(x.q('[aria-current=step]').textContent,/3. Characters/);assert.match(x.q(dlg+' [data-status]').textContent,/Connection interrupted/);assert.equal(x.q(dlg+' [data-next]').disabled,false);assert.equal(x.q(dlg+' [data-next]').getAttribute('aria-busy'),'false');assert.equal(x.q(dlg+' [data-next] .generation-spinner'),null);
 x.w.testUI.setAPI(async(path,body)=>scriptReply(body));await submit(x);assert.match(x.q('[aria-current=step]').textContent,/4. Script/);
});

test('Language Style defaults to everyday Hindi and custom guidance is sent and retained after Apply',async t=>{
 const x=await ready(t),calls=mock(x);assert.equal(x.q('[name=audio_language_style]').value,'Everyday / Conversational');await open(x);await questions(x);assert.equal(x.q('[data-value=language_style]').value,'Everyday / Conversational');assert.equal(x.q('[data-value=language_style_instructions]').closest('label').hidden,true);
 field(x,'language_style','Custom');assert.equal(x.q('[data-value=language_style_instructions]').closest('label').hidden,false);await submit(x);assert.equal(calls.length,1);assert.match(x.q(dlg+' [data-status]').textContent,/Custom Language Instructions/);
 field(x,'language_style_instructions','Use commonly spoken Hindi. Short sentences, familiar words, no difficult literary terms.');await submit(x);await submit(x);
 assert.equal(calls[2].body.context.language,'Hindi');assert.match(calls[2].body.context.instructions,/Language Style: Custom/);assert.match(calls[2].body.context.instructions,/Use commonly spoken Hindi/);await submit(x);
 assert.equal(x.q('[name=audio_language_style]').value,'Custom');assert.match(x.q('[name=audio_language_style_instructions]').value,/Short sentences/);assert.equal(x.q('[name=audio_language_style_instructions]').closest('label').hidden,false);assert.equal(JSON.parse(x.q('[name=audio_preparation]').value).language_style,'Custom');
});


test('Audience categories follow genre on both surfaces, preserve valid choices and retain the applied selection',async t=>{
 const x=await ready(t),calls=mock(x),options=field=>[...field.options].map(o=>o.value);
 assert.equal(x.q('[name=audio_audience]').tagName,'SELECT');assert.ok(options(x.q('[name=audio_audience]')).includes('Professionals'));
 input(x,'[name=audio_audience]','Professionals');input(x,'[name=genre]','Story Book Reading','change');assert.equal(x.q('[name=audio_audience]').value,'');assert.ok(options(x.q('[name=audio_audience]')).includes('Children (6–8)'));
 input(x,'[name=audio_audience]','Children (6–8)');assert.equal(saved(x,x.q('#story-setup-form').dataset.draftKey).audio_audience,'Children (6–8)');
 await open(x);field(x,'instructions','Create a story for children.');await submit(x);assert.equal(x.q('[data-value=genre]').value,'Story Book Reading');assert.equal(x.q('[data-value=audience]').value,'Children (6–8)');
 field(x,'genre','Educational');assert.equal(x.q('[data-value=audience]').value,'');assert.ok(options(x.q('[data-value=audience]')).includes('Primary school students'));
 field(x,'audience','Primary school students');field(x,'language','Hindi');await submit(x);assert.match(calls[1].body.context.instructions,/Audience: Primary school students/);await submit(x);assert.match(calls[2].body.context.instructions,/Audience: Primary school students/);await submit(x);
 assert.equal(x.q('[name=genre]').value,'Educational');assert.equal(x.q('[name=audio_audience]').value,'Primary school students');
 await open(x);await submit(x);assert.equal(x.q('[data-value=audience]').value,'Primary school students');x.q(dlg).close();
 input(x,'[name=genre]','Podcast','change');input(x,'[name=audio_audience]','Adults');input(x,'[name=genre]','Theatre','change');assert.equal(x.q('[name=audio_audience]').value,'Adults');assert.deepEqual(x.errors,[]);
});

test('Document preview is nested, requires an explicit selection, preserves draft on close and sends no unselected text',async t=>{
 const x=await ready(t),calls=mock(x);await open(x);field(x,'instructions','Use this paper for a podcast.');
 const file={name:'paper.txt',size:100,text:async()=>'<b>EXCLUDED_PRIVATE</b> Selected facts only. EXCLUDED_END'};
 Object.defineProperty(x.q('[data-file]'),'files',{value:[file]});x.q('[data-file]').dispatchEvent(new x.w.Event('change'));await tick();
 const child=x.q('dialog[aria-label="Select Source Text"]');assert.ok(child.open);assert.equal(child.querySelector('.source-text-preview b'),null);assert.equal(child.querySelector('[data-extract]').disabled,true);assert.equal(x.q('[data-value=source_text]').value,'');assert.equal(calls.length,0);
 child.querySelector('.ecco-popup-close').click();assert.ok(x.q(dlg).open);assert.equal(child.open,false);assert.equal(x.w.document.activeElement,x.q('#audio-guided-dialog [data-upload]'));await submit(x);assert.equal(calls.length,0);assert.match(x.q(dlg+' [data-status]').textContent,/Preview & Select/);
 x.q(dlg+' [data-preview]').click();assert.ok(child.open);const text=child.querySelector('.source-text-preview').firstChild,range=x.w.document.createRange(),start=text.textContent.indexOf('Selected');range.setStart(text,start);range.setEnd(text,start+'Selected facts only.'.length);x.w.getSelection().removeAllRanges();x.w.getSelection().addRange(range);child.querySelector('.pdf-page-scroll').dispatchEvent(new x.w.MouseEvent('mouseup',{bubbles:true}));
 assert.equal(child.querySelector('[data-selected]').value,'Selected facts only.');child.querySelector('[data-extract]').click();assert.equal(child.open,false);assert.ok(x.q(dlg).open);assert.equal(x.q('[data-value=source_text]').value,'Selected facts only.');await submit(x);assert.equal(calls.length,1);assert.equal(JSON.parse(calls[0].body.context.summary).source_text,'Selected facts only.');assert.ok(!JSON.stringify(calls).includes('EXCLUDED'));x.q(dlg).close();assert.equal(child.isConnected,false);assert.deepEqual(x.errors,[]);
});

test('Optional Opening and Closing directions produce editable bookends and survive Apply and audio handoff',async t=>{
 const x=await ready(t),calls=mock(x,{names:['Narrator']});await open(x);await questions(x);
 assert.equal(x.q('[data-value=opening_instructions]').value,'');assert.equal(x.q('[data-value=closing_instructions]').value,'');
 field(x,'opening_instructions','Welcome to the storybook.');field(x,'closing_instructions','End with the moral of the story.');await submit(x);
 assert.match(calls[1].body.context.instructions,/Welcome to the storybook/);assert.equal(x.q('[data-value=opening]'),null);assert.equal(x.q('[data-opening-pause-label]').hidden,false);
 let generated;x.w.testUI.setAPI(async(path,body)=>{if(path==='stories')return{id:'created-story',...body};if(body.fields[0].id==='audio_directed_script')return directedReply(body);generated=body;return {questions:[],revisions:[{id:'audio_plan',text:JSON.stringify({opening:{character_id:body.context.lines[0].character_id,text:'कहानी में आपका स्वागत है।'},segments:[{character_id:body.context.lines[0].character_id,text:'एक दिन एक बच्चा मदद करने निकला।'},{character_id:body.context.lines[0].character_id,text:'सीख यही है कि हमेशा मदद करो।'}]})}]};});await submit(x);
 assert.match(generated.context.instructions,/Reserve the final segment/);assert.match(generated.context.instructions,/selected script language/);assert.equal(x.q('[data-review-turn="0"] legend').textContent,'Opening');assert.equal(x.q('[data-review-turn="2"] legend').textContent,'Closing');
 input(x,'[data-review-turn="2"] textarea','आज की सीख है कि दूसरों की मदद करो।');await submit(x);assert.match(x.q('[name=summary]').value,/कहानी में आपका स्वागत है/);assert.match(x.q('[name=summary]').value,/आज की सीख/);
 const p=JSON.parse(x.q('[name=audio_preparation]').value);assert.equal(p.opening_instructions,'Welcome to the storybook.');assert.equal(p.closing_instructions,'End with the moral of the story.');
 x.q('#story-setup-form').requestSubmit();await tick();const audio=saved(x,'ecco-audio-draft:created-story');assert.equal(audio.opening_text,'कहानी में आपका स्वागत है।');assert.equal(audio.lines.at(-1).text,'आज की सीख है कि दूसरों की मदद करो।');assert.equal(audio.script_brief.closing_instructions,'End with the moral of the story.');assert.deepEqual(x.errors,[]);
});

test('Story save keeps its spinner inside the button, blocks duplicate submits and continues without a full workspace refresh',async t=>{
 for(const intent of ['podcast','animation']){
  const x=await ready(t,intent);input(x,'[name=title]','Save progress test');input(x,'[name=summary]','The reviewed story.');
  x.w.eval('window.refreshAttempts=0;refresh=()=>{window.refreshAttempts++;return new Promise(()=>{});};');
  let finish,count=0;x.w.testUI.setAPI(()=>{count++;return new Promise(resolve=>finish=resolve);});const form=x.q('#story-setup-form'),button=form.querySelector('[type=submit]');form.requestSubmit();await tick();
  assert.equal(button.textContent,'Saving Story…');assert.ok(button.querySelector('.generation-spinner'));assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(button.disabled,true);assert.equal(x.q('[data-story-status]').textContent,'');form.requestSubmit();assert.equal(count,1);
  finish({id:'saved-'+intent});await tick();assert.equal(button.isConnected,false);assert.equal(x.w.refreshAttempts,0);assert.equal(saved(x,'ecco-story-description:saved-'+intent).summary,'The reviewed story.');assert.deepEqual(x.errors,[]);
 }
});

test('Failed story saves restore the button and retain the draft for retry',async t=>{
 const x=await ready(t);input(x,'[name=title]','Keep my story');input(x,'[name=summary]','Keep my script.');const form=x.q('#story-setup-form'),button=form.querySelector('[type=submit]'),label=button.textContent;
 x.w.testUI.setAPI(async()=>{throw Error('Storage unavailable');});form.requestSubmit();await tick();assert.equal(button.textContent,label);assert.equal(button.getAttribute('aria-busy'),'false');assert.equal(button.disabled,false);assert.equal(button.querySelector('.generation-spinner'),null);assert.equal(form.elements.summary.value,'Keep my script.');assert.match(x.q('[data-story-status]').textContent,/Could not save story/);assert.deepEqual(x.errors,[]);
});
test('Upload is directly visible and Tone presets retain custom directions',async t=>{
 const x=await ready(t);mock(x);await open(x);assert.equal(x.q(dlg+' [data-upload]').closest('details'),null);await questions(x);
 const custom=x.q(dlg+' [data-value=tone]'),select=custom.closest('label').previousElementSibling.querySelector('select');assert.ok(select);assert.equal(select.value,'Custom');select.value='Playful';select.dispatchEvent(new x.w.Event('change',{bubbles:true}));assert.equal(custom.value,'Playful');assert.equal(custom.closest('label').hidden,true);
 select.value='Custom';select.dispatchEvent(new x.w.Event('change',{bubbles:true}));assert.equal(custom.closest('label').hidden,false);field(x,'tone','Warm, with gentle suspense');assert.equal(select.value,'Custom');await submit(x);await submit(x);await submit(x);assert.equal(x.q('[name=audio_tone]').value,'Warm, with gentle suspense');
});
test('Storybook review iterates only selected words, retains named sounds, saves the full preparation and opens Audio tabs',async t=>{
 const x=await ready(t,'audiobook'),calls=mock(x,{names:['Narrator','Merchant','Jinn']});await open(x);await review(x);
 assert.match(x.q('[data-sound-summary]').textContent,/1 sound cues/);
 const text=x.q('[data-review-text]');text.focus();text.setSelectionRange(0,6);text.dispatchEvent(new x.w.Event('select'));x.q('[data-improve-selection]').click();input(x,'[data-instructions]','Make these words more fun.');x.q('#audio-selection-ai form').requestSubmit();await tick();assert.equal(x.q('[data-replacement]').value,'Spoken improved');
 input(x,'[data-instructions]','Use simpler words.');x.q('#audio-selection-ai form').requestSubmit();await tick();assert.equal(x.q('[data-replacement]').value,'Spoken improved improved');x.q('#audio-selection-ai [data-apply]').click();assert.equal(text.value,'Spoken improved improved turn 1.');
 await submit(x);x.q('#story-setup-form').requestSubmit();await tick();const savedCall=calls.find(c=>c.path==='stories');assert.equal(savedCall.body.audio_preparation.sound_design.cues[0].name,'Jinn Arrival');assert.equal(savedCall.body.audio_preparation.cast.length,3);
 assert.ok(x.q('#audio-form'));assert.equal(x.q('[data-audio-tab=script]').getAttribute('aria-selected'),'true');assert.equal(x.q('#audio-progress-panel').hidden,true);x.q('[data-audio-tab=progress]').click();assert.equal(x.q('#audio-progress-panel').hidden,false);x.q('[data-audio-tab=review]').click();assert.equal(x.q('#audio-review-panel').hidden,false);
 const draft=saved(x,'ecco-audio-draft:created-story');assert.equal(draft.sound_design.cues[0].name,'Jinn Arrival');assert.equal(draft.speakers.length,3);assert.match(draft.lines[0].text,/improved improved/);assert.deepEqual(x.errors,[]);
});
