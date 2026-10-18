# Audio Studio — GitHub Pages interface and disposable inference worker

## Release status

Live audio generation is connected through the authenticated CPU storage API.
The interface stays on GitHub Pages. Indic-Mio inference runs on the GPU; jobs,
scripts, and generated WAV assets persist on the network volume independently.
An English-and-Hindi request passed generation, checksum-verified asset commit,
and authenticated media retrieval on 2026-10-18.

## Ownership

| Part | Location |
| --- | --- |
| Interface and source | GitHub Pages / this repository |
| Authentication, metadata, job finalization and media access | CPU storage API |
| Durable queue | /workspace/ecco-audio/queue on the shared network volume |
| Saved audio | /workspace/ecco-studio-data/audio-dev, written by the CPU service |
| Model weights and dependencies | /workspace/ecco-audio |
| GPU | queue_worker.py invokes disposable speech inference subprocesses |

Only the CPU service writes authoritative audio metadata. The GPU worker does not
open the Studio database or hold the storage access key. The current service uses
one workspace access key; per-user authorization is not yet implemented.

## Runtime

Deploy backend/audio_jobs.py with storage_api.py and audio/audio_queue.py plus
audio/audio_schema.py on the CPU service. The coordinator validates requests,
limits outstanding jobs to four, verifies WAV metadata/checksums and finalizes
assets with deterministic IDs. Finalization is retry-safe.

On the GPU, deploy audio_worker.py, audio_schema.py, audio_queue.py, queue_worker.py
and start_worker.sh to /workspace/ecco-audio. start_worker.sh uses the existing
/opt/ecco-runtime-venv runtime plus isolated dependencies at /workspace/ecco-audio/deps.
The persistent runtime boot.sh starts it after restoring the Python runtime.
A shared file lock serializes inference; a heartbeat exposes readiness.
A crashed running job becomes an explicit error on worker restart; queued work is
retained. Models are released after each inference subprocess finishes.
Download snapshots with install_models.py; exact revisions are saved in models/manifest.json.
Completed recordings can be listed, played and downloaded while the GPU is off.

## Application adapter

After authenticated service setup, call `window.EccoAudioStudio.connect(adapter)`.
The adapter must expose `storageIndependentOfGPU: true` and these asynchronous methods:

- `list({story_id})`: the authorized user's audio assets (array).
- `generate(request)`: validate ownership and the schema below, durably queue the
  job, return `{id}`. This is the only operation that may require GPU compute.
- `job(id)`: return `{id,status,error?,progress?}`; `done` means durable output verified.
- `mediaURL(assetId)`: return an authenticated same-origin Blob URL or authorized HTTPS playback URL.
- `download(assetId)`: perform an authenticated WAV download.

Call `disconnect()` on sign-out. This adapter is a wiring contract, not a security
boundary: the application service must enforce authentication and ownership on
every operation, isolate users, and protect storage credentials. Never include
credentials in this public repository, browser-local storage, or a GPU job payload.

Asset fields used by the UI: `id`, `story_id`, `title`, `prompt`, `stage`, `duration`,
`deleted`. Request fields: `model: "indic-mio"`, `story_id`, `title`, `lines` (each has
`text`, `language`, `voice`, `emotion`), `speed`, `pitch`, `pause`. Server-side request
validation is in `audio_schema.py`; the service must also validate story ownership.

## Worker

`audio_worker.py` is a command-line inference implementation, not an app server or
database. It loads Indic-Mio and MioCodec from explicitly supplied local model
directories. Its output goes to the private queue directory. The job coordinator
copies the result into independent private media storage, verify bytes/checksum and audio
metadata, and atomically commit the asset before reporting completion. The shared worker lock and deterministic asset IDs prevent concurrent inference and duplicate finalization.

Dependencies: Python 3.12+, CUDA PyTorch/torchaudio, `requirements.txt`, and FFmpeg.
The supplied runtime directory must contain `model/` (SPRINGLab/Indic-Mio), `codec/`
(Aratako/MioCodec-25Hz-24kHz), and `presets/en_female.pt`, `presets/en_male.pt` from
Aratako/MioTTS-Inference. Pin and record model snapshot revisions during deployment.
Speaker presets are loaded with PyTorch `weights_only=True`. No remote model code
is enabled. Audio uses the codec's configured sample rate, not a hard-coded 44 kHz.

```sh
python audio_worker.py --request /tmp/audio-job/request.json \
  --runtime /tmp/audio-models --output /tmp/audio-job/output.wav
```

The language dropdown controls valid emotion choices and records language intent;
it does not translate text or guarantee a dialect. Mixed-language input is passed
unchanged. Emotions use model tags; pitch and speed are FFmpeg postprocessing.
Voice cloning from a user reference is not included in this release.

Model: https://huggingface.co/SPRINGLab/Indic-Mio (Apache 2.0).
Codec: https://github.com/Aratako/MioCodec (MIT).
Upstream inference reference: https://github.com/Aratako/MioTTS-Inference (MIT).

## Validation

Run `python -m unittest discover -s audio -p 'test_*.py'` and
`node --check audio-studio.js`. Browser acceptance: open Audio Studio without a GPU;
add/edit Hindi, Urdu and English lines; inspect emotion options; navigate away and
return; confirm drafts survive, Generate audio opens the GPU picker when disconnected,
and no audio job is submitted without the independent service. Real multilingual inference and GPU-off media retrieval are pending service
deployment and must pass before generation is advertised as available.
