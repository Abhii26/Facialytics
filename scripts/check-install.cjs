"use strict";
const fs = require("node:fs");
const path = require("node:path");

function missingAssets(root) {
  const required = ["public/index.html", "public/scripts.js", "public/styles.css", "public/face-engine.js", "public/camera-engine.js", "public/face-tracks.js", "public/recognition-policy.js", "public/models/face_landmarker.task", "public/vendor/mediapipe/vision_bundle.js", "public/vendor/mediapipe/wasm/vision_wasm_internal.js", "public/vendor/mediapipe/wasm/vision_wasm_internal.wasm", "public/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js", "public/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm", "public/face-api.min.js", "public/gallery-descriptors.json"];
  for (const model of ["tiny_face_detector", "face_landmark_68_tiny", "face_recognition", "face_expression", "age_gender"]) {
    const manifest = `public/models/${model}_model-weights_manifest.json`;
    required.push(manifest);
    try {
      for (const group of JSON.parse(fs.readFileSync(path.join(root, manifest), "utf8"))) {
        for (const shard of group.paths) required.push(`public/models/${shard}`);
      }
    } catch { /* Missing or invalid manifests are listed below. */ }
  }
  return required.filter((asset) => {
    try { return !fs.statSync(path.join(root, asset)).size; }
    catch { return true; }
  });
}
module.exports = { missingAssets };
if (require.main === module) {
  const missing = missingAssets(path.join(__dirname, ".."));
  if (missing.length) {
    console.error("\nFacialytics cannot start because this folder is incomplete.\nExtract Facialytics-Studio-Complete.zip into a NEW empty folder.\nThe update-only ZIP cannot run by itself.\n\nMissing files:\n" + missing.map((file) => `  ${file}`).join("\n"));
    process.exitCode = 1;
  } else console.log("Facialytics Studio 2.3 · required application and model files are present.");
}
