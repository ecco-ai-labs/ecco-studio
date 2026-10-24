import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import openai_assistant as ai

def response(text, **extra):
    return {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': text}]}], **extra}

class AssistantTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config = patch.object(ai, 'CONFIG_FILE', Path(self.temp.name)/'private'/'openai.json')
        self.config.start()
        self.key = 'sk-test-only-' + 'x'*40
        self.env = {'records': lambda: []}
        self.body = {'stage': 'image', 'fields': [{'id': 'prompt', 'text': 'A red scooter.', 'max_length': 2000}], 'context': {}}
    def tearDown(self):
        self.config.stop(); self.temp.cleanup()
    def connect(self):
        with patch.object(ai, '_request', return_value=response('OK')):
            return ai.connect({'api_key': self.key})
    def result(self, **extra):
        return response(json.dumps({'revisions': [{'id': 'prompt', 'text': 'A red scooter, clearly framed.'}], 'notes': ['Clarified framing.'], 'questions': [], **extra}))
    def test_connect_checks_actual_inference_and_keeps_key_private(self):
        with patch.object(ai, '_request', return_value=response('OK')) as request:
            result = ai.connect({'api_key': self.key})
        self.assertTrue(result['enabled']); self.assertTrue(result['connected'])
        self.assertNotIn(self.key, json.dumps(result))
        self.assertEqual(stat.S_IMODE(ai.CONFIG_FILE.stat().st_mode), 0o600)
        self.assertFalse(request.call_args.args[1]['store'])
    def test_failed_replacement_preserves_previous_connection(self):
        self.connect(); original = ai.CONFIG_FILE.read_bytes()
        with patch.object(ai, '_request', side_effect=ai.AssistantError('Rejected', 502)):
            with self.assertRaises(ai.AssistantError): ai.connect({'api_key': 'sk-bad-'+'y'*30})
        self.assertEqual(ai.CONFIG_FILE.read_bytes(), original)
    def test_one_switch_disables_every_stage(self):
        self.connect(); ai.settings({'enabled': False})
        with patch.object(ai, '_request') as request:
            for stage in ai.STAGES:
                with self.assertRaises(ai.AssistantError): ai.enhance({**self.body, 'stage': stage}, self.env)
        request.assert_not_called()
        ai.settings({'enabled': True}); self.assertTrue(ai.status()['enabled'])
    def test_disconnect_removes_key_and_disables(self):
        self.connect(); ai.disconnect({})
        self.assertNotIn(self.key, ai.CONFIG_FILE.read_text())
        self.assertFalse(ai.status()['enabled']); self.assertFalse(ai.status()['connected'])
    def test_structured_revisions_and_context_exclude_secrets(self):
        self.connect()
        env = {'records': lambda: [{'kind': 'story', 'id': 's', 'title': 'Scooter', 'summary': 'Go to work', 'secret': 'PRIVATE'}, {'kind': 'billing', 'api_key': 'PRIVATE'}]}
        with patch.object(ai, '_request', return_value=self.result()) as request:
            result = ai.enhance({**self.body, 'story_id': 's', 'context': {'title': 'Scooter', 'api_key': 'PRIVATE'}}, env)
        payload=request.call_args.args[1]
        self.assertNotIn('PRIVATE', json.dumps(payload)); self.assertNotIn(self.key, json.dumps(payload))
        self.assertFalse(payload['store']); self.assertTrue(payload['text']['format']['strict'])
        self.assertEqual(result['revisions'][0]['id'], 'prompt')
    def test_generation_is_explicit_and_default_stays_improve(self):
        self.connect()
        for mode in ('generate', 'improve'):
            with patch.object(ai, '_request', return_value=self.result()) as request:
                ai.enhance({**self.body, 'mode': mode}, self.env)
            self.assertEqual('explicitly chose Generate' in request.call_args.args[1]['instructions'], mode == 'generate')
        with patch.object(ai, '_request') as request:
            with self.assertRaises(ai.AssistantError): ai.enhance({**self.body, 'mode': 'unknown'}, self.env)
            request.assert_not_called()
    def test_invalid_ids_duplicates_and_oversized_revisions_rejected(self):
        self.connect()
        for revisions in ([{'id':'other','text':'Text'}], [{'id':'prompt','text':'a'},{'id':'prompt','text':'b'}], [{'id':'prompt','text':'x'*2001}], [{'id':'prompt','text':''}]):
            with patch.object(ai, '_request', return_value=self.result(revisions=revisions)):
                with self.assertRaises(ai.AssistantError): ai.enhance(self.body,self.env)
    def test_audio_plan_uses_structured_characters_and_preserves_client_response(self):
        self.connect()
        body={'stage':'storyboard','mode':'generate','fields':[{'id':'audio_plan','text':'Generate a Hindi news script','max_length':20000}],
              'context':{'lines':[{'id':'reader','language':'Hindi'}]}}
        plan={'opening':None,'segments':[{'character_id':'reader','text':'नमस्ते।','title':''}]}
        with patch.object(ai,'_request',return_value=response(json.dumps({'plan':plan,'notes':[],'questions':[]}))) as request:
            result=ai.enhance(body,self.env)
        schema=request.call_args.args[1]['text']['format']['schema']
        self.assertEqual(schema['properties']['plan']['properties']['segments']['items']['properties']['character_id']['enum'],['reader'])
        self.assertEqual(json.loads(result['revisions'][0]['text']),plan)
        with patch.object(ai,'_request',return_value=response(json.dumps({'revisions':[{'id':'audio_plan','text':'Plain narration'}],'notes':[],'questions':[]}))):
            with self.assertRaises(ai.AssistantError): ai.enhance(body,self.env)
        body['context']['lines']=[{'character_id':'reader'}]
        with patch.object(ai,'_request',return_value=response(json.dumps({'plan':plan,'notes':[],'questions':[]}))):
            self.assertEqual(ai.enhance(body,self.env)['revisions'][0]['id'],'audio_plan')
    def test_review_only_cannot_mutate_approved_video_prompts(self):
        self.connect()
        with patch.object(ai, '_request', return_value=self.result()):
            with self.assertRaises(ai.AssistantError): ai.enhance({**self.body,'stage':'video','review_only':True},self.env)
    def test_refusal_and_incomplete_never_become_prompt_text(self):
        self.connect()
        for value in ({'status':'incomplete','output':[]}, {'status':'completed','output':[{'content':[{'type':'refusal','refusal':'No'}]}]}):
            with patch.object(ai, '_request', return_value=value):
                with self.assertRaises(ai.AssistantError): ai.enhance(self.body,self.env)
    def test_provider_error_does_not_leak_credential_or_raw_body(self):
        error=HTTPError('https://api.openai.com/v1/responses',401,'Rejected',{},io.BytesIO(self.key.encode()))
        with patch.object(ai,'urlopen',side_effect=error):
            with self.assertRaises(ai.AssistantError) as raised: ai._request(self.key,{})
        self.assertNotIn(self.key,str(raised.exception))
    def test_actual_selected_reference_is_passed_to_vision(self):
        from PIL import Image
        file=Path(self.temp.name)/'reference.png';Image.new('RGB',(20,20),'red').save(file)
        asset={'kind':'asset','media':'image','id':'ref','title':'Scooter'}
        env={'records':lambda:[asset],'asset_path':lambda _:file}
        self.connect()
        with patch.object(ai,'_request',return_value=self.result()) as request:
            result=ai.enhance({**self.body,'reference_ids':['ref']},env)
        images=[item for item in request.call_args.args[1]['input'][0]['content'] if item['type']=='input_image']
        self.assertEqual(len(images),1);self.assertTrue(images[0]['image_url'].startswith('data:image/jpeg;base64,'))
        self.assertEqual(result['reference_count'],1)
    def test_missing_reference_fails_before_api_request(self):
        self.connect()
        with patch.object(ai,'_request') as request:
            with self.assertRaises(ai.AssistantError): ai.enhance({**self.body,'reference_ids':['missing']},self.env)
        request.assert_not_called()

if __name__ == '__main__': unittest.main()

