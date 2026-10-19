import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from library_rename import rename


class Problem(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


class RenameTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = {'DATA': self.root, 'LOCK': threading.RLock(), 'Problem': Problem}
        with sqlite3.connect(self.root / 'studio.sqlite') as db:
            db.execute('CREATE TABLE records (id TEXT PRIMARY KEY, kind TEXT, body TEXT)')
        self.put('a', 'image_folder', name='People')
        self.put('b', 'image_folder', name='People / Old man')
        self.put('c', 'library_item', asset_id='image1', folder_id='b')

    def put(self, id, kind, **kw):
        row = dict(id=id, kind=kind, **kw)
        with sqlite3.connect(self.root / 'studio.sqlite') as db:
            db.execute('INSERT INTO records VALUES (?,?,?)', (id, kind, json.dumps(row)))

    def read(self):
        with sqlite3.connect(self.root / 'studio.sqlite') as db:
            return {r['id']: r for (text,) in db.execute('SELECT body FROM records') for r in [json.loads(text)]}

    def change(self, **kw):
        return rename(dict(id='a', name='Characters', expected_name='People', **kw), self.env)

    def test_nested_rename_preserves_ids_memberships(self):
        before = self.read()['c']
        self.assertEqual(self.change()['updated'], 2)
        rows = self.read()
        self.assertEqual(rows['b']['name'], 'Characters / Old man')
        self.assertEqual(rows['c'], before)

    def test_collision_rolls_back_entire_subtree(self):
        self.put('d', 'image_folder', name='Characters / Old man', deleted=True)
        before = self.read()
        with self.assertRaises(Problem): self.change()
        self.assertEqual(self.read(), before)

    def test_stale_write_and_empty_name_rejected(self):
        for name, expected in [('', 'People'), ('New', 'Stale'), ('A/B', 'People')]:
            with self.assertRaises(Problem):
                rename(dict(id='a', name=name, expected_name=expected), self.env)
        self.assertEqual(self.read()['a']['name'], 'People')

    def test_audio_and_story(self):
        self.put('d', 'audio_folder', name='Audio / Voices')
        self.put('e', 'story', title='A story')
        rename(dict(id='d', name='Narrators', expected_name='Audio / Voices'), self.env)
        rename(dict(id='e', name='New story', expected_name='A story'), self.env)
        self.assertEqual(self.read()['d']['name'], 'Audio / Narrators')
        self.assertEqual(self.read()['e']['title'], 'New story')


if __name__ == '__main__':
    unittest.main()
