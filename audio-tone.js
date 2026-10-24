'use strict';
(() => {
 const choices=['Natural','Warm','Conversational','Playful','Dramatic','Calm','Professional','Informative','Suspenseful','Inspirational'];
 function mount(input){
  if(!input)return;if(input.dataset.toneMounted){input.dispatchEvent(new Event('input'));return;}input.dataset.toneMounted='true';
  const custom=input.closest('label'),label=document.createElement('label'),select=document.createElement('select');
  label.append('Tone',select);for(const value of [...choices,'Custom'])select.add(new Option(value,value));
  custom.before(label);custom.firstChild.textContent='Custom Tone';input.placeholder='Describe the tone you want.';
  const sync=()=>{select.value=choices.includes(input.value)?input.value:input.value?'Custom':'Natural';custom.hidden=select.value!=='Custom';};
  sync();input.addEventListener('input',sync);
  select.onchange=()=>{const value=select.value;custom.hidden=value!=='Custom';input.value=value==='Custom'?'':value;input.dispatchEvent(new Event('input',{bubbles:true}));select.value=value;custom.hidden=value!=='Custom';if(value==='Custom')input.focus();};
 }
 window.EccoAudioTone={mount,choices};
})();
