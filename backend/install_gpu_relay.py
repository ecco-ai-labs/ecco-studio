"""Install the GPU relay routes without replacing concurrent backend changes."""
from pathlib import Path
import shutil
p=Path('/opt/ecco-storage/backend/storage_api.py')
s=p.read_text()
if 'import gpu_relay' not in s:
    shutil.copy2(p,p.with_suffix('.before-gpu-relay.py'))
    s=s.replace('import audio_jobs','import audio_jobs\nimport gpu_relay')
    s=s.replace("'/api/audio/generate',", "'/api/audio/generate', '/api/gpu/request',")
    s=s.replace("'models_ready': {},", "'gpu_relay': gpu_relay.status(), 'models_ready': {},")
    s=s.replace("if path == '/api/audio/status':", "if path == '/api/gpu/status': return self.send(gpu_relay.status())\n            if path.startswith('/api/gpu/requests/'):\n                parts = path.split('/')\n                return self.send(gpu_relay.result(parts[-2], parts[-1]))\n            if path == '/api/audio/status':")
    s=s.replace("if path == '/api/audio/generate':", "if path == '/api/gpu/request': return self.send(gpu_relay.submit(body))\n            if path == '/api/audio/generate':")
    compile(s,str(p),'exec')
    assert "'/api/gpu/request'," in s and 'gpu_relay.status()' in s
    p.write_text(s)
print('GPU relay routes installed; existing handlers preserved')
