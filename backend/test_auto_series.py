"""Automatic episodes with AI, jobs, FFmpeg and listen-back mocked. Nothing here runs a model."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'audio'))
import audio_jobs
import audio_workflows as workflows
import auto_series as auto
import openai_assistant
import voice_references

REAL_MEASURE = auto.measure


class Problem(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.message, self.code = message, code


CAST = [{'id': 'narrator', 'name': 'Scheherazade', 'role': 'narrator', 'gender': 'female', 'age_group': 'adult',
         'personality': 'Calm storyteller', 'voice_description': 'Warm low female voice, unhurried, adult woman',
         'sample': 'Listen, my king, to the tale of a merchant who travelled far across the burning sands.', 'feelings': ['neutral', 'whisper']},
        {'id': 'king', 'name': 'King Shahryar', 'role': 'character', 'gender': 'male', 'age_group': 'adult',
         'personality': 'Stern listener', 'voice_description': 'Deep stern male voice, slow, middle-aged man',
         'sample': 'Go on then, finish your story before the sun rises over the palace walls tonight.', 'feelings': ['angry']}]
JINNI = {'id': 'jinni', 'name': 'The Jinni', 'role': 'character', 'gender': 'male', 'age_group': 'older adult',
         'personality': 'Huge and ancient', 'voice_description': 'Huge echoing male voice, very slow, ancient',
         'sample': 'I have waited a thousand years in this bottle and now you will pay for my waiting.', 'feelings': ['angry'], 'unusual': True}


class Harness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.rows = {}
        self.calls = []
        self.cast = copy.deepcopy(CAST)
        self.changes = []
        self.busy = False
        self.env = dict(DATA=self.data, LOCK=threading.RLock(), Problem=Problem, records=self.records, save=self.save,
                        get=self.get, story_id=lambda b: b.get('story_id'), asset_path=lambda a: self.data / a['path'])
        self.rows['story1'] = {'id': 'story1', 'kind': 'story', 'title': 'Arabian Nights'}
        queue = self.data / 'queue'
        queue.mkdir()
        self.patches = [patch.object(openai_assistant, 'enhance', self.ai),
                        patch.object(openai_assistant, 'status', lambda: {'enabled': True}),
                        patch.object(audio_jobs, 'generate', self.generate),
                        patch.object(audio_jobs.queue, 'ROOT', queue),
                        patch.object(audio_jobs.queue, 'availability', lambda: {'compute': {'b200': {'ready': True, 'models': ['voxcpm2'], 'sound_models': ['moss-soundeffect-v2', 'ace-step-1.5']}}}),
                        patch.object(auto, 'measure', lambda path, pause: {'lufs': -18.0, 'silences': [], 'threshold': 4.0}),
                        patch.object(auto, 'listen_workers', lambda: [{'compute': 'b200', 'listen_version': 1}])]
        for p in self.patches:
            p.start()
        voice_references.SECRET = 'k' * 40

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    # --- in-memory workspace
    def records(self, kind=None):
        return [copy.deepcopy(r) for r in self.rows.values() if kind is None or r['kind'] == kind]

    def save(self, record):
        self.rows[record['id']] = copy.deepcopy(record)
        return copy.deepcopy(record)

    def get(self, rid, kind=None):
        if rid not in self.rows:
            raise Problem('Not found', 404)
        return copy.deepcopy(self.rows[rid])

    # --- mocks
    def ai(self, body, env):
        field = body['fields'][0]['id']
        self.calls.append((field, body))
        if self.busy:
            raise openai_assistant.AssistantError('busy', 429)
        if field == 'auto_cast':
            value = {'characters': self.cast}
        elif field == 'audio_plan':
            ids = [c['id'] for c in body['context']['lines']]
            value = {'opening': None, 'segments': [{'character_id': ids[i % len(ids)], 'title': '', 'text': f'Line {i} spoken by {ids[i % len(ids)]}.'} for i in range(len(ids) * 2)]}
        elif field == 'audio_directed_script':
            draft = json.loads(body['context']['summary'])['draft']
            value = {'opening': None, 'expressiveness': None, 'segments': [
                {**s, 'performance': {'emotion': 'whisper' if i == 0 else 'neutral', 'direction': 'slowly, hushed' if i == 0 else 'plain', 'pause_before': 0.5}}
                for i, s in enumerate(draft['segments'])]}
        elif field == 'sound_cues':
            value = {'cues': [{'name': 'Desert wind', 'kind': 'ambience', 'duration': 10, 'description': 'Soft night desert wind', 'start': 0, 'end': 1, 'level_db': -24}]}
        elif field == 'auto_changes':
            value = {'changes': self.changes, 'summary': 'ok'}
        else:
            raise AssertionError(field)
        return {'revisions': [{'id': field, 'text': json.dumps(value)}], 'notes': [], 'questions': []}

    def generate(self, request, env, job_id=None, sound=False):
        active = [r for r in self.rows.values() if r['kind'] == 'audio_job' and r['status'] == 'queued']
        if len(active) >= 4:
            raise Problem('Four audio recordings are already queued. Wait for one to finish.', 429)
        job = {'id': job_id, 'kind': 'audio_job', 'status': 'queued', 'request': request, 'sound': sound, 'created': 0}
        self.rows[job_id] = job
        return copy.deepcopy(job)

    def finish_jobs(self):
        for job in [r for r in self.rows.values() if r['kind'] == 'audio_job' and r['status'] == 'queued']:
            aid = uuid.uuid4().hex
            path = self.data / (aid + '.wav')
            path.write_bytes(b'RIFF' + aid.encode())
            asset = {'id': aid, 'kind': 'asset', 'media': 'audio', 'path': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                     'story_id': job['request'].get('story_id'), 'created': 0}
            design = job['request'].get('voice_design')
            if design:
                asset['voice_reference'] = {**design, 'source': 'designed'}
                job['voice_reference_id'] = aid
            job.update(status='done', asset_id=aid)
            self.rows[aid] = asset

    def finish_listen(self, text):
        for d in (self.data / 'queue').iterdir():
            if (d / 'request.json').is_file() and json.loads((d / 'request.json').read_text())['task'] == 'listen':
                (d / 'output.json').write_text(json.dumps({'text': text}))
                (d / 'status.json').write_text(json.dumps({'status': 'complete'}))

    def pilot(self, **extra):
        body = {'story_id': 'story1', 'title': 'Chapter 1', 'text': 'Once upon a time a merchant met a jinni.',
                'audio_snapshot': {'model': 'voxcpm2', 'compute': 'b200', 'genre': 'Story Book Reading'},
                'auto_options': {'language': 'English'}, **extra}
        return auto.pilot(body, self.env)

    def run_to_end(self, eid, heard=None):
        auto.tick(self.env)
        self.finish_jobs()
        auto.tick(self.env)          # voices and sounds ready → record queued
        self.finish_jobs()
        auto.tick(self.env)          # recording ready → checks → listen job
        if heard is not None:
            self.finish_listen(heard)
            auto.tick(self.env)
            # The auto-rater records again (up to three passes) while too little of the script is heard.
            while self.rows[eid].get('phase') in ('record', 'recording', 'check', 'listen') and self.rows[eid].get('rater_pass', 1) <= auto.audio_rater.MAX_PASSES:
                self.finish_jobs()
                auto.tick(self.env)
                self.finish_jobs()
                auto.tick(self.env)
                self.finish_listen(heard)
                auto.tick(self.env)
        return self.rows[eid]

    def script(self, eid):
        return ' '.join(l['text'] for l in self.rows[eid]['request']['lines'])


class AutoSeriesTest(Harness):
    def test_story_pilot_makes_a_checked_episode_with_distinct_designed_voices(self):
        result = self.pilot()
        eid = result['episode_id']
        auto.tick(self.env)
        ep = self.rows[eid]
        self.assertEqual(ep['phase'], 'assets')
        designs = [r for r in self.rows.values() if r['kind'] == 'audio_job' and r['request'].get('voice_design')]
        self.assertEqual(len(designs), 2)
        self.assertNotEqual(designs[0]['request']['lines'][0]['direction'], designs[1]['request']['lines'][0]['direction'])
        self.assertTrue(all(j['request']['compute'] == 'b200' for j in designs))
        ep = self.run_to_end(eid, heard=None)
        request = ep['request']
        refs = {l['voice'] for l in request['lines']}
        self.assertEqual(len(refs), 2)
        self.assertTrue(all(v.startswith('ref:') for v in refs))
        first = request['lines'][0]
        self.assertEqual(first['direction'], 'slowly, hushed')
        self.assertEqual(first['speed'], 0.92)
        self.assertEqual(request['lines'][1]['pause_before'], 0.5)
        self.assertEqual(request['soundtrack'][0]['kind'], 'ambience')
        self.assertEqual(request['sound_design_version'], 1)
        self.assertEqual(ep['phase'], 'listen')
        listen = [d for d in (self.data / 'queue').iterdir() if (d / 'input.wav').is_file()]
        self.assertEqual(len(listen), 1)
        payload = json.loads((listen[0] / 'request.json').read_text())
        self.assertEqual((payload['task'], payload['model'], payload['compute']), ('listen', 'whisper-large-v3-turbo', 'b200'))
        self.assertIn('/api/audio/auto/listen-input/', payload['input']['path'])
        self.finish_listen(self.script(eid))
        auto.tick(self.env)
        ep = self.rows[eid]
        self.assertEqual(ep['status'], 'made')
        note = auto.note(ep)
        self.assertEqual(sorted(note['new_voices']), ['King Shahryar', 'Scheherazade'])
        self.assertEqual({k: v['status'] for k, v in note['checks'].items()},
                         {'distinct_voices': 'passed', 'gender_age': 'passed', 'loudness': 'passed', 'listen_back': 'passed', 'sounds': 'passed', 'delivery': 'passed'})
        series = auto.episodes({'story_id': 'story1'}, self.env)['series']
        self.assertTrue(all(c['voice_ref'] for c in series['cast']))

    def test_listen_back_failure_and_missing_tools_are_never_passed(self):
        eid = self.pilot()['episode_id']
        self.run_to_end(eid, heard='completely different words')
        self.assertEqual(self.rows[eid]['checks']['listen_back']['status'], 'failed')
        with patch.object(auto, 'listen_workers', lambda: []), patch.object(auto, 'measure', lambda p, x: None):
            eid = self.pilot(title='Two')['episode_id']
            ep = self.run_to_end(eid)
        self.assertEqual(ep['checks']['listen_back']['status'], 'skipped')
        self.assertEqual(ep['checks']['loudness']['status'], 'skipped')
        self.assertEqual(ep['status'], 'made')

    def test_loud_or_silent_recording_fails_the_level_check(self):
        with patch.object(auto, 'measure', lambda p, x: {'lufs': -31.0, 'silences': [7.5], 'threshold': 4.0}):
            eid = self.pilot()['episode_id']
            ep = self.run_to_end(eid, heard='')
        self.assertEqual(ep['checks']['loudness']['status'], 'failed')
        self.assertIn('too quiet', ep['checks']['loudness']['detail'])

    def test_returning_characters_keep_their_voice_and_new_ones_stay_distinct(self):
        eid = self.pilot()['episode_id']
        self.run_to_end(eid, heard='x')
        first = {c['id']: c['voice_ref'] for c in auto.episodes({'story_id': 'story1'}, self.env)['series']['cast']}
        merchant = {'id': 'merchant', 'name': 'The Merchant', 'role': 'character', 'gender': 'male', 'age_group': 'adult',
                    'personality': 'Anxious', 'voice_description': 'Deep stern male voice, slow, middle-aged man', 'sample': 'Please spare me, I beg you, I have a family waiting.', 'feelings': []}
        self.cast = copy.deepcopy(CAST) + [merchant]
        eid = self.pilot(title='Chapter 2')['episode_id']
        auto.tick(self.env)
        ep = self.rows[eid]
        self.assertEqual(sorted(ep['returning']), ['King Shahryar', 'Scheherazade'])
        self.assertEqual(ep['new_voices'], ['The Merchant'])
        new = [r for r in self.rows.values() if r['kind'] == 'audio_job' and r['status'] == 'queued']
        self.assertEqual(len(new), 1)
        self.assertIn('unlike the others' if 'texture' in new[0]['request']['lines'][0]['direction'] else 'than the other voices', new[0]['request']['lines'][0]['direction'])
        self.run_to_end(eid, heard='x')
        cast = {c['id']: c for c in auto.episodes({'story_id': 'story1'}, self.env)['series']['cast']}
        self.assertEqual({k: cast[k]['voice_ref'] for k in first}, first)
        self.assertTrue(cast['king']['recurring'])

    def test_unusual_character_asks_with_two_samples_then_uses_the_answer(self):
        self.cast = copy.deepcopy(CAST) + [JINNI]
        eid = self.pilot()['episode_id']
        auto.tick(self.env)
        self.finish_jobs()
        auto.tick(self.env)
        ep = self.rows[eid]
        self.assertEqual(ep['status'], 'question')
        question = auto.note(ep)['questions'][0]
        self.assertEqual(len(question['options']), 2)
        self.assertTrue(all(o['sample_ref'] for o in question['options']))
        auto.tick(self.env)
        self.assertEqual(self.rows[eid]['status'], 'question')
        result = auto.answer({'episode_id': eid, 'question_id': question['id'], 'option': 1}, self.env)
        self.assertEqual(result['episode']['status'], 'working')
        jinni = next(c for c in result['series']['cast'] if c['id'] == 'jinni')
        self.assertEqual(jinni['voice_ref'], question['options'][1]['sample_ref'])
        auto.tick(self.env)
        self.finish_jobs()
        auto.tick(self.env)
        self.assertIn('ref:' + jinni['voice_ref'], {l['voice'] for l in self.rows[eid]['request']['lines']})
        with self.assertRaises(Problem):
            auto.answer({'episode_id': eid, 'question_id': question['id'], 'option': 0}, self.env)

    def test_plain_words_change_redesigns_a_voice_and_keeps_rules_for_later_episodes(self):
        eid = self.pilot()['episode_id']
        self.run_to_end(eid, heard='x')
        old = next(c for c in auto.episodes({'story_id': 'story1'}, self.env)['series']['cast'] if c['id'] == 'king')['voice_ref']
        self.changes = [{'type': 'voice', 'character_id': 'king', 'voice_description': 'Much deeper, older male voice, gravelly old man'},
                        {'type': 'delivery', 'character_id': 'narrator', 'lines': [], 'speed': 0.85, 'direction': 'warmer', 'pause_before': None},
                        {'type': 'sound', 'target': 'ambience', 'action': 'quieter'},
                        {'type': 'script', 'line': 1, 'text': 'A new line.'},
                        {'type': 'bogus'}]
        result = auto.change({'story_id': 'story1', 'episode': 1, 'instruction': 'King deeper, narrator warmer and slower, less wind'}, self.env)
        self.assertEqual([c['type'] for c in result['changes']], ['voice', 'delivery', 'sound', 'script'])
        self.assertEqual(result['remake_from'], 'assets')
        self.assertEqual(result['episode']['status'], 'working')
        self.run_to_end(eid, heard='x')
        ep = self.rows[eid]
        self.assertEqual(ep['version'], 2)
        cast = {c['id']: c for c in auto.episodes({'story_id': 'story1'}, self.env)['series']['cast']}
        self.assertNotEqual(cast['king']['voice_ref'], old)
        narrator = [l for l, src in zip(ep['request']['lines'], ep['lines']) if src['character_id'] == 'narrator']
        self.assertTrue(all(l['speed'] == 0.85 and l['direction'].startswith('warmer') for l in narrator))
        self.assertEqual(ep['request']['soundtrack'][0]['level_db'], -30)
        self.assertEqual(ep['lines'][1]['text'], 'A new line.')
        # A later episode keeps the instruction and the rules.
        eid2 = self.pilot(title='Chapter 2')['episode_id']
        self.run_to_end(eid2, heard='x')
        prompt = next(b for f, b in reversed(self.calls) if f == 'audio_plan')['fields'][0]['text']
        self.assertIn('narrator warmer and slower', prompt)
        later = [l for l, src in zip(self.rows[eid2]['request']['lines'], self.rows[eid2]['lines']) if src['character_id'] == 'narrator']
        self.assertTrue(all(l['speed'] == 0.85 for l in later))

    def test_change_needs_a_finished_episode_and_a_real_change(self):
        eid = self.pilot()['episode_id']
        with self.assertRaises(Problem) as working:
            auto.change({'episode_id': eid, 'instruction': 'slower'}, self.env)
        self.assertEqual(working.exception.code, 409)
        self.run_to_end(eid, heard='x')
        self.changes = [{'type': 'delivery', 'character_id': 'nobody', 'speed': 1.2}]
        with self.assertRaises(Problem):
            auto.change({'episode_id': eid, 'instruction': 'make it better'}, self.env)
        with self.assertRaises(Problem):
            auto.change({'episode_id': eid, 'instruction': 'x' * 1001}, self.env)

    def test_restart_during_ai_stops_without_a_paid_retry(self):
        eid = self.pilot()['episode_id']
        ep = self.rows[eid]
        ep['inflight'] = 'auto_cast'
        auto.tick(self.env)
        self.assertEqual(self.rows[eid]['status'], 'error')
        self.assertIn('No paid retry', self.rows[eid]['error'])
        self.assertEqual(self.calls, [])

    def test_busy_ai_and_full_queue_wait_instead_of_failing(self):
        eid = self.pilot()['episode_id']
        self.busy = True
        auto.tick(self.env)
        self.assertEqual((self.rows[eid]['status'], self.rows[eid]['phase']), ('working', 'cast'))
        self.assertNotIn('inflight', self.rows[eid])
        self.busy = False
        for n in range(4):
            self.rows['full' + str(n)] = {'id': 'full' + str(n), 'kind': 'audio_job', 'status': 'queued', 'request': {}}
        auto.tick(self.env)
        self.assertEqual((self.rows[eid]['status'], self.rows[eid]['phase']), ('working', 'assets'))
        self.assertIn('Four audio recordings', self.rows[eid]['progress'])

    def test_pilot_validation(self):
        with self.assertRaises(Problem) as cpu:
            self.pilot(audio_snapshot={'model': 'voxcpm2', 'compute': 'cpu'})
        self.assertIn('not generated on CPU', cpu.exception.message)
        with self.assertRaises(Problem) as model:
            self.pilot(audio_snapshot={'model': 'indic-mio', 'compute': 'b200'})
        self.assertIn('designed voices', model.exception.message)
        with self.assertRaises(Problem):
            self.pilot(text='')
        with self.assertRaises(Problem):
            auto.pilot({'text': 'x'}, self.env)
        self.pilot()
        with self.assertRaises(Problem) as twice:
            self.pilot()
        self.assertEqual(twice.exception.code, 409)

    def test_listen_link_is_signed_and_limited_to_episode_recordings(self):
        eid = self.pilot()['episode_id']
        self.run_to_end(eid)
        asset = self.rows[self.rows[eid]['asset_id']]
        link = auto.listen_link(asset)
        from urllib.parse import parse_qs, urlsplit
        query = parse_qs(urlsplit(link['path']).query)
        self.assertEqual(auto.verify_listen_link(asset['id'], query, self.env), self.data / asset['path'])
        with self.assertRaises(Problem):
            auto.verify_listen_link(asset['id'], {**query, 'sig': ['0' * 64]}, self.env)
        other = next(r for r in self.rows.values() if r['kind'] == 'asset' and r.get('voice_reference'))
        with self.assertRaises(Problem):
            auto.verify_listen_link(other['id'], parse_qs(urlsplit(auto.listen_link(other)['path']).query), self.env)

    def test_compare_and_ffmpeg_parsing(self):
        score, missing = auto.compare('The king, listened. Then he slept!', 'the king listened then he')
        self.assertAlmostEqual(score, 5 / 6)
        self.assertEqual(missing, ['slept'])
        stderr = ('[silencedetect @ 0x1] silence_start: 3.2\n[silencedetect @ 0x1] silence_end: 9.9 | silence_duration: 6.7\n'
                  '[Parsed_loudnorm_1 @ 0x2]\n{\n "input_i" : "-19.40",\n "input_tp" : "-3.1"\n}\n')
        with patch('shutil.which', lambda name: '/usr/bin/ffmpeg'), \
                patch.object(subprocess, 'run', lambda *a, **k: subprocess.CompletedProcess(a, 0, '', stderr)):
            found = REAL_MEASURE('x.wav', 1.0)
        self.assertEqual(found, {'lufs': -19.4, 'silences': [6.7], 'threshold': 4.0})


class AutoWorkflowTest(Harness):
    def workflow(self, **extra):
        body = {'name': 'Arabian Nights', 'source_mode': 'chapters', 'time': '09:00', 'timezone': 'UTC', 'start_date': '2026-11-10',
                'repeat': 'weekly', 'end_mode': 'never', 'total_chapters': 3, 'next_chapter': 1, 'chapters': ['One', 'Two', 'Three'],
                'audio_snapshot': {'model': 'voxcpm2', 'compute': 'b200', 'genre': 'Story Book Reading', 'script_brief': {}},
                'auto': True, 'auto_options': {'language': 'English'}, **extra}
        return workflows.save(body, self.env)

    def drive(self):
        workflows.tick(self.env)
        self.finish_jobs()
        workflows.tick(self.env)
        self.finish_jobs()
        workflows.tick(self.env)
        listening = [e for e in self.rows.values() if e['kind'] == 'auto_episode' and e['phase'] == 'listen']
        self.finish_listen(self.script(listening[0]['id']) if listening else '')
        workflows.tick(self.env)

    def test_auto_workflow_saves_without_speakers_and_rejects_cpu(self):
        w = self.workflow()
        self.assertTrue(w['auto'])
        self.assertEqual(w['audio_snapshot']['speakers'], [])
        self.assertTrue(w['review_before_publish'])
        with self.assertRaises(Problem):
            self.workflow(audio_snapshot={'model': 'voxcpm2', 'compute': 'cpu'})
        with self.assertRaises(Problem):
            self.workflow(auto='yes')

    def test_pilot_run_then_approve_then_scheduled_episode_publishes_or_holds(self):
        w = self.workflow(review_before_publish=False)
        with patch.object(workflows, 'STARTED', True):
            result = auto.pilot({'workflow_id': w['id'], 'request_id': uuid.uuid4().hex}, self.env)
            with self.assertRaises(Problem) as early:
                auto.approve({'workflow_id': w['id']}, self.env)
            self.assertEqual(early.exception.code, 409)
            self.drive()
            run = self.rows[result['run_id']]
            self.assertEqual(run['status'], 'done')
            ep = self.rows[result['episode_id']]
            self.assertEqual((ep['status'], ep['episode']), ('made', 1))
            self.assertEqual(self.rows[w['id']]['next_chapter'], 2)
            self.assertEqual(self.rows[w['id']]['status'], 'paused')
            approved = auto.approve({'workflow_id': w['id']}, self.env)
            self.assertEqual(approved['workflow']['status'], 'active')
            self.assertTrue(approved['series']['approved'])
            workflows.enqueue(self.rows[w['id']], 'scheduled-2', self.env)
            self.drive()
        episodes = auto.episodes({'workflow_id': w['id']}, self.env)['episodes']
        self.assertEqual([(e['episode'], e['status']) for e in episodes], [(1, 'made'), (2, 'published')], episodes[-1]['held_reason'] or episodes[-1]['checks'])
        self.assertEqual(episodes[1]['returning'], ['Scheherazade', 'King Shahryar'])
        # A failed check holds the episode even when publishing is automatic.
        with patch.object(workflows, 'STARTED', True), patch.object(auto, 'measure', lambda p, x: {'lufs': -5.0, 'silences': [], 'threshold': 4}):
            workflows.enqueue(self.rows[w['id']], 'scheduled-3', self.env)
            self.drive()
        third = auto.episodes({'workflow_id': w['id']}, self.env)['episodes'][2]
        self.assertEqual(third['status'], 'held')
        self.assertIn('loudness', third['held_reason'])
        self.assertEqual(auto.publish({'episode_id': third['id']}, self.env)['episode']['status'], 'published')

    def test_question_keeps_the_run_waiting(self):
        self.cast = copy.deepcopy(CAST) + [JINNI]
        w = self.workflow()
        with patch.object(workflows, 'STARTED', True):
            result = auto.pilot({'workflow_id': w['id'], 'request_id': uuid.uuid4().hex}, self.env)
            workflows.tick(self.env)
            self.finish_jobs()
            workflows.tick(self.env)
        run = self.rows[result['run_id']]
        self.assertEqual(run['status'], 'waiting')
        self.assertIn('Waiting for your answer', run['progress'])

    def test_non_auto_workflow_is_unchanged(self):
        body = {'name': 'News', 'source_mode': 'news', 'prompt': 'Science', 'time': '05:00', 'timezone': 'UTC', 'start_date': '2026-11-10',
                'audio_snapshot': {'model': 'indic-mio', 'compute': 'cpu', 'presentation': 'single', 'character_count': 1,
                                   'speakers': [{'id': 'host', 'name': 'Host', 'voice': 'en_female', 'language': 'Hindi', 'emotion': 'happy'}]}}
        w = workflows.save(body, self.env)
        self.assertNotIn('auto', w)
        with self.assertRaises(Problem):
            auto.episodes({'workflow_id': w['id']}, self.env)


class AutoRaterTest(Harness):
    def test_rater_retries_failing_lines_in_spoken_form_then_holds_after_three_passes(self):
        eid = self.pilot()['episode_id']
        self.run_to_end(eid, heard='completely different words')
        ep = self.rows[eid]
        self.assertEqual(ep['checks']['listen_back']['status'], 'failed')
        self.assertEqual([h['pass'] for h in ep['rater_history']], [1, 2, 3])
        self.assertIn('could not be generated reliably', ep['checks']['listen_back']['detail'])
        records = [r for r in self.rows.values() if r['kind'] == 'audio_job' and r.get('request', {}).get('task') != 'listen'
                   and 'lines' in r.get('request', {}) and r['request'].get('title', '').startswith(ep['title'])]
        self.assertGreaterEqual(len({r['id'] for r in records}), 3)

    def test_rater_passes_on_a_retry_when_the_script_is_heard(self):
        eid = self.pilot()['episode_id']
        auto.tick(self.env)
        self.finish_jobs()
        auto.tick(self.env)
        self.finish_jobs()
        auto.tick(self.env)
        self.finish_listen('nothing like it')
        auto.tick(self.env)
        self.assertEqual(self.rows[eid]['checks']['listen_back']['status'], 'retrying')
        self.assertIn(self.rows[eid]['phase'], ('record', 'recording'))
        self.finish_jobs()
        auto.tick(self.env)
        self.finish_jobs()
        auto.tick(self.env)
        self.finish_listen(self.script(eid))
        auto.tick(self.env)
        check = self.rows[eid]['checks']['listen_back']
        self.assertEqual((check['status'], check['pass']), ('passed', 2))


class AudioRaterUnitTest(unittest.TestCase):
    def test_numbers_match_as_digits_or_words_and_punctuation_is_ignored(self):
        import audio_rater as r
        score, per_line, _ = r.score(['It took about four million years, roughly 1,000-10,000 radii.'],
                                     'it took about 4 million years roughly 1000 10000 radii')
        self.assertEqual((score, per_line), (1.0, [1.0]))

    def test_per_line_scores_find_the_line_that_was_not_spoken(self):
        import audio_rater as r
        lines = ['Welcome to the show.', 'The jet power is about ten to the forty-six ergs per second.', 'Thanks for listening.']
        score, per_line, missing = r.score(lines, 'Welcome to the show. The jet power is. Thanks for listening.')
        self.assertLess(score, r.PASS)
        self.assertEqual(r.repair(lines, per_line)[0], [1])
        self.assertTrue(missing)

    def test_spoken_form_rewrites_notation_without_changing_meaning(self):
        import audio_rater as r
        self.assertEqual(r.spoken_form('~4 × 10^6 yr, 0.1–0.3 pc, e.g. HERG & LERG, 10⁴⁶ erg'),
                         'about 4 times ten to the sixth yr, 0.1 to 0.3 pc, for example HERG and LERG, ten to the forty-sixth erg')
        self.assertEqual(r.spoken_form('Plain words stay.'), 'Plain words stay.')


if __name__ == '__main__':
    unittest.main()
