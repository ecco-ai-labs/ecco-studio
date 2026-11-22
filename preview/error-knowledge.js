'use strict';
/* Add confirmed recurring issues here. Causes are possibilities unless verified by the error itself. */
window.EccoErrorKnowledge=(()=>{
 const issues=[
  {id:'worker-lock',pattern:/BlockingIOError[\s\S]*Resource temporarily unavailable|worker\.lock[\s\S]*BlockingIOError/i,
   message:'The generation service could not start.',
   cause:'Another worker may hold its startup lock. A shared lock across GPU instances previously caused this issue.'},
  {id:'model-worker-unavailable',codes:['ECCO_MODEL_WORKER_UNAVAILABLE'],pattern:/(?:LongCat|model|worker).*?(?:not ready|not connected)|Connect a GPU with the selected model ready/i,
   message:'The selected model is not available on this compute yet.',
   cause:'The model worker may still be starting, may have stopped, or may not be installed on this instance. A connected GPU does not guarantee that every model worker is ready.'},
  {id:'gpu-disconnected',codes:['ECCO_GPU_DISCONNECTED'],pattern:/Select a connected GPU|Connect the selected accelerator|Accelerator is unavailable/i,
   message:'The selected GPU is not connected.',
   cause:'The instance may be stopped, restarting, or no longer responding. Check its status in Connections and select an available instance in Compute.'},
  {id:'out-of-memory',pattern:/CUDA out of memory|OutOfMemoryError|CUDA error: out of memory/i,
   message:'The GPU ran out of memory while generating.',
   cause:'The selected settings or another running model may require more memory than is available. Review Model Settings or use a GPU with more free memory.'},
  {id:'storage-auth',pattern:/private storage key was not accepted|Connect storage in Account using your private storage access key|Connect your saved workspace/i,
   message:'Your workspace storage needs to be connected.',
   cause:'The storage connection is missing or its access key was not accepted. Reconnect storage from Account.'},
  {id:'storage-unreachable',pattern:/Cannot reach storage|Storage did not respond|Storage request failed \(HTTP 50[234]/i,
   message:'Studio could not reach your saved workspace.',
   cause:'The storage service or its network connection may be temporarily unavailable. Your saved files are separate from the GPU.'},
  {id:'submission-unconfirmed',pattern:/submission is still unconfirmed|GPU response was interrupted/i,
   message:'Studio could not confirm whether your generation request was accepted.',
   cause:'The connection was interrupted after submission. Check Activity before retrying to avoid a duplicate generation.'},
  {id:'model-selection-changed',pattern:/Model or compute changed while checking/i,
   message:'Your model or compute selection changed during the readiness check.',
   cause:'The previous check no longer matches the visible selection. Click Generate again to use your current choices.'},
  {id:'video-worker-failed',pattern:/LongCat generation failed|Video failed/i,
   message:'Video generation stopped before it could finish.',
   cause:'The worker reported a failure. The technical details in Activity → Errors are needed to identify the cause; Studio will not silently switch models.'}
 ];
 function lookup(error){
  const text=String(error?.message||error||'');
  const issue=issues.find(x=>(error?.code&&x.codes?.includes(error.code))||x.pattern.test(text));
  return issue?{id:issue.id,message:issue.message,cause:issue.cause}:null;
 }
 return {lookup};
})();
