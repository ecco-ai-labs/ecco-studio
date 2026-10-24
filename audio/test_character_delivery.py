import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from audio_schema import validate
from extra_worker import chatterbox_controls
import audio_queue


class CharacterDelivery(unittest.TestCase):
    def setUp(self):
        self.request = {'model': 'chatterbox', 'lines': [
            {'text': 'Hello.', 'voice': 'default', 'language': 'English', 'pitch': -2, 'speed': .9, 'exaggeration': .7},
            {'text': 'Namaste.', 'voice': 'mar_f', 'language': 'Hindi', 'pitch': 2, 'speed': 1.1, 'exaggeration': .5}]}

    def test_independent_controls_survive_validation_and_chatterbox_adapter(self):
        result = validate(self.request)
        self.assertEqual(result['character_controls_version'], 1)
        self.assertEqual([line['pitch'] for line in result['lines']], [-2, 2])
        self.assertEqual([line['speed'] for line in result['lines']], [.9, 1.1])
        self.assertEqual(chatterbox_controls(result, result['lines'][0]), {'exaggeration': .7, 'cfg_weight': .3})
        self.assertEqual(chatterbox_controls(result, result['lines'][1]), {'exaggeration': .5, 'cfg_weight': 0})
        result['lines'][1]['cfg_weight'] = .2
        self.assertEqual(chatterbox_controls(result, result['lines'][1])['cfg_weight'], .2)

    def test_per_character_controls_reject_invalid_values(self):
        for key, values in {'pitch': [5, -5, True, float('inf')], 'speed': [0, 2, '1'], 'exaggeration': [-1, 3], 'cfg_weight': [-1, 2]}.items():
            for value in values:
                request = copy.deepcopy(self.request)
                request['lines'][0][key] = value
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    validate(request)

    def test_readiness_requires_new_workers_not_only_new_api(self):
        import time
        with tempfile.TemporaryDirectory() as root, patch.object(audio_queue, 'ROOT', Path(root)):
            worker = {'compute': 'cpu', 'updated': time.time(), 'models': ['chatterbox']}
            audio_queue.write(Path(root) / 'worker-old.json', worker)
            self.assertEqual(audio_queue.availability()['compute']['cpu']['character_controls_version'], 0)
            worker['character_controls_version'] = 1
            audio_queue.write(Path(root) / 'worker-old.json', worker)
            self.assertEqual(audio_queue.availability()['compute']['cpu']['character_controls_version'], 1)


if __name__ == '__main__':
    unittest.main()
