"""Adapt the official demo for clean dialogue, xFormers, and deterministic seeds."""
from pathlib import Path
ROOT=Path('/workspace/ecco-video/longcat')
source=(ROOT/'source/run_demo_avatar_single_audio_to_video.py').read_text()
source=source.replace('from audio_separator.separator import Separator','import shutil')
start=source.index('    vocal_separator_path =')
end=source.index('    # initialize pipeline',start)
source=source[:start]+"    vocal_separator = None\n    audio_output_dir_temp = Path('.')\n\n"+source[end:]
start=source.index('    outputs = vocal_separator.separate(source_path)')
end=source.index('\ndef generate(args):',start)
source=source[:start]+"    shutil.copyfile(source_path, target_path)\n    return target_path\n\n"+source[end:]
source=source.replace('subfolder="base_model", cp_split_hw=cp_split_hw,','subfolder="base_model", enable_flashattn2=False, enable_flashattn3=False, enable_xformers=True, cp_split_hw=cp_split_hw,')
source=source.replace('global_seed = 42','global_seed = int(os.environ.get("ECCO_LONGCAT_SEED", "42"))')
source=source.replace('output = output[0]', "output = output[0]\n        assert np.isfinite(output).all(), 'Nonfinite decoded video; refusing invalid output'")
(ROOT/'runner.py').write_text(source)
compile(source,str(ROOT/'runner.py'),'exec')
print('Runner prepared')
