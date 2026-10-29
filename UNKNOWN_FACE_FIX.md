# Studio 2.3 — unknown-face rejection correction

## Cause

The old matcher picked the nearest gallery profile and displayed its name whenever descriptor distance was below 0.60. It did not require a clear lead over the second profile or adequate face-image quality. That rule was too permissive: the Sourav–Abhishek reference distance is about 0.586, and Abhishek–Himanshu Sir is about 0.575. A nearest neighbor does not prove the person is enrolled.

Live names also depended on geometric continuity. Someone else could appear in a similar position before the next recognition result. Position alone is insufficient evidence for retaining an earlier name.

## New acceptance rules

| Check | Studio 2.3 behavior |
| --- | --- |
| Descriptor distance | Default maximum 0.42, reduced from 0.60 |
| Ambiguity | Best profile must lead the second profile by at least 0.08 |
| Threshold control | Range 0.30–0.45; matching code also enforces that ceiling |
| Detection quality | Recognition detection score must be at least 0.55 |
| Image quality | Face must occupy at least 48 pixels in its smaller dimension at inference size; basic lighting, contrast and sharpness checks must pass |
| Initial live name | Two distinct sampled frames must pass the above rules for the same profile, with descriptor distance between samples at most 0.22 |
| Changed/unknown face | Rejected evidence clears confirmation. Appearance changes, track loss, ambiguity and session resets discard the earlier identity |

Distance is Euclidean descriptor distance, not a probability or accuracy percentage. These are conservative operating defaults, not learned calibration. Ambiguous and low-quality faces stay **Unknown**. A live candidate's name is hidden while waiting for confirmation.

The appearance guard compares a tiny normalized face patch to detect visual discontinuities. It can invalidate a name; it cannot authorize one. Similar appearances can evade this coarse guard, so it supplements descriptor rejection and does not replace it.

## Speed and existing features

The fast WebAssembly landmark tracker remains independent. In the final synthetic moving-camera run, measured tracker latency was approximately 136 ms median and 187 ms at the 95th percentile; these timings depend on the test environment. Initial name confirmation uses two descriptor-only passes without expression/age/gender model work, with a 250 ms gap after each completed pass. Full estimates follow on the slower path. Unknown faces can still receive those estimates.

A live name can take several seconds to confirm on a slower device while points keep updating. Large head turns or appearance changes can clear a name until it is confirmed again. Image analysis retains the original neural models, uses the stricter acceptance rules, and does not require two camera samples.

## Validation

- **Actual gallery-photo inference:** all five bundled photos matched their expected profile. These are enrollment photos, so this is an integration check, not an accuracy measurement on new views.
- **Leave-one-person-out check:** each person's profile was excluded in turn, then their photo descriptor was tested against the remaining four. The old rule produced three wrong names in five cases. The new rule rejected all five withheld people as Unknown.
- **External unfamiliar images:** 19 public upstream face-api example/test images were tried. The existing detector found 12 faces; all 12 were rejected as Unknown. Images with no face detection were not counted as successful rejections. The old rule also rejected these particular detected faces; this set does not demonstrate a population improvement rate.
- **Live integration:** a real portrait moved through a synthetic 640 × 480 camera stream and required separate recognition results before showing its name. Replacing it with an unfamiliar portrait cleared the earlier name and displayed Unknown. Pause/resume, disappearance and input switching passed.
- **Browser UI:** all five gallery actions passed. An unfamiliar uploaded photo displayed Unknown with zero recognized faces. Desktop/mobile layouts were checked.
- **Automated checks:** `npm test` passes 25 server/asset/matching/tracking tests. They cover distant neighbors, ambiguous close matches, invalid descriptors, failed/missing quality, threshold overrides, withheld profiles, duplicate references, distinct live samples, changed appearances and delayed results. `npm run check` validates all application JavaScript syntax.

These checks do not establish a population false-accept rate or guarantee zero false matches. The particular unfamiliar webcam faces from the reported failure were not supplied. Independent photos and tests on your physical webcam remain useful. This version deliberately favors rejecting uncertain matches.

## Run and deploy

Extract the complete ZIP into a new folder. Run `npm ci` and `npm start`, then open http://localhost:4000. Hard-refresh and confirm **STUDIO / 02.3**. Keep the threshold at its default **0.42**. Try an enrolled person and someone absent from the gallery, allowing time for live confirmation.

For GitHub/Vercel, copy the complete project, including the new `public/recognition-policy.js`, updated workers/scripts/track helper, and all existing vendor/model assets. Commit and push to the branch connected to the existing deployment. No live deployment was made as part of this ZIP correction.

## Changed files

- `public/recognition-policy.js`: explicit quality, distance, separation and Unknown rejection.
- `public/face-engine.js`: per-frame recognition quality measurements.
- `public/camera-engine.js`: inexpensive normalized visual appearance signature.
- `public/face-tracks.js`: visual discontinuities and two-sample confirmation.
- `public/scripts.js`: policy, confirmation, lightweight initial passes and rejection explanations.
- `public/index.html`: version 02.3, stricter controls and helper loading.
- Startup checks, syntax/test commands, regression tests and documentation.

The original face-api runtime bytes, model assets, gallery photos, prepared descriptors, npm lockfile, local server and Vercel configuration are preserved.

## Audit-image sources

Public upstream images were used only as local QA inputs. They are not added to the gallery or redistributed in this ZIP:

https://github.com/justadudewhohacks/face-api.js/tree/master/examples/images

Two portraits each from its amy, bernadette, howard, leonard, penny, raj, sheldon and stuart example folders, plus `examples/images/bbt1.jpg`, `test/images/face1.png` and `test/images/face2.png`.
