# Audio Studio — GitHub Pages interface and disposable inference worker

## Release status

The Pages interface adds Indic-Mio to Models & Settings and provides a multilingual
dialogue editor, per-line voice and emotion, speed, pitch, pauses, and browser-local
draft recovery. Playback/download rendering is prepared for an independent service.

**Live generation is not enabled.** No independent authenticated API, durable job
queue or media storage service is connected yet. Generate audio opens the shared GPU picker when disconnected. Once connected,
the UI reports the missing independent audio service instead of submitting a job. No GPU installation, library migration, model download or real speech
inference has been performed for this release.

## Ownership

| Part | Location |
| --- | --- |
| Full interface and source | `ecco-ai-labs/ecco-studio`, GitHub Pages |
| Accounts, story/audio metadata and jobs | Independent authenticated application service; deployment pending |
| Saved audio and source assets | Private storage independent of GPU lifecycle; deployment pending |
| GPU | Disposable inference worker with temporary inputs, outputs and model cache |

Do not install this interface on a GPU. Do not attach Audio Studio to the legacy
Jupyter bridge, `/workspace/ecco-studio-data`, or the GPU's SQLite database.
The existing network volume alone does not provide independent application access.
The migration work is tracked separately in PR #1.

## Application adapter

After authenticated service setup, call `window.EccoAudioStudio.connect(adapter)`.
The adapter must expose `storageIndependentOfGPU: true` and these asynchronous methods:

- `list({story_id})`: the authorized user's audio assets (array).
- `generate(request)`: validate ownership and the schema below, durably queue the
  job, return `{id}`. This is the only operation that may require GPU compute.
- `job(id)`: return `{id,status,error?,progress?}`; `done` means durable output verified.
- `mediaURL(assetId)`: return an authorized, expiring HTTPS playback URL.
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
directories. Its output path must be temporary scratch space. The job coordinator
must upload the result to private durable storage, verify bytes/checksum and audio
metadata, and atomically commit the asset before reporting completion. Retries need
leases and idempotency; worker loss must never erase authoritative data.

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
