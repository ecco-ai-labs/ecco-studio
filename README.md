# Ecco Studio

[**Open Ecco Studio**](https://ecco-ai-labs.github.io/ecco-studio/)

Public frontend for Ecco AI Labs' image and video production workspace.

GitHub Pages serves the interface. The Python backend, credentials, model weights and production media remain in the private GPU workspace. This repository contains no media or secrets.

## Connect

Open the GitHub Pages website and select **Connect GPU**. In the connection window, sign into the existing Jupyter session if necessary, then click **Connect this session**. Keep that window open while using the studio.

The connection relays requests through your authenticated Jupyter session using origin-checked browser messages. No public unauthenticated GPU API is exposed. Other visitors to this public frontend cannot view your media or run jobs without their own authorized GPU session.

## Pilot limitations

- Single shared GPU queue; image and short silent video generation.
- Storyboards are manually written and edited.
- Automatic GitHub media sync requires a repository-scoped backend credential.
- YouTube uploads require owner-configured Google OAuth and channel authorization.
- The GPU and browser connection window must remain running.
- First-time Jupyter login is still required; GitHub sign-in does not replace GPU authentication.

## Models & settings

Open **Models & settings** even while the GPU is stopped. Each category has its own selector and per-model configuration saved in this browser. Image/video forms use these selections for new jobs. Qwen, FLUX, the larger Wan model, story generation and speech are planning presets, explicitly unavailable until installed and integrated; selecting one never falls back silently.

Existing SDXL steps/guidance/seed and Wan pilot defaults work with the current backend. Custom dimensions, samplers and video settings require the prepared `model_settings_version: 1` backend release. The frontend blocks these on older backends instead of ignoring them. No GPU is started by changing settings.
