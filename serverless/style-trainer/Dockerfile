# House-style trainer (Image Level 5): Musubi Tuner LoRA training for Qwen-Image-2512.
# Build context: repository root. Attach the SAME volume as the image endpoint (LoRAs land in its ComfyUI/models/loras).
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime
ENV PYTHONUNBUFFERED=1 MUSUBI_DIR=/musubi-tuner
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
 && git clone https://github.com/kohya-ss/musubi-tuner /musubi-tuner \
 && pip install --no-cache-dir -e /musubi-tuner runpod boto3 huggingface_hub bitsandbytes accelerate
COPY serverless/worker_common.py serverless/style-trainer/handler.py /opt/ecco/
CMD ["python", "-u", "/opt/ecco/handler.py"]
