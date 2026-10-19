#!/usr/bin/env bash
# Isolated extras: retain the pod's CUDA/B200-compatible torch and torchaudio.
set -euo pipefail
cd /workspace/ecco-audio
/opt/ecco-runtime-venv/bin/python - <<'PY' > extra-model-constraints.txt
import importlib.metadata as m
for name in ('torch', 'torchaudio'):
    print(name + '==' + m.version(name))
print('numpy==1.26.4')
PY
/opt/ecco-runtime-venv/bin/python -m venv --system-site-packages chatterbox-venv
chatterbox-venv/bin/pip install -c extra-model-constraints.txt numpy==1.26.4 librosa==0.11.0 s3tokenizer transformers==5.2.0 diffusers==0.29.0 conformer==0.3.2 safetensors==0.5.3 spacy-pkuseg pykakasi==2.3.0 pyloudnorm omegaconf soundfile resemble-perth
chatterbox-venv/bin/pip install --no-deps git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2
/opt/ecco-runtime-venv/bin/python -m venv --system-site-packages indicf5-venv
indicf5-venv/bin/pip install -c extra-model-constraints.txt numpy==1.26.4 transformers==4.49.0 accelerate cached_path click datasets==3.3.2 pyarrow==19.0.1 ema_pytorch hydra-core jieba librosa matplotlib pydub pypinyin safetensors soundfile tomli torchdiffeq tqdm transformers_stream_generator vocos wandb x_transformers==1.44.8
indicf5-venv/bin/pip install --no-deps git+https://github.com/AI4Bharat/IndicF5.git@13f7c4d627cc10111aea8fe9c0039462cacacdc7
download-venv/bin/python - <<'PY'
from huggingface_hub import snapshot_download
repo = 'charactr/vocos-mel-24khz'
revision = '0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21'
snapshot_download(repo, revision=revision, local_dir='models/vocos')
print('Vocos revision:', revision)
PY
chatterbox-venv/bin/python -c 'from chatterbox.mtl_tts import ChatterboxMultilingualTTS; print("CHATTERBOX IMPORT OK")'
indicf5-venv/bin/python -c 'from f5_tts.infer.utils_infer import load_model; print("INDICF5 IMPORT OK")'
printf '\nEXTRA MODEL RUNTIMES INSTALLED\n'

