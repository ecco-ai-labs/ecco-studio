'use strict';
/* Review a complete cast-assigned script before committing it to the story. */
(()=>{
 const clone=value=>JSON.parse(JSON.stringify(value));
 function open({draft,generate,isCurrent,renderCharacters,onDraft,onApply,opener}){
  const M=window.EccoStoryWorkspaceModel,d=document.createElement('dialog');
  d.className='generation-dialog story-script-dialog';d.setAttribute('aria-label','Generated Script');
  d.innerHTML='<div class="form"><h2 tabindex="-1">Generated Script</h2><p class="help">Edit each turn and choose its speaker. Select a character to set their properties.</p><p data-status role="status" aria-live="polite"></p><p data-error role="alert"></p><div class="story-script-layout"><section class="form" aria-label="Script turns"><h3>Script</h3><div data-turns class="form"></div></section><section class="form" aria-label="Character properties"><h3>Characters</h3><label>Character<select data-cast-choice aria-label="Character properties for"></select></label><div data-properties></div></section></div><div class="story-simple-actions"><button type="button" data-retry class="secondary" hidden>Retry Generate Script</button><button type="button" data-apply disabled>Apply Text</button></div></div>';
  const q=s=>d.querySelector(s),apply=q('[data-apply]'),choice=q('[data-cast-choice]');let busy=false,closed=false,revision=0,returnFocus=opener;
  const current=()=>{if(closed||!d.isConnected||!isCurrent())throw Error('The story changed. Reopen this script from its original story.');};
  const save=()=>{current();onDraft(clone(draft));};
  const edits=()=>{q('[data-error]').textContent='';save();};
  function options(select,selected){select.replaceChildren();draft.cast.forEach(c=>select.append(new Option(c.name,c.id)));select.value=selected;}
  function updateNames(){
   options(choice,choice.value||draft.cast[0]?.id);
   d.querySelectorAll('[data-turn-speaker]').forEach((select,i)=>options(select,draft.plan.segments[i].character_id));
  }
  function properties(){
   const index=draft.cast.findIndex(c=>c.id===choice.value);
   renderCharacters(q('[data-properties]'),draft,index,()=>{updateNames();edits();});
  }
  function render(){
   q('[data-turns]').replaceChildren();
   draft.plan.segments.forEach((turn,i)=>{
    const row=document.createElement('section');row.className='story-script-turn form';
    const label=document.createElement('label');label.textContent='Turn '+(i+1)+' · Speaker';const speaker=document.createElement('select');speaker.dataset.turnSpeaker=i;speaker.setAttribute('aria-label','Turn '+(i+1)+' speaker');options(speaker,turn.character_id);label.append(speaker);
    const words=document.createElement('label');words.textContent='Spoken text';const text=document.createElement('textarea');text.rows=3;text.value=turn.text.trim();text.dataset.turnText=i;text.setAttribute('aria-label','Turn '+(i+1)+' text');words.append(text);row.append(label,words);q('[data-turns]').append(row);
    speaker.onchange=()=>{turn.character_id=speaker.value;edits();};text.oninput=()=>{turn.text=text.value;edits();};
   });
   updateNames();properties();q('[data-status]').textContent=draft.plan.segments.length+' turns · '+draft.cast.length+' characters';apply.disabled=false;
  }
  async function run(){
   if(busy)return;busy=true;apply.disabled=true;q('[data-retry]').hidden=true;q('[data-error]').textContent='';d.setAttribute('aria-busy','true');const version=++revision;
   const valid=()=>{current();if(version!==revision)throw Error('A newer script request replaced this one.');};
   try{
    const result=await generate(draft.selection,valid,text=>{valid();q('[data-status]').textContent=text;});valid();
    draft={...draft,cast:result.cast,plan:result.plan,reason:result.reason};save();render();q('h2').focus();
   }catch(error){if(!closed&&d.isConnected){q('[data-status]').textContent='Your selected text is saved.';q('[data-error]').textContent=error.message;q('[data-retry]').hidden=false;window.EccoErrors?.show(error,{title:'Unable to generate script',retry:run,retryLabel:'Retry Generate Script'});}}
   finally{busy=false;d.setAttribute('aria-busy','false');}
  }
  choice.onchange=properties;q('[data-retry]').onclick=run;
  apply.onclick=()=>{
   try{
    current();M.validateCast(draft.cast);const ids=new Set(draft.cast.map(c=>c.id));
    if(!draft.plan?.segments?.length||draft.plan.segments.some(s=>!ids.has(s.character_id)||!s.text.trim()))throw Error('Choose a speaker and enter text for every turn.');
    returnFocus=onApply(clone(draft))||returnFocus;d.close('apply');
   }catch(error){q('[data-error]').textContent=error.message;window.EccoErrors?.show(error,{title:'Unable to apply script'});}
  };
  d.onclose=()=>{closed=true;revision++;d.remove();if(returnFocus?.isConnected)returnFocus.focus();};
  document.body.append(d);d.showModal();q('h2').focus();
  if(draft.plan?.segments?.length)render();else void run();
  return d;
 }
 window.EccoStoryScriptReview={open};
})();
