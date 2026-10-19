"""Read-only health plus deliberately invalid inference request; starts no generation."""
import json,time,uuid
from pathlib import Path
from urllib.request import Request,urlopen
key=Path('/workspace/ecco-storage-private/access.key').read_text().strip()
def call(path,body=None):
    request=Request('http://127.0.0.1:8888/api/'+path,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},
                    data=None if body is None else json.dumps(body).encode())
    with urlopen(request,timeout=25) as response:return json.load(response)
health=call('gpu/status')
print('GPU health:',[{k:g[k] for k in ('id','ready')} for g in health['gpus']],flush=True)
pod=next(g['id'] for g in health['gpus'] if g['ready'])
payload={'gpu':pod,'path':'images','body':{'model':'connectivity-validation-invalid','prompt':''},'request_id':uuid.uuid4().hex}
one=call('gpu/request',payload);two=call('gpu/request',payload)
assert one==two
for _ in range(40):
    result=call('gpu/requests/'+pod+'/'+one['id'])
    if result['status']!='pending':break
    time.sleep(.5)
print('GPU validation response:',result,flush=True)
assert result['status']=='error' and 'same-origin' not in result.get('error','').lower()
assert any(word in result.get('error','').lower() for word in ('model','story','prompt','text'))
assert call('state')['config']['gpu_relay']['gpus']
print('PASS: authenticated CPU → GPU round trip, validation response and idempotent request ID. No generation started.',flush=True)
