import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import wave

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('recover_audio_mix.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


def wav(path, channels=1, rate=24000, frames=None):
    with wave.open(str(path), 'wb') as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(b'\0\0' * channels * (rate if frames is None else frames))


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.job_id = 'a' * 32
        self.directory = self.root / 'queue' / self.job_id
        self.directory.mkdir(parents=True)
        self.request = dict(compute='cpu', worker_id='cpu-test', lines=[{'text': 'Complete ending'}], soundtrack=[{'kind': 'music'}])
        self.status = dict(status='error', error='Soundtrack mixing failed. Check the sound files and audio worker log.')
        for name, data in [('request.json', self.request), ('status.json', self.status), ('output.timeline.json', [{'start': 0, 'end': 1}]), ('sound-assets.json', {})]:
            (self.directory / name).write_text(json.dumps(data))
        wav(self.directory / 'output.wav')
        self.original_hash = recovery.digest(self.directory / 'output.wav')
        self.database = self.root / 'studio.sqlite'
        self.job = dict(id=self.job_id, status='error', request=self.request)
        with sqlite3.connect(self.database) as db:
            db.execute('CREATE TABLE records (id TEXT PRIMARY KEY, kind TEXT, body TEXT)')
            db.execute('INSERT INTO records VALUES (?,?,?)', (self.job_id, 'audio_job', json.dumps(self.job)))

    def tearDown(self):
        self.tmp.cleanup()

    def run_recovery(self, mixer):
        return recovery.recover(self.root, self.database, self.job_id, 'cpu-test', mixer)

    def assert_original(self):
        self.assertEqual(recovery.digest(self.directory / 'output.wav'), self.original_hash)
        self.assertEqual(json.loads((self.directory / 'status.json').read_text()), self.status)
        with sqlite3.connect(self.database) as db:
            self.assertEqual(json.loads(db.execute('SELECT body FROM records').fetchone()[0]), self.job)

    def test_promotes_real_valid_mix_and_retains_failed_job_audit(self):
        result = self.run_recovery(lambda request, speech, timeline, output: wav(output, 2, 48000))
        audit = Path(result['audit_directory'])
        self.assertEqual(recovery.digest(audit / 'output.wav'), self.original_hash)
        self.assertEqual(json.loads((audit / 'status.json').read_text()), self.status)
        self.assertEqual(json.loads((self.directory / 'status.json').read_text())['status'], 'complete')
        with sqlite3.connect(self.database) as db:
            self.assertEqual(json.loads(db.execute('SELECT body FROM records').fetchone()[0])['status'], 'running')

    def test_mixer_failure_does_not_promote_or_reopen(self):
        def fail(*args):
            raise RuntimeError('Actual mixing failed')
        with self.assertRaisesRegex(RuntimeError, 'Actual mixing failed'):
            self.run_recovery(fail)
        self.assert_original()

    def test_truncated_mix_does_not_promote(self):
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            self.run_recovery(lambda request, speech, timeline, output: wav(output, 2, 48000, 24000))
        self.assert_original()

    def test_wrong_worker_is_rejected_before_mixing(self):
        with self.assertRaisesRegex(ValueError, 'explicitly selected CPU'):
            recovery.recover(self.root, self.database, self.job_id, 'another-cpu', lambda *args: self.fail('Should not mix'))
        self.assert_original()

    def test_changed_saved_request_is_rejected(self):
        self.job['request'] = {**self.request, 'title': 'Changed'}
        with sqlite3.connect(self.database) as db:
            db.execute('UPDATE records SET body=?', (json.dumps(self.job),))
        with self.assertRaisesRegex(ValueError, 'no longer matches'):
            self.run_recovery(lambda *args: self.fail('Should not mix'))
        self.assert_original()


if __name__ == '__main__':
    unittest.main()
