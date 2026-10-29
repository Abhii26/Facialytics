<div align="center">

# Facialytics Studio

**Every face. A new perspective.**

A browser-based face recognition and expression analysis studio, built with vanilla JavaScript, face-api.js, Node.js and Express.

[Live demo](https://facialytics.vercel.app/) · [GitHub](https://github.com/Abhii26/Face_Recognition) · [Update and deployment guide](UPGRADE.md)

</div>

## What it does

- An animated, responsive workspace with an SVG face mesh, scanning effects and reduced-motion support.
- Live camera analysis with explicit start, stop, pause, resume, mirror and fullscreen controls.
- Local image analysis for JPG, PNG and WebP photos, including group photos.
- Multiple-face detection, 68-point facial landmarks, known-face matching and unknown-face labels.
- Result cards with detection scores, descriptor distance, expression scores and estimated age/gender.
- Settings for landmarks, labels, expression/attribute results and matching distance threshold.
- Measured landmark updates per second and tracking latency for camera input, and processing time for still images.
- A reference gallery and technology overview with keyboard-accessible dialogs.
- Loading progress, camera-permission guidance and recoverable model/image errors.

The existing bundled face-api.js runtime, model files and reference photos are retained. MediaPipe is vendored for live landmarks; there is no framework migration or additional npm installation step. The deployed version of the live demo depends on the latest production deployment.

## Studio 2.3 unknown-face rejection fix

The complete ZIP runs on a fresh PC. Extract it into a new empty folder; it does not need an existing clone or your old laptop. See [START_HERE.md](START_HERE.md).

Live landmarks now use a separate MediaPipe Face Landmarker worker with CPU/WebAssembly inference. Names, expressions and age/gender estimates use the original face-api.js worker at a slower cadence. Heavy recognition no longer holds up the landmark overlay. All runtime and model assets are bundled locally; no CDN or new npm dependency is required. Studio 2.3 also tightens unknown-face rejection: a name needs sufficient image quality, distance below 0.42 and a lead of at least 0.08 over the second profile. Live names need two consistent samples. See [UNKNOWN_FACE_FIX.md](UNKNOWN_FACE_FIX.md) for these changes and [CAMERA_FIX.md](CAMERA_FIX.md) for the earlier speed fix. Initialization and analysis retain deadlines, cancellation and missing-file guidance.

Select **Image analysis → Or try a gallery photo** for a camera-free first check. Each face-gallery card also has **Analyze this photo**.

## Run locally

Use Node.js 22 or 24 and a modern camera-enabled browser.

```bash
npm ci
npm start
```

Open **http://localhost:4000** and select **Enable camera**, or choose **Image analysis** to try a photo.

Camera access is permitted on localhost. If your existing `certs/create-ca.pem` and `certs/create-ca-key.pem` files are present, the server automatically uses HTTPS instead; follow the URL printed in the terminal. HTTPS is required when accessing a deployed site or a non-localhost address. Do not open `public/index.html` directly as a file.

For automatic local restarts:

```bash
npm run dev
```

The default port is 4000. To use another port in Windows PowerShell:

```powershell
$env:PORT = "5000"
npm start
```

No API key, database or paid AI service is required.

## Project structure

| File or folder | Purpose |
| --- | --- |
| `public/index.html` | Semantic studio interface, input controls and dialogs |
| `public/styles.css` | Responsive theme, animations, focus states and reduced-motion support |
| `public/scripts.js` | Session lifecycle, worker requests, image input, overlays and metrics |
| `public/face-engine.js` | Original photo recognition and slower camera details in a CPU worker |
| `public/camera-engine.js` | Dedicated video landmark tracking with local MediaPipe WebAssembly |
| `public/face-tracks.js` | Visual continuity and two-sample live name confirmation; never replaces current landmark positions |
| `public/recognition-policy.js` | Conservative distance, separation, quality and unknown-rejection rules |
| `public/vendor/mediapipe/` | Pinned MediaPipe 0.10.32 runtime, SIMD/non-SIMD WASM variants and license |
| `public/gallery-descriptors.json` | Prepared reference descriptors with source-photo SHA-256 checks |
| `scripts/check-install.cjs` | Checks required runtime/model files before `npm start` |
| `START_HERE.md` | Fresh-PC instructions and a sample-photo test |
| `public/favicon.svg` | Local application icon |
| `public/face-api.min.js` | Original bundled face-api.js runtime |
| `public/models/` | Original model manifests and weight shards |
| `public/images/` | Original labeled reference photos |
| `server.js` | Local Express static server, with optional existing HTTPS certificates |
| `vercel.json` | Static deployment of `public/` on Vercel |
| `tests/project.test.cjs` | Server, asset, model-manifest and syntax checks |
| `UPGRADE.md` | Code review, changed files, minimal update and live deployment steps |
| `assets/` | Existing screenshots of the previous interface |

## How recognition works

1. The page waits for the user to enable a camera or select an image.
2. Camera mode starts a dedicated video tracker. It maps real face-mesh landmarks to the existing 68-point contour display. Up to five live faces are tracked. Its first inference is warmed up behind the loading overlay.
3. The tracker processes one current camera frame at a time. The next pass uses `requestVideoFrameCallback` (or a timer fallback). Frames never accumulate in a queue, and there is no fixed 200 ms wait after tracking.
4. A second worker computes the original face descriptors, expressions and optional attributes from a copy of a sampled frame. Only one details request can run at once. Initial name confirmation uses two descriptor-only passes with a 250 ms gap; full estimates use a one-second gap after completion. These details update more slowly than the landmarks.
5. Names and estimates attach only to a continuous, unambiguous live track. A normalized visual patch resets identity when appearance changes; it does not authorize identity. Live names require two separate matching descriptor samples; a rejected sample clears confirmation. A lost/crossing track, pause, hidden tab, stopped session or input switch invalidates delayed results. Details expire after six seconds. Slow tracking results older than 300 ms are discarded, and a stalled overlay clears after 350 ms.
6. Photo analysis retains the original Tiny Face Detector, tiny landmark model and recognition/estimate models. Gallery descriptors are reused only after each source photo passes its SHA-256 check. Both modes apply the same stricter open-set acceptance policy.
7. The displayed camera FPS measures landmark updates. The caption also shows capture-to-result latency; it is not the camera frame rate or the frequency of recognition/estimate updates.

Stop and input switching release camera tracks. Pausing analysis leaves the camera on, as indicated in the status message. Names, expressions and attributes can take several seconds on a slower computer while landmarks continue updating. Complex multi-person scenes cost more work. Still-image group analysis retains its existing detection behavior.

Selected images stay in the browser. Images over 12 MB are rejected; accepted images are scaled to a maximum display long edge of 960 pixels; inference uses at most 640 pixels for analysis. This bounds the inference size, but smaller faces in large group photos can still be missed.

## Update the reference gallery

Edit `faceList` near the top of `public/scripts.js`:

```javascript
const faceList = [
  { name: "Sourav", imagePath: "images/sourav.jpg" },
  { name: "Abhishek", imagePath: "images/abhishek.jpg" }
];
```

Place the corresponding consented photos in `public/images/`, then refresh the page. Use clear, front-facing portraits. The gallery dialog is generated from this list; the decorative navigation count/avatar strip is currently styled for the original five profiles.

The matcher threshold defaults to **0.42 Euclidean descriptor distance**, with a hard maximum of **0.45**. The best match must also lead the next gallery profile by at least **0.08**, and the analyzed face must pass basic size, detection, lighting and sharpness checks. A smaller distance represents a closer descriptor match; it is not an accuracy percentage. Uncertain faces stay Unknown. These are conservative operating rules, not a statistical calibration or an identity guarantee. An uncached reference that has no detected face is retried once with a larger detector input and lower detection cutoff, independently of the identity-match threshold. Bundled profiles have already been prepared.

## Deploy to the existing Vercel project

Update this repository and push or merge to the production branch connected to the existing Vercel project. That project can then deploy to the same live domain. Follow [UPGRADE.md](UPGRADE.md) for the copy-and-push steps.

The included configuration selects:

| Setting | Value |
| --- | --- |
| Framework preset | Other (`null`) |
| Build command | Empty; no frontend compilation |
| Output directory | `public` |
| Root directory | Repository root |

Vercel serves the static files directly; it does not need the local certificate files or the Express development server. Keep the existing project and its domains when updating the live demo.

Official references: [Git deployments](https://vercel.com/docs/git), [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json).

## Verify

```bash
npm test
npm run check
```

The 25 included tests check local server startup, linked assets, all eight original model manifests and their shards, reference photos, deployment configuration, JavaScript syntax, prepared-gallery integrity, incomplete installs, WASM MIME types, unknown rejection, confirmation and delayed-detail track association.

Before publishing, also try a camera session, a known reference photo, a group photo and a photo with no faces. Confirm that stop releases the webcam, settings work, and the model files load without 404 errors.

## Scope and data handling

This is a computer vision portfolio demonstration. It does not implement authentication, attendance records, a private enrollment database or liveness detection. A face match is a similarity result, not verified identity. Expression and demographic outputs are model estimates and can be inaccurate.

Camera frames and selected images are not uploaded or saved by this application. The model files and gallery photos are public static assets that visitors download. Use only photos you have permission to publish. No third-party fonts, particle scripts, analytics or API calls are required by the interface.

The original package declares ISC license metadata; third-party runtime/model rights still apply. The source upload did not include a standalone license file.

## Author

[Abhishek Tiwari](https://github.com/Abhii26)
