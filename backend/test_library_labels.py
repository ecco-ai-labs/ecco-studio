import hashlib
import threading
import unittest

import library_labels


class Problem(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.message = message
        self.code = code


class LabelsTest(unittest.TestCase):
    def setUp(self):
        self.rows = {}
        self.env = {
            'Problem': Problem,
            'LOCK': threading.RLock(),
            'records': lambda kind=None: [dict(r) for r in self.rows.values() if kind is None or r['kind'] == kind],
            'save': self.save,
            'get': self.get,
        }
        self.put('a' * 32, 'asset', media='video', title='Clip')
        self.put('b' * 32, 'asset', media='image', title='Picture')
        self.put('c' * 32, 'story', title='Story')
        self.put('d' * 32, 'workflow', name='Flow')
        self.put('e' * 32, 'asset', media='video', title='Gone', deleted=True)

    def put(self, rid, kind, **fields):
        self.rows[rid] = dict(id=rid, kind=kind, **fields)

    def save(self, record):
        self.rows[record['id']] = dict(record)
        return record

    def get(self, rid, kind=None):
        if rid not in self.rows:
            raise Problem('Record not found', 404)
        row = dict(self.rows[rid])
        if kind and row['kind'] != kind:
            raise Problem('Wrong record type', 400)
        return row

    def links(self):
        return [r for r in self.rows.values() if r['kind'] == 'library_item']

    def test_create_is_idempotent_and_nested(self):
        first = library_labels.create_folder({'library': 'video', 'name': 'Footage'}, self.env)
        again = library_labels.create_folder({'library': 'video', 'name': ' footage '}, self.env)
        self.assertEqual(first['id'], again['id'])
        self.assertEqual(first['kind'], 'video_folder')
        nested = library_labels.create_folder({'library': 'video', 'name': 'Footage / Coast'}, self.env)
        self.assertEqual(nested['name'], 'Footage / Coast')

    def test_create_kind_per_library(self):
        for library, kind in library_labels.FOLDERS.items():
            self.assertEqual(library_labels.create_folder({'library': library, 'name': 'X'}, self.env)['kind'], kind)

    def test_create_rejects_bad_input(self):
        for body in ({'library': 'nope', 'name': 'X'}, {'library': 'video', 'name': ''}, {'library': 'video', 'name': 'x' * 81}):
            with self.assertRaises(Problem):
                library_labels.create_folder(body, self.env)

    def test_create_refuses_label_in_trash(self):
        folder = library_labels.create_folder({'library': 'story', 'name': 'Old'}, self.env)
        self.rows[folder['id']]['deleted'] = True
        with self.assertRaises(Problem) as error:
            library_labels.create_folder({'library': 'story', 'name': 'old'}, self.env)
        self.assertEqual(error.exception.code, 409)

    def test_assign_many_labels_to_each_library(self):
        cases = [('video', 'a' * 32), ('story', 'c' * 32), ('workflow', 'd' * 32), ('image', 'b' * 32)]
        for library, item in cases:
            one = library_labels.create_folder({'library': library, 'name': 'One'}, self.env)
            two = library_labels.create_folder({'library': library, 'name': 'Two'}, self.env)
            library_labels.assign({'library': library, 'item_id': item, 'folder_ids': [one['id'], two['id']]}, self.env)
            found = {r['folder_id'] for r in self.links() if r['asset_id'] == item}
            self.assertEqual(found, {one['id'], two['id']})

    def test_assign_is_repeatable_and_uses_the_existing_link_id(self):
        folder = library_labels.create_folder({'library': 'image', 'name': 'People'}, self.env)
        for _ in range(2):
            library_labels.assign({'library': 'image', 'item_id': 'b' * 32, 'folder_ids': [folder['id']]}, self.env)
        self.assertEqual(len(self.links()), 1)
        expected = hashlib.sha256(('library-item:' + 'b' * 32 + ':' + folder['id']).encode()).hexdigest()[:32]
        self.assertEqual(self.links()[0]['id'], expected)

    def test_assign_rejects_wrong_library_deleted_or_missing(self):
        folder = library_labels.create_folder({'library': 'video', 'name': 'V'}, self.env)
        for item in ('b' * 32, 'e' * 32, 'f' * 32):
            with self.assertRaises(Problem):
                library_labels.assign({'library': 'video', 'item_id': item, 'folder_ids': [folder['id']]}, self.env)
        with self.assertRaises(Problem):
            library_labels.assign({'library': 'video', 'item_id': 'a' * 32, 'folder_ids': []}, self.env)
        self.assertEqual(self.links(), [])

    def test_assign_rejects_a_label_from_another_library(self):
        other = library_labels.create_folder({'library': 'story', 'name': 'S'}, self.env)
        with self.assertRaises(Problem):
            library_labels.assign({'library': 'video', 'item_id': 'a' * 32, 'folder_ids': [other['id']]}, self.env)

    def test_remove_only_the_chosen_label(self):
        one = library_labels.create_folder({'library': 'video', 'name': 'One'}, self.env)
        two = library_labels.create_folder({'library': 'video', 'name': 'Two'}, self.env)
        library_labels.assign({'library': 'video', 'item_id': 'a' * 32, 'folder_ids': [one['id'], two['id']]}, self.env)
        result = library_labels.remove({'library': 'video', 'item_id': 'a' * 32, 'folder_id': one['id']}, self.env)
        self.assertEqual(result['removed'], 1)
        self.assertEqual([r['folder_id'] for r in self.links()], [two['id']])
        again = library_labels.remove({'library': 'video', 'item_id': 'a' * 32, 'folder_id': one['id']}, self.env)
        self.assertEqual(again['removed'], 0)
        self.assertTrue(any(r['kind'] == 'purged' for r in self.rows.values()))


if __name__ == '__main__':
    unittest.main()
