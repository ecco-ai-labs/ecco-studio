# Bundled 3D viewer

`model-viewer.min.js` is the unmodified browser distribution from
`@google/model-viewer@4.1.0` on npm, https://github.com/google/model-viewer.
License: Apache-2.0, retained in `model-viewer.LICENSE` and the distribution header.
It loads on demand in the Character workflow, not at Studio startup. Model assets
are authenticated workspace blobs; user data is not sent to a hosted 3D viewer.
The UI inventory hashes this bundled file without indexing minified internals.
