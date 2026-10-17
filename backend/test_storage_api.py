import base64, importlib.util, io, json, sqlite3, tempfile, threading, unittest, wave
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('storage_api',Path(__file__).with_name('storage_api.py'))
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
class StorageTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();api.legacy.DATA=Path(self.tmp.name)
  with sqlite3.connect(api.legacy.DATA/'studio.sqlite') as db:
   db.execute('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,body TEXT)')
  self.aid='a'*32; (api.legacy.DATA/'sample.png').write_bytes(b'0123456789')
  api.legacy.save({'id':self.aid,'kind':'asset','media':'image','path':'sample.png','created':1})
  api.Handler.access_key='test-only-'+'x'*32
  self.server=ThreadingHTTPServer(('127.0.0.1',0),api.Handler)
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
  self.base='http://127.0.0.1:'+str(self.server.server_port)
 def tearDown(self):
  self.server.shutdown();self.server.server_close();self.tmp.cleanup()
 def call(self,path,body=None,auth=True,origin=api.ALLOWED_ORIGIN,extra=None):
  headers={'Origin':origin,**(extra or {})}
  if auth:headers['Authorization']='Bearer '+api.Handler.access_key
  return urlopen(Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers))
 def test_unauthorized_no_data(self):
  with self.assertRaises(HTTPError) as error:self.call('/api/state',auth=False)
  self.assertEqual(error.exception.code,401)
 def test_origin_denied(self):
  with self.assertRaises(HTTPError) as error:self.call('/api/state',origin='https://untrusted.example')
  self.assertEqual(error.exception.code,403)
 def test_ai_routes_require_workspace_auth_and_origin(self):
  with patch.object(api.openai_assistant, 'handle') as provider:
   for auth,origin,code in [(False,api.ALLOWED_ORIGIN,401),(True,'https://untrusted.example',403)]:
    with self.assertRaises(HTTPError) as error:self.call('/api/ai/connect',{'api_key':'test-only'},auth=auth,origin=origin)
    self.assertEqual(error.exception.code,code)
   provider.assert_not_called()
 def test_ai_status_does_not_expose_key(self):
  with patch.object(api.openai_assistant,'CONFIG_FILE',Path(self.tmp.name)/'private.json'):
   api.openai_assistant._save({'api_key':'test-secret','verified':True,'enabled':False,'model':'gpt-6-astra'})
   with self.call('/api/ai/status') as response:result=json.load(response)
   self.assertTrue(result['connected']);self.assertFalse(result['enabled']);self.assertNotIn('test-secret',json.dumps(result));self.assertNotIn('api_key',result)
 def test_scene_planning_obeys_shared_switch(self):
  with patch.object(api.openai_assistant,'CONFIG_FILE',Path(self.tmp.name)/'private.json'),patch.object(api.openai_assistant,'_request') as provider:
   api.openai_assistant._save({'api_key':'test-secret','verified':True,'enabled':False,'model':'gpt-6-astra'})
   with self.assertRaises(HTTPError) as error:self.call('/api/stories/plan',{'story':'A story','count':1})
   self.assertEqual(error.exception.code,409);provider.assert_not_called()
 def test_read_and_range_without_gpu(self):
  with self.call('/api/state') as r:
   result=json.load(r);self.assertTrue(result['config']['storage']['gpu_independent']);self.assertEqual(len(result['records']),1)
  with self.call('/api/media/'+self.aid,extra={'Range':'bytes=2-5'}) as r:
   self.assertEqual(r.status,206);self.assertEqual(r.read(),b'2345');self.assertEqual(r.headers['Access-Control-Allow-Origin'],api.ALLOWED_ORIGIN)
 def test_folder_persists(self):
  with self.call('/api/library/folders',{'name':'Test label'}) as r:folder=json.load(r)
  self.assertEqual(api.legacy.get(folder['id'])['name'],'Test label')
 def test_generation_rejected(self):
  with self.assertRaises(HTTPError) as error:self.call('/api/images',{'prompt':'test'})
  self.assertEqual(error.exception.code,409)
 def audio_upload(self):
  data=io.BytesIO()
  with wave.open(data,'wb') as out:
   out.setnchannels(1);out.setsampwidth(2);out.setframerate(8000);out.writeframes(b'\x00\x00'*800)
  with self.call('/api/audio/upload',{'name':'../sample.wav','data':base64.b64encode(data.getvalue()).decode()}) as response:
   return json.load(response),data.getvalue()
 def test_audio_upload_playback_without_gpu(self):
  asset,raw=self.audio_upload()
  self.assertEqual(asset['media'],'audio');self.assertEqual(asset['title'],'sample.wav')
  self.assertTrue(asset['path'].startswith('audio-prod/'));self.assertAlmostEqual(asset['seconds'],0.1)
  with self.call('/api/media/'+asset['id']) as response:self.assertEqual(response.read(),raw)
 def test_invalid_audio_leaves_no_files_or_records(self):
  with self.assertRaises(HTTPError) as error:
   self.call('/api/audio/upload',{'name':'fake.wav','data':base64.b64encode(b'not audio').decode()})
  self.assertEqual(error.exception.code,400)
  self.assertFalse(list((api.legacy.DATA/'audio-prod').iterdir()))
  self.assertFalse([r for r in api.legacy.records() if r.get('media')=='audio'])
 def test_audio_names_multiple_labels_and_isolation(self):
  asset,_=self.audio_upload();folder_ids=[]
  for name in ['Narration','Narration / Hindi']:
   with self.call('/api/audio/folders',{'name':name}) as response:folder_ids.append(json.load(response)['id'])
  body={'asset_id':asset['id'],'folder_ids':folder_ids,'title':'Opening narration'}
  for _ in range(2):
   with self.call('/api/audio/labels',body) as response:self.assertEqual(json.load(response)['title'],'Opening narration')
  self.assertEqual(len(api.legacy.records('library_item')),2)
  with self.call('/api/library/folders',{'name':'Narration'}) as response:image_folder=json.load(response)
  self.assertNotIn(image_folder['id'],folder_ids)
  with self.assertRaises(HTTPError):self.call('/api/audio/labels',{**body,'title':'Must not save','folder_ids':[image_folder['id']]})
  self.assertEqual(api.legacy.get(asset['id'])['title'],'Opening narration')
 def test_audio_label_trash_and_restore(self):
  with self.call('/api/audio/folders',{'name':'Test audio'}) as response:folder=json.load(response)
  with self.call('/api/trash/folder',{'id':folder['id']}) as response:self.assertTrue(json.load(response)['deleted'])
  with self.call('/api/trash/folder',{'id':folder['id'],'restore':True}) as response:self.assertFalse(json.load(response)['deleted'])
 def test_escape_denied(self):
  api.legacy.save({'id':'b'*32,'kind':'asset','media':'image','path':'../outside'})
  with self.assertRaises(HTTPError) as error:self.call('/api/media/'+'b'*32)
  self.assertEqual(error.exception.code,404)
if __name__=='__main__':unittest.main()


