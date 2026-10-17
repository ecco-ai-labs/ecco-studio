"""GPU-independent storage service. Requires Python 3.10+ and a private access key.
The frontend stays on GitHub Pages. Never put the access key in this repository.
"""
import hmac
import json
import mimetypes
import os
from pathlib import Path
import sys
from http.server import ThreadingHTTPServer
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'migration' / 'legacy'))
import studio as legacy

ALLOWED_ORIGIN = 'https://ecco-ai-labs.github.io'
TOKEN_FILE = Path(os.getenv('ECCO_STORAGE_TOKEN_FILE', '/workspace/ecco-storage-private/access.key'))
WRITE_ROUTES = frozenset({
    '/api/images/upload', '/api/stories', '/api/stories/archive', '/api/boards',
    '/api/library/folders', '/api/library/save', '/api/trash', '/api/trash/board',
    '/api/trash/folder', '/api/trash/draft', '/api/trash/restore-draft',
    '/api/trash/empty', '/api/purge', '/api/characters', '/api/object-edits',
    '/api/training-requests', '/api/approve', '/api/director/update',
})

def storage_state():
    return {'records': legacy.records(), 'storage_pending': False, 'config': {
        'storage': {'provider': 'RunPod network volume', 'volume': 'b3qo8lps92',
                    'gpu_independent': True, 'service': 'ecco-storage-api'},
        'models_ready': {}, 'video_gpus': [], 'runtime': {},
        'hourly_rate': 0.081, 'github_connected': False,
        'youtube_configured': False, 'youtube_channel': None,
        'wan_ready': False, 'ffmpeg': False, 'repo': 'ecco-ai-labs/ecco-studio',
    }}

class Handler(legacy.Handler):
    access_key = ''
    def end_headers(self):
        if self.headers.get('Origin') == ALLOWED_ORIGIN:
            self.send_header('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Expose-Headers', 'Content-Range,Accept-Ranges')
        super().end_headers()

    def authorized(self):
        if self.headers.get('Origin') not in (None, ALLOWED_ORIGIN):
            self.send({'error': 'Origin denied'}, 403)
            return False
        supplied = self.headers.get('Authorization', '')
        if not self.access_key or not hmac.compare_digest(supplied, 'Bearer ' + self.access_key):
            self.send({'error': 'Connect storage in Account using your private storage access key.'}, 401)
            return False
        return True

    def do_OPTIONS(self):
        if self.headers.get('Origin') != ALLOWED_ORIGIN:
            return self.send({'error': 'Origin denied'}, 403)
        self.send(b'', 204, headers={
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization,Content-Type,Range',
            'Access-Control-Max-Age': '600',
        })

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/healthz':
            return self.send({'ok': True, 'service': 'ecco-storage-api', 'gpu_required': False})
        if not self.authorized(): return
        try:
            if path == '/api/state': return self.send(storage_state())
            if path.startswith('/api/media/'):
                asset = legacy.get(path.split('/')[-1], 'asset')
                file = legacy.asset_path(asset)
                size = file.stat().st_size
                start, end, status = 0, size - 1, 200
                headers = {'Accept-Ranges': 'bytes'}
                value = self.headers.get('Range')
                if value:
                    import re
                    match = re.fullmatch(r'bytes=(\d+)-(\d*)', value)
                    if not match: raise legacy.Problem('Unsupported range', 416)
                    start = int(match[1])
                    end = min(int(match[2]) if match[2] else end, end)
                    if start > end: raise legacy.Problem('Range outside file', 416)
                    status = 206
                    headers['Content-Range'] = f'bytes {start}-{end}/{size}'
                self.send_response(status)
                self.send_header('Content-Type', mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
                self.send_header('Content-Length', str(end-start+1))
                self.send_header('Cache-Control', 'private, no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                for key, value in headers.items(): self.send_header(key, value)
                self.end_headers()
                with file.open('rb') as source:
                    source.seek(start)
                    remaining = end-start+1
                    while remaining:
                        data = source.read(min(1024*1024, remaining))
                        if not data: break
                        self.wfile.write(data)
                        remaining -= len(data)
                return
            self.send({'error': 'Not found'}, 404)
        except legacy.Problem as exc: self.send({'error': exc.message}, exc.code)
        except (BrokenPipeError, ConnectionResetError): pass
        except Exception: self.send({'error': 'Storage read failed'}, 500)

    def do_POST(self):
        if not self.authorized(): return
        path = urlsplit(self.path).path
        if path not in WRITE_ROUTES:
            return self.send({'error': 'This storage service does not run generation or external publishing.'}, 409)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            maximum = 17*1024*1024 if path == '/api/images/upload' else 1024*1024
            if not 0 < length <= maximum: raise legacy.Problem('Request size invalid', 413)
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict): raise legacy.Problem('Expected an object')
            # The inherited dispatcher only receives explicitly allowed storage operations.
            return self.mutate(path, body)
        except legacy.Problem as exc: self.send({'error': exc.message}, exc.code)
        except (ValueError, TypeError): self.send({'error': 'Invalid request'}, 400)


def main():
    Handler.access_key = TOKEN_FILE.read_text().strip()
    if len(Handler.access_key) < 32: raise SystemExit('A private access key of at least 32 characters is required')
    if not (legacy.DATA / 'studio.sqlite').is_file():
        raise SystemExit('Existing workspace database is missing; refusing to create an empty workspace')
    # Never run legacy.initialize(): it would mark GPU jobs interrupted from this CPU.
    # Never run billing, inference, or automatic external synchronization here.
    legacy.github_token = lambda: None
    address = os.getenv('ECCO_STORAGE_BIND', '127.0.0.1')
    port = int(os.getenv('ECCO_STORAGE_PORT', '8888'))
    print('Ecco storage service ready; GPU independent; authentication required', flush=True)
    ThreadingHTTPServer((address, port), Handler).serve_forever()

if __name__ == '__main__': main()
