import json,time,uuid

def check(jid,e):
    if e['get'](jid,'job').get('cancel_requested'):raise e['Problem']('Cancelled by user',409)

def cancel(body,e):
    jid=body.get('job_id','');j=e['get'](jid,'job')
    if not j.get('video_job'):raise e['Problem']('Choose a tracked video job')
    if j['status'] not in ('queued','running'):return j
    e['job_update'](jid,cancel_requested=True,stage='Cancelling')
    pid=j.get('comfy_prompt_id')
    if pid:
        # Comfy cancels this prompt atomically; never interrupt a different job.
        e['request'](e['COMFY']+'/api/jobs/'+pid+'/cancel',{})
    return e['get'](jid,'job')

def begin(jid,board,settings,e):
    check(jid,e)
    e['job_update'](jid,video_job=True,story_id=board.get('story_id',e['LEGACY_STORY']),scene_count=len(board['scenes']),scene_index=0,stage='Preparing model',video_settings=settings,scene_durations=[s['seconds'] for s in board['scenes']],completed_scene_seconds=[],overall_percent=0,eta_seconds=None)

def scene(jid,index,e):
    check(jid,e);j=e['get'](jid,'job');e['job_update'](jid,scene_index=index,scene_started=time.time(),stage='Preparing model',step=0,step_total=0,eta_seconds=None,queue_ahead=0,overall_percent=round(95*index/max(1,j['scene_count']),1))

def stage(jid,name,e):
    check(jid,e);e['job_update'](jid,stage=name,eta_seconds=None)

def scene_done(jid,e):
    check(jid,e);j=e['get'](jid,'job');times=j.get('completed_scene_seconds',[])+[time.time()-j['scene_started']]
    remaining=j['scene_count']-j['scene_index']-1
    e['job_update'](jid,completed_scene_seconds=times,overall_percent=round(95*(j['scene_index']+1)/j['scene_count'],1),eta_seconds=round(sum(times)/len(times)*remaining+5))

class Tracker:
    def __init__(self,graph):
        self.graph=graph;self.weights={};self.values={};self.first=None;self.last_step_time=None
        for k,n in graph.items():
            if 'Sampler' in n['class_type']:
                i=n['inputs'];steps=i.get('steps',20);self.weights[k]=max(1,min(steps,i.get('end_at_step',steps))-i.get('start_at_step',0))
        self.total=sum(self.weights.values())
    def update(self,d,now):
        node=str(d.get('node',''));v=d.get('value',0);m=d.get('max',0)
        if node not in self.weights or not isinstance(v,(float,int)) or not isinstance(m,(float,int)) or m<=0:return None
        self.values[node]=max(self.values.get(node,0),min(1,max(0,v/m))*self.weights[node])
        step=sum(self.values.values())
        if self.first is None:self.first=(step,now)
        self.last_step_time=now
        return step,self.total

def execute(graph,jid,e):
    import websocket
    check(jid,e);client='ecco-video-'+uuid.uuid4().hex;ws=None
    try:
        try:ws=websocket.create_connection(e['COMFY'].replace('http','ws',1)+'/ws?clientId='+client,timeout=2)
        except Exception:e['job_update'](jid,telemetry_warning='Step updates unavailable; scene status remains live')
        check(jid,e)
        result=e['request'](e['COMFY']+'/prompt',{'prompt':graph,'client_id':client})
        pid=result.get('prompt_id')
        if not pid:raise e['Problem']('Comfy rejected the workflow',502)
        e['job_update'](jid,comfy_prompt_id=pid,stage='Waiting for GPU')
        tracker=Tracker(graph);deadline=time.monotonic()+3600;poll=0;active_node=None
        while time.monotonic()<deadline:
            j=e['get'](jid,'job')
            if j.get('cancel_requested'):
                e['request'](e['COMFY']+'/api/jobs/'+pid+'/cancel',{})
                raise e['Problem']('Cancelled by user',409)
            now=time.time()
            if time.monotonic()>=poll:
                poll=time.monotonic()+2
                entry=e['request'](e['COMFY']+'/history/'+pid).get(pid)
                if entry:
                    status=entry.get('status',{})
                    if any(m[0]=='execution_interrupted' for m in status.get('messages',[])):raise e['Problem']('Generation was interrupted',409)
                    if status.get('status_str')=='error':raise e['Problem']('Comfy generation failed. Inspect Comfy server log.',502)
                    if status.get('completed'):
                        paths=[]
                        for out in entry.get('outputs',{}).values():
                            for item in out.get('images',[]):
                                p=(e['COMFY_ROOT']/'output'/item.get('subfolder','')/item['filename']).resolve()
                                if not p.is_relative_to(e['COMFY_ROOT']/'output') or not p.is_file():raise e['Problem']('Invalid Comfy output',502)
                                paths.append(p)
                        if not paths:raise e['Problem']('Comfy returned no images',502)
                        e['job_update'](jid,comfy_prompt_id=None,stage='Encoding scene',eta_seconds=None)
                        return paths
                q=e['request'](e['COMFY']+'/queue');pending=[r[1] for r in q.get('queue_pending',[])];running=[r[1] for r in q.get('queue_running',[])]
                if pid in pending:e['job_update'](jid,stage='Waiting for GPU',queue_ahead=pending.index(pid)+len(running),eta_seconds=None)
                elif pid in running:
                    changes={'queue_ahead':0}
                    if j.get('stage')=='Waiting for GPU':changes['stage']='Preparing model'
                    if tracker.last_step_time and now-tracker.last_step_time>30:changes['eta_seconds']=None
                    e['job_update'](jid,**changes)
            if ws is None:time.sleep(.3);continue
            try:
                ws.settimeout(.3);msg=ws.recv()
                if not isinstance(msg,str):continue
                event=json.loads(msg);d=event.get('data',{})
                if d.get('prompt_id')!=pid:continue
                if event['type']=='executing':
                    active_node=str(d.get('node'));kind=graph.get(active_node,{}).get('class_type','')
                    if 'Decode' in kind:e['job_update'](jid,stage='Decoding frames',eta_seconds=None)
                    elif kind=='SaveImage':e['job_update'](jid,stage='Saving frames',eta_seconds=None)
                if event['type']=='progress':
                    d.setdefault('node',active_node);v=tracker.update(d,now)
                    if v:
                        step,total=v;j=e['get'](jid,'job');fraction=step/max(1,total);index=j['scene_index'];count=j['scene_count'];eta=None
                        elapsed=now-j['scene_started'];completed=j.get('completed_scene_seconds',[])
                        if fraction>=.15 and step>=3:
                            predicted=elapsed/max(.05,.85*fraction)
                            future=(sum(completed)/len(completed) if completed else predicted)
                            # Weight future scene durations to account for different shot lengths.
                            durations=j['scene_durations'];future_weight=sum(durations[index+1:])/max(1,durations[index])
                            eta=max(5,predicted-elapsed)+future*future_weight+5
                        e['job_update'](jid,stage='Generating motion',step=round(step),step_total=total,overall_percent=round(95*(index+.85*fraction)/count,1),eta_seconds=round(eta) if eta is not None else None,telemetry_at=now)
            except websocket.WebSocketTimeoutException:pass
            except (websocket.WebSocketException,OSError):
                try:ws.close()
                except Exception:pass
                ws=None;e['job_update'](jid,telemetry_warning='Step connection interrupted; scene status remains live',eta_seconds=None)
        raise e['Problem']('Generation timed out; check Comfy queue before retrying',504)
    finally:
        if ws:
            try:ws.close()
            except Exception:pass
