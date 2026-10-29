/* Open-set matching: the nearest enrolled face is only a candidate. */
"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FacialyticsRecognition = api;
})(typeof self === "undefined" ? globalThis : self, function () {
    // Relaxed for real webcam variance while still staying below closest
  // inter-person gallery distances (~0.575 Abhishek–Himanshu).
  const DEFAULT_THRESHOLD = 0.55;
  const MAX_THRESHOLD = 0.60;
  const MIN_MARGIN = 0.03;
  function valid(vector) {
    return (Array.isArray(vector) || ArrayBuffer.isView(vector)) && vector.length === 128
      && Array.from(vector).every(Number.isFinite)
      && Math.hypot(...vector) > 0.1;
  }
  function distance(a, b) {
    if (!valid(a) || !valid(b)) return Infinity;
    return Math.sqrt(Array.from(a).reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0));
  }
  function clampThreshold(value) {
    return Number.isFinite(value) ? Math.min(MAX_THRESHOLD, Math.max(0.3, value)) : DEFAULT_THRESHOLD;
  }
  function createMatcher(profiles, threshold = DEFAULT_THRESHOLD) {
    const limit = clampThreshold(threshold);
    const gallery = profiles.filter((profile) => profile.descriptors?.length && profile.descriptors.every(valid));
    return { findBestMatch(vector, quality) {
      if (!valid(vector) || !gallery.length) return { label: "unknown", distance: null, reason: "No valid face signature" };
      const ranked = gallery.map((profile) => ({
        label: profile.name,
        distance: profile.descriptors.reduce((sum, reference) => sum + distance(reference, vector), 0) / profile.descriptors.length
      })).sort((a, b) => a.distance - b.distance);
      const best = ranked[0];
      const margin = ranked.length > 1 ? ranked[1].distance - best.distance : Infinity;
      const rejected = (reason) => ({ label: "unknown", distance: best.distance, margin, reason });
      // Quality must come from this analyzed frame, not the live mesh or
      // the gallery. Missing evidence cannot authorize a person's name.
      if (!quality?.usable) return rejected(quality?.reason || "Face quality is not sufficient");
      if (best.distance >= limit) return rejected("No close gallery match");
      if (margin < MIN_MARGIN) return rejected("Match is too similar to multiple profiles");
      return { ...best, margin, reason: "Close, distinct gallery match" };
    } };
  }
  return { DEFAULT_THRESHOLD, MAX_THRESHOLD, MIN_MARGIN, clampThreshold, createMatcher, distance };
});
