#!/usr/bin/env bash
# CPU-only dependencies; reuse existing weights without changing GPU environments.
set -euo pipefail
mkdir -p /opt/ecco-audio-cpu
cd /opt/ecco-audio-cpu
export PIP_NO_CACHE_DIR=1 PIP_PROGRESS_BAR=off
python3.12 -m venv cpu-base-venv
cpu-base-venv/bin/pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu
cpu-base-venv/bin/pip install numpy==1.26.4 soundfile
cat > cpu-model-constraints.txt <<'EOF'
torch==2.8.0+cpu
torchaudio==2.8.0+cpu
numpy==1.26.4
EOF
for model in indic-mio chatterbox indicf5; do
  python3.12 -m venv "cpu-${model}-venv"
  printf '%s\n' /opt/ecco-audio-cpu/cpu-base-venv/lib/python3.12/site-packages > "cpu-${model}-venv/lib/python3.12/site-packages/ecco_cpu_shared.pth"
done
cpu-indic-mio-venv/bin/pip install -c cpu-model-constraints.txt 'transformers>=4.51,<5' 'accelerate>=1.12,<2' 'miocodec @ git+https://github.com/Aratako/MioCodec@77473544375d57e96cbdfd5d7d257e8f280fa8e3'
cpu-indic-mio-venv/bin/python -c 'import torch; from miocodec import MioCodecModel; assert not torch.cuda.is_available(); print("CPU INDIC-MIO IMPORT OK", flush=True)'
cpu-chatterbox-venv/bin/pip install -c cpu-model-constraints.txt librosa==0.11.0 s3tokenizer transformers==5.2.0 diffusers==0.29.0 conformer==0.3.2 safetensors==0.5.3 spacy-pkuseg pykakasi==2.3.0 pyloudnorm omegaconf resemble-perth
cpu-chatterbox-venv/bin/pip install --no-deps git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2
cpu-chatterbox-venv/bin/python -c 'from chatterbox.mtl_tts import ChatterboxMultilingualTTS; print("CPU CHATTERBOX IMPORT OK", flush=True)'
cpu-indicf5-venv/bin/pip install -c cpu-model-constraints.txt transformers==4.49.0 accelerate cached_path click datasets==3.3.2 pyarrow==19.0.1 ema_pytorch hydra-core jieba librosa matplotlib pydub pypinyin safetensors tomli torchdiffeq tqdm transformers_stream_generator vocos wandb x_transformers==1.44.8
cpu-indicf5-venv/bin/pip install --no-deps git+https://github.com/AI4Bharat/IndicF5.git@13f7c4d627cc10111aea8fe9c0039462cacacdc7
cpu-indicf5-venv/bin/python -c 'from f5_tts.infer.utils_infer import load_model; print("CPU INDICF5 IMPORT OK", flush=True)'
printf '\nCPU MODEL RUNTIMES INSTALLED\n'

touch /opt/ecco-audio-cpu/.installed
tar -C /opt -czf /workspace/ecco-audio/cpu-runtime.tar.gz.tmp ecco-audio-cpu
mv /workspace/ecco-audio/cpu-runtime.tar.gz.tmp /workspace/ecco-audio/cpu-runtime.tar.gz
printf '\nCPU RUNTIME ARCHIVE SAVED\n'
