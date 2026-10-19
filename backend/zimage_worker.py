"""Isolated Z-Image inference; invoked by Studio's existing job queue."""
import json
import sys
from pathlib import Path

def main():
    import torch
    from diffusers import ZImagePipeline
    request = json.loads(Path(sys.argv[1]).read_text())
    progress = Path(request['progress_file'])
    def update(message):
        temporary = progress.with_suffix('.tmp')
        temporary.write_text(json.dumps({'progress': message}))
        temporary.replace(progress)
    update('Loading Z-Image 6B')
    pipe = ZImagePipeline.from_pretrained('/workspace/ecco-models/z-image', torch_dtype=torch.bfloat16, local_files_only=True)
    pipe.to('cuda')
    steps = request['steps']
    def callback(pipeline, step, timestep, kwargs):
        update(f'Generating Z-Image: step {step + 1}/{steps}')
        return kwargs
    image = pipe(prompt=request['prompt'], negative_prompt=request.get('negative', ''),
                 height=request['height'], width=request['width'], num_inference_steps=steps,
                 guidance_scale=request['cfg'], cfg_normalization=False,
                 generator=torch.Generator('cuda').manual_seed(request['seed']),
                 callback_on_step_end=callback).images[0]
    image.save(request['output_file'])
    update('Image saved')

if __name__ == '__main__':
    main()
