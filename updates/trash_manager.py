"""Recoverable storyboard deletion and explicit bulk emptying of Studio Trash."""
import copy, time

def board(body,e):
    with e['LOCK']:
        r=e['get'](body.get('id',''),'board')
        r['deleted']=not bool(body.get('restore'));return e['save'](r)

def draft(body,e):
    value=body.get('draft')
    if not isinstance(value,dict) or not isinstance(value.get('scenes',[]),list):raise e['Problem']('Invalid storyboard draft')
    sid=e['story_id'](body)
    return e['save'](e['new']('board_draft',story_id=sid,title=str(value.get('title') or 'Current storyboard')[:160],draft=copy.deepcopy(value),deleted=True))

def restore_draft(body,e):
    r=e['get'](body.get('id',''),'board_draft')
    if not r.get('deleted'):raise e['Problem']('This draft has already been restored')
    r['deleted']=False;e['save'](r);return r

def empty(body,e):
    if body.get('confirmed') is not True:raise e['Problem']('Confirm permanent deletion')
    ids=body.get('ids')
    if not isinstance(ids,list) or not ids or any(not isinstance(i,str) for i in ids):raise e['Problem']('Choose Trash items to delete')
    with e['LOCK']:
        all_records=e['records']();by_id={r['id']:r for r in all_records}
        selected=[by_id.get(i) for i in set(ids)]
        if any(not r or not r.get('deleted') or r.get('purged') or r['kind'] not in ('story','board','board_draft','asset') for r in selected):raise e['Problem']('Trash changed. Refresh and try again.',409)
        if any(r['kind']=='job' and r.get('status') in ('queued','running') for r in all_records):raise e['Problem']('Wait for active jobs to finish before emptying Trash',409)
        assets={r['id'] for r in selected if r['kind']=='asset'}
        # Preflight every path before changing records. asset_path checks confinement.
        for r in selected:
            if r['kind']=='asset':e['asset_path'](r)
        # Remove references, retaining storyboard text and the remaining character images.
        for r in all_records:
            changed=False
            if r['kind']=='board':
                for scene in r.get('scenes',[]):
                    if scene.get('image_id') in assets:scene['image_id']='';changed=True
            if r['kind']=='character':
                for key in ('image_ids','sheet_ids'):
                    old=r.get(key,[]);new=[i for i in old if i not in assets]
                    if old!=new:r[key]=new;changed=True
            if changed:e['save'](r)
        for r in selected:
            if r['kind']=='asset':e['purge_asset']({'asset_id':r['id'],'confirmed':True})
            else:
                tomb={'id':r['id'],'kind':'story' if r['kind']=='story' else 'purged','created':r.get('created',time.time()),'deleted':True,'purged':True,'purged_at':time.time()}
                e['save'](tomb)
        for r in all_records:
            if r['kind']=='library_item' and r.get('asset_id') in assets:e['save']({'id':r['id'],'kind':'purged','purged_at':time.time()})
        return {'purged_count':len(selected)}
