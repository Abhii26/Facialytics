/* Dedicated low-latency camera landmarks. All assets are bundled locally. */
"use strict";

let tracker;
let timestamp = 0;
let busy = false;
const appearanceCanvas = new OffscreenCanvas(12, 12);
const appearanceContext = appearanceCanvas.getContext("2d", { willReadFrequently: true });

function appearance(bitmap, box, width, height) {
  // A small normalized patch only detects visual discontinuities. It does
  // not authorize identity; recognition still requires face descriptors.
  const sx = bitmap.width / width, sy = bitmap.height / height;
  appearanceContext.drawImage(bitmap, (box.x + box.width * 0.1) * sx, (box.y + box.height * 0.1) * sy,
    box.width * 0.8 * sx, box.height * 0.8 * sy, 0, 0, 12, 12);
  const data = appearanceContext.getImageData(0, 0, 12, 12).data;
  const values = Array.from({ length: 144 }, (_, index) => 0.299 * data[index * 4] + 0.587 * data[index * 4 + 1] + 0.114 * data[index * 4 + 2]);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = Math.max(12, Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length));
  return values.map((value) => (value - mean) / deviation);
}

// Display the familiar 68-point contours using measured mesh landmarks.
// Recognition descriptors continue to use the original face-api pipeline.
const CONTOURS = [
  234, 93, 132, 58, 172, 136, 150, 149, 152, 378, 379, 365, 397, 288, 361, 323, 454,
  70, 63, 105, 66, 107, 336, 296, 334, 293, 300,
  168, 6, 197, 4, 98, 97, 2, 326, 327,
  33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380,
  61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91,
  78, 81, 13, 311, 308, 402, 14, 178
];

async function initialize() {
  if (tracker) return { backend: "wasm", points: 68 };
  if (typeof OffscreenCanvas === "undefined") throw new Error("Live tracking needs a recent Chrome, Edge or Firefox browser.");
  // The pinned upstream CommonJS bundle exports onto this worker-only object.
  self.exports = {};
  importScripts("./vendor/mediapipe/vision_bundle.js");
  const { FaceLandmarker, FilesetResolver } = self.exports;
  const files = await FilesetResolver.forVisionTasks(new URL("./vendor/mediapipe/wasm", self.location.href).href);
  tracker = await FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: new URL("./models/face_landmarker.task", self.location.href).href, delegate: "CPU" },
    runningMode: "VIDEO",
    numFaces: 5,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false
  });
  return { backend: "wasm", points: 68 };
}

function track({ bitmap, width, height, capturedAt }) {
  try {
    if (!tracker) throw new Error("Camera tracker is not ready.");
    const started = performance.now();
    timestamp = Math.max(timestamp + 1, capturedAt);
    const result = tracker.detectForVideo(bitmap, timestamp);
    const faces = result.faceLandmarks.map((mesh) => {
      const xs = mesh.map((point) => point.x * width);
      const ys = mesh.map((point) => point.y * height);
      const x = Math.min(width, Math.max(0, Math.min(...xs)));
      const y = Math.min(height, Math.max(0, Math.min(...ys)));
      const right = Math.max(x, Math.min(width, Math.max(...xs)));
      const bottom = Math.max(y, Math.min(height, Math.max(...ys)));
      const box = { x, y, width: right - x, height: bottom - y };
      return {
        // Face Landmarker does not expose a detection probability. Do not
        // fabricate one from its configured minimum confidence threshold.
        detection: { score: null, box },
        appearance: appearance(bitmap, box, width, height),
        landmarks: { positions: CONTOURS.map((index) => ({ x: xs[index], y: ys[index] })) },
        expressions: {}
      };
    });
    return { faces, duration: performance.now() - started };
  } finally { bitmap.close(); }
}

self.onmessage = async ({ data }) => {
  // The page sends only one frame at a time. Never queue stale camera frames.
  if (busy) {
    data.payload?.bitmap?.close();
    self.postMessage({ id: data.id, type: "error", error: "The live tracker is busy." });
    return;
  }
  busy = true;
  try {
    const result = data.type === "init" ? await initialize() : track(data.payload);
    self.postMessage({ id: data.id, type: "result", result });
  } catch (error) {
    self.postMessage({ id: data.id, type: "error", error: error.message || "Live tracking failed." });
  } finally { busy = false; }
};
