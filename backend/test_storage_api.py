import importlib.util, json, sqlite3, tempfile, threading, unittest
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
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
 def test_escape_denied(self):
  api.legacy.save({'id':'b'*32,'kind':'asset','media':'image','path':'../outside'})
  with self.assertRaises(HTTPError) as error:self.call('/api/media/'+'b'*32)
  self.assertEqual(error.exception.code,404)
if __name__=='__main__':unittest.main()
