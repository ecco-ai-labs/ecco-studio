import importlib.util
from pathlib import Path
import unittest
import tempfile
import hashlib
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('longcat_jobs',Path(__file__).with_name('longcat_jobs.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Problem(Exception):
    def __init__(self,message,code=400): super().__init__(message);self.code=code

class Validation(unittest.TestCase):
    def test_completed_video_is_saved_with_audio_and_job_result(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); queue=root/'queue'; d=queue/'job';d.mkdir(parents=True)
            content=b'test video payload';(d/'output.mp4').write_bytes(content)
            module.write(d/'status.json',{'status':'complete','duration':3,'sha256':hashlib.sha256(content).hexdigest()})
            job={'id':'job','status':'running','story_id':'story','title':'Dialogue','request':{'prompt':'Speak'}}
            saved=[];env={'get':lambda *args:job,'save':saved.append,'DATA':root/'data'}
            with patch.object(module,'QUEUE',queue):module.finalize(job,env)
            self.assertEqual(job['status'],'done')
            self.assertTrue(saved[0]['has_audio'])
            self.assertEqual(job['result'],[saved[0]['id']])
            self.assertEqual((env['DATA']/saved[0]['path']).read_bytes(),content)
    def env(self):
        assets={'i':{'media':'image'},'a':{'media':'audio'}}
        return {'Problem':Problem,'story_id':lambda b:'story','get':lambda i,k:assets[i],
                'asset_path':lambda a:Path('/unused'),'records':lambda k:[]}
    def test_selected_accelerator_must_have_worker(self):
        with patch.object(module,'status',return_value={'workers':[{'pod':'other'}]}):
            with self.assertRaisesRegex(Problem,'selected accelerator'):
                module.generate({'gpu':'selected'},self.env())
    def test_reject_oversized_dialogue_before_queue_write(self):
        with patch.object(module,'status',return_value={'workers':[{'pod':'selected'}]}),patch.object(module,'probe',return_value={'format':{'duration':'11'}}):
            with self.assertRaisesRegex(Problem,'10 seconds'):
                module.generate({'gpu':'selected','prompt':'Talk','image_id':'i','audio_id':'a'},self.env())
    def test_wrong_reference_type_is_rejected(self):
        with patch.object(module,'status',return_value={'workers':[{'pod':'selected'}]}):
            with self.assertRaisesRegex(Problem,'available image'):
                module.generate({'gpu':'selected','prompt':'Talk','image_id':'a','audio_id':'a'},self.env())

if __name__=='__main__': unittest.main()
