import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

import deploy_voice_references as deploy

ROOT = Path(__file__).resolve().parent.parent


def at_commit(name):
    return subprocess.run(['git', 'show', deploy.SOURCE_COMMIT + ':' + name], cwd=ROOT, capture_output=True, check=True).stdout


class VoiceReferenceDeployment(unittest.TestCase):
    def test_hashes_match_the_reviewed_commit(self):
        for name, expected in {**deploy.MODULE, **deploy.DEPENDENCIES}.items():
            self.assertEqual(hashlib.sha256(at_commit(name)).hexdigest(), expected, name)

    def test_ships_the_new_modules(self):
        for name in ('backend/voice_references.py', 'audio/voice_refs.py', 'backend/audio_jobs.py', 'backend/storage_api.py'):
            self.assertIn(name, deploy.MODULE)

    def test_stale_dependencies_are_listed(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp)
            for name in deploy.DEPENDENCIES:
                (app / name).parent.mkdir(parents=True, exist_ok=True)
                (app / name).write_bytes(at_commit(name))
            self.assertEqual(deploy.stale_dependencies(app), [])
            (app / 'backend/audio_library.py').write_text('# older\n')
            self.assertEqual(deploy.stale_dependencies(app), ['backend/audio_library.py'])

    def test_with_deps_never_ships_the_legacy_module(self):
        self.assertEqual(set(deploy.configure(False)), set(deploy.MODULE))
        shipped = deploy.configure(True)
        self.assertNotIn('migration/legacy/studio.py', shipped)
        self.assertEqual(deploy.base.SOURCE_COMMIT, deploy.SOURCE_COMMIT)


if __name__ == '__main__':
    unittest.main()
