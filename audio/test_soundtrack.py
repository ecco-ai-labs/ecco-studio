import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
import soundfile as sf
from audio_schema import validate
from audio_soundtrack import mix, snapshot_assets


class SoundtrackTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.rate = 24000

    def tearDown(self):
        self.tmp.cleanup()

    def tone(self, filename, seconds, frequency=1000, amplitude=.4):
        x = np.arange(round(seconds*self.rate))/self.rate
        path = self.root/filename
        sf.write(path, amplitude*np.sin(2*np.pi*frequency*x), self.rate, subtype='PCM_16')
        return path

    def cue(self, **fields):
        return dict(kind='effect', asset_id='test-sound', start_line=0, end_line=0,
                    start_edge='end', level_db=-6, duck=False, loop=False, fade=0, **fields)

    def attach(self, path):
        target = self.root/'sound-0.wav'
        target.write_bytes(path.read_bytes())
        (self.root/'sound-assets.json').write_text(json.dumps({'test-sound':{'file':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}}))

    def test_effect_uses_actual_speech_boundary_and_preserves_silence_before_it(self):
        speech = self.tone('output.wav', 3, amplitude=0)
        self.attach(self.tone('effect.wav', .3))
        request = {'lines':[{'text':'A Jinn appeared.'},{'text':'They were amazed.'}], 'soundtrack':[self.cue()]}
        mix(request, speech, [{'start':0,'end':1.2},{'start':1.5,'end':3}], self.root/'mixed.wav')
        y, rate = sf.read(self.root/'mixed.wav')
        self.assertEqual(rate,48000)
        self.assertEqual(y.shape,(144000,2))
        self.assertLess(np.max(np.abs(y[:round(1.19*rate)])),.0001)
        self.assertGreater(np.max(np.abs(y[round(1.21*rate):round(1.45*rate)])),.1)
        self.assertLess(np.max(np.abs(y[round(1.51*rate):])),.0001)

    def test_music_loops_and_ducks_only_while_speech_is_present(self):
        speech = self.tone('output.wav',4,frequency=220,amplitude=0)
        x=np.arange(96000)/self.rate
        voice=.5*np.sin(2*np.pi*220*x);voice[(x<1)|(x>2)]=0
        sf.write(speech,voice,self.rate,subtype='PCM_16')
        self.attach(self.tone('music.wav',.2,frequency=1000))
        cue=self.cue();cue.update(kind='music',start_edge='start',duck=True,loop=True)
        mix({'lines':[{'text':'Travel'}],'soundtrack':[cue]},speech,[{'start':0,'end':4}],self.root/'mixed.wav')
        y,rate=sf.read(self.root/'mixed.wav');y=y[:,0]
        def amplitude(a,b):
            part=y[round(a*rate):round(b*rate)];t=np.arange(len(part))/rate
            return abs(np.sum(part*np.exp(-2j*np.pi*1000*t)))*2/len(part)
        self.assertGreater(amplitude(.3,.8),.13)
        self.assertLess(amplitude(1.4,1.8),amplitude(.3,.8)*.5)
        self.assertGreater(amplitude(3.2,3.6),.12)

    def test_snapshot_only_uses_workspace_audio_and_retains_queued_bytes(self):
        root=self.root/'data';root.mkdir();source=self.tone('original.wav',.2);target=root/'source.wav';target.write_bytes(source.read_bytes())
        record={'id':'test-sound','kind':'asset','media':'audio','path':'source.wav'}
        env={'DATA':root,'get':lambda *_:record}
        snapshot_assets({'soundtrack':[self.cue()]},self.root/'queue',env)
        original=(self.root/'queue'/'sound-0.wav').read_bytes();target.write_bytes(b'changed')
        self.assertEqual((self.root/'queue'/'sound-0.wav').read_bytes(),original)
        record['path']='../original.wav'
        with self.assertRaisesRegex(ValueError,'available audio'):snapshot_assets({'soundtrack':[self.cue()]},self.root/'other',env)
        record.update(path='source.wav',media='image')
        with self.assertRaises(ValueError):snapshot_assets({'soundtrack':[self.cue()]},self.root/'other',env)

    def test_ducked_effect_can_finish_after_narration_ends(self):
        speech=self.tone('output.wav',1,amplitude=0)
        self.attach(self.tone('effect.wav',.5))
        cue=self.cue();cue['duck']=True
        mix({'lines':[{'text':'The end.'}],'soundtrack':[cue]},speech,[{'start':0,'end':1}],self.root/'mixed.wav')
        y,rate=sf.read(self.root/'mixed.wav')
        self.assertAlmostEqual(len(y)/rate,1.5,places=2)
        self.assertGreater(np.max(np.abs(y[round(1.1*rate):round(1.4*rate)])),.1)

    def test_schema_rejects_missing_files_invalid_timing_and_unsafe_levels(self):
        body={'lines':[{'text':'Hello'}],'sound_design_version':1,'soundtrack':[self.cue()]}
        self.assertEqual(validate(body)['sound_design_version'],1)
        for changes in ({'asset_id':'../../secret'},{'level_db':float('nan')},{'start_line':True},{'end_line':4},{'duck':'true'}):
            with self.subTest(changes=changes),self.assertRaises(ValueError):validate({**body,'soundtrack':[{**self.cue(),**changes}]})
        with self.assertRaises(ValueError):validate({**body,'soundtrack':[]})

    def test_shared_assembler_mixes_after_per_character_speed_and_measured_pauses(self):
        from audio_worker import assemble
        self.attach(self.tone('effect.wav',.1))
        request=validate({'lines':[{'text':'A Jinn appeared.','speed':1.5},{'text':'Then silence.','pause_before':.5}],
                          'sound_design_version':1,'soundtrack':[self.cue()]})
        clip=np.zeros(self.rate,dtype=np.float32)
        assemble([clip,clip],request,self.root/'output.wav',self.rate)
        timeline=json.loads((self.root/'output.timeline.json').read_text())
        self.assertLess(timeline[0]['end'],.72)
        self.assertAlmostEqual(timeline[1]['start']-timeline[0]['end'],.5,places=4)
        y,rate=sf.read(self.root/'output.wav')
        self.assertEqual(rate,48000)
        onset=np.flatnonzero(np.abs(y[:,0])>.005)[0]/rate
        self.assertAlmostEqual(onset,timeline[0]['end'],delta=.002)
        self.assertEqual(json.loads((self.root/'progress.json').read_text())['progress'],'Mixing music and effects')

if __name__=='__main__':unittest.main()
