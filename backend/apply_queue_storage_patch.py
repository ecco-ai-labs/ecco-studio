"""Add the generation queue to a deployed storage service. Safe to run twice.

Usage (storage pod): python3 apply_queue_storage_patch.py /workspace/ecco-storage-app
- copies migration/legacy/gen_queue.py and image_models.json from this checkout into the target's migration/legacy
- storage_api.py: GET /api/queue (the signed-in user's waiting pictures, 50 at a time) and GET /api/image-models
- gpu_relay.py: lets queue/move, queue/cancel and queue/cancel-all through to Studio (the only writer)
Backups are kept next to each changed file (*.before-queue-<time>).
"""
import re
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
STAMP = time.strftime('%Y%m%d%H%M%S')
ROUTES_BLOCK = """            # Generation queue (owner-approved 20 Nov 2026): the signed-in user's waiting pictures, 50 at a time.
            if path == '/api/queue':
                q = parse_qs(urlsplit(self.path).query)
                one = lambda k, d='': q.get(k, [d])[0]
                return self.send(gen_queue.page(one('owner'), one('model'), one('search'), int(one('offset', '0') or 0),
                                                int(one('limit', '50') or 50), path=legacy.DATA / 'studio.sqlite'))
            if path == '/api/image-models': return self.send(gen_queue.models_status(path=legacy.DATA / 'studio.sqlite'))
"""


def write(path, text):
    shutil.copy2(path, path.with_name(path.name + '.before-queue-' + STAMP))
    path.write_text(text)


def main(target):
    target = Path(target)
    for name in ('gen_queue.py', 'image_models.json'):
        shutil.copy2(HERE / 'migration/legacy' / name, target / 'migration/legacy' / name)
    api = target / 'backend/storage_api.py'
    src = api.read_text()
    if "'/api/queue'" not in src:
        anchor = "            if path == '/api/gpu/status': return self.send(gpu_relay.status())\n"
        if anchor not in src or 'import gpu_relay\n' not in src:
            raise SystemExit('storage_api.py anchors missing')
        src = src.replace(anchor, ROUTES_BLOCK + anchor, 1).replace('import gpu_relay\n', 'import gpu_relay\nimport gen_queue\n', 1)
        compile(src, str(api), 'exec')
        write(api, src)
        print('storage_api.py: queue routes added')
    relay = target / 'backend/gpu_relay.py'
    src = relay.read_text()
    if "'queue/move'" not in src:
        new = re.sub(r"(ROUTES = frozenset\(\(.*?)\)\)", r"\1,'queue/move','queue/cancel','queue/cancel-all'))", src, count=1, flags=re.S)
        if new == src:
            raise SystemExit('gpu_relay.py ROUTES anchor missing')
        compile(new, str(relay), 'exec')
        write(relay, new)
        print('gpu_relay.py: queue routes allowed')
    print('done')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/workspace/ecco-storage-app')
