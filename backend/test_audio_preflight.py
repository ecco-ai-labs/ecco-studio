import copy
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import wave
sys.path[:0]=[str(Path(__file__).parent),str(Path(__file__).parents[1]/'audio')]
import audio_preflight as preflight
import audio_jobs
from preflight_resources import snapshot

class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.data=self.root/'data';self.data.mkdir();self.queue=self.root/'queue';self.queue.mkdir()
        self.patch=patch.object(audio_jobs.queue,'ROOT',self.queue);self.patch.start()
        with sqlite3.connect(self.data/'studio.sqlite') as db:db.execute('CREATE TABLE records (id TEXT)')
        self.records={};self.env=dict(Problem=ValueError,DATA=self.data,story_id=lambda body:'story',records=lambda kind:[v for v in self.records.values() if v.get('kind')==kind],get=lambda id,kind:self.records[id])
        self.body={'speech':{'compute':'cpu','worker_id':'large','model':'chatterbox','lines':[{'text':'Welcome to our story.','voice':'default','language':'English'}]},'sounds':[],'existing_soundtrack':[]}
        self.worker={'updated':time.time(),'pod':'large','name':'Large CPU','compute':'cpu','models':['chatterbox','kokoro'],'instance_routing_version':1,'mixed_models_version':1,'character_controls_version':1,'sound_design_version':1,'sound_generation_version':1,'sound_models':['moss-soundeffect-v2'],'resources':dict(version=1,checked_at=time.time(),memory_total_bytes=64*preflight.GIB,memory_available_bytes=32*preflight.GIB,queue_free_bytes=20*preflight.GIB,temporary_free_bytes=10*preflight.GIB,ffmpeg=True,ffprobe=True)}
        self.beat()
    def tearDown(self):self.patch.stop();self.temp.cleanup()
    def beat(self):audio_jobs.queue.write(self.queue/'worker-large.json',self.worker)
    def run_checks(self):return preflight.verify(self.body,self.env)
    def checks(self):return {c['id']:c for c in self.run_checks()['checks']}
    def test_pass_creates_no_jobs_assets_or_database_rows(self):
        before={str(p.relative_to(self.root)) for p in self.root.rglob('*')};report=self.run_checks();self.assertTrue(report['ready']);self.assertFalse(report['generates_audio']);self.assertFalse(self.records)
        self.assertEqual(before,{str(p.relative_to(self.root)) for p in self.root.rglob('*')})
        with sqlite3.connect(self.data/'studio.sqlite') as db:self.assertEqual(db.execute('SELECT count(*) FROM records').fetchone()[0],0)
    def test_wrong_worker_never_uses_another_healthy_instance(self):
        self.body['speech']['worker_id']='small';checks=self.checks();self.assertEqual(checks['compute']['status'],'failed');self.assertEqual(checks['memory']['status'],'blocked')
    def test_stale_resources_are_unverified_not_green(self):
        self.worker['resources']['checked_at']-=60;self.beat();self.assertEqual(self.checks()['memory']['status'],'unverified')
        self.worker.pop('resources');self.beat();self.assertEqual(self.checks()['worker_storage']['status'],'unverified')
    def test_sounds_require_model_and_memory_and_correct_worker(self):
        self.body['sounds']=[dict(model='moss-soundeffect-v2',kind='effect',description='A lunch bell',duration=3,title='Lunch Bell',compute='cpu',worker_id='large')]
        self.worker['resources']['memory_total_bytes']=8*preflight.GIB;self.worker['sound_models']=[];self.beat();checks=self.checks();self.assertEqual(checks['models']['status'],'failed');self.assertEqual(checks['memory']['status'],'failed')
        self.body['sounds'][0]['worker_id']='other';self.assertEqual(self.checks()['sound-0']['status'],'failed')
    def test_empty_memory_and_disk_space_fail(self):
        self.worker['resources']['memory_available_bytes']=0;self.worker['resources']['temporary_free_bytes']=0;self.beat();checks=self.checks();self.assertEqual(checks['memory']['status'],'failed');self.assertEqual(checks['worker_storage']['status'],'failed')
    def test_model_voice_language_and_control_mismatch(self):
        self.body['speech']['lines'][0]['voice']='invalid';self.assertEqual(self.checks()['script']['status'],'failed')
        self.body['speech']['lines'][0].update(voice='default',model='indic-parler');self.assertEqual(self.checks()['script']['status'],'failed')
        self.body['speech']['lines'][0].update(model='chatterbox',pitch=10);self.assertEqual(self.checks()['script']['status'],'failed')
    def test_missing_reference_file_is_reported(self):
        self.body['speech']['lines'][0].update(model='kokoro',voice='af_heart');checks=self.checks();self.assertEqual(checks['voices']['status'],'failed');self.assertIn('reference file',checks['voices']['detail'])
    def test_existing_sound_must_be_decodable_and_not_escape_workspace(self):
        track=dict(asset_id='bell',kind='effect',start_line=0,end_line=0);self.body['existing_soundtrack']=[track]
        self.records['bell']=dict(id='bell',kind='asset',media='audio',path='bell.wav')
        with wave.open(str(self.data/'bell.wav'),'wb') as f:f.setparams((1,2,24000,0,'NONE','not compressed'));f.writeframes(b'\0\0'*2400)
        self.assertEqual(self.checks()['assets']['status'],'passed')
        (self.data/'bell.wav').write_text('not audio');self.assertEqual(self.checks()['assets']['status'],'failed')
        self.records['bell']['path']='../outside.wav';self.assertEqual(self.checks()['assets']['status'],'failed')
    def test_full_queue_and_unwritable_storage_fail_independently(self):
        self.records={str(i):dict(kind='audio_job',status='running') for i in range(4)}
        with patch.object(preflight.tempfile,'TemporaryFile',side_effect=PermissionError('Storage is not writable')):
            checks=self.checks();self.assertEqual(checks['storage']['status'],'failed');self.assertEqual(checks['queue']['status'],'failed')
    def test_real_resource_snapshot_contains_no_credentials_or_paths(self):
        report=snapshot(self.queue);self.assertEqual(report['version'],1);self.assertGreater(report['memory_total_bytes'],0);self.assertGreaterEqual(report['memory_available_bytes'],0);self.assertTrue(report['ffmpeg']);self.assertNotIn('path',json.dumps(report))
if __name__=='__main__':unittest.main()
