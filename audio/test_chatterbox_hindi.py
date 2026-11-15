"""Hindi lines use the Chatterbox Hindi finetune when it is installed; other lines keep the base V3 model."""
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy  # noqa: F401  (loaded once, before sys.modules is patched)

sys.path.insert(0, str(Path(__file__).parent))
import extra_worker  # noqa: E402


class FakeModel:
    sr = 24000

    def __init__(self, name):
        self.name, self.conds, self.calls, self.swapped = name, {'voice': name}, [], []
        model = self

        class S3:
            def load_state_dict(self, state, strict=True):
                model.swapped.append(state)
                return types.SimpleNamespace(missing_keys=['tokenizer.window'], unexpected_keys=[])

            def to(self, device):
                return self

            def eval(self):
                return self
        self.s3gen = S3()

    def generate(self, text, **kwargs):
        import numpy as np
        self.calls.append((text, kwargs['language_id']))
        clip = types.SimpleNamespace(numpy=lambda: np.zeros(10, dtype='float32'))
        return types.SimpleNamespace(squeeze=lambda: types.SimpleNamespace(float=lambda: types.SimpleNamespace(cpu=lambda: clip)))


class ChatterboxHindi(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.runtime = Path(self.temp.name) / 'models'
        (self.runtime / 'chatterbox').mkdir(parents=True)
        for name in ('ve.pt', 'conds.pt', 'Cangjie5_TC.json', 's3gen.pt'):
            (self.runtime / 'chatterbox' / name).write_text('x')
        self.output = Path(self.temp.name) / 'job' / 'output.wav'
        self.output.parent.mkdir()
        self.loaded = []

    def tearDown(self):
        self.temp.cleanup()

    def install_pack(self):
        (self.runtime / 'chatterbox' / 'hi').mkdir()
        for name in extra_worker.HINDI_PACK:
            (self.runtime / 'chatterbox' / 'hi' / name).write_text('x')

    def run_lines(self, languages):
        loaded = self.loaded

        class TTS:
            @staticmethod
            def from_local(folder, device, t3_model=None):
                model = FakeModel('hi' if t3_model == 't3_hi.safetensors' else 'base')
                loaded.append((model, Path(folder), t3_model))
                return model
        module = types.ModuleType('chatterbox.mtl_tts')
        module.ChatterboxMultilingualTTS = TTS
        request = {'model': 'chatterbox', 'compute': 'a100', 'exaggeration': .5,
                   'lines': [{'text': 't' + str(i), 'language': lang, 'voice': 'default'} for i, lang in enumerate(languages)]}
        torch = types.ModuleType('torch')
        torch.set_num_threads = lambda n: None
        torch.load = lambda path, **kw: {'from': Path(path).name}
        with patch.dict(sys.modules, {'chatterbox': types.ModuleType('chatterbox'), 'chatterbox.mtl_tts': module, 'torch': torch}), \
                patch.object(extra_worker, 'inference_device', return_value='cpu'), \
                patch.object(extra_worker, 'speech_progress'), \
                patch.object(extra_worker, 'assemble', create=True):
            try:
                extra_worker.synthesize(request, self.output, self.runtime)
            except RuntimeError:
                pass  # the fake clips are silent, so assembly rejects them after every line was generated
        return {model.name: [c[1] for c in model.calls] for model, _, _ in loaded}

    def test_without_the_pack_every_line_uses_the_base_model(self):
        self.assertIsNone(extra_worker.hindi_pack(self.runtime))
        self.assertEqual(self.run_lines(['Hindi', 'English']), {'base': ['hi', 'en']})

    def test_hindi_lines_use_the_finetune_and_others_the_base_model(self):
        self.install_pack()
        self.assertEqual(self.run_lines(['Hindi', 'English', 'Hindi']), {'base': ['en'], 'hi': ['hi', 'hi']})
        folder = next(f for m, f, _ in self.loaded if m.name == 'hi')
        self.assertEqual((folder / 's3gen.pt').resolve(), (self.runtime / 'chatterbox' / 's3gen.pt').resolve())
        hindi = next(m for m, _, _ in self.loaded if m.name == 'hi')
        self.assertEqual(hindi.swapped, [{'from': 's3gen_v3.pt'}])
        self.assertEqual((folder / 've.pt').resolve(), (self.runtime / 'chatterbox' / 've.pt').resolve())

    def test_all_hindi_loads_only_the_finetune(self):
        self.install_pack()
        self.assertEqual(self.run_lines(['Hindi']), {'hi': ['hi']})


if __name__ == '__main__':
    unittest.main()
