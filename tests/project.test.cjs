"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const publicRoot = path.join(root, "public");
let server;
let baseUrl;

before(async () => {
  server = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: { ...process.env, PORT: "0", LOCAL_HTTP_ONLY: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  baseUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Local server did not start")), 10000);
    let output = "";
    server.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/https?:\/\/localhost:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
    server.on("error", (error) => { clearTimeout(timeout); reject(error); });
    server.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Local server exited: ${code}`)); });
  });
});
after(() => { server?.kill(); });

test("local server starts and serves the studio without requiring certificates", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Facialytics — A new perspective/);
});

test("all directly linked local HTML assets are present and served", async () => {
  const html = fs.readFileSync(path.join(publicRoot, "index.html"), "utf8");
  const assets = [...html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)].map((match) => match[1].split("?")[0]);
  assert.ok(assets.includes("scripts.js"));
  assert.ok(assets.includes("styles.css"));
  for (const asset of new Set(assets)) {
    assert.ok(fs.existsSync(path.join(publicRoot, asset)), `Missing ${asset}`);
    const response = await fetch(`${baseUrl}/${asset}`);
    assert.equal(response.status, 200, `Asset ${asset} should be available`);
  }
});

test("every model manifest resolves to its original weight shards", async () => {
  const modelsRoot = path.join(publicRoot, "models");
  const manifests = fs.readdirSync(modelsRoot).filter((name) => name.endsWith("weights_manifest.json"));
  assert.equal(manifests.length, 8);
  for (const name of manifests) {
    const manifest = JSON.parse(fs.readFileSync(path.join(modelsRoot, name), "utf8"));
    const response = await fetch(`${baseUrl}/models/${name}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /json/);
    for (const group of manifest) {
      assert.ok(group.weights.length > 0);
      for (const shard of group.paths) assert.ok(fs.statSync(path.join(modelsRoot, shard)).size > 0, `Empty shard ${shard}`);
    }
  }
});

test("all five configured reference images are downloadable", async () => {
  const code = fs.readFileSync(path.join(publicRoot, "scripts.js"), "utf8");
  const images = [...code.matchAll(/imagePath: "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(images.length, 5);
  for (const image of images) {
    const response = await fetch(`${baseUrl}/${image}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /image\/jpeg/);
    assert.ok((await response.arrayBuffer()).byteLength > 1000);
  }
});

test("Vercel serves the same public assets as the local server", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, "public");
  assert.equal(config.buildCommand, "");
  assert.ok(!fs.readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/).includes("vercel.json"));
});

test("missing assets return a real 404 instead of HTML disguised as model data", async () => {
  const response = await fetch(`${baseUrl}/models/missing-shard`);
  assert.equal(response.status, 404);
});

test("application scripts pass the JavaScript syntax check", () => {
  for (const script of ["server.js", "public/scripts.js", "public/face-engine.js", "public/camera-engine.js", "public/face-tracks.js", "public/recognition-policy.js"]) execFileSync(process.execPath, ["--check", path.join(root, script)]);
});

test("the background analyzer and its runtime can be downloaded on a fresh PC", async () => {
  for (const asset of ["face-engine.js", "face-api.min.js", "gallery-descriptors.json"]) {
    const response = await fetch(`${baseUrl}/${asset}`);
    assert.equal(response.status, 200, asset);
    assert.ok((await response.arrayBuffer()).byteLength > 1000, asset);
  }
});

test("prepared descriptors match all five bundled gallery photos exactly", () => {
  const cache = JSON.parse(fs.readFileSync(path.join(publicRoot, "gallery-descriptors.json"), "utf8"));
  assert.equal(cache.pipeline, "tiny-68-v1");
  assert.equal(cache.profiles.length, 5);
  for (const profile of cache.profiles) {
    const bytes = fs.readFileSync(path.join(publicRoot, profile.imagePath));
    assert.equal(profile.sha256, crypto.createHash("sha256").update(bytes).digest("hex"), profile.name);
    assert.ok(profile.descriptors.length > 0);
    for (const vector of profile.descriptors) {
      assert.equal(vector.length, 128);
      assert.ok(vector.every(Number.isFinite));
    }
  }
});

test("startup detects an incomplete update-only extraction before opening the app", () => {
  const { missingAssets } = require("../scripts/check-install.cjs");
  assert.deepEqual(missingAssets(root), []);
  const temporary = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "facialytics-incomplete-"));
  try {
    const missing = missingAssets(temporary);
    assert.ok(missing.includes("public/face-engine.js"));
    assert.ok(missing.includes("public/models/face_recognition_model-weights_manifest.json"));
  } finally { fs.rmSync(temporary, { recursive: true }); }
});

test("live tracking runtime, model, and both WASM variants are served as binary assets", async () => {
  for (const asset of ["camera-engine.js", "face-tracks.js", "recognition-policy.js", "models/face_landmarker.task", "vendor/mediapipe/vision_bundle.js", "vendor/mediapipe/wasm/vision_wasm_internal.js", "vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js"]) {
    const response = await fetch(`${baseUrl}/${asset}`);
    assert.equal(response.status, 200, asset);
    assert.ok((await response.arrayBuffer()).byteLength > 1000, asset);
  }
  for (const name of ["vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.wasm"]) {
    const response = await fetch(`${baseUrl}/vendor/mediapipe/wasm/${name}`);
    assert.equal(response.status, 200, name);
    assert.match(response.headers.get("content-type"), /application\/wasm/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(Array.from(bytes.slice(0, 4)), [0, 97, 115, 109]);
  }
});
