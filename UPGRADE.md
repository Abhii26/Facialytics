# Studio 2.3 update and deployment guide

This complete package fixes permissive unknown-face matching while retaining the fast camera tracker. Extract into a new empty folder and follow [START_HERE.md](START_HERE.md).

## Recognition correction in 2.3

The old matcher accepted the closest gallery profile under 0.60. Version 2.3 defaults to 0.42, limits the slider to 0.45, requires a 0.08 lead over the second profile and checks face quality. Live names require two consistent descriptor samples. Appearance changes reset a track’s name, and rejected results clear confirmation. The new `public/recognition-policy.js` must be deployed alongside the other files. See [UNKNOWN_FACE_FIX.md](UNKNOWN_FACE_FIX.md).

## Earlier camera speed correction

The old camera loop ran face detection, landmarks, recognition, expressions and age/gender on the CPU for every update. The overlay waited for every model, and the next pass waited another 200 ms. Moving inference into a worker kept the interface responsive but did not shorten model execution.

## What changed

- `public/camera-engine.js`: dedicated CPU/WebAssembly video tracker.
- `public/face-tracks.js`: conservative continuity matching for separately computed names/estimates.
- `public/vendor/mediapipe/` and `public/models/face_landmarker.task`: new, locally bundled tracking assets, including both SIMD and non-SIMD WASM variants.
- `public/scripts.js`: independent tracking/detail loops, frame callbacks, warm-up, stale-result handling and correct cleanup.
- `public/index.html`: loads the new track helper, labels tracking performance and identifies version 02.3.
- `scripts/check-install.cjs`: checks the new required assets.
- `package.json` and `tests/`: expanded syntax, asset and tracking-regression checks.
- Documentation and third-party notices.

The original face-api runtime, original model files, gallery photos, prepared reference descriptors, server, npm lockfile and Vercel configuration are preserved. Photo analysis uses the original neural models with the stricter matching policy. The new live tracker displays 68 mapped contour landmarks for up to five faces; it does not generate recognition descriptors.

## Deploy to your existing project

Copy the entire extracted project into the GitHub checkout, including the complete `public/vendor/mediapipe/` directory and new task model. Preserve the checkout's `.git` directory. Commit and push to the branch connected to your existing Vercel project.

The bundled `vercel.json` retains static deployment:

| Setting | Value |
| --- | --- |
| Framework | Other |
| Root directory | Repository root |
| Build command | Empty |
| Output directory | `public` |
| Environment variables | None required |

After deployment, use Ctrl+Shift+R and confirm **STUDIO / 02.3**. Test a camera session and all gallery photos. No live deployment was performed as part of this ZIP correction.

See [CAMERA_FIX.md](CAMERA_FIX.md) for validation and limits, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the bundled tracker source/version.
