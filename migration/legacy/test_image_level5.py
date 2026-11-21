"""Image Level 5 server pieces (21 Nov 2026): trained house styles (LoRA) and overnight batches."""
import os, sys, tempfile, time, types, unittest
from pathlib import Path

TMP = tempfile.mkdtemp()
os.environ.update(ECCO_DATA=TMP + '/data', COMFY_ROOT=TMP + '/comfy')
sys.path.insert(0, str(Path(__file__).resolve().parent))
import studio  # noqa: E402
from PIL import Image  # noqa: E402


def asset(i):
    rel = f'image-dev/p{i}.png'; (studio.DATA / 'image-dev').mkdir(parents=True, exist_ok=True)
    Image.new('RGB', (64, 64), (i * 9 % 255, 80, 120)).save(studio.DATA / rel)
    return studio.save(studio.new('asset', media='image', stage='prod', path=rel, title=f'Pic {i}'))


class ImageLevel5(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        studio.initialize() if hasattr(studio, 'initialize') else None
        cls.pics = [asset(i) for i in range(24)]

    def test_graph_chains_the_style_lora_after_the_fast_lora(self):
        p = {'model': 'qwen-image-2512', 'prompt': 'a fox', 'negative': '', 'width': 1328, 'height': 1328, 'seed': 1, 'steps': 8, 'cfg': 1.0}
        g = studio.qwen_image_graph({**p, 'style_lora': 'ecco-style-' + 'a' * 32 + '.safetensors'}, 'x')
        self.assertEqual(g['12']['inputs']['model'], ['1', 0]); self.assertEqual(g['2']['inputs']['model'], ['12', 0])
        g = studio.qwen_image_graph({**p, 'fast_lora': 'F.safetensors', 'style_lora': 'ecco-style-' + 'b' * 32 + '.safetensors', 'style_strength': 0.7}, 'x')
        self.assertEqual(g['12']['inputs']['model'], ['11', 0]); self.assertEqual(g['12']['inputs']['strength_model'], 0.7); self.assertEqual(g['2']['inputs']['model'], ['12', 0])

    def test_training_needs_10_to_60_distinct_pictures_and_waits_for_a_trainer(self):
        with self.assertRaises(studio.Problem): studio.create_style_training({'items': [{'asset_id': self.pics[0]['id']}] * 10})
        with self.assertRaises(studio.Problem): studio.create_style_training({'items': [{'asset_id': a['id']} for a in self.pics[:5]]})
        sys.modules.pop('runpod_client', None)
        r = studio.create_style_training({'name': 'Our look', 'trigger': 'Our Look!', 'items': [{'asset_id': a['id'], 'caption': 'a cafe'} for a in self.pics[:12]]})
        self.assertEqual(r['status'], 'needs_trainer'); self.assertEqual(r['trigger'], 'ourlook'); self.assertEqual(len(r['asset_ids']), 12)

    def test_training_runs_on_the_trainer_and_the_style_becomes_usable(self):
        calls = {}
        fake = types.SimpleNamespace(VOLUME=TMP + '/volume', configured=lambda name: name == 'trainer')
        def submit(name, job):
            calls['job'] = job; calls['tar'] = Path(TMP, 'volume', job['dataset']['volume_key']).read_bytes(); return 'rp-1'
        def wait(name, job_id, timeout=0, on_progress=None, **kw):
            on_progress('Learning the style'); return {'lora': calls['job']['name'] + '.safetensors'}
        fake.submit, fake.wait = submit, wait
        sys.modules['runpod_client'] = fake
        try:
            r = studio.create_style_training({'name': 'Watercolour', 'items': [{'asset_id': a['id'], 'caption': f'scene {i}'} for i, a in enumerate(self.pics[:20])]})
            for _ in range(100):
                done = studio.get(r['id'], 'style_training')
                if done['status'] in ('ready', 'failed'): break
                time.sleep(0.05)
            self.assertEqual(done['status'], 'ready', done.get('error'))
            self.assertEqual(done['lora'], 'ecco-style-' + r['id'] + '.safetensors'); self.assertIn(done['lora'], studio.style_loras())
            import io, tarfile
            names = tarfile.open(fileobj=io.BytesIO(calls['tar'])).getnames()
            self.assertEqual(len(names), 40); self.assertIn('000.txt', names)
            self.assertEqual(tarfile.open(fileobj=io.BytesIO(calls['tar'])).extractfile('000.txt').read().decode(), 'eccostyle, scene 0')
            self.assertFalse(Path(TMP, 'volume', 'ecco-serverless/inputs/style-' + r['id'] + '.tar').exists())
        finally:
            sys.modules.pop('runpod_client', None)

    def test_batch_makes_one_queued_job_per_line_with_the_shared_settings(self):
        made = []
        real = studio.create_image
        studio.create_image = lambda body: made.append(body) or studio.save(studio.new('job', status='queued', label='x'))
        try:
            out = studio.create_image_batch({'batch_id': 'night-1', 'shared': {'model': 'qwen-image-2512', 'resolution': '1328x1328', 'evil': 1, 'owner': 'a@b'},
                                             'items': [{'prompt': 'frame ' + str(i), 'seed': i, 'index': i} for i in range(3)]})
        finally:
            studio.create_image = real
        self.assertEqual(len(out['job_ids']), 3); self.assertEqual([m['prompt'] for m in made], ['frame 0', 'frame 1', 'frame 2'])
        self.assertNotIn('evil', made[0]); self.assertEqual(made[2]['seed'], 2)
        self.assertEqual(studio.get(out['job_ids'][1], 'job')['batch_id'], 'night-1')
        with self.assertRaises(studio.Problem): studio.create_image_batch({'items': [{'prompt': 'x'}] * 251})
        with self.assertRaises(studio.Problem): studio.create_image_batch({'items': [{'prompt': ' '}]})


if __name__ == '__main__':
    unittest.main()
