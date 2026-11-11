# Talking-head endpoint: LongCat-Video-Avatar 1.5. Validated on B200 only; select B200 for this endpoint.
# Build context: repository root. Source, prepared runner and weights are read from the
# global volume at /runpod-volume/ecco-video/longcat (same layout as on the pods).
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime
ENV PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 ECCO_LONGCAT_ROOT=/opt/longcat
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY video/requirements-longcat.txt /tmp/requirements-longcat.txt
RUN pip install --no-cache-dir -r /tmp/requirements-longcat.txt runpod boto3
RUN mkdir -p /opt/longcat/venv/bin \
 && ln -s "$(command -v python)" /opt/longcat/venv/bin/python \
 && ln -s /runpod-volume/ecco-video/longcat/source /opt/longcat/source \
 && ln -s /runpod-volume/ecco-video/longcat/weights /opt/longcat/weights \
 && ln -s /runpod-volume/ecco-video/longcat/runner.py /opt/longcat/runner.py
COPY audio/generation_cancel.py /opt/audio/generation_cancel.py
COPY video/longcat_jobs.py serverless/worker_common.py serverless/longcat-worker/handler.py /opt/ecco/
CMD ["python", "-u", "/opt/ecco/handler.py"]
