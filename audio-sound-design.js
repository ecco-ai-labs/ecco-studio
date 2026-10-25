'use strict';
(() => {
 const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const key=lines=>JSON.stringify(lines.map(l=>l.text));
 const kinds={effect:'Sound Effect',ambience:'Ambience',music:'Background Music'};
 const defaults=(kind='effect')=>({kind,name:'',duration:kind==='music'?20:5,compute:'cpu',description:'',asset_id:'',start:0,end:0,phrase:'',level_db:kind==='effect'?-14:-24,duck:kind!=='effect',loop:kind!=='effect',fade:kind==='effect'?.08:1});
 function validate(cues,lines,{assets=[],requireAssets=false}={}){
  if(!Array.isArray(cues)||cues.length>12)throw Error('Use up to 12 sound cues.');
  const names=new Set();return cues.map((c,index)=>{
   const name=String(c.name||c.description||kinds[c.kind]+' '+(index+1)).trim().slice(0,100);if(!name||names.has(name.toLowerCase()))throw Error('Give every sound cue a unique name.');names.add(name.toLowerCase());
   if(!c||!kinds[c.kind])throw Error('Choose Sound Effect, Ambience or Background Music.');
   if(!Number.isInteger(c.start)||!Number.isInteger(c.end)||c.start<0||c.end<c.start||c.end>=lines.length)throw Error('Choose a valid script passage for each sound cue.');
   const phrase=String(c.phrase||'').trim(),text=lines[c.start].text;
   if(phrase&&(!text.includes(phrase)||text.indexOf(phrase)!==text.lastIndexOf(phrase)))throw Error('The trigger phrase must occur exactly once in its selected passage.');
   if(!Number.isFinite(c.level_db)||c.level_db < -40||c.level_db > -3||!Number.isFinite(c.fade)||c.fade<0||c.fade>5)throw Error('Choose volume from −40 to −3 dB and fades from 0 to 5 seconds.');
   const id=String(c.asset_id||'');
   if(id&&!assets.some(a=>a.id===id))throw Error('A selected sound is no longer in Audio Library. Choose another file.');
   if(requireAssets&&!id)throw Error('Choose or upload an audio file for every sound cue before generating.');
   return {...defaults(c.kind),name,duration:Number(c.duration)||(c.kind==='music'?20:5),compute:['cpu','a100','b200'].includes(c.compute)?c.compute:'cpu',worker_id:typeof c.worker_id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(c.worker_id)?c.worker_id:'',description:String(c.description||'').trim().slice(0,600),asset_id:id,start:c.start,end:c.end,phrase,level_db:c.level_db,duck:!!c.duck,loop:!!c.loop,fade:c.fade};
  });
 }
 function prepare(plan,lines,assets){
  if(!plan?.enabled)return {lines};
  if(plan.speech_key!==key(lines))throw Error('The script changed. Review Sound Design and Apply before generating.');
  const cues=validate(plan.cues,lines,{assets,requireAssets:true});if(!cues.length)return {lines};
  const split=[],mapping=[];
  lines.forEach((line,index)=>{
   const cuts=[...new Set(cues.filter(c=>c.start===index&&c.phrase).map(c=>line.text.indexOf(c.phrase)+c.phrase.length))].sort((a,b)=>a-b);
   const map={start:split.length,ends:new Map()};let previous=0;
   for(const cut of [...new Set([...cuts,line.text.length])]){
    const text=line.text.slice(previous,cut).trim();if(text){split.push({...line,text,...(previous?{pause_before:0}:{})});map.ends.set(cut,split.length-1);}previous=cut;
   }
   map.end=split.length-1;mapping.push(map);
  });
  if(split.length>80)throw Error('The sound triggers need more than 80 speech segments. Reduce the cues or shorten the script.');
  const soundtrack=cues.map(c=>({kind:c.kind,description:c.description,asset_id:c.asset_id,start_line:c.phrase?mapping[c.start].ends.get(lines[c.start].text.indexOf(c.phrase)+c.phrase.length):mapping[c.start].start,start_edge:c.phrase?'end':'start',end_line:mapping[c.end].end,level_db:c.level_db,duck:c.duck,loop:c.loop,fade:c.fade}));
  for(const c of soundtrack)if(c.kind!=='effect'&&c.start_edge==='end'&&c.start_line===c.end_line)throw Error('Background audio must cover some spoken text after its trigger. Choose a later ending passage.');
  return {lines:split,soundtrack,sound_design_version:1};
 }
 function planLines(plan){return [...(plan.opening?[{text:plan.opening.text.trim()}]:[]),...plan.segments.flatMap(p=>window.EccoAudioScript.split(p.text).map(text=>({text})))];}
 async function suggest({lines,brief={},direction='',assets=[]}){
     const instruction='Suggest sparse, audience-appropriate sound design for this spoken script. Return sound_cues as JSON only: {"cues":[{"name":"unique short English sound name","kind":"effect|ambience|music","duration":5,"description":"English sound direction","asset_id":"existing ID or empty string","start":0,"end":0,"phrase":"exact unique spoken words or empty","level_db":-24,"duck":true,"loop":true,"fade":1}]}. Indices refer to the supplied passages, starting at 0. Use at most 12 cues. Effects are short punctuation (for example an appearance); ambience/music cover only the relevant scene, never the whole recording by default. Use an exact phrase to trigger AFTER those words; empty means passage start. End is the last covered passage. Music is instrumental with no vocals. Keep narration intelligible. Use conservative volume: -14 dB for effects, -24 dB for beds; soften beds during speech, loop beds. Do not invent events, mix in source-analysis notes, or put directions in spoken words. For children avoid startling or harsh effects. Choose an existing asset ID only if its label clearly matches; otherwise leave blank for the user to generate or choose later. Supply a concrete English generation description (maximum 500 characters). Give every cue a unique short name. Duration: effects/ambience 1–30 seconds, instrumental music 10–60 seconds. Do not pretend you generated audio. Genre: '+(brief.genre||'')+'. Audience: '+(brief.audience||'General audience')+'. User direction: '+direction;
     const result=await api('ai/enhance',{stage:'storyboard',mode:'generate',story_id:null,fields:[{id:'sound_cues',text:instruction,max_length:14000}],context:{instructions:instruction,summary:JSON.stringify({passages:lines.map((l,index)=>({index,text:l.text})),audio_library:assets.slice(0,100).map(a=>({id:a.id,title:a.title}))})},review_only:false});

  if(result.questions?.length)throw Error(result.questions.join(' '));const raw=result.revisions?.find(r=>r.id==='sound_cues')?.text;if(!raw)throw Error('AI returned no sound cues.');return validate(JSON.parse(raw).cues,lines,{assets});
 }
 function mount({root,getPlan,setPlan,getLines,getBrief,mediaURL}){
  if(!root||root.querySelector('[data-sound-design]'))return;
  const section=document.createElement('section');section.className='form';section.dataset.soundDesign='';section.innerHTML='<div class="section-head"><h3>Sound Design</h3><button type="button" class="secondary" data-open-sounds>Music &amp; Effects</button></div><p class="help" data-sound-summary></p>';root.append(section);
  const summary=()=>{const p=getPlan();section.querySelector('[data-sound-summary]').textContent=p?.enabled&&p.cues?.length?p.cues.length+' sound cues · '+p.cues.filter(c=>c.asset_id).length+' audio files selected':'Add background music, ambience and timed sound effects.';};summary();
  section.querySelector('button').onclick=()=>{
   let lines;try{lines=getLines();}catch(error){notice(error.message,true);return;}
   const story=activeStory,base=key(lines),original=JSON.stringify(getPlan()),opener=section.querySelector('button');let local=structuredClone(getPlan()||{}),closed=false,busy=false,previewEpoch=0;
   local.cues||=[];const assets=()=>window.EccoAudioLibrary?.items()||[];
   const d=document.createElement('dialog');d.id='audio-sound-design';d.className='generation-dialog';d.setAttribute('aria-label','Sound Design');
   d.innerHTML='<form class="form"><div class="section-head"><h2>Sound Design</h2><button type="button" class="secondary" data-close aria-label="Close">×</button></div><label class="workspace-label-option"><input type="checkbox" data-enabled><span>Include music and effects</span></label><label>Sound Direction<textarea data-direction rows="3" maxlength="2000" placeholder="A brief magical sound when the Jinn appears; quiet Mediterranean-inspired instrumental music during the desert journey."></textarea></label><button type="button" class="secondary" data-suggest>Suggest Cues with AI</button><p class="help">Give each sound a unique name and description. Generate a new file, choose from Audio Library, or upload audio. Background tracks can soften automatically during speech. Effects play once, up to 30 seconds.</p><div class="form" data-cues></div><button type="button" class="secondary" data-add>Add Sound Cue</button><p role="status" data-design-status></p><button type="submit">Apply</button></form>';
   document.body.append(d);const q=s=>d.querySelector(s),status=q('[data-design-status]');q('[data-enabled]').checked=!!local.enabled;q('[data-direction]').value=local.direction||'';
   const current=()=>{if(closed||!d.open||activeStory!==story||!root.isConnected||key(getLines())!==base||JSON.stringify(getPlan())!==original)throw Error('The script or sound settings changed. Reopen Sound Design to use the current version.');};
   const passageOptions=value=>lines.map((l,i)=>'<option value="'+i+'" '+(i===value?'selected':'')+'>'+escape(l.text.slice(0,85))+(l.text.length>85?'…':'')+'</option>').join('');
   const refreshAssets=()=>{
    const available=assets();
    q('[data-cues]').querySelectorAll('[data-cue]').forEach(box=>{
     const cue=local.cues[Number(box.dataset.cue)],select=box.querySelector('[data-field=asset_id]');
     select.replaceChildren(new Option('Choose an audio file',''),...available.map(a=>new Option(a.title||'Audio',a.id)));
     select.value=cue.asset_id||'';
    });
   };
   const draw=()=>{
    q('[data-cues]').innerHTML=local.cues.map((c,i)=>'<fieldset class="form" data-cue="'+i+'"><div class="section-head"><label>Type<select data-field="kind">'+Object.entries(kinds).map(([id,name])=>'<option value="'+id+'" '+(c.kind===id?'selected':'')+'>'+name+'</option>').join('')+'</select></label><button type="button" class="secondary" data-remove aria-label="Remove sound cue">Remove</button></div><label>Sound Name<input data-field="name" maxlength="100" value="'+escape(c.name||'')+'"></label><label>Sound Description<textarea rows="2" maxlength="500" data-field="description">'+escape(c.description)+'</textarea></label><label>Audio Library<select data-field="asset_id"><option value="">Choose an audio file</option>'+assets().map(a=>'<option value="'+escape(a.id)+'" '+(a.id===c.asset_id?'selected':'')+'>'+escape(a.title||'Audio')+'</option>').join('')+'</select></label><div class="row"><button type="button" class="secondary" data-upload>Upload Audio</button><button type="button" class="secondary" data-preview>Preview Sound</button></div><audio controls hidden preload="none"></audio><label>Start at Passage<select data-field="start">'+passageOptions(c.start)+'</select></label><label>After These Words (Optional)<input data-field="phrase" value="'+escape(c.phrase)+'" maxlength="500" placeholder="Exact words in this passage; leave blank for its beginning."></label>'+(c.kind==='effect'?'':'<label>End after Passage<select data-field="end">'+passageOptions(c.end)+'</select></label>')+'<div class="generation-filter-row"><label>Volume (dB)<input type="number" min="-40" max="-3" step="1" data-field="level_db" value="'+c.level_db+'"></label><label>Fade In / Out (Seconds)<input type="number" min="0" max="5" step="0.01" data-field="fade" value="'+c.fade+'"></label></div><label class="workspace-label-option"><input type="checkbox" data-field="duck" '+(c.duck?'checked':'')+'><span>Soften during speech</span></label>'+(c.kind==='effect'?'':'<label class="workspace-label-option"><input type="checkbox" data-field="loop" '+(c.loop?'checked':'')+'><span>Loop until the ending passage</span></label>')+'</fieldset>').join('');
    q('[data-add]').disabled=busy||local.cues.length>=12;
    q('[data-cues]').querySelectorAll('[data-cue]').forEach(box=>{
     const index=Number(box.dataset.cue),cue=local.cues[index];
     box.oninput=e=>{const f=e.target.dataset.field;if(!f)return;cue[f]=['start','end','level_db','fade'].includes(f)?Number(e.target.value):['duck','loop'].includes(f)?e.target.checked:e.target.value;if(f==='start'&&(cue.end<cue.start||cue.kind==='effect'))cue.end=cue.start;};
     box.onchange=e=>{box.oninput(e);if(e.target.dataset.field==='kind'){Object.assign(cue,{...defaults(cue.kind),name:cue.name,description:cue.description,asset_id:cue.asset_id,start:cue.start,end:Math.max(cue.end,cue.start),phrase:cue.phrase});draw();}};
     window.EccoSoundGeneration?.mount({box,cue,valid:current,changed:()=>{q('[data-enabled]').checked=true;refreshAssets();status.textContent='Sound saved to Audio Library and selected. Preview it, then Apply.';}});
     box.querySelector('[data-remove]').onclick=()=>{local.cues.splice(index,1);draw();};
     box.querySelector('[data-upload]').onclick=()=>window.EccoAudioLibrary?.upload(asset=>{if(!closed&&local.cues.includes(cue)){cue.asset_id=asset.id;draw();}});
     box.querySelector('[data-preview]').onclick=async()=>{const token=++previewEpoch;try{if(!cue.asset_id)throw Error('Choose an audio file first.');mediaURL||=window.EccoStorage?.mediaURL;if(!mediaURL)throw Error('Connect workspace storage to preview sounds.');const url=await mediaURL(cue.asset_id);if(closed||token!==previewEpoch||!box.isConnected)return;const parsed=new URL(url);if(parsed.protocol!=='https:'&&!(parsed.protocol==='blob:'&&parsed.origin===location.origin))throw Error('Could not open this audio.');d.querySelectorAll('audio').forEach(a=>a.pause());const player=box.querySelector('audio');player.src=url;player.hidden=false;status.textContent='Press Play to preview the sound file.';}catch(error){status.textContent=error.message;}};
    });
   };
   q('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>{closed=true;previewEpoch++;d.querySelectorAll('audio').forEach(a=>a.pause());d.remove();if(opener.isConnected)opener.focus();},{once:true});
   q('[data-add]').onclick=()=>{if(local.cues.length<12){local.cues.push(defaults());draw();}};
   q('[data-suggest]').onclick=async()=>{
    const button=q('[data-suggest]');if(busy)return;const version=JSON.stringify(local.cues),direction=q('[data-direction]').value;
    try{current();if(!window.EccoAI?.enabled||!window.EccoStorage?.ready)throw Error('Connect OpenAI and workspace storage to suggest sound cues.');busy=true;button.disabled=true;button.setAttribute('aria-busy','true');button.innerHTML='<span class="generation-spinner" aria-hidden="true"></span>Suggesting Cues…';
     const cues=await suggest({lines,brief:getBrief(),direction,assets:assets()});
     current();if(JSON.stringify(local.cues)!==version||q('[data-direction]').value!==direction)throw Error('Your sound cues changed while AI was working. Your edits are preserved; suggest again if needed.');local.cues=cues;q('[data-enabled]').checked=true;draw();status.textContent='Review names and timing; generate or choose an audio file for each cue, then Apply.';
    }catch(error){if(!closed)status.textContent=error.message;}finally{busy=false;if(!closed){button.disabled=false;button.setAttribute('aria-busy','false');button.textContent='Suggest Cues with AI';q('[data-add]').disabled=local.cues.length>=12;}}
   };
   q('form').onsubmit=e=>{e.preventDefault();if(busy)return;try{current();const cues=validate(local.cues,lines,{assets:assets()});setPlan({enabled:q('[data-enabled]').checked,direction:q('[data-direction]').value.trim(),cues,speech_key:base});summary();d.close();}catch(error){status.textContent=error.message;}};
   draw();d.showModal();q('[data-direction]').focus();if(local.speech_key&&local.speech_key!==base)status.textContent='The script changed. Review cue passages and trigger words before Apply.';
  };
 }
 window.EccoSoundDesign={mount,prepare,validate,key,suggest,planLines};
})();
