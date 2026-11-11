"""Library at scale: changes-only state, thumbnails, video posters and revalidation."""
import importlib.util, io, json, shutil, sqlite3, subprocess, tempfile, threading, unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

spec = importlib.util.spec_from_file_location('storage_api', Path(__file__).with_name('storage_api.py'))
api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
scale = api.library_scale


class LibraryScaleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); api.legacy.DATA = Path(self.tmp.name)
        with sqlite3.connect(api.legacy.DATA / 'studio.sqlite') as db:
            db.execute('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,body TEXT)')
        from PIL import Image
        Image.new('RGB', (1600, 1000), (180, 40, 90)).save(api.legacy.DATA / 'big.png')
        self.img = 'a' * 32
        api.legacy.save({'id': self.img, 'kind': 'asset', 'media': 'image', 'path': 'big.png', 'created': 1})
        api.Handler.access_key = 'test-only-' + 'x' * 32
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), api.Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = 'http://127.0.0.1:' + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.tmp.cleanup()

    def call(self, path, headers=None):
        h = {'Origin': api.ALLOWED_ORIGIN, 'Authorization': 'Bearer ' + api.Handler.access_key, **(headers or {})}
        return urlopen(Request(self.base + path, headers=h))

    def state(self, since=None):
        with self.call('/api/state' + ('' if since is None else f'?since={since}')) as r:
            return json.load(r)

    def test_state_sends_only_changes_after_the_cursor(self):
        full = self.state()
        self.assertFalse(full['delta']); self.assertTrue(full['config']['storage']['state_changes'])
        self.assertIn(self.img, [r['id'] for r in full['records']])
        cursor = full['cursor']
        empty = self.state(cursor)
        self.assertTrue(empty['delta']); self.assertEqual(empty['records'], []); self.assertEqual(empty['deleted'], [])
        api.legacy.save({'id': 'b' * 32, 'kind': 'asset', 'media': 'image', 'path': 'big.png', 'created': 2})
        api.legacy.save({'id': self.img, 'kind': 'asset', 'media': 'image', 'path': 'big.png', 'created': 1, 'title': 'Renamed'})
        delta = self.state(cursor)
        self.assertEqual(sorted(r['id'] for r in delta['records']), ['a' * 32, 'b' * 32])
        self.assertEqual([r.get('title') for r in delta['records'] if r['id'] == self.img], ['Renamed'])
        self.assertGreater(delta['cursor'], cursor)

    def test_writes_from_another_connection_and_deletes_are_tracked(self):
        cursor = self.state()['cursor']
        with sqlite3.connect(api.legacy.DATA / 'studio.sqlite') as db:  # as the GPU service would
            db.execute('DELETE FROM records WHERE id=?', (self.img,))
        delta = self.state(cursor)
        self.assertEqual(delta['deleted'], [self.img]); self.assertEqual(delta['records'], [])

    def test_active_jobs_are_always_sent_and_stale_cursors_get_full_state(self):
        api.legacy.save({'id': 'c' * 32, 'kind': 'job', 'status': 'running', 'created': 3})
        cursor = self.state()['cursor']
        self.assertIn('c' * 32, [r['id'] for r in self.state(cursor)['records']])
        self.assertFalse(self.state(cursor + 1000)['delta'])
        scale._last_prune.clear(); scale.prune(api.legacy.DATA, keep=0, every=0)
        api.legacy.save({'id': 'd' * 32, 'kind': 'asset', 'media': 'image', 'path': 'big.png', 'created': 4})
        api.legacy.save({'id': 'd' * 32, 'kind': 'asset', 'media': 'image', 'path': 'big.png', 'created': 4})
        scale._last_prune.clear(); scale.prune(api.legacy.DATA, keep=1, every=0)
        self.assertFalse(self.state(0)['delta'])
        with self.assertRaises(HTTPError) as error: self.call('/api/state?since=abc')
        self.assertEqual(error.exception.code, 400)

    def test_thumbnail_is_small_cached_and_revalidated(self):
        with self.call('/api/thumb/' + self.img) as r:
            body = r.read(); tag = r.headers['ETag']
            self.assertEqual(r.headers['Content-Type'], 'image/webp'); self.assertIn('max-age', r.headers['Cache-Control'])
        from PIL import Image
        with Image.open(io.BytesIO(body)) as image: self.assertEqual(max(image.size), scale.THUMB_EDGE)
        self.assertLess(len(body), (api.legacy.DATA / 'big.png').stat().st_size)
        self.assertEqual(len(list((api.legacy.DATA / 'thumbs').rglob('*.webp'))), 1)
        with self.assertRaises(HTTPError) as error: self.call('/api/thumb/' + self.img, {'If-None-Match': tag})
        self.assertEqual(error.exception.code, 304)

    def test_media_revalidates_with_etag(self):
        with self.call('/api/media/' + self.img) as r:
            tag = r.headers['ETag']; self.assertEqual(r.headers['Cache-Control'], 'private, no-cache')
        with self.assertRaises(HTTPError) as error: self.call('/api/media/' + self.img, {'If-None-Match': tag})
        self.assertEqual(error.exception.code, 304)
        with self.call('/api/media/' + self.img, {'If-None-Match': tag, 'Range': 'bytes=0-3'}) as r: self.assertEqual(r.status, 206)

    def test_thumbnails_require_auth_and_images_or_videos(self):
        with self.assertRaises(HTTPError) as error:
            urlopen(Request(self.base + '/api/thumb/' + self.img, headers={'Origin': api.ALLOWED_ORIGIN}))
        self.assertEqual(error.exception.code, 401)
        (api.legacy.DATA / 'a.wav').write_bytes(b'RIFF0000')
        api.legacy.save({'id': 'e' * 32, 'kind': 'asset', 'media': 'audio', 'path': 'a.wav', 'created': 5})
        with self.assertRaises(HTTPError) as error: self.call('/api/thumb/' + 'e' * 32)
        self.assertEqual(error.exception.code, 404)

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg not installed')
    def test_video_poster_frame(self):
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:d=2', '-pix_fmt', 'yuv420p',
                        str(api.legacy.DATA / 'clip.mp4')], check=True, capture_output=True)
        api.legacy.save({'id': 'f' * 32, 'kind': 'asset', 'media': 'video', 'path': 'clip.mp4', 'created': 6})
        self.assertTrue(self.state()['config']['storage']['video_thumbnails'])
        with self.call('/api/thumb/' + 'f' * 32) as r:
            self.assertEqual(r.headers['Content-Type'], 'image/webp'); body = r.read()
        from PIL import Image
        with Image.open(io.BytesIO(body)) as image: self.assertEqual(image.size, (384, 216))


if __name__ == '__main__':
    unittest.main()
