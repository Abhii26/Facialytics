/* Runs the existing face-api.js models off the UI thread. No frames leave this worker. */
"use strict";

const PIPELINE = "tiny-68-v1";
const nativeFetch = self.fetch.bind(self);
let initialized = false;
let queue = Promise.resolve();
let descriptors = [];
const modelPromises = new Map();

function progress(id, message, percent) {
  self.postMessage({ id, type: "progress", message, percent });
}
async function fetchWithDeadline(input, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await nativeFetch(input, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Could not download ${new URL(response.url || input, self.location.href).pathname} (HTTP ${response.status}). Check that the complete public folder was extracted.`);
    // Consume the response while the deadline is active, including its body.
    const bytes = await response.arrayBuffer();
    return new Response(bytes, { status: response.status, headers: response.headers });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("A model or reference file took too long to download. Check your connection and try again.");
    throw error;
  } finally { clearTimeout(timer); }
}
function canvasFromBitmap(bitmap, maxEdge = 640) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}
function recognitionQuality(face, input) {
  const box = face.detection.box;
  if (face.detection.score < 0.42) return { usable: false, reason: "Face detection is too uncertain" };
  if (Math.min(box.width, box.height) < 28) return { usable: false, reason: "Face is too small; move closer" };
  const sample = new OffscreenCanvas(64, 64);
  const context = sample.getContext("2d", { willReadFrequently: true });
  const x = Math.max(0, box.x), y = Math.max(0, box.y);
  const width = Math.min(input.width - x, box.width), height = Math.min(input.height - y, box.height);
  if (width <= 0 || height <= 0) return { usable: false, reason: "Face is outside the image" };
  context.drawImage(input, x, y, width, height, 0, 0, 64, 64);
  const data = context.getImageData(0, 0, 64, 64).data;
  const gray = new Float32Array(64 * 64);
  for (let index = 0; index < gray.length; index += 1) gray[index] = 0.299 * data[index * 4] + 0.587 * data[index * 4 + 1] + 0.114 * data[index * 4 + 2];
  const mean = gray.reduce((sum, value) => sum + value, 0) / gray.length;
  const contrast = Math.sqrt(gray.reduce((sum, value) => sum + (value - mean) ** 2, 0) / gray.length);
  let total = 0, squared = 0, count = 0;
  for (let row = 1; row < 63; row += 1) for (let col = 1; col < 63; col += 1) {
    const index = row * 64 + col;
    const value = gray[index - 1] + gray[index + 1] + gray[index - 64] + gray[index + 64] - 4 * gray[index];
    total += value; squared += value * value; count += 1;
  }
  const sharpness = squared / count - (total / count) ** 2;
  const metrics = { mean, contrast, sharpness, facePixels: Math.min(box.width, box.height) };
  if (mean < 15 || mean > 245 || contrast < 6) return { ...metrics, usable: false, reason: "Use more even lighting for recognition" };
  if (sharpness < 8) return { ...metrics, usable: false, reason: "Face is too blurred for recognition" };
  return { ...metrics, usable: true };
}
async function boot() {
  if (initialized) return;
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot run background face analysis. Open this page in a recent Chrome, Edge or Firefox browser.");
  }
  // TensorFlow also fetches binary shards directly, outside face-api's env.
  // Cover those requests too so 404/HTML responses cannot become bad tensors.
  self.fetch = fetchWithDeadline;
  importScripts("./face-api.min.js");
  faceapi.env.setEnv({
    Canvas: OffscreenCanvas,
    CanvasRenderingContext2D: OffscreenCanvasRenderingContext2D,
    Image: ImageBitmap,
    ImageData,
    Video: class {},
    createCanvasElement: () => new OffscreenCanvas(1, 1),
    createImageElement: () => { throw new Error("Use a decoded image in the background analyzer."); },
    fetch: fetchWithDeadline,
    readFile: () => { throw new Error("Filesystem access is not used by this application."); }
  });
  // The CPU backend avoids unavailable/blocked GPU acceleration and software
  // WebGL shader stalls on fresh PCs. Expensive work stays off the UI thread.
  await faceapi.tf.setBackend("cpu");
  initialized = true;
}
function loadModel(key, net) {
  if (modelPromises.has(key)) return modelPromises.get(key);
  const promise = net.loadFromUri(new URL("./models", self.location.href).href).catch((error) => {
    modelPromises.delete(key);
    throw new Error(`Could not load ${key}: ${error.message}`);
  });
  modelPromises.set(key, promise);
  return promise;
}
async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function prepareGallery(id, people) {
  let cache = { profiles: [] };
  try {
    const response = await fetchWithDeadline(new URL("./gallery-descriptors.json", self.location.href));
    const value = await response.json();
    if (value.pipeline === PIPELINE && Array.isArray(value.profiles)) cache = value;
  } catch { /* Old/custom galleries are rebuilt from their local photos below. */ }
  const available = [];
  const warnings = [];
  // Hash checks prevent stale cached descriptors when a photo is replaced at
  // the same URL. Unchanged bundled profiles do not run neural inference.
  const references = await Promise.all(people.map(async (person) => {
    try {
      const response = await fetchWithDeadline(new URL(person.imagePath, self.location.href));
      const bytes = await response.arrayBuffer();
      const hash = await sha256(bytes);
      const cached = cache.profiles.find((entry) => entry.name === person.name && entry.imagePath === person.imagePath && entry.sha256 === hash);
      const valid = cached?.descriptors?.length && cached.descriptors.every((vector) => Array.isArray(vector) && vector.length === 128 && vector.every(Number.isFinite));
      return { person, bytes, cached: valid ? cached : null };
    } catch (error) {
      warnings.push(person.name);
      return { person, error: error.message };
    }
  }));
  for (let index = 0; index < references.length; index += 1) {
    const { person, bytes, cached, error } = references[index];
    if (error) continue;
    progress(id, cached ? `Using prepared profile · ${person.name}` : `Preparing new reference · ${person.name}`, 70 + index / people.length * 25);
    if (cached) { available.push({ name: person.name, descriptors: cached.descriptors }); continue; }
    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([bytes]));
      const input = canvasFromBitmap(bitmap);
      let result = await faceapi.detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 })).withFaceLandmarks(true).withFaceDescriptor();
      if (!result) result = await faceapi.detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.15 })).withFaceLandmarks(true).withFaceDescriptor();
      if (result) available.push({ name: person.name, descriptors: [Array.from(result.descriptor)] });
      else warnings.push(person.name);
    } catch { warnings.push(person.name); }
    finally { bitmap?.close(); }
  }
  descriptors = available;
  return { descriptors, warnings };
}
async function initialize(id, people) {
  progress(id, "Starting background analysis…", 3);
  await boot();
  const models = [
    ["fast face detector", faceapi.nets.tinyFaceDetector],
    ["facial landmarks", faceapi.nets.faceLandmark68TinyNet],
    ["face recognition", faceapi.nets.faceRecognitionNet]
  ];
  let loaded = 0;
  const loads = await Promise.allSettled(models.map(async ([name, net]) => {
    await loadModel(name, net);
    loaded += 1;
    progress(id, `Loading models · ${loaded} of ${models.length} ready`, 5 + loaded / models.length * 60);
  }));
  const failure = loads.find((load) => load.status === "rejected");
  if (failure) throw failure.reason;
  progress(id, "Checking prepared gallery profiles…", 68);
  const gallery = await prepareGallery(id, people);
  progress(id, "Ready to analyze your image or camera", 100);
  return { ...gallery, backend: "cpu", pipeline: PIPELINE };
}
async function analyze(id, payload) {
  const { bitmap, width, height, options } = payload;
  try {
    progress(id, "Finding faces in the background…", 85);
    const optional = [];
    if (options.expressions) optional.push(loadModel("expression analysis", faceapi.nets.faceExpressionNet));
    if (options.attributes) optional.push(loadModel("attribute estimates", faceapi.nets.ageGenderNet));
    await Promise.all(optional);
    const input = canvasFromBitmap(bitmap);
    let task = faceapi.detectAllFaces(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 })).withFaceLandmarks(true).withFaceDescriptors();
    if (options.expressions) task = task.withFaceExpressions();
    if (options.attributes) task = task.withAgeAndGender();
    const started = performance.now();
    const result = await task;
    const resized = faceapi.resizeResults(result, { width, height });
    return {
      duration: performance.now() - started,
      faces: resized.map((face, index) => ({
        detection: { score: face.detection.score, box: { x: face.detection.box.x, y: face.detection.box.y, width: face.detection.box.width, height: face.detection.box.height } },
        landmarks: { positions: face.landmarks.positions.map(({ x, y }) => ({ x, y })) },
        descriptor: Array.from(face.descriptor),
        recognitionQuality: recognitionQuality(result[index], input),
        expressions: face.expressions ? { ...face.expressions } : {},
        age: face.age,
        gender: face.gender,
        genderProbability: face.genderProbability
      }))
    };
  } finally { bitmap.close(); }
}
self.onmessage = ({ data }) => {
  // Even rapid input changes never run two TensorFlow jobs together.
  queue = queue.catch(() => {}).then(async () => {
    try {
      let result;
      if (data.type === "init") result = await initialize(data.id, data.payload.profiles);
      else if (data.type === "analyze") result = await analyze(data.id, data.payload);
      else throw new Error("Unsupported analysis request.");
      self.postMessage({ id: data.id, type: "result", result });
    } catch (error) { self.postMessage({ id: data.id, type: "error", error: error.message || "Background analysis failed." }); }
  });
};
