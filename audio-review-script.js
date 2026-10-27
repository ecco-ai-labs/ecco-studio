'use strict';
(()=>{
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fit=field=>{field.style.height='auto';field.style.height=(field.scrollHeight+field.offsetHeight-field.clientHeight)+'px';};
 const all=plan=>[...(plan.opening?[{...plan.opening,opening:true}]:[]),...plan.segments];
 function mount({root,getPlan,setPlan,getCast,getBrief,externalFields,generate}){
  if(!root)return;
  let section=root.querySelector('[data-final-script]');if(section)return section.update();
  section=document.createElement('section');section.dataset.finalScript='';section.className='form';section.innerHTML='<div class="section-head audio-script-heading"><h3>Final Script</h3><div class="generation-ai-actions"><button type="button" class="secondary" data-improve-selection title="Select a word, sentence or paragraph to improve">Improve with AI</button></div></div><div data-final-turns class="form"></div><p role="status" data-script-edit-status></p>';const heading=root.querySelector('.section-head');if(externalFields)root.prepend(section);else if(heading)heading.after(section);else root.append(section);if(generate){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Generate with AI';button.onclick=generate;section.querySelector('.generation-ai-actions').prepend(button);}
  function delivery(part,index){const cue=part.performance,emotion=cue?.emotion||'',d=window.EccoAudioDirection;return '<details class="generation-settings"><summary>Delivery instructions</summary><div class="generation-settings-body"><label>Emotion<select data-turn-emotion="'+index+'"><option value="">Character default</option>'+d.emotions.map(e=>'<option value="'+e+'" '+(e===emotion?'selected':'')+'>'+e+'</option>').join('')+'</select></label><label>Acting direction<textarea data-turn-direction="'+index+'" rows="2" maxlength="400">'+esc(cue?.direction||'')+'</textarea></label></div></details>';}
  let signature='',chosen=null;const host=section.querySelector('[data-final-turns]'),note=section.querySelector('[data-script-edit-status]');
  section.update=()=>{
   const plan=getPlan(),next=JSON.stringify([plan,getCast()]);if(next===signature||host.contains(document.activeElement))return;signature=next;chosen=null;
   if(!externalFields)host.innerHTML=all(plan).map((part,i)=>'<section class="form" data-final-turn-row="'+i+'"><label>'+esc((part.opening?'Opening · ':'Turn '+(i+1-(plan.opening?1:0))+' · ')+(getCast().find(c=>c.id===part.character_id)?.name||'Narrator'))+'<textarea data-final-turn="'+i+'" dir="auto" rows="3" maxlength="4000">'+esc(part.text)+'</textarea></label>'+delivery(part,i)+'<div data-turn-sounds></div></section>').join('');
   if(!externalFields&&!all(plan).length)host.textContent='Your script will appear here.';
   (externalFields?externalFields():host.querySelectorAll('textarea[data-final-turn]')).forEach((field,index)=>{field.dataset.finalTurn=index;const select=()=>{chosen=field;};field.addEventListener('select',select);field.addEventListener('focus',select);field.addEventListener('keyup',select);field.addEventListener('mouseup',select);if(!externalFields)field.oninput=()=>{const plan=getPlan(),index=Number(field.dataset.finalTurn),part=plan.opening?(index===0?plan.opening:plan.segments[index-1]):plan.segments[index];part.text=field.value;if(!part.performance?.manual)delete part.performance;setPlan(plan);signature=JSON.stringify([plan,getCast()]);fit(field);note.textContent='Script changed. Generate audio to hear the revision.';};});
   host.querySelectorAll('[data-turn-emotion],[data-turn-direction]').forEach(field=>{field.onchange=()=>{const plan=getPlan(),index=Number(field.dataset.turnEmotion??field.dataset.turnDirection),part=plan.opening?(index===0?plan.opening:plan.segments[index-1]):plan.segments[index],row=field.closest('[data-final-turn-row]'),emotionField=row.querySelector('[data-turn-emotion]'),directionField=row.querySelector('[data-turn-direction]');
    if(field===emotionField)directionField.value=emotionField.value?window.EccoAudioDirection.description(emotionField.value):'';
    if(!emotionField.value&&!directionField.value.trim())delete part.performance;
    else{const cast=getCast().find(c=>c.id===part.character_id),emotion=emotionField.value||cast?.emotion||'neutral';part.performance={emotion,direction:directionField.value.trim()||window.EccoAudioDirection.description(emotion),pause_before:part.performance?.pause_before??0,manual:true};}
    setPlan(plan);signature=JSON.stringify([plan,getCast()]);note.textContent='Turn delivery saved. Generate audio to hear the change.';
   };});
   requestAnimationFrame(()=>host.querySelectorAll('textarea').forEach(fit));
  };
  section.querySelector('[data-improve-selection]').onclick=()=>{
   if(!chosen?.isConnected||chosen.selectionStart===chosen.selectionEnd){note.textContent='Select the words you want to improve first.';chosen?.focus();return;}
   const field=chosen,start=field.selectionStart,end=field.selectionEnd,original=field.value,selected=original.slice(start,end),planSnapshot=JSON.stringify(getPlan()),story=activeStory,opener=section.querySelector('[data-improve-selection]');
   window.EccoTextRefinement.open({id:'audio-selection-ai',text:selected,opener,
    valid:()=>{if(!field.isConnected||activeStory!==story||field.value!==original||JSON.stringify(getPlan())!==planSnapshot)throw Error('The script changed. Select the current passage and try again.');},
    request:async(text,instructions)=>{
     if(!window.EccoStorage?.ready||!window.EccoAI?.enabled)throw Error('Connect AI and workspace storage first. Your script is unchanged.');
     const brief=getBrief(),instruction='Revise ONLY the selected spoken passage according to the user instruction. Return only replacement words, no labels, quotes around the answer, stage directions or explanation. Preserve its language and meaning unless the user requests a change. Do not add a new introduction, ending or unprovided facts. Do not reconstruct the surrounding story. Questions and notes must be English. Audience: '+(brief.audience||'General audience')+'. Genre: '+(brief.genre||'Story Book Reading')+'. Language style: '+(brief.language_style||'Everyday / Conversational')+'. Tone: '+(brief.tone||'Natural')+'. Narration style: '+(brief.narration_style||'As specified for the character')+'. User instruction: '+instructions;
     const result=await api('ai/enhance',{stage:'audio',mode:'improve',story_id:null,fields:[{id:'selected_audio_text',text,max_length:4000}],context:{instructions:instruction},review_only:false});if(result.questions?.length)throw Object.assign(Error(result.questions.join(' ')),{questions:true});return result.revisions?.find(r=>r.id==='selected_audio_text')?.text;
    },
    apply:replacement=>{const value=original.slice(0,start)+replacement+original.slice(end),plan=getPlan(),index=Number(field.dataset.finalTurn),part=plan.opening?(index===0?plan.opening:plan.segments[index-1]):plan.segments[index];part.text=value;if(!part.performance?.manual)delete part.performance;window.EccoAudioScript.validatePlan(plan,getCast(),plan.segments.length);setPlan(plan);field.value=value;fit(field);signature=JSON.stringify([plan,getCast()]);note.textContent='Selected text updated. Generate audio to hear the revision.';}
   });
  };
  section.update();
 }
 window.EccoAudioReviewScript={mount};
})();
