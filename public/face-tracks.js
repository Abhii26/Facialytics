/* Conservative geometric continuity for separately computed face details. */
"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FacialyticsTracks = api;
})(typeof self === "undefined" ? globalThis : self, function () {
  function overlap(a, b) {
    const area = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
      * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return area / Math.max(1, a.width * a.height + b.width * b.height - area);
  }
  function pair(previous, next, minimum) {
    const pairs = [];
    // Ambiguous/crossing tracks get fresh IDs instead of borrowing a name.
    next.forEach((face, index) => {
      const candidates = previous.map((old, oldIndex) => ({ oldIndex, score: overlap(old.detection.box, face.detection.box) })).sort((a, b) => b.score - a.score);
      const best = candidates[0];
      if (best && best.score >= minimum && (!candidates[1] || best.score - candidates[1].score > 0.12)) pairs.push({ index, ...best });
    });
    return pairs.filter((candidate) => !pairs.some((other) => other !== candidate && other.oldIndex === candidate.oldIndex));
  }
  function appearanceDistance(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 144 || b.length !== 144) return Infinity;
    return Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0) / a.length);
  }
  function descriptorDistance(a, b) {
    if (!a || !b || a.length !== 128 || b.length !== 128) return Infinity;
    return Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0));
  }
  class FaceTracks {
    constructor() { this.tracks = []; this.nextId = 0; this.updatedAt = 0; }
    reset() { this.tracks = []; this.updatedAt = 0; }
    update(faces, now) {
      const previous = now - this.updatedAt < 500 ? this.tracks : [];
      const pairs = pair(previous.map((track) => track.face), faces, 0.25);
      this.tracks = faces.map((face, index) => {
        const match = pairs.find((entry) => entry.index === index);
        let old = match ? previous[match.oldIndex] : null;
        if (old && (appearanceDistance(old.face.appearance, face.appearance) > 0.55
          || (old.anchor && appearanceDistance(old.anchor, face.appearance) > 0.55))) old = null;
        return { id: old ? old.id : ++this.nextId, face, detail: old?.detail, detailAt: old?.detailAt || 0,
          confirmation: old?.confirmation || null, anchor: old?.anchor || null };
      });
      this.updatedAt = now;
      return this.faces(now);
    }
    snapshot() { return this.tracks.map(({ id, face }) => ({ id, detection: face.detection, appearance: face.appearance, sampleAt: this.updatedAt })); }
    needsConfirmation() { return this.tracks.some((track) => !track.detail || (track.confirmation && track.confirmation.count < 2)); }
    clearIdentity() { for (const track of this.tracks) { track.confirmation = null; track.anchor = null; } }
    applyDetails(faces, snapshot, now, matchFace) {
      for (const match of pair(snapshot, faces, 0.45)) {
        const track = this.tracks.find((item) => item.id === snapshot[match.oldIndex].id);
        if (!track) continue;
        const anchor = snapshot[match.oldIndex].appearance;
        if (appearanceDistance(anchor, track.face.appearance) > 0.55) continue;
        const face = faces[match.index];
        const decision = matchFace ? matchFace(face) : { label: "unknown" };
        const prior = track.confirmation;
        if (decision.label === "unknown") { track.confirmation = null; track.anchor = null; }
        else {
          const sampleAt = snapshot[match.oldIndex].sampleAt;
          const consistent = prior && prior.label === decision.label && now - prior.at <= 12000
            && descriptorDistance(prior.descriptor, face.descriptor) <= 0.40;
          const count = consistent ? prior.count + (sampleAt > prior.sampleAt ? 1 : 0) : 1;
          track.confirmation = { label: decision.label, count, descriptor: face.descriptor, at: now, sampleAt };
          track.anchor = anchor;
        }
        track.detail = { descriptor: face.descriptor, recognitionQuality: face.recognitionQuality, expressions: face.expressions,
          age: face.age, gender: face.gender, genderProbability: face.genderProbability, detailScore: face.detection.score };
        track.detailAt = now;
      }
    }
    faces(now) {
      return this.tracks.map(({ id, face, detail, detailAt, confirmation }) => ({ ...face,
        ...(now - detailAt < 6000 ? detail : {}), trackId: id,
        identityConfirmed: !!confirmation && confirmation.count >= 2 && now - detailAt < 6000,
        confirmedLabel: confirmation?.label }));
    }
  }
  return { FaceTracks, overlap, appearanceDistance };
});
