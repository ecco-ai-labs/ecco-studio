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


def plan(shots, duration):
    if not isinstance(shots, list) or not 1 <= len(shots) <= 60:
        raise ValueError('Select between 1 and 60 shots.')
    if not math.isfinite(duration) or not .2 <= duration <= 1200:
        raise ValueError('Choose a recording between 0.2 seconds and 20 minutes.')
    clips, cursor = [], 0.
    for index, shot in enumerate(shots):
        seconds = float(shot.get('seconds', 0))
        prompt = str(shot.get('prompt', '')).strip()
        if not math.isfinite(seconds) or seconds < .2 or not 1 <= len(prompt) <= 4000:
            raise ValueError('Each shot needs at least 0.2 seconds and a motion prompt.')
        count = math.ceil(seconds / 10)
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
        try: clips = plan(body.get('shots'),duration)
        except (ValueError, TypeError, AttributeError) as error: raise env['Problem'](str(error))
        if body.get('resolution','832x480') not in ('832x480','1280x720'):
            raise env['Problem']('Choose 480p or 720p.')
        if any(j['status'] in ('queued','running') for j in env['records']('audio_video_job')):
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
        request.update(resolution=body.get('resolution','832x480'),seed=int(body.get('seed',42)),clips=clips,duration=duration,shots=body['shots'])
        job = dict(id=jid,kind='audio_video_job',media='video',model=renderer.MODEL,story_id=sid,
                   title=audio.get('title','Audio video'),created=time.time(),status='queued',
                   progress='Queued',request=request,children=[],submission_hash=signature)
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
        subprocess.run(['ffmpeg','-y','-v','error','-i',str(source),'-an','-vf',
            'fps=25,tpad=stop_mode=clone:stop_duration=1,trim=end_frame='+str(clip['frames'])+',setpts=PTS-STARTPTS',
            '-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',str(directory/(str(i)+'.mp4'))],
            check=True,timeout=180)
    manifest = directory/'clips.txt'
    manifest.write_text(''.join("file '"+str(i)+".mp4'\n" for i in range(len(job['children']))))
    audio = env['get'](request['audio_id'],'asset')
    target = env['DATA']/'video-dev'/(job['id']+'.mp4')
    target.parent.mkdir(parents=True,exist_ok=True)
    temp = directory/'output.mp4'
    subprocess.run(['ffmpeg','-y','-v','error','-f','concat','-safe','1','-i',str(manifest),
        '-i',str(env['asset_path'](audio)),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac',
        '-t',str(request['duration']),'-movflags','+faststart',str(temp)],check=True,timeout=180)
    info=renderer.probe(temp)
    if abs(float(info['format']['duration'])-request['duration'])>.15:
        raise ValueError('Assembled video duration does not match the audio.')
    if not any(s['codec_type']=='audio' for s in info['streams']):
        raise ValueError('The assembled video is missing the original audio.')
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
    request=job['request']
    if job['children']:
        child=env['get'](job['children'][-1],'longcat_job')
        if child['status'] in ('queued','running'): return
        if child['status'] in ('failed','error'):
            job.update(status='failed',error=child.get('error','A video clip failed.'));env['save'](job);return
    index=len(job['children'])
    if index==len(request['clips']):
        job.update(progress='Assembling video with the original recording');env['save'](job)
        assemble(job,env);return
    clip=request['clips'][index]
    try:
        child=renderer.generate(dict(story_id=job['story_id'],audio_id=request['audio_id'],
            image_id=clip.get('image_id',request['image_id']),gpu=request['gpu'],prompt=clip['prompt'],
            resolution=request['resolution'],seed=request['seed'],
            audio_start=clip['start'],audio_end=clip['end'],
            request_id=hashlib.sha256((job['id']+':'+str(index)).encode()).hexdigest()[:32]),env)
    except env['Problem'] as error:
        if error.code in (429,503):
            job.update(progress='Waiting for the LongCat worker');env['save'](job);return
        raise
    job['children'].append(child['id'])
    job.update(status='running',progress='Rendering clip '+str(index+1)+' of '+str(len(request['clips'])))
    env['save'](job)


def start(env):
    def loop():
        while True:
            for job in env['records']('audio_video_job'):
                if job.get('status') not in ('queued','running'): continue
                try: advance(job,env)
                except Exception as error:
                    job.update(status='failed',error='Audio video assembly failed: '+str(error)[:240]);env['save'](job)
            time.sleep(3)
    threading.Thread(target=loop,daemon=True,name='audio-video-sequences').start()
