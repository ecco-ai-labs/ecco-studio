import array
import tempfile
import wave
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch
from audio_schema import validate, required_models
from audio_queue import request_ready
from mixed_worker import stitch


class MixedVoices(TestCase):
    def request(self):
        return validate({'model': 'chatterbox', 'compute': 'cpu', 'worker_id': 'testcpu', 'pause': .35,
                         'lines': [{'text': 'First voice.', 'language': 'English', 'model': 'kokoro', 'voice': 'af_heart', 'pitch': 2},
                                   {'text': 'Second voice.', 'language': 'English', 'voice': 'default', 'exaggeration': .7, 'pause_before': .4},
                                   {'text': 'First returns.', 'language': 'English', 'model': 'kokoro', 'voice': 'af_heart', 'pause_before': 0}]})

    def test_schema_preserves_per_character_model_and_controls(self):
        r = self.request()
        self.assertEqual(required_models(r), {'kokoro', 'chatterbox'})
        self.assertEqual(r['mixed_models_version'], 1)
        self.assertEqual(r['lines'][0]['pitch'], 2)
        self.assertEqual(r['lines'][1]['exaggeration'], .7)
        for model, language, voice in [('kokoro', 'Hindi', 'af_heart'), ('indic-parler', 'Tamil', 'hindi-rohit'), ('bad', 'English', 'default')]:
            with self.assertRaises(ValueError):
                validate({'lines': [{'text': 'Test', 'model': model, 'language': language, 'voice': voice}]})

    def test_no_union_of_different_workers_or_silent_gpu_fallback(self):
        r = self.request()
        workers = [dict(compute='cpu',pod='testcpu',instance_routing_version=1,mixed_models_version=1,models=['kokoro']),
                   dict(compute='cpu',pod='othercpu',instance_routing_version=1,mixed_models_version=1,models=['chatterbox'])]
        with patch('audio_queue.workers',return_value=workers):
            self.assertFalse(request_ready(r))
            workers[0]['models'].append('chatterbox')
            self.assertTrue(request_ready(r))
            workers[0]['mixed_models_version']=0
            self.assertFalse(request_ready(r))

    def test_original_order_exact_pauses_and_post_dsp_boundaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); sources=[]
            for i,rate in enumerate((24000,48000)):
                source=root/f'model-{i}.wav'
                with wave.open(str(source),'wb') as f:
                    f.setparams((1,2,rate,0,'NONE','not compressed'))
                    f.writeframes(array.array('h',[1000 if i==0 else -1000]*rate).tobytes())
                sources.append(source)
            request=self.request();out=root/'output.wav'
            segments=[(sources[0],{'start':0,'end':.4}),(sources[1],{'start':0,'end':.5}),(sources[0],{'start':.4,'end':1})]
            stitch(request,segments,out)
            with wave.open(str(out),'rb') as f:
                self.assertEqual(f.getframerate(),48000)
                pcm=array.array('h',f.readframes(f.getnframes()))
            self.assertAlmostEqual(len(pcm)/48000,1.9,places=4)
            self.assertGreater(pcm[1000],0)
            self.assertEqual(pcm[int(.5*48000)],0)
            self.assertLess(pcm[int(.9*48000)],0)
            self.assertGreater(pcm[int(1.5*48000)],0)

    def test_native_direction_is_separate_from_speech_and_bounded(self):
        line={'text':'Keep these words.', 'model':'indic-parler','language':'Hindi','voice':'hindi-rohit','direction':'Warm storyteller, gently surprised.'}
        r=validate({'lines':[line]})
        self.assertEqual(r['lines'][0]['text'],line['text'])
        self.assertEqual(r['lines'][0]['direction'],line['direction'])
        with self.assertRaises(ValueError):validate({'lines':[{**line,'direction':'x'*1201}]})
