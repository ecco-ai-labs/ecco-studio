import base64
import importlib.util
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
import frame_editor as fe
import frame_repair as fr

spec=importlib.util.spec_from_file_location('repair_worker',Path(__file__).parents[1]/'video/frame-repair/worker.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)

class Problem(Exception):
 def __init__(self,message,code=400):super().__init__(message);self.code=code

class RepairTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.old=fr.ROOT;fr.ROOT=self.root/'repair'
  self.source=self.root/'film.mp4';fe.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=160x96:rate=25:duration=2','-c:v','libx264','-threads','1',str(self.source)])
  self.asset={'id':'film','kind':'asset','media':'video','story_id':'story'}
  self.env={'get':lambda *_:self.asset,'asset_path':lambda _:self.source,'LEGACY_STORY':'legacy','Problem':Problem}
  self.body={'request_id':'a'*32,'asset_id':'film','story_id':'story','fps':25,'total':50,'original_frame_ids':[12,16,17], 'instructions':'Keep the tree rooted','worker_id':'gpu','replacements':{}}
  fr.atomic(fr.ROOT/'workers/gpu.json',{'updated':time.time(),'ready':True,'busy':False})
 def tearDown(self):fr.ROOT=self.old;self.temp.cleanup()
 def prepare(self):
  with patch.object(fr.threading,'Thread'):
   job=fr.submit(self.body,self.env)
  directory=fr.ROOT/'jobs'/job['id'];fr.prepare(directory,job,self.source,{'replacements':{}},self.body['instructions'])
  return directory,json.loads((directory/'request.json').read_text())
 def test_context_masks_targets_candidate_and_export_preserve_original(self):
  original=self.source.read_bytes();directory,request=self.prepare()
  self.assertEqual((request['from'],request['to']),(2,27))
  frames,masks,width,height=worker.conditions(directory,request)
  self.assertEqual((len(frames)-1)%4,0)
  self.assertEqual([request['from']+i for i,m in enumerate(masks) if m.getpixel((0,0))==255],[12,16,17])
  generated=[Image.new('RGB',(width,height),'red') for _ in frames]
  worker.save_candidate(directory,request,generated)
  fr.atomic(directory/'result.json',{'status':'done'})
  candidate=fr.candidate(request['id'],self.env)
  self.assertEqual(set(candidate['frames']),{'12','16','17'})
  result=fe.render(self.source,self.root/'edited.mp4',{'total':50,'removed':[],'replacements':candidate['frames']})
  self.assertEqual(result['frames'],50);self.assertEqual(original,self.source.read_bytes())
 def test_idempotence_and_stale_worker(self):
  with patch.object(fr.threading,'Thread') as thread:
   first=fr.submit(self.body,self.env);second=fr.submit(self.body,self.env);self.assertEqual(first['id'],second['id']);self.assertEqual(thread.call_count,1)
   with self.assertRaises(Problem):fr.submit({**self.body,'instructions':'different'},self.env)
  fr.atomic(fr.ROOT/'workers/gpu.json',{'updated':time.time()-60,'ready':True})
  self.assertFalse(fr.status()['available'])
  with self.assertRaises(Problem):fr.submit({**self.body,'request_id':'b'*32},self.env)
 def test_invalid_selection_and_source_rejected_before_queue(self):
  for values in ([],[0],[True],[51]):
   with self.assertRaises(Problem):fr.submit({**self.body,'original_frame_ids':values},self.env)
  with self.assertRaises(Problem):fr.submit({**self.body,'story_id':'wrong'},self.env)
  with self.assertRaises(Problem):fr.candidate('../private',self.env)
 def test_candidate_unavailable_until_completion(self):
  directory,request=self.prepare()
  with self.assertRaises(Problem):fr.candidate(request['id'],self.env)
  worker.save_candidate(directory,request,[Image.new('RGB',(160,96),'blue')]*29)
  self.assertFalse((directory/'output'/'000013.jpg').exists())

if __name__=='__main__':unittest.main()
