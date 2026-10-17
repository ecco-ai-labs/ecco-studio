import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from export_workspace import export


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        with sqlite3.connect(self.source / 'studio.sqlite') as db:
            db.execute('CREATE TABLE records(id TEXT PRIMARY KEY, kind TEXT, body TEXT)')

    def asset(self, path):
        with sqlite3.connect(self.source / 'studio.sqlite') as db:
            db.execute('INSERT INTO records VALUES (?,?,?)', ('asset1', 'asset', json.dumps({'path': path})))

    def test_exports_media_and_database_without_credentials(self):
        (self.source / 'image-dev').mkdir()
        (self.source / 'image-dev/a.png').write_bytes(b'test-media')
        (self.source / 'youtube-token.json').write_text('private')
        self.asset('image-dev/a.png')
        result = export(self.source, self.root / 'export')
        self.assertEqual(result['records'], {'asset': 1})
        self.assertEqual(len(result['files']), 1)
        self.assertFalse((self.root / 'export/youtube-token.json').exists())
        self.assertTrue((self.source / 'image-dev/a.png').exists())

    def test_missing_asset_fails_without_complete_manifest(self):
        self.asset('image-dev/missing.png')
        with self.assertRaises(ValueError):
            export(self.source, self.root / 'export')
        self.assertFalse((self.root / 'export/manifest.json').exists())

    def test_traversal_is_rejected(self):
        self.asset('../outside')
        with self.assertRaises(ValueError):
            export(self.source, self.root / 'export')

    def test_existing_destination_is_never_overwritten(self):
        destination = self.root / 'export'
        destination.mkdir()
        with self.assertRaises(FileExistsError):
            export(self.source, destination)

    def test_destination_cannot_be_inside_source(self):
        with self.assertRaises(ValueError):
            export(self.source, self.source / 'export')


if __name__ == '__main__':
    unittest.main()
