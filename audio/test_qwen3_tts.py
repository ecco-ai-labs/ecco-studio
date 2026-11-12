"""Qwen3-TTS (described voices): catalog, validation, worker routing and installer layout. No model runs here."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
from audio_schema import DESIGN_MODELS, MODELS, REF_MODELS, validate
import install_gpu_voice_models as installer


class Qwen3TTSTest(unittest.TestCase):
    def test_catalog_offers_many_distinct_described_voices_including_children(self):
        model = MODELS['qwen3-tts']
        names = {v['id'] for v in model['voices']}
        self.assertGreaterEqual(len(names), 20)
        self.assertTrue({'girl-5', 'boy-6', 'storyteller-f', 'news-anchor-m', 'documentary-m'} <= names)
        self.assertTrue(all(v['description'].strip() for v in model['voices']))
        self.assertIn('English', model['languages'])
        self.assertIn('qwen3-tts', DESIGN_MODELS)
        self.assertIn('qwen3-tts', REF_MODELS)

    def test_front_end_copy_matches_the_catalog(self):
        js = (Path(__file__).resolve().parents[1] / 'audio-models.js').read_text()
        data = json.loads(js[js.index('['):js.rindex(']') + 1])
        self.assertEqual(data, json.loads((Path(__file__).with_name('model_catalog.json')).read_text()))

    def test_request_validates_and_unsupported_language_is_refused(self):
        request = validate({'model': 'qwen3-tts', 'compute': 'a100', 'lines': [
            {'text': 'Welcome to the show.', 'language': 'English', 'voice': 'warm-host-f'},
            {'text': 'Look, a butterfly!', 'language': 'English', 'voice': 'girl-5'}]})
        self.assertEqual([l['voice'] for l in request['lines']], ['warm-host-f', 'girl-5'])
        with self.assertRaises(ValueError):
            validate({'model': 'qwen3-tts', 'compute': 'a100', 'lines': [{'text': 'नमस्ते', 'language': 'Hindi', 'voice': 'warm-host-f'}]})

    def test_gpu_worker_runs_modern_worker_in_the_qwen3_environment(self):
        from queue_worker import worker_command
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'ECCO_AUDIO_VENVS': temp, 'ECCO_AUDIO_MODELS': temp + '/weights'}):
            python = Path(temp) / 'qwen3-tts-venv' / 'bin' / 'python'
            python.parent.mkdir(parents=True)
            python.write_text('')
            command, env = worker_command({'model': 'qwen3-tts', 'compute': 'a100'}, Path('/tmp/job'))
            self.assertEqual(command[0], str(python))
            self.assertTrue(command[1].endswith('modern_worker.py'))
            self.assertEqual(env['HF_HUB_OFFLINE'], '1')

    def test_installer_puts_design_and_base_weights_in_their_folders_and_has_a_smoke_test(self):
        spec = installer.MODELS['qwen3-tts']
        self.assertEqual((spec['repo'], spec['subdir']), ('Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', 'voice-design'))
        self.assertEqual(spec['extras'][0][:2], ('base', 'Qwen/Qwen3-TTS-12Hz-1.7B-Base'))
        voices = {v['id'] for v in MODELS['qwen3-tts']['voices']}
        self.assertTrue(all(line['voice'] in voices for line in installer.SMOKE['qwen3-tts']))


if __name__ == '__main__':
    unittest.main()
