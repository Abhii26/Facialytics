# Bundled live tracker

Studio 2.2 adds MediaPipe Face Landmarker for fast live landmarks. The existing face-api.js runtime and models are retained from the supplied project.

## MediaPipe runtime

- Package: `@mediapipe/tasks-vision`, pinned to **0.10.32**.
- Upstream: https://github.com/google-ai-edge/mediapipe
- Package distribution: https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.32
- License: **Apache-2.0**. The upstream license is included at `public/vendor/mediapipe/LICENSE`.
- `vision_bundle.cjs` is copied byte-for-byte as `public/vendor/mediapipe/vision_bundle.js` so it is served with JavaScript MIME type. The worker supplies its `exports` object. Runtime code and WASM files are otherwise unmodified.
- Both SIMD and non-SIMD WASM builds are included. The runtime selects the supported variant.

## Face Landmarker model

Official float16 version 1 task bundle, downloaded without modification from:

https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

Official guide and model information:

https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker

The task bundle contains the face detector, face landmark detector, geometry metadata and optional blendshape model. This application disables blendshape and transformation-matrix output. It uses CPU inference and displays a 68-point contour subset of the measured mesh. Recognition uses the original face-api.js models instead.

## Integrity of added assets

| File | SHA-256 |
| --- | --- |
| `public/vendor/mediapipe/vision_bundle.js` | `43c65a77825c5d5af7456d4781a64cd15cb3e53f479ff1f923c12b5adecf2b44` |
| `public/models/face_landmarker.task` | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |

All assets are served from the application's own origin. The browser does not fetch a CDN or upload camera frames.
