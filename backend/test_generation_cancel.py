import copy
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).parent), str(Path(__file__).parents[1]/'audio'), str(Path(__file__).parents[1]/'video')]
import audio_jobs
import queue_worker
import generation_cancel
import longcat_jobs
import audio_video_sequence


class CancellationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.rows = {}
        self.env = dict(get=lambda jid, kind=None: copy.deepcopy(self.rows[jid]),
                        save=lambda row: self.rows.update({row['id']:copy.deepcopy(row)}), DATA=self.root)
        self.patches = [patch.object(audio_jobs.queue,'ROOT',self.root/'audio'),
                        patch.object(longcat_jobs,'QUEUE',self.root/'video'),
                        patch.object(longcat_jobs,'ROOT',self.root/'longcat')]
        for p in self.patches: p.start()
    def tearDown(self):
        for p in self.patches: p.stop()
        self.temp.cleanup()
    def audio(self, status):
        self.rows['a'] = dict(id='a',kind='audio_job',status='running')
        audio_jobs.queue.write(audio_jobs.queue.ROOT/'a'/'status.json',dict(status=status))
    def test_queued_cancel_never_starts_inference(self):
        self.audio('queued')
        directory=audio_jobs.queue.ROOT/'a'
        audio_jobs.queue.write(directory/'request.json',dict(compute='cpu',model='indic-mio'))
        self.assertEqual(audio_jobs.cancel('a',self.env)['status'],'cancelled')
        with queue_worker.claim_job(directory,'cpu','worker',['indic-mio'],[]) as request:
            self.assertIsNone(request)
        self.assertEqual(audio_jobs.cancel('a',self.env)['status'],'cancelled')
    def test_running_waits_for_worker_and_discards_late_output(self):
        self.audio('running')
        self.assertEqual(audio_jobs.cancel('a',self.env)['status'],'cancelling')
        audio_jobs.queue.write(audio_jobs.queue.ROOT/'a'/'status.json',dict(status='complete'))
        self.assertEqual(audio_jobs.job_status('a',self.env)['status'],'cancelled')
        self.assertEqual(list(self.rows),['a'])
    def test_completed_asset_wins_race_and_is_retained(self):
        self.rows['a']=dict(id='a',kind='audio_job',status='done',asset_id='saved')
        self.assertEqual(audio_jobs.cancel('a',self.env)['asset_id'],'saved')
        self.assertFalse((audio_jobs.queue.ROOT/'a'/'cancel.json').exists())
    def test_stop_running_process_group_leaves_unrelated_process_alive(self):
        unrelated=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'])
        child_file=self.root/'child.pid'; marker=self.root/'cancel.json'
        code='import subprocess,sys,time,pathlib;p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"]);pathlib.Path(sys.argv[1]).write_text(str(p.pid));time.sleep(30)'
        def stop():
            deadline=time.monotonic()+5
            while not child_file.exists() and time.monotonic()<deadline: time.sleep(.02)
            marker.write_text('{}')
        thread=threading.Thread(target=stop);thread.start()
        try:
            with self.assertRaises(generation_cancel.Cancelled):
                generation_cancel.run(self.root,[sys.executable,'-c',code,str(child_file)],timeout=8)
            thread.join();self.assertIsNone(unrelated.poll())
            pid=child_file.read_text();stat=Path('/proc')/pid/'stat'
            self.assertTrue(not stat.exists() or stat.read_text().split(') ')[1].startswith('Z'))
        finally:
            unrelated.terminate();unrelated.wait();thread.join()
    def test_longcat_cancel_prevents_final_asset_commit(self):
        self.rows['v']=dict(id='v',kind='longcat_job',status='running')
        longcat_jobs.write(longcat_jobs.QUEUE/'v'/'status.json',dict(status='running'))
        self.assertEqual(longcat_jobs.cancel('v',self.env)['status'],'cancelling')
        longcat_jobs.write(longcat_jobs.QUEUE/'v'/'status.json',dict(status='complete'))
        longcat_jobs.finalize(self.rows['v'],self.env)
        self.assertEqual(self.rows['v']['status'],'cancelled');self.assertEqual(len(self.rows),1)
    def test_sequence_stops_current_child_and_never_submits_next(self):
        self.rows.update(p=dict(id='p',kind='audio_video_job',status='running',children=['v'],request={'clips':[{},{}]}),v=dict(id='v',kind='longcat_job',status='running'))
        longcat_jobs.write(longcat_jobs.QUEUE/'v'/'status.json',dict(status='running'))
        with patch.object(longcat_jobs,'generate') as generate:
            self.assertEqual(audio_video_sequence.cancel('p',self.env)['status'],'cancelling')
            self.assertTrue((longcat_jobs.QUEUE/'v'/'cancel.json').exists())
            longcat_jobs.write(longcat_jobs.QUEUE/'v'/'status.json',dict(status='cancelled'))
            audio_video_sequence.advance(self.rows['p'],self.env)
            self.assertEqual(self.rows['p']['status'],'cancelled')
            self.assertEqual(self.rows['p']['children'],['v']);generate.assert_not_called()


if __name__ == '__main__': unittest.main()
