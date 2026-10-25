import copy
import math
import unittest
from audio_schema import validate, LANGUAGES

class AudioRequests(unittest.TestCase):
    def setUp(self):
        self.body = {'model': 'indic-mio', 'lines': [
            {'text': 'नमस्ते! Welcome to Ecco.', 'language': 'Hindi', 'emotion': 'happy', 'voice': 'en_female'},
            {'text': 'آپ کیسے ہیں؟', 'language': 'Urdu', 'emotion': 'neutral', 'voice': 'en_male'}]}

    def test_mixed_language_text_and_speakers_preserved(self):
        result = validate(self.body)
        self.assertEqual(result['lines'], self.body['lines'])
        self.assertEqual((result['speed'], result['pitch'], result['pause']), (1, 0, .35))

    def test_supported_language_set(self):
        self.assertEqual(len(LANGUAGES), 23)
        for language in LANGUAGES:
            with self.subTest(language=language):
                body=copy.deepcopy(self.body);body['lines'][0]['language']=language
                self.assertEqual(validate(body)['lines'][0]['language'], language)

    def test_language_specific_emotions(self):
        body=copy.deepcopy(self.body);body['lines'][0].update(language='English',emotion='whisper')
        self.assertEqual(validate(body)['lines'][0]['emotion'], 'whisper')
        body['lines'][0]['language']='Tamil'
        with self.assertRaisesRegex(ValueError, 'emotion'):validate(body)
        body['lines'][0].update(language='English',emotion='fear')
        with self.assertRaisesRegex(ValueError, 'emotion'):validate(body)

    def test_rejects_empty_and_excessive_text(self):
        for text in ['', '   ', 'a'*501, None, 4]:
            body=copy.deepcopy(self.body);body['lines'][0]['text']=text
            with self.subTest(text_type=type(text)), self.assertRaises(ValueError):validate(body)
        body=copy.deepcopy(self.body);body['lines']=[dict(body['lines'][0],text='a'*500)]*9
        with self.assertRaisesRegex(ValueError, '4,000'):validate(body)

    def test_rejects_unknown_model_language_and_preset_paths(self):
        for field,value in [('language','Spanish'),('voice','../../credentials')]:
            body=copy.deepcopy(self.body);body['lines'][0][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):validate(body)
        with self.assertRaises(ValueError):validate(dict(self.body,model='other'))

    def test_numeric_controls_are_finite_and_bounded(self):
        for field,values in {'speed':[0,2,True,'1',math.nan], 'pitch':[-5,5,math.inf], 'pause':[-1,3]}.items():
            for value in values:
                with self.subTest(field=field,value=value),self.assertRaises(ValueError):
                    validate(dict(self.body,**{field:value}))

    def test_no_empty_or_unbounded_dialogue(self):
        for lines in [None, {}, [], self.body['lines']*81, [None]]:
            with self.subTest(lines_type=type(lines)),self.assertRaises(ValueError):validate(dict(self.body,lines=lines))

if __name__ == '__main__':unittest.main()
