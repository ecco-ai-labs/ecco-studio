# Character workflow inside Generate with AI

This change adds a saved, six-stage workflow under **Image Studio → Generate
with AI → Character**. It does not add a ribbon item or expose Blender scripting
to the user. GitHub Pages and the storage/GPU runtimes are separate deployments.

| Stage | Implementation | Release gate |
| --- | --- | --- |
| Appearance | Existing selected image model, or an existing same-story image | Review and approve one full-body appearance |
| Character set | Eight Qwen Image Edit jobs using the approved master | Review front/back/left/right/neutral/smile/angry/fear |
| 3D model | TRELLIS.2 Python adapter; self-contained textured GLB | Real inference on the selected GPU, including DINOv3 access |
| Body rig | UniRig skeleton, skin weights, merge, Blender inspection | Actual GPU run; check body mapping and deformation |
| Facial controls | Validate existing smile/angry/fear shape keys; import reviewed GLB | Facial authoring remains required; automatic facial rig generation is **not implemented** |
| Performance | Trusted Blender scene builder; stand/sit/run/jump/kick presets | Procedural motion previews; review foot contact, joints and facial quality |
| Export | Packed `.blend`, GLB, PNG and H.264 clip; image/video frame handoff | Valid output required; never send `.blend` directly to a video model |

The first reconstruction uses the approved front view. The other character views
are review references, not multi-view reconstruction conditioning. High quality
targets 500,000 faces and 4096-pixel texture maps; these numbers do not establish
photorealistic detail, good topology or likeness. Generated geometry and weights
need review. The `.blend` file preserves editable geometry, rig and keyframes.
Motion-video conditioning, arbitrary text-to-motion, animation retargeting from
captured performances and multi-character chase scenes are not implemented here.

## Durable behavior

Characters, approval checkpoints and `character_job` records live in the existing
workspace SQLite database. Saved characters are scoped to the originating story
and available in the Character selector. New version preserves the old actor.
The browser retains its unsaved brief and uncertain request ID, never credentials
in a character draft. Closing/minimizing does not cancel. Stop targets one job.

The coordinator stores relay intent before submitting image jobs. It resumes the
same deterministic relay ID and waits for the existing job; it does not regenerate
on refresh. 3D tasks use an immutable shared-volume queue, one worker per selected
pod, and no automatic replay of a claimed task after a crash. Workers kill only
their recorded process group and guard PID reuse. Queued work can stop without
an online worker. Completed earlier stages stay available after a failure.

All HTTP routes use the existing workspace Bearer and Origin checks. The ordinary
Google identity session does not authorize these routes. Uploads accept embedded
GLB only, maximum 50 MB, with a skeleton and skin weights. No uploaded `.blend`,
remote texture URLs, AI-generated Python, arbitrary shell snippets or model API
credentials are accepted. Subprocesses receive a limited environment; inference
uses offline model caches. The per-job log stays in the private queue.

## Runtime installation and qualification

Do not replace a live runtime blindly or restart it with active jobs. Read and
compare the deployed files, preserve unrelated live patches, back up changed
files/database, stage and compile, and restart only the idle storage coordinator.
Deploy the **matching** `backend/character_studio.py`, `backend/storage_api.py`,
`backend/generation_controls.py` and complete `characters/` package. No database
schema migration, new HTTP listener or user credential is needed. The CPU service
starts the character coordinator and advertises `config.character_studio`.

Install Blender 4.2 LTS or a validated compatible release and use separate
environments for the official engines:

- TRELLIS.2: https://github.com/microsoft/TRELLIS.2
- Optional TRELLIS 1: https://github.com/microsoft/TRELLIS
- UniRig: https://github.com/VAST-AI-Research/UniRig

Follow each upstream installation and model-access procedure. Pin the tested
source/weights in the runtime's installation record. Ecco's existing downloaded
TRELLIS.2 weights do not establish DINOv3 access or runtime readiness. No model
download, new GPU provisioning or paid API enrollment occurs from the UI.

An alternate `trellis_engine: "trellis1"` worker uses the public DINOv2 encoder
and the official TRELLIS image-large model. Set `trellis_root`, `trellis_python`
and `trellis_weights` to that installation, plus absolute paths for
`trellis_encoder_root` (the official DINOv2 source tree) and
`trellis_encoder_checkpoint` (`dinov2_vitl14_reg4_pretrain.pth`). The adapter
loads the encoder locally with `weights_only=True`; it does not download
weights or run background removal. Its input must be a reviewed RGBA PNG with
a transparent background and opaque character pixels. An ordinary opaque
character sheet is not valid input for this adapter.

TRELLIS 1 has a different geometry ceiling: high quality retains more of the
generated mesh and bakes a 4096-pixel texture, but does not increase the model's
native spatial resolution. This alternate adapter still requires a real model
qualification and visual review. It does not qualify body or facial rigging.

Keep a private worker configuration outside served assets, for example:

```json
{
  "blender": "/opt/blender/blender",
  "blender_device": "OPTIX",
  "blender_threads": 8,
  "trellis_python": "/opt/trellis-venv/bin/python",
  "trellis_root": "/workspace/engines/TRELLIS.2",
  "trellis_weights": "/workspace/ecco-models/trellis-2",
  "unirig_python": "/opt/unirig-venv/bin/python",
  "unirig_root": "/workspace/engines/UniRig",
  "qualification": "/workspace/ecco-character-private/qualification.json"
}
```

Set `ECCO_DATA` to the existing shared workspace and `RUNPOD_POD_ID` to the actual
selected compute. The CPU and GPU share `ECCO_CHARACTER_QUEUE` (default
`/workspace/ecco-character-queue`). Start one worker:

```sh
python -m characters.worker --config /workspace/ecco-character-private/worker.json
```

Readiness requires configuration **and actual successful qualification**, never
just file existence. Run a reviewed task manifest using:

```sh
python -m characters.worker --config /workspace/ecco-character-private/worker.json --qualify /private/model-task.json
python -m characters.worker --config /workspace/ecco-character-private/worker.json --check
```

The task fields are the same as the coordinator's immutable request: `id`, `gpu`,
`stage`, `data_root`, `output_dir` (`ECCO_DATA/character-dev/<id>`), `params`
including `input_path` and `quality`. A performance also specifies `action`,
`expression`, `seconds`, `camera` and `output: "clip"`. Qualify model, rig and
performance independently. Do not manufacture readiness markers; changing code
or configuration invalidates them. Importing a rig never qualifies UniRig.
Restart the worker after qualification to advertise the new capabilities.

## Blender review add-on

Install `blender_addon.py` in Blender. Select the armature; **Ecco → Save Body
Mapping** stores semantic controls as custom properties. Recognized conventional
Mixamo-style bone names are mapped automatically. Review bone axes and movement;
the generic presets are previews, not motion-capture quality.

Create reviewed facial shape keys named `smile`, `angry`, `fear` (or
`ecco_face_smile`, etc.) on the face mesh. Export GLB with skin weights, morphs and
Custom Properties, then import the rig in Studio. Studio enables only controls
present in the verified import and requires approval of the new candidate.

## Validation

```sh
PYTHONPATH=backend python -m unittest test_character_studio test_storage_api test_generation_controls test_generation_cancel
NODE_PATH=/path/to/test-deps/node_modules node --test character-studio.test.cjs ai-generation-instructions.test.cjs
blender --background --factory-startup --disable-autoexec --threads 2 --python-exit-code 1 --python characters/smoke_blender.py -- /tmp/ecco-character-smoke
python scripts/ui_inventory.py --check
```

The Blender smoke test uses an intentionally synthetic skinned fixture, renders
24 real frames and checks exported scene/keyframes. It does not prove realistic
reconstruction, automatic facial rigging, motion quality or a live GPU deployment.
Live UI inspection and model inference remain release gates.
