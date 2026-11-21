'use strict';
/* Readiness and routing belong to the selected compute, not the last connected GPU. */
window.EccoCompute=(()=>{
 const connection=()=>window.EccoGPUConnection;
 const choices=()=>window.EccoGPUPicker.gpus.filter(g=>connection()?.isConnected(g.id));
 const config=id=>connection()?.config(id)||{};
 function ready(id,model){
  if(!connection()?.isConnected(id))return false;
  if(model==='longcat-avatar-1.5')return Boolean(state.config.longcat?.workers?.some(w=>w.pod===id&&w.ready));
  return Boolean(config(id).models_ready?.[model]);
 }
 function requireReady(id,model){
  if(!connection()?.isConnected(id))throw Object.assign(Error('Select a connected GPU in Compute.'),{code:'ECCO_GPU_DISCONNECTED'});
  if(!ready(id,model)){
   const gpu=window.EccoGPUPicker.gpus.find(g=>g.id===id);
   throw Object.assign(Error((MODEL_CATALOG[model]?.name||model)+' worker is not ready on '+(gpu?.name||'GPU')+' · '+(gpu?.label||id)+'. The GPU is connected, but this model service is unavailable.'),{code:'ECCO_MODEL_WORKER_UNAVAILABLE',model,gpu:id});
  }
  return config(id);
 }
 async function validate(id,model){
  if(model==='longcat-avatar-1.5'){const current=await api('state');state.config.longcat=current.config.longcat;}
  else await connection().checkAll(window.EccoGPUPicker.gpus);
  return requireReady(id,model);
 }
 function mount(form,kind){
  const section=document.createElement('section');section.className='generation-section';
  section.dataset.section='compute';
  section.innerHTML='<div class="generation-section-heading">Compute</div><select aria-label="'+kind+' compute" data-generation-compute></select>';
  form.querySelector('[data-section=model]').after(section);
  const select=section.querySelector('select'),key='ecco-compute-'+kind;
  let selected=localStorage.getItem(key)||connection()?.selectedId||'';
  const draw=()=>{
   const list=choices(),items=[['','Select connected GPU'],...list.map(g=>[g.id,g.name+' · '+g.label])];
   const signature=JSON.stringify(items);
   if(select.dataset.options!==signature){select.replaceChildren(...items.map(([id,label])=>new Option(label,id)));select.dataset.options=signature;}
   select.value=list.some(g=>g.id===selected)?selected:'';
   select.disabled=!list.length;
  };
  select.onchange=()=>{selected=select.value;localStorage.setItem(key,selected);form.dispatchEvent(new Event('ecco:compute-change'));};
  const update=()=>{if(!form.isConnected){document.removeEventListener('ecco:gpu-connection-change',update);return;}draw();form.dispatchEvent(new Event('ecco:compute-change'));};
  document.addEventListener('ecco:gpu-connection-change',update);draw();
  return select;
 }
 return {choices,config,ready,requireReady,validate,mount};
})();
