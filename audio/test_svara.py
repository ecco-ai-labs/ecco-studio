import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import svara_codec as codec
from audio_schema import MODELS, LANGUAGES, validate
import install_gpu_voice_models as installer


def frame(values):
    return [codec.AUDIO_TOKENS_START + i * codec.CODEBOOK + v for i, v in enumerate(values)]


class SvaraCodec(unittest.TestCase):
    def test_prompt_layout(self):
        ids = codec.prompt_ids(lambda text: [len(text)], 'Telugu (Female)', 'హలో')
        self.assertEqual(ids, [codec.START_OF_HUMAN, codec.BOS, len('Telugu (Female): హలో'), codec.END_OF_TEXT, codec.END_OF_HUMAN])

    def test_emotion_tags(self):
        self.assertEqual(codec.tagged_text('Hello! ', 'happy'), 'Hello! <happy>')
        self.assertEqual(codec.tagged_text('Hello', 'angry'), 'Hello <anger>')
        self.assertEqual(codec.tagged_text('Hello', 'neutral'), 'Hello')
        self.assertEqual(codec.tagged_text('Hello', 'surprise'), 'Hello')

    def test_codes_split_into_three_levels(self):
        generated = [5, codec.START_OF_SPEECH, *frame([1, 2, 3, 4, 5, 6, 7]), *frame([10, 20, 30, 40, 50, 60, 70]), 99999 % 128000, codec.END_OF_SPEECH, *frame([0] * 7)]
        codes = codec.snac_codes(generated)
        self.assertEqual(codes, [[1, 10], [2, 5, 20, 50], [3, 4, 6, 7, 30, 40, 60, 70]])

    def test_partial_frame_dropped_and_bad_tokens_rejected(self):
        self.assertEqual(codec.snac_codes([codec.START_OF_SPEECH, *frame([1] * 7), *frame([2] * 7)[:3]])[0], [1])
        with self.assertRaises(ValueError):
            codec.snac_codes([codec.START_OF_SPEECH, codec.END_OF_SPEECH])
        with self.assertRaises(ValueError):
            codec.snac_codes([codec.START_OF_SPEECH, *[codec.AUDIO_TOKENS_START + 6 * codec.CODEBOOK + 5000] * 7])


class SvaraCatalog(unittest.TestCase):
    def test_catalog_entry(self):
        model = MODELS['svara-tts']
        self.assertNotIn('Urdu', model['languages'])
        self.assertTrue(set(model['languages']) <= set(LANGUAGES))
        for language in ('Hindi', 'Bengali', 'Telugu', 'English'):
            voices = [v for v in model['voices'] if v['language'] == language]
            self.assertEqual(sorted(v['speaker'] for v in voices), [language + ' (Female)', language + ' (Male)'])
        self.assertEqual(len({v['id'] for v in model['voices']}), len(model['voices']))

    def test_requests_validate_with_emotion(self):
        request = validate({'model': 'svara-tts', 'compute': 'b200', 'lines': [{'text': 'హలో', 'language': 'Telugu', 'voice': 'telugu-female', 'emotion': 'happy'}]})
        self.assertEqual(request['lines'][0]['emotion'], 'happy')
        with self.assertRaises(ValueError):
            validate({'model': 'svara-tts', 'lines': [{'text': 'سلام', 'language': 'Urdu', 'voice': 'hindi-female'}]})

    def test_gpu_worker_command_honours_configured_paths(self):
        from queue_worker import worker_command
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'ECCO_AUDIO_VENVS': temp, 'ECCO_AUDIO_MODELS': temp + '/weights'}):
            python = Path(temp) / 'svara-tts-venv' / 'bin' / 'python'
            python.parent.mkdir(parents=True)
            python.write_text('')
            command, env = worker_command({'model': 'svara-tts', 'compute': 'b200'}, Path('/tmp/job'))
            self.assertEqual(command[0], str(python))
            self.assertTrue(command[1].endswith('modern_worker.py'))
            self.assertEqual(command[command.index('--runtime') + 1], temp + '/weights')
            self.assertEqual(env['HF_HUB_OFFLINE'], '1')
        command, _ = worker_command({'model': 'indic-mio', 'compute': 'b200'}, Path('/tmp/job'))
        self.assertTrue(command[command.index('--runtime') + 1].endswith('audio/models'))


class GpuInstaller(unittest.TestCase):
    def test_packages_and_weights_are_separate_and_paths_configurable(self):
        calls = []
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'ECCO_AUDIO_VENVS': temp, 'ECCO_AUDIO_BASE_PYTHON': sys.executable}), \
                patch.object(installer, 'base_constraints', return_value=['torch==2.8.0']):
            installer.packages('svara-tts', run=lambda cmd, **kw: calls.append(cmd))
            self.assertEqual(calls[0][1:4], ['-m', 'venv', '--system-site-packages'])
            self.assertIn('snac', calls[1])
            self.assertIn(str(Path(temp) / 'svara-tts-venv' / 'ecco-constraints.txt'), calls[1])
            self.assertEqual((Path(temp) / 'svara-tts-venv' / 'ecco-constraints.txt').read_text(), 'torch==2.8.0\n')
            self.assertFalse(any('snapshot' in ' '.join(c) for c in calls))

    def test_weights_pin_revisions_and_record_them(self):
        downloads = []
        fake = type('M', (), {'snapshot_download': staticmethod(lambda repo, **kw: downloads.append((repo, kw)))})
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'ECCO_AUDIO_MODELS': temp, 'SVARA_REVISION': 'a' * 40, 'SNAC_REVISION': 'b' * 40}), \
                patch.dict(sys.modules, {'huggingface_hub': fake}):
            installer.weights('svara-tts')
            self.assertEqual(downloads[0][0], 'kenpath/svara-tts-v1')
            self.assertEqual(downloads[0][1]['revision'], 'a' * 40)
            self.assertEqual(downloads[1][1]['local_dir'], Path(temp) / 'svara-tts' / 'snac')
            record = json.loads((Path(temp) / 'svara-tts' / 'ecco-install.json').read_text())
            self.assertEqual(record['extras']['snac']['revision'], 'b' * 40)

    def test_moss_ttsd_is_not_advertised_without_an_adapter(self):
        self.assertNotIn('moss-ttsd', MODELS)
        with self.assertRaises(SystemExit):
            installer.smoke('moss-ttsd', run=lambda *a, **k: None)


if __name__ == '__main__':
    unittest.main()
