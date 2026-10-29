/* Facialytics Studio. Keep the existing face-api.js runtime and model assets. */
"use strict";

// Add or change reference profiles here; no model retraining is needed.
const faceList = [
  { name: "Sourav", imagePath: "images/sourav.jpg" },
  { name: "Abhishek", imagePath: "images/abhishek.jpg" },
  { name: "Himanshu Sir", imagePath: "images/himanshu.jpg" },
  { name: "Priya Mam", imagePath: "images/priya.jpg" },
  { name: "Daksh", imagePath: "images/daksh.jpg" }
];

(() => {
  const $ = (id) => document.getElementById(id);
  const video = $("videoId");
  const image = $("uploadedImage");
  const canvas = $("canvas");
  const context = canvas.getContext("2d");
  const frame = $("mediaFrame");
  const state = {
    mode: "camera", stream: null, running: false, paused: false, loading: false,
    session: 0, timer: null, enginePromise: null, descriptors: [], matcher: null,
    worker: null, jobs: new Map(), nextJob: 0, loadingTimer: null, loadingStarted: 0,
    cameraWorker: null, cameraJobs: new Map(), nextCameraJob: 0,
    videoCallback: null, overlayTimer: null, liveEpoch: 0,
    tracks: new FacialyticsTracks.FaceTracks(), detailTask: null, nextDetailAt: 0, lastSidebarUpdate: 0,
    inferenceTask: null, lastResults: [], lastDuration: 0, lastRender: 0,
    history: Array(38).fill(0), threshold: FacialyticsRecognition.DEFAULT_THRESHOLD, imageUrl: null, galleryWarnings: [],
    options: { landmarks: true, labels: true, expressions: true, attributes: true, mirror: true }
  };
  const emptyResults = $("detectionsList").innerHTML;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function icon(name) {
    return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
  function setStatus(text, live = false) {
    $("cameraStatus").textContent = text;
    $("cameraStatusDot").classList.toggle("live", live);
  }
  function setError(message = "") {
    $("errorMessage").textContent = message;
    $("errorMessage").hidden = !message;
  }
  function setLoading(loading, message = "Preparing your studio…") {
    state.loading = loading;
    clearInterval(state.loadingTimer);
    if (loading) {
      state.loadingStarted = performance.now();
      $("loadingElapsed").textContent = "Starting…";
      state.loadingTimer = setInterval(() => {
        const seconds = Math.floor((performance.now() - state.loadingStarted) / 1000);
        $("loadingElapsed").textContent = `${seconds}s elapsed · analysis runs in the background`;
      }, 1000);
    }
    $("loadingOverlay").hidden = !loading;
    $("loadingMessage").textContent = message;
    $("startCamera").disabled = loading;
    $("chooseImage").disabled = loading;
    $("replaceImage").disabled = loading;
    $("pauseButton").disabled = loading || !state.running || state.mode !== "camera";
  }
  function loadProgress(message, percent) {
    if (!state.loading) return;
    state.lastStage = message;
    $("loadingMessage").textContent = message;
    $("loadProgressBar").style.width = `${percent}%`;
  }
  function cameraError(error) {
    const messages = {
      NotAllowedError: "Camera access was blocked. Allow camera access using the icon beside your browser’s address bar, then try again.",
      PermissionDeniedError: "Camera access was blocked. Allow camera access in your browser, then try again.",
      NotFoundError: "No camera was found. Connect a webcam, or switch to Image analysis to try a photo.",
      DevicesNotFoundError: "No camera was found. Connect a webcam, or try Image analysis.",
      NotReadableError: "Your camera could not start. Close other apps using it, then try again.",
      TrackStartError: "Your camera is busy. Close other camera apps and try again.",
      OverconstrainedError: "This camera does not support the requested settings. Try another camera or use Image analysis.",
      SecurityError: "Camera access needs HTTPS or localhost. Open the live Vercel link or run the app on localhost."
    };
    return messages[error.name] || error.message || "Something interrupted the analysis. Please try again.";
  }

  function destroyWorker(message = "Analysis cancelled.") {
    state.worker?.terminate();
    state.worker = null;
    state.enginePromise = null;
    for (const job of state.jobs.values()) { clearTimeout(job.timer); job.reject(new Error(message)); }
    state.jobs.clear();
  }
  function ensureWorker() {
    if (state.worker) return;
    if (!window.Worker || !window.createImageBitmap) throw new Error("Background analysis is not supported here. Use a recent Chrome, Edge or Firefox browser.");
    const worker = new Worker("./face-engine.js?v=2.3");
    state.worker = worker;
    worker.onmessage = ({ data }) => {
      if (state.worker !== worker) return;
      const job = state.jobs.get(data.id);
      if (!job) return;
      if (data.type === "progress") { loadProgress(data.message, data.percent); return; }
      clearTimeout(job.timer);
      state.jobs.delete(data.id);
      if (data.type === "error") job.reject(new Error(data.error));
      else job.resolve(data.result);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (state.worker === worker) destroyWorker("The background analyzer could not start. Check that public/face-engine.js and public/face-api.min.js are present, then try again.");
    };
  }
  function workerRequest(type, payload, transfer = [], timeout = 30000) {
    ensureWorker();
    const id = ++state.nextJob;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        destroyWorker(type === "init"
          ? `Setup stopped after 60 seconds at “${state.lastStage || "loading models"}”. Confirm that the complete ZIP is extracted and try again.`
          : "Analysis took longer than 30 seconds and was stopped. Try a smaller, clear portrait or close other busy apps, then try again.");
      }, timeout);
      state.jobs.set(id, { resolve, reject, timer });
      try { state.worker.postMessage({ id, type, payload }, transfer); }
      catch (error) { clearTimeout(timer); state.jobs.delete(id); reject(error); }
    });
  }
  async function prepareEngine() {
    if (state.enginePromise) return state.enginePromise;
    const promise = (async () => {
      const prepared = await workerRequest("init", { profiles: faceList }, [], 60000);
      state.descriptors = prepared.descriptors;
      state.galleryWarnings = prepared.warnings;
      updateMatcher();
      loadProgress("Your studio is ready", 100);
    })();
    state.enginePromise = promise;
    promise.catch(() => { if (state.enginePromise === promise) state.enginePromise = null; });
    return promise;
  }
  function destroyCameraWorker(message = "Live tracking cancelled.") {
    state.cameraWorker?.terminate();
    state.cameraWorker = null;
    for (const job of state.cameraJobs.values()) { clearTimeout(job.timer); job.reject(new Error(message)); }
    state.cameraJobs.clear();
  }
  function cameraRequest(type, payload, transfer = []) {
    if (!state.cameraWorker) {
      const worker = new Worker("./camera-engine.js?v=2.3");
      state.cameraWorker = worker;
      worker.onmessage = ({ data }) => {
        if (state.cameraWorker !== worker) return;
        const job = state.cameraJobs.get(data.id);
        if (!job) return;
        clearTimeout(job.timer);
        state.cameraJobs.delete(data.id);
        if (data.type === "error") job.reject(new Error(data.error));
        else job.resolve(data.result);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        destroyCameraWorker("The live tracker could not load. Check public/camera-engine.js and public/vendor/mediapipe, or try a recent Chrome, Edge or Firefox browser.");
      };
    }
    const id = ++state.nextCameraJob;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Live tracking could not start. Check the complete ZIP includes public/vendor/mediapipe and public/models/face_landmarker.task, then retry."));
        state.cameraJobs.delete(id);
        destroyCameraWorker();
      }, 25000);
      state.cameraJobs.set(id, { resolve, reject, timer });
      try { state.cameraWorker.postMessage({ id, type, payload }, transfer); }
      catch (error) { clearTimeout(timer); state.cameraJobs.delete(id); reject(error); }
    });
  }
  async function cameraBitmap() {
    const ratio = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    return createImageBitmap(video, { resizeWidth: Math.max(1, Math.round(video.videoWidth * ratio)), resizeHeight: Math.max(1, Math.round(video.videoHeight * ratio)), resizeQuality: "low" });
  }
  function updateMatcher() {
    state.matcher = FacialyticsRecognition.createMatcher(state.descriptors, state.threshold);
  }
  function showGalleryWarnings() {
    if (!state.galleryWarnings.length) return;
    setError(`Could not prepare ${state.galleryWarnings.join(", ")}. Other available profiles and face detection still work. Check these reference photos.`);
  }

  function resetResults() {
    state.lastResults = [];
    state.lastDuration = 0;
    state.lastRender = 0;
    state.history.fill(0);
    $("facesCount").textContent = "00";
    $("recognizedCount").textContent = "00";
    $("resultCount").textContent = "0";
    $("analysisRate").innerHTML = "— <small>FPS</small>";
    $("analysisRate").removeAttribute("title");
    $("chartCaption").textContent = "Your session activity will appear here.";
    $("detectionsList").innerHTML = emptyResults;
    $("insightsBadge").textContent = "STANDBY";
    $("insightsBadge").classList.remove("live");
    $("signalChart").classList.remove("active");
    drawChart();
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
  function stopSession({ keepError = false } = {}) {
    state.session += 1;
    state.liveEpoch += 1;
    if (state.videoCallback !== null) video.cancelVideoFrameCallback?.(state.videoCallback);
    state.videoCallback = null;
    clearTimeout(state.overlayTimer);
    destroyCameraWorker();
    state.tracks.reset();
    state.detailTask = null;
    state.nextDetailAt = 0;
    state.lastSidebarUpdate = 0;
    state.sampleAbort?.abort();
    state.sampleAbort = null;
    if (state.jobs.size) destroyWorker();
    state.running = false;
    state.paused = false;
    clearTimeout(state.timer);
    state.timer = null;
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    video.pause();
    video.srcObject = null;
    video.hidden = true;
    image.hidden = true;
    image.removeAttribute("src");
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = null;
    canvas.hidden = true;
    frame.classList.remove("has-source", "is-mirrored");
    $("cameraPlaceholder").hidden = false;
    $("pausedBadge").hidden = true;
    $("performanceLabel").textContent = state.mode === "camera" ? "Tracking rate" : "Processing time";
    $("feedState").textContent = state.mode === "camera" ? "CAMERA OFF" : "IMAGE MODE";
    $("feedBadge").classList.remove("live");
    $("frameResolution").textContent = "AWAITING INPUT";
    $("frameDetail").textContent = "LOCAL INFERENCE / NO VIDEO UPLOADS";
    $("stopCamera").disabled = true;
    $("pauseButton").innerHTML = icon("pause");
    $("pauseButton").setAttribute("aria-label", "Pause analysis");
    $("pauseButton").title = "Pause analysis";
    setLoading(false);
    setStatus("Ready when you are");
    resetResults();
    if (!keepError) setError();
  }

  async function startCamera() {
    if (state.running || state.loading) return;
    stopSession();
    const session = state.session;
    $("stopCamera").disabled = false; // Can cancel model loading or a pending camera prompt.
    setLoading(true, "Waiting for your camera permission…");
    setStatus("Waiting for camera access");
    $("loadProgressBar").style.width = "0%";
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new DOMException("Camera access needs HTTPS or localhost.", "SecurityError");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false });
      if (session !== state.session) { stream.getTracks().forEach((track) => track.stop()); return; }
      state.stream = stream;
      video.srcObject = stream;
      await video.play();
      if (session !== state.session) return;
      loadProgress("Loading your face analysis models…", 5);
      setStatus("Preparing recognition models");
      await Promise.all([prepareEngine(), cameraRequest("init", {})]);
      if (session !== state.session) return;
      loadProgress("Warming up live face tracking…", 98);
      const warmup = await cameraBitmap();
      if (session !== state.session) { warmup.close(); return; }
      await cameraRequest("track", { bitmap: warmup, width: video.videoWidth, height: video.videoHeight, capturedAt: performance.now() }, [warmup]);
      if (session !== state.session) return;
      state.running = true;
      video.hidden = false;
      canvas.hidden = false;
      frame.classList.add("has-source");
      frame.classList.toggle("is-mirrored", state.options.mirror);
      $("cameraPlaceholder").hidden = true;
      $("feedState").textContent = "LIVE CAMERA";
      $("feedBadge").classList.add("live");
      $("insightsBadge").textContent = "LIVE";
      $("insightsBadge").classList.add("live");
      setLoading(false);
      setStatus("Camera is live · analyzing", true);
      showGalleryWarnings();
      stream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => {
        if (session !== state.session) return;
        stopSession();
        setError("The camera was disconnected or access was revoked. Reconnect it and try again.");
      }));
      scheduleAnalysis(session);
    } catch (error) {
      if (session !== state.session) return;
      stopSession();
      setStatus("Camera could not start");
      setError(cameraError(error));
    }
  }

  function scheduleAnalysis(session) {
    clearTimeout(state.timer);
    if (session !== state.session || !state.running || state.mode !== "camera") return;
    if (state.paused || document.hidden || video.readyState < 2) {
      state.timer = setTimeout(() => scheduleAnalysis(session), 200);
      return;
    }
    const run = async () => {
      state.videoCallback = null;
      if (session !== state.session || !state.running) return;
      if (state.paused || document.hidden) { scheduleAnalysis(session); return; }
      try { await trackCamera(session); }
      catch (error) {
        if (session !== state.session) return;
        stopSession();
        setStatus("Analysis interrupted");
        setError(`Analysis stopped: ${cameraError(error)}`);
        return;
      }
      scheduleAnalysis(session);
    };
    // Take the newest presented camera frame only when the tracker is free.
    // There is no inference backlog and no artificial 200 ms per-frame wait.
    if (video.requestVideoFrameCallback) state.videoCallback = video.requestVideoFrameCallback(run);
    else state.timer = setTimeout(run, 16);
  }

  async function trackCamera(session) {
    const epoch = state.liveEpoch;
    const started = performance.now();
    const width = video.videoWidth;
    const height = video.videoHeight;
    const bitmap = await cameraBitmap();
    let detailBitmap;
    let transferred = false;
    try {
      // Clone only when the slower detail worker is free. Both workers see
      // the same captured frame; its tracked IDs anchor the delayed details.
      if (!state.detailTask && started >= state.nextDetailAt) detailBitmap = await createImageBitmap(bitmap);
      if (session !== state.session || epoch !== state.liveEpoch || state.paused || document.hidden) return;
      const request = cameraRequest("track", { bitmap, width, height, capturedAt: started }, [bitmap]);
      transferred = true;
      const result = await request;
      if (session !== state.session || epoch !== state.liveEpoch || state.paused || document.hidden) return;
      const completed = performance.now();
      state.lastDuration = completed - started;
      // A suspended/overloaded tab must not paint a very old facial position.
      if (state.lastDuration > 300) {
        state.tracks.reset();
        state.lastResults = [];
        renderResults();
        return;
      }
      const fps = state.lastRender ? 1000 / (completed - state.lastRender) : 1000 / state.lastDuration;
      state.lastRender = completed;
      state.lastResults = state.tracks.update(result.faces, completed);
      renderResults(false);
      clearTimeout(state.overlayTimer);
      state.overlayTimer = setTimeout(() => {
        if (session !== state.session || state.paused) return;
        state.tracks.reset();
        state.lastResults = [];
        renderResults();
      }, 350);
      if (completed - state.lastSidebarUpdate >= 200) {
        state.lastSidebarUpdate = completed;
        renderResults();
        state.history.shift(); state.history.push(fps); drawChart();
        $("signalChart").classList.add("active");
        $("analysisRate").innerHTML = `${fps.toFixed(1)} <small>FPS</small>`;
        $("analysisRate").title = `Latest tracking latency: ${Math.round(state.lastDuration)} ms`;
        $("chartCaption").textContent = `Landmark updates · ${Math.round(state.lastDuration)} ms latency · estimates update separately`;
        $("frameDetail").textContent = `${result.faces.length} FACE${result.faces.length === 1 ? "" : "S"} TRACKED / LOCAL ANALYSIS`;
      }
      if (detailBitmap && result.faces.length) {
        refreshCameraDetails(detailBitmap, width, height, session, epoch, state.tracks.snapshot());
        detailBitmap = null; // Ownership passed to the detail request.
      }
    } finally { if (!transferred) bitmap.close(); detailBitmap?.close(); }
  }

  function refreshCameraDetails(bitmap, width, height, session, epoch, snapshot) {
    const requestedOptions = { ...state.options };
    const identityOnly = state.tracks.needsConfirmation();
    // Confirm a new name with two lightweight descriptor passes first.
    // Estimates follow separately, including for faces rejected as unknown.
    const options = { ...requestedOptions,
      expressions: !identityOnly && requestedOptions.expressions,
      attributes: !identityOnly && requestedOptions.attributes };
    const started = performance.now();
    let transferred = false;
    const pending = (async () => {
      try {
        await prepareEngine();
        if (session !== state.session || epoch !== state.liveEpoch) return { faces: [] };
        const request = workerRequest("analyze", { bitmap, width, height, options }, [bitmap]);
        transferred = true;
        return await request;
      } finally { if (!transferred) bitmap.close(); }
    })();
    state.detailTask = pending;
    pending.then((result) => {
      if (session !== state.session || epoch !== state.liveEpoch || state.paused || document.hidden || performance.now() - started > 6000) return;
      if (requestedOptions.expressions !== state.options.expressions || requestedOptions.attributes !== state.options.attributes) return;
      state.tracks.applyDetails(result.faces, snapshot, performance.now(), (face) => state.matcher.findBestMatch(face.descriptor, face.recognitionQuality));
      state.lastResults = state.tracks.faces(performance.now());
      renderResults();
    }).catch((error) => {
      if (session === state.session && epoch === state.liveEpoch) setError(`Face tracking is still live. Recognition/estimates could not update: ${error.message}`);
    }).finally(() => {
      if (state.detailTask === pending) {
        state.detailTask = null;
        state.nextDetailAt = performance.now() + (identityOnly ? 250 : 1000);
      }
    });
  }

  async function analyze(source, session) {
    // A single-flight queue also covers rapid switching between images and camera.
    if (state.inferenceTask) {
      try { await state.inferenceTask; } catch { /* The original caller handles its error. */ }
    }
    if (session !== state.session || (state.mode === "camera" && state.paused)) return;
    const started = performance.now();
    const width = state.mode === "camera" ? source.videoWidth : source.naturalWidth;
    const height = state.mode === "camera" ? source.videoHeight : source.naturalHeight;
    const ratio = Math.min(1, 640 / Math.max(width, height));
    const bitmap = await createImageBitmap(source, { resizeWidth: Math.max(1, Math.round(width * ratio)), resizeHeight: Math.max(1, Math.round(height * ratio)), resizeQuality: "medium" });
    if (session !== state.session) { bitmap.close(); return; }
    const pending = workerRequest("analyze", { bitmap, width, height, options: { ...state.options } }, [bitmap]);
    state.inferenceTask = pending;
    let results;
    try { results = (await pending).faces; }
    finally { if (state.inferenceTask === pending) state.inferenceTask = null; }
    if (session !== state.session || (state.mode === "camera" && state.paused)) return;
    state.lastDuration = performance.now() - started;
    const completed = performance.now();
    const fps = state.lastRender ? 1000 / (completed - state.lastRender) : 1000 / state.lastDuration;
    state.lastRender = completed;
    state.lastResults = results;
    renderResults();
    if (state.mode === "camera") {
      state.history.shift();
      state.history.push(fps);
      drawChart();
      $("signalChart").classList.add("active");
      $("analysisRate").innerHTML = `${fps.toFixed(1)} <small>FPS</small>`;
      $("chartCaption").textContent = "Measured analysis updates · not camera frame rate";
    } else {
      $("analysisRate").innerHTML = `${Math.round(state.lastDuration)} <small>MS</small>`;
      $("chartCaption").textContent = "Processing time for this image";
    }
    $("frameDetail").textContent = `${results.length} FACE${results.length === 1 ? "" : "S"} DETECTED / ON-DEVICE ANALYSIS`;
  }

  function getMatches() {
    return state.lastResults.map((face) => {
      let match = face.descriptor?.length === 128
        ? (state.matcher ? state.matcher.findBestMatch(face.descriptor, face.recognitionQuality) : { label: "unknown", distance: null })
        : { label: "pending", distance: null };
      if (state.mode === "camera" && match.label !== "unknown" && match.label !== "pending"
        && (!face.identityConfirmed || face.confirmedLabel !== match.label)) {
        match = { label: "pending", distance: match.distance, reason: "Waiting for a second consistent sample" };
      }
      return { face, match };
    });
  }
  function renderResults(updateSidebar = true) {
    const matches = getMatches();
    if (!updateSidebar) { drawOverlay(matches); return; }
    const known = matches.filter(({ match }) => match.label !== "unknown" && match.label !== "pending").length;
    $("facesCount").textContent = String(matches.length).padStart(2, "0");
    $("recognizedCount").textContent = String(known).padStart(2, "0");
    $("resultCount").textContent = String(matches.length);
    if (!matches.length) {
      $("detectionsList").innerHTML = `<div class="empty-results"><div class="empty-icon">${icon("scan")}</div><p>No face in this frame, yet.</p><span>Face the camera in good lighting,<br>or try a clearer photo.</span></div>`;
    } else {
      const html = matches.map(({ face, match }, index) => {
        const person = faceList.find((item) => item.name === match.label);
        const pending = match.label === "pending";
        const name = person ? person.name : pending ? "Recognizing…" : `Unknown face ${index + 1}`;
        const scoreLabel = face.detection.score === null ? "Live face track" : `Detection ${Math.round(face.detection.score * 100)}%`;
        const expressions = Object.entries(face.expressions || {}).sort((a, b) => b[1] - a[1]);
        const [expression, expressionScore] = expressions[0] || [null, 0];
        const expressionPercent = Math.round(expressionScore * 100);
        const avatar = person ? `<img src="${escapeHtml(person.imagePath)}" alt="">` : String(index + 1).padStart(2, "0");
        const distance = Number.isFinite(match.distance) ? ` · distance ${match.distance.toFixed(2)}` : "";
        const expressionHtml = state.options.expressions ? `<span class="result-chip expression">${expression ? `${escapeHtml(expression)} · ${expressionPercent}%` : "Updating expressions…"}</span>` : "";
        const attributeHtml = state.options.attributes ? (Number.isFinite(face.age)
          ? `<span class="result-chip">~${Math.round(face.age)} years</span><span class="result-chip">${escapeHtml(face.gender)} · ${Math.round(face.genderProbability * 100)}%</span>`
          : `<span class="result-chip">Updating estimates…</span>`) : "";
        const rejectionHtml = !person && match.reason ? `<span class="result-chip">${escapeHtml(match.reason)}</span>` : "";
        return `<article class="detection-result"><div class="result-main"><div class="result-avatar">${avatar}</div><div class="result-name"><strong>${escapeHtml(name)}</strong><small>${scoreLabel}${distance}</small></div><span class="match-indicator ${person ? "" : "unknown"}">${person ? "MATCHED" : pending ? "CHECKING" : "UNKNOWN"}</span></div><div class="result-details">${rejectionHtml}${expressionHtml}${attributeHtml}</div>${state.options.expressions && expression ? `<div class="expression-meter"><span>Expression model estimate</span><span>${expressionPercent}%</span></div><div class="expression-bar"><span style="width:${expressionPercent}%"></span></div>` : ""}</article>`;
      }).join("");
      // Do not replace the DOM every pass when visible values have not changed.
      if ($("detectionsList").innerHTML !== html) $("detectionsList").innerHTML = html;
    }
    drawOverlay(matches);
  }

  function drawOverlay(matches) {
    const source = state.mode === "camera" ? video : image;
    const width = state.mode === "camera" ? source.videoWidth : source.naturalWidth;
    const height = state.mode === "camera" ? source.videoHeight : source.naturalHeight;
    if (!width || !height) return;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    $("frameResolution").textContent = `${width} × ${height}`;
    context.clearRect(0, 0, width, height);
    const mirror = state.mode === "camera" && state.options.mirror;
    const scale = Math.max(1, width / 720);
    matches.forEach(({ face, match }) => {
      const box = face.detection.box;
      const x = mirror ? width - box.x - box.width : box.x;
      const color = match.label === "unknown" || match.label === "pending" ? "#f3c3a2" : "#d8f99c";
      context.strokeStyle = color;
      context.lineWidth = 1.5 * scale;
      context.fillStyle = `${color}09`;
      context.fillRect(x, box.y, box.width, box.height);
      context.strokeRect(x, box.y, box.width, box.height);
      const corner = Math.min(18 * scale, box.width / 5);
      context.lineWidth = 3 * scale;
      [[x, box.y, 1, 1], [x + box.width, box.y, -1, 1], [x, box.y + box.height, 1, -1], [x + box.width, box.y + box.height, -1, -1]].forEach(([cx, cy, dx, dy]) => {
        context.beginPath();context.moveTo(cx + dx * corner, cy);context.lineTo(cx, cy);context.lineTo(cx, cy + dy * corner);context.stroke();
      });
      if (state.options.landmarks && face.landmarks) {
        context.fillStyle = "#d8f99c";
        const points = face.landmarks.positions;
        points.forEach((point) => { context.beginPath();context.arc(mirror ? width - point.x : point.x, point.y, 1.35 * scale, 0, Math.PI * 2);context.fill(); });
        context.strokeStyle = "#d8f99c66";context.lineWidth = .7 * scale;
        [[0,16],[17,21],[22,26],[27,30],[31,35],[36,41],[42,47],[48,59],[60,67]].forEach(([start,end]) => {
          context.beginPath();for(let i=start;i<=end;i+=1){const p=points[i];if(!p)continue;const px=mirror?width-p.x:p.x;if(i===start)context.moveTo(px,p.y);else context.lineTo(px,p.y);}if(start>=36)context.closePath();context.stroke();
        });
      }
      if (state.options.labels) {
        const name = match.label === "unknown" ? "Unknown face" : match.label === "pending" ? "Recognizing…" : match.label;
        const label = face.detection.score === null ? name : `${name} · ${Math.round(face.detection.score * 100)}% detected`;
        context.font = `500 ${12 * scale}px "Segoe UI", Arial, sans-serif`;
        const padding = 9 * scale;
        const labelWidth = Math.min(context.measureText(label).width + padding * 2, width);
        const labelHeight = 27 * scale;
        const labelX = Math.max(0, Math.min(x, width - labelWidth));
        const labelY = Math.max(0, box.y - labelHeight - 4 * scale);
        context.fillStyle = color;context.fillRect(labelX, labelY, labelWidth, labelHeight);
        context.fillStyle = "#192014";context.fillText(label, labelX + padding, labelY + 18 * scale);
      }
    });
  }
  function drawChart() {
    const max = Math.max(5, ...state.history);
    $("signalChart").innerHTML = state.history.map((value) => `<i style="height:${value ? Math.max(3, (value / max) * 29) : 2}px"></i>`).join("");
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    stopSession();
    state.mode = mode;
    const cameraMode = mode === "camera";
    [$("cameraTab"), $("imageTab")].forEach((tab, index) => {
      const selected = cameraMode ? index === 0 : index === 1;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    $("cameraPanel").setAttribute("aria-labelledby", cameraMode ? "cameraTab" : "imageTab");
    $("startCamera").hidden = !cameraMode;
    $("chooseImage").hidden = cameraMode;
    $("useSamplePhoto").hidden = cameraMode;
    $("stopCamera").hidden = !cameraMode;
    $("replaceImage").hidden = cameraMode;
    $("pauseButton").hidden = !cameraMode;
    $("placeholderTitle").textContent = cameraMode ? "Let’s put a face to it." : "A picture. A new perspective.";
    $("placeholderDescription").innerHTML = cameraMode ? "Enable your camera to see the intelligence in action.<br>Your video stays right here, in your browser." : "Choose a portrait or a group photo to explore.<br>JPG, PNG or WebP · up to 12 MB.";
    $("permissionNote").textContent = cameraMode ? "You’re in control. Stop your camera anytime." : "Your photo is analyzed locally and isn’t uploaded.";
    $("feedState").textContent = cameraMode ? "CAMERA OFF" : "IMAGE MODE";
    $("performanceLabel").textContent = cameraMode ? "Tracking rate" : "Processing time";
    $("imageInput").value = "";
  }

  async function analyzeImage(file) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Choose a JPG, PNG or WebP image."); return; }
    if (file.size > 12 * 1024 * 1024) { setError("This image is larger than 12 MB. Choose a smaller photo."); return; }
    stopSession();
    const session = state.session;
    setLoading(true, "Opening your image…");
    setStatus("Preparing image analysis");
    $("loadProgressBar").style.width = "0%";
    const originalUrl = URL.createObjectURL(file);
    try {
      const original = new Image();
      original.src = originalUrl;
      await original.decode();
      if (session !== state.session) return;
      // Bound display/decode memory; the worker analyzes a smaller 640px input.
      const ratio = Math.min(1, 960 / Math.max(original.naturalWidth, original.naturalHeight));
      const resized = document.createElement("canvas");
      resized.width = Math.max(1, Math.round(original.naturalWidth * ratio));
      resized.height = Math.max(1, Math.round(original.naturalHeight * ratio));
      resized.getContext("2d").drawImage(original, 0, 0, resized.width, resized.height);
      const blob = await new Promise((resolve) => resized.toBlob(resolve, "image/jpeg", .92));
      if (session !== state.session) return;
      if (!blob) throw new Error("This image could not be prepared. Try another photo.");
      state.imageUrl = URL.createObjectURL(blob);
      image.src = state.imageUrl;
      await image.decode();
      if (session !== state.session) return;
      await prepareEngine();
      if (session !== state.session) return;
      loadProgress("Analyzing the faces in your photo…", 100);
      image.hidden = false;
      canvas.hidden = false;
      $("cameraPlaceholder").hidden = true;
      frame.classList.add("has-source");
      state.running = true;
      await analyze(image, session);
      if (session !== state.session) return;
      setLoading(false);
      setStatus("Image analysis complete", true);
      $("feedState").textContent = "IMAGE ANALYZED";
      $("feedBadge").classList.add("live");
      $("insightsBadge").textContent = "COMPLETE";
      $("insightsBadge").classList.add("live");
      showGalleryWarnings();
    } catch (error) {
      if (session !== state.session) return;
      stopSession();
      setStatus("Image could not be analyzed");
      setError(cameraError(error));
    } finally { URL.revokeObjectURL(originalUrl); }
  }

  function togglePause() {
    if (!state.running || state.mode !== "camera" || state.loading) return;
    state.paused = !state.paused;
    state.liveEpoch += 1;
    clearTimeout(state.overlayTimer);
    state.tracks.reset();
    state.nextDetailAt = 0;
    $("pausedBadge").hidden = !state.paused;
    $("pauseButton").innerHTML = icon(state.paused ? "play" : "pause");
    const label = state.paused ? "Resume analysis" : "Pause analysis";
    $("pauseButton").setAttribute("aria-label", label);
    $("pauseButton").title = label;
    $("insightsBadge").textContent = state.paused ? "PAUSED" : "LIVE";
    setStatus(state.paused ? "Analysis paused · camera still on" : "Camera is live · analyzing", !state.paused);
    if (!state.paused) { state.lastRender = 0; state.lastResults = []; renderResults(); }
  }

  function drawHeroMesh() {
    // Decorative, code-native wireframe illustration; never a simulated result.
    const rows = [];
    for (let row = 0; row < 12; row += 1) {
      const t = row / 11;
      const y = 49 + t * 275;
      const width = Math.sin(Math.PI * (t * .81 + .10)) * 100 * (1 - .24 * Math.max(0, t - .6));
      const count = 7;
      rows.push(Array.from({ length: count }, (_, column) => {
        const u = column / (count - 1) * 2 - 1;
        const bulge = Math.sqrt(Math.max(0, 1 - u * u));
        return { x: 205 + u * width + bulge * (14 + 17 * Math.sin(t * Math.PI)), y: y - bulge * 5 + u * 10 };
      }));
    }
    let paths = "";
    const line = (a, b, core = false) => `<path class="mesh-wire${core ? " mesh-core" : ""}" d="M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}"/>`;
    rows.forEach((row, r) => row.forEach((point, c) => {
      if (c < row.length - 1) paths += line(point, row[c + 1]);
      if (r < rows.length - 1) {
        paths += line(point, rows[r + 1][c]);
        if (c < row.length - 1) paths += line(point, rows[r + 1][c + 1]);
      }
    }));
    const features = ["M133 153 151 142 176 146 186 158 164 164 143 161Z", "M225 151 244 137 270 142 280 154 258 160 234 159Z", "M207 145 199 203 217 217 238 204 225 175", "M172 256 197 244 218 249 238 244 259 253 234 267 204 271Z", "M159 126 180 125 190 135", "M231 125 255 120 278 128"];
    paths += features.map((d) => `<path d="${d}" class="mesh-wire mesh-core"/>`).join("");
    const dots = rows.flat().filter((_, index) => index % 2 === 0).map((point, index) => `<circle class="mesh-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${index % 4 === 0 ? 2 : 1.25}"/>`).join("");
    $("heroMesh").innerHTML = `<defs><linearGradient id="scanGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d8f99c" stop-opacity="0"/><stop offset="100%" stop-color="#d8f99c" stop-opacity=".16"/></linearGradient><clipPath id="headClip"><path d="M180 40C270 26 325 110 310 193C304 251 257 324 220 330C161 316 113 245 108 167C105 98 130 55 180 40Z"/></clipPath></defs>${paths}${dots}<g clip-path="url(#headClip)"><rect class="mesh-scan" x="100" y="100" width="220" height="100"/></g><path d="M101 56h-14v14m213-14h14v14M87 297v14h14m199 0h14v-14" fill="none" stroke="#d8f99c" stroke-opacity=".5" stroke-width="1"/>`;
  }

  $("startCamera").addEventListener("click", startCamera);
  $("stopCamera").addEventListener("click", () => stopSession());
  $("cancelLoading").addEventListener("click", () => stopSession());
  $("pauseButton").addEventListener("click", togglePause);
  $("cameraTab").addEventListener("click", () => setMode("camera"));
  $("imageTab").addEventListener("click", () => setMode("image"));
  document.querySelector('[role="tablist"]').addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const imageMode = event.key === "End" || ((event.key === "ArrowLeft" || event.key === "ArrowRight") && state.mode === "camera");
    setMode(imageMode ? "image" : "camera");
    $(imageMode ? "imageTab" : "cameraTab").focus();
  });
  ["chooseImage", "replaceImage"].forEach((id) => $(id).addEventListener("click", () => $("imageInput").click()));
  $("imageInput").addEventListener("change", (event) => { const file = event.target.files[0]; event.target.value = ""; analyzeImage(file); });
  frame.addEventListener("dragover", (event) => { if (state.mode === "image") event.preventDefault(); });
  frame.addEventListener("drop", (event) => {
    if (state.mode !== "image") return;
    event.preventDefault();
    if (!state.loading) analyzeImage(event.dataTransfer.files[0]);
  });
  Object.keys(state.options).forEach((option) => $(option + "Toggle").addEventListener("change", (event) => {
    state.options[option] = event.target.checked;
    frame.classList.toggle("is-mirrored", state.mode === "camera" && state.options.mirror && state.running);
    if (state.running) renderResults();
  }));
  $("thresholdInput").addEventListener("input", (event) => {
    state.threshold = FacialyticsRecognition.clampThreshold(Number(event.target.value));
    event.target.value = state.threshold.toFixed(2);
    $("thresholdValue").value = state.threshold.toFixed(2);
    updateMatcher();
    // Repeated renders or changing the slider never count as new evidence.
    state.tracks.clearIdentity();
    if (state.mode === "camera") state.lastResults = state.tracks.faces(performance.now());
    if (state.running) renderResults();
  });
  document.querySelectorAll("[data-dialog]").forEach((button) => button.addEventListener("click", () => $(button.dataset.dialog).showModal()));
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  }));
  $("fullscreenButton").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (frame.requestFullscreen) await frame.requestFullscreen();
      else {
        frame.classList.toggle("expanded-view");
        if (frame.classList.contains("expanded-view")) {
          const close = document.createElement("button");
          close.className = "button button-quiet";close.id = "closeExpanded";
          close.style.cssText = "position:absolute;right:20px;bottom:50px;z-index:10";
          close.textContent = "Close expanded view";
          close.addEventListener("click", () => {frame.classList.remove("expanded-view");close.remove();});
          frame.append(close);
        }
      }
    } catch { setError("Your browser couldn’t expand this view. Try using your browser’s fullscreen option."); }
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") {frame.classList.remove("expanded-view");$("closeExpanded")?.remove();} });
  document.addEventListener("visibilitychange", () => {
    state.liveEpoch += 1;
    if (state.mode === "camera") {
      clearTimeout(state.overlayTimer);
      state.tracks.reset();
      state.lastResults = [];
      renderResults();
    }
    if (!document.hidden) { state.lastRender = 0; state.nextDetailAt = 0; }
  });
  window.addEventListener("pagehide", () => { stopSession(); destroyWorker(); });
  $("galleryGrid").innerHTML = faceList.map((person, index) => `<article class="gallery-profile"><img src="${escapeHtml(person.imagePath)}" alt="Reference photo of ${escapeHtml(person.name)}" loading="lazy"><div class="profile-info"><strong>${escapeHtml(person.name)}</strong><small>Reference profile / ${String(index + 1).padStart(2, "0")}</small><button class="gallery-use-button" data-sample="${index}">Analyze this photo ${icon("arrow")}</button></div></article>`).join("");
  async function useSample(index) {
    const person = faceList[index];
    if (!person) return;
    $("galleryDialog").close();
    setMode("image");
    stopSession();
    const session = state.session;
    const controller = new AbortController();
    state.sampleAbort = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    setLoading(true, `Opening gallery photo · ${person.name}`);
    try {
      const response = await fetch(person.imagePath, { signal: controller.signal });
      if (!response.ok) throw new Error("This sample photo could not load. Check that the complete ZIP, including public/images, is extracted.");
      const blob = await response.blob();
      if (session !== state.session) return;
      await analyzeImage(new File([blob], `${person.name}.jpg`, { type: "image/jpeg" }));
    } catch (error) {
      if (session !== state.session) return;
      setLoading(false);
      setError(error.name === "AbortError" ? "This sample photo took too long to load. Check that public/images/ is present and try again." : error.message);
    } finally {
      clearTimeout(timer);
      if (state.sampleAbort === controller) state.sampleAbort = null;
    }
  }
  $("galleryGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-sample]");
    if (button) useSample(Number(button.dataset.sample));
  });
  $("useSamplePhoto").addEventListener("click", () => useSample(1));
  drawHeroMesh();
  drawChart();
  if (!reducedMotion && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      // Stop decorative work while the hero is outside the viewport.
      $("heroMesh").style.animationPlayState = entry.isIntersecting ? "running" : "paused";
    }));
    observer.observe($("heroMesh"));
  }
})();
