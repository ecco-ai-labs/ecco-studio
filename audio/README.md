# Audio Studio — GitHub Pages interface and disposable inference worker

## Release status

Live audio generation is connected through the authenticated CPU storage API.
The interface stays on GitHub Pages. Indic-Mio, Chatterbox Multilingual and IndicF5
inference run on the selected CPU or GPU worker; jobs,
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
| CPU / GPU workers | queue_worker.py invokes disposable speech inference subprocesses |

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
A separate file lock for each compute target serializes its inference; heartbeats expose per-model readiness.
A crashed running job becomes an explicit error on worker restart; queued work is
retained. Models are released after each inference subprocess finishes.
Download snapshots with install_models.py; exact revisions are saved in models/manifest.json.
Completed recordings can be listed, played and downloaded while the GPU is off.

## Application adapter

After authenticated service setup, call `window.EccoAudioStudio.connect(adapter)`.
The adapter must expose `storageIndependentOfGPU: true` and these asynchronous methods:

- `status()`: current compute availability and supported model IDs.
- `list({story_id})`: the authorized user's audio assets (array).
- `generate(request)`: validate ownership and the schema below, durably queue the
  job, return `{id}`. The request explicitly selects CPU, A100, or B200.
- `job(id)`: return `{id,status,error?,progress?}`; `done` means durable output verified.
- `mediaURL(assetId)`: return an authenticated same-origin Blob URL or authorized HTTPS playback URL.
- `download(assetId)`: perform an authenticated WAV download.

Call `disconnect()` on sign-out. This adapter is a wiring contract, not a security
boundary: the application service must enforce authentication and ownership on
every operation, isolate users, and protect storage credentials. Never include
credentials in this public repository, browser-local storage, or a GPU job payload.

Asset fields used by the UI: `id`, `story_id`, `title`, `prompt`, `stage`, `duration`,
`deleted`. Request fields: `compute` (`cpu`, `a100`, or `b200`), `model` (`indic-mio`, `chatterbox`, or `indicf5`), `story_id`, `title`, `lines` (each has
`text`, `language`, `voice`, `emotion`), `speed`, `pitch`, `pause`. Server-side request
validation is in `audio_schema.py`; the service must also validate story ownership.

## Worker

`audio_worker.py` is a command-line inference implementation, not an app server or
database. It loads Indic-Mio and MioCodec from explicitly supplied local model
directories. Its output goes to the private queue directory. The job coordinator
copies the result into independent private media storage, verify bytes/checksum and audio
metadata, and atomically commit the asset before reporting completion. Per-compute locks and deterministic asset IDs prevent duplicate inference and finalization.

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
return; confirm drafts survive, compute defaults to CPU, and only the selected live
worker can receive generation or preview jobs. No GPU fallback is permitted. Run
`backend/verify_audio_models_live.py` on the CPU pod to verify new-model generation,
durable asset commit, and authenticated WAV playback before release.


## Additional audio models

`model_catalog.json` is the server catalog; `audio-models.js` contains the same
public UI catalog and is checked against it in tests. Both model menus share it.

| Model ID | Languages | Controls |
| --- | --- | --- |
| indic-mio | 22 Indian languages + English | Existing presets and emotion tags |
| chatterbox | 23 languages, including Hindi and English | Default/reference voice, expressiveness |
| indicf5 | 11 Indian languages, including Hindi, Tamil and Punjabi | Reference voice |

Urdu remains available through Indic-Mio. Chatterbox and IndicF5 are not advertised
as Urdu models. Reference voices are the seven official IndicF5 examples; labels
describe their source voices, not guaranteed output accents. Dialect and delivery
notes guide AI script writing. Pitch, speed and pauses use the same WAV assembly.

`install_extra_models.sh` creates isolated environments while retaining the pod's
CUDA PyTorch version. `extra_worker.py` loads local checkpoints; no model-card code
is executed dynamically. The IndicF5 vocoder is downloaded separately. Run
`prepare_reference_voices.py` once in the IndicF5 environment to fetch the official
examples and transcribe references. The ASR model is only an installation tool.

The queue dispatches only allowlisted model IDs to their own interpreter, removes
the Indic-Mio dependency path, and releases model VRAM after every job. Deploy the
new catalog/schema on both the GPU and CPU coordinator. Back up prior files before
activation. Speech tests and authenticated API generation must pass before release.

On 2026-10-19, authenticated API tests passed for Chatterbox (English and Hindi,
default and reference voices, 5.46 seconds) and IndicF5 (Hindi, Tamil and Punjabi,
three reference voices, 7.57 seconds). Both outputs were saved as mono 24 kHz WAV
assets and retrieved through authenticated media playback. Twelve UI tests and
fifteen schema, dispatch and durable-job tests also passed.


## CPU audio service

The CPU coordinator launches a separate audio worker when the CPU launcher and
validated-model manifest exist. It does not load inference models into the API.
CPU runtimes use PyTorch 2.8 CPU wheels, one inference thread, and lower process
priority. Existing model weights are reused; GPU runtimes are unchanged.

1. Deploy worker sources and `model_catalog.json` to `/workspace/ecco-audio`.
2. Run `bash install_cpu_models.sh` on the CPU pod. It installs isolated model
   environments under `/opt/ecco-audio-cpu` and saves `cpu-runtime.tar.gz` on the
   shared volume for restoration after a pod restart.
3. Run `python3.12 verify_cpu_models.py`. Each successful CPU-only WAV test adds
   that model to `cpu-ready-models.json`; unverified models remain unavailable.
4. Run `bash start_cpu_worker.sh` or restart the updated storage API. The launcher
   uses a per-pod lock, restores the runtime if needed, and supervises the worker.

CPU readiness requires a fresh heartbeat and a verified model ID. Changing compute
never starts or rents a pod and never falls back to another machine. Completed
assets record the compute target and worker pod. Long CPU jobs are slower than
GPU jobs; the existing 30-minute timeout still applies.

On 2026-10-19, all three CPU-only tests passed on the existing two-core, 8 GB
CPU pod: Indic-Mio (4.59 seconds of audio in 39.08 seconds), Chatterbox
(3.63 seconds in 117.65 seconds), and IndicF5 (3.16 seconds in 423.63 seconds).
An authenticated Indic-Mio job completed on the CPU pod in 33.61 seconds, saved
a 4.62-second mono 24 kHz WAV, and passed checksum verification through the
media endpoint. These short-test timings are observations, not latency promises.

## Character delivery update (runtime activation required)

The UI now preserves per-character pitch, speed, pause and Chatterbox expressiveness.
The schema, coordinator, queue and both inference workers must be deployed together
from the same revision. Updated workers advertise `character_controls_version: 1`;
readiness exposes it only when all live workers for that compute target support it.
The UI uses legacy global controls for uniform settings and rejects distinct native
settings on old workers instead of dropping them. This source change does not
activate itself on RunPod. Stop/restart only an idle worker after backing up its files.

Chatterbox uses per-line exaggeration and lower guidance for expressive delivery.
Cross-language reference clips use zero guidance following the upstream recommendation:
https://github.com/resemble-ai/chatterbox#original-chatterbox-tips . Explicit voice
choices remain unchanged; newly assigned Hindi/English characters use the model
default instead of random Kannada/Marathi references. Free-text acting directions
are converted to bounded supported cues, not spoken or passed as an unsupported
model prompt. Indic-Mio uses supported emotion tags; IndicF5 uses its reference
voice and common timing controls. These mappings require listening acceptance;
unit tests do not establish professional voice quality or accent accuracy.

## Sound design update (runtime activation required)

Music and effects use selected Audio Library assets, not a generative sound model.
The UI suggests/reviews cues separately from dialogue and requires explicit files.
An exact trigger phrase splits speech at that point, retaining per-character native
controls and removing only the pause introduced by the split. The common assembler
measures post-DSP durations and `audio_soundtrack.py` mixes on CPU using FFmpeg.
Background beds can loop, fade and duck during speech; effects play once up to
30 seconds. The final PCM stereo WAV is saved through the existing checksum path.

Deploy `audio_soundtrack.py`, `audio_schema.py`, `audio_worker.py`,
`audio_queue.py`, `queue_worker.py`, and `backend/audio_jobs.py` together; also
deploy `backend/audio_workflows.py` for its explicit unsupported-schedule guard.
`extra_worker.py` uses the common assembler. Install no additional speech model
or GPU runtime. Restart only idle workers after checking current jobs. A worker
advertises `sound_design_version=1`; availability requires every live worker for
that compute class to support it. UI publication does not activate this runtime.

The coordinator resolves workspace audio IDs, checks asset type, Trash state and
resolved-path containment, then snapshots at most 64 MB of selected sounds beside
the queued request. Workers verify snapshot checksums, never fetch user URLs, and
show `Mixing music and effects` during assembly. A mix failure marks the job as an
error instead of saving voice-only output as a completed soundtrack. The original
script and sound-cue selections remain editable in the browser.

Run the sound-design UI tests and audio/`test_soundtrack.py` before deployment, then
perform authenticated end-to-end generation and listen to an actual story sample.
Synthetic timing/ducking tests establish the mixer behavior, not artistic quality.
Scheduled generation with sound cues is deliberately rejected until per-run cue
planning is implemented; existing voice-only workflows remain supported.
