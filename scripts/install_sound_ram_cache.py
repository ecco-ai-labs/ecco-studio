"""Finish the pinned sound install with Python files/weights in temporary RAM.

For the existing 64 GB CPU only. Native libraries stay on the executable volume;
no mount/security flags change. RAM files must be restored after pod restart.
This does not mark a model verified: the ordinary inference verifier still runs.
"""
import argparse
import hashlib
import os
from pathlib import Path
import runpy
import shutil
import sys


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def finish(model):
    base = Path('/workspace/ecco-audio')
    sys.path.insert(0, str(base))
    runtime = base / 'sounds' / model / 'cpu-venv'
    ram = Path('/dev/shm/ecco-sound-install-snapshot') / model / 'cpu-venv'
    native = base / 'sound-native-cache' / model
    limit = Path('/sys/fs/cgroup/memory.max').read_text().strip()
    if not limit.isdigit() or int(limit) < 48 * 1024**3:
        raise RuntimeError('This cache layout requires the 64 GB CPU worker.')
    if not runtime.is_symlink() or runtime.resolve() != ram or not (ram / 'pyvenv.cfg').is_file():
        raise RuntimeError('Expected preserved temporary installation is missing.')
    if not (runtime / 'bin/python').is_file():
        raise RuntimeError('Existing interpreter is missing; do not create a new runtime here.')

    def relocate_native():
        count = 0
        for path in ram.rglob('*'):
            if path.is_symlink() or not path.is_file():
                continue
            with path.open('rb') as handle:
                executable = handle.read(4) == b'\x7fELF'
            if not executable:
                continue
            destination = native / path.relative_to(ram)
            destination.parent.mkdir(parents=True, exist_ok=True)
            expected = digest(path)
            if not destination.is_file() or digest(destination) != expected:
                temporary = destination.with_name(destination.name + '.installing')
                shutil.copy2(path, temporary)
                if digest(temporary) != expected:
                    raise RuntimeError('Native library copy did not verify.')
                temporary.replace(destination)
            path.unlink()
            path.symlink_to(destination)
            count += 1
        print('NATIVE_LIBRARIES_PLACED', model, count, flush=True)

    os.environ.update(PYTHONDONTWRITEBYTECODE='1', PIP_NO_CACHE_DIR='1',
                      PIP_NO_COMPILE='1', TMPDIR='/tmp')
    module = runpy.run_path(str(base / 'install_sound_models.py'))
    original = module['run']

    def run(command, **kwargs):
        args = [str(value) for value in command]
        if len(args) == 4 and args[1:3] == ['-m', 'venv']:
            if Path(args[3]) != runtime:
                raise RuntimeError('Unexpected virtual environment target.')
            return  # Reuse the already-created, preserved environment.
        original(command, **kwargs)
        if len(args) > 3 and args[1:3] == ['-m', 'pip']:
            relocate_native()

    relocate_native()
    module['install'].__globals__['run'] = run
    module['install'](model, 'cpu', base)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True, choices=['moss-soundeffect-v2', 'ace-step-1.5'])
    finish(parser.parse_args().model)
