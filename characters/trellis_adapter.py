"""Run inside the configured TRELLIS.2 environment; official Python API only."""
import argparse
import json
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--task', required=True)
    parser.add_argument('--weights', required=True)
    args = parser.parse_args()
    task = json.loads(Path(args.task).read_text())
    os.environ.setdefault('PYTORCH_CUDA_ALLOC_CONF', 'expandable_segments:True')
    from PIL import Image
    from trellis2.pipelines import Trellis2ImageTo3DPipeline
    import o_voxel
    pipeline = Trellis2ImageTo3DPipeline.from_pretrained(args.weights)
    pipeline.cuda()
    high = task['params']['quality'] == 'high'
    mesh = pipeline.run(Image.open(task['params']['input_path']).convert('RGBA'),
                        seed=42, pipeline_type='1024_cascade' if high else '512')[0]
    mesh.simplify(16777216)
    result = o_voxel.postprocess.to_glb(
        vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs,
        coords=mesh.coords, attr_layout=mesh.layout, voxel_size=mesh.voxel_size,
        aabb=[[-.5, -.5, -.5], [.5, .5, .5]], decimation_target=500000 if high else 100000,
        texture_size=4096 if high else 2048, remesh=True, remesh_band=1,
        remesh_project=0, verbose=True)
    result.export(str(Path(task['output_dir']) / 'model.glb'))


if __name__ == '__main__': main()
