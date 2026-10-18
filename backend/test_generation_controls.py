"""Exercise the real generation functions without a GPU, database or credentials."""
import ast
from pathlib import Path
import unittest
from unittest.mock import Mock

SOURCE = Path(__file__).resolve().parents[1] / 'migration/legacy/studio.py'
class Problem(Exception): pass

def functions():
    parsed = ast.parse(SOURCE.read_text())
    wanted = [node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name in ('create_edit', 'edit_graph')]
    env = {'Problem': Problem, 'LEGACY_STORY': 'legacy', 'qwen_edit_ready': lambda: True,
           'story_id': lambda body: body.get('story_id', 'story'), 'text': lambda text: text,
           'number': lambda n, lo, hi, integer=False: int(n) if integer else n,
           'node': lambda kind, **inputs: {'class_type': kind, 'inputs': inputs},
           'launch': lambda label, fn: fn('job'), 'edited_asset': Mock(return_value={'id': 'output'})}
    assets = {name: {'id': name, 'kind': 'asset', 'media': 'image', 'story_id': 'story'} for name in ('a', 'b', 'c')}
    env['get'] = lambda aid, kind: assets[aid]
    exec(compile(ast.Module(body=wanted, type_ignores=[]), str(SOURCE), 'exec'), env)
    return env, assets

class GenerationControlsTest(unittest.TestCase):
    def test_all_references_and_settings_reach_generation(self):
        env, _ = functions()
        result = env['create_edit']({'story_id': 'story', 'asset_ids': ['b', 'a'], 'prompt': 'Blue car', 'steps': 28, 'cfg': 4, 'seed': 7})
        self.assertEqual(result, 'output')
        env['edited_asset'].assert_called_once_with('job', ['b', 'a'], 'Blue car', 'story', steps=28, cfg=4, seed=7)
    def test_invalid_reference_sets_never_generate(self):
        for refs in ([], ['a']*2, ['a','b','c','d'], 'a', [None]):
            env, _ = functions()
            with self.assertRaises(Problem): env['create_edit']({'asset_ids': refs, 'prompt': 'Test'})
            env['edited_asset'].assert_not_called()
    def test_deleted_and_nonimage_references_never_generate(self):
        for bad in ({'deleted': True}, {'media': 'video'}):
            env, assets = functions(); assets['b'].update(bad)
            with self.assertRaises(Problem): env['create_edit']({'asset_ids': ['a','b'], 'prompt': 'Test'})
            env['edited_asset'].assert_not_called()
    def test_graph_binds_three_separate_images_and_uses_visible_settings(self):
        env, _ = functions()
        graph = env['edit_graph']('A scene', ['a.png','b.png','c.png'], 'result', 99, 28, 4)
        self.assertEqual([graph[str(20+i)]['inputs']['image'] for i in range(3)], ['a.png','b.png','c.png'])
        for i in range(3): self.assertEqual(graph['6']['inputs']['image'+str(i+1)], [str(20+i),0])
        self.assertEqual(graph['10']['inputs']['seed'], 99)
        self.assertEqual(graph['10']['inputs']['steps'], 28)
        self.assertEqual(graph['10']['inputs']['cfg'], 4)
    def test_single_reference_compatibility(self):
        env, _ = functions();env['create_edit']({'asset_id':'a','prompt':'Smile'})
        env['edited_asset'].assert_called_once_with('job', ['a'], 'Smile', 'story', seed=42, steps=40, cfg=3)

if __name__ == '__main__': unittest.main()
