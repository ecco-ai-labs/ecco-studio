import tempfile
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf
from audio_schema import validate
from audio_worker import assemble

class Assembly(unittest.TestCase):
    def test_exact_pause_after_dsp(self):
        rate=24000
        clip=np.sin(np.arange(rate//3)*.08).astype('float32')*.4
        for speed in (.75,1,1.5):
            with self.subTest(speed=speed), tempfile.TemporaryDirectory() as root:
                req={'pitch':2,'speed':speed,'pause':.35,'lines':[{}, {'pause_before':2}]}
                one=Path(root)/'one.wav';both=Path(root)/'both.wav'
                assemble([clip],req,one,rate);assemble([clip,clip],req,both,rate)
                a,_=sf.read(one);b,r=sf.read(both)
                self.assertEqual(r,rate)
                self.assertEqual(len(b),2*len(a)+2*rate)
                self.assertTrue(np.all(b[len(a):len(a)+2*rate]==0))
    def test_pause_validation(self):
        body={'lines':[{'text':'Title'},{'text':'News','pause_before':2}]}
        self.assertEqual(validate(body)['lines'][1]['pause_before'],2)
        for bad in (-1,11,True,float('nan'),'2'):
            body['lines'][1]['pause_before']=bad
            with self.assertRaises(ValueError):validate(body)

if __name__=='__main__':unittest.main()
