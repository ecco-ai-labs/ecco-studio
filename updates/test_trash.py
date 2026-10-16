import copy, threading, unittest
from pathlib import Path
import trash_manager as trash
class Problem(Exception):pass
class Tests(unittest.TestCase):
 def setUp(self):
  self.data={'board':{'id':'board','kind':'board','scenes':[{'image_id':'image'}]},'image':{'id':'image','kind':'asset','deleted':True},'story':{'id':'story','kind':'story','deleted':True},'char':{'id':'char','kind':'character','image_ids':['image','keep']}}
  def save(r):self.data[r['id']]=copy.deepcopy(r);return r
  def purge(body):self.data[body['asset_id']]={'id':body['asset_id'],'kind':'purged'}
  self.env={'LOCK':threading.RLock(),'Problem':Problem,'records':lambda:copy.deepcopy(list(self.data.values())),'get':lambda i,k:copy.deepcopy(self.data[i]),'save':save,'purge_asset':purge,'asset_path':lambda r:Path('/tmp/no-file')}
 def test_delete_restore_board(self):
  trash.board({'id':'board'},self.env);self.assertTrue(self.data['board']['deleted'])
  trash.board({'id':'board','restore':True},self.env);self.assertFalse(self.data['board']['deleted'])
 def test_folder_delete_restore_preserves_images(self):
  self.data['folder']={'id':'folder','kind':'image_folder','name':'Examples'}
  trash.folder({'id':'folder'},self.env);self.assertTrue(self.data['folder']['deleted'])
  self.assertIn('image',self.data)
  trash.folder({'id':'folder','restore':True},self.env);self.assertFalse(self.data['folder']['deleted'])
 def test_empty_folder_preserves_images(self):
  self.data['folder']={'id':'folder','kind':'image_folder','deleted':True}
  trash.empty({'ids':['folder'],'confirmed':True},self.env)
  self.assertEqual(self.data['image']['kind'],'asset')
 def test_empty_requires_confirmation(self):
  with self.assertRaises(Problem):trash.empty({'ids':['image']},self.env)
  self.assertEqual(self.data['image']['kind'],'asset')
 def test_cannot_purge_live_record(self):
  with self.assertRaises(Problem):trash.empty({'ids':['board'],'confirmed':True},self.env)
 def test_busy_job_blocks_empty(self):
  self.data['job']={'id':'job','kind':'job','status':'running'}
  with self.assertRaises(Problem):trash.empty({'ids':['image'],'confirmed':True},self.env)
 def test_empty_cleans_refs_and_preserves_story_tombstone(self):
  result=trash.empty({'ids':['image','story'],'confirmed':True},self.env)
  self.assertEqual(result['purged_count'],2);self.assertEqual(self.data['board']['scenes'][0]['image_id'],'');self.assertEqual(self.data['char']['image_ids'],['keep']);self.assertTrue(self.data['story']['purged']);self.assertEqual(self.data['story']['kind'],'story')
if __name__=='__main__':unittest.main()
