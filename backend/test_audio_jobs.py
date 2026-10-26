import hashlib
from pathlib import Path
import sys
import tempfile
import time
import unittest
import wave
sys.path.insert(0, str(Path(__file__).parent))
import audio_jobs as jobs

class Problem(Exception):
    def __init__(self, message, code=400):
        self.message, self.code = message, code

class AudioJobsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = jobs.queue.ROOT
        jobs.queue.ROOT = Path(self.tmp.name) / 'queue'
        self.records = {}
        self.env = dict(Problem=Problem, DATA=Path(self.tmp.name) / 'data',
            story_id=lambda body: 'story', save=lambda item: self.records.update({item['id']: dict(item)}) or item,
            records=lambda kind: [dict(x) for x in self.records.values() if x['kind'] == kind],
            get=lambda jid, kind: dict(self.records[jid]))
    def tearDown(self):
        jobs.queue.ROOT = self.old
        self.tmp.cleanup()
    def test_requires_live_worker(self):
        with self.assertRaises(Problem) as error:
            jobs.generate({'lines': [{'text': 'Hello'}]}, self.env)
        self.assertEqual(error.exception.code, 503)
    def test_exact_cpu_instance_is_preserved_and_unavailable_never_falls_back(self):
        for pod in ('small', 'large'):
            jobs.queue.write(jobs.queue.ROOT / ('worker-' + pod + '.json'), dict(updated=time.time(), compute='cpu', pod=pod, instance_routing_version=1, models=['chatterbox']))
        body = dict(compute='cpu', worker_id='large', model='chatterbox', lines=[{'text': 'Hello', 'voice': 'default'}])
        job = jobs.generate(body, self.env)
        self.assertEqual(jobs.queue.read(jobs.queue.ROOT / job['id'] / 'request.json')['worker_id'], 'large')
        (jobs.queue.ROOT / 'worker-large.json').unlink()
        with self.assertRaises(Problem) as error: jobs.generate(body, self.env)
        self.assertEqual(error.exception.code, 503)
    def test_character_controls_wait_for_a_capable_worker(self):
        heartbeat = {'updated': time.time(), 'compute': 'cpu', 'models': ['indic-mio']}
        jobs.queue.write(jobs.queue.ROOT / 'worker-cpu.json', heartbeat)
        body = {'lines': [{'text': 'First voice', 'pitch': -2}, {'text': 'Second voice', 'pitch': 2}]}
        with self.assertRaises(Problem) as error:
            jobs.generate(body, self.env)
        self.assertEqual(error.exception.code, 503)
        self.assertFalse(self.records)
        heartbeat['character_controls_version'] = 1
        jobs.queue.write(jobs.queue.ROOT / 'worker-cpu.json', heartbeat)
        job = jobs.generate(body, self.env)
        queued = jobs.queue.read(jobs.queue.ROOT / job['id'] / 'request.json')
        self.assertEqual([line['pitch'] for line in queued['lines']], [-2, 2])
    def test_cpu_requires_a_live_worker_and_verified_model(self):
        jobs.queue.write(jobs.queue.ROOT / 'worker-cpu.json', {'updated': time.time(), 'compute': 'cpu', 'models': ['indic-mio']})
        status = jobs.queue.availability()
        self.assertTrue(status['compute']['cpu']['ready'])
        self.assertEqual(status['compute']['cpu']['models'], ['indic-mio'])
        self.assertTrue(jobs.queue.ready('cpu', 'indic-mio'))
        self.assertFalse(jobs.queue.ready('cpu', 'chatterbox'))
        with self.assertRaises(Problem):
            jobs.generate({'compute': 'cpu', 'model': 'chatterbox', 'lines': [{'text': 'Hello'}]}, self.env)
        self.assertFalse(self.records)
        job = jobs.generate({'lines': [{'text': 'Hello'}]}, self.env)
        self.assertEqual(job['compute'], 'cpu')
        jobs.queue.write(jobs.queue.ROOT / 'worker-cpu.json', {'updated': time.time()-60, 'compute': 'cpu', 'models': ['indic-mio']})
        self.assertFalse(jobs.queue.ready('cpu'))
    def test_soundtrack_requires_capability_and_snapshots_library_audio(self):
        heartbeat = {'updated': time.time(), 'compute':'cpu', 'models':['indic-mio']}
        jobs.queue.write(jobs.queue.ROOT/'worker-cpu.json', heartbeat)
        cue = dict(kind='effect',asset_id='sound',start_line=0,end_line=0,start_edge='end')
        body = {'lines':[{'text':'A Jinn appeared.'}], 'soundtrack':[cue], 'sound_design_version':1}
        with self.assertRaises(Problem) as error:jobs.generate(body,self.env)
        self.assertEqual(error.exception.code,503)
        self.assertFalse(self.records)
        self.env['DATA'].mkdir();sound=self.env['DATA']/'effect.wav'
        with wave.open(str(sound),'wb') as f:
            f.setparams((1,2,24000,0,'NONE','not compressed'));f.writeframes(b'\0\0'*240)
        self.records['sound']={'id':'sound','kind':'asset','media':'audio','path':'effect.wav'}
        heartbeat['sound_design_version']=1;jobs.queue.write(jobs.queue.ROOT/'worker-cpu.json',heartbeat)
        job=jobs.generate(body,self.env);directory=jobs.queue.ROOT/job['id']
        self.assertTrue((directory/'sound-0.wav').is_file())
        self.assertEqual(jobs.queue.read(directory/'request.json')['soundtrack'][0]['asset_id'],'sound')
    def test_selected_compute_never_falls_back_to_b200(self):
        body = {'lines': [{'text': 'Hello'}]}
        jobs.queue.write(jobs.queue.ROOT / 'worker-b200.json', {'updated': time.time(), 'compute': 'b200'})
        for compute in ('a100', 'cpu'):
            with self.assertRaises(Problem) as error:
                jobs.generate(dict(body, compute=compute), self.env)
            self.assertEqual(error.exception.code, 503)
        self.assertFalse(self.records)
        jobs.queue.write(jobs.queue.ROOT / 'worker-a100.json', {'updated': time.time(), 'compute': 'a100'})
        job = jobs.generate(dict(body, compute='a100'), self.env)
        self.assertEqual(job['compute'], 'a100')
        request = jobs.queue.read(jobs.queue.ROOT / job['id'] / 'request.json')
        self.assertEqual(request['compute'], 'a100')
    def test_stale_and_legacy_heartbeats_do_not_advertise_selected_compute(self):
        jobs.queue.write(jobs.queue.ROOT / 'worker-old.json', {'updated': time.time()})
        jobs.queue.write(jobs.queue.ROOT / 'worker-stale.json', {'updated': time.time()-60, 'compute': 'a100'})
        self.assertFalse(jobs.queue.ready('a100'))
        self.assertFalse(jobs.queue.availability()['compute']['cpu']['ready'])
    def test_commit_and_idempotent_offline_playback(self):
        jobs.queue.write(jobs.queue.ROOT / 'worker-test.json', {'updated': time.time(), 'compute': 'cpu', 'models': ['indic-mio']})
        job = jobs.generate({'lines': [{'text': 'Hello'}]}, self.env)
        self.assertNotIn('request', job)
        directory = jobs.queue.ROOT / job['id']
        output = directory / 'output.wav'
        with wave.open(str(output), 'wb') as f:
            f.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
            f.writeframes(b'\0\0' * 24000)
        jobs.queue.write(directory / 'status.json', {'status': 'complete', 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()})
        result = jobs.job_status(job['id'], self.env)
        self.assertEqual(result['status'], 'done')
        (jobs.queue.ROOT / 'worker-test.json').unlink()
        output.unlink()
        self.assertEqual(jobs.job_status(job['id'], self.env), result)
        assets = self.env['records']('asset')
        self.assertEqual(len(assets), 1)
        self.assertTrue((self.env['DATA'] / assets[0]['path']).is_file())
        self.assertEqual(assets[0]['duration'], 1)
    def test_checksum_mismatch_never_marks_done(self):
        jobs.queue.write(jobs.queue.ROOT / 'worker-test.json', {'updated': time.time(), 'compute': 'cpu', 'models': ['indic-mio']})
        job = jobs.generate({'lines': [{'text': 'Hello'}]}, self.env)
        d = jobs.queue.ROOT / job['id']
        (d / 'output.wav').write_bytes(b'broken')
        jobs.queue.write(d / 'status.json', {'status': 'complete', 'sha256': 'wrong'})
        with self.assertRaises(Problem):
            jobs.job_status(job['id'], self.env)
        self.assertFalse(self.env['records']('asset'))

if __name__ == '__main__':
    unittest.main()



class SoundJobsTest(AudioJobsTest):
    def test_generated_sound_uses_verified_model_and_commits_library_asset(self):
        heartbeat = dict(updated=time.time(), compute='cpu', models=['indic-mio'], sound_models=['moss-soundeffect-v2'], sound_generation_version=1)
        jobs.queue.write(jobs.queue.ROOT / 'worker-cpu.json', heartbeat)
        request = dict(kind='effect', description='A gentle magical whoosh', title='Jinn Arrival', duration=2, compute='cpu', seed=42)
        job = jobs.generate(request, self.env, sound=True)
        queued = jobs.queue.read(jobs.queue.ROOT / job['id'] / 'request.json')
        self.assertEqual(queued['task'], 'sound'); self.assertNotIn('lines', queued)
        directory = jobs.queue.ROOT / job['id']; source = directory / 'output.wav'
        with wave.open(str(source), 'wb') as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(24000); output.writeframes(b'\x10\x00' * 48000)
        jobs.queue.write(directory / 'status.json', dict(status='complete', compute='cpu', sha256=hashlib.sha256(source.read_bytes()).hexdigest(), provenance={'model_revision':'verified-pin'}))
        result = jobs.job_status(job['id'], self.env)
        self.assertEqual(result['status'], 'done'); self.assertEqual(result['asset']['title'], 'Jinn Arrival')
        self.assertEqual(result['asset']['prompt'], request['description']); self.assertEqual(result['asset']['settings']['seed'], 42)
        self.assertTrue((self.env['DATA'] / result['asset']['path']).is_file())
        self.assertEqual(jobs.job_status(job['id'], self.env)['asset_id'], result['asset_id'])

    def test_missing_sound_runtime_and_old_worker_fail_without_enqueue_or_fallback(self):
        jobs.queue.write(jobs.queue.ROOT / 'worker-gpu.json', dict(updated=time.time(),compute='a100',models=['indic-mio'],sound_generation_version=1,sound_models=['moss-soundeffect-v2']))
        with self.assertRaises(Problem): jobs.generate(dict(kind='effect',description='Wind',compute='cpu'), self.env, sound=True)
        jobs.queue.write(jobs.queue.ROOT / 'worker-old.json', dict(updated=time.time(),compute='a100',models=['indic-mio']))
        with self.assertRaises(Problem): jobs.generate(dict(kind='effect',description='Wind',compute='a100'), self.env, sound=True)
        self.assertFalse(self.records)

    def test_sound_limits_and_instrumental_music(self):
        from sound_schema import validate
        for body in [dict(kind='effect',description=''),dict(kind='music',description='Quiet',duration=2),dict(kind='effect',description='Wind',duration=float('nan')),dict(kind='effect',description='Wind',model='ace-step-1.5')]:
            with self.assertRaises(ValueError): validate(body)
        self.assertTrue(validate(dict(kind='music',description='Quiet oud',duration=10))['instrumental'])

class SoundStepProgressTest(unittest.TestCase):
    def test_only_valid_moss_sampler_counts_are_exposed(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp);request={'task':'sound','model':'moss-soundeffect-v2'}
            self.assertIsNone(jobs.sound_step_progress(directory,request))
            log=directory/'worker.log'
            log.write_text('Loading model\n')
            self.assertIsNone(jobs.sound_step_progress(directory,request))
            log.write_text(' 26%|xx | 26/100 [03:08<08:42, 7.06s/it]\r 32%|xxx | 32/100 [03:51<06:26, 5.68s/it]\r')
            self.assertEqual(jobs.sound_step_progress(directory,request)['completed'],32)
            self.assertIsNone(jobs.sound_step_progress(directory,{'task':'sound','model':'ace-step-1.5'}))
            log.write_text('101%|xxxxx| 101/100 [bad]\r')
            self.assertIsNone(jobs.sound_step_progress(directory,request))
            log.write_text('100%|xxxxx| 100/100 [10:36<00:00, 6.37s/it]\r')
            self.assertEqual(jobs.sound_step_progress(directory,request)['completed'],100)
