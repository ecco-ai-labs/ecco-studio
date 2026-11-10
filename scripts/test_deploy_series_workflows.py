import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

import deploy_series_workflows as deploy

ROOT = Path(__file__).resolve().parent.parent


class SeriesDeployment(unittest.TestCase):
    def test_hashes_match_the_reviewed_commit(self):
        for name, expected in {**deploy.MODULE, **deploy.DEPENDENCIES}.items():
            content = subprocess.run(['git', 'show', deploy.SOURCE_COMMIT + ':' + name], cwd=ROOT,
                                     capture_output=True, check=True).stdout
            self.assertEqual(hashlib.sha256(content).hexdigest(), expected, name)

    def test_stale_dependencies_are_listed(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp)
            (app / 'backend').mkdir()
            for name in deploy.DEPENDENCIES:
                content = subprocess.run(['git', 'show', deploy.SOURCE_COMMIT + ':' + name], cwd=ROOT,
                                         capture_output=True, check=True).stdout
                (app / name).write_bytes(content)
            self.assertEqual(deploy.stale_dependencies(app), [])
            (app / 'backend/audio_jobs.py').write_text('# older\n')
            self.assertEqual(deploy.stale_dependencies(app), ['backend/audio_jobs.py'])

    def test_configure_limits_files_unless_with_deps(self):
        self.assertEqual(set(deploy.configure(False)), set(deploy.MODULE))
        self.assertEqual(set(deploy.configure(True)), set(deploy.MODULE) | set(deploy.DEPENDENCIES))
        self.assertEqual(deploy.base.SOURCE_COMMIT, deploy.SOURCE_COMMIT)


if __name__ == '__main__':
    unittest.main()
