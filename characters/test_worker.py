import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from characters import worker


class WorkerTest(unittest.TestCase):
    def test_child_environment_does_not_inherit_service_credentials(self):
        with tempfile.TemporaryDirectory() as root:
            base=Path(root)
            script=base/'check.py'
            script.write_text('import os,json\nfrom pathlib import Path\nPath("env.json").write_text(json.dumps({k:os.getenv(k) for k in ("ECCO_TEST_SECRET","HF_HUB_OFFLINE")}))')
            with patch.dict(os.environ, {'ECCO_TEST_SECRET':'test-only-do-not-forward'}):
                worker.run([sys.executable,str(script)],base,base,'Checking',timeout=10)
            result=json.loads((base/'env.json').read_text())
            self.assertIsNone(result['ECCO_TEST_SECRET'])
            self.assertEqual(result['HF_HUB_OFFLINE'],'1')

    def test_stop_terminates_only_the_child_and_cleans_process_record(self):
        with tempfile.TemporaryDirectory() as root:
            base=Path(root)
            def stop():
                for _ in range(100):
                    if (base/'process.json').exists():
                        (base/'cancel.json').write_text('{}');return
                    time.sleep(.01)
            thread=threading.Thread(target=stop);thread.start()
            with self.assertRaises(worker.Stopped):
                worker.run([sys.executable,'-c','import time;time.sleep(30)'],base,base,'Waiting',timeout=10)
            thread.join(timeout=2)
            self.assertFalse((base/'process.json').exists())

    def test_downloaded_files_without_qualification_are_not_ready(self):
        with tempfile.TemporaryDirectory() as root:
            file=Path(root)/'binary';file.write_text('fixture')
            config={k:str(file) for k in ('blender','trellis_python','trellis_root','trellis_weights','unirig_root','unirig_python')}
            self.assertFalse(any(worker.capabilities(config).values()))

    def test_unknown_engine_and_missing_local_encoder_fail_before_worker_start(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'config.json'
            for config in ({'trellis_engine':'remote-command'}, {'trellis_engine':'trellis1'}):
                path.write_text(json.dumps(config))
                with self.assertRaises(ValueError): worker.configuration(path)

    def test_missing_encoder_invalidates_qualified_reconstruction(self):
        with tempfile.TemporaryDirectory() as root:
            file=Path(root)/'binary';file.write_text('fixture')
            qualification=Path(root)/'qualification.json'
            config={k:str(file) for k in ('blender','trellis_python','trellis_root','trellis_weights')}
            config.update(trellis_engine='trellis1',qualification=str(qualification),
                          trellis_encoder_root=str(file),trellis_encoder_checkpoint=str(Path(root)/'missing'))
            qualification.write_text(json.dumps({'configuration':worker.config_signature(config),'model':True}))
            self.assertFalse(worker.capabilities(config)['model'])


if __name__=='__main__': unittest.main()
