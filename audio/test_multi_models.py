import json
import math
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch

from audio_schema import validate, MODELS
from queue_worker import worker_command


class MultiModelRequests(TestCase):
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
