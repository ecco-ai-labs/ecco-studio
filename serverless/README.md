# Serverless generation (branch `serverless-migration`)

Moves image and video generation from always-on GPU pods to RunPod Serverless
endpoints. You pay only while something is generating, and workers can start in
any data center: they read the models from a RunPod **global volume**, which is
not tied to one data center, and save results onto the existing network volume
through RunPod's storage API. No outside storage service is needed.

Nothing changes until you start `serverless_studio.py` on the CPU pod. The GitHub
Pages site and the GPU pods keep working as before.

## How it fits together

```
Studio (browser) → CPU storage pod (network volume b3qo8lps92 at /workspace)
                     └─ serverless_studio.py  runs the existing Studio service (studio.py) unchanged
                          ├─ comfy_proxy.py      answers Studio's ComfyUI calls, sends each workflow to
                          │                      the Images or Video endpoint
                          ├─ zimage_client.py    sends Z-Image to the Images endpoint
                          └─ longcat_dispatch.py sends queued LongCat shots to the LongCat endpoint

RunPod Serverless (any data center)
   reads models from the global volume (/runpod-volume)
   writes results to b3qo8lps92 via the storage API → ecco-serverless/results/ → picked up by the CPU pod
   ├─ Images   SDXL · Qwen-Image-2512 · Qwen Image Edit 2511 · FLUX.2 klein 4B · Z-Image
   ├─ Video    Wan 2.2 TI2V 5B · Wan 2.2 I2V A14B
   └─ LongCat  LongCat-Video-Avatar 1.5
```

Why not build the models into the containers: RunPod's GitHub builds are limited
to 80 GB images and a 30-minute build step. The image models alone are ~93 GB.

Not moved: audio (stays on the CPU workers), the story planner model and TRELLIS.2.

## One-time setup

### 1. Global volume with the models (~210 GB)

Storage → Global Volumes → create one. Attach it to a pod that also has the
network volume (RunPod mounts the global volume at `/workspace-global` when
`/workspace` is taken), then copy the models:

```sh
bash serverless/copy_to_global_volume.sh --dry-run   # check
bash serverless/copy_to_global_volume.sh             # about an hour
```

The script copies `ComfyUI/models`, `ecco-models/z-image` and the LongCat
`source`, `weights` and `runner.py`, keeping the same folder layout. It is safe to
re-run. It also prints the pods' ComfyUI version; set it as `COMFY_COMMIT` in the
build if a workflow needs that exact version.

Turn on low-balance notifications: a global volume is deleted 15 days after the
account balance reaches $0.

### 2. Storage API key for the network volume

Storage → **Create S3 API key**. Workers use it to save results onto
`b3qo8lps92` (EU-RO-1, which supports the storage API).

### 3. Four endpoints

Serverless → New Endpoint → **GitHub repo** `ecco-ai-labs/ecco-studio`, branch
`serverless-migration`.

| Endpoint | Dockerfile | GPUs (in order) | Execution timeout |
|---|---|---|---|
| Images | `serverless/comfy-worker/Dockerfile.images` | 48 GB (L40S), A100 80 GB, H100 | 10 min |
| Video | `serverless/comfy-worker/Dockerfile.video` | B200, H200, H100 | 60 min |
| LongCat | `serverless/longcat-worker/Dockerfile` | B200 only (the only validated GPU) | 45 min |
| Audio | `serverless/audio-worker/Dockerfile` | A100 80 GB, A100 40 GB | 30 min |

For all four: attach the **global volume**, queue-based, active workers 0, max
workers 3–5, idle timeout 60 s, FlashBoot on, all data centers. Add these
environment variables, with the key from step 2 stored as RunPod secrets:

```
ECCO_S3_ENDPOINT_URL=https://s3api-eu-ro-1.runpod.io/
ECCO_S3_REGION=eu-ro-1
ECCO_S3_BUCKET=b3qo8lps92
ECCO_S3_ACCESS_KEY_ID=<from step 2>
ECCO_S3_SECRET_ACCESS_KEY=<from step 2>
```

The first start of each worker is slow while models load from the global volume.

The Audio endpoint uses the same base image as the GPU pods and runs their exact speech
environments (Indic-Mio, Chatterbox, IndicF5) from the global volume; the pods' runtime
archive is unpacked onto each worker's local disk at start-up.

### 4. Turn it on (always-on storage pod)

Run the bridge on the storage pod, which is always on:

```sh
export RUNPOD_API_KEY=... ECCO_ENDPOINT_IMAGES=... ECCO_ENDPOINT_VIDEO=... ECCO_ENDPOINT_LONGCAT=... ECCO_ENDPOINT_AUDIO=...
export ECCO_SERVERLESS_POD=serverless
python serverless/serverless_studio.py
```

Studio's GPU connection box shows **Serverless** beside B200 and A100. It connects
automatically whenever the bridge is healthy (unless you disconnect it) and is billed
per second of generation. Audio Studio sees it as an A100 audio worker named
*Serverless A100*, so choosing A100 compute for speech runs on the serverless endpoint.
In Studio, generate an image, an edit, a Wan clip, a
Z-Image image and a LongCat shot. Activity and errors go to
`/workspace/ecco-serverless/proxy.log`. If that GPU pod gets started, its own
workers take their locks back and the launcher stays out of the way.

## Rolling back

Stop `serverless_studio.py` and start the GPU pod again. The launcher only writes
under `/workspace/ecco-serverless/`; the database and library are untouched. To
abandon the branch, delete it, the endpoints and the global volume.

## Known limits

- **Global volumes are in beta**; behavior may change.
- **First request after a quiet period is slow** while a worker starts and loads models.
- **Step-by-step progress** isn't shown for Wan; Studio shows "Step updates unavailable"
  and still reports each scene.
- **The instance keeps its old name** in the picker; a "Serverless" entry is a later UI change.
- **Live Studio code differs from the copy in this repo.** The launcher relies only on
  ComfyUI's HTTP API and module names (`extra_image_models`, `gpu_dispatch`,
  `accelerator_status`); confirm on the first run that each model works.

## Tests

```sh
python3 -m unittest discover -s serverless/tests -v
```

Covers the RunPod client, results through the volume, the ComfyUI stand-in (including
the retained Studio `comfy_execute` running against it), Z-Image, LongCat dispatch and
the lock hand-off with a running GPU pod.
