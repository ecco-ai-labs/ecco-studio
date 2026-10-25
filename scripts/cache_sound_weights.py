"""Download public, revision-pinned sound weights into the prepared RAM cache.

No inference, credentials, model readiness flags or service restarts are involved.
This keeps large downloads off the nearly-full shared workspace volume.
"""
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

SOURCES = {
    'moss-soundeffect-v2': ('OpenMOSS-Team/MOSS-SoundEffect-v2.0', '934d6826b084c46a0d033402174d5f8ac4ed2519'),
    'ace-step-1.5': ('ACE-Step/Ace-Step1.5', 'ca1e85fe9430179831e6bc6be790c332190a3866'),
}


def download(model, repository, source_revision):
    base = Path('/workspace/ecco-audio/sounds') / model
    target = Path('/dev/shm/ecco-audio-runtime') / model / 'weights'
    if not (base / 'weights').is_symlink() or (base / 'weights').resolve() != target:
        raise RuntimeError('Expected temporary weight cache is missing.')
    with urllib.request.urlopen('https://huggingface.co/api/models/' + repository + '?blobs=true', timeout=120) as response:
        info = json.load(response)
    revision = info['sha']
    files = info['siblings']
    if model == 'ace-step-1.5':
        files = [item for item in files if item['rfilename'].startswith(('acestep-v15-turbo/', 'vae/', 'Qwen3-Embedding-0.6B/', 'README.md', 'LICENSE'))]
    for item in files:
        relative = Path(item['rfilename'])
        if relative.is_absolute() or '..' in relative.parts:
            raise RuntimeError('Invalid model file path.')
        path = target / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        expected = item.get('lfs', {}).get('sha256')
        if path.is_file() and expected:
            with path.open('rb') as handle:
                if hashlib.file_digest(handle, 'sha256').hexdigest() == expected:
                    continue
        temporary = path.with_name(path.name + '.download-part')
        address = 'https://huggingface.co/' + repository + '/resolve/' + revision + '/' + urllib.parse.quote(relative.as_posix(), safe='/')
        digest = hashlib.sha256()
        size = 0
        with urllib.request.urlopen(address, timeout=120) as response, temporary.open('wb') as handle:
            while chunk := response.read(4 * 1024 * 1024):
                handle.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        if expected and digest.hexdigest() != expected:
            raise RuntimeError('Model weight checksum mismatch: ' + relative.as_posix())
        if item.get('size') is not None and size != item['size']:
            raise RuntimeError('Model file size mismatch: ' + relative.as_posix())
        temporary.replace(path)
        print('CACHED', model, relative.as_posix(), size, flush=True)
    manifest = dict(source_revision=source_revision, model_revision=revision, model_repository=repository)
    (base / 'manifest.json').write_text(json.dumps(manifest) + '\n')
    print('WEIGHTS_DOWNLOADED_NOT_QUALIFIED', model, revision, flush=True)


if __name__ == '__main__':
    for model, (repository, source_revision) in SOURCES.items():
        download(model, repository, source_revision)
