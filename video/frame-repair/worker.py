"""Opt-in WAN VACE worker. No ports, credentials, provisioning or model downloads.

Run after install_runtime.sh on an existing GPU. Only processes requests explicitly
addressed to RUNPOD_POD_ID. Model unloaded after each candidate to release VRAM.
"""
import gc
import io
import json
import os
import sys
import threading
import time
import fcntl
from pathlib import Path

ROOT=Path(os.environ.get('ECCO_FRAME_REPAIR_ROOT','/workspace/ecco-video/frame-repair'))
MODEL_PATH=ROOT/'model'
MODEL_ID='Wan-AI/Wan2.1-VACE-1.3B-diffusers'


def atomic(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.'+str(threading.get_ident())+'.tmp')
    temp.write_text(json.dumps(value));temp.chmod(0o600);temp.replace(path)


def geometry(width,height):
    scale=min(480/min(width,height),832/max(width,height))
    return max(16,round(width*scale/16)*16),max(16,round(height*scale/16)*16)


def conditions(root, request):
    from PIL import Image
    targets=set(request['original_frame_ids']);frames=[];masks=[]
    first=Image.open(root/'input'/('%06d.jpg'%request['from'])).convert('RGB')
    width,height=geometry(*first.size)
    for n in range(request['from'],request['to']+1):
        frames.append(Image.open(root/'input'/('%06d.jpg'%n)).convert('RGB').resize((width,height),Image.Resampling.LANCZOS))
        masks.append(Image.new('L',(width,height),255 if n in targets else 0))
    # VAE temporal compression needs 4k+1 frames. Extra context is never inserted.
    while (len(frames)-1)%4:
        frames.append(frames[-1].copy());masks.append(Image.new('L',(width,height),0))
    return frames,masks,width,height


def save_candidate(root, request, generated):
    from PIL import Image
    output=root/'output';output.mkdir(exist_ok=True)
    expected=request['to']-request['from']+1
    if len(generated)<expected:raise ValueError('The model returned too few frames.')
    for n in request['original_frame_ids']:
        frame=generated[n-request['from']]
        if not isinstance(frame,Image.Image):raise ValueError('The model returned an invalid frame.')
        for quality in (92,85,75,65,50):
            data=io.BytesIO();frame.convert('RGB').save(data,format='JPEG',quality=quality,optimize=True)
            if data.tell()<=89980:break
        else:raise ValueError('Candidate frame exceeds the preview limit.')
        (output/('%06d.jpg'%n)).write_bytes(data.getvalue())


def generate(root, request):
    import torch
    from diffusers import AutoencoderKLWan, WanVACEPipeline
    from diffusers.schedulers.scheduling_unipc_multistep import UniPCMultistepScheduler
    pipe=None
    try:
        frames,masks,width,height=conditions(root,request)
        vae=AutoencoderKLWan.from_pretrained(str(MODEL_PATH),subfolder='vae',torch_dtype=torch.float32,local_files_only=True)
        pipe=WanVACEPipeline.from_pretrained(str(MODEL_PATH),vae=vae,torch_dtype=torch.bfloat16,local_files_only=True)
        pipe.scheduler=UniPCMultistepScheduler.from_config(pipe.scheduler.config,flow_shift=3.0)
        pipe.enable_model_cpu_offload();pipe.vae.enable_tiling()
        def progress(pipeline,step,timestep,values):
            if time.time()-request['created']>7200:raise ValueError('Repair exceeded its two-hour limit.')
            atomic(root/'progress.json',{'status':'running','progress':'Generating corrected frames: step %d of 30'%(step+1)})
            return values
        result=pipe(prompt=request['instructions']+'. Preserve character identity, camera, lighting, scene geometry and natural motion from the surrounding video. Continuous 3D animation.',
                    negative_prompt='distorted face, extra limbs, moving background, flickering, text, watermark',
                    video=frames,mask=masks,height=height,width=width,num_frames=len(frames),num_inference_steps=30,
                    guidance_scale=5.0,generator=torch.Generator(device='cpu').manual_seed(int(request['id'][:8],16)),
                    output_type='pil',callback_on_step_end=progress).frames[0]
        save_candidate(root,request,result)
    finally:
        del pipe;gc.collect();torch.cuda.empty_cache()


def main():
    import torch
    pod=os.environ['RUNPOD_POD_ID']
    if not pod.isalnum():raise ValueError('Invalid worker ID')
    ROOT.mkdir(parents=True,exist_ok=True)
    lock=open('/tmp/ecco-frame-repair.lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    state={'ready':False,'busy':False,'reason':'Initializing repair runtime'}
    def heartbeat():
        while True:
            atomic(ROOT/'workers'/(pod+'.json'),{**state,'updated':time.time(),'model':MODEL_ID})
            time.sleep(10)
    threading.Thread(target=heartbeat,daemon=True).start()
    if not torch.cuda.is_available():raise RuntimeError('A CUDA GPU is required for VACE inference.')
    from diffusers import WanVACEPipeline
    if not (MODEL_PATH/'model_index.json').exists():raise RuntimeError('Install VACE model weights before starting the worker.')
    state.update(ready=True,reason='Ready')
    while True:
        for path in sorted((ROOT/'jobs').glob('*/request.json')):
            root=path.parent;request=json.loads(path.read_text())
            if request['worker_id']!=pod or (root/'result.json').exists():continue
            if (root/'claimed').exists():
                atomic(root/'result.json',{'status':'failed','error':'Worker restarted during repair. Submit a new request.'});continue
            if time.time()-request['created']>7200:
                atomic(root/'result.json',{'status':'failed','error':'Repair request expired.'});continue
            with (root/'claimed').open('x') as claim:claim.write(pod)
            state.update(busy=True,reason='Generating a repair candidate')
            try:
                atomic(root/'progress.json',{'status':'running','progress':'Loading VACE repair model'})
                generate(root,request)
                atomic(root/'result.json',{'status':'done','progress':'Candidate ready for review','finished':time.time()})
            except Exception as error:
                atomic(root/'result.json',{'status':'failed','error':str(error)[-1000:]})
            finally:state.update(busy=False,reason='Ready')
        time.sleep(2)

if __name__=='__main__':main()
