import threading
import unittest

import audio_stories


class Problem(Exception):
    pass


class CompleteAudioStory(unittest.TestCase):
    def setUp(self):
        self.saved = None
        self.env = dict(Problem=Problem, LOCK=threading.RLock(),
                        text=lambda value, maximum: value[:maximum],
                        new=lambda kind: {'id': 'story', 'kind': kind},
                        save=self.save)

    def save(self, record):
        self.saved = record
        return record

    def test_full_script_and_all_turns_survive_save(self):
        turns = [{'character_id': 'n', 'text': f'Passage {i}. ' + 'A full chapter. ' * 70}
                 for i in range(241)]
        summary = '\n\n'.join('Narrator: ' + turn['text'] for turn in turns)
        prep = {'cast': [{'id': 'n', 'name': 'Narrator'}],
                'plan': {'opening': None, 'segments': turns},
                'source_text': summary}
        result = audio_stories.save({'title': 'Complete chapter', 'summary': summary,
                                     'audio_preparation': prep}, self.env)
        self.assertGreater(len(summary), 150000)
        self.assertEqual(result['summary'], summary)
        self.assertEqual(result['audio_preparation']['plan']['segments'], turns)
        self.assertEqual(result['audio_preparation']['source_text'], summary)

    def test_invalid_speaker_still_rejected(self):
        prep = {'cast': [{'id': 'n', 'name': 'Narrator'}],
                'plan': {'segments': [{'character_id': 'missing', 'text': 'Hello'}]}}
        with self.assertRaisesRegex(Problem, 'character and text'):
            audio_stories.save({'title': 'Invalid', 'audio_preparation': prep}, self.env)
        self.assertIsNone(self.saved)
