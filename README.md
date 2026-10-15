# ECCO AI Labs Studio

[**Open ECCO AI Labs Studio**](https://ecco-ai-labs.github.io/ecco-studio/)

Public frontend for ECCO AI Labs' image and video production workspace.

GitHub Pages serves the interface. The Python backend, credentials, model weights and production media remain in the private GPU workspace. This repository contains no media or secrets.

## Connect

Open the GitHub Pages website and select **Connect GPU**. Your authenticated Studio opens in the **same browser tab**. If needed, Jupyter asks you to sign in before opening Studio. No connection popup is required.

GitHub Pages is the entry point; the active workspace and its API share the authenticated GPU origin. Other visitors cannot view media or run jobs without an authorized GPU session. Browser-local drafts and settings belong to their respective origins; saved stories and media are stored on the server.

## Pilot limitations

- Single shared GPU queue; image and short silent video generation.
- Storyboards are manually written and edited.
- Automatic GitHub media sync requires a repository-scoped backend credential.
- YouTube uploads require owner-configured Google OAuth and channel authorization.
- The GPU must remain running while generating or browsing the private workspace.
- First-time Jupyter login is still required; GitHub sign-in does not replace GPU authentication.

## Models & settings

Open **Models & settings** even while the GPU is stopped. Each category has its own selector and per-model configuration saved in this browser. Image/video forms use these selections for new jobs. Qwen, FLUX, the larger Wan model, story generation and speech are planning presets, explicitly unavailable until installed and integrated; selecting one never falls back silently.

Existing SDXL steps/guidance/seed and Wan pilot defaults work with the current backend. Custom dimensions, samplers and video settings require the prepared `model_settings_version: 1` backend release. The frontend blocks these on older backends instead of ignoring them. No GPU is started by changing settings.
