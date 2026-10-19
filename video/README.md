# LongCat dialogue video worker

The Studio remains on GitHub Pages. The CPU storage API authenticates requests,
resolves library asset IDs, queues work, and saves the finished video. Only inference
runs on the accelerator. No browser storage key is sent to the GPU worker.

Persistent runtime root: `/workspace/ecco-video/longcat`.
Upstream code: `meituan-longcat/LongCat-Video`, commit
`6b3f4b8582a8bc3f20f795735f5383716c4ba794`.
Model revisions are recorded in the download manifest beside the weights.

The isolated Python 3.12 environment inherits Torch 2.8/CUDA 12.8 from the GPU
runtime and installs `requirements-longcat.txt`. `prepare_longcat.py` prepares the
official single-person demo for clean dialogue and the installed attention backend.

`validate_longcat.py` generates three seconds from the upstream public demonstration
assets. Readiness requires video and audio streams, finite decoded frames, and
sustained frame changes. A failed test must leave `validated.json` with `passed:false`.
`start_longcat.sh` starts the queue worker under a lock. The persistent GPU boot
script launches it before the existing supervisor. A fresh heartbeat and a successful
validation are required before the CPU service reports the worker as ready.

The initial full-precision runtime is restricted to B200. A100 is not validated.
Each request takes one image, a motion prompt, and 0.2–10 seconds of clean dialogue.
Generation uses the official eight-step distillation adapter. Dialogue determines
clip length. Resolution and seed are exposed in Studio; unused CFG controls are not.

The CPU API needs `longcat_jobs.py` beside `storage_api.py`; `install_cpu_hook.py`
applies the narrow routes and finalizer hook with a code backup. The private storage
authentication already enforced by that API remains required for job submission.

Validation commands: `python -m unittest discover -s video -p 'test*.py'` and
`node video/test_ui.cjs`. Runtime logs live in each private queue job directory.
