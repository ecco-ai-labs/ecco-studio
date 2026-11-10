# Serverless generation (branch `serverless-migration`)

Moves image and video generation from always-on GPU pods to RunPod Serverless
endpoints. You pay only while something is generating, and workers can start in
any data center because the models are built into each worker instead of being
read from the shared network volume.

Nothing changes until you start `serverless_studio.py` on the CPU pod. The GitHub
Pages site and the GPU pods keep working as before.

## How it fits together

```
Studio (browser) → CPU storage pod
                     ├─ serverless_studio.py  runs the existing Studio service (studio.py) unchanged
                     │    ├─ comfy_proxy.py    answers Studio's ComfyUI calls, sends each workflow to
                     │    │                    the Images or Video endpoint, saves results where Studio expects them
                     │    ├─ zimage_client.py  sends Z-Image to the Images endpoint
                     │    └─ longcat_dispatch.py sends queued LongCat shots to the LongCat endpoint
                     └─ shared volume: database, library, job records (unchanged)

RunPod Serverless ── Images endpoint   SDXL · Qwen-Image-2512 · Qwen Image Edit 2511 · FLUX.2 klein · Z-Image
                 ── Video endpoint    Wan 2.2 TI2V 5B · Wan 2.2 I2V A14B
                 ── LongCat endpoint  LongCat-Video-Avatar 1.5
```

Not moved: audio (stays on the CPU workers), the story planner model, and TRELLIS.2
(still waiting on Hugging Face access).

## One-time setup

### 1. Two buckets (Cloudflare R2 recommended, no download fees)

| Bucket | Access | Used for |
|---|---|---|
| `ecco-weights` | Public read (R2: enable the r2.dev URL) | Model files the worker builds download |
| `ecco-results` | Private | Finished images and video frames, fetched by the CPU pod through short-lived links |

Create an API token with read/write access to both.

### 2. Copy the models from the volume to `ecco-weights`

On the CPU storage pod (it has the volume at `/workspace`):

```sh
pip install boto3
export ECCO_S3_BUCKET=ecco-weights ECCO_S3_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com \
       ECCO_S3_ACCESS_KEY_ID=... ECCO_S3_SECRET_ACCESS_KEY=...
python serverless/publish_weights.py --dry-run   # check the list and sizes
python serverless/publish_weights.py             # upload (long: tens to hundreds of GB)
```

Leave out models you no longer use with `--exclude "comfy/checkpoints/old_*"`; smaller
images start faster. Then put the bucket's public address for `weights/` in
`serverless/weights-url.txt` on this branch and push.

### 3. Create three endpoints in RunPod

Serverless → New Endpoint → **GitHub repo** `ecco-ai-labs/ecco-studio`, branch
`serverless-migration`, build context = repository root.

| Endpoint | Dockerfile | GPUs (in order) | Execution timeout |
|---|---|---|---|
| Images | `serverless/comfy-worker/Dockerfile.images` | L40S / 48 GB, A100 80 GB, H100 | 10 min |
| Video | `serverless/comfy-worker/Dockerfile.video` | B200, H200, H100 | 60 min |
| LongCat | `serverless/longcat-worker/Dockerfile` | B200 only (the only validated GPU) | 45 min |

For all three: queue-based, active workers 0, max workers 3–5, idle timeout 60 s,
FlashBoot on, **no network volume**, all data centers. Add these secrets
(results bucket): `ECCO_S3_BUCKET=ecco-results`, `ECCO_S3_ENDPOINT_URL`,
`ECCO_S3_ACCESS_KEY_ID`, `ECCO_S3_SECRET_ACCESS_KEY`.

The first build and first start are slow because the images are large.

### 4. Try it on the CPU pod

Pick a GPU instance to stand in for and stop that pod (for example the A100 migration
pod `sup07jsgh2evnf`). Then on the CPU storage pod:

```sh
export RUNPOD_API_KEY=... ECCO_ENDPOINT_IMAGES=... ECCO_ENDPOINT_VIDEO=... ECCO_ENDPOINT_LONGCAT=...
export ECCO_SERVERLESS_POD=sup07jsgh2evnf
python serverless/serverless_studio.py
```

In Studio, select that instance and generate an image, an edit, a Wan clip, a Z-Image
image and a LongCat shot. Results land in the library as usual. Endpoint activity and
errors are logged to `/workspace/ecco-serverless/proxy.log`.

If that GPU pod is still running, its own workers keep their locks and the launcher
leaves them alone.

## Rolling back

Stop `serverless_studio.py` and start the GPU pod again. The launcher only writes
under `/workspace/ecco-serverless/`; the database and library are untouched by the
switch. To abandon the branch, delete it and the three endpoints.

## Known limits

- **First request after a quiet period is slow** while a worker starts and loads models.
- **Step-by-step progress** isn't shown for Wan; Studio shows "Step updates unavailable"
  and still reports each scene.
- **The instance keeps its old name** (for example "A100") in the picker; a proper
  "Serverless" entry is a later UI change.
- **Live Studio code differs from the copy in this repo.** The launcher relies only on
  ComfyUI's HTTP API and module names (`extra_image_models`, `gpu_dispatch`,
  `accelerator_status`); confirm on the first run that each model works.
- **Not tested on GPUs here.** The containers have not been built yet; step 3 is the
  first real test.

## Tests

```sh
python3 -m unittest discover -s serverless/tests -v
```

Covers the RunPod client, result packaging, the ComfyUI stand-in (including the
retained Studio `comfy_execute` running against it), Z-Image, LongCat dispatch and
the lock hand-off with a running GPU pod.
