import copy
import unittest
from unittest.mock import patch
import audio_video_sequence as sequence

class Problem(Exception): pass
class Controls(unittest.TestCase):
 def setUp(self):
  self.rows={'parent':dict(id='parent',kind='audio_video_job',status='running',children=['child'],request={'clips':[{},{}]}),'child':dict(id='child',kind='longcat_job',status='running')}
  self.env={'get':lambda jid,kind:copy.deepcopy(self.rows[jid]),'save':lambda row:self.rows.update({row['id']:copy.deepcopy(row)}),'Problem':Problem}
 def test_stop_never_submits_next_clip(self):
  sequence.control({'job_id':'parent','action':'stop'},self.env)
  with patch.object(sequence.renderer,'generate') as generate:
   sequence.advance(copy.deepcopy(self.rows['parent']),self.env)
   self.assertEqual(self.rows['parent']['status'],'running')
   self.rows['child']['status']='done'
   sequence.advance(copy.deepcopy(self.rows['parent']),self.env)
   self.assertEqual(self.rows['parent']['status'],'cancelled');generate.assert_not_called()
 def test_pause_and_resume_preserve_completed_children(self):
  stale=copy.deepcopy(self.rows['parent'])
  sequence.control({'job_id':'parent','action':'pause'},self.env)
  self.rows['child']['status']='done'
  with patch.object(sequence.renderer,'generate') as generate:
   sequence.advance(stale,self.env)
   self.assertEqual(self.rows['parent']['status'],'paused');generate.assert_not_called()
  sequence.control({'job_id':'parent','action':'resume'},self.env)
  self.assertEqual(self.rows['parent']['status'],'running')
  self.assertEqual(self.rows['parent']['children'],['child'])
  self.assertFalse(self.rows['parent']['pause_requested'])
 def test_stop_is_not_undone_by_resume(self):
  sequence.control({'job_id':'parent','action':'stop'},self.env)
  sequence.control({'job_id':'parent','action':'resume'},self.env)
  self.assertTrue(self.rows['parent']['stop_requested'])
if __name__=='__main__': unittest.main()
