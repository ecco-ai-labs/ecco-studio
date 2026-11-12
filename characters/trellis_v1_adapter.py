"""Offline TRELLIS 1 reconstruction with a prepared transparent reference.

Uses the public DINOv2 encoder. It does not fetch or accept model licenses,
remove backgrounds, or qualify a runtime merely because files exist.
"""
import argparse
import json
import os
from pathlib import Path


def load_pipeline(weights, encoder_root, encoder_checkpoint):
    import torch
    from torchvision import transforms
    from trellis.pipelines import TrellisImageTo3DPipeline

    def local_encoder(self, name):
        if name != 'dinov2_vitl14_reg':
            raise ValueError('This runtime is pinned to the DINOv2 ViT-L/14 register encoder.')
        model = torch.hub.load(encoder_root, name, source='local', pretrained=False)
        model.load_state_dict(torch.load(encoder_checkpoint, map_location='cpu', weights_only=True))
        model.eval()
        self.models['image_cond_model'] = model
        self.image_cond_model_transform = transforms.Compose([
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])])

    # Upstream's factory explicitly constructs its own class. Replace only its
    # encoder initializer for construction, then restore it in this subprocess.
    original = TrellisImageTo3DPipeline._init_image_cond_model
    TrellisImageTo3DPipeline._init_image_cond_model = local_encoder
    try:
        pipeline = TrellisImageTo3DPipeline.from_pretrained(weights)
    finally:
        TrellisImageTo3DPipeline._init_image_cond_model = original
    return pipeline


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--task', required=True)
    parser.add_argument('--weights', required=True)
    parser.add_argument('--encoder-root', required=True)
    parser.add_argument('--encoder-checkpoint', required=True)
    args = parser.parse_args()
    task = json.loads(Path(args.task).read_text())
    os.environ.setdefault('SPCONV_ALGO', 'native')
    os.environ.setdefault('ATTN_BACKEND', 'flash_attn')
    os.environ.setdefault('PYTORCH_CUDA_ALLOC_CONF', 'expandable_segments:True')
    from PIL import Image
    image = Image.open(task['params']['input_path'])
    if image.mode != 'RGBA' or image.getextrema()[3][0] == 255:
        raise ValueError('TRELLIS 1 requires a reviewed PNG with a transparent background.')
    if image.getextrema()[3][1] <= 204:
        raise ValueError('The reference has no opaque character pixels.')
    from trellis.utils import postprocessing_utils
    pipeline = load_pipeline(args.weights, args.encoder_root, args.encoder_checkpoint)
    pipeline.cuda()
    outputs = pipeline.run(image, seed=42, formats=['mesh', 'gaussian'])
    high = task['params']['quality'] == 'high'
    result = postprocessing_utils.to_glb(outputs['gaussian'][0], outputs['mesh'][0],
        simplify=0.3 if high else 0.7, fill_holes=False, texture_size=4096 if high else 2048)
    result.export(str(Path(task['output_dir']) / 'model.glb'))


if __name__ == '__main__': main()
