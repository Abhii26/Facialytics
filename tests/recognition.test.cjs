"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createMatcher, clampThreshold } = require("../public/recognition-policy.js");
const gallery = require("../public/gallery-descriptors.json").profiles;
const vector = (offset = 0) => [1, offset, ...Array(126).fill(0)];
const usable = { usable: true };
const profile = (name, offset) => ({ name, descriptors: [vector(offset)] });

test("all five actual gallery signatures remain recognizable", () => {
  const matcher = createMatcher(gallery);
  for (const person of gallery) assert.equal(matcher.findBestMatch(person.descriptors[0], usable).label, person.name);
});
test("nearest neighbor below the old 0.60 cutoff is rejected when too distant", () => {
  const matcher = createMatcher([profile("Sourav", 0), profile("Daksh", 1.4)]);
  const match = matcher.findBestMatch(vector(0.53), usable);
  assert.equal(match.label, "unknown");
  assert.ok(match.distance < 0.6);
});
test("a close but ambiguous first choice remains unknown", () => {
  const matcher = createMatcher([profile("Sourav", 0), profile("Daksh", 0.45)]);
  const match = matcher.findBestMatch(vector(0.20), usable);
  assert.equal(match.label, "unknown");
  assert.ok(match.distance < 0.42);
  assert.match(match.reason, /multiple profiles/);
});
test("low quality, absent quality and malformed signatures never reveal a name", () => {
  const matcher = createMatcher(gallery);
  assert.equal(matcher.findBestMatch(gallery[0].descriptors[0], { usable: false }).label, "unknown");
  assert.equal(matcher.findBestMatch(gallery[0].descriptors[0]).label, "unknown");
  for (const bad of [[], Array(127).fill(1), Array(128).fill(0), Array(128).fill(NaN), Array(128).fill(Infinity)]) assert.equal(matcher.findBestMatch(bad, usable).label, "unknown");
});
test("neither the UI range nor a caller can restore the permissive 0.60 threshold", () => {
  assert.equal(clampThreshold(0.7), 0.45);
  const matcher = createMatcher([profile("Sourav", 0)], 0.7);
  assert.equal(matcher.findBestMatch(vector(0.5), usable).label, "unknown");
});
test("duplicate or virtually indistinguishable gallery entries fail closed", () => {
  const matcher = createMatcher([profile("Sourav", 0), profile("Daksh", 0)]);
  assert.equal(matcher.findBestMatch(vector(), usable).label, "unknown");
});

test("withholding each real person rejects their signature instead of borrowing another name", () => {
  for (const withheld of gallery) {
    const matcher = createMatcher(gallery.filter((person) => person.name !== withheld.name));
    assert.equal(matcher.findBestMatch(withheld.descriptors[0], usable).label, "unknown", withheld.name);
  }
});
