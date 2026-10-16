import base64, io, pathlib, tempfile, unittest, shutil
from PIL import Image
import image_upload, install, accelerator_status
from unittest.mock import patch
import subprocess

class Problem(Exception): pass
class UploadTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.saved=[]
        self.env={'Problem':Problem,'DATA':self.root,'story_id':lambda body:'story-1','save':lambda r:self.saved.append(r) or r}
    def tearDown(self): self.tmp.cleanup()
    def body(self,fmt='PNG'):
        b=io.BytesIO();Image.new('RGB',(20,10),'red').save(b,fmt)
        return {'name':'../../object.png','data':base64.b64encode(b.getvalue()).decode()}
    def test_upload_normal_asset_and_safe_path(self):
        r=image_upload.upload(self.body(),self.env)
        self.assertEqual(r['kind'],'asset');self.assertEqual(r['story_id'],'story-1');self.assertEqual(r['title'],'object.png')
        with Image.open(self.root/r['path']) as im: self.assertEqual(im.size,(20,10))
        self.assertEqual(len(self.saved),1)
    def test_jpeg_normalized(self):
        r=image_upload.upload(self.body('JPEG'),self.env)
        with Image.open(self.root/r['path']) as im: self.assertEqual(im.format,'PNG')
    def test_invalid_input_no_asset(self):
        for data in ['??',base64.b64encode(b'not an image').decode()]:
            with self.assertRaises(Problem): image_upload.upload({'data':data},self.env)
        self.assertFalse(self.saved)
    def test_pixel_limit(self):
        original=image_upload.MAX_PIXELS
        try:
            image_upload.MAX_PIXELS=100
            with self.assertRaises(Problem): image_upload.upload(self.body(),self.env)
        finally: image_upload.MAX_PIXELS=original
    def test_save_failure_cleans_file(self):
        def fail(r): raise RuntimeError('database failure')
        self.env['save']=fail
        with self.assertRaises(RuntimeError): image_upload.upload(self.body(),self.env)
        self.assertFalse(list(self.root.rglob('*.png')))
    def test_wrong_format(self):
        with self.assertRaises(Problem): image_upload.upload(self.body('GIF'),self.env)

class InstallTests(unittest.TestCase):
    def test_guarded_idempotent_patch(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp)
            server="import urllib.parse\ndef state(): return {'runtime':runtime_status(),}\ndef mutate():\n            if path=='/api/images': result=create_image(body)\n            if not 0<length<=1024*1024: raise Problem('large')\n"
            (root/'studio.py').write_text(server)
            (root/'studio.html').write_text('<html><body><script src="library-ui.js?v=1"></script></body></html>')
            (root/'library-ui.js').write_text('function folderDialog(asset=null){return asset;}')
            backup=install.install(root);first=(root/'studio.html').read_text();install.install(root)
            self.assertEqual(first,(root/'studio.html').read_text());self.assertEqual(server,(backup/'studio.py').read_text())
            self.assertIn("/api/images/upload",(root/'studio.py').read_text())
    def test_unknown_version_unchanged(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);(root/'studio.py').write_text('unsupported')
            with self.assertRaises(RuntimeError):install.install(root)
            self.assertEqual((root/'studio.py').read_text(),'unsupported')
class AcceleratorTests(unittest.TestCase):
    def test_hardware_names_not_pod_assumptions(self):
        for name in ['NVIDIA B200', 'NVIDIA A100-SXM4-80GB', 'NVIDIA H100']:
            with patch.object(accelerator_status.subprocess,'run',return_value=subprocess.CompletedProcess([],0,name+', 81920\n')):
                result=accelerator_status.detect()
                self.assertEqual(result['status'],'detected')
                self.assertEqual(result['devices'][0]['name'],name)
    def test_missing_or_failed_probe_is_unknown(self):
        for error in [FileNotFoundError(),subprocess.TimeoutExpired('nvidia-smi',3)]:
            with patch.object(accelerator_status.subprocess,'run',side_effect=error):
                result=accelerator_status.detect()
                self.assertEqual(result['status'],'unknown');self.assertEqual(result['devices'],[])
    def test_empty_probe_is_unknown(self):
        with patch.object(accelerator_status.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'')):
            self.assertEqual(accelerator_status.detect()['status'],'unknown')
if __name__=='__main__':unittest.main()
