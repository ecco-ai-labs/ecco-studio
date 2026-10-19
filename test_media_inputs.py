import sys,tempfile,subprocess,json,unittest
from pathlib import Path
sys.path[:0]=[str(Path(__file__).parent/'backend'),str(Path(__file__).parent/'video')]
import video_reference_context,video_audio_inputs
class Problem(Exception):
 def __init__(self,message,code=400):super().__init__(message)
class MediaTests(unittest.TestCase):
 def test_real_video_frames_and_ordered_original_audio(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)
   for i,freq in enumerate([440,880]):
    subprocess.run(['ffmpeg','-y','-v','error','-f','lavfi','-i',f'sine=frequency={freq}:duration=0.4',str(root/f'{i}.wav')],check=True)
   subprocess.run(['ffmpeg','-y','-v','error','-f','lavfi','-i','color=c=blue:s=128x128:d=1','-c:v','libx264',str(root/'v.mp4')],check=True)
   records={'a':dict(id='a',media='audio',path='0.wav'),'b':dict(id='b',media='audio',path='1.wav'),'v':dict(id='v',media='video',title='Reference',path='v.mp4')}
   env={'get':lambda i,k:records[i],'asset_path':lambda a:root/a['path'],'Problem':Problem,'DATA':root,'save':lambda a:records.update({a['id']:a})}
   class Renderer:
    def probe(self,path):return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-of','json',str(path)]))
   combined=video_audio_inputs.prepare(['a','b'],env,Renderer())
   self.assertAlmostEqual(float(Renderer().probe(root/combined['path'])['format']['duration']),.8,places=2)
   self.assertEqual(combined['source_audio_ids'],['a','b'])
   frames=video_reference_context.content(['v'],env,Problem)
   self.assertEqual(sum(x['type']=='input_image' for x in frames),4)
   self.assertIn('not an exact motion',frames[0]['text'])
   records['v']['deleted']=True
   with self.assertRaises(Problem):video_reference_context.content(['v'],env,Problem)
if __name__=='__main__':unittest.main()
