"""Deploy the series and per-episode-character schedule modes to the CPU pod.

Ships backend/audio_workflows.py (series schedules) and backend/audio_library.py
(optional labels) from the reviewed commit using the same
hash-checked, idle-only, roll-back-on-failure steps as deploy_audio_delivery.py.
No credential files are read or changed. No model downloads or GPU starts.

These depend on other modules. Before staging, this checks that
the pod already runs the same versions of them; if any differ it stops and lists
them, and --with-deps ships them together from the same commit instead.
"""
import argparse
import hashlib
from pathlib import Path

import deploy_audio_delivery as base

SOURCE_COMMIT = '07f77619438dfe6ff89e881d12796723a84cb1b5'
MODULE = {'backend/audio_workflows.py': '9678d4664a3a08d22a2ad380adeacd2b941f8481b5af75c4ee8bddb271dd90f4',
          'backend/audio_library.py': '74e486be58f6dc1599557874039c280de3cbfaaece928f6d86c9af9ff2922124'}
DEPENDENCIES = {
    'backend/audio_jobs.py': '8cb6bc14aba50787991a86d6d61bfec317c73ca4f7cf9d1ae1cc290ddc606e3b',
    'backend/news_research.py': '3f4f26a2f7b148173870f9338557af7dfda4a320921030cabdf1e4d6be39701c',
    'backend/openai_assistant.py': '5cfe04e957d2272bcf5f3105639072c09ffbbf2bbaa4af24a62c487fe189b028',
}


def stale_dependencies(app=None):
    """Dependencies whose file on the pod differs from the reviewed commit."""
    app = Path(app or base.APP)
    stale = []
    for name, expected in DEPENDENCIES.items():
        path = app / name
        found = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
        if found != expected:
            stale.append(name)
    return stale


def configure(with_deps):
    hashes = dict(MODULE)
    if with_deps:
        hashes.update(DEPENDENCIES)
    base.SOURCE_COMMIT = SOURCE_COMMIT
    base.SOURCE_HASHES = hashes
    return hashes


def prepare(api_pid, worker_pid, with_deps=False):
    stale = stale_dependencies()
    if stale and not with_deps:
        raise RuntimeError('These modules on the pod differ from ' + SOURCE_COMMIT[:7] + ': '
                           + ', '.join(stale) + '. Rerun prepare with --with-deps to ship them too.')
    configure(with_deps)
    base.prepare(api_pid, worker_pid)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    pre = sub.add_parser('prepare')
    pre.add_argument('--api-pid', type=int, required=True)
    pre.add_argument('--worker-pid', type=int, required=True)
    pre.add_argument('--with-deps', action='store_true')
    apply = sub.add_parser('activate')
    apply.add_argument('directory', type=Path)
    apply.add_argument('--with-deps', action='store_true')
    args = parser.parse_args()
    if args.action == 'prepare':
        prepare(args.api_pid, args.worker_pid, args.with_deps)
    else:
        configure(args.with_deps)
        base.activate(args.directory.resolve())
