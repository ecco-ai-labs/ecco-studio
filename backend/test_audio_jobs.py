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
    def test_selected_compute_never_falls_back_to_b200(self):
        body = {'lines': [{'text': 'Hello'}]}
        jobs.queue.write(jobs.queue.ROOT / 'worker-b200.json', {'updated': time.time(), 'compute': 'b200'})
        for compute in ('a100', 'cpu'):
            with self.assertRaises(Problem) as error:
                jobs.generate(dict(body, compute=compute), self.env)
            self.assertEqual(error.exception.code, 503)
        self.assertFalse(self.records)
        jobs.queue.write(jobs.queue.ROOT / 'worker-a100.json', {'updated': time.time(), 'compute': 'a100'})
        job = jobs.generate(body, self.env)
        self.assertEqual(job['compute'], 'a100')
        request = jobs.queue.read(jobs.queue.ROOT / job['id'] / 'request.json')
        self.assertEqual(request['compute'], 'a100')
    def test_stale_and_legacy_heartbeats_do_not_advertise_selected_compute(self):
        jobs.queue.write(jobs.queue.ROOT / 'worker-old.json', {'updated': time.time()})
        jobs.queue.write(jobs.queue.ROOT / 'worker-stale.json', {'updated': time.time()-60, 'compute': 'a100'})
        self.assertFalse(jobs.queue.ready('a100'))
        self.assertFalse(jobs.queue.availability()['compute']['cpu']['ready'])
    def test_commit_and_idempotent_offline_playback(self):
        jobs.queue.write(jobs.queue.ROOT / 'worker-test.json', {'updated': time.time(), 'compute': 'a100'})
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
        jobs.queue.write(jobs.queue.ROOT / 'worker-test.json', {'updated': time.time(), 'compute': 'a100'})
        job = jobs.generate({'lines': [{'text': 'Hello'}]}, self.env)
        d = jobs.queue.ROOT / job['id']
        (d / 'output.wav').write_bytes(b'broken')
        jobs.queue.write(d / 'status.json', {'status': 'complete', 'sha256': 'wrong'})
        with self.assertRaises(Problem):
            jobs.job_status(job['id'], self.env)
        self.assertFalse(self.env['records']('asset'))

if __name__ == '__main__':
    unittest.main()

