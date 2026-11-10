import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import deploy_auto_series as deploy
import deploy_series_workflows
import deploy_voice_references

ROOT = Path(__file__).resolve().parent.parent


def show(name):
    return subprocess.run(['git', 'show', deploy.SOURCE_COMMIT + ':' + name], cwd=ROOT, capture_output=True, check=True).stdout


class AutoSeriesDeployment(unittest.TestCase):
    def test_hashes_match_the_reviewed_commit(self):
        for name, expected in {**deploy.MODULE, **deploy.DEPENDENCIES}.items():
            self.assertEqual(hashlib.sha256(show(name)).hexdigest(), expected, name)

    def test_one_deploy_covers_series_labels_and_voice_references(self):
        shipped = set(deploy.MODULE) | set(deploy.DEPENDENCIES)
        self.assertLessEqual(set(deploy_series_workflows.MODULE) | set(deploy_voice_references.MODULE), set(deploy.MODULE))
        self.assertLessEqual(set(deploy_series_workflows.DEPENDENCIES) | set(deploy_voice_references.DEPENDENCIES), shipped)
        self.assertLessEqual({'backend/auto_series.py', 'audio/listen_worker.py', 'audio/queue_worker.py', 'backend/storage_api.py'}, set(deploy.MODULE))
        self.assertFalse(set(deploy.MODULE) & set(deploy.DEPENDENCIES))

    def test_every_repo_module_the_shipped_files_import_is_listed(self):
        local = {p.stem: str(p.relative_to(ROOT)) for d in ('audio', 'backend') for p in (ROOT / d).glob('*.py')}
        listed = set(deploy.MODULE) | set(deploy.DEPENDENCIES)
        import ast
        for name in deploy.MODULE:
            tree = ast.parse(show(name))
            for node in ast.walk(tree):
                names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module] if isinstance(node, ast.ImportFrom) and node.module else []
                for module in names:
                    path = local.get(module.split('.')[0])
                    if path and not Path(path).name.startswith('test_'):
                        self.assertIn(path, listed, name + ' imports ' + module)

    def test_stale_dependencies_are_listed(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp)
            for name in deploy.DEPENDENCIES:
                (app / name).parent.mkdir(parents=True, exist_ok=True)
                (app / name).write_bytes(show(name))
            self.assertEqual(deploy.stale_dependencies(app), [])
            (app / 'backend/news_research.py').write_text('# older\n')
            self.assertEqual(deploy.stale_dependencies(app), ['backend/news_research.py'])

    def test_configure_limits_files_unless_with_deps_and_guards_episodes(self):
        original = deploy.base.assert_idle
        try:
            self.assertEqual(set(deploy.configure(False)), set(deploy.MODULE))
            hashes = deploy.configure(True)
            self.assertEqual(set(hashes), set(deploy.MODULE) | {k for k in deploy.DEPENDENCIES if not k.startswith('migration/')})
            self.assertEqual(deploy.base.SOURCE_COMMIT, deploy.SOURCE_COMMIT)
            self.assertIs(deploy.base.assert_idle, deploy.assert_idle)
        finally:
            deploy.base.assert_idle = original

    def test_working_automatic_episode_stops_the_deploy(self):
        with tempfile.TemporaryDirectory() as temp:
            database = Path(temp) / 'studio.sqlite'
            with sqlite3.connect(database) as db:
                db.execute('CREATE TABLE records (id TEXT, kind TEXT, body TEXT)')
                db.execute('INSERT INTO records VALUES (?,?,?)', ('e1', 'auto_episode', json.dumps({'status': 'held'})))
            with patch.object(deploy.base, 'DATABASE', database), patch.object(deploy, '_base_idle', lambda: None):
                deploy.assert_idle()
                with sqlite3.connect(database) as db:
                    db.execute('INSERT INTO records VALUES (?,?,?)', ('e2', 'auto_episode', json.dumps({'status': 'working'})))
                with self.assertRaises(RuntimeError) as stopped:
                    deploy.assert_idle()
                self.assertIn('e2', str(stopped.exception))


if __name__ == '__main__':
    unittest.main()
