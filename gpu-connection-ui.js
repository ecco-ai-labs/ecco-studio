'use strict';
// GPU selection remains available while connected; no external window.
connectGPU=function(trigger){
 if(!['generate-image','generate-video','generate-audio','accelerator-status'].includes(trigger))return;
 if(trigger!=='accelerator-status'&&gpuConnected())return;

 let dialog=$('#gpu-picker-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='gpu-picker-dialog';dialog.style.width='min(900px,94vw)';dialog.innerHTML='<div class="section-head"><h2>Connect a GPU workspace</h2><button type="button" class="secondary">Close</button></div><div id="gpu-picker-content"></div>';dialog.querySelector('button').onclick=()=>dialog.close();document.body.append(dialog);}
 EccoGPUPicker.mount($('#gpu-picker-content'),async gpu=>{try{if(!window.EccoStorage?.ready){dialog.close();window.EccoStorage?.open();return;}await window.EccoGPUConnection.select(gpu);gpuURL=gpu.url;gpuOrigin=gpu.origin;dialog.close();notice(gpu.name+' connected.');}catch(error){notice(error.message,true);}});
 dialog.showModal();
};
