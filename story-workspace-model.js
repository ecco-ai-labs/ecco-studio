'use strict';
/* Data-only helpers shared by the three-tab workspace and its regression tests. */
(function(root){
 const copy=value=>JSON.parse(JSON.stringify(value));
 // Keep established IDs so saved stories, news research and downstream workflows remain compatible.
 const types=[['storybook','Narrated Story'],['audio-drama','Dramatized Story'],['podcast','Podcast'],['interview','Interview'],['news','News Report'],['documentary','Documentary'],['teaching','Lesson / Tutorial'],['training','Training'],['marketing','Advertisement'],['presentation','Presentation'],['ambient','Music / Ambient'],['custom','Other']];
 const genres=['Comedy','Adventure','Action','Drama','Fantasy','Mystery','Thriller','Horror','Romance','Science Fiction','History','Biography','Business','Science & Technology','Sports','Nature','Other'];
 const legacyTypes={audiobook:'Audiobook',animation:'Animation','book-adaptation':'Book Adaptation',social:'Social Story',dubbing:'Localization / Dubbing',repurpose:'Repurpose Content'};
 function typeLabel(value){return types.find(([id])=>id===value)?.[1]||legacyTypes[value]||value;}
 function typeOptions(current){return current&&!types.some(([id])=>id===current)?[...types,[current,typeLabel(current)]]:types;}
 function fresh({type='',output=''}={}){return {version:1,title:'',output,type,genre:'',audience:'All ages',language:'English',location:'',recurrence:'',script:'',brief:'',cast:[],castCustomized:false,scenes:[],source:{text:'',name:'',pages:[]},tab:0,view:'',applied:{},plan:null};}
 function migrate(saved={},board={},audio={}){
  if(saved.simple_workspace)return copy(saved.simple_workspace);
  let p={};try{p=typeof saved.audio_preparation==='string'?JSON.parse(saved.audio_preparation):saved.audio_preparation||{};}catch{}
  const cast=audio.speakers?.length?audio.speakers:p.cast||[];
  const parts=audio.lines?.filter(l=>l.text?.trim()).map(l=>({character_id:l.speaker_id,text:l.text,performance:l.performance}));
  const plan=parts?.length?{opening:audio.opening_text?{character_id:audio.opening_speaker||cast[0]?.id,text:audio.opening_text,performance:audio.opening_performance}:null,segments:parts}:p.plan;
  const script=plan?.segments?.length?transcript(plan,cast):board.story||saved.sourceText||saved.summary||'';
  return {version:1,title:saved.title||board.title||'',output:saved.story_format||board.story_format||'',type:saved.workflow_id||'',genre:saved.genre||'',audience:saved.audio_audience||p.audience||'All ages',language:saved.audio_language||p.language||'English',location:'',recurrence:'once',script,brief:'',cast:copy(cast),castCustomized:!!cast.length,scenes:copy(board.scenes||[]),source:{text:saved.sourceText||p.source_text||'',name:p.source_name||'',pages:p.source_pages||[]},tab:0,view:'',applied:{},plan:plan||null};
 }
 // Script text ⇄ plan. Square brackets are directions: they are kept apart from the spoken words and never read aloud.
 // A paragraph without a name continues the same speaker; [Sound: …] on its own line is a background sound.
 function transcript(plan,cast){
  const name=id=>cast.find(c=>c.id===id)?.name||'Narrator',tag=d=>d?'['+d+'] ':'',out=[],sounds=[...(plan.sounds||[])].sort((a,b)=>a.at-b.at);
  [...(plan.opening?[plan.opening]:[]),...(plan.segments||[])].forEach((p,i)=>{
   while(sounds.length&&sounds[0].at<=i)out.push('[Sound: '+sounds.shift().name+']');
   const dir=p.performance?.direction||'',after=p.performance?.after?' ['+p.performance.after+']':'',words=p.text.trim()+after;
   if(p.join==='inline'&&out.length)out[out.length-1]+=' '+tag(dir)+words;
   else if(p.join==='para'&&out.length)out.push(tag(dir)+words);
   else out.push(name(p.character_id)+(dir?' ['+dir+']':'')+': '+words);
  });
  for(const sound of sounds)out.push('[Sound: '+sound.name+']');
  return out.join('\n\n');
 }
 function validateCast(cast){
  if(!Array.isArray(cast)||cast.length<1||cast.length>20)throw Error('Choose between 1 and 20 characters.');
  if(cast.some(c=>!c.id||!c.name?.trim()||c.name.length>60))throw Error('Give every character a name, up to 60 characters.');
  if(new Set(cast.map(c=>c.id)).size!==cast.length||new Set(cast.map(c=>c.name.trim().toLowerCase())).size!==cast.length)throw Error('Use a different name for each character.');
 }
 function parseScript(text,cast,previous){
  validateCast(cast);const names=new Map(cast.map(c=>[c.name.trim().toLowerCase(),c.id]));
  const heading=/^\s*(?:chapter|part|episode|section)\s*(?:[0-9]+|[ivxlc]+)\s*(?:[:.\-–—][^\n]{0,70})?\s*(?:\n|$)/i;
  const old=[...(previous?.opening?[previous.opening]:[]),...(previous?.segments||[])],parts=[],sounds=[];let who=null;
  // A line that starts with a cast name and a colon (or is a [Sound: …] line) starts a new turn even without a blank
  // line before it: AI-written and pasted scripts often put one turn per line, and every turn was read by one voice.
  const turnStart=line=>{const m=line.match(/^\s*([^:\[\]\n]{1,60}?)\s*(\[[^\]]*\])?\s*:/);return !!(m&&names.has(m[1].trim().toLowerCase()))||/^\s*\[\s*sound\s*:[^\]]*\]\s*$/i.test(line);};
  const spaced=String(text||'').replace(/\r\n?/g,'\n').split('\n').map((line,i,all)=>i&&all[i-1].trim()&&turnStart(line)?'\n'+line:line).join('\n');
  for(const paragraph of spaced.trim().split(/\n\s*\n/).map(p=>p.replace(heading,'').trim()).filter(Boolean)){
   const sound=paragraph.match(/^\[\s*sound\s*:\s*([^\]]+)\]$/i);if(sound){sounds.push({at:parts.length,name:sound[1].trim().slice(0,160)});continue;}
   const head=paragraph.match(/^([^:\[\]\n]{1,60}?)\s*(\[[^\]]*\])?\s*:\s*/),id=head?names.get(head[1].trim().toLowerCase()):null;
   // “Bob: …” where Bob isn't in the cast is a typo, not words for the previous speaker.
   if(head&&!id&&(head[2]||/^\p{Lu}[\p{L}'’.\-]*(?: \p{Lu}[\p{L}'’.\-]*){0,2}$/u.test(head[1].trim())))throw Error('“'+head[1].trim()+'” is not in your cast. Add the character, or fix the name.');
   if(id)who=id;else if(!who){if(cast.length>1)throw Error('Start the first paragraph with a character name followed by a colon, for example “'+cast[0].name+': …”.');who=cast[0].id;}
   let direction=id&&head[2]?head[2].slice(1,-1).trim():'',fresh=!!direction,join=id?'':'para',body=id?paragraph.slice(head[0].length):paragraph;
   for(const piece of body.split(/(\[[^\]]*\])/)){
    if(/^\[[^\]]*\]$/.test(piece)){const d=piece.slice(1,-1).trim();direction=fresh&&direction?direction+', '+d:d;fresh=true;continue;}
    // Words only: stray brackets are dropped and parentheses become pauses, so nothing can be read as an instruction.
    const words=piece.replace(/[\[\]]/g,'').replace(/([.!?])\s*\(\s*/g,'$1 ').replace(/^\s*\(\s*/,'').replace(/\s*\(\s*/g,', ').replace(/\s*\)\s*(?=[.!?,;:]|$)/g,'').replace(/\s*\)\s*/g,', ').replace(/,\s*([.!?,;:])/g,'$1').replace(/^,\s*|,\s*$/g,'').replace(/\s+/g,' ').trim();if(!words)continue;
    const part={character_id:who,text:words};if(join)part.join=join;if(direction)part.performance={direction:direction.slice(0,300)};
    const match=old.find(p=>p.character_id===part.character_id&&p.text===part.text);
    if(match?.performance){const keep=copy(match.performance);delete keep.after;part.performance={...keep,...(direction?{direction:direction.slice(0,300)}:{})};}
    parts.push(part);join='inline';fresh=false;direction='';
   }
   const trailing=body.match(/\[([^\]]*)\]\s*$/);if(trailing&&parts.length&&fresh){const last=parts[parts.length-1];last.performance={direction:'natural',...(last.performance||{}),after:trailing[1].trim().slice(0,120)};}
  }
  if(!parts.length)throw Error('Write a story or generate one with AI first.');
  const keepOpening=previous?.opening&&parts[0].character_id===previous.opening.character_id&&parts[0].text===previous.opening.text;
  const plan={opening:keepOpening?parts.shift():null,segments:parts};if(keepOpening)for(const s of sounds)s.at=Math.max(0,s.at-1);
  if(sounds.length)plan.sounds=sounds;return plan;
 }
 function validateProposal(value,existing,castOnly=false){
  const cast=value?.characters;validateCast(cast);
  const allowed=['id','name','role','gender','age_group','nationality','dialect','style','personality','appearance','language','emotion','delivery','voice','reference_id'];
  const cleanCast=cast.map(c=>Object.fromEntries(allowed.filter(k=>typeof c[k]==='string').map(k=>[k,c[k].slice(0,k==='appearance'||k==='delivery'?1000:160)])));
  if(castOnly)return {cast:cleanCast,reason:String(value.reason||'').slice(0,1000)};
  const ids=new Set(cleanCast.map(c=>c.id)),segments=value.segments;
  if(!Array.isArray(segments)||!segments.length||segments.some(s=>!ids.has(s.character_id)||typeof s.text!=='string'||!s.text.trim()))throw Error('AI returned an incomplete story. Your current story is unchanged.');
  const plan={opening:null,segments:segments.map(s=>({character_id:s.character_id,text:s.text.trim()}))};
  const script=transcript(plan,cleanCast);
  if(existing.output==='audio')parseScript(script,cleanCast);
  const scenes=Array.isArray(value.scenes)?value.scenes.slice(0,60).map((s,i)=>({title:String(s.title||'Scene '+(i+1)).slice(0,160),narration:String(s.narration||'').slice(0,4000),motion:String(s.motion||'').slice(0,1800),seconds:Math.min(10,Math.max(1,Number(s.seconds)||3)),image_id:''})):[];
  return {cast:cleanCast,plan,script,scenes,reason:String(value.reason||'').slice(0,1000)};
 }
 // Assign voices without rewriting any applied source words or their order.
 function sourcePlan(source,cast,segments){
  validateCast(cast);
  if(!segments)return parseScript(source,cast);
  const ids=new Set(cast.map(c=>c.id)),names=new Set(cast.map(c=>c.name.trim().toLowerCase()));
  if(!Array.isArray(segments)||!segments.length||segments.some(s=>!ids.has(s.character_id)||typeof s.text!=='string'||!s.text.trim()))throw Error('AI could not assign the source to valid speakers. Your text is unchanged; retry character detection.');
  const words=String(source).split(/\n\s*\n/).map(p=>{const i=p.indexOf(':');return i>=0&&names.has(p.slice(0,i).trim().toLowerCase())?p.slice(i+1):p;}).join(' ');
  const normalize=text=>text.replace(/\s+/g,' ').trim();
  if(normalize(segments.map(s=>s.text).join(' '))!==normalize(words))throw Error('AI changed source words while assigning speakers. Your text is unchanged; retry character detection.');
  return {opening:null,segments:segments.map(s=>({character_id:s.character_id,text:s.text.trim()}))};
 }
 function signature(data,kind){
  const common={script:data.script,cast:data.cast,language:data.language};
  return JSON.stringify(kind==='audio'?{...common,type:data.type,script:data.audioScript||data.script,genre:data.genre,audience:data.audience,location:data.location}:kind==='image'?{script:data.script,cast:data.cast.map(c=>({name:c.name,appearance:c.appearance,nationality:c.nationality,reference_id:c.reference_id}))}:{script:data.script,scenes:data.scenes,cast:data.cast.map(c=>({name:c.name,appearance:c.appearance,reference_id:c.reference_id}))});
 }
 // Keep references, timing and camera edits when the same scene survives a script edit.
 function reconcileScenes(next,previous){return next.map((s,i)=>{const old=previous.find(p=>p.narration===s.narration&&p.motion===s.motion);return old?{...s,...old,title:s.title,image_id:old.image_id||s.image_id||''}:{...s,image_id:s.image_id||''};});}
 const api={types,genres,typeLabel,typeOptions,fresh,migrate,transcript,validateCast,parseScript,sourcePlan,validateProposal,signature,reconcileScenes};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EccoStoryWorkspaceModel=api;
})(typeof window==='undefined'?globalThis:window);
