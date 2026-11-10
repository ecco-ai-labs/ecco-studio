import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.parse import parse_qs, urlsplit
import wave

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'audio'))
import audio_jobs as jobs
import voice_references as refs
import voice_refs as worker_refs
from audio_schema import validate


class Problem(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.message, self.code = message, code


def tone(path, seconds, rate=44100, channels=2):
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(channels)
        out.setsampwidth(2)
        out.setframerate(rate)
        frames = b''.join(struct.pack('<h', int(8000 * math.sin(i / 20))) * channels for i in range(int(rate * seconds)))
        out.writeframes(frames)


class VoiceReferenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.old_queue = jobs.queue.ROOT
        jobs.queue.ROOT = self.root / 'queue'
        refs.SECRET = 'x' * 40
        self.records = {}
        data = self.root / 'data'
        data.mkdir()

        def get(rid, kind):
            item = self.records.get(rid)
            if not item or item['kind'] != kind:
                raise Problem('Not found', 404)
            return dict(item)

        def asset_path(asset):
            return (data / asset['path']).resolve()
        self.env = dict(Problem=Problem, DATA=data, LOCK=__import__('threading').RLock(),
                        story_id=lambda body: body.get('story_id') or 'story',
                        save=lambda item: self.records.update({item['id']: dict(item)}) or item,
                        records=lambda kind: [dict(x) for x in self.records.values() if x['kind'] == kind],
                        get=get, asset_path=asset_path)
        (data / 'audio-prod').mkdir()
        tone(data / 'audio-prod/upload.wav', 12)
        self.records['a' * 32] = dict(id='a' * 32, kind='asset', media='audio', source='upload', story_id='story',
                                      path='audio-prod/upload.wav', title='Grandma tape')

    def tearDown(self):
        jobs.queue.ROOT = self.old_queue
        self.tmp.cleanup()

    def make(self, **extra):
        body = {**dict(asset_id='a' * 32, character='Grandma', character_id='c1', emotion='warm', language='Telugu',
                       transcript='Once upon a time', start=1, end=9, clean=True, consent=True), **extra}
        return refs.create(body, self.env)

    def test_upload_becomes_trimmed_clean_mono_reference(self):
        ref = self.make()
        self.assertEqual((ref['character'], ref['emotion'], ref['source'], ref['cleaned']), ('Grandma', 'warm', 'upload', True))
        asset = self.records[ref['id']]
        with wave.open(str(self.env['DATA'] / asset['path'])) as clip:
            self.assertEqual((clip.getnchannels(), clip.getframerate()), (1, 24000))
            self.assertAlmostEqual(clip.getnframes() / clip.getframerate(), 8, delta=0.2)
        self.assertEqual(asset['sha256'], hashlib.sha256((self.env['DATA'] / asset['path']).read_bytes()).hexdigest())

    def test_upload_needs_consent_and_a_3_to_30_second_range(self):
        with self.assertRaises(Problem) as error:
            refs.create(dict(asset_id='a' * 32, character='Grandma', start=0, end=5), self.env)
        self.assertIn('permission', error.exception.message)
        with self.assertRaises(Problem) as error:
            refs.create(dict(asset_id='a' * 32, character='Grandma', start=0, end=2, consent=True), self.env)
        self.assertIn('3–30 seconds', error.exception.message)
        with self.assertRaises(Problem):
            refs.create(dict(asset_id='a' * 32, character='Grandma', start=5, end=40, consent=True), self.env)

    def test_list_and_update(self):
        ref = self.make()
        self.make(emotion='laughing')
        listed = refs.list_references({'character_id': 'c1'}, self.env)['references']
        self.assertEqual([r['emotion'] for r in listed], ['warm', 'laughing'])
        updated = refs.update({'asset_id': ref['id'], 'transcript': 'A new line', 'emotion': 'tender'}, self.env)
        self.assertEqual((updated['transcript'], updated['emotion']), ('A new line', 'tender'))

    def test_palette_picks_the_clip_for_each_delivery(self):
        palette = {'default': 'b' * 32, 'whispering': 'c' * 32, 'laughing': 'd' * 32}
        request = validate({'model': 'chatterbox', 'lines': [
            {'text': 'Quiet now', 'language': 'English', 'palette': palette, 'delivery': 'whisper'},
            {'text': 'Ha!', 'language': 'English', 'palette': palette, 'delivery': 'happy'},
            {'text': 'Hello', 'language': 'English', 'palette': palette}]})
        self.assertEqual([l['voice'] for l in request['lines']], ['ref:' + 'c' * 32, 'ref:' + 'd' * 32, 'ref:' + 'b' * 32])
        self.assertEqual(request['voice_refs_version'], 1)
        with self.assertRaises(ValueError):
            validate({'model': 'indic-mio', 'lines': [{'text': 'x', 'voice': 'ref:' + 'b' * 32}]})

    def test_job_payload_is_self_contained_with_signed_links(self):
        ref = self.make()
        jobs.queue.write(jobs.queue.ROOT / 'worker-gpu.json', dict(updated=time.time(), compute='b200', models=['indicf5'], voice_refs_version=1))
        job = jobs.generate({'model': 'indicf5', 'compute': 'b200', 'lines': [{'text': 'కథ', 'language': 'Telugu', 'voice': 'ref:' + ref['id']}]}, self.env)
        payload = jobs.queue.read(jobs.queue.ROOT / job['id'] / 'request.json')
        item = payload['voice_refs'][ref['id']]
        self.assertEqual((item['transcript'], item['sha256']), ('Once upon a time', ref['sha256']))
        self.assertEqual(validate(payload)['voice_refs'][ref['id']]['sha256'], ref['sha256'])  # a worker re-validates unchanged
        query = parse_qs(urlsplit(item['path']).query)
        self.assertEqual(refs.verify_link(ref['id'], query, self.env).name, Path(self.records[ref['id']]['path']).name)
        with self.assertRaises(Problem):
            refs.verify_link(ref['id'], {**query, 'sig': ['0' * 64]}, self.env)
        with self.assertRaises(Problem):
            refs.verify_link(ref['id'], {'expires': [str(int(time.time()) - 1)], 'sig': query['sig']}, self.env)
        self.assertTrue((jobs.queue.ROOT / job['id'] / ('voice-ref-' + ref['id'] + '.wav')).is_file())  # pod path still works

    def test_indicf5_needs_a_transcript_and_old_workers_are_refused(self):
        ref = self.make(transcript='')
        jobs.queue.write(jobs.queue.ROOT / 'worker-gpu.json', dict(updated=time.time(), compute='b200', models=['indicf5'], voice_refs_version=1))
        with self.assertRaises(Problem) as error:
            jobs.generate({'model': 'indicf5', 'compute': 'b200', 'lines': [{'text': 'x', 'language': 'Telugu', 'voice': 'ref:' + ref['id']}]}, self.env)
        self.assertIn('Type what', error.exception.message)
        jobs.queue.write(jobs.queue.ROOT / 'worker-gpu.json', dict(updated=time.time(), compute='b200', models=['chatterbox']))
        with self.assertRaises(Problem) as error:
            jobs.generate({'model': 'chatterbox', 'compute': 'b200', 'lines': [{'text': 'x', 'language': 'English', 'voice': 'ref:' + ref['id']}]}, self.env)
        self.assertEqual(error.exception.code, 503)

    def test_worker_fetches_by_hash_without_local_state(self):
        ref = self.make()
        data = (self.env['DATA'] / self.records[ref['id']]['path']).read_bytes()
        request = {'voice_refs': {ref['id']: {'sha256': ref['sha256'], 'url': 'https://storage.example/api/voice-refs/' + ref['id'], 'transcript': 't'}}}
        calls = []

        class Response:
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self, n): return self.body
        import os
        os.environ['ECCO_VOICE_CACHE'] = str(self.root / 'cache')
        try:
            path, item = worker_refs.fetch(request, 'ref:' + ref['id'], self.root / 'job/output.wav', opener=lambda url, timeout: calls.append(url) or Response(data))
            self.assertEqual(path.read_bytes(), data)
            worker_refs.fetch(request, 'ref:' + ref['id'], self.root / 'job/output.wav', opener=lambda *a, **k: self.fail('cached clip must not download again'))
            self.assertEqual(len(calls), 1)
            with self.assertRaises(RuntimeError):
                worker_refs.fetch({'voice_refs': {'e' * 32: {'sha256': '0' * 64, 'url': 'https://x/y'}}}, 'ref:' + 'e' * 32, self.root / 'job/output.wav',
                                  opener=lambda *a, **k: Response(b'tampered'))
        finally:
            os.environ.pop('ECCO_VOICE_CACHE', None)

    def test_designed_voice_job_saves_a_reference_when_done(self):
        request = refs.design_request({'model': 'indic-parler', 'compute': 'b200', 'character': 'Grandma', 'emotion': 'tender',
                                       'language': 'Telugu', 'text': 'అనగనగా ఒక ఊరు', 'description': 'An old woman, warm and slow, smiling'}, self.env)
        clean = validate(request)
        self.assertTrue(clean['lines'][0]['design'])
        self.assertEqual(clean['voice_design']['emotion'], 'tender')
        with self.assertRaises(Problem) as error:
            refs.design_request({'model': 'kokoro', 'character': 'x', 'text': 'y', 'description': 'z'}, self.env)
        self.assertIn('VoxCPM2', error.exception.message)
        generated = dict(id='f' * 32, kind='asset', media='audio', source='generated', story_id='story', path='audio-prod/upload.wav', seconds=12)
        self.records[generated['id']] = generated
        ref = refs.from_design({'request': clean, 'story_id': 'story'}, generated, self.env)
        self.assertEqual((ref['voice_reference']['source'], ref['voice_reference']['transcript']), ('designed', 'అనగనగా ఒక ఊరు'))


if __name__ == '__main__':
    unittest.main()
