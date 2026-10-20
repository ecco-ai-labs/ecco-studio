import tempfile
import unittest
from pathlib import Path
from longcat_progress import parse_progress, enrich

class ProgressTests(unittest.TestCase):
    def test_stages(self):
        self.assertEqual(parse_progress('Loading checkpoint shards: 80%|xxxx | 4/5 [00:26]'), 'Loading model: 4/5 shards (80%)')
        log='Generating segment 5/14...\nDenoising: 50%|xxx| 4/8 [x]\rDenoising: 62%|xxx| 5/8 [x]'
        self.assertEqual(parse_progress(log), 'Segment 5/14 · Generating: step 5/8')
        self.assertEqual(parse_progress(log+'\nGenerating segment 6/14...'), 'Segment 6/14')
        self.assertEqual(parse_progress(log+'\nframe= 120'), 'Segment 5/14 · Encoding video')
    def test_projection(self):
        with tempfile.TemporaryDirectory() as tmp:
            q=Path(tmp); ident='a'*32; (q/ident).mkdir(); (q/ident/'worker.log').write_text('Denoising: 75%|xxx| 6/8 [x]')
            records=[{'id':ident,'kind':'longcat_job','status':'running','progress':'Running Generation'}, {'id':'parent','kind':'audio_video_job','status':'running','children':[ident],'request':{'clips':[1,2,3]},'stop_requested':True}]
            result=enrich(records,q)
            self.assertEqual(result[1]['progress'],'Rendering clip 1 of 3 · Generating: step 6/8 · Stopping after this clip')
            self.assertEqual(records[0]['progress'],'Running Generation')
            records[0].update(status='done',progress='Video ready')
            self.assertEqual(enrich(records,q)[0]['progress'],'Video ready')
            records[0]['status']='running'
            self.assertIn('Last progress',enrich(records,q,now=(q/ident/'worker.log').stat().st_mtime+180)[0]['progress'])
    def test_missing(self):
        records=[{'id':'b'*32,'kind':'longcat_job','status':'running','progress':'Starting'}]
        self.assertEqual(enrich(records,Path('/nonexistent')),records)

if __name__=='__main__': unittest.main()
