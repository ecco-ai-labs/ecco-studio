"""Download pinned, public model snapshots to persistent inference storage."""
import json
from pathlib import Path
from urllib.request import urlopen
from huggingface_hub import HfApi, snapshot_download

root = Path('/workspace/ecco-audio/models')
root.mkdir(parents=True, exist_ok=True)
manifest = {}
for name, repo in [('model', 'SPRINGLab/Indic-Mio'), ('codec', 'Aratako/MioCodec-25Hz-24kHz')]:
    revision = HfApi().model_info(repo).sha
    snapshot_download(repo, revision=revision, local_dir=root / name)
    manifest[name] = {'repository': repo, 'revision': revision}
preset_revision = '2763e0910b251510c6b6a432e5f605d57c5e7ff5'
(root / 'presets').mkdir(exist_ok=True)
for voice in ['en_female', 'en_male']:
    with urlopen(f'https://raw.githubusercontent.com/Aratako/MioTTS-Inference/{preset_revision}/presets/{voice}.pt', timeout=60) as response:
        (root / 'presets' / (voice + '.pt')).write_bytes(response.read())
manifest['presets'] = preset_revision
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2))
print('Audio models and voice presets downloaded.', flush=True)
