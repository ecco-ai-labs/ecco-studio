import json
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch
from audio_schema import validate
from audio_queue import availability, request_ready, write
from mixed_worker import processing_batches, synthesize
from queue_worker import worker_command

class FullRecording(TestCase):
    def request(self, count=241):
        return validate({'model':'indic-mio','compute':'cpu','lines':[{'text':(f'Passage {i}. '+('spoken word '*46))[:500],'voice':'en_male','language':'English','emotion':'neutral','pause_before':.4 if i%2 else 0} for i in range(count)]})

    def test_no_recording_character_or_turn_cap(self):
        request=self.request()
        self.assertEqual(len(request['lines']),241)
        self.assertGreater(sum(len(x['text']) for x in request['lines']),100000)
        self.assertEqual(request['long_form_version'],1)
        self.assertEqual(worker_command(request,Path('/tmp/test-chapter'))[0][1].split('/')[-1],'mixed_worker.py')

    def test_internal_batches_preserve_all_words_order_and_controls(self):
        lines=self.request()['lines'];batches=list(processing_batches(list(enumerate(lines))))
        self.assertGreater(len(batches),20)
        self.assertEqual([line for batch in batches for _,line in batch],lines)
        for batch in batches:
            self.assertLessEqual(len(batch),80)
            self.assertLessEqual(sum(len(line['text']) for _,line in batch),4000)

    def test_unupdated_worker_is_never_sent_an_unsupported_long_request(self):
        request=self.request();worker={'compute':'cpu','pod':'testcpu','models':['indic-mio'],'instance_routing_version':1}
        with patch('audio_queue.workers',return_value=[worker]):
            self.assertFalse(request_ready(request));self.assertEqual(availability()['compute']['cpu']['long_form_version'],0)
            worker['long_form_version']=1
            self.assertTrue(request_ready(request));self.assertEqual(availability()['compute']['cpu']['long_form_version'],1)

    def test_long_recording_children_feed_one_ordered_final_assembly(self):
        request=self.request(90);rendered=[];assembled=[]
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            def command(child,directory):
                rendered.append(child);write(directory/'output.timeline.json',[{'start':i,'end':i+1} for i in range(len(child['lines']))]);return ['synthetic-renderer'],{}
            class Process:
                returncode=0
                def __init__(self,*a,**kw):pass
                def poll(self):return 0
            with patch('queue_worker.worker_command',side_effect=command),patch('mixed_worker.subprocess.Popen',Process),patch('mixed_worker.stitch',side_effect=lambda r,s,o:assembled.append((r,s))):
                synthesize(request,root/'output.wav',root)
            self.assertEqual([l['text'] for child in rendered for l in child['lines']],[l['text'] for l in request['lines']])
            self.assertTrue(all(not child.get('long_form_version') for child in rendered))
            self.assertEqual(len(assembled),1)
            self.assertEqual(assembled[0][0],request)
            self.assertEqual(len(assembled[0][1]),90)
            self.assertTrue(all(part is not None for part in assembled[0][1]))
