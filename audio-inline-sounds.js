'use strict';
// Sound assignments live beside the spoken turns; AI text editing is unchanged.
(()=>{
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function mount({root,getPlan,setPlan,getLines,getRanges,getCompute,mediaURL,forceHost}){
  if(!root)return;
  let lines;try{lines=getLines();}catch{return;}
  const ranges=getRanges(),assets=()=>window.EccoAudioLibrary?.items()||[];
  const plan=getPlan()||{},base=window.EccoSoundDesign.key(lines);
  let warning=root.querySelector('[data-inline-sound-warning]');
  if(!warning){warning=document.createElement('div');warning.dataset.inlineSoundWarning='';warning.className='form';root.querySelector('[data-final-script]')?.prepend(warning);}
  const stale=plan.enabled&&plan.cues?.length&&plan.speech_key!==base;
  if(warning.dataset.stale!==String(!!stale)){
   warning.dataset.stale=String(!!stale);warning.replaceChildren();
   if(stale){const note=document.createElement('p');note.className='help';note.textContent='The script changed. Check the sound cues below, then Apply Sound Timing.';const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Apply Sound Timing';button.onclick=()=>{try{window.EccoSoundDesign.validate(getPlan().cues,getLines(),{assets:assets()});setPlan({...getPlan(),speech_key:window.EccoSoundDesign.key(getLines())});mount({root,getPlan,setPlan,getLines,getRanges,getCompute,mediaURL});}catch(error){note.textContent=error.message;}};warning.append(note,button);}
  }
  root.querySelectorAll('[data-final-turn-row]').forEach(row=>{
   const index=Number(row.dataset.finalTurnRow),range=ranges[index],host=row.querySelector('[data-turn-sounds]');if(!range||!host)return;
   const cues=(getPlan()?.cues||[]).filter(c=>c.start>=range.start&&c.start<=range.end),signature=JSON.stringify([cues,base,assets().map(a=>[a.id,a.title])]);
   if(host!==forceHost&&(host.dataset.signature===signature||host.contains(document.activeElement))||host.querySelector('[data-generate-sound][aria-busy=true]'))return;
   const opened=new Set([...host.querySelectorAll('[data-inline-cue][open]')].map(b=>b.dataset.inlineCue));
   host.dataset.signature=signature;host.querySelectorAll('audio').forEach(a=>a.pause());host.replaceChildren();
   const persist=()=>{setPlan({...getPlan(),cues:[...getPlan().cues]});host.dataset.signature='';};
   for(const cue of cues){
    const box=document.createElement('details');box.className='audio-inline-cue';box.dataset.inlineCue=cue.name;box.open=opened.has(cue.name);
    box.innerHTML='<summary>'+esc(cue.name)+' · '+(cue.asset_id?'Ready':'Will generate')+'</summary><div class="form"><p class="help">'+(cue.phrase?'After “'+esc(cue.phrase)+'”':'At the start of this passage')+'</p><label>Sound Description<textarea rows="2" maxlength="500" data-field="description">'+esc(cue.description)+'</textarea></label><label>Audio Library<select data-inline-asset><option value="">Generate from description</option>'+assets().map(a=>'<option value="'+esc(a.id)+'" '+(cue.asset_id===a.id?'selected':'')+'>'+esc(a.title||'Audio')+'</option>').join('')+'</select></label><div class="row"><button type="button" class="secondary" data-inline-preview>Preview Sound</button><button type="button" class="secondary" data-inline-upload>Upload Audio</button><button type="button" class="secondary" data-inline-remove>Remove Sound</button></div><audio controls preload="none" hidden></audio><p class="help" role="status" data-inline-status></p></div>';
    const content=box.querySelector('.form');
    content.insertAdjacentHTML('afterbegin','<label>Sound Name<input data-inline-name maxlength="100" value="'+esc(cue.name)+'"></label><label>Type<select data-inline-kind><option value="effect">Sound Effect</option><option value="ambience">Ambience</option><option value="music">Background Music</option></select></label>');
    box.querySelector('[data-inline-kind]').value=cue.kind;
    box.querySelector('[data-inline-name]').oninput=e=>{cue.name=e.target.value;persist();box.querySelector('summary').textContent=cue.name+' · '+(cue.asset_id?'Ready':'Will generate');};
    box.querySelector('[data-inline-kind]').onchange=e=>{cue.kind=e.target.value;cue.duration=cue.kind==='music'?Math.max(10,cue.duration||20):Math.min(30,cue.duration||5);persist();box.querySelector('[data-inline-kind]').blur();mount({root,getPlan,setPlan,getLines,getRanges,getCompute,mediaURL,forceHost:host});const next=[...host.querySelectorAll('[data-inline-cue]')].find(b=>b.dataset.inlineCue===cue.name);if(next)next.open=true;};
    content.insertAdjacentHTML('beforeend','<details data-inline-timing><summary>Timing &amp; Mix</summary><div class="form"><label>After These Words (Optional)<input data-inline-phrase value="'+esc(cue.phrase)+'" maxlength="500"></label><label>End after Passage<select data-inline-end>'+lines.map((l,i)=>'<option value="'+i+'">'+(i+1)+'. '+esc(l.text.slice(0,80))+'</option>').join('')+'</select></label><label>Volume (dB)<input type="number" data-inline-level min="-40" max="-3" value="'+cue.level_db+'"></label><label>Fade In / Out (Seconds)<input type="number" data-inline-fade min="0" max="5" step="0.01" value="'+cue.fade+'"></label><label class="workspace-label-option"><input type="checkbox" data-inline-duck '+(cue.duck?'checked':'')+'><span>Soften during speech</span></label><label class="workspace-label-option"><input type="checkbox" data-inline-loop '+(cue.loop?'checked':'')+'><span>Loop until the ending passage</span></label></div></details>');
    box.querySelector('[data-inline-end]').value=String(cue.end);
    for(const [selector,property] of [['phrase','phrase'],['end','end'],['level','level_db'],['fade','fade'],['duck','duck'],['loop','loop']])box.querySelector('[data-inline-'+selector+']').onchange=e=>{cue[property]=['duck','loop'].includes(selector)?e.target.checked:['end','level','fade'].includes(selector)?Number(e.target.value):e.target.value.trim();persist();};
    host.append(box);const note=box.querySelector('[data-inline-status]'),originalScript=base,story=activeStory;
    const valid=()=>{if(!box.isConnected||activeStory!==story||window.EccoSoundDesign.key(getLines())!==originalScript||!getPlan()?.cues.includes(cue))throw Error('The script or sound changed. Your edits are preserved.');};
    box.querySelector('[data-field=description]').oninput=e=>{cue.description=e.target.value;persist();};
    box.querySelector('[data-inline-asset]').onchange=e=>{cue.asset_id=e.target.value;persist();box.querySelector('summary').textContent=cue.name+' · '+(cue.asset_id?'Ready':'Will generate');};
    const attached=()=>{persist();const select=box.querySelector('[data-inline-asset]');select.replaceChildren(new Option('Generate from description',''),...assets().map(a=>new Option(a.title||'Audio',a.id)));select.value=cue.asset_id;box.querySelector('summary').textContent=cue.name+' · Ready';note.textContent='Sound saved and attached to this passage.';};
    // Inline creation uses the main Audio Studio compute selection, CPU by default.
    window.EccoSoundGeneration?.mount({box,cue,valid,changed:attached,settingsChanged:persist,preferredCompute:getCompute()});
    const advanced=box.querySelector('[data-sound-compute]')?.closest('.generation-filter-row');if(advanced){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Sound Settings';details.append(summary);advanced.before(details);details.append(advanced);}
    box.querySelector('[data-inline-remove]').onclick=()=>{setPlan({...getPlan(),cues:getPlan().cues.filter(c=>c!==cue)});host.dataset.signature='';box.querySelector('[data-inline-remove]').blur();mount({root,getPlan,setPlan,getLines,getRanges,getCompute,mediaURL,forceHost:host});host.querySelector('[data-add-turn-sound]')?.focus();};
    box.querySelector('[data-inline-upload]').onclick=()=>window.EccoAudioLibrary?.upload(asset=>{try{valid();cue.asset_id=asset.id;attached();}catch(error){note.textContent=error.message;}});
    box.querySelector('[data-inline-preview]').onclick=async()=>{try{valid();if(!cue.asset_id)throw Error('Generate or choose a sound first.');const url=await mediaURL(cue.asset_id);valid();const parsed=new URL(url);if(parsed.protocol!=='https:'&&!(parsed.protocol==='blob:'&&parsed.origin===location.origin))throw Error('Could not open this audio.');root.querySelectorAll('audio').forEach(a=>a.pause());const player=box.querySelector('audio');player.src=url;player.hidden=false;note.textContent='Press Play to listen.';}catch(error){note.textContent=error.message;}};
   }
   const add=document.createElement('button');add.type='button';add.className='secondary small';add.dataset.addTurnSound='';add.textContent='Add Sound';add.disabled=(getPlan()?.cues?.length||0)>=12;host.append(add);
   add.onclick=()=>{
    const field=row.querySelector('[data-final-turn]'),selection=field.value.slice(field.selectionStart,field.selectionEnd).trim();
    const currentLines=getLines(),currentRange=getRanges()[index];let start=currentRange.start,phrase='';
    if(selection)for(let n=currentRange.start;n<=currentRange.end;n++){const text=currentLines[n].text;if(text.includes(selection)&&text.indexOf(selection)===text.lastIndexOf(selection)){start=n;phrase=selection;break;}}
    const prior=getPlan()||{},existing=prior.cues||[];if(existing.length>=12)return;let n=1;while(existing.some(c=>c.name==='Sound '+n))n++;
    const cue={...window.EccoSoundDesign.defaults(),...getCompute(),name:'Sound '+n,start,end:start,phrase,description:'A brief sound effect for this action: '+(phrase||currentLines[start].text).slice(0,400)};
    setPlan({...prior,enabled:true,cues:[...existing,cue],speech_key:prior.speech_key||window.EccoSoundDesign.key(currentLines)});host.dataset.signature='';add.blur();mount({root,getPlan,setPlan,getLines,getRanges,getCompute,mediaURL,forceHost:host});const created=[...host.querySelectorAll('[data-inline-cue]')].find(b=>b.dataset.inlineCue===cue.name);if(created){created.open=true;created.querySelector('textarea').focus();}
   };
  });
 }
 window.EccoInlineSounds={mount};
})();
