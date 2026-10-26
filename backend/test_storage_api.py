import base64, importlib.util, io, json, sqlite3, tempfile, threading, unittest, wave
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('storage_api',Path(__file__).with_name('storage_api.py'))
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
class StorageTest(unittest.TestCase):
 def test_audio_verification_is_authenticated_and_does_not_generate(self):
  report={'version':1,'ready':False,'checks':[],'generates_audio':False}
  with patch.object(api.audio_preflight,'verify',return_value=report) as verify:
   with self.assertRaises(HTTPError) as error:self.call('/api/audio/verify',{},auth=False)
   self.assertEqual(error.exception.code,401);verify.assert_not_called()
   with self.assertRaises(HTTPError) as error:self.call('/api/audio/verify',{},origin='https://untrusted.example')
   self.assertEqual(error.exception.code,403);verify.assert_not_called()
   with self.call('/api/audio/verify',{'speech':{'model':'kokoro'}}) as response:self.assertEqual(json.load(response),report)
   self.assertEqual(verify.call_args.args[0],{'speech':{'model':'kokoro'}})
 def test_character_routes_require_workspace_authorization(self):
  for path in ('save','approve','generate','upload'):
   with self.assertRaises(HTTPError) as error:self.call('/api/character-studio/'+path,{},auth=False)
   self.assertEqual(error.exception.code,401)
   with self.assertRaises(HTTPError) as error:self.call('/api/character-studio/'+path,{},origin='https://untrusted.example')
   self.assertEqual(error.exception.code,403)
  with self.assertRaises(HTTPError) as error:self.call('/api/character-studio/status',auth=False)
  self.assertEqual(error.exception.code,401)
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
 def test_audio_schedule_routes_require_workspace_auth(self):
  for path in ('/api/audio/workflows/save','/api/audio/workflows/control'):
   for auth,origin,code in [(False,api.ALLOWED_ORIGIN,401),(True,'https://untrusted.example',403)]:
    with self.assertRaises(HTTPError) as error:self.call(path,{},auth=auth,origin=origin)
    self.assertEqual(error.exception.code,code)
  with self.assertRaises(HTTPError) as error:self.call('/api/audio/workflows/status',auth=False)
  self.assertEqual(error.exception.code,401)
 def test_audio_schedule_save_status_and_disabled_runner(self):
  body={'id':'12345678-1234-1234-1234-123456789abc','name':'News','source_mode':'news','prompt':'Science news',
   'start_date':'2026-10-24','audio_snapshot':{'model':'indic-mio','compute':'cpu','genre':'News','presentation':'single','speakers':[{'id':'narrator','name':'Narrator','language':'Hindi','voice':'en_female','emotion':'neutral'}]}}
  with self.call('/api/audio/workflows/save',body) as response:saved=json.load(response)
  self.assertEqual(saved['status'],'paused');self.assertFalse(saved['schedule_requested']);self.assertEqual(len(saved['id']),32)
  self.assertEqual(api.legacy.get(saved['id'],'workflow')['name'],'News')
  with self.call('/api/audio/workflows/status') as response:status=json.load(response)
  self.assertEqual(len(status['workflows']),1);self.assertEqual(status['runs'],[])
  with patch.object(api.audio_workflows,'STARTED',False),self.assertRaises(HTTPError) as error:
   self.call('/api/audio/workflows/control',{'id':saved['id'],'action':'enable'})
  self.assertEqual(error.exception.code,503)
 def test_google_identity_cannot_access_workspace(self):
  import google_signin
  import time
  pending=google_signin.challenge()
  claims={'sub':'new-user','aud':google_signin.CLIENT_ID,'iss':'https://accounts.google.com','exp':time.time()+3600,'nonce':pending['nonce']}
  with patch.object(google_signin,'SESSION_DB',Path(self.tmp.name)/'sessions.sqlite3'),patch.object(google_signin,'verifier',return_value=claims):
   signed=google_signin.login({'challenge':pending['challenge'],'credential':'test'})
  with self.assertRaises(HTTPError) as error:
   self.call('/api/state',auth=False,extra={'Authorization':'Bearer '+signed['session_token']})
  self.assertEqual(error.exception.code,401)
 def test_support_inbox_setup_requires_existing_workspace_owner(self):
  import ecco_desk_inbox as inbox
  with patch.object(inbox,'start',return_value={'url':'https://accounts.google.com/fixture'}) as start:
   for auth,origin,code in [(False,api.ALLOWED_ORIGIN,401),(True,'https://untrusted.example',403)]:
    with self.assertRaises(HTTPError) as error:self.call('/api/desk/inbox/connect',{},auth=auth,origin=origin,extra={'Content-Type':'application/json'})
    self.assertEqual(error.exception.code,code)
   start.assert_not_called()
   with self.call('/api/desk/inbox/connect',{},extra={'Content-Type':'application/json'}) as response:self.assertIn('url',json.load(response))
   start.assert_called_once()
   with self.assertRaises(HTTPError) as error:self.call('/api/desk/inbox/connect')
   self.assertEqual(error.exception.code,405)
 def test_google_routes_origin_and_json(self):
  import google_signin
  with patch.object(google_signin,'ready',return_value=True):
   with self.assertRaises(HTTPError) as error:self.call('/api/auth/challenge',{},auth=False,origin='https://evil.example')
   self.assertEqual(error.exception.code,403)
   with self.call('/api/auth/challenge',{},auth=False,extra={'Content-Type':'application/json'}) as response:
    self.assertIn('nonce',json.load(response))
 def test_unauthorized_no_data(self):
  with self.assertRaises(HTTPError) as error:self.call('/api/state',auth=False)
  self.assertEqual(error.exception.code,401)
 def test_youtube_write_routes_require_workspace_authorization(self):
  with patch.object(api.youtube_connection,'start') as start,patch.object(api.youtube_connection,'publish') as publish:
   for path in ('/api/youtube/connect','/api/youtube/publish','/api/youtube/disconnect','/api/youtube/configure','/api/youtube/playlists'):
    for auth,origin,code in [(False,api.ALLOWED_ORIGIN,401),(True,'https://untrusted.example',403)]:
     with self.assertRaises(HTTPError) as error:self.call(path,{},auth=auth,origin=origin)
     self.assertEqual(error.exception.code,code)
   start.assert_not_called();publish.assert_not_called()
 def test_youtube_connect_and_publish_dispatch_on_cpu(self):
  with patch.object(api.youtube_connection,'start',return_value={'url':'https://accounts.google.com/test'}) as start:
   with self.call('/api/youtube/connect',{}) as response:self.assertIn('url',json.load(response))
   start.assert_called_once_with(playlists=False)
  with patch.object(api.youtube_connection,'publish',return_value={'id':'test-job'}) as publish:
   with self.call('/api/youtube/publish',{'confirmed':True}) as response:self.assertEqual(json.load(response)['id'],'test-job')
   publish.assert_called_once_with({'confirmed':True})
 def test_playlist_reads_and_writes_are_authenticated_and_dispatch(self):
  with patch.object(api.youtube_connection,'playlists',return_value={'channel_id':'UC-one','playlists':[]}) as playlists:
   with self.assertRaises(HTTPError) as error:self.call('/api/youtube/playlists',auth=False)
   self.assertEqual(error.exception.code,401);playlists.assert_not_called()
   with self.call('/api/youtube/playlists') as response:self.assertEqual(json.load(response)['playlists'],[])
  with patch.object(api.youtube_connection,'create_playlist',return_value={'playlist':{'id':'PL-one'}}) as create:
   with self.call('/api/youtube/playlists',{'confirmed':True}) as response:self.assertEqual(json.load(response)['playlist']['id'],'PL-one')
   create.assert_called_once_with({'confirmed':True})
  with patch.object(api.youtube_connection,'start',return_value={'url':'https://accounts.google.com/test'}) as start:
   with self.call('/api/youtube/connect',{'playlists':True}) as response:self.assertIn('url',json.load(response))
   start.assert_called_once_with(playlists=True)
 def test_youtube_configuration_is_authenticated_bounded_and_not_echoed(self):
  import youtube_connection as yt
  config={'web':{'client_id':yt.google_signin.CLIENT_ID,'client_secret':'fixture-private-secret',
                 'auth_uri':'https://accounts.google.com/o/oauth2/auth','token_uri':'https://oauth2.googleapis.com/token','redirect_uris':[yt.CALLBACK]}}
  root=Path(self.tmp.name)/'private'
  with patch.object(yt,'CLIENT_FILE',root/'client.json'),patch.object(yt,'TOKEN_FILE',root/'token.json'),patch.object(yt,'KEY_FILE',root/'key'):
   with self.assertRaises(HTTPError) as error:self.call('/api/youtube/configure',{'oversized':'x'*32768})
   self.assertEqual(error.exception.code,413);self.assertFalse(root.exists())
   with self.call('/api/youtube/configure',config) as response:
    body=response.read();self.assertTrue(json.loads(body)['youtube_configured'])
    self.assertNotIn(b'fixture-private-secret',body)
   self.assertNotIn('fixture-private-secret',(root/'client.json').read_text())
   with self.call('/api/state') as response:
    body=response.read();self.assertNotIn(b'fixture-private-secret',body)
    self.assertFalse(json.loads(body)['config']['youtube_setup_available'])
   with self.assertRaises(HTTPError) as error:self.call('/api/youtube/configure',config)
   self.assertEqual(error.exception.code,409)
 def test_youtube_callback_is_public_but_requires_valid_state(self):
  with self.assertRaises(HTTPError) as error:self.call('/api/youtube/callback?code=never-log-this',auth=False)
  self.assertEqual(error.exception.code,403)
  self.assertNotIn(b'never-log-this',error.exception.read())
 def test_youtube_callback_success_returns_no_codes_or_tokens(self):
  with patch.object(api.youtube_connection,'finish',return_value={'handle':'@EccoAILabs'}) as finish:
   with self.call('/api/youtube/callback?state=test-state&code=test-code',auth=False) as response:
    page=response.read();self.assertIn(b'@EccoAILabs is connected',page)
    self.assertNotIn(b'test-code',page);self.assertNotIn(b'test-state',page)
    self.assertEqual(response.headers['Cache-Control'],'no-store')
    self.assertEqual(response.headers['Referrer-Policy'],'no-referrer')
   finish.assert_called_once_with({'state':['test-state'],'code':['test-code']})
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




 def test_sound_routes_require_auth_and_a_verified_runtime(self):
  body={'kind':'effect','description':'Gentle wind','compute':'cpu'}
  with self.assertRaises(HTTPError) as error:self.call('/api/audio/sounds/generate',body,auth=False)
  self.assertEqual(error.exception.code,401)
  with patch.object(api.audio_jobs.queue,'workers',return_value=[]),self.assertRaises(HTTPError) as error:self.call('/api/audio/sounds/generate',body)
  self.assertEqual(error.exception.code,503)
 def test_reviewed_audio_story_retains_cast_script_and_named_cues_on_update(self):
  prep={'cast':[{'id':'n','name':'Narrator'}],'plan':{'opening':None,'segments':[{'character_id':'n','text':'The merchant returned.'}]},'sound_design':{'cues':[{'name':'Desert Wind','description':'Soft wind'}]},'source_scope':'selected','source_text':'Selected chapter only.'}
  with self.call('/api/stories',{'title':'Chapter 1','summary':'Narrator: The merchant returned.','audio_preparation':prep}) as response:story=json.load(response)
  self.assertEqual(story['audio_preparation'],prep);self.assertEqual(story['story_format'],'audio')
  prep['cast'][0]['name']='Storyteller'
  with self.call('/api/stories',{'story_id':story['id'],'title':'Chapter 1 revised','summary':'Storyteller: The merchant returned.','audio_preparation':prep}) as response:updated=json.load(response)
  self.assertEqual(updated['id'],story['id']);self.assertEqual(api.legacy.get(story['id'],'story')['audio_preparation']['cast'][0]['name'],'Storyteller')

if __name__=='__main__':unittest.main()
