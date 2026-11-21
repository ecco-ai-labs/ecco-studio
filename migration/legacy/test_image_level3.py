"""Image Level 2-3 server pieces (21 Nov 2026): more Qwen sizes, Fast LoRA graphs, edits returned at the source size."""
import os, sys, tempfile, unittest
from pathlib import Path

TMP = tempfile.mkdtemp()
os.environ.update(ECCO_DATA=TMP + '/data', COMFY_ROOT=TMP + '/comfy', ECCO_VOLUME_LORAS=TMP + '/volume-loras')
sys.path.insert(0, str(Path(__file__).resolve().parent))
import studio  # noqa: E402


class ImageLevel3(unittest.TestCase):
    def test_sizes_include_the_native_qwen_aspect_ratios(self):
        for size in ('1664x928', '1328x1328', '928x1664', '1472x1104', '1104x1472', '1584x1056', '1056x1584'):
            self.assertIn(size, studio.QWEN_SIZES)
        self.assertEqual(studio.resolution('1472x1104', studio.QWEN_SIZES), (1472, 1104))
        with self.assertRaises(studio.Problem):
            studio.resolution('1000x1000', studio.QWEN_SIZES)

    def test_fast_lora_is_found_only_when_the_file_exists(self):
        self.assertEqual(studio.fast_lora('qwen-image-2512'), '')
        folder = Path(TMP, 'volume-loras'); folder.mkdir(parents=True, exist_ok=True)
        (folder / 'Qwen-Image-2512-Lightning-8steps-V1.0-fp32.safetensors').write_bytes(b'x')
        self.assertEqual(studio.fast_lora('qwen-image-2512'), 'Qwen-Image-2512-Lightning-8steps-V1.0-fp32.safetensors')
        self.assertEqual(studio.fast_lora('qwen-image-edit-2511'), '')

    def test_qwen_graph_inserts_the_lora_before_model_sampling(self):
        p = {'model': 'qwen-image-2512', 'prompt': 'a fox', 'negative': '', 'width': 1472, 'height': 1104, 'seed': 1, 'steps': 8, 'cfg': 1.0}
        plain = studio.qwen_image_graph(p, 'a')
        self.assertNotIn('11', plain); self.assertEqual(plain['2']['inputs']['model'], ['1', 0])
        fast = studio.qwen_image_graph({**p, 'fast_lora': 'L.safetensors'}, 'a')
        self.assertEqual(fast['11']['class_type'], 'LoraLoaderModelOnly'); self.assertEqual(fast['11']['inputs']['lora_name'], 'L.safetensors')
        self.assertEqual(fast['2']['inputs']['model'], ['11', 0]); self.assertEqual(fast['7']['inputs']['width'], 1472)

    def test_edit_graph_scales_back_to_the_source_size_and_can_use_a_lora(self):
        g = studio.edit_graph('night', ['a.png'], 'x', size=(1664, 928))
        self.assertEqual(g['13']['class_type'], 'ImageScale'); self.assertEqual((g['13']['inputs']['width'], g['13']['inputs']['height']), (1664, 928))
        self.assertEqual(g['12']['inputs']['images'], ['13', 0])
        g = studio.edit_graph('night', ['a.png'], 'x', lora='E.safetensors')
        self.assertEqual(g['14']['class_type'], 'LoraLoaderModelOnly'); self.assertEqual(g['2']['inputs']['model'], ['14', 0])
        self.assertEqual(g['12']['inputs']['images'], ['11', 0])

    def test_source_size_keeps_aspect_and_rounds_to_eight(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest('Pillow not installed')
        path = Path(TMP, 'src.png'); Image.new('RGB', (1664, 928)).save(path)
        self.assertEqual(studio.source_size(path), (1664, 928))
        Image.new('RGB', (4000, 3000)).save(path)
        self.assertEqual(studio.source_size(path), (2048, 1536))
        self.assertIsNone(studio.source_size(Path(TMP, 'missing.png')))


if __name__ == '__main__':
    unittest.main()
