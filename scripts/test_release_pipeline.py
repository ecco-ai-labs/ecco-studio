import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch
import build_release
import publish_release
import dev_preview

SHA='a'*40


class PipelineTest(unittest.TestCase):
    def test_public_build_is_complete_and_excludes_services_and_tests(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'build'
            manifest=build_release.build(output,SHA,'42')
            publish_release.validate_bundle(output,SHA,'42')
            self.assertIn('index.html',manifest['files'])
            self.assertIn('desk/desk-app.mjs',manifest['files'])
            self.assertFalse(any(p.startswith(('backend/','qa/','scripts/','migration/')) or '.test.' in p for p in manifest['files']))
            (output/'index.html').write_text('changed after tests')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):
                publish_release.validate_bundle(output,SHA,'42')

    def test_source_run_and_extra_files_cannot_be_substituted(self):
        with tempfile.TemporaryDirectory() as directory:
            build_release.build(directory,SHA,'42')
            with self.assertRaisesRegex(ValueError,'provenance'):
                publish_release.validate_bundle(directory,'b'*40,'42')
            (Path(directory)/'injected.js').write_text('unexpected')
            with self.assertRaisesRegex(ValueError,'Unexpected'):
                publish_release.validate_bundle(directory,SHA,'42')

    def test_only_successful_main_push_checks_qualify(self):
        run=dict(id=42,head_sha=SHA,head_branch='main',event='push',conclusion='success',status='completed',path='.github/workflows/release-checks.yml')
        publish_release.validate_run(run,SHA,'42')
        for change in [dict(head_sha='b'*40),dict(event='pull_request'),dict(head_branch='other'),dict(conclusion='failure'),dict(path='.github/workflows/other.yml')]:
            with self.assertRaises(ValueError): publish_release.validate_run({**run,**change},SHA,'42')

    def test_artifact_path_traversal_is_rejected(self):
        data=io.BytesIO()
        with zipfile.ZipFile(data,'w') as archive: archive.writestr('../outside','unsafe')
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError,'Unsafe'):
                publish_release.extract_archive(data.getvalue(),directory)

    def test_preview_retains_earlier_exact_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            build_release.build(root/'first',SHA,'41')
            dev_preview.assemble(root/'first',root/'empty',root/'previous')
            build_release.build(root/'second','b'*40,'42')
            dev_preview.assemble(root/'second',root/'previous',root/'current')
            self.assertEqual(json.loads((root/'current/previews'/SHA/'release.json').read_text())['sha'],SHA)
            self.assertEqual(json.loads((root/'current/release.json').read_text())['sha'],'b'*40)
            dev_preview.assemble(root/'first',root/'current',root/'out-of-order')
            self.assertEqual(json.loads((root/'out-of-order/release.json').read_text())['sha'],'b'*40)


if __name__=='__main__': unittest.main()
