#!/usr/bin/env python3
"""Recover one failed CPU soundtrack mix without repeating completed speech.

Only promotes actual, validated mixed audio. Keeps the original failed job,
speech and request in an audit directory, then lets the normal storage
finalizer create the generated Audio Library asset.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import wave


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def recover(root, database, job_id, worker_id, mixer=None):
    if not re.fullmatch(r'[a-f0-9]{32}', job_id):
        raise ValueError('Invalid job ID')
    directory = root / 'queue' / job_id
    request = json.loads((directory / 'request.json').read_text())
    original = json.loads((directory / 'status.json').read_text())
    if request.get('compute') != 'cpu' or request.get('worker_id') != worker_id:
        raise ValueError('Recovery is restricted to the explicitly selected CPU')
    if original.get('status') != 'error' or not original.get('error', '').startswith('Soundtrack mixing failed.'):
        raise ValueError('Only a failed soundtrack mix can be recovered')
    if not request.get('soundtrack'):
        raise ValueError('No soundtrack was requested')
    with sqlite3.connect(database) as db:
        row = db.execute('SELECT body FROM records WHERE id=? AND kind=?', (job_id, 'audio_job')).fetchone()
    if not row:
        raise ValueError('The saved audio job is missing')
    job = json.loads(row[0])
    if job.get('status') != 'error' or job.get('request') != request:
        raise ValueError('The saved job no longer matches the failed request')
    speech = directory / 'output.wav'
    timeline = json.loads((directory / 'output.timeline.json').read_text())
    if len(timeline) != len(request['lines']):
        raise ValueError('Speech generation is incomplete')
    with wave.open(str(speech)) as audio:
        seconds = audio.getnframes() / audio.getframerate()
    if not timeline or abs(timeline[-1]['end'] - seconds) > .001:
        raise ValueError('The complete speech ending is missing')
    audit = directory / ('mix-recovery-' + str(time.time_ns()))
    audit.mkdir(mode=0o700)
    for name in ['request.json', 'status.json', 'output.wav', 'output.timeline.json', 'sound-assets.json']:
        shutil.copy2(directory / name, audit / name)
    (audit / 'saved-job.json').write_text(row[0])
    output = directory / 'recovered.mix.wav'
    if mixer is None:
        sys.path.insert(0, str(root))
        from audio_soundtrack import mix
        mixer = mix
    try:
        mixer(request, speech, timeline, output)
    except subprocess.CalledProcessError as error:
        (audit / 'mixer-stderr.txt').write_bytes(error.stderr or b'')
        raise
    with wave.open(str(output)) as audio:
        mixed_seconds = audio.getnframes() / audio.getframerate()
        if audio.getframerate() != 48000 or audio.getnchannels() != 2 or mixed_seconds < seconds - .001:
            raise ValueError('The recovered mix is incomplete or has an invalid format')
    evidence = dict(recovered_at=time.time(), speech_sha256=digest(speech), mixed_sha256=digest(output),
                    seconds=mixed_seconds, passages=len(timeline), cues=len(request['soundtrack']),
                    original_error=original['error'], audit_directory=str(audit),
                    ffmpeg=subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0])
    (audit / 'recovery.json').write_text(json.dumps(evidence, indent=2))
    # The finalizer ignores error jobs. Re-open only this unchanged job after
    # a real mix exists; it will verify/copy/hash the output through its usual path.
    with sqlite3.connect(database, timeout=30) as db:
        db.execute('BEGIN IMMEDIATE')
        latest = db.execute('SELECT body FROM records WHERE id=? AND kind=?', (job_id, 'audio_job')).fetchone()
        if latest != row or json.loads((directory / 'status.json').read_text()) != original:
            raise ValueError('The job changed during recovery; no output was promoted')
        output.replace(speech)
        complete = dict(status='complete', compute='cpu', worker_pod=worker_id,
                        sha256=evidence['mixed_sha256'], recovery=evidence)
        temporary = directory / 'recovered.status.tmp'
        temporary.write_text(json.dumps(complete))
        temporary.replace(directory / 'status.json')
        job.update(status='running', progress='Recovered soundtrack mix; saving audio', error='', recovery=evidence)
        db.execute('UPDATE records SET body=? WHERE id=? AND kind=?', (json.dumps(job), job_id, 'audio_job'))
    return evidence


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--job-id', required=True)
    parser.add_argument('--worker-id', required=True)
    args = parser.parse_args()
    print(json.dumps(recover(args.root, args.database, args.job_id, args.worker_id), indent=2))
