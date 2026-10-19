"""Exercise authenticated local Studio API without printing session credentials."""
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen

base = 'http://127.0.0.1:8765/api/'
def get(path):
    with urlopen(base + path, timeout=30) as response: return json.load(response)
def post(path, body):
    state = get('state')
    origin = 'https://io8sphjo10kbuy-8888.proxy.runpod.net'
    request = Request(base + path, data=json.dumps(body).encode(), headers={'Content-Type':'application/json','Origin':origin,'X-Ecco-CSRF':state['csrf']})
    with urlopen(request, timeout=30) as response: return json.load(response)
state = get('state')
assert state['config']['models_ready'].get('z-image'), 'Z-Image unavailable'
story = post('stories', {'title':'Z-Image integration verification','summary':'Technical validation of the Z-Image generation workflow.'})
job = post('images', {'model':'z-image','story_id':story['id'],'prompt':'A red clay teapot on a plain cream background, studio product photograph','resolution':'1024x1024','steps':28,'cfg':4,'seed':42})
target = Path('/workspace/ecco-image-runtime/api-test.json')
target.write_text(json.dumps({'story_id':story['id'],'job_id':job['id']}))
print('JOB',job['id'],flush=True)
for _ in range(900):
    state = get('state')
    current = next(j for j in state['records'] if j['id']==job['id'])
    if current['status'] in ('done','failed','cancelled','interrupted'):
        print(json.dumps(current),flush=True)
        assert current['status']=='done', current
        asset = next(a for a in state['records'] if a['id']==current['result'])
        with urlopen(base+'media/'+asset['id'],timeout=30) as response:
            assert response.read(8)==b'\x89PNG\r\n\x1a\n', 'Media endpoint did not return PNG'
        target.write_text(json.dumps({'story_id':story['id'],'job_id':job['id'],'asset_id':asset['id'],'status':'verified'}))
        print('API_AND_MEDIA_VERIFIED',flush=True)
        break
    time.sleep(2)
else: raise RuntimeError('Verification timed out')
