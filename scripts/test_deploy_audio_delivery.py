import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import deploy_audio_delivery as deploy


class DeploymentGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.queue = self.root / 'queue'
        self.queue.mkdir()
        self.db = self.root / 'studio.sqlite'
        with sqlite3.connect(self.db) as connection:
            connection.execute('CREATE TABLE records(kind TEXT, body TEXT)')
        self.patch = patch.multiple(deploy, QUEUE=self.queue, DATABASE=self.db,
                                    APP=self.root / 'app', AUDIO=self.root / 'audio')
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_queued_recording_blocks_even_without_database_job(self):
        job = self.queue / ('a' * 32)
        job.mkdir()
        (job / 'status.json').write_text('{"status":"queued"}')
        with self.assertRaisesRegex(RuntimeError, 'Active or unresolved jobs'):
            deploy.assert_idle()

    def test_other_active_service_job_blocks_restart(self):
        with sqlite3.connect(self.db) as connection:
            connection.execute('INSERT INTO records VALUES (?,?)',
                               ('youtube_upload_job', '{"status":"uploading"}'))
        with self.assertRaisesRegex(RuntimeError, 'Active or unresolved jobs'):
            deploy.assert_idle()

    def test_completed_jobs_are_safe_but_live_gpu_blocks_shared_source_change(self):
        with sqlite3.connect(self.db) as connection:
            connection.execute('INSERT INTO records VALUES (?,?)',
                               ('audio_job', '{"status":"done"}'))
        deploy.assert_idle()
        with patch.object(deploy, 'live_workers', return_value=[{'compute': 'a100'}]):
            with self.assertRaisesRegex(RuntimeError, 'Another audio worker'):
                deploy.assert_idle()

    def test_plan_cannot_target_unrelated_runtime_files(self):
        plan = {'source_commit': deploy.SOURCE_COMMIT,
                'files': [{'source': 'backend/storage_api.py',
                           'target': str(self.root / 'unrelated.py'), 'new': 'wrong'}]}
        (self.root / 'plan.json').write_text(json.dumps(plan))
        with patch.object(deploy.os, 'kill') as kill:
            with self.assertRaisesRegex(RuntimeError, 'allowlisted modules'):
                deploy.activate(self.root)
            kill.assert_not_called()

    def test_process_lease_includes_start_time_to_reject_pid_reuse(self):
        expected = {'pid': 100, 'start': 'original', 'cwd': '/runtime',
                    'command': ['python', 'storage_api.py'], 'parent': 1}
        with patch.object(deploy, 'process', return_value={**expected, 'start': 'replacement'}):
            with self.assertRaisesRegex(RuntimeError, 'process changed'):
                deploy.assert_same(expected)

    def test_failed_service_restart_restores_sources_and_restarts_old_service(self):
        backend = deploy.APP / 'backend'
        backend.mkdir(parents=True)
        (backend / 'storage_api.py').write_text('# existing coordinator\n')
        target = backend / 'audio_jobs.py'
        target.write_text('# original audio module\n')
        staged = self.root / 'new/backend/audio_jobs.py'
        staged.parent.mkdir(parents=True)
        staged.write_text('# updated audio module\n')
        original = target.read_bytes()
        hashes = {'backend/audio_jobs.py': deploy.digest(staged)}
        plan = {'source_commit': deploy.SOURCE_COMMIT,
                'api': {'pid': 100, 'command': ['python', 'storage_api.py'], 'cwd': str(backend)},
                'worker': {'pid': 101}, 'launcher': {'pid': 102},
                'api_source_hash': deploy.digest(backend / 'storage_api.py'),
                'files': [{'source': 'backend/audio_jobs.py', 'target': str(target),
                           'old': deploy.digest(target), 'new': deploy.digest(staged)}]}
        (self.root / 'plan.json').write_text(json.dumps(plan))
        normal_read = Path.read_bytes
        def read_bytes(path):
            return b'PATH=/usr/bin\0' if str(path) == '/proc/100/environ' else normal_read(path)
        ready = [{'compute': 'cpu', 'character_controls_version': 1, 'sound_design_version': 1, 'sound_generation_version': 1}]
        with patch.object(deploy, 'SOURCE_HASHES', hashes), \
             patch.object(deploy, 'assert_same'), patch.object(deploy, 'assert_idle'), \
             patch.object(deploy, 'live_workers', return_value=ready), \
             patch.object(deploy, 'process', side_effect=OSError), \
             patch.object(deploy.os, 'kill'), patch.object(deploy, 'terminate'), \
             patch.object(Path, 'read_bytes', read_bytes), \
             patch.object(deploy.subprocess, 'Popen', side_effect=[SimpleNamespace(pid=200), SimpleNamespace(pid=201)]) as start, \
             patch.object(deploy, 'healthy', side_effect=[False, True]):
            with self.assertRaisesRegex(RuntimeError, 'did not become healthy'):
                deploy.activate(self.root)
        self.assertEqual(target.read_bytes(), original)
        self.assertEqual(start.call_count, 2)
        self.assertFalse((self.root / 'result.json').exists())


if __name__ == '__main__':
    unittest.main()
