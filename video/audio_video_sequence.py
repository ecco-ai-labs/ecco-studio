"""Render a saved recording in short LongCat clips, then mux its original audio."""
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import threading
import time
import longcat_jobs as renderer

LOCK = threading.RLock()


def plan(shots, duration, max_clip_seconds=10):
    if not isinstance(shots, list) or not 1 <= len(shots) <= 60:
        raise ValueError('Select between 1 and 60 shots.')
    if not math.isfinite(duration) or not .2 <= duration <= 1200:
        raise ValueError('Choose a recording between 0.2 seconds and 20 minutes.')
    max_clip_seconds = float(max_clip_seconds)
    if not math.isfinite(max_clip_seconds) or not 1 <= max_clip_seconds <= 1200:
        raise ValueError('Maximum seconds per clip must be between 1 and 1200.')
    clips, cursor = [], 0.
    for index, shot in enumerate(shots):
        seconds = float(shot.get('seconds', 0))
        prompt = str(shot.get('prompt', '')).strip()
        if not math.isfinite(seconds) or seconds < .2 or not 1 <= len(prompt) <= 4000:
            raise ValueError('Each shot needs at least 0.2 seconds and a motion prompt.')
        count = math.ceil(seconds / max_clip_seconds)
        for part in range(count):
            start = cursor + seconds * part / count
            end = cursor + seconds * (part + 1) / count
            clips.append(dict(start=start, end=end, prompt=prompt, shot=index,
                              frames=round(end*25)-round(start*25)))
        cursor += seconds
    if abs(cursor-duration) > .05:
        raise ValueError('Shot durations must cover the original audio exactly.')
    clips[-1]['end'] = duration
    clips[-1]['frames'] = round(duration*25)-round(clips[-1]['start']*25)
    return clips


def generate(body, env):
    with LOCK:
        key = body.get('request_id', '')
        if not isinstance(key, str) or not re.fullmatch('[a-f0-9]{32}', key):
            raise env['Problem']('Missing sequence request ID.')
        jid = hashlib.sha256(('audio-video:'+key).encode()).hexdigest()[:32]
        signature = hashlib.sha256(json.dumps(body,sort_keys=True).encode()).hexdigest()
        existing = next((j for j in env['records']('audio_video_job') if j['id']==jid), None)
        if existing:
            if existing['submission_hash'] != signature:
                raise env['Problem']('This request ID belongs to another video.',409)
            return renderer.public(existing)
        sid = env['story_id'](body)
        from video_audio_inputs import prepare
        audio = prepare(body.get('audio_ids') or [body.get('audio_id','')], env, renderer)
        image = env['get'](body.get('image_id',''),'asset')
        if audio.get('deleted') or audio.get('media')!='audio' or image.get('deleted') or image.get('media')!='image':
            raise env['Problem']('Choose an available recording and avatar.')
        if not any(w['pod']==body.get('gpu') for w in renderer.status()['workers']):
            raise env['Problem']('LongCat is not ready on the selected accelerator.',503)
        duration = float(renderer.probe(env['asset_path'](audio))['format']['duration'])
        try: clips = plan(body.get('shots'),duration,body.get('max_clip_seconds',10))
        except (ValueError, TypeError, AttributeError) as error: raise env['Problem'](str(error))
        if body.get('resolution','832x480') not in ('832x480','1280x720'):
            raise env['Problem']('Choose 480p or 720p.')
        if any(j['status'] in ('queued','running','cancelling') for j in env['records']('audio_video_job')):
            raise env['Problem']('An audio video sequence is already running.',429)
        for clip in clips:
            image_id = body['shots'][clip['shot']].get('image_id') or image['id']
            shot_image = env['get'](image_id, 'asset')
            if shot_image.get('deleted') or shot_image.get('media') != 'image':
                raise env['Problem']('A shot avatar is unavailable.')
            clip['image_id'] = image_id
        request = {k:body[k] for k in ('image_id','gpu')}
        request['audio_id'] = audio['id']
        request['source_audio_ids'] = body.get('audio_ids') or [audio['id']]
        request['video_reference_ids'] = body.get('video_reference_ids', [])
        request['max_clip_seconds'] = float(body.get('max_clip_seconds',10))
        request.update(resolution=body.get('resolution','832x480'),seed=int(body.get('seed',42)),clips=clips,duration=duration,shots=body['shots'])
        job = dict(id=jid,kind='audio_video_job',media='video',model=renderer.MODEL,story_id=sid,
                   title=audio.get('title','Audio video'),label='Video · LongCat sequence',created=time.time(),status='queued',
                   progress='Queued',request=request,children=[],submission_hash=signature)
        env['save'](job)
        return renderer.public(job)


def control(body, env):
    action = body.get('action')
    if action not in ('pause', 'resume', 'stop'):
        raise env['Problem']('Choose pause, resume or stop.')
    with LOCK:
        job = env['get'](body.get('job_id', ''), 'audio_video_job')
        if job.get('status') in ('done', 'failed', 'error', 'cancelled'):
            return renderer.public(job)
        if job.get('stop_requested'):
            return renderer.public(job)
        if action == 'stop':
            job.update(stop_requested=True, pause_requested=False,
                       progress='Stopping after current clip')
        elif action == 'pause':
            job.update(pause_requested=True, progress='Pausing after current clip')
        else:
            job.update(pause_requested=False, status='running' if job.get('children') else 'queued',
                       progress='Resuming sequence')
        env['save'](job)
        return renderer.public(job)


def assemble(job, env):
    request = job['request']
    directory = renderer.ROOT/'sequences'/job['id']
    directory.mkdir(parents=True,exist_ok=True)
    for i,(child,clip) in enumerate(zip(job['children'],request['clips'])):
        record = env['get'](child,'longcat_job')
        asset = env['get'](record['result'][0],'asset')
        source = env['asset_path'](asset)
        renderer.cancellation.run(directory, ['ffmpeg','-y','-v','error','-i',str(source),'-an','-vf',
            'fps=25,tpad=stop_mode=clone:stop_duration=1,trim=end_frame='+str(clip['frames'])+',setpts=PTS-STARTPTS',
            '-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',str(directory/(str(i)+'.mp4'))],
            check=True,timeout=180)
    manifest = directory/'clips.txt'
    manifest.write_text(''.join("file '"+str(i)+".mp4'\n" for i in range(len(job['children']))))
    audio = env['get'](request['audio_id'],'asset')
    target = env['DATA']/'video-dev'/(job['id']+'.mp4')
    target.parent.mkdir(parents=True,exist_ok=True)
    temp = directory/'output.mp4'
    renderer.cancellation.run(directory, ['ffmpeg','-y','-v','error','-f','concat','-safe','1','-i',str(manifest),
        '-i',str(env['asset_path'](audio)),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac',
        '-t',str(request['duration']),'-movflags','+faststart',str(temp)],check=True,timeout=180)
    info=renderer.probe(temp)
    if abs(float(info['format']['duration'])-request['duration'])>.15:
        raise ValueError('Assembled video duration does not match the audio.')
    if not any(s['codec_type']=='audio' for s in info['streams']):
        raise ValueError('The assembled video is missing the original audio.')
    renderer.cancellation.check(directory)
    import shutil
    pending=target.with_suffix('.tmp');shutil.copyfile(temp,pending);pending.replace(target)
    aid=hashlib.sha256(('audio-video-asset:'+job['id']).encode()).hexdigest()[:32]
    env['save'](dict(id=aid,kind='asset',media='video',stage='dev',story_id=job['story_id'],
        created=time.time(),title=job['title'],path='video-dev/'+target.name,job_id=job['id'],
        mode='longcat',has_audio=True,seconds=request['duration'],source_audio_id=request['audio_id'],
        settings={'model':renderer.MODEL,'shots':request['shots'],'avatar_id':request['image_id']},sync='pending'))
    job.update(status='done',result=[aid],progress='Video ready · original audio retained',finished=time.time())
    env['save'](job)


def advance(job, env):
    with LOCK:
        job = env['get'](job['id'], 'audio_video_job')
        if job.get('status') not in ('queued', 'running', 'paused', 'cancelling'): return
        _advance(job, env)

def _advance(job, env):
    request=job['request']
    immediate=(renderer.ROOT/'sequences'/job['id']/'cancel.json').exists()
    if immediate:
        job.update(stop_requested=True, pause_requested=False)
    if job['children']:
        child=env['get'](job['children'][-1],'longcat_job')
        if immediate: child=renderer.cancel(child['id'],env)
        if child['status'] in ('queued','running','cancelling'):
            if immediate:
                job.update(status='cancelling',progress='Stopping…');env['save'](job)
            return
        if child['status']=='cancelled': job['stop_requested']=True
        if child['status'] in ('failed','error') and not job.get('stop_requested'):
            job.update(status='failed',error=child.get('error','A video clip failed.'),error_details=renderer.with_error_details(child).get('error_details'),finished=time.time());env['save'](job);return
    if job.get('stop_requested'):
        job.update(status='cancelled', progress='Stopped; completed clips retained', finished=time.time())
        env['save'](job); return
    if job.get('pause_requested'):
        job.update(status='paused', progress='Paused between clips')
        env['save'](job); return
    index=len(job['children'])
    if index==len(request['clips']):
        job.update(progress='Assembling video with the original recording');env['save'](job)
        assemble(job,env);return
    clip=request['clips'][index]
    try:
        child=renderer.generate(dict(story_id=job['story_id'],audio_id=request['audio_id'],
            image_id=clip.get('image_id',request['image_id']),gpu=request['gpu'],prompt=clip['prompt'],
            resolution=request['resolution'],seed=request['seed'],
            audio_start=clip['start'],audio_end=clip['end'],max_clip_seconds=request.get('max_clip_seconds',10),
            request_id=hashlib.sha256((job['id']+':'+str(index)).encode()).hexdigest()[:32]),env)
    except env['Problem'] as error:
        if error.code in (429,503):
            job.update(progress='Waiting for the LongCat worker');env['save'](job);return
        raise
    if (renderer.ROOT/'sequences'/job['id']/'cancel.json').exists():
        renderer.cancel(child['id'],env)
    job['children'].append(child['id'])
    job.update(status='running',progress='Rendering clip '+str(index+1)+' of '+str(len(request['clips'])))
    env['save'](job)


def start(env):
    def loop():
        while True:
            for job in env['records']('audio_video_job'):
                if job.get('status') not in ('queued','running','paused','cancelling'): continue
                try: advance(job,env)
                except renderer.cancellation.Cancelled:
                    job=env['get'](job['id'],'audio_video_job')
                    job.update(status='cancelled',progress='Stopped; completed clips retained',finished=time.time());env['save'](job)
                except Exception as error:
                    job.update(status='failed',error='Audio video assembly failed: '+renderer.redact_error(error),error_details={'component':'video assembly','exception_type':type(error).__name__,'traceback':renderer.redact_error(__import__('traceback').format_exc()),'occurred_at':time.time()},finished=time.time());env['save'](job)
            time.sleep(3)
    threading.Thread(target=loop,daemon=True,name='audio-video-sequences').start()





def cancel(jid, env):
    job=env['get'](jid,'audio_video_job')
    if job['status'] in ('done','failed','error','cancelled'): return renderer.public(job)
    # Written before the lock so an assembly subprocess can stop while holding it.
    renderer.write(renderer.ROOT/'sequences'/jid/'cancel.json',dict(reason='Stopped by user'))
    with LOCK:
        job=env['get'](jid,'audio_video_job')
        if job['status'] in ('done','failed','error','cancelled'): return renderer.public(job)
        job.update(stop_requested=True,pause_requested=False,status='cancelling',progress='Stopping…')
        env['save'](job)
        _advance(job,env)
        return renderer.public(env['get'](jid,'audio_video_job'))
