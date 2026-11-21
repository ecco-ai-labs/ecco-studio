"""Image Level 4 server pieces (21 Nov 2026): change a picture's shape (fill the new sides, keep the middle) and 4K copies."""
import os, sys, tempfile, unittest
from pathlib import Path

TMP = tempfile.mkdtemp()
os.environ.update(ECCO_DATA=TMP + '/data', COMFY_ROOT=TMP + '/comfy', ECCO_VOLUME_UPSCALE=TMP + '/volume-upscale', ECCO_VOLUME_LORAS=TMP + '/volume-loras')
sys.path.insert(0, str(Path(__file__).resolve().parent))
import studio  # noqa: E402
from PIL import Image  # noqa: E402


class ImageLevel4(unittest.TestCase):
    def test_shape_is_checked_and_rounded_to_eight(self):
        self.assertEqual(studio.shape_of('1664x930'), (1664, 928))
        for bad in ('wide', '100x100', '4000x1000'):
            with self.assertRaises(studio.Problem):
                studio.shape_of(bad)

    def test_padding_centres_the_picture_and_the_middle_is_kept_exactly(self):
        src = Path(TMP, 'src.png'); Image.new('RGB', (400, 400), (200, 10, 10)).save(src)
        pad = Path(TMP, 'pad.png'); box = studio.padded(src, pad, (800, 400))
        self.assertEqual(box, (200, 0, 400, 400))
        with Image.open(pad) as im:
            self.assertEqual(im.size, (800, 400)); self.assertEqual(im.getpixel((10, 200)), (128, 128, 128)); self.assertEqual(im.getpixel((400, 200)), (200, 10, 10))
        out = Path(TMP, 'out.png'); Image.new('RGB', (816, 408), (0, 90, 0)).save(out)  # the model returns a near size
        studio.keep_middle(out, src, box, (800, 400))
        with Image.open(out) as im:
            self.assertEqual(im.size, (800, 400)); self.assertEqual(im.getpixel((400, 200)), (200, 10, 10)); self.assertEqual(im.getpixel((20, 200)), (0, 90, 0))

    def test_upscaler_is_found_only_when_the_file_exists_and_the_graph_reaches_4k(self):
        self.assertEqual(studio.upscale_model(), '')
        folder = Path(TMP, 'volume-upscale'); folder.mkdir(parents=True, exist_ok=True); (folder / 'RealESRGAN_x4plus.pth').write_bytes(b'x')
        self.assertEqual(studio.upscale_model(), 'RealESRGAN_x4plus.pth')
        g = studio.upscale_graph('a.png', 'RealESRGAN_x4plus.pth', 'x', (3840, 2142))
        self.assertEqual(g['3']['class_type'], 'ImageUpscaleWithModel'); self.assertEqual((g['4']['inputs']['width'], g['4']['inputs']['height']), (3840, 2142))
        self.assertEqual(g['5']['inputs']['images'], ['4', 0])

    def test_routes_and_config_are_wired(self):
        source = Path(studio.__file__).read_text()
        self.assertIn("path=='/api/image-resize'", source); self.assertIn("path=='/api/image-upscale'", source)
        self.assertIn("'image_resize':qwen_edit_ready()", source); self.assertIn("'image_parallel':", source); self.assertIn("'image_upscale':bool(upscale_model())", source)


if __name__ == '__main__':
    unittest.main()
