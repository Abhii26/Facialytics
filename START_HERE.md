# Facialytics Studio 2.3 — unknown-face rejection fix

1. Extract this **complete ZIP into a new empty folder**. `package.json`, `server.js` and `public/` should be directly inside it.
2. With Node.js 22 or 24 installed, open a terminal in that folder and run:

```bash
npm ci
npm start
```

3. Open **http://localhost:4000** in a recent Chrome, Edge or Firefox browser. Check the version label reads **STUDIO / 02.3**. Use **Ctrl+Shift+R** if necessary. Stop an older server with Ctrl+C before starting this folder.
4. Select **Live camera → Enable camera**. Allow camera access and let initialization/warm-up finish. Move your head: the points use the new fast video tracker. The Tracking rate card shows measured FPS and latency in milliseconds.
5. Names, expression estimates and age/gender estimates update separately. Their slower update rate does not hold up the facial points. A live name appears only after two consistent recognition samples, so its first confirmation can take several seconds. Unfamiliar, ambiguous, blurry or poorly lit faces remain Unknown.
6. Check **Pause → Resume**, **Mirror camera**, and **Stop camera**. Stop releases the webcam.
7. Check **Image analysis → Or try a gallery photo**, then **Face gallery → Analyze this photo** for each profile. These retain the original models and use the stricter matching rules.

All models and browser runtime files are included. After npm installation, the app makes no external runtime requests. Do not omit `public/vendor/mediapipe/`, either WASM variant, or `public/models/face_landmarker.task` when updating GitHub/Vercel.

## GitHub / Vercel update

Replace your repository contents with the complete extracted project, preserving your `.git` directory when working in a clone. Commit/push the changes to the branch used by the existing Vercel project. Keep its static deployment settings: framework **Other**, output directory **public**, no build command. Then hard-refresh the deployed page and confirm **STUDIO / 02.3**. The ZIP contains the fix; deploying it is a separate step.

## Troubleshooting

- **Old version:** stop the old local server, start this folder, and hard-refresh.
- **Folder is incomplete:** follow the missing paths printed by `npm start` and extract the complete ZIP again.
- **Camera blocked:** allow access in the browser and use HTTPS or localhost.
- **Tracker cannot load / 404:** check the new vendor folder and task model were copied/deployed in full.
- **Landmarks briefly disappear under heavy load:** stale results are intentionally discarded. Close other busy apps, keep the tab visible and try good lighting. Speed depends on the device/browser.
- **A known face stays Unknown:** use an evenly lit, sharp frontal view and allow two live samples. Keep the threshold at its default 0.42. A difficult view can be rejected; do not restore the old permissive threshold.
- **Names/estimates take longer:** these run separately and are expected to update more slowly than landmarks.

Optional checks:

```bash
npm test
npm run check
```

Read [UNKNOWN_FACE_FIX.md](UNKNOWN_FACE_FIX.md) for the recognition correction and [CAMERA_FIX.md](CAMERA_FIX.md) for the earlier tracking speed fix. This is a face-recognition demonstration; it is not identity verification.
