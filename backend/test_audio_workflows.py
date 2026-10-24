import copy
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0,str(Path(__file__).parent))
import audio_workflows as workflows
import audio_jobs

class Problem(Exception):
    def __init__(self,message,code=400):
        self.message,self.code=message,code
        super().__init__(message)

class AudioWorkflowsTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.data=Path(self.tmp.name);self.rows={}
        self.env=dict(DATA=self.data,LOCK=threading.RLock(),Problem=Problem,
            records=lambda kind=None:[copy.deepcopy(r) for r in self.rows.values() if kind is None or r['kind']==kind],
            save=self.save,get=lambda rid,kind:copy.deepcopy(self.rows[rid]),story_id=lambda b:b.get('story_id'))
        self.base={'id':uuid.uuid4().hex,'name':'Weekend news','source_mode':'news','prompt':'Verified science news',
            'time':'05:00','timezone':'Asia/Kolkata','start_date':'2026-10-24','repeat':'daily','end_mode':'never','count':1,
            'audio_snapshot':{'model':'indic-mio','compute':'cpu','genre':'News','presentation':'single','character_count':1,
                'speakers':[{'id':'host','name':'Host','voice':'en_female','language':'Hindi','emotion':'happy'}],
                'speed':1.25,'pitch':2,'pause':0.35,'script_brief':{'turns':2}}}
        self.clock=patch.object(workflows,'now',return_value=datetime(2026,10,24,0,0,tzinfo=timezone.utc));self.clock.start()
        self.started=patch.object(workflows,'STARTED',True);self.started.start()
        self.ai=patch.object(workflows.openai_assistant,'status',return_value={'enabled':True});self.ai.start()
        self.ready=patch.object(audio_jobs.queue,'availability',return_value={'compute':{'cpu':{'ready':True,'models':['indic-mio']}}});self.ready.start()
        self.research=patch.object(workflows.news_research,'research',return_value={'research':{'items':[{'title':'Verified headline','summary':'Supported fact','sources':[{'url':'https://example.org/source'}]}]}}).start()
        self.writer=patch.object(workflows.openai_assistant,'enhance',side_effect=self.plan).start()
        self.old_root=audio_jobs.queue.ROOT;audio_jobs.queue.ROOT=self.data/'queue'
        self.status=patch.object(audio_jobs,'job_status',side_effect=self.job_status).start()
        self.audio_done=False
    def tearDown(self):
        patch.stopall();audio_jobs.queue.ROOT=self.old_root;self.tmp.cleanup()
    def save(self,r):
        self.rows[r['id']]=copy.deepcopy(r);return copy.deepcopy(r)
    def plan(self,body,env):
        import json
        cast=body['context']['lines']
        turns=2 if len(cast)==2 else 1
        return {'questions':[],'revisions':[{'id':'audio_plan','text':json.dumps({'opening':None,'segments':[{'character_id':cast[i%len(cast)]['id'],'text':'नमस्ते।'} for i in range(turns)]})}]}
    def job_status(self,jid,env):
        return {'id':jid,'status':'done','asset_id':'asset-'+jid} if self.audio_done else {'id':jid,'status':'running','progress':'Speaking'}
    def workflow(self,**changes):
        return workflows.save({**copy.deepcopy(self.base),**changes},self.env)
    def trigger(self,w):
        return workflows.control({'id':w['id'],'action':'run','request_id':uuid.uuid4().hex},self.env)
    def record(self,kind): return self.env['records'](kind)[0]

    def test_timezone_weekdays_weekly_and_dst(self):
        w={**self.base,'timezone':'America/Los_Angeles','time':'02:30','start_date':'2026-03-08'}
        due=workflows.next_due(w,datetime(2026,3,8,0,tzinfo=timezone.utc))
        self.assertEqual(due,'2026-03-09T09:30:00+00:00')
        w.update(time='01:30',start_date='2026-11-01')
        self.assertEqual(workflows.next_due(w,datetime(2026,11,1,8,31,tzinfo=timezone.utc)),'2026-11-02T09:30:00+00:00')
        w.update(timezone='UTC',time='05:00',start_date='2026-10-24',repeat='weekdays')
        self.assertEqual(workflows.next_due(w,datetime(2026,10,24,tzinfo=timezone.utc)),'2026-10-26T05:00:00+00:00')
        w['repeat']='weekly'
        self.assertEqual(workflows.next_due(w,datetime(2026,10,24,6,tzinfo=timezone.utc)),'2026-10-31T05:00:00+00:00')

    def test_saving_does_not_activate_and_enable_requires_running_service(self):
        w=self.workflow();self.assertEqual(w['status'],'paused');self.assertIsNone(w['next_run'])
        with patch.object(workflows,'STARTED',False),self.assertRaises(Problem):
            workflows.control({'id':w['id'],'action':'enable'},self.env)
        w=workflows.control({'id':w['id'],'action':'enable'},self.env)
        self.assertEqual(w['status'],'active');self.assertEqual(w['next_run'],'2026-10-24T23:30:00+00:00')

    def test_news_run_researches_then_saves_one_audio_job_and_limits_runs(self):
        w=self.workflow(end_mode='runs',run_count=1);self.trigger(w);workflows.tick(self.env)
        self.assertEqual(self.research.call_count,1);self.assertEqual(self.writer.call_count,1)
        job=self.record('audio_job');self.assertEqual(job['request']['compute'],'cpu')
        self.assertEqual(job['request']['pitch'],2);self.assertEqual(job['request']['speed'],1.25)
        self.assertEqual(job['request']['lines'][0]['emotion'],'happy')
        for _ in range(3): workflows.tick(self.env)
        self.assertEqual(len(self.env['records']('audio_job')),1);self.assertEqual(self.writer.call_count,1)
        self.audio_done=True;workflows.tick(self.env)
        self.assertEqual(self.record('audio_workflow_run')['status'],'done')
        self.assertEqual(self.record('workflow')['status'],'complete');self.assertEqual(self.record('workflow')['completed_runs'],1)

    def test_podcast_same_voice_keeps_two_characters(self):
        setup=copy.deepcopy(self.base['audio_snapshot']);setup.update(genre='Podcast',presentation='conversation',character_count=2)
        setup['speakers'].append({**setup['speakers'][0],'id':'guest','name':'Guest','emotion':'neutral'})
        w=self.workflow(source_mode='podcast',audio_snapshot=setup,prompt='Discuss this paper',count=2);self.trigger(w);workflows.tick(self.env)
        self.assertEqual(self.research.call_count,0)
        self.assertEqual([s['id'] for s in self.writer.call_args.args[0]['context']['lines']],['host','guest'])
        self.assertEqual([l['emotion'] for l in self.record('audio_job')['request']['lines']],['happy','neutral'])

    def test_chapter_advances_only_after_saved_audio_and_stops_at_end(self):
        w=self.workflow(source_mode='chapters',next_chapter=1,total_chapters=2,chapters=['First chapter','Second chapter'])
        self.trigger(w);workflows.tick(self.env);self.assertEqual(self.record('workflow')['next_chapter'],1)
        self.audio_done=True;workflows.tick(self.env);self.assertEqual(self.record('workflow')['next_chapter'],2)
        self.trigger(self.record('workflow'));workflows.tick(self.env)
        self.assertEqual(self.record('workflow')['next_chapter'],3);self.assertEqual(self.record('workflow')['status'],'complete')
        self.assertEqual(self.research.call_count,0)

    def test_unavailable_compute_waits_without_ai_or_fallback(self):
        w=self.workflow();self.trigger(w)
        with patch.object(audio_jobs.queue,'availability',return_value={'compute':{'cpu':{'ready':False,'models':[]}}}):
            workflows.tick(self.env);workflows.tick(self.env)
        self.assertEqual(self.record('audio_workflow_run')['status'],'waiting');self.assertFalse(self.writer.called);self.assertFalse(self.research.called)
        workflows.tick(self.env);self.assertEqual(len(self.env['records']('audio_job')),1)

    def test_interrupted_ai_pauses_without_paid_retry(self):
        w=self.workflow();self.trigger(w);r=self.record('audio_workflow_run');r['status']='writing';self.save(r)
        workflows.tick(self.env);self.assertFalse(self.writer.called)
        self.assertEqual(self.record('workflow')['status'],'paused');self.assertIn('restarted',self.record('audio_workflow_run')['error'])

    def test_restart_after_queue_submission_does_not_duplicate_job(self):
        w=self.workflow();self.trigger(w);r=self.record('audio_workflow_run');workflows.prepare(r,self.env)
        jid=uuid.uuid5(uuid.NAMESPACE_URL,'ecco-audio-job:'+r['id']).hex
        audio_jobs.generate(r['request'],self.env,job_id=jid)
        # Simulate restart before job_id was saved into the workflow run.
        workflows.tick(self.env);workflows.tick(self.env)
        self.assertEqual(len(self.env['records']('audio_job')),1);self.assertEqual(self.record('audio_workflow_run')['job_id'],jid)

    def test_repeated_due_tick_and_recovery_after_final_save_are_idempotent(self):
        w=self.workflow();w.update(status='active',schedule_requested=True,next_run='2026-10-23T23:30:00+00:00');self.save(w)
        workflows.tick(self.env);workflows.tick(self.env);self.assertEqual(len(self.env['records']('audio_workflow_run')),1)
        r=self.record('audio_workflow_run');r.update(status='done',asset_id='saved');self.save(r)
        workflows.tick(self.env);workflows.tick(self.env)
        self.assertEqual(self.record('workflow')['completed_runs'],1);self.assertEqual(len(self.env['records']('audio_workflow_run')),1)

    def test_malformed_ai_output_never_reaches_audio_and_pauses(self):
        w=self.workflow();self.trigger(w)
        self.writer.side_effect=None;self.writer.return_value={'questions':[],'revisions':[{'id':'audio_plan','text':'{"segments":[{"character_id":"intruder","text":"test"}]}'}]}
        workflows.tick(self.env);self.assertFalse(self.env['records']('audio_job'));self.assertEqual(self.record('workflow')['status'],'paused')

    def test_saving_or_second_run_cannot_change_an_active_run(self):
        w=self.workflow();self.trigger(w)
        with self.assertRaises(Problem): self.workflow()
        with self.assertRaises(Problem): self.trigger(w)
        workflows.control({'id':w['id'],'action':'pause'},self.env)
        self.assertIsNone(self.record('workflow')['next_run'])

    def test_unreadable_script_is_retained_and_no_paid_retry_occurs(self):
        w=self.workflow();self.trigger(w)
        self.writer.side_effect=None;self.writer.return_value={'questions':[],'revisions':[{'id':'audio_plan','text':'not JSON'}]}
        workflows.tick(self.env);workflows.tick(self.env)
        r=self.record('audio_workflow_run')
        self.assertEqual(r['script_response'],'not JSON');self.assertIn('unreadable audio script',r['error'])
        self.assertEqual(self.writer.call_count,1);self.assertFalse(self.env['records']('audio_job'))

    def test_fenced_script_and_non_object_script(self):
        w=self.workflow();self.trigger(w)
        response=self.plan({'context':{'lines':self.base['audio_snapshot']['speakers']}},self.env)
        response['revisions'][0]['text']='```JSON\n'+response['revisions'][0]['text']+'\n```'
        self.writer.side_effect=None;self.writer.return_value=response;workflows.tick(self.env)
        self.assertEqual(len(self.env['records']('audio_job')),1)
        self.audio_done=True;workflows.tick(self.env);self.trigger(w)
        response['revisions'][0]['text']='[]';workflows.tick(self.env)
        r=self.env['records']('audio_workflow_run')[-1]
        self.assertIn('invalid audio script object',r['error']);self.assertEqual(len(self.env['records']('audio_job')),1)

    def test_schema_and_foreign_record_are_rejected(self):
        with self.assertRaises(Problem): self.workflow(timezone='Invalid/Zone')
        with self.assertRaises(Problem): self.workflow(source_mode='chapters',total_chapters=2,chapters=['Only one'])
        self.rows[self.base['id']]={'id':self.base['id'],'kind':'asset'}
        with self.assertRaises(Problem): self.workflow()

if __name__=='__main__': unittest.main()
