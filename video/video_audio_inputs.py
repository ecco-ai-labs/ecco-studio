"""Prepare an ordered sequence of existing audio recordings without regenerating speech."""
import hashlib
import subprocess
import time
from pathlib import Path


def prepare(ids, env, renderer):
    if not isinstance(ids, list) or not 1 <= len(ids) <= 8 or len(set(ids)) != len(ids):
        raise env['Problem']('Choose one to eight different recordings.')
    assets = [env['get'](i, 'asset') for i in ids]
    if any(a.get('deleted') or a.get('media') != 'audio' for a in assets):
        raise env['Problem']('A selected audio recording is unavailable.')
    if len(assets) == 1:
        return assets[0]
    durations = [float(renderer.probe(env['asset_path'](a))['format']['duration']) for a in assets]
    if sum(durations) > 1200:
        raise env['Problem']('Keep combined audio within twenty minutes.')
    aid = hashlib.sha256(('combined-audio:'+','.join(ids)).encode()).hexdigest()[:32]
    target = env['DATA']/'audio-dev'/(aid+'.wav')
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        args = ['ffmpeg','-y','-v','error']
        for a in assets: args += ['-i',str(env['asset_path'](a))]
        filters = ';'.join('[%d:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono[a%d]'%(i,i) for i in range(len(assets)))
        filters += ';'+''.join('[a%d]'%i for i in range(len(assets)))+'concat=n=%d:v=0:a=1[out]'%len(assets)
        temp = target.with_name(aid+'.pending.wav')
        subprocess.run(args+['-filter_complex',filters,'-map','[out]','-c:a','pcm_s16le',str(temp)],check=True,timeout=180)
        temp.replace(target)
    record = dict(id=aid,kind='asset',media='audio',stage='dev',created=time.time(),
        story_id=assets[0].get('story_id'),title='Combined speech',path='audio-dev/'+target.name,
        seconds=sum(durations),source_audio_ids=ids,settings={'lines':[
            line for a in assets for line in a.get('settings',{}).get('lines',[])]})
    env['save'](record)
    return record
