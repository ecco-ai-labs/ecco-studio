'use strict';
// Screen Play quality gate (owner request 2026-11-12): the last editing check before a recording is made.
// 1. Rules any script must meet, checked in code (no AI): one introduction near the start, turns that change
//    speaker in a conversation, no monologues, no speaker labels or cues inside spoken words, the 80-turn limit
//    for recordings with sound cues, and a length estimate at the story type's speaking pace.
// 2. An AI review that checks every turn answers the turn before it, fixes what fails, and adds the touches
//    that make it sound like real people talking (short reactions, laughs and pauses as acting directions,
//    never as spoken words). The revised script is checked against the same rules before it can pass.
(() => {
 const LIMIT=80,PASS=85;
 // Words per minute by story type: conversations run brisk, stories for children run slow.
 const PACE={podcast:155,interview:150,news:160,documentary:140,teaching:140,storybook:115,narrated:130,dramatized:135};
 const pace=type=>PACE[String(type||'').toLowerCase()]||145;
 const CONVERSATION=new Set(['podcast','interview','news','dramatized']);
 const parts=plan=>[...(plan?.opening?[plan.opening]:[]),...(plan?.segments||[])];
 const words=text=>String(text||'').trim().split(/\s+/).filter(Boolean).length;
 const INTRO=/\b(welcome (?:to|back)\b|thanks? for (?:joining|tuning in)|you'?re (?:listening|watching) to|i'?m [A-Z][a-z]+,? (?:and|here|your host))/i;

 // Rules checked in code. Each issue is {turn (1-based or null), severity:'block'|'warn', problem}.
 function checks(plan,cast,{storyType,sounds=0}={}){
  const list=parts(plan),issues=[],type=String(storyType||'').toLowerCase(),conversation=CONVERSATION.has(type)&&cast.length>1;
  const name=id=>cast.find(c=>c.id===id)?.name||'Someone';
  if(!list.length)return {issues:[{turn:null,severity:'block',problem:'The script is empty.'}],minutes:0,turns:0};
  // Sound cues are placed by speech turn, and a recording with sounds holds at most 80 turns; long recordings without sounds are fine.
  if(sounds&&list.length>LIMIT)issues.push({turn:null,severity:'block',problem:`${list.length} turns with sound cues: a recording with sounds takes at most ${LIMIT} turns. Merge short turns, remove the sounds, or split the episode.`});
  const intros=list.map((p,i)=>INTRO.test(p.text)?i:-1).filter(i=>i>=0);
  if(intros.length>1)issues.push({turn:intros[1]+1,severity:'block',problem:`The show is introduced more than once (turns ${intros.map(i=>i+1).join(', ')}). Keep one introduction at the start.`});
  else if(intros.length===1&&intros[0]>2&&conversation)issues.push({turn:intros[0]+1,severity:'block',problem:`The introduction comes at turn ${intros[0]+1}, after the conversation has started. Move it to the start.`});
  let run=1;
  list.forEach((p,i)=>{
   const n=words(p.text);
   if(/^\s*[^\s:]{1,40}\s*:/.test(p.text)&&cast.some(c=>p.text.trim().toLowerCase().startsWith(c.name.trim().toLowerCase()+':')))issues.push({turn:i+1,severity:'block',problem:`A speaker label is inside ${name(p.character_id)}'s spoken words.`});
   if(/[\[\]]/.test(p.text))issues.push({turn:i+1,severity:'block',problem:`Square brackets are inside ${name(p.character_id)}'s spoken words; directions belong in delivery.`});
   if(conversation&&n>130)issues.push({turn:i+1,severity:'warn',problem:`${name(p.character_id)} speaks ${n} words in one turn. Break it up with a reaction or question.`});
   if(i&&conversation){run=p.character_id===list[i-1].character_id?run+1:1;if(run===3)issues.push({turn:i+1,severity:'warn',problem:`${name(p.character_id)} speaks three turns in a row.`});}
  });
  const total=list.reduce((n,p)=>n+words(p.text),0),minutes=Math.round(total/pace(type)*10)/10;
  return {issues,minutes,turns:list.length,words:total};
 }

 const signature=plan=>JSON.stringify(parts(plan).map(p=>[p.character_id,p.text,p.performance?.emotion||'',p.performance?.direction||'']));

 function instruction(plan,cast,brief){
  const type=String(brief.story_type||'').toLowerCase(),conversation=CONVERSATION.has(type)&&cast.length>1;
  return [
   'You are the final script editor before this script is recorded with text-to-speech voices. Review it, fix it, and return the version to record.',
   'Story type: '+(brief.story_type||'story')+'. Audience: '+(brief.audience||'General audience')+'. Language: '+(brief.language||'English')+'. Genre: '+(brief.genre||'General')+'.',
   conversation?'This is a conversation. Rules: (1) exactly one introduction/welcome, in the first two turns; (2) EVERY turn must respond directly to the turn immediately before it - never to something said earlier, never re-introducing the topic or the guest; (3) speakers alternate naturally; no turn over 110 words - split long explanations with a short reaction or question from the other speaker; (4) facts, numbers and names from the script stay exactly as they are.':'Rules: (1) at most one introduction, at the start; (2) every passage follows from the one before; (3) facts, numbers and names stay exactly as they are.',
   'Make it sound like real people talking, without being silly: add short natural reactions as their own turns where they help (for example "Right.", "Wait - really?", "Ha, fair."; at most 8 words each, at most one in every four turns), let a speaker occasionally start with "So," "Well," or "Okay," and put laughs, sighs, smiles and pauses in performance.direction - NEVER as words in text.',
   'Pace: '+pace(type)+' words per minute; set performance.pause_before (seconds, 0 to 1.5) for natural breathing between turns, longer before a change of topic.',
   'Never put speaker names, colons used as labels, square brackets or stage directions in text.'+(brief.sounds?' Keep the total under '+LIMIT+' turns (this recording has sound cues).':' Do not drop content to shorten it.'),
   'Score the ORIGINAL script from 0 to 100 against these rules, list every problem you fixed with its original turn number, and return JSON in audio_script_review: {"score":number,"issues":[{"turn":number,"problem":string}],"opening":null,"segments":[{"character_id":string,"text":string,"performance":{"emotion":string,"direction":string,"pause_before":number}}]}. emotion must be one of '+(window.EccoAudioDirection?.emotions||['neutral']).join(', ')+'. Use only these character_id values: '+cast.map(c=>c.id+' ('+c.name+')').join(', ')+'.'
  ].join(' ');
 }

 // AI review: returns {plan, score, aiIssues, local, passed}. The caller decides whether to apply the plan.
 async function review({plan,cast,brief,request}){
  const text=instruction(plan,cast,brief||{});
  const result=await request('ai/enhance',{stage:'storyboard',mode:'generate',story_id:null,fields:[{id:'audio_script_review',text,max_length:24000}],
   context:{genre:brief?.genre||'',language:brief?.language||'English',lines:cast.map(c=>({...c,character_id:c.id})),summary:JSON.stringify({draft:plan}),instructions:text},review_only:false});
  const raw=result?.revisions?.find(r=>r.id==='audio_script_review')?.text;let revised;
  try{revised=JSON.parse(raw);}catch{throw Error('The script check returned an unreadable answer. Your script was not changed.');}
  const clean=window.EccoAudioScript.validatePlan({opening:revised.opening||null,segments:revised.segments},cast);
  const local=checks(clean,cast,{storyType:brief?.story_type,sounds:brief?.sounds||0});
  const score=Number.isFinite(revised.score)?Math.max(0,Math.min(100,Math.round(revised.score))):null;
  return {plan:clean,score,aiIssues:(Array.isArray(revised.issues)?revised.issues:[]).slice(0,30).map(i=>({turn:Number.isInteger(i?.turn)?i.turn:null,problem:String(i?.problem||'').slice(0,240)})).filter(i=>i.problem),
   local,passed:!local.issues.some(i=>i.severity==='block')};
 }

 window.EccoScriptReview={LIMIT,PASS,checks,review,signature,pace};
})();
