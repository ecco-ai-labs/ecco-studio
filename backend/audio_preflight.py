"""Authenticated, non-generating validation of the exact Audio Studio plan."""
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time
import audio_jobs
from audio_schema import MODELS, required_models, validate
from sound_schema import validate as validate_sound
from audio_soundtrack import validate_tracks, duration

GIB = 1024**3

def verify(body, env):
    checks = []
    def add(id, label, status, detail):
        checks.append(dict(id=id,label=label,status=status,detail=detail))
    def check(id, label, action):
        try: add(id,label,'passed',action())
        except Exception as error: add(id,label,'failed',str(error)[:500] or 'Check failed. Try again.')
    speech = body.get('speech', {})
    sounds = body.get('sounds', [])
    if not isinstance(sounds,list) or len(sounds)>12:
        raise env['Problem']('Use up to 12 sound cues.')
    # Reuse generation validators. Never enqueue or invoke AI/inference.
    request = None
    try:
        request = validate(speech)
        env['story_id'](speech)
        add('script','Script and settings','passed',str(len(request['lines']))+' speech passages satisfy the generation limits.')
    except Exception as error:
        add('script','Script and settings','failed',str(error))
    clean_sounds = []
    for i, sound in enumerate(sounds):
        try:
            clean = validate_sound(sound)
            if clean['compute']!=speech.get('compute','cpu') or clean.get('worker_id','')!=speech.get('worker_id',''):
                raise ValueError('Sound generation must use the selected Audio Studio worker.')
            clean_sounds.append(clean)
            add('sound-'+str(i),'Sound: '+str(sound.get('title','Unnamed'))[:100],'passed','Description, model, duration and worker routing are valid; this file will be generated after Generate.')
        except Exception as error: add('sound-'+str(i),'Sound '+str(i+1),'failed',str(error))
    live = audio_jobs.queue.workers()
    selected = [w for w in live if w.get('compute')==speech.get('compute','cpu') and (not speech.get('worker_id') or w.get('pod')==speech['worker_id'])]
    worker = selected[0] if len(selected)==1 else None
    if not worker:
        add('compute','Selected compute','failed','Select one available worker. Its heartbeat must be newer than 30 seconds.')
    elif speech.get('worker_id') and worker.get('instance_routing_version')!=1:
        add('compute','Selected compute','failed','The selected worker needs the instance-routing update.'); worker=None
    else:
        add('compute','Selected compute','passed',str(worker.get('name') or worker.get('pod'))+' responded '+str(round(time.time()-worker['updated']))+' seconds ago.')
    if worker:
        needed = required_models(request) if request else set()
        missing = needed-set(audio_jobs.queue.supported(worker))
        missing_sounds = {s['model'] for s in clean_sounds}-set(audio_jobs.queue.sound_models(worker))
        if request is None: add('models','Models','blocked','Fix the script/settings check first.')
        elif missing or missing_sounds: add('models','Models','failed','Not installed and qualified on this worker: '+', '.join(sorted(missing|missing_sounds)))
        else: add('models','Models','passed','Qualified runtime advertised for '+', '.join(MODELS[m]['name'] for m in sorted(needed))+(('; sound models: '+', '.join(sorted({s['model'] for s in clean_sounds}))) if clean_sounds else '')+'. No new inference was run.')
        for field, label in [('mixed_models_version','Mixed character models'),('character_controls_version','Character controls'),('sound_design_version','Sound mixing')]:
            if request and request.get(field) and worker.get(field)!=1: add(field,label,'failed','Update the selected worker to apply these settings.')
        resources = worker.get('resources') or {}
        if resources.get('version')!=1 or not isinstance(resources.get('checked_at'),(int,float)) or not 0<=time.time()-resources['checked_at']<30:
            for id,label in [('memory','Memory'),('worker_storage','Worker storage'),('tools','Audio processing tools')]: add(id,label,'unverified','The worker must be updated to report fresh resource checks.')
        else:
            def memory():
                total,free=resources.get('memory_total_bytes'),resources.get('memory_available_bytes')
                if any(isinstance(n,bool) or not isinstance(n,(int,float)) or not math.isfinite(n) or n<0 for n in (total,free)): raise ValueError('Worker memory measurements are unavailable.')
                if clean_sounds and speech.get('compute','cpu')=='cpu' and total<16*GIB: raise ValueError('New sound generation needs a CPU with at least 16 GiB RAM.')
                if free<GIB: raise ValueError('Less than 1 GiB RAM is currently available. Wait for other work or choose a larger CPU.')
                return f'{free/GIB:.1f} GiB available of {total/GIB:.1f} GiB; known resource guards passed. This does not measure peak model memory.'
            if speech.get('compute','cpu')!='cpu': add('memory','Memory','unverified','GPU VRAM headroom is not reported by this worker. CPU RAM alone cannot verify GPU generation.')
            else: check('memory','Memory',memory)
            def worker_storage():
                for field in ('queue_free_bytes','temporary_free_bytes'):
                    n=resources.get(field)
                    if not isinstance(n,(int,float)) or not math.isfinite(n) or n<GIB: raise ValueError('The selected worker needs at least 1 GiB free in shared queue and temporary storage.')
                return 'Shared queue and temporary storage each have at least 1 GiB free.'
            check('worker_storage','Worker storage',worker_storage)
            add('tools','Audio processing tools','passed' if resources.get('ffmpeg') and resources.get('ffprobe') else 'failed','FFmpeg and FFprobe are available on the selected worker.' if resources.get('ffmpeg') and resources.get('ffprobe') else 'Install FFmpeg and FFprobe on the selected worker.')
    else:
        for id,label in [('models','Models'),('memory','Memory'),('worker_storage','Worker storage'),('tools','Audio processing tools')]: add(id,label,'blocked','The selected worker is unavailable.')
    if request:
        def voices():
            runtime=audio_jobs.queue.ROOT.parent/'models'
            identities=set()
            for line in request['lines']:
                model=line.get('model',request['model']);voice=next(v for v in MODELS[model]['voices'] if v['id']==line['voice']);identities.add((model,line['voice'],line['language']))
                path=runtime/'presets'/(line['voice']+'.pt') if model=='indic-mio' else runtime/'kokoro'/'voices'/(line['voice']+'.pt') if model=='kokoro' else runtime/'reference-voices'/voice['file'] if voice.get('file') else None
                if path and (not path.is_file() or not path.stat().st_size): raise ValueError(MODELS[model]['name']+': reference file for '+voice['name']+' is missing.')
                if model=='indicf5':
                    transcripts=json.loads((runtime/'reference-voices/transcripts.json').read_text())
                    if not transcripts.get(line['voice'],'').strip(): raise ValueError('IndicF5 reference transcript is missing for '+voice['name']+'.')
            return str(len(identities))+' model/voice/language combinations validated; required shared reference files exist.'
        check('voices','Voices and languages',voices)
    else: add('voices','Voices and languages','blocked','Fix script/settings to verify every selected voice.')
    def assets():
        tracks=body.get('existing_soundtrack',[])
        if not tracks:return 'No existing sound files are required.'
        if not request:raise ValueError('Fix the script/settings before checking sound files.')
        tracks=validate_tracks(tracks,len(request['lines']));root=env['DATA'].resolve();seen=set();total=0
        for cue in tracks:
            if cue['asset_id'] in seen:continue
            seen.add(cue['asset_id']);asset=env['get'](cue['asset_id'],'asset');path=(root/str(asset.get('path',''))).resolve()
            if asset.get('media')!='audio' or asset.get('deleted') or not path.is_relative_to(root) or not path.is_file() or path.suffix.lower() not in ('.wav','.mp3','.m4a','.ogg','.flac'):raise ValueError('An assigned sound is missing, deleted or is not an audio file.')
            total+=path.stat().st_size
            if not path.stat().st_size or total>64*1024**2:raise ValueError('Selected sound files must be nonempty and total no more than 64 MB.')
            try: duration(path)
            except Exception: raise ValueError('An assigned sound cannot be read by FFprobe. Replace it in Audio Library.')
        return str(len(seen))+' assigned audio files are readable and have a valid duration.'
    check('assets','Existing sound files',assets)
    def storage():
        roots=[env['DATA'],audio_jobs.queue.ROOT]
        for root in roots:
            if not root.is_dir() or shutil.disk_usage(root).free<GIB:raise ValueError('Workspace and queue storage each need at least 1 GiB free.')
            # Tiny random probe; always cleaned. No story, asset or queue job is created.
            with tempfile.TemporaryFile(dir=root) as probe:
                payload=os.urandom(64);probe.write(payload);probe.flush();os.fsync(probe.fileno());probe.seek(0)
                if probe.read()!=payload:raise ValueError('Storage read/write verification failed.')
        database=env['DATA']/'studio.sqlite'
        with sqlite3.connect(database.as_uri()+'?mode=rw',uri=True,timeout=1) as db:db.execute('BEGIN IMMEDIATE');db.rollback()
        return 'Workspace and queue read/write checks passed; recording database accepts a write transaction (rolled back).'
    check('storage','Recording storage',storage)
    def queue_check():
        active=[j for j in env['records']('audio_job') if j.get('status') in ('queued','running','cancelling')]
        if len(active)>=4:raise ValueError('All four audio queue slots are occupied. Wait or cancel a job.')
        return str(len(active))+' of 4 audio queue slots occupied. This check does not reserve a slot.'
    check('queue','Generation queue',queue_check)
    if body.get('needs_ai'):
        import openai_assistant
        ai=openai_assistant.status()
        add('ai','AI configuration','passed' if ai.get('enabled') is True else 'failed','The saved OpenAI connection is enabled for delivery preparation. Provider availability and quota are not tested.' if ai.get('enabled') is True else 'Connect OpenAI before generating the selected speaking directions.')
    return dict(version=1,checked_at=time.time(),checks=checks,ready=all(c['status']=='passed' for c in checks),generates_audio=False)
