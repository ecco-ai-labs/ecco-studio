"""Render each model once in isolation, restore passage order, then mix once."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import wave
from audio_queue import read, write
from audio_schema import validate
from audio_worker import speech_progress


def stitch(request, segments, output, rate=48000):
    timeline, frames = [], 0
    with wave.open(str(output), 'wb') as final:
        final.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        for i, (source, bounds) in enumerate(segments):
            with wave.open(str(source), 'rb') as wav:
                start, end = [round(bounds[k] * wav.getframerate()) for k in ('start', 'end')]
                if end <= start or end > wav.getnframes() or wav.getsampwidth() != 2:
                    raise RuntimeError('Invalid rendered passage boundaries.')
                wav.setpos(start)
                raw = output.parent / f'passage-{i}.wav'
                with wave.open(str(raw), 'wb') as part:
                    part.setparams(wav.getparams())
                    part.writeframes(wav.readframes(end - start))
            converted = output.parent / f'passage-{i}-48k.wav'
            subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-i', str(raw), '-ar', str(rate), '-ac', '1', '-c:a', 'pcm_s16le', str(converted)], check=True, timeout=120)
            with wave.open(str(converted), 'rb') as part:
                pcm = part.readframes(part.getnframes())
            if i:
                silence = round(request['lines'][i].get('pause_before', request['pause']) * rate)
                final.writeframes(b'\0\0' * silence)
                frames += silence
            timeline.append({'start': frames / rate, 'end': (frames + len(pcm)//2) / rate})
            final.writeframes(pcm)
            frames += len(pcm)//2
    write(output.with_suffix('.timeline.json'), timeline)
    if request.get('soundtrack'):
        from audio_soundtrack import mix
        write(output.parent / 'progress.json', {'progress': 'Mixing music and effects'})
        mixed = output.with_name('soundtrack.wav')
        mix(request, output, timeline, mixed)
        mixed.replace(output)


def synthesize(request, output, runtime):
    from queue_worker import worker_command
    groups = {}
    for i, line in enumerate(request['lines']):
        groups.setdefault(line.get('model', request['model']), []).append((i, line))
    segments, completed = [None] * len(request['lines']), 0
    speech_progress(output, 0, len(segments))
    for model, items in groups.items():
        directory = output.parent / ('speech-' + model)
        directory.mkdir(exist_ok=True)
        # Children apply delivery DSP once. Parent alone inserts pauses and soundtrack.
        child = {k: v for k, v in request.items() if k not in ('mixed_models_version', 'soundtrack', 'sound_design_version')}
        child.update(model=model, pause=0, lines=[{k: v for k, v in line.items() if k not in ('model', 'pause_before')} for _, line in items])
        child = validate(child)
        write(directory / 'request.json', child)
        command, env = worker_command(child, directory)
        with (directory / 'worker.log').open('wb') as log:
            process = subprocess.Popen(command, env=env, stdout=log, stderr=subprocess.STDOUT)
            # Inherit parent's process group so coordinator timeout kills every child.
            while process.poll() is None:
                progress = read(directory / 'progress.json', {})
                count = progress.get('completed', 0)
                if type(count) is int and 0 <= count <= len(items):
                    speech_progress(output, completed + count, len(segments))
                time.sleep(1)
            if process.returncode:
                raise RuntimeError(model + ' failed; no partial recording was saved. See its worker log.')
        timeline = read(directory / 'output.timeline.json', [])
        if len(timeline) != len(items):
            raise RuntimeError(model + ' returned an incomplete passage timeline.')
        for (index, _), bounds in zip(items, timeline):
            segments[index] = (directory / 'output.wav', bounds)
        completed += len(items)
        speech_progress(output, completed, len(segments))
    stitch(request, segments, output)
    write(output.parent / 'provenance.json', {'mixed_models_version': 1, 'models': list(groups), 'compute': request['compute'], 'passage_models': [line.get('model', request['model']) for line in request['lines']]})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('request', 'output', 'runtime'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    synthesize(validate(json.loads(args.request.read_text())), args.output, args.runtime)
