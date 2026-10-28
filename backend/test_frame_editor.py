import json
from pathlib import Path
import tempfile
import unittest
import wave
from unittest.mock import Mock, patch
import frame_editor as fe

class ExportTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.source=self.root/'source.mp4'
  fe.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=25:duration=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-shortest',str(self.source)])
 def tearDown(self): self.temp.cleanup()
 def test_nonconsecutive_export_is_44_frames_with_matching_audio(self):
  out=self.root/'edited.mp4';before=self.source.read_bytes()
  result=fe.render(self.source,out,{'total':50,'removed':[8,12,17,18,19,20],'replacements':{}})
  self.assertEqual(result['frames'],44);self.assertEqual(result['seconds'],1.76);self.assertEqual(before,self.source.read_bytes())
  info=fe.probe(out);audio=next(s for s in info['streams'] if s['codec_type']=='audio');self.assertAlmostEqual(float(audio['duration']),1.76,places=2)
 def test_replacement_retains_duration(self):
  import base64
  image=self.root/'replacement.png'
  fe.run(['ffmpeg','-v','error','-f','lavfi','-i','color=red:size=160x90','-frames:v','1','-threads','1',str(image)])
  data='data:image/png;base64,'+base64.b64encode(image.read_bytes()).decode()
  out=self.root/'replaced.mp4';result=fe.render(self.source,out,{'total':50,'removed':[],'replacements':{'12':data}})
  self.assertEqual(result['frames'],50)
  pixels=fe.run(['ffmpeg','-v','error','-i',str(out),'-vf',"select='eq(n,11)'",'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-threads','1','-'])
  self.assertGreater(sum(pixels[::3])/len(pixels[::3]),200);self.assertLess(sum(pixels[1::3])/len(pixels[1::3]),25)
 def test_public_job_omits_large_replacement_payload(self):
  self.assertNotIn('edit',fe.public_record({'kind':'frame_edit_job','id':'test','edit':{'replacements':{'a':'secret'}}}))
 def test_bad_ids(self):
  for ids in [[0],[51],[True],['1'],[1.2]]:
   with self.assertRaises(ValueError):fe.frame_ids(ids,50)

class PersistenceTest(unittest.TestCase):
 def test_transient_volume_error_retries_same_record(self):
  record={'id':'same-id'}
  save=Mock(side_effect=[fe.sqlite3.OperationalError('disk I/O error'),record])
  with patch.object(fe.time,'sleep'):
   self.assertEqual(fe.persist(record,{'save':save}),record)
  self.assertEqual(save.call_count,2)
  self.assertIs(save.call_args.args[0],record)
 def test_persistent_error_is_bounded(self):
  save=Mock(side_effect=fe.sqlite3.OperationalError('disk I/O error'))
  with patch.object(fe.time,'sleep'),self.assertRaises(fe.sqlite3.OperationalError):fe.persist({'id':'same'},{'save':save})
  self.assertEqual(save.call_count,5)

if __name__=='__main__':unittest.main()
