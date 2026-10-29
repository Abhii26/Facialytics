# Studio 2.2 — live camera latency correction

This document records the earlier speed correction and its original measurements. The current ZIP is Studio 2.3; read [UNKNOWN_FACE_FIX.md](UNKNOWN_FACE_FIX.md) for the additional recognition rejection/confirmation rules and current validation.

## Cause

Studio 2.1 put neural inference in a background CPU worker. That kept the page responsive, but every overlay still waited for detection, 68-point landmarks, recognition descriptors, expressions and age/gender estimates to finish. Then the scheduler waited another 200 ms. A fresh frame could therefore be several seconds old by the time its landmarks appeared over the live video.

Simply reducing that timer would not remove the model-execution bottleneck. Running overlapping full inference jobs would introduce additional load and stale results.

## Fix

The camera now has two independent paths:

| Path | Work | Schedule |
| --- | --- | --- |
| Live tracker | MediaPipe video face landmarks, mapped to the existing 68-point contour overlay | One latest frame at a time; next video-frame callback after completion |
| Recognition/details | Original face-api.js detector, descriptors, expressions and optional age/gender | One sampled-frame request at a time; at least one second between completed requests |

The live tracker uses the bundled CPU/WebAssembly runtime. Both SIMD and non-SIMD builds are included. It tracks up to five live faces. First-inference warm-up happens while the loading overlay is visible. No new npm dependency, external CDN or video upload is required.

Names and estimates are associated with the tracked IDs from the same captured frame. Recognition never replaces current bounding boxes or landmarks. Lost, ambiguous/crossing or reset tracks cannot receive an old identity result. Details expire after six seconds; results from a different session, pause/resume epoch, hidden tab or input mode are ignored. A tracking result older than 300 ms is not drawn; an overlay that stops receiving updates clears after 350 ms.

The sidebar refreshes less frequently than the canvas to avoid rebuilding result cards on every landmark pass. Tracking FPS and capture-to-result latency are measured separately from the slower recognition/estimate rate. No detection confidence is invented for MediaPipe's landmark output.

## Measured verification

Measurements below are from this test environment, not a promise for every webcam or PC.

| Test | Observed result |
| --- | --- |
| Original full CPU path, one bundled portrait | 3,289–4,421 ms of inference per pass, before its additional 200 ms scheduling wait |
| New standalone tracker, same portrait after first-pass warm-up | Approximately 51–94 ms per pass |
| Complete new UI with a moving portrait in a synthetic 640 × 480, 30 FPS camera stream; original recognition active alongside it | 95 ms median tracking latency; 158 ms 95th percentile over 60 measured updates after initial samples |
| Actual interval between tracked updates in that moving-camera run | 128 ms median; 208 ms 95th percentile |
| Slower full recognition requests during that moving-camera test | About 3.8–4.1 seconds; did not hold up tracking |

The moving stream was produced from the bundled Abhishek photo with continuous horizontal motion. This tests actual model execution and concurrent worker scheduling, rather than substituting fake face detections. It does not replace testing your physical webcam, lighting and device.

## Validation performed

- `npm test`: 15 passing project/regression checks.
- `npm run check`: all application JavaScript passes syntax checks.
- Real model inference tracked the moving synthetic camera, and recognized Abhishek through the original descriptor model.
- All five gallery photos recognized their expected profiles through the preserved photo-analysis pipeline.
- Pause/resume, face disappearance/reappearance, switching input during details inference, camera-track release and responsive layout were exercised in Chromium.
- Separate compatibility/error checks exercised missing tracker-model recovery, WebGL/GPU disabled, the non-SIMD WASM variant, the timer scheduling fallback, settings, stop and cancellation during startup.
- Requests and public assets use the local application origin. Original runtime/model/photo/cache assets were compared byte-for-byte with the supplied ZIP.

## Try it

Extract the complete ZIP into a new folder, run `npm ci` and `npm start`, and open http://localhost:4000. Hard-refresh and confirm **STUDIO / 02.3**. Enable the camera and move your face. The points should follow the fast tracking loop; names and estimates update separately and can still take seconds on slower devices.

For Vercel, include the entire vendor folder and task model alongside the updated application files. Keep the existing static configuration. This corrected ZIP has not been deployed to your live project.

## Practical limits

This does not force every device to run at 30 or 60 FPS. Browser scheduling, device load, face count, lighting and camera quality affect speed. Large or ambiguous movements can briefly clear a name until a fresh descriptor is available. The continuity guard is not a biometric identity guarantee. Expressions and demographic values remain model estimates. Still photos retain their original processing cost and recognition behavior.

## Primary technical references

- MediaPipe Face Landmarker web guide: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
- Video frame callbacks: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
- Existing face-api.js pipeline: https://github.com/justadudewhohacks/face-api.js
- Pinned tracker files, license and model origin: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
