// TRACKED JOURNEYS THAT CARRY A STALE AUTHORED TERRAIN ALTITUDE (2026-09-04).
//
// These twelve journey.json files were generated on 2026-08-21 by the director
// of that day, which serialized its DERIVED sea-level camera altitude
// (r / tan θ, no focal elevation) into the orbit step as if it were authored.
// Under the terrain complete-pose contract (policy A) an authored altitude on a
// calibrated terrain orbit must restate the calibrated altitude
// A = z_t + r / tan θ; these values do not, so validateJourney now refuses them
// with the calibrated-pose conflict error. They are frozen review references
// (terrain grammar / morphology calibration packages) and are NOT rewritten by
// this repository: their migration (regenerate from the director, or drop the
// stale altitude_m) is a Gate-3 decision for Mikko. Until then the corpus tests
// treat exactly this set as "stale authored altitude — requires contract
// migration"; any other refused canary, or any of these validating again, is a
// test failure so the set cannot grow or rot silently.
module.exports = Object.freeze({
  reason: "stale director-authored sea-level altitude on a calibrated terrain orbit; requires contract migration (policy A)",
  errorPattern: /is a calibrated terrain focal point: its focal elevation/,
  dirs: Object.freeze([
    "package-runs/2026-08-21-earth-studio-terrain-grammar-review/projects/TERRAIN-GRAMMAR-GRAND-CANYON-TERRAIN-FORM/earth-studio",
    "package-runs/2026-08-21-earth-studio-terrain-grammar-review/projects/TERRAIN-GRAMMAR-MATTERHORN-CURRENT-AUTO/earth-studio",
    "package-runs/2026-08-21-earth-studio-terrain-grammar-review/projects/TERRAIN-GRAMMAR-MATTERHORN-TERRAIN-FORM/earth-studio",
    "package-runs/2026-08-21-earth-studio-terrain-grammar-review/projects/TERRAIN-GRAMMAR-MOUNT-FUJI-CURRENT-AUTO/earth-studio",
    "package-runs/2026-08-21-earth-studio-terrain-grammar-review/projects/TERRAIN-GRAMMAR-MOUNT-FUJI-TERRAIN-FORM/earth-studio",
    "package-runs/2026-08-21-earth-studio-terrain-grammar-review/projects/TERRAIN-GRAMMAR-YOSEMITE-TERRAIN-FORM/earth-studio",
    "package-runs/2026-08-21-earth-studio-terrain-morphology/projects/MORPH-CAL-GRAND-CANYON/earth-studio",
    "package-runs/2026-08-21-earth-studio-terrain-morphology/projects/MORPH-CAL-MATTERHORN/earth-studio",
    "package-runs/2026-08-21-earth-studio-terrain-morphology/projects/MORPH-CAL-MOUNT-FUJI/earth-studio",
    "package-runs/2026-08-21-earth-studio-terrain-morphology/projects/MORPH-UNSEEN-EVEREST/earth-studio",
    "package-runs/2026-08-21-earth-studio-terrain-morphology/projects/MORPH-UNSEEN-KILIMANJARO/earth-studio",
    "package-runs/2026-08-21-earth-studio-terrain-morphology/projects/MORPH-UNSEEN-MONT-BLANC/earth-studio",
  ]),
});
