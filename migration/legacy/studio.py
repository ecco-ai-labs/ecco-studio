"""ECCO AI Labs Studio: private single-operator ComfyUI production workspace.
Run behind authenticated Jupyter proxy; never expose this server directly.
"""
import base64, concurrent.futures, copy, hashlib, json, os, re, secrets, shutil
import sqlite3, subprocess, threading, time, urllib.error, urllib.parse, urllib.request, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = Path(os.getenv('ECCO_DATA', '/workspace/ecco-studio-data')).resolve()
COMFY = os.getenv('COMFY_URL', 'http://127.0.0.1:8188').rstrip('/')
COMFY_ROOT = Path(os.getenv('COMFY_ROOT', '/workspace/ComfyUI')).resolve()
PUBLIC = os.getenv('ECCO_PUBLIC_URL', '').rstrip('/')
ORIGIN = urllib.parse.urlsplit(PUBLIC)
ORIGIN = f'{ORIGIN.scheme}://{ORIGIN.netloc}'
REPO = 'ecco-ai-labs/diffusion_models'
CHANNEL_HANDLE = 'EccoAILabs'
RATE = float(os.getenv('ECCO_HOURLY_RATE', '1.794'))
LOCK = threading.RLock()
POOL = concurrent.futures.ThreadPoolExecutor(max_workers=1)
CSRF = secrets.token_urlsafe(32)
OAUTH_STATES = {}

class Problem(Exception):
    def __init__(self, message, code=400): self.message, self.code = message, code

def process_start(pid):
    try:return Path(f'/proc/{int(pid)}/stat').read_text().rsplit(')',1)[1].split()[19]
    except (OSError,ValueError,TypeError,IndexError):return None

def job_owner_alive(job):
    if job.get("remote_worker"): return __import__("gpu_dispatch").alive(job)
    return bool(job.get('owner_start') and process_start(job.get('owner_pid'))==job['owner_start'])

def initialize():
    DATA.mkdir(parents=True, exist_ok=True)
    for folder in ['image-dev','image-prod','video-dev','video-prod','work','storyboards']:
        (DATA / folder).mkdir(exist_ok=True)
    with sqlite3.connect(DATA / 'studio.sqlite') as db:
        db.execute('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT, body TEXT)')
    for record in records('job'):
        if record['status'] in ('queued','running') and not job_owner_alive(record):
            record.update(status='interrupted', error='Server restarted. Check Comfy queue before submitting again.')
            save(record)

def save(record):
    with LOCK, sqlite3.connect(DATA / 'studio.sqlite') as db:
        db.execute('INSERT OR REPLACE INTO records VALUES (?,?,?)',
                   (record['id'], record['kind'], json.dumps(record)))
    return record

def records(kind=None):
    with LOCK, sqlite3.connect(DATA / 'studio.sqlite') as db:
        rows = db.execute('SELECT body FROM records'+(' WHERE kind=?' if kind else ''), (kind,) if kind else ()).fetchall()
    return [json.loads(row[0]) for row in rows]

def get(rid, kind=None):
    if not re.fullmatch(r'[a-f0-9]{32}', rid): raise Problem('Invalid record ID',404)
    with LOCK, sqlite3.connect(DATA / 'studio.sqlite') as db:
        row=db.execute('SELECT body FROM records WHERE id=?',(rid,)).fetchone()
    if not row: raise Problem('Record not found',404)
    result=json.loads(row[0])
    if kind and result['kind'] != kind: raise Problem('Wrong record type',400)
    return result

def new(kind, **kw): return dict(id=uuid.uuid4().hex, kind=kind, created=time.time(), **kw)

def request(url, payload=None, headers=None, method=None, binary=False, timeout=60):
    data=json.dumps(payload).encode() if payload is not None else None
    h={'Content-Type':'application/json', **(headers or {})}
    req=urllib.request.Request(url,data=data,headers=h,method=method)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:
            body=r.read()
            return body if binary else (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        # Never expose provider responses that might contain credentials.
        raise Problem(f'Upstream service returned HTTP {e.code}; check its permissions and configuration.',502)

def asset_path(asset):
    path=(DATA/asset['path']).resolve()
    if not path.is_relative_to(DATA) or not path.is_file(): raise Problem('Asset file unavailable',404)
    return path

def number(value, minimum, maximum, integer=False):
    try: result=int(value) if integer else float(value)
    except (ValueError,TypeError): raise Problem('Invalid numeric setting')
    if not minimum <= result <= maximum: raise Problem(f'Setting must be between {minimum} and {maximum}')
    return result

def text(value, maximum=4000):
    if not isinstance(value,str) or not value.strip() or len(value)>maximum: raise Problem('Text is missing or too long')
    return value.strip()

def node(cls, **inputs): return {'class_type':cls,'inputs':inputs}

QWEN_FILES=('diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors','text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors','vae/qwen_image_vae.safetensors')
def qwen_ready():
    return all((COMFY_ROOT/'models'/name).is_file() for name in QWEN_FILES)

def qwen_image_graph(p, ident):
    return {
        '1':node('UNETLoader',unet_name='qwen_image_2512_fp8_e4m3fn.safetensors',weight_dtype='default'),
        '2':node('ModelSamplingAuraFlow',model=['1',0],shift=3.1),
        '3':node('CLIPLoader',clip_name='qwen_2.5_vl_7b_fp8_scaled.safetensors',type='qwen_image',device='default'),
        '4':node('VAELoader',vae_name='qwen_image_vae.safetensors'),
        '5':node('CLIPTextEncode',text=p['prompt'],clip=['3',0]),
        '6':node('CLIPTextEncode',text=p['negative'],clip=['3',0]),
        '7':node('EmptySD3LatentImage',width=p['width'],height=p['height'],batch_size=1),
        '8':node('KSampler',model=['2',0],positive=['5',0],negative=['6',0],latent_image=['7',0],seed=p['seed'],steps=p['steps'],cfg=p['cfg'],sampler_name='euler',scheduler='simple',denoise=1),
        '9':node('VAEDecode',samples=['8',0],vae=['4',0]),
        '10':node('SaveImage',images=['9',0],filename_prefix=f'ecco-studio/{ident}')}

def base_image_graph(p, ident):
    if p.get('model')=='qwen-image-2512': return qwen_image_graph(p,ident)
    return {
        '1':node('CheckpointLoaderSimple',ckpt_name='sd_xl_base_1.0.safetensors'),
        '2':node('CLIPTextEncode',text=p['prompt'],clip=['1',1]),
        '3':node('CLIPTextEncode',text=p['negative'],clip=['1',1]),
        '4':node('EmptyLatentImage',width=p.get('width',1024),height=p.get('height',576),batch_size=1),
        '5':node('KSampler',model=['1',0],positive=['2',0],negative=['3',0],latent_image=['4',0],seed=p['seed'],steps=p['steps'],cfg=p['cfg'],sampler_name=p.get('sampler','dpmpp_2m'),scheduler=p.get('scheduler','karras'),denoise=1),
        '6':node('VAEDecode',samples=['5',0],vae=['1',2]),
        '7':node('SaveImage',images=['6',0],filename_prefix=f'ecco-studio/{ident}')}

def image_graph(p,ident):
    graph=base_image_graph(p,ident)
    if p.get('source_file'):
        qwen=p.get('model')=='qwen-image-2512'
        vae=['4',0] if qwen else ['1',2]
        graph['20']=node('LoadImage',image=p['source_file'])
        graph['21']=node('ImageScale',image=['20',0],upscale_method='lanczos',width=p['width'],height=p['height'],crop='center')
        graph['22']=node('VAEEncode',pixels=['21',0],vae=vae)
        sampler=graph['8' if qwen else '5']['inputs']
        sampler['latent_image']=['22',0];sampler['denoise']=p['strength']
    return graph

def shot_prompt(scene):
    parts=([('Scene action: '+scene['narration'].strip())] if scene.get('narration','').strip() else [])+[scene['motion']]
    for key,label in [('shot_size','Framing'),('camera_angle','Camera angle'),('camera_move','Camera movement')]:
        if scene.get(key): parts.append(label+': '+scene[key]+'.')
    for subject in scene.get('subjects',[]):
        parts.append('Subject '+subject['name']+': '+subject['description']+'. Action: '+subject['action']+'.')
    return ' '.join(parts)

def wan_a14b_graph(scene,image,ident,seed,settings):
    steps=settings.get('steps',20); split=steps//2
    frames=4*round(scene['seconds']*settings.get('fps',16)/4)+1
    return {
        '1':node('UNETLoader',unet_name='wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',weight_dtype='default'),
        '2':node('UNETLoader',unet_name='wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',weight_dtype='default'),
        '3':node('ModelSamplingSD3',model=['1',0],shift=8.0),
        '4':node('ModelSamplingSD3',model=['2',0],shift=8.0),
        '5':node('CLIPLoader',clip_name='umt5_xxl_fp8_e4m3fn_scaled.safetensors',type='wan',device='default'),
        '6':node('VAELoader',vae_name='wan_2.1_vae.safetensors'),
        '7':node('CLIPTextEncode',clip=['5',0],text=shot_prompt(scene)),
        '8':node('CLIPTextEncode',clip=['5',0],text='blurry, distortion, flicker, text, watermark, deformed hands, extra limbs, frozen motion, abrupt cuts'),
        '9':node('LoadImage',image=image),
        '10':node('WanImageToVideo',positive=['7',0],negative=['8',0],vae=['6',0],start_image=['9',0],width=settings.get('width',1280),height=settings.get('height',720),length=frames,batch_size=1),
        '11':node('KSamplerAdvanced',model=['3',0],positive=['10',0],negative=['10',1],latent_image=['10',2],add_noise='enable',noise_seed=seed,steps=steps,cfg=settings.get('cfg',3.5),sampler_name='euler',scheduler='simple',start_at_step=0,end_at_step=split,return_with_leftover_noise='enable'),
        '12':node('KSamplerAdvanced',model=['4',0],positive=['10',0],negative=['10',1],latent_image=['11',0],add_noise='disable',noise_seed=seed,steps=steps,cfg=settings.get('cfg',3.5),sampler_name='euler',scheduler='simple',start_at_step=split,end_at_step=steps,return_with_leftover_noise='disable'),
        '13':node('VAEDecodeTiled',samples=['12',0],vae=['6',0],tile_size=512,overlap=64,temporal_size=32,temporal_overlap=8),
        '14':node('SaveImage',images=['13',0],filename_prefix=f'ecco-studio/{ident}')}

def video_graph(scene, image, ident, seed, settings=None):
    settings=settings or {}
    if settings.get("model")=="wan-a14b": return wan_a14b_graph(scene,image,ident,seed,settings)
    # 704x384 pilot mode. Wan's higher-resolution quality target is 1280x704.
    frames=8*round(scene['seconds']*24/8)+1
    return {
        '1':node('UNETLoader',unet_name='wan2.2_ti2v_5B_fp16.safetensors',weight_dtype='default'),
        '2':node('ModelSamplingSD3',model=['1',0],shift=8.0),
        '3':node('CLIPLoader',clip_name='umt5_xxl_fp8_e4m3fn_scaled.safetensors',type='wan',device='default'),
        '4':node('VAELoader',vae_name='wan2.2_vae.safetensors'),
        '5':node('CLIPTextEncode',clip=['3',0],text=shot_prompt(scene)),
        '6':node('CLIPTextEncode',clip=['3',0],text='blurry, distortion, flicker, text, watermark'),
        '7':node('LoadImage',image=image),
        '8':node('Wan22ImageToVideoLatent',vae=['4',0],start_image=['7',0],width=settings.get("width",704),height=settings.get("height",384),length=frames,batch_size=1),
        '9':node('KSampler',model=['2',0],positive=['5',0],negative=['6',0],latent_image=['8',0],seed=seed,steps=settings.get('steps',20),cfg=settings.get('cfg',5.0),sampler_name='uni_pc',scheduler='simple',denoise=1),
        '10':node('VAEDecode',samples=['9',0],vae=['4',0]),
        '11':node('SaveImage',images=['10',0],filename_prefix=f'ecco-studio/{ident}')}

def comfy_execute(graph, job_id):
    result=request(COMFY+'/prompt',{'prompt':graph,'client_id':'ecco-studio'})
    if 'prompt_id' not in result: raise Problem('Comfy rejected the workflow',502)
    job=get(job_id); job['comfy_prompt_id']=result['prompt_id']; save(job)
    deadline=time.monotonic()+3600
    while time.monotonic()<deadline:
        if get(job_id,'job').get('cancel_requested'): raise Problem('Generation cancelled',409)
        history=request(COMFY+'/history/'+result['prompt_id'])
        entry=history.get(result['prompt_id'])
        if entry:
            if any(m[0]=='execution_interrupted' for m in entry.get('status',{}).get('messages',[])): raise Problem('Generation was interrupted',409)
            if entry.get('status',{}).get('status_str')=='error': raise Problem('Comfy generation failed. Inspect Comfy server log.',502)
            if entry.get('status',{}).get('completed'):
                paths=[]
                for output in entry.get('outputs',{}).values():
                    for item in output.get('images',[]):
                        path=(COMFY_ROOT/'output'/item.get('subfolder','')/item['filename']).resolve()
                        if not path.is_relative_to(COMFY_ROOT/'output') or not path.is_file(): raise Problem('Invalid Comfy output',502)
                        paths.append(path)
                if not paths: raise Problem('Comfy returned no images',502)
                return paths
        time.sleep(2)
    raise Problem('Generation timed out; Comfy may still be running. Check its queue before retrying.',504)

def job_update(jid, **kw):
    with LOCK:
        record=get(jid,'job'); record.update(kw); save(record)

def launch(label, fn, metadata=None):
    with LOCK:
        if len([j for j in records('job') if j['status'] in ('queued','running')])>=8: raise Problem('Queue is full',429)
        job=save(new('job',label=label,status='queued',owner_pid=os.getpid(),owner_start=process_start(os.getpid()),**(metadata or {})))
    def run():
        start=time.monotonic(); job_update(job['id'],status='running',started=time.time())
        try:
            result=fn(job['id'])
            job_update(job['id'],status='done',result=result)
            if github_token() and label != 'Sync media to GitHub':
                try: sync_github(job['id'])
                except Exception: job_update(job['id'],sync_warning='Saved locally; GitHub sync failed. Use Sync to GitHub to retry.')
        except Exception as exc:
            message=exc.message if isinstance(exc,Problem) else f'{type(exc).__name__}: operation failed; check server configuration.'
            job_update(job['id'],status='cancelled' if get(job['id'],'job').get('cancel_requested') else 'failed',error=message)
        finally:
            elapsed=time.monotonic()-start
            job_update(job['id'],seconds=round(elapsed,2),estimated_compute_usd=round(elapsed*RATE/3600,4))
    POOL.submit(run)
    return job

LEGACY_STORY = '00000000000000000000000000000001'

def story_id(body):
    sid = body.get('story_id') or LEGACY_STORY
    if sid != LEGACY_STORY: get(sid, 'story')
    return sid

def create_story(body):
    return save(new('story', title=text(body.get('title'),160), summary=str(body.get('summary',''))[:4000]))

def archive_story(body):
    sid=body.get('story_id','')
    if sid==LEGACY_STORY:
        try:story=get(sid,'story')
        except Problem:story=dict(id=sid,kind='story',created=time.time(),title='The Fisherman and the Jinni',summary='')
    else:story=get(sid,'story')
    story['deleted']=not bool(body.get('restore',False));save(story)
    return story

def resolution(value, allowed):
    if value not in allowed: raise Problem('Unsupported resolution')
    return tuple(map(int,value.split('x')))

def create_image(body):
    body=__import__('image_library').prepare_image(body,globals())
    sid=story_id(body)
    model=body.get('model','sdxl')
    if model not in ('sdxl','qwen-image-2512') or (model=='qwen-image-2512' and not qwen_ready()): raise Problem('Selected image model is not installed and integrated',503)
    is_qwen=model=='qwen-image-2512'
    sizes=('1664x928','1328x1328','928x1664') if is_qwen else ('1024x576','1024x1024','768x1024')
    width,height=resolution(body.get('resolution',sizes[0]),sizes)
    sampler=body.get('sampler','euler' if is_qwen else 'dpmpp_2m'); scheduler=body.get('scheduler','simple' if is_qwen else 'karras')
    if is_qwen:
        if sampler!='euler' or scheduler!='simple': raise Problem('Qwen quality workflow uses Euler / simple')
    elif sampler not in ('dpmpp_2m','euler') or scheduler not in ('karras','normal'): raise Problem('Unsupported sampler or scheduler')
    p={'model':model,'width':width,'height':height,'sampler':sampler,'scheduler':scheduler,'prompt':text(body.get('prompt')), 'negative':str(body.get('negative','blurry, bad anatomy, watermark'))[:2000],
       'seed':number(body.get('seed',42),0,2**53-1,True),'steps':number(body.get('steps',50 if is_qwen else 25),5,60,True),'cfg':number(body.get('cfg',4 if is_qwen else 7),1,15)}
    p.update(image_style=body['image_style'],source_prompt=body['source_prompt'])
    source_id=body.get('source_asset_id')
    if source_id:
        source=get(source_id,'asset')
        if source.get('deleted') or source.get('media')!='image' or source.get('story_id',LEGACY_STORY)!=sid: raise Problem('Choose an existing image from this story')
        p['source_asset_id']=source_id;p['strength']=number(body.get('strength',0.35),0.05,0.95)
    def generate(jid):
        aid=uuid.uuid4().hex; source_file=None;params=dict(p)
        if source_id:
            source_file=COMFY_ROOT/'input'/f'ecco-refine-{aid}.png'
            shutil.copyfile(asset_path(get(source_id,'asset')),source_file);params['source_file']=source_file.name
        try:
            graph=image_graph(params,aid)
            paths=comfy_execute(graph,jid)
        finally:
            if source_file: source_file.unlink(missing_ok=True)
        rel=f'image-dev/{aid}.png'; shutil.copyfile(paths[0],DATA/rel)
        return save(dict(id=aid,kind='asset',created=time.time(),media='image',stage='dev',story_id=sid,path=rel,prompt=p['prompt'],settings=p,job_id=jid,sync='pending',workflow=graph))['id']
    return launch('Generate '+('Qwen-Image-2512' if is_qwen else 'SDXL')+' image',generate)

def clean_shot_controls(scene):
    options={'shot_size':['','Wide shot','Medium shot','Close-up','Extreme close-up','Over-the-shoulder'],
             'camera_angle':['','Eye level','Low angle','High angle','Bird’s-eye view','Dutch angle'],
             'camera_move':['','Locked-off camera','Slow dolly in','Slow dolly out','Pan left','Pan right','Tracking shot','Slow orbit']}
    result={}
    for key,values in options.items():
        value=scene.get(key,'')
        if value not in values: raise Problem('Unsupported '+key)
        result[key]=value
    subjects=scene.get('subjects',[])
    if not isinstance(subjects,list) or len(subjects)>4: raise Problem('Use up to four subject descriptions per shot')
    result['subjects']=[{'name':text(x.get('name'),80),'description':text(x.get('description'),500),'action':text(x.get('action'),500)} for x in subjects if isinstance(x,dict)]
    return result

def save_board(body):
    sid=story_id(body)
    title=text(body.get('title'),160); scenes=body.get('scenes',[])
    if not isinstance(scenes,list) or not 1<=len(scenes)<=60: raise Problem('Use between 1 and 60 scenes')
    clean=[]
    for s in scenes:
        asset=get(s.get('image_id',''),'asset')
        if asset.get('deleted') or asset['media']!='image' or asset['stage']!='prod': raise Problem('Storyboard scenes need approved images')
        if asset.get('story_id',LEGACY_STORY)!=sid: raise Problem('Choose images from this story')
        clean.append({'image_id':asset['id'],'seconds':number(s.get('seconds',3),1,30),
                      'motion':text(s.get('motion','Gentle cinematic movement'),2000),'narration':str(s.get('narration',''))[:4000],**clean_shot_controls(s)})
    # Immutable revisions ensure renders always refer to the exact approved inputs.
    board=save(new('board',story_id=sid,title=title,scenes=clean,sync='pending'))
    if github_token(): launch('Sync media to GitHub',sync_github)
    return board

def ffmpeg(args):
    try: subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error',*args],check=True,capture_output=True,timeout=1800)
    except subprocess.CalledProcessError: raise Problem('FFmpeg assembly failed',502)

def render_video(body):
    __import__('story_director').check_render(body,globals())
    board=copy.deepcopy(get(body.get('board_id',''),'board'))
    mode=body.get('mode','preview')
    model=body.get('model','wan-5b' if mode=='wan' else 'preview')
    if mode not in ('preview','wan') or model not in (('preview',) if mode=='preview' else ('wan-5b','wan-a14b')): raise Problem('Selected video model is unavailable',503)
    a14b=model=='wan-a14b'
    sizes=('1280x720',) if a14b else ('704x384','1280x704')
    width,height=resolution(body.get('resolution',sizes[0]),sizes)
    settings={'model':model,'width':width,'height':height,'steps':number(body.get('steps',20),5,60,True),'cfg':number(body.get('cfg',3.5 if a14b else 5),1,15),'seed':number(body.get('seed',42),0,2**53-61,True),'fps':16 if a14b else 24}
    if not shutil.which('ffmpeg'): raise Problem('FFmpeg is not installed',503)
    if mode=='wan':
        limit=6 if a14b else 5
        if not (wan_a14b_ready() if a14b else wan_ready()): raise Problem('Selected Wan model files are not ready',503)
        if any(s['seconds']>limit for s in board['scenes']): raise Problem(f'{model}: use shots of 1–{limit} seconds')
        if len(board['scenes'])>10 or sum(s['seconds'] for s in board['scenes'])>60: raise Problem('For this pilot, render at most 10 shots and 60 seconds per job')
    def render(jid):
        vp=__import__('video_progress');vp.begin(jid,board,settings,globals())
        work=DATA/'work'/jid; work.mkdir()
        clips=[]
        for index,scene in enumerate(board['scenes']):
            vp.scene(jid,index,globals())
            image=asset_path(get(scene['image_id'],'asset')); clip=work/f'{index:03}.mp4'; duration=scene['seconds']
            job_update(jid,progress=f'Scene {index+1} of {len(board["scenes"])}')
            if mode=='wan':
                name=f'ecco-{jid}-{index}.png'; target=COMFY_ROOT/'input'/name
                shutil.copyfile(image,target)
                try:
                    graph=video_graph(scene,name,f'{jid}-{index}',settings['seed']+index,settings)
                    (work/f'workflow-{index}.json').write_text(json.dumps(graph))
                    frames=vp.execute(graph,jid,globals())
                    vp.stage(jid,'Encoding scene',globals())
                    frame_dir=work/f'frames-{index}'; frame_dir.mkdir()
                    for n,frame in enumerate(frames): os.symlink(frame,frame_dir/f'{n:05}.png')
                    ffmpeg(['-framerate',str(settings['fps']),'-i',str(frame_dir/'%05d.png'),'-t',str(duration),'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-pix_fmt','yuv420p',str(clip)])
                finally: target.unlink(missing_ok=True)
            else:
                vp.stage(jid,'Encoding scene',globals())
                frames=round(duration*24)
                vf=f"scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.0006,1.12)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d={frames}:s=1280x720:fps=24"
                ffmpeg(['-i',str(image),'-vf',vf,'-frames:v',str(frames),'-c:v','libx264','-pix_fmt','yuv420p',str(clip)])
            clips.append(clip)
            vp.scene_done(jid,globals())
        vp.stage(jid,'Assembling video',globals())
        listing=work/'concat.txt'; listing.write_text(''.join(f"file '{c}'\n" for c in clips))
        aid=uuid.uuid4().hex; rel=f'video-dev/{aid}.mp4'
        ffmpeg(['-f','concat','-safe','0','-i',str(listing),'-c','copy','-movflags','+faststart',str(DATA/rel)])
        vp.check(jid,globals())
        result=save(dict(id=aid,kind='asset',created=time.time(),media='video',stage='dev',story_id=board.get('story_id',LEGACY_STORY),path=rel,board_id=board['id'],title=board['title'],mode=mode,settings=settings,workflows=[json.loads(p.read_text()) for p in sorted(work.glob('workflow-*.json'))],narration='script only; no audio track',job_id=jid,sync='pending'))
        shutil.rmtree(work)
        return result['id']
    return launch('Render '+('Wan motion video' if mode=='wan' else 'storyboard preview'),render,metadata={'video_job':True,'story_id':board.get('story_id',LEGACY_STORY),'scene_count':len(board['scenes']),'stage':'Queued','overall_percent':0})

def trash_asset(body):
    with LOCK:
        a=get(body.get('asset_id',''),'asset')
        a['deleted']=not bool(body.get('restore',False))
        a['sync']='pending'
        return save(a)

def qwen_edit_ready():
    return qwen_ready() and (COMFY_ROOT/'models/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors').is_file()

def edit_graph(prompt,files,ident,seed=42):
    g={'1':node('UNETLoader',unet_name='qwen_image_edit_2511_fp8mixed.safetensors',weight_dtype='default'),
       '2':node('ModelSamplingAuraFlow',model=['1',0],shift=3.1),
       '3':node('CFGNorm',model=['2',0],strength=1.0),
       '4':node('CLIPLoader',clip_name='qwen_2.5_vl_7b_fp8_scaled.safetensors',type='qwen_image',device='default'),
       '5':node('VAELoader',vae_name='qwen_image_vae.safetensors')}
    refs={}
    for i,file in enumerate(files):
        key=str(20+i);g[key]=node('LoadImage',image=file);refs['image'+str(i+1)]=[key,0]
    g.update({'6':node('TextEncodeQwenImageEditPlus',clip=['4',0],vae=['5',0],prompt=prompt,**refs),
              '7':node('TextEncodeQwenImageEditPlus',clip=['4',0],vae=['5',0],prompt='',**refs),
              '8':node('FluxKontextImageScale',image=['20',0]),
              '9':node('VAEEncode',pixels=['8',0],vae=['5',0]),
              '10':node('KSampler',model=['3',0],positive=['6',0],negative=['7',0],latent_image=['9',0],seed=seed,steps=40,cfg=3,sampler_name='euler',scheduler='simple',denoise=1),
              '11':node('VAEDecode',samples=['10',0],vae=['5',0]),
              '12':node('SaveImage',images=['11',0],filename_prefix='ecco-studio/'+ident)})
    return g

def edited_asset(jid,source_ids,prompt,sid,seed=42,extra=None):
    aid=uuid.uuid4().hex;targets=[]
    try:
        for i,source in enumerate(source_ids):
            a=get(source,'asset')
            if a.get('deleted'):raise Problem('A reference image is in Trash')
            target=COMFY_ROOT/'input'/f'ecco-edit-{aid}-{i}.png';shutil.copyfile(asset_path(a),target);targets.append(target)
        graph=edit_graph(prompt,[p.name for p in targets],aid,seed)
        output=comfy_execute(graph,jid)[0];rel=f'image-dev/{aid}.png';shutil.copyfile(output,DATA/rel)
        return save(dict(id=aid,kind='asset',created=time.time(),media='image',stage='dev',story_id=sid,path=rel,prompt=prompt,settings={'model':'qwen-image-edit-2511','steps':40,'cfg':3,'seed':seed,'reference_ids':source_ids},job_id=jid,sync='pending',workflow=graph,**(extra or {})))
    finally:
        for target in targets:target.unlink(missing_ok=True)

def create_edit(body):
    if not qwen_edit_ready():raise Problem('Instruction-edit model is not installed. Additional persistent model storage is required.',503)
    sid=story_id(body);prompt=text(body.get('prompt'))
    if body.get('character_ids'):
        ids=body['character_ids']
        if not isinstance(ids,list) or not 1<=len(ids)<=3:raise Problem('Select one to three characters')
        chars=[get(x,'character') for x in ids];refs=[c['image_ids'][0] for c in chars]
        prompt=' '.join(f'Reference image {i+1} is {c["name"]}: {c["description"]}.' for i,c in enumerate(chars))+' '+prompt
    else:
        a=get(body.get('asset_id',''),'asset')
        if a.get('media')!='image' or a.get('story_id',LEGACY_STORY)!=sid:raise Problem('Choose an image from this story')
        refs=[a['id']]
    return launch('Instruction edit / compose scene',lambda jid:edited_asset(jid,refs,prompt,sid)['id'])

def create_character_sheet(body):
    if not qwen_edit_ready():raise Problem('Character sheets require the instruction-edit model and additional persistent storage.',503)
    c=get(body.get('character_id',''),'character');sid=story_id(body)
    views=['front view','left profile view','right profile view','back view','close-up portrait','full body view']
    def generate(jid):
        result=[]
        for i,view in enumerate(views):
            job_update(jid,progress=f'Character sheet: {view} ({i+1}/6)')
            prompt=f'Show this exact character in a {view}, alone against a plain neutral studio background. Preserve identity, facial structure, skin or fur color, clothing and distinctive features. {c["description"]}. One character, one view, no collage, no labels.'
            a=edited_asset(jid,[c['image_ids'][0]],prompt,sid,42+i,{'character_id':c['id'],'character_view':view});result.append(a['id'])
            current=get(c['id'],'character');current['sheet_ids']=current.get('sheet_ids',[])+[a['id']];save(current)
        return result
    return launch('Generate six-view character sheet: '+c['name'],generate)

def purge_asset(body):
    if body.get('confirmed') is not True: raise Problem('Confirm permanent deletion')
    with LOCK:
        a=get(body.get('asset_id',''),'asset')
        if not a.get('deleted'): raise Problem('Move the asset to Trash first')
        if any(j['status'] in ('queued','running') for j in records('job')): raise Problem('Wait for active jobs to finish before permanently deleting files')
        if any(any(x.get('image_id')==a['id'] for x in b['scenes']) for b in records('board')): raise Problem('This image is referenced by a saved storyboard and cannot be purged')
        if any(a['id'] in c.get('image_ids',[]) for c in records('character')): raise Problem('This image is saved in the character library and cannot be purged')
        paths=[asset_path(a)]
        workflows=a.get('workflows',[]) or [a.get('workflow',{})]
        for graph in workflows:
            for n in graph.values():
                if n.get('class_type')=='SaveImage':
                    prefix=n['inputs'].get('filename_prefix','')
                    if re.fullmatch(r'ecco-studio/[a-f0-9-]+',prefix):
                        paths.extend((COMFY_ROOT/'output'/'ecco-studio').glob(prefix.split('/')[-1]+'_*.png'))
        for path in paths:path.unlink(missing_ok=True)
        # Retain only a tombstone; do not claim to erase external GitHub history/backups.
        save(dict(id=a['id'],kind='purged',created=a['created'],purged_at=time.time()))
        return {'id':a['id'],'purged':True}

def save_character(body):
    aid=body.get('asset_id','');a=get(aid,'asset')
    if a.get('deleted') or a.get('media')!='image': raise Problem('Choose an available image')
    return save(new('character',name=text(body.get('name'),100),description=text(body.get('description'),2000),image_ids=[aid],source_story_id=a.get('story_id',LEGACY_STORY),training_status='reference_only',adapter_file=None))

def training_request(body):
    c=get(body.get('character_id',''),'character')
    reviewed=c['image_ids']+[aid for aid in c.get('sheet_ids',[]) if get(aid,'asset').get('stage')=='prod' and not get(aid,'asset').get('deleted')]
    request_record=save(new('training_request',character_id=c['id'],name=c['name'],reference_ids=reviewed,status='needs_dataset_and_trainer',base_model='qwen-image-2512',output_format='safetensors',note='No adapter trained. Review a varied character dataset and configure a compatible trainer first.'))
    return request_record

def approve(aid):
    with LOCK:
        a=get(aid,'asset')
        if a['stage']=='prod': return a
        old=a['path']; path=old.replace('-dev/','-prod/',1)
        os.replace(asset_path(a),DATA/path)
        a.update(stage='prod',path=path,sync='pending',approved_at=time.time())
        if a.get('github_path'): a['remove_github_path']=a['github_path']
        save(a)
        if github_token(): launch('Sync media to GitHub',sync_github)
        return a

def secret_file(env):
    p=os.getenv(env,'')
    return Path(p) if p else None

def github_token():
    p=secret_file('GITHUB_TOKEN_FILE')
    return p.read_text().strip() if p and p.is_file() else os.getenv('GITHUB_TOKEN','')

def gh(path,payload=None,method=None):
    token=github_token()
    if not token: raise Problem('GitHub write access is not configured',503)
    return request('https://api.github.com/repos/'+REPO+path,payload,{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},method)

def sync_github(jid):
    # Lock local promotions during snapshot+commit. Update the branch without force.
    with LOCK:
        pending=[r for r in records() if r['kind'] in ('asset','board') and r.get('sync')!='synced']
        if not pending: return 'Everything is already synced'
        for a in pending:
            if a['kind']=='asset' and asset_path(a).stat().st_size>90*1024*1024:
                raise Problem('Video exceeds the 90 MiB app Git limit. Configure Git LFS before syncing large videos.')
        ref=gh('/git/ref/heads/main'); head=ref['object']['sha']; commit=gh('/git/commits/'+head)
        changes={}
        for a in pending:
            if a['kind']=='asset':
                payload=base64.b64encode(asset_path(a).read_bytes()).decode()
                sha=gh('/git/blobs',{'content':payload,'encoding':'base64'})['sha']
                changes[a['path']]={'path':a['path'],'mode':'100644','type':'blob','sha':sha}
                previous=a.get('remove_github_path')
                if previous and previous!=a['path']: changes[previous]={'path':previous,'mode':'100644','type':'blob','sha':None}
                meta='studio-metadata/'+a['id']+'.json'
            else: meta='storyboards/'+a['id']+'.json'
            changes[meta]={'path':meta,'mode':'100644','type':'blob','content':json.dumps(a,indent=2)}
        tree=gh('/git/trees',{'base_tree':commit['tree']['sha'],'tree':list(changes.values())})
        result=gh('/git/commits',{'message':'Studio: sync reviewed media and storyboard revisions','tree':tree['sha'],'parents':[head]})
        gh('/git/refs/heads/main',{'sha':result['sha'],'force':False},'PATCH')
        for a in pending:
            a.update(sync='synced',github_commit=result['sha'])
            if a['kind']=='asset': a['github_path']=a['path']
            a.pop('remove_github_path',None); save(a)
        return result['sha']

def wan_a14b_ready():
    return all((COMFY_ROOT/'models'/d/n).is_file() for d,n in [('diffusion_models','wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors'),('diffusion_models','wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors'),('vae','wan_2.1_vae.safetensors'),('text_encoders','umt5_xxl_fp8_e4m3fn_scaled.safetensors')])

def wan_ready():
    return all((COMFY_ROOT/'models'/d/n).is_file() for d,n in [('diffusion_models','wan2.2_ti2v_5B_fp16.safetensors'),('vae','wan2.2_vae.safetensors'),('text_encoders','umt5_xxl_fp8_e4m3fn_scaled.safetensors')])

def yt_client():
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    p=DATA/'youtube-token.json'
    if not p.exists(): raise Problem('Connect the YouTube channel first',503)
    return build('youtube','v3',credentials=Credentials.from_authorized_user_file(str(p)),cache_discovery=False)

def verify_channel(client):
    target=client.channels().list(part='id',forHandle=CHANNEL_HANDLE).execute().get('items',[])
    mine=client.channels().list(part='snippet',mine=True).execute().get('items',[])
    if not target or not any(c['id']==target[0]['id'] for c in mine): raise Problem('Connected Google account is not the @EccoAILabs channel',403)
    c=next(c for c in mine if c['id']==target[0]['id'])
    return {'id':c['id'],'title':c['snippet']['title'],'handle':'@'+CHANNEL_HANDLE}

def oauth_start():
    from google_auth_oauthlib.flow import Flow
    p=secret_file('YOUTUBE_CLIENT_SECRET_FILE')
    if not p or not p.is_file(): raise Problem('YouTube OAuth client configuration is required',503)
    flow=Flow.from_client_secrets_file(str(p),scopes=['https://www.googleapis.com/auth/youtube.upload','https://www.googleapis.com/auth/youtube.readonly'],redirect_uri=PUBLIC+'/api/youtube/callback')
    url,state=flow.authorization_url(access_type='offline',prompt='consent')
    OAUTH_STATES[state]=(time.monotonic(),flow)
    return {'url':url}

def oauth_finish(query):
    state=query.get('state',[''])[0]; pending=OAUTH_STATES.pop(state,None)
    if not pending or time.monotonic()-pending[0]>600: raise Problem('OAuth request expired',403)
    if 'code' not in query: raise Problem('YouTube authorization was cancelled')
    flow=pending[1]; flow.fetch_token(code=query['code'][0])
    from googleapiclient.discovery import build
    client=build('youtube','v3',credentials=flow.credentials,cache_discovery=False)
    channel=verify_channel(client)
    p=DATA/'youtube-token.json'
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f: f.write(flow.credentials.to_json())
    (DATA/'youtube-channel.json').write_text(json.dumps(channel))

def publish(body):
    a=get(body.get('asset_id',''),'asset')
    if a['media']!='video' or a['stage']!='prod': raise Problem('Only approved videos can be uploaded',409)
    if body.get('confirmed') is not True: raise Problem('Confirm the channel, video and visibility first',409)
    privacy=body.get('visibility','private')
    if privacy not in ('private','unlisted','public'): raise Problem('Invalid visibility')
    if not isinstance(body.get('made_for_kids'),bool): raise Problem('Choose an audience setting')
    title=text(body.get('title'),100); description=str(body.get('description',''))[:5000]
    with LOCK:
        a=get(a['id'],'asset')
        if a.get('upload_state'): raise Problem('An upload was already started. Check YouTube Studio before attempting another.',409)
        verify_channel(yt_client())
        a['upload_state']='reserved'; save(a)
    def upload(jid):
        from googleapiclient.http import MediaFileUpload
        client=yt_client(); verify_channel(client)
        req=client.videos().insert(part='snippet,status',body={'snippet':{'title':title,'description':description},'status':{'privacyStatus':privacy,'selfDeclaredMadeForKids':body['made_for_kids']}},media_body=MediaFileUpload(str(asset_path(a)),mimetype='video/mp4',resumable=True))
        # Never auto-retry ambiguous upload failures: avoids duplicate publication.
        response=None
        while response is None:
            progress,response=req.next_chunk(num_retries=0)
            if progress: job_update(jid,progress=f'Uploading: {round(progress.progress()*100)}%')
        with LOCK:
            record=get(a['id']); record.update(upload_state='uploaded',youtube_id=response['id'],youtube_visibility=response.get('status',{}).get('privacyStatus','unknown'),sync='pending'); save(record)
        return response['id']
    try: return launch('Upload approved video to @EccoAILabs',upload)
    except Exception:
        a.pop('upload_state',None); save(a); raise

BILLING_LOCK=threading.Lock()
def billing_key():
    path=DATA/'.private'/'runpod-billing.key'
    return os.getenv('RUNPOD_BILLING_API_KEY','').strip() or (path.read_text().strip() if path.is_file() else '')

def billing_status():
    path=DATA/'.private'/'billing-cache.json'
    try: cache=json.loads(path.read_text())
    except (OSError,ValueError): cache={}
    return {**cache,'connected':bool(billing_key()),'refresh_interval_seconds':1800}

def fetch_billing(key):
    result=request('https://api.runpod.io/graphql',{'query':'query { myself { clientBalance clientLifetimeSpend currentSpendPerHr } }'},headers={'Authorization':'Bearer '+key},timeout=25)
    account=result.get('data',{}).get('myself')
    if result.get('errors') or not account: raise Problem('Billing access failed. Use a RunPod API key with GraphQL read-only permission.',502)
    values={k:float(account[k]) for k in ('clientBalance','clientLifetimeSpend','currentSpendPerHr')}
    return {'last_success':time.time(),'balance_usd':values['clientBalance'],'total_spent_usd':values['clientLifetimeSpend'],'rate_usd_hour':values['currentSpendPerHr'],'source':'RunPod account billing API'}

def store_billing(cache):
    folder=DATA/'.private';folder.mkdir(mode=0o700,exist_ok=True);folder.chmod(0o700)
    path=folder/'billing-cache.json';temp=folder/'billing-cache.tmp';temp.write_text(json.dumps(cache));temp.replace(path)

def connect_billing(body):
    key=text(body.get('api_key'),500)
    with BILLING_LOCK:
        cache=fetch_billing(key);store_billing(cache)
        path=DATA/'.private'/'runpod-billing.key'
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        with os.fdopen(fd,'w') as f:f.write(key)
    return billing_status()

def refresh_billing():
    with BILLING_LOCK:
        key=billing_key()
        if not key: raise Problem('Connect a read-only RunPod billing key first',503)
        cache=fetch_billing(key);store_billing(cache)
        return billing_status()

def billing_worker():
    last_attempt=0
    while True:
        if billing_key() and time.time()-last_attempt>=1800:
            last_attempt=time.time()
            try:refresh_billing()
            except Exception:
                cache=billing_status();cache['last_error']='Billing refresh failed; showing the last successful reading.';store_billing(cache)
        time.sleep(30)

def session_cost():
    try:
        # PID 1 belongs to the Pod container; app restarts do not reset this clock.
        fields=Path('/proc/1/stat').read_text().rsplit(')',1)[1].split()
        started_ticks=float(fields[19]);uptime=float(Path('/proc/uptime').read_text().split()[0])
        elapsed=max(0,uptime-started_ticks/os.sysconf('SC_CLK_TCK'))
        rate=float(os.getenv('ECCO_GPU_HOURLY_RATE','1.79'))
        return {'elapsed_seconds':round(elapsed),'estimated_usd':round(elapsed*rate/3600,4),'hourly_rate':rate,'as_of':time.time(),'basis':'container uptime; includes idle time; excludes storage and earlier sessions','actual_billing_connected':False}
    except (OSError,ValueError,IndexError): return None

def runtime_status():
    try:
        value=json.loads(Path('/workspace/ecco-runtime/health.json').read_text())
        return value if time.time()-value['updated']<30 else {}
    except (OSError,ValueError,KeyError): return {}

def state():
    channel_file=DATA/'youtube-channel.json'
    return {'csrf':CSRF,'records':records(),'config':{'video_gpus':__import__('gpu_dispatch').options(),'runtime':runtime_status(),'accelerator':__import__('accelerator_status').status(),'session_cost':session_cost(),'billing':billing_status(),'model_settings_version':1,'models_ready':{'qwen-story':__import__('story_director').planner_ready(),'qwen-image-2512':qwen_ready(),'qwen-image-edit-2511':qwen_edit_ready(),'sdxl':(COMFY_ROOT/'models/checkpoints/sd_xl_base_1.0.safetensors').is_file(),'wan-5b':wan_ready(),'wan-a14b':wan_a14b_ready(),'preview':bool(shutil.which('ffmpeg'))},'repo':REPO,'channel':'https://www.youtube.com/@EccoAILabs','hourly_rate':RATE,'github_connected':bool(github_token()),'youtube_configured':bool(secret_file('YOUTUBE_CLIENT_SECRET_FILE')),'youtube_channel':json.loads(channel_file.read_text()) if channel_file.exists() else None,'wan_ready':wan_ready(),'ffmpeg':bool(shutil.which('ffmpeg'))}}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt,*args): pass # OAuth codes must never enter access logs.
    def send(self,data,status=200,mime='application/json',headers=None):
        if isinstance(data,(dict,list)): data=json.dumps(data).encode()
        if isinstance(data,str): data=data.encode()
        self.send_response(status); self.send_header('Content-Type',mime)
        self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'self'; base-uri 'self'")
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        try:
            u=urllib.parse.urlsplit(self.path); path=u.path.rstrip('/') or '/'
            if path=='/api/state': return self.send(state())
            if path=='/api/youtube/callback':
                oauth_finish(urllib.parse.parse_qs(u.query)); return self.send(b'',302,headers={'Location':PUBLIC+'/'})
            if path.startswith('/api/media/'):
                a=get(path.split('/')[-1],'asset'); p=asset_path(a)
                # Simple bounded demo media responses; range support for video scrubbing.
                size=p.stat().st_size; start,end=0,size-1; status=200; headers={'Accept-Ranges':'bytes'}
                r=self.headers.get('Range')
                if r:
                    m=re.fullmatch(r'bytes=(\d+)-(\d*)',r)
                    if not m: raise Problem('Unsupported range',416)
                    start=int(m[1]); end=min(int(m[2]) if m[2] else end,end)
                    if start>end: raise Problem('Range outside file',416)
                    status=206; headers['Content-Range']=f'bytes {start}-{end}/{size}'
                self.send_response(status); self.send_header('Content-Type','image/png' if a['media']=='image' else 'video/mp4')
                for k,v in headers.items(): self.send_header(k,v)
                self.send_header('Content-Length',str(end-start+1)); self.send_header('X-Content-Type-Options','nosniff'); self.end_headers()
                with p.open('rb') as f:
                    f.seek(start); remaining=end-start+1
                    while remaining:
                        chunk=f.read(min(1024*1024,remaining)); self.wfile.write(chunk); remaining-=len(chunk)
                return
            files={'/workspace-ui.js':('workspace-ui.js','text/javascript'),'/workspace-ui.css':('workspace-ui.css','text/css'),'/gpu-selector.js':('gpu-selector.js','text/javascript'),'/story-director.js':('story-director.js','text/javascript'),'/story-director.css':('story-director.css','text/css'),'/video-progress.js':('video-progress.js','text/javascript'),'/video-progress.css':('video-progress.css','text/css'),'/library-ui.js':('library-ui.js','text/javascript'),'/library-ui.css':('library-ui.css','text/css'),'/object-editor.js':('object-editor.js','text/javascript'),'/object-editor.css':('object-editor.css','text/css'),'/models.js':('models.js','text/javascript'),'/logo.png':('logo.png','image/png'),'/connect':('bridge.html','text/html'),'/bridge.js':('bridge.js','text/javascript'),'/':('studio.html','text/html'),'/studio.js':('studio.js','text/javascript'),'/studio.css':('studio.css','text/css')}
            if path not in files: raise Problem('Not found',404)
            file,mime=files[path]; self.send((ROOT/file).read_bytes(),mime=mime)
        except Problem as exc: self.send({'error':exc.message},exc.code)
        except (BrokenPipeError,ConnectionResetError): pass
        except Exception: self.send({'error':'Server operation failed; check configuration.'},500)
    def do_POST(self):
        try:
            if not PUBLIC or self.headers.get('Origin')!=ORIGIN or self.headers.get('X-Ecco-CSRF')!=CSRF: raise Problem('Refresh this app to establish a same-origin session',403)
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=(17*1024*1024 if urllib.parse.urlsplit(self.path).path=='/api/images/upload' else 1024*1024): raise Problem('Request too large or empty',413)
            body=json.loads(self.rfile.read(length)); path=urllib.parse.urlsplit(self.path).path
            if not isinstance(body,dict): raise Problem('Expected an object')
            return self.mutate(path,body)
        except Problem as exc: self.send({'error':exc.message},exc.code)
        except (ValueError,KeyError,TypeError): self.send({'error':'Invalid request fields'},400)
        except Exception: self.send({'error':'Operation failed; check server configuration.'},500)
    def mutate(self,path,body):
        try:
            if path=='/api/images': result=create_image(body)
            elif path=='/api/images/upload': result=__import__('image_upload').upload(body,globals())
            elif path=='/api/stories': result=create_story(body)
            elif path=='/api/director/create': result=__import__('story_director').create(body,globals())
            elif path=='/api/director/update': result=__import__('story_director').update(body,globals())
            elif path=='/api/director/regenerate': result=__import__('story_director').regenerate(body,globals())
            elif path=='/api/director/approve': result=__import__('story_director').approve(body,globals())
            elif path=='/api/library/folders': result=__import__('image_library').create_folder(body,globals())
            elif path=='/api/library/save': result=__import__('image_library').save_to_folder(body,globals())
            elif path=='/api/stories/archive': result=archive_story(body)
            elif path=='/api/boards': result=save_board(body)
            elif path=='/api/videos': result=__import__('gpu_dispatch').submit(body,globals())
            elif path=='/api/video-jobs/cancel': result=__import__('gpu_dispatch').cancel(body,globals())
            elif path=='/api/trash': result=trash_asset(body)
            elif path=='/api/trash/board': result=__import__('trash_manager').board(body,globals())
            elif path=='/api/trash/folder': result=__import__('trash_manager').folder(body,globals())
            elif path=='/api/trash/draft': result=__import__('trash_manager').draft(body,globals())
            elif path=='/api/trash/restore-draft': result=__import__('trash_manager').restore_draft(body,globals())
            elif path=='/api/trash/empty': result=__import__('trash_manager').empty(body,globals())
            elif path=='/api/purge': result=purge_asset(body)
            elif path=='/api/characters': result=save_character(body)
            elif path=='/api/image-edits': result=create_edit(body)
            elif path=='/api/object-edits': result=__import__('object_editor').save_copy(body,globals())
            elif path=='/api/character-sheets': result=create_character_sheet(body)
            elif path=='/api/training-requests': result=training_request(body)
            elif path=='/api/billing/connect': result=connect_billing(body)
            elif path=='/api/billing/refresh': result=refresh_billing()
            elif path=='/api/approve': result=approve(body.get('asset_id',''))
            elif path=='/api/github/sync': result=launch('Sync media to GitHub',sync_github)
            elif path=='/api/youtube/connect': result=oauth_start()
            elif path=='/api/youtube/publish': result=publish(body)
            else: raise Problem('Not found',404)
            self.send(result)
        except Problem as exc: self.send({'error':exc.message},exc.code)
        except (ValueError,KeyError,TypeError): self.send({'error':'Invalid request fields'},400)
        except Exception: self.send({'error':'Operation failed; check server configuration.'},500)

if __name__=='__main__':
    if not PUBLIC.startswith(('https://','http://127.0.0.1:')): raise SystemExit('Set ECCO_PUBLIC_URL to the authenticated proxy URL')
    initialize()
    threading.Thread(target=billing_worker,daemon=True).start()
    print('ECCO AI Labs Studio listening on 127.0.0.1:8765 behind authenticated proxy',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8765),Handler).serve_forever()
