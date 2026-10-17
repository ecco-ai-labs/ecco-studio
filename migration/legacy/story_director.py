"""Persisted story-to-shots workflow. Rendering is a distinct approved action."""
import json, subprocess, sys, time, shutil, uuid, os
from pathlib import Path

def planner_ready():
    root=Path('/workspace/ecco-models/story-planner-7b');index=root/'model.safetensors.index.json'
    try:return index.is_file() and all((root/f).is_file() for f in set(json.loads(index.read_text())['weight_map'].values()))
    except (OSError,ValueError,KeyError):return False

def plan_story(p,jid,g):
    g['job_update'](jid,progress='Planning shots from your story')
    # Release idle cached diffusion models before the short-lived text planner.
    queue=g['request'](g['COMFY']+'/queue')
    if not any(queue.values()):g['request'](g['COMFY']+'/free',{'unload_models':True,'free_memory':True})
    req={'story':p['story'],'count':p['count'],'seconds':p['seconds']}
    run=subprocess.run([sys.executable,str(g['ROOT']/'story_planner.py')],input=json.dumps(req),capture_output=True,text=True,timeout=900)
    (g['DATA']/'work'/('planner-'+jid+'.log')).write_text(run.stderr[-12000:])
    if run.returncode:raise g['Problem']('Story planning failed. Your story is saved; use Retry planning.',503)
    (g['DATA']/'work'/('planner-'+jid+'.json')).write_text(run.stdout)
    planned=json.loads(run.stdout)
    p['scenes']=clean_scenes(planned.get('scenes'),p['count'],p['seconds'],g)
    p['continuity']=g['text'](planned.get('continuity'),3000)

def clean_scenes(scenes,count,seconds,g):
    if not isinstance(scenes,list) or len(scenes)!=count: raise g['Problem']('Planner did not return the requested number of shots. Retry planning.')
    result=[]
    for s in scenes:
        result.append(dict(title=g['text'](s.get('title'),160),action=g['text'](s.get('action'),1800),frame=g['text'](s.get('frame'),2000),seconds=seconds/count,
            **g['clean_shot_controls']({'shot_size':s.get('shot_size','Wide shot'),'camera_move':s.get('camera_move','Locked-off camera'),'camera_angle':s.get('camera_angle','Eye level')})))
    return result

def busy(p,g):
    jid=p.get('job_id')
    return jid and g['get'](jid,'job')['status'] in ('queued','running')

def create(body,g):
    story=g['text'](body.get('story'),12000)
    count=g['number'](body.get('count',10),1,10,True)
    seconds=g['number'](body.get('seconds',30),count,count*5)
    title=g['text'](body.get('title','Untitled story'),160)
    style=g['text'](body.get('style','Cinematic realistic film'),200)
    supplied=body.get('scenes')
    scenes=clean_scenes(supplied,count,seconds,g) if supplied else []
    continuity=g['text'](body.get('continuity','Preserve character and object identity'),3000)
    with g['LOCK']:
        key=str(body.get('request_id',''))[:100]
        if key:
            existing=next((p for p in g['records']('story_plan') if p.get('request_id')==key),None)
            if existing:return existing
        sid=g['create_story']({'title':title,'summary':story[:4000]})['id']
        p=g['save'](g['new']('story_plan',story_id=sid,title=title,story=story,count=count,seconds=seconds,style=style,continuity=continuity,scenes=scenes,status='planning',revision=1,request_id=key))
        def work(jid):
            try:
                if not scenes:
                    plan_story(p,jid,g)
                p['status']='generating';g['save'](p)
                generate_frames(p,jid,g)
                return p['id']
            except Exception:
                latest=g['get'](p['id'],'story_plan');latest['status']='needs_attention';g['save'](latest);raise
        job=g['launch']('Create storyboard · '+title,work,metadata={'story_id':sid,'director_job':True})
        p['job_id']=job['id'];g['save'](p)
    return p

def generate_frames(p,jid,g,indices=None):
    indices=list(range(len(p['scenes']))) if indices is None else indices
    for i in indices:
        s=p['scenes'][i]
        if s.get('image_id'):continue
        g['job_update'](jid,progress=f'Creating shot {i+1} of {len(p["scenes"])}')
        prompt=f'{p["style"]}. {p["continuity"]}. {s["shot_size"]}, {s["camera_angle"]}. {s["frame"]}. Single cinematic frame, no panels, no captions.'
        anchor=next((x.get('image_id') for x in p['scenes'] if x.get('image_id')),None)
        if anchor:
            edit_prompt=('Make this specific change to the reference image: '+s['frame']+
                '. This is a NEW SHOT. Change body poses, object placement, crop and camera position to match the description above. '+
                s['shot_size']+', '+s['camera_angle']+'. Keep faces, clothing, object designs and colors consistent where visible, but DO NOT preserve the original pose or layout. '+
                p['style']+'. Single cinematic frame, no panels or captions.')
            image=g['edited_asset'](jid,[anchor],edit_prompt,p['story_id'],20261015+i+p['revision']*100,{'story_plan_id':p['id'],'shot_index':i})
        else:
            aid=uuid.uuid4().hex
            params=dict(model='qwen-image-2512',width=1664,height=928,sampler='euler',scheduler='simple',prompt=prompt,negative='text, watermark, duplicate people, distorted anatomy',seed=20261015,steps=35,cfg=4)
            graph=g['image_graph'](params,aid);paths=g['comfy_execute'](graph,jid)
            rel=f'image-dev/{aid}.png';shutil.copyfile(paths[0],g['DATA']/rel)
            image=g['save'](dict(id=aid,kind='asset',created=time.time(),media='image',stage='dev',story_id=p['story_id'],path=rel,prompt=prompt,settings=params,workflow=graph,job_id=jid,sync='pending',story_plan_id=p['id'],shot_index=i))
        s['image_id']=image['id'];g['save'](p)
    p['status']='review';g['save'](p);g['job_update'](jid,progress='All shot previews ready for your approval')

def update(body,g):
    with g['LOCK']:
        p=g['get'](body.get('plan_id',''),'story_plan')
        if busy(p,g):raise g['Problem']('Wait for the current storyboard job to finish.',409)
        if body.get('revision')!=p['revision']:raise g['Problem']('This storyboard changed. Refresh before saving.',409)
        scenes=clean_scenes(body.get('scenes'),len(p['scenes']),p['seconds'],g)
        for old,s in zip(p['scenes'],scenes):
            # Action/camera edits need no new still; visual edits invalidate just that shot.
            if s['frame']==old['frame'] and s['shot_size']==old['shot_size'] and old.get('image_id'):s['image_id']=old['image_id']
        p.update(scenes=scenes,revision=p['revision']+1,status='review',approved_revision=None,board_id=None)
        return g['save'](p)

def regenerate(body,g):
    with g['LOCK']:
        p=g['get'](body.get('plan_id',''),'story_plan')
        if busy(p,g):raise g['Problem']('Storyboard generation is already running.',409)
        if not p['scenes'] and body.get('index') is not None:raise g['Problem']('Retry planning before regenerating a shot.')
        if body.get('index') is not None:
            i=g['number'](body['index'],0,len(p['scenes'])-1,True)
            p['scenes'][i].pop('image_id',None)
        p.update(status='generating',revision=p['revision']+1,approved_revision=None,board_id=None)
        def work(jid):
            try:
                if not p['scenes']:
                    plan_story(p,jid,g)
                    p['status']='generating';g['save'](p)
                generate_frames(p,jid,g);return p['id']
            except Exception:p['status']='needs_attention';g['save'](p);raise
        job=g['launch']('Generate storyboard previews · '+p['title'],work,metadata={'story_id':p['story_id'],'director_job':True})
        p['job_id']=job['id'];g['save'](p);return p

def approve(body,g):
    with g['LOCK']:
        p=g['get'](body.get('plan_id',''),'story_plan')
        if body.get('confirmed') is not True:raise g['Problem']('Approve the storyboard before rendering.',409)
        if body.get('revision')!=p['revision']:raise g['Problem']('Review the latest storyboard revision before approving.',409)
        if busy(p,g) or not p['scenes'] or any(not s.get('image_id') for s in p['scenes']):raise g['Problem']('Every shot needs a completed preview before approval.',409)
        if p.get('approved_revision')==p['revision'] and p.get('board_id'):return p
        scenes=[]
        for s in p['scenes']:
            a=g['get'](s['image_id'],'asset')
            if a.get('deleted'):raise g['Problem']('A shot image is in Trash. Restore or regenerate it first.')
        for s in p['scenes']:
            a=g['get'](s['image_id'],'asset')
            if a['stage']!='prod':
                rel=a['path'].replace('-dev/','-prod/',1)
                os.replace(g['asset_path'](a),g['DATA']/rel)
                if a.get('github_path'):a['remove_github_path']=a['github_path']
                a.update(stage='prod',path=rel,sync='pending',approved_at=time.time());g['save'](a)
            scenes.append({**s,'motion':(s['action']+' '+p['continuity'])[:2000],'narration':s['action']})
        b=g['save_board']({'story_id':p['story_id'],'title':p['title'],'scenes':scenes})
        b.update(story_plan_id=p['id'],approved_revision=p['revision']);g['save'](b)
        p.update(status='approved',approved_revision=p['revision'],board_id=b['id'],approved_at=time.time());return g['save'](p)

def check_render(body,g):
    b=g['get'](body.get('board_id',''),'board')
    if b.get('story_plan_id'):
        p=g['get'](b['story_plan_id'],'story_plan')
        if p.get('board_id')!=b['id'] or p.get('approved_revision')!=p['revision']:
            raise g['Problem']('Storyboard changed after approval. Review and approve it again.',409)
