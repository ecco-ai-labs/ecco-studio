import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import longcat_jobs as jobs

class WorkerIsolation(unittest.TestCase):
    def test_other_pod_can_start_but_duplicate_cannot(self):
        with tempfile.TemporaryDirectory() as root, patch.object(jobs,'QUEUE',Path(root)):
            first=jobs.worker_lock('a100')
            second=jobs.worker_lock('b200')
            try:
                with self.assertRaises(BlockingIOError):
                    jobs.worker_lock('b200')
            finally:
                first.close()
                second.close()
            with jobs.worker_lock('b200'):
                pass

if __name__=='__main__': unittest.main()
