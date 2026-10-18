import unittest
from unittest.mock import patch
import news_research as n

class NewsTests(unittest.TestCase):
    def setUp(self):
        self.config = patch.object(n.ai, 'provider_config', return_value={'api_key':'test-private-key','model':'test'})
        self.config.start(); self.addCleanup(self.config.stop)
        self.item = {'title':'News','summary':'A verified development.','sources':[{'url':'https://example.com/news','title':'Source','published_at':None}]}
    def result(self):
        report = ('News briefing', {'output':[{'content':[{'annotations':[{'type':'url_citation','url':'https://example.com/news','title':'Source'}]}]}]})
        formatted = ({'items':[{'title':'News','summary':'A verified development.','sources':[{'source_index':0,'published_at':None}]}]}, {})
        with patch.object(n, 'request', side_effect=[report, formatted]) as call:
            result = n.research({'prompt':'Find news','count':1,'date_range':'Past 7 Days'})
            self.assertEqual(call.call_args_list[0].args[1]['tool_choice'], 'required')
            self.assertIn('Past 7 Days', call.call_args_list[0].args[1]['instructions'])
            return result
    def test_sources_and_shots(self):
        result=self.result()
        with patch.object(n,'request',return_value=({'scenes':[{'item_index':0,'narration':'A development.','motion':'Show presenter.'}]},{})):
            output=n.storyboard({**result,'selected':[0],'seconds':5})
        self.assertEqual(output['scenes'][0]['sources'],self.item['sources'])
        self.assertEqual(output['scenes'][0]['seconds'],5)
    def test_unverified_source_rejected(self):
        with patch.object(n,'request',return_value=({'items':[self.item]},{'output':[]})):
            with self.assertRaises(n.ai.AssistantError): n.research({'prompt':'News','count':1})
    def test_tampered_results_rejected(self):
        result=self.result();result['research']['items'][0]['summary']='Altered'
        with self.assertRaises(n.ai.AssistantError): n.storyboard({**result,'selected':[0]})
    def test_duplicate_selection_rejected(self):
        with self.assertRaises(n.ai.AssistantError): n.storyboard({**self.result(),'selected':[0,0]})
    def test_missing_shot_rejected(self):
        result=self.result()
        with patch.object(n,'request',return_value=({'scenes':[]},{})):
            with self.assertRaises(n.ai.AssistantError): n.storyboard({**result,'selected':[0]})

if __name__=='__main__': unittest.main()
