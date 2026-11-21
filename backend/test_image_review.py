"""Review links (IMG-4.4): only the shared pictures are reachable, comments are pinned and checked, links end."""
import sys, time, unittest, uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import image_review as R


class Problem(Exception):
    def __init__(self, message, code=400):
        super().__init__(message); self.message, self.code = message, code


def store():
    db = {}
    def get(rid, kind=None):
        if rid not in db: raise Problem('Record not found', 404)
        if kind and db[rid]['kind'] != kind: raise Problem('Wrong record type')
        return dict(db[rid])
    L = {'Problem': Problem, 'get': get, 'save': lambda r: db.__setitem__(r['id'], dict(r)) or r,
         'records': lambda kind=None: [dict(r) for r in db.values() if not kind or r['kind'] == kind],
         'new': lambda kind, **kw: dict(id=uuid.uuid4().hex, kind=kind, created=time.time(), **kw),
         'asset_path': lambda a: Path('/data') / a['path']}
    for i in range(3):
        db[f'a{i}'] = {'id': f'a{i}', 'kind': 'asset', 'media': 'image', 'title': f'Pic {i}', 'path': f'image-dev/a{i}.png'}
    db['gone'] = {'id': 'gone', 'kind': 'asset', 'media': 'image', 'deleted': True, 'path': 'x.png'}
    return db, L


class Review(unittest.TestCase):
    def test_create_share_and_read_only_those_pictures(self):
        db, L = store()
        made = R.create({'asset_ids': ['a0', 'a1'], 'title': 'Bakery ad'}, L)
        self.assertGreaterEqual(len(made['token']), 40)
        view = R.public(made['token'], L)
        self.assertEqual([p['id'] for p in view['pictures']], ['a0', 'a1']); self.assertEqual(view['title'], 'Bakery ad')
        self.assertEqual(R.media(made['token'], 'a1', L), Path('/data/image-dev/a1.png'))
        with self.assertRaises(Problem) as e: R.media(made['token'], 'a2', L)
        self.assertEqual(e.exception.code, 404)
        for bad in ('short', 'x' * 30 + '!', None):
            with self.assertRaises(Problem): R.public(bad, L)
        with self.assertRaises(Problem): R.create({'asset_ids': ['gone']}, L)
        with self.assertRaises(Problem): R.create({'asset_ids': ['a0'] * 2}, L)

    def test_comments_are_pinned_checked_and_kept(self):
        db, L = store(); t = R.create({'asset_ids': ['a0']}, L)['token']
        c = R.comment(t, {'asset_id': 'a0', 'x': 0.25, 'y': 0.8, 'text': ' Make the price bigger \x07', 'name': 'Sam'}, L)
        self.assertEqual((c['x'], c['y'], c['text'], c['name']), (0.25, 0.8, 'Make the price bigger', 'Sam'))
        self.assertEqual(len(R.public(t, L)['comments']), 1)
        for body in ({'asset_id': 'a1', 'x': .1, 'y': .1, 'text': 'x'}, {'asset_id': 'a0', 'x': 2, 'y': .1, 'text': 'x'},
                     {'asset_id': 'a0', 'x': .1, 'y': .1, 'text': '   '}, {'asset_id': 'a0', 'x': 'a', 'y': .1, 'text': 'x'}):
            with self.assertRaises(Problem): R.comment(t, body, L)

    def test_closed_and_expired_links_stop_working(self):
        db, L = store(); made = R.create({'asset_ids': ['a0']}, L)
        R.close({'review_id': made['id']}, L)
        with self.assertRaises(Problem) as e: R.public(made['token'], L)
        self.assertEqual(e.exception.code, 410)
        other = R.create({'asset_ids': ['a1']}, L); db[other['id']]['expires'] = time.time() - 1
        with self.assertRaises(Problem) as e: R.comment(other['token'], {'asset_id': 'a1', 'x': .5, 'y': .5, 'text': 'hi'}, L)
        self.assertEqual(e.exception.code, 410)

    def test_storage_api_routes_public_paths_before_the_key_check(self):
        src = (Path(__file__).parent / 'storage_api.py').read_text()
        self.assertLess(src.index("path.startswith('/api/review/public/')"), src.index("if not self.authorized(): return"))
        self.assertIn("'/api/review/create', '/api/review/close'", src)


if __name__ == '__main__':
    unittest.main()
