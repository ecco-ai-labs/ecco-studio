# ECCO AI Labs Studio

[**Open ECCO AI Labs Studio**](https://ecco-ai-labs.github.io/ecco-studio/)

Public frontend for ECCO AI Labs' image and video production workspace.

GitHub Pages serves the interface. The Python backend, credentials, model weights and production media remain in the private GPU workspace. This repository contains no media or secrets.

## Connect

Open the GitHub Pages website, review the live **B200 / A100** availability cards, and select the workspace you want. The page never automatically redirects to a fixed GPU. Checks refresh every 20 seconds and can be refreshed manually. Your authenticated Studio opens in the **same browser tab**. If needed, Jupyter asks you to sign in before opening Studio. No connection popup is required.

GitHub Pages is the entry point; the active workspace and its API share the authenticated GPU origin. Other visitors cannot view media or run jobs without an authorized GPU session. Browser-local drafts and settings belong to their respective origins; saved stories and media are stored on the server.

Status probes load non-sensitive Studio/logo and Jupyter favicon resources with cache-busting URLs. A successful response confirms service availability; a failed probe is shown as unavailable from this browser, not definitively stopped. Authentication, startup, and network restrictions can also prevent a probe. No RunPod API key or private data is exposed. Use the per-GPU RunPod link for authoritative power status.

## Pilot limitations

- Single shared GPU queue; image and short silent video generation.
- Storyboards are manually written and edited.
- Automatic GitHub media sync requires a repository-scoped backend credential.
- YouTube uploads require owner-configured Google OAuth and channel authorization.
- The GPU must remain running while generating or browsing the private workspace.
- First-time Jupyter login is still required; GitHub sign-in does not replace GPU authentication.

## Models & settings

Model selectors live in the left navigation. Qwen-Image-2512 and the original SDXL/Wan 5B paths are available on the configured backend. Additional models remain disabled until installed and validated. Settings never silently fall back to a different model.

Generation buttons show busy feedback. Activity is a right-hand drawer. Image refinement preserves versions; instruction editing and character-sheet generation are separately gated on Qwen Edit model availability. Character references are not LoRA adapters.

Billing distinguishes the current-session compute estimate from RunPod account totals. Thirty-minute account refresh requires a read-only billing key configured in the private GPU app; no credentials belong in this repository.
