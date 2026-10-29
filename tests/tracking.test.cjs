"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FaceTracks } = require("../public/face-tracks.js");
const face = (x) => ({ detection: { box: { x, y: 20, width: 100, height: 150 }, score: null }, landmarks: { positions: [{ x, y: 20 }] }, appearance: Array(144).fill(0) });
const recognized = (x) => ({ ...face(x), descriptor: Array(128).fill(0.2), recognitionQuality: { usable: true }, age: 27, gender: "male", genderProbability: 0.8, expressions: { neutral: 0.8 } });

test("slow recognition enriches the current track without replacing its new position", () => {
  const tracks = new FaceTracks();
  tracks.update([face(20)], 100);
  const snapshot = tracks.snapshot();
  tracks.update([face(40)], 180);
  tracks.applyDetails([recognized(20)], snapshot, 210);
  const [result] = tracks.faces(210);
  assert.equal(result.detection.box.x, 40);
  assert.equal(result.landmarks.positions[0].x, 40);
  assert.equal(result.descriptor.length, 128);
});
test("a lost face cannot receive a delayed identity when another face appears", () => {
  const tracks = new FaceTracks();
  tracks.update([face(20)], 100);
  const snapshot = tracks.snapshot();
  tracks.update([], 180);
  tracks.update([face(20)], 250);
  tracks.applyDetails([recognized(20)], snapshot, 300);
  assert.equal(tracks.faces(300)[0].descriptor, undefined);
});
test("large jumps and ambiguous crossings discard earlier identity details", () => {
  const tracks = new FaceTracks();
  tracks.update([face(20), face(180)], 100);
  const snapshot = tracks.snapshot();
  tracks.update([face(95), face(105)], 180);
  tracks.applyDetails([recognized(20), recognized(180)], snapshot, 220);
  assert.ok(tracks.faces(220).every((item) => !item.descriptor));
  tracks.update([face(400)], 300);
  assert.equal(tracks.faces(300)[0].descriptor, undefined);
});
test("pause/reset and expired tracks discard delayed details", () => {
  const tracks = new FaceTracks();
  tracks.update([face(20)], 100);
  const snapshot = tracks.snapshot();
  tracks.reset();
  tracks.update([face(20)], 200);
  tracks.applyDetails([recognized(20)], snapshot, 220);
  assert.equal(tracks.faces(220)[0].descriptor, undefined);
  const current = tracks.snapshot();
  tracks.applyDetails([recognized(20)], current, 300);
  assert.ok(tracks.faces(350)[0].descriptor);
  assert.equal(tracks.faces(6500)[0].descriptor, undefined);
});

test("a live name needs two distinct consistent samples, not repeated renders/replies", () => {
  const tracks = new FaceTracks();
  const decision = () => ({ label: "Sourav" });
  tracks.update([face(20)], 100);
  const first = tracks.snapshot();
  assert.equal(tracks.needsConfirmation(), true);
  tracks.applyDetails([recognized(20)], first, 200, decision);
  assert.equal(tracks.faces(200)[0].identityConfirmed, false);
  assert.equal(tracks.needsConfirmation(), true);
  tracks.applyDetails([recognized(20)], first, 230, decision);
  assert.equal(tracks.faces(230)[0].identityConfirmed, false);
  tracks.update([face(22)], 250);
  tracks.applyDetails([recognized(22)], tracks.snapshot(), 300, decision);
  assert.equal(tracks.faces(300)[0].identityConfirmed, true);
  assert.equal(tracks.needsConfirmation(), false);
  tracks.applyDetails([recognized(22)], tracks.snapshot(), 350, () => ({ label: "unknown" }));
  assert.equal(tracks.faces(350)[0].identityConfirmed, false);
  assert.equal(tracks.needsConfirmation(), false); // Unknown faces can still receive expression/attribute estimates.
});

test("a different face at the same position immediately loses the old name", () => {
  const tracks = new FaceTracks();
  tracks.update([face(20)], 100);
  const old = tracks.snapshot();
  tracks.applyDetails([recognized(20)], old, 150, () => ({ label: "Sourav" }));
  const changed = { ...face(20), appearance: Array(144).fill(1) };
  tracks.update([changed], 200);
  tracks.applyDetails([recognized(20)], old, 220, () => ({ label: "Sourav" }));
  assert.equal(tracks.faces(220)[0].descriptor, undefined);
  assert.equal(tracks.faces(220)[0].identityConfirmed, false);
});

test("a new predicted identity or inconsistent descriptor starts confirmation again", () => {
  const tracks = new FaceTracks();
  tracks.update([face(20)], 100);
  tracks.applyDetails([recognized(20)], tracks.snapshot(), 140, () => ({ label: "Sourav" }));
  tracks.update([face(20)], 200);
  tracks.applyDetails([recognized(20)], tracks.snapshot(), 240, () => ({ label: "Daksh" }));
  assert.equal(tracks.faces(240)[0].identityConfirmed, false);
  tracks.update([face(20)], 300);
  const other = { ...recognized(20), descriptor: Array(128).fill(0.3) };
  tracks.applyDetails([other], tracks.snapshot(), 340, () => ({ label: "Daksh" }));
  assert.equal(tracks.faces(340)[0].identityConfirmed, false);
});
