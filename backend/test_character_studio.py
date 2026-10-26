import copy
import json
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest
from unittest.mock import patch
import uuid

import character_studio as cs
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "migration/legacy"))
import studio
from characters import transport as queue
from characters.glb import inspect


def uid(): return uuid.uuid4().hex


class CharacterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.patch = patch.multiple(studio, DATA=self.root)
        self.patch.start()
        self.queue_patch = patch.object(queue, 'ROOT', self.root / 'queue')
        self.queue_patch.start()
        self.started = patch.object(cs, 'STARTED', True)
        self.started.start()
        with sqlite3.connect(self.root / 'studio.sqlite') as db:
            db.execute('CREATE TABLE records(id TEXT PRIMARY KEY, kind TEXT, body TEXT)')
        self.env = vars(studio)
        self.sid = uid()
        studio.save(dict(id=self.sid, kind='story', created=1, title='Munnu'))
        self.c = cs.save({'request_id': uid(), 'story_id': self.sid, 'name': 'Munnu', 'description': 'A stocky realistic character'}, self.env)
        self.gpu = cs.gpu_relay.GPUS[0]

    def tearDown(self):
        self.started.stop(); self.queue_patch.stop(); self.patch.stop(); self.tmp.cleanup()

    def body(self, **kw):
        return {'character_id':self.c['id'], 'revision':self.c['revision'], **kw}

    def asset(self, **kw):
        aid = uid()
        path = self.root / (aid + '.png')
        path.write_bytes(b'fixture')
        return studio.save(dict(id=aid, kind='asset', created=1, path=path.name, media='image', story_id=self.sid, **kw))

    def prepare_sheet(self):
        self.c['approved_image_id'] = self.asset()['id']
        self.c['views'] = {v: self.asset()['id'] for v in cs.VIEWS}
        self.c['approved_views'] = dict(self.c['views'])
        studio.save(self.c)

    def ready(self):
        return patch.object(cs, '_worker')

    def test_create_is_idempotent_and_rejects_reused_id(self):
        data = {'request_id': uid(), 'story_id': self.sid, 'name': 'Munnu', 'description': 'Stocky man'}
        self.assertEqual(cs.save(data, self.env)['id'], cs.save(data, self.env)['id'])
        with self.assertRaises(studio.Problem): cs.save({**data, 'name': 'Someone else'}, self.env)

    def test_stale_revision_and_wrong_story_are_rejected(self):
        with self.assertRaises(studio.Problem): cs.approve(self.body(stage='appearance', revision=0), self.env)
        image = self.asset()
        image['story_id'] = uid();studio.save(image)
        with self.assertRaises(studio.Problem): cs.approve(self.body(stage='appearance', asset_id=image['id']), self.env)

    def test_appearance_requires_explicit_approval_and_cannot_be_overwritten(self):
        aid = self.asset()['id']
        self.c = cs.approve(self.body(stage='appearance', asset_id=aid), self.env)
        self.assertEqual(self.c['approved_image_id'], aid)
        with self.assertRaises(studio.Problem): cs.approve(self.body(stage='appearance', asset_id=self.asset()['id']), self.env)

    def test_model_requires_complete_approved_sheet_and_exact_worker(self):
        request = self.body(stage='model', gpu=self.gpu, request_id=uid())
        with self.ready(), self.assertRaises(studio.Problem): cs.generate(request, self.env)
        self.prepare_sheet()
        with patch.object(queue, 'health', return_value=[]), self.assertRaises(studio.Problem): cs.generate(request, self.env)

    def test_generation_idempotency_and_same_character_serialization(self):
        self.prepare_sheet()
        request = self.body(stage='model', gpu=self.gpu, request_id=uid())
        with self.ready():
            first = cs.generate(request, self.env)
            self.assertEqual(first, cs.generate(request, self.env))
            with self.assertRaises(studio.Problem): cs.generate({**request, 'quality': 'preview'}, self.env)
            with self.assertRaises(studio.Problem): cs.generate({**request, 'request_id': uid()}, self.env)
        with self.assertRaises(studio.Problem): cs.save(self.body(name='Edited', description=self.c['description']), self.env)

    def test_model_task_resumes_same_queue_after_coordinator_restart(self):
        self.prepare_sheet()
        with self.ready(): job = cs.generate(self.body(stage='model', gpu=self.gpu, request_id=uid()), self.env)
        cs.tick(self.env)
        task = queue.directory(self.gpu, job['id']) / 'request.json'
        first = task.read_text()
        cs.tick(self.env)
        self.assertEqual(first, task.read_text())
        self.assertEqual(len(list(queue.ROOT.glob('*/*/request.json'))), 1)

    def test_stop_before_dispatch_never_runs_worker(self):
        self.prepare_sheet()
        with self.ready(): job = cs.generate(self.body(stage='model', gpu=self.gpu, request_id=uid()), self.env)
        cs.cancel(job['id'], self.env)
        cs.tick(self.env)
        self.assertEqual(studio.get(job['id'])['status'], 'cancelled')
        self.assertFalse((queue.directory(self.gpu, job['id']) / 'request.json').exists())

    def test_stop_queued_task_completes_without_an_online_worker(self):
        self.prepare_sheet()
        with self.ready(): job = cs.generate(self.body(stage='model', gpu=self.gpu, request_id=uid()), self.env)
        cs.tick(self.env)
        cs.cancel(job['id'], self.env)
        cs.tick(self.env)
        self.assertEqual(studio.get(job['id'])['status'], 'cancelled')
        self.assertFalse((queue.directory(self.gpu, job['id']) / 'request.json').exists())

    def test_saved_character_asset_is_protected_from_purge(self):
        aid = self.asset()['id']
        self.c = cs.approve(self.body(stage='appearance', asset_id=aid), self.env)
        with self.assertRaises(studio.Problem): cs.protect_purge({'asset_id': aid}, self.env)

    def test_failed_model_preserves_existing_approved_asset(self):
        self.prepare_sheet()
        self.c['approved_model_id'] = uid();studio.save(self.c)
        with self.ready(): job = cs.generate(self.body(stage='model', gpu=self.gpu, request_id=uid()), self.env)
        queue.write(queue.directory(self.gpu, job['id']) / 'result.json', {'status': 'failed', 'error': 'Inference failed'})
        cs.tick(self.env)
        self.assertEqual(studio.get(self.c['id'])['approved_model_id'], self.c['approved_model_id'])
        self.assertEqual(studio.get(job['id'])['status'], 'failed')

    def test_body_rig_cannot_promise_fear_expression(self):
        self.c.update(approved_rig_id=self.asset()['id'], rig_report={'actions': ['run'], 'expressions': ['neutral']})
        studio.save(self.c)
        request = self.body(stage='performance', gpu=self.gpu, request_id=uid(), action='run', expression='fear')
        with self.ready(), self.assertRaisesRegex(studio.Problem, ''):
            cs.generate(request, self.env)
        self.assertEqual(studio.records('character_job'), [])

    def test_worker_output_cannot_escape_task_directory(self):
        self.prepare_sheet()
        with self.ready(): job = cs.generate(self.body(stage='model', gpu=self.gpu, request_id=uid()), self.env)
        response = {'status': 'done', 'files': [{'name': '../../studio.sqlite', 'role': 'model'}]}
        queue.write(queue.directory(self.gpu, job['id']) / 'result.json', response)
        cs.tick(self.env)
        self.assertEqual(studio.get(job['id'])['status'], 'failed')

    def test_image_submission_is_reconciled_without_duplicate_generation(self):
        health = {'gpus': [{'id': self.gpu, 'ready': True, 'config': {'models_ready': {'sdxl': True}}}]}
        upstream = studio.save(dict(id=uid(), kind='job', created=1, status='running'))
        with patch.object(cs.gpu_relay, 'status', return_value=health):
            job = cs.generate(self.body(stage='appearance', gpu=self.gpu, request_id=uid()), self.env)
        with patch.object(cs.gpu_relay, 'submit') as submit, patch.object(cs.gpu_relay, 'result', return_value={'status': 'done', 'result': upstream}):
            cs.tick(self.env)
            cs.tick(self.env)
            self.assertEqual(submit.call_count, 1)
            self.assertEqual(studio.get(job['id'])['upstream_job_id'], upstream['id'])
            aid = self.asset()['id'];upstream.update(status='done', result=aid);studio.save(upstream)
            cs.tick(self.env)
            self.assertIn(aid, studio.get(self.c['id'])['image_ids'])
            self.assertNotIn('approved_image_id', studio.get(self.c['id']))
            self.assertEqual(studio.get(job['id'])['status'], 'done')

    def test_sheet_stop_waits_for_child_and_preserves_completed_view(self):
        self.c['approved_image_id'] = self.asset()['id'];studio.save(self.c)
        health = {'gpus': [{'id': self.gpu, 'ready': True, 'config': {'models_ready': {'qwen-image-edit-2511': True}}}]}
        upstream = studio.save(dict(id=uid(), kind='job', created=1, status='done', result=self.asset()['id']))
        with patch.object(cs.gpu_relay, 'status', return_value=health):
            job = cs.generate(self.body(stage='sheet', gpu=self.gpu, request_id=uid()), self.env)
        with patch.object(cs.gpu_relay, 'submit'), patch.object(cs.gpu_relay, 'result', return_value={'status': 'done', 'result': upstream}):
            cs.tick(self.env)
            cs.cancel(job['id'], self.env)
            cs.tick(self.env)
        self.assertEqual(studio.get(job['id'])['status'], 'cancelled')
        self.assertEqual(studio.get(self.c['id'])['views']['front'], upstream['result'])

    def test_request_id_cannot_replace_an_asset_record(self):
        self.prepare_sheet();a=self.asset()
        with self.ready(), self.assertRaises(studio.Problem):
            cs.generate(self.body(stage='model', gpu=self.gpu, request_id=a['id']), self.env)
        self.assertEqual(studio.get(a['id'])['kind'], 'asset')

    def test_glb_rejects_external_resources_and_length_mismatch(self):
        path = self.root / 'bad.glb'
        doc = {'asset': {'version': '2.0'}, 'meshes': [{'primitives': []}], 'images': [{'uri': 'file:///private/key'}]}
        payload = json.dumps(doc).encode();payload += b' ' * (-len(payload) % 4)
        path.write_bytes(struct.pack('<4sIIII', b'glTF', 2, len(payload)+20, len(payload), 0x4e4f534a)+payload)
        with self.assertRaisesRegex(ValueError, 'external'): inspect(path)
        path.write_bytes(path.read_bytes()+b'bad')
        with self.assertRaisesRegex(ValueError, 'container'): inspect(path)


if __name__ == '__main__': unittest.main()
