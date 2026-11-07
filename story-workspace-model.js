'use strict';
/* Data-only helpers shared by the three-tab workspace and its regression tests. */
(function(root){
 const copy=value=>JSON.parse(JSON.stringify(value));
 const types=[['storybook','Storybook'],['audiobook','Audiobook'],['podcast','Podcast'],['news','News'],['audio-drama','Audio Drama'],['documentary','Documentary'],['animation','Animation'],['book-adaptation','Book Adaptation'],['teaching','Teaching Series'],['training','Training Series'],['marketing','Marketing'],['social','Social Story'],['presentation','Presentation'],['ambient','Music / Ambient'],['dubbing','Localization / Dubbing'],['repurpose','Repurpose Content'],['custom','Other']];
 function fresh({type='',output=''}={}){return {version:1,title:'',output,type,genre:'',audience:'',language:'',location:'',recurrence:'',script:'',brief:'',cast:[],castCustomized:false,scenes:[],source:{text:'',name:'',pages:[]},tab:0,view:'',applied:{},plan:null};}
 function migrate(saved={},board={},audio={}){
  if(saved.simple_workspace)return copy(saved.simple_workspace);
  let p={};try{p=typeof saved.audio_preparation==='string'?JSON.parse(saved.audio_preparation):saved.audio_preparation||{};}catch{}
  const cast=audio.speakers?.length?audio.speakers:p.cast||[];
  const parts=audio.lines?.filter(l=>l.text?.trim()).map(l=>({character_id:l.speaker_id,text:l.text,performance:l.performance}));
  const plan=parts?.length?{opening:audio.opening_text?{character_id:audio.opening_speaker||cast[0]?.id,text:audio.opening_text,performance:audio.opening_performance}:null,segments:parts}:p.plan;
  const script=plan?.segments?.length?transcript(plan,cast):board.story||saved.sourceText||saved.summary||'';
  return {version:1,title:saved.title||board.title||'',output:saved.story_format||board.story_format||'',type:saved.workflow_id||'',genre:saved.genre||'',audience:saved.audio_audience||p.audience||'All ages',language:saved.audio_language||p.language||'English',location:'',recurrence:'once',script,brief:'',cast:copy(cast),castCustomized:!!cast.length,scenes:copy(board.scenes||[]),source:{text:saved.sourceText||p.source_text||'',name:p.source_name||'',pages:p.source_pages||[]},tab:0,view:'',applied:{},plan:plan||null};
 }
 function transcript(plan,cast){return [...(plan.opening?[plan.opening]:[]),...(plan.segments||[])].map(p=>(cast.find(c=>c.id===p.character_id)?.name||'Narrator')+': '+p.text).join('\n\n');}
 function validateCast(cast){
  if(!Array.isArray(cast)||cast.length<1||cast.length>20)throw Error('Choose between 1 and 20 characters.');
  if(cast.some(c=>!c.id||!c.name?.trim()||c.name.length>60))throw Error('Give every character a name, up to 60 characters.');
  if(new Set(cast.map(c=>c.id)).size!==cast.length||new Set(cast.map(c=>c.name.trim().toLowerCase())).size!==cast.length)throw Error('Use a different name for each character.');
 }
 function parseScript(text,cast,previous){
  validateCast(cast);const names=new Map(cast.map(c=>[c.name.trim().toLowerCase(),c.id]));
  const parts=String(text||'').trim().split(/\n\s*\n/).filter(Boolean).map(paragraph=>{
   const i=paragraph.indexOf(':'),id=i>=0?names.get(paragraph.slice(0,i).trim().toLowerCase()):null;
   if(!id&&cast.length>1)throw Error('Start each spoken turn with a character name followed by a colon, and separate turns with a blank line.');
   const words=id?paragraph.slice(i+1).trim():paragraph.trim();if(!words)throw Error('Each spoken turn needs some text.');
   const part={character_id:id||cast[0].id,text:words};
   const old=[...(previous?.opening?[previous.opening]:[]),...(previous?.segments||[])].find(p=>p.character_id===part.character_id&&p.text===part.text);
   if(old?.performance)part.performance=copy(old.performance);return part;
  });
  if(!parts.length)throw Error('Write a story or generate one with AI first.');
  if(parts.length>80||parts.reduce((n,p)=>n+p.text.length,0)>4000)throw Error('Keep each audio script within 4,000 spoken characters and 80 turns. Use another chapter for longer stories.');
  const keepOpening=previous?.opening&&parts[0].character_id===previous.opening.character_id&&parts[0].text===previous.opening.text;
  return {opening:keepOpening?parts.shift():null,segments:parts};
 }
 function validateProposal(value,existing,castOnly=false){
  const cast=value?.characters;validateCast(cast);
  const allowed=['id','name','role','gender','age_group','nationality','dialect','style','appearance','language','emotion','delivery','voice','reference_id'];
  const cleanCast=cast.map(c=>Object.fromEntries(allowed.filter(k=>typeof c[k]==='string').map(k=>[k,c[k].slice(0,k==='appearance'||k==='delivery'?1000:160)])));
  if(castOnly)return {cast:cleanCast,reason:String(value.reason||'').slice(0,1000)};
  const ids=new Set(cleanCast.map(c=>c.id)),segments=value.segments;
  if(!Array.isArray(segments)||!segments.length||segments.length>80||segments.some(s=>!ids.has(s.character_id)||typeof s.text!=='string'||!s.text.trim()))throw Error('AI returned an incomplete story. Your current story is unchanged.');
  const plan={opening:null,segments:segments.map(s=>({character_id:s.character_id,text:s.text.trim()}))};
  const script=transcript(plan,cleanCast);if(script.length>20000)throw Error('The AI story is too long. Request a shorter chapter.');
  if(existing.output==='audio')parseScript(script,cleanCast);
  const scenes=Array.isArray(value.scenes)?value.scenes.slice(0,60).map((s,i)=>({title:String(s.title||'Scene '+(i+1)).slice(0,160),narration:String(s.narration||'').slice(0,4000),motion:String(s.motion||'').slice(0,1800),seconds:Math.min(10,Math.max(1,Number(s.seconds)||3)),image_id:''})):[];
  return {cast:cleanCast,plan,script,scenes,reason:String(value.reason||'').slice(0,1000)};
 }
 function signature(data,kind){
  const common={script:data.script,cast:data.cast,language:data.language};
  return JSON.stringify(kind==='audio'?{...common,script:data.audioScript||data.script,genre:data.genre,audience:data.audience,location:data.location}:kind==='image'?{script:data.script,cast:data.cast.map(c=>({name:c.name,appearance:c.appearance,nationality:c.nationality,reference_id:c.reference_id}))}:{script:data.script,scenes:data.scenes,cast:data.cast.map(c=>({name:c.name,appearance:c.appearance,reference_id:c.reference_id}))});
 }
 // Keep references, timing and camera edits when the same scene survives a script edit.
 function reconcileScenes(next,previous){return next.map((s,i)=>{const old=previous.find(p=>p.narration===s.narration&&p.motion===s.motion);return old?{...s,...old,title:s.title,image_id:old.image_id||s.image_id||''}:{...s,image_id:s.image_id||''};});}
 const api={types,fresh,migrate,transcript,validateCast,parseScript,validateProposal,signature,reconcileScenes};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EccoStoryWorkspaceModel=api;
})(typeof window==='undefined'?globalThis:window);
