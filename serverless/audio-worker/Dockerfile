# Speech endpoint (A100): Indic-Mio, Chatterbox and IndicF5.
# Same base image as the A100/B200 pods, so the voice environments built there
# (/workspace/ecco-audio/*-venv on top of /opt/ecco-runtime-venv) load unchanged.
# Build context: repository root. Weights, venvs and the runtime archive come from
# the global volume at /runpod-volume (see serverless/copy_to_global_volume.sh).
FROM runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404
ENV PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
 && rm -rf /var/lib/apt/lists/*
# The handler gets its own small environment so the image's torch stack stays untouched.
RUN python3.12 -m venv /opt/handler-venv \
 && /opt/handler-venv/bin/pip install --no-cache-dir runpod boto3
COPY serverless/worker_common.py serverless/audio-worker/handler.py /opt/ecco/
CMD ["/opt/handler-venv/bin/python", "-u", "/opt/ecco/handler.py"]
