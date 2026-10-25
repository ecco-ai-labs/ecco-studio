import json
import math
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch
from unittest.mock import Mock
from audio_worker import inference_device

from audio_schema import validate, MODELS
from queue_worker import worker_command, compute_from_name, owns, recover_jobs
import audio_queue
import tempfile


class MultiModelRequests(TestCase):
    def test_full_story_dialogue_and_cue_splits_fit_without_raising_text_budget(self):
        body={'model':'chatterbox','compute':'cpu','lines':[{'text':'Hello there.','voice':'default'} for _ in range(40)]}
        self.assertEqual(len(validate(body)['lines']),40)
        with self.assertRaises(ValueError): validate({**body,'lines':body['lines']*3})
        with self.assertRaises(ValueError): validate({**body,'lines':[{'text':'x'*300,'voice':'default'} for _ in range(20)]})

    def test_cpu_inference_never_queries_or_uses_cuda(self):
        torch = Mock()
        self.assertEqual(inference_device({'compute': 'cpu'}, torch), 'cpu')
        torch.cuda.is_available.assert_not_called()
        torch.set_num_threads.assert_called_once()
        torch.cuda.is_available.return_value = False
        with self.assertRaises(RuntimeError):
            inference_device({'compute': 'b200'}, torch)

    def test_cpu_dispatch_uses_cpu_only_interpreters_and_environment(self):
        with patch('pathlib.Path.is_file', return_value=True), patch.dict('os.environ', {'PYTHONPATH': 'gpu-deps', 'CUDA_VISIBLE_DEVICES': '0'}):
            for model in MODELS:
                command, env = worker_command({'model': model, 'compute': 'cpu'}, Path('/tmp/cpu-job'))
                self.assertTrue(command[0].endswith('cpu-' + model + '-venv/bin/python'))
                self.assertEqual(env['CUDA_VISIBLE_DEVICES'], '')
                self.assertEqual(env['OMP_NUM_THREADS'], '1')
                self.assertNotIn('PYTHONPATH', env)

    def test_compute_validation_and_hardware_detection(self):
        body = {'lines': [{'text': 'Hello'}]}
        self.assertEqual(validate(body)['compute'], 'cpu')
        for compute in ('a100', 'cpu', 'b200'):
            self.assertEqual(validate(dict(body, compute=compute))['compute'], compute)
        for compute in ('', 'any', '../../worker', None, {}, []):
            with self.assertRaises(ValueError):
                validate(dict(body, compute=compute))
        self.assertEqual(compute_from_name('NVIDIA A100-SXM4-80GB'), 'a100')
        self.assertEqual(compute_from_name('NVIDIA B200'), 'b200')
        with self.assertRaises(RuntimeError):
            compute_from_name('CPU')
        self.assertTrue(owns({'compute': 'a100'}, 'a100'))
        self.assertFalse(owns({'compute': 'a100'}, 'b200'))
        self.assertFalse(owns({'compute': 'cpu'}, 'b200'))
        self.assertTrue(owns({}, 'b200'))
        self.assertFalse(owns({}, 'a100'))

    def test_worker_restart_leaves_other_compute_jobs_untouched(self):
        with tempfile.TemporaryDirectory() as tmp, patch('queue_worker.ROOT', Path(tmp)):
            for i, compute in enumerate(('a100', 'b200', 'cpu')):
                directory = Path(tmp) / (str(i) * 32)
                audio_queue.write(directory / 'request.json', {'compute': compute})
                audio_queue.write(directory / 'status.json', {'status': 'running'})
            recover_jobs('a100')
            self.assertEqual(audio_queue.read(Path(tmp) / ('0'*32) / 'status.json')['status'], 'error')
            for i in (1, 2):
                self.assertEqual(audio_queue.read(Path(tmp) / (str(i)*32) / 'status.json')['status'], 'running')

    def test_all_model_languages_and_voices_reach_worker(self):
        for model, settings in MODELS.items():
            for language in settings['languages']:
                for voice in settings['voices']:
                    with self.subTest(model=model, language=language, voice=voice['id']):
                        result = validate({'model': model, 'lines': [{'text': 'Test.', 'language': language, 'voice': voice['id']}]})
                        self.assertEqual(result['model'], model)
                        self.assertEqual(result['lines'][0]['voice'], voice['id'])

    def test_unsupported_combinations_are_rejected(self):
        for model, language, voice in [('chatterbox', 'Urdu', 'default'), ('indicf5', 'English', 'pan_f'),
                                      ('indicf5', 'Hindi', 'default'), ('chatterbox', 'Hindi', '../../access.key')]:
            with self.subTest(model=model, language=language, voice=voice), self.assertRaises(ValueError):
                validate({'model': model, 'lines': [{'text': 'Test.', 'language': language, 'voice': voice}]})
        for model in ('chatterbox', 'indicf5'):
            with self.assertRaisesRegex(ValueError, 'emotion'):
                validate({'model': model, 'lines': [{'text': 'Test.', 'emotion': 'angry'}]})

    def test_expressiveness_is_bounded_and_preserved(self):
        body = {'model': 'chatterbox', 'lines': [{'text': 'Test.'}]}
        self.assertEqual(validate(body)['exaggeration'], .5)
        self.assertEqual(validate(dict(body, exaggeration=1.2))['exaggeration'], 1.2)
        for value in (-1, 3, math.inf, math.nan, True, '.5'):
            with self.assertRaises(ValueError):
                validate(dict(body, exaggeration=value))

    def test_worker_routes_to_isolated_interpreter_and_removes_shared_import_path(self):
        with patch.dict('os.environ', {'PYTHONPATH': 'old-model-deps'}), patch('pathlib.Path.is_file', return_value=True):
            for model in ('chatterbox', 'indicf5'):
                command, env = worker_command({'model': model}, Path('/tmp/test-audio-job'))
                self.assertTrue(command[0].endswith(model + '-venv/bin/python'))
                self.assertTrue(command[1].endswith('extra_worker.py'))
                self.assertNotIn('PYTHONPATH', env)
                self.assertEqual(env['HF_HUB_OFFLINE'], '1')
            command, env = worker_command({'model': 'indic-mio'}, Path('/tmp/test-audio-job'))
            self.assertTrue(command[1].endswith('audio_worker.py'))
            self.assertEqual(env['PYTHONPATH'], 'old-model-deps')
            with self.assertRaises(ValueError):
                worker_command({'model': '../../other'}, Path('/tmp/test-audio-job'))

    def test_browser_and_server_catalogs_agree(self):
        script = Path(__file__).parents[1].joinpath('audio-models.js').read_text()
        browser = json.loads(script.split('window.EccoAudioModels = ', 1)[1].strip().removesuffix(';'))
        self.assertEqual({m['id']: m for m in browser}, MODELS)


if __name__ == '__main__':
    main()

