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
import audio_library
import library_rename
import audio_jobs
import audio_workflows
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'video'))
import longcat_jobs
import longcat_progress
import audio_video_sequence
import gpu_relay
import openai_assistant
import scene_planner
import google_signin
import workspace_access
import ecco_desk
import youtube_connection

ALLOWED_ORIGIN = 'https://ecco-ai-labs.github.io'
TOKEN_FILE = Path(os.getenv('ECCO_STORAGE_TOKEN_FILE', '/workspace/ecco-storage-private/access.key'))
WRITE_ROUTES = frozenset({
    '/api/audio/workflows/save', '/api/audio/workflows/control',
    '/api/youtube/playlists', '/api/youtube/connect', '/api/youtube/publish', '/api/youtube/disconnect', '/api/youtube/configure',
    '/api/library/rename',
    '/api/longcat/control', '/api/longcat/sequence', '/api/longcat/generate', '/api/audio/generate', '/api/gpu/request',
    '/api/ai/news/research', '/api/ai/news/storyboard',
    '/api/ai/connect', '/api/ai/settings', '/api/ai/disconnect', '/api/ai/enhance',
    '/api/stories/plan', '/api/audio/upload', '/api/audio/folders', '/api/audio/labels',
    '/api/images/upload', '/api/stories', '/api/stories/archive', '/api/boards',
    '/api/library/folders', '/api/library/save', '/api/trash', '/api/trash/board',
    '/api/trash/folder', '/api/trash/draft', '/api/trash/restore-draft',
    '/api/trash/empty', '/api/purge', '/api/characters', '/api/object-edits',
    '/api/training-requests', '/api/approve', '/api/director/update',
})

def storage_state():
    return {'records': [{**r, 'kind': 'job', 'source_kind': r['kind'], 'model': r.get('model') or longcat_jobs.MODEL, 'label': r.get('label') or 'Video · LongCat sequence'} if r['kind']=='audio_video_job' else r for r in longcat_progress.enrich(legacy.records())], 'storage_pending': False, 'config': {
        'storage': {'provider': 'RunPod network volume', 'volume': 'b3qo8lps92',
                    'rename_available': True, 'gpu_independent': True, 'service': 'ecco-storage-api'},
        'longcat': {**longcat_jobs.status(), 'sequence_available': True, 'sequence_controls': True}, 'gpu_relay': gpu_relay.status(), 'models_ready': {}, 'video_gpus': [], 'runtime': {}, 'ai': openai_assistant.status(),
        'ai_story_planner': {'ready': scene_planner.ready()}, 'audio_workflows': audio_workflows.status(),
        'hourly_rate': 0.081, 'github_connected': False,
        **youtube_connection.status(),
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
        self.workspace_role = 'owner'
        self.workspace_permissions = None
        if self.access_key and hmac.compare_digest(supplied, 'Bearer ' + self.access_key):
            return True
        try:
            identity = google_signin.session(supplied, include_claims=True)
            self.workspace_permissions = workspace_access.authorize(identity)
            self.workspace_role = 'tester'
            if not workspace_access.allowed(self.command, urlsplit(self.path).path):
                raise workspace_access.AccessError('This action requires the workspace owner.')
            return True
        except google_signin.AuthError:
            self.send({'error': 'Sign in or connect storage to access this workspace.'}, 401)
        except workspace_access.AccessError as error:
            self.send({'error': str(error)}, error.status)
        return False

    def do_OPTIONS(self):
        if self.headers.get('Origin') != ALLOWED_ORIGIN:
            return self.send({'error': 'Origin denied'}, 403)
        self.send(b'', 204, headers={
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization,Content-Type,Range,X-Ecco-Workspace-Key',
            'Access-Control-Max-Age': '600',
        })

    def do_GET(self):
        path = urlsplit(self.path).path
        if google_signin.handle(self, path, ALLOWED_ORIGIN): return
        if ecco_desk.handle(self, path, ALLOWED_ORIGIN, legacy.DATA / 'studio.sqlite', self.access_key): return
        if path == '/api/youtube/callback':
            return youtube_connection.callback(self)
        if path == '/healthz':
            return self.send({'ok': True, 'service': 'ecco-storage-api', 'gpu_required': False})
        if not self.authorized(): return
        try:
            if path == '/api/youtube/playlists': return self.send(youtube_connection.playlists())
            if path == '/api/workspace/access':
                return self.send(self.workspace_permissions or {'role': 'owner'})
            if path == '/api/state':
                data = storage_state()
                if self.workspace_role == 'tester':
                    data['config']['workspace_access'] = self.workspace_permissions
                    data['records'] = [r for r in data['records'] if r.get('kind') not in ('billing', 'config', 'secret')]
                return self.send(data)
            if path == '/api/gpu/status': return self.send(gpu_relay.status())
            if path.startswith('/api/gpu/requests/'):
                parts = path.split('/')
                return self.send(gpu_relay.result(parts[-2], parts[-1]))
            if path == '/api/audio/status': return self.send(audio_jobs.queue.availability())
            if path == '/api/audio/workflows/status':
                return self.send({**audio_workflows.status(), 'workflows': [r for r in legacy.records('workflow') if r.get('workflow_type')=='audio' and not r.get('deleted')], 'runs': legacy.records('audio_workflow_run')})
            if path.startswith('/api/audio/jobs/'):
                return self.send(audio_jobs.job_status(path.split('/')[-1], vars(legacy)))
            if path == '/api/ai/status': return self.send(openai_assistant.status())
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
        except (legacy.Problem, openai_assistant.AssistantError) as exc: self.send({'error': exc.message}, exc.code)
        except (BrokenPipeError, ConnectionResetError): pass
        except Exception: self.send({'error': 'Storage read failed'}, 500)

    def do_POST(self):
        path = urlsplit(self.path).path
        if google_signin.handle(self, path, ALLOWED_ORIGIN): return
        if ecco_desk.handle(self, path, ALLOWED_ORIGIN, legacy.DATA / 'studio.sqlite', self.access_key): return
        if not self.authorized(): return
        if path not in WRITE_ROUTES:
            return self.send({'error': 'This workspace action is not available on the storage service.'}, 409)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            maximum = 17*1024*1024 if path in ('/api/images/upload', '/api/audio/upload') else 1024*1024
            if path == '/api/youtube/configure': maximum = 32*1024
            if not 0 < length <= maximum: raise legacy.Problem('Request size invalid', 413)
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict): raise legacy.Problem('Expected an object')
            if path == '/api/youtube/configure': return self.send(youtube_connection.configure(body))
            if path == '/api/youtube/connect': return self.send(youtube_connection.start(playlists=body.get('playlists') is True))
            if path == '/api/youtube/disconnect': return self.send(youtube_connection.disconnect())
            if path == '/api/youtube/playlists': return self.send(youtube_connection.create_playlist(body))
            if path == '/api/youtube/publish':
                return self.send(youtube_connection.publish(body))
            if path.startswith('/api/ai/'):
                return self.send(openai_assistant.handle(path, body, vars(legacy)))
            if path == '/api/library/rename': return self.send(library_rename.rename(body, vars(legacy)))
            if path == '/api/gpu/request': return self.send(gpu_relay.submit(body))
            if path == '/api/longcat/control':
                return self.send(audio_video_sequence.control(body, vars(legacy)))
            if path == '/api/longcat/sequence':
                return self.send(audio_video_sequence.generate(body, vars(legacy)))
            if path == '/api/longcat/generate':
                return self.send(longcat_jobs.generate(body, vars(legacy)))
            if path == '/api/audio/generate':
                return self.send(audio_jobs.generate(body, vars(legacy)))
            if path == '/api/audio/workflows/save':
                return self.send(audio_workflows.save(body, vars(legacy)))
            if path == '/api/audio/workflows/control':
                return self.send(audio_workflows.control(body, vars(legacy)))
            if path == '/api/stories/plan':
                return self.send(scene_planner.plan(body, legacy.Problem))
            audio_routes = {'/api/audio/upload': audio_library.upload,
                            '/api/audio/folders': audio_library.create_folder,
                            '/api/audio/labels': audio_library.save_labels}
            if path in audio_routes:
                return self.send(audio_routes[path](body, vars(legacy)))
            # The inherited dispatcher only receives explicitly allowed storage operations.
            return self.mutate(path, body)
        except (legacy.Problem, openai_assistant.AssistantError) as exc: self.send({'error': exc.message}, exc.code)
        except (ValueError, TypeError): self.send({'error': 'Invalid request'}, 400)
        except (BrokenPipeError, ConnectionResetError): pass
        except Exception: self.send({'error': 'The workspace action could not complete. Please try again.'}, 500)


def main():
    Handler.access_key = TOKEN_FILE.read_text().strip()
    if len(Handler.access_key) < 32: raise SystemExit('A private access key of at least 32 characters is required')
    if not (legacy.DATA / 'studio.sqlite').is_file():
        raise SystemExit('Existing workspace database is missing; refusing to create an empty workspace')
    ecco_desk.initialize(legacy.DATA / 'studio.sqlite', start_notifications=True)
    # Never run legacy.initialize(): it would mark GPU jobs interrupted from this CPU.
    # Inference stays in audio workers; only explicitly activated schedules run here.
    legacy.github_token = lambda: None
    longcat_jobs.start(vars(legacy))
    audio_video_sequence.start(vars(legacy))
    audio_jobs.start(vars(legacy))
    audio_workflows.start(vars(legacy))
    address = os.getenv('ECCO_STORAGE_BIND', '127.0.0.1')
    port = int(os.getenv('ECCO_STORAGE_PORT', '8888'))
    print('Ecco storage service ready; GPU independent; authentication required', flush=True)
    ThreadingHTTPServer((address, port), Handler).serve_forever()

if __name__ == '__main__': main()






