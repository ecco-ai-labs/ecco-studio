"""Three-second end-to-end inference check using the upstream public demo assets."""
import json
from pathlib import Path
import shutil
import subprocess
import time
from longcat_jobs import ROOT,run_shot,write,read
d=ROOT/'validation';d.mkdir(exist_ok=True)
assets=ROOT/'source/assets/avatar/single'
shutil.copyfile(assets/'man.png',d/'image.png')
subprocess.run(['ffmpeg','-y','-v','error','-i',str(assets/'man.mp3'),'-t','3','-ac','1','-ar','16000','-f','wav',str(d/'audio-source')],check=True)
request=dict(prompt='The same man in the reference speaks naturally into his microphone. Preserve his face, red jacket, pose, stage and lighting. Natural mouth movement synchronized to the dialogue.',duration=3.0,resolution='832x480',seed=42)
started=time.time(); run_shot(d,request)
result=read(d/'status.json',{})
if result.get('status')!='complete': raise RuntimeError('Generation did not complete')
frames=subprocess.check_output(['ffmpeg','-v','error','-i',str(d/'output.mp4'),'-an','-vf','fps=1','-f','framemd5','-'],text=True)
hashes={line.split(',')[-1].strip() for line in frames.splitlines() if line and not line.startswith('#')}
if len(hashes)<3: raise RuntimeError('Validation clip has no sustained frame motion')
write(ROOT/'validated.json',dict(passed=True,gpu='B200',seconds=time.time()-started,output=str(d/'output.mp4'),checked=time.time(),**result))
print('LONGCAT_VALIDATION_PASSED',json.dumps(result),flush=True)
