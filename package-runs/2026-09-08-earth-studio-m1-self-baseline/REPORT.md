# M1 self-baseline oracle v1.1 — aggregate report

- Oracle version: 1.1.0
- Frozen contract: 19f98b6a39b0cb079c46e79fa4293a88c04b64a59d124f033d42be9fb3887171
- Baseline commit: f30e4543b0af17d047f803ae9044aef859ef13bc
- Node: v24.17.0
- OS: Linux 7.0.0-31-generic
- Discovered corpus: 199 cases (lexicographic by repo-relative path)
- Replayed: 199
- Failures: 0
- Roll (rotationZ) violations: 0 (expected 0 — empty leaf per §4.4 item 4)
- Duplicate canonical identities: 0
- Round-trip sample: 2026-06-27-london-proof, 2026-08-07-earth-studio-v04-acceptance, 2026-08-12-earth-studio-antimeridian-real-import-v094, 2026-08-12-earth-studio-hover-real-import-v094, 2026-08-12-earth-studio-space-zoom-v094-candidate
- Side-channel sample: 2026-08-21-earth-studio-obliquity-ab__projects__OBQ-02-landmark-inspect-B-obliquity, 2026-08-21-earth-studio-obliquity-ab__projects__OBQ-03-landmark-emphasize-A-baseline, 2026-08-21-earth-studio-obliquity-ab__projects__OBQ-03-landmark-emphasize-B-obliquity, 2026-08-21-earth-studio-obliquity-ab__projects__OBQ-04-terrain-matterhorn-A-baseline, 2026-08-21-earth-studio-obliquity-ab__projects__OBQ-04-terrain-matterhorn-B-obliquity

## Round-trip exactness
- Total samples (all tracks, all cases): 2860
- Non-exact samples (1 ulp): 22
- Non-exact rate: 0.77%
- These 1-ulp differences are expected IEEE-754 behavior on normalize->denormalize round-trip.
- Post-extraction M1 must reproduce these same exact values at the same observation boundary.
- No epsilon. No tolerance. D-2 binding.

## Pan round-trip source (v1.1 fix)
- Pan normalization span sourced from leaf minValueRange/maxValueRange per §5.2 pin.
- Divergence from trajectory-derived span is detected and recorded per case.

## Synthetic fixtures
- Injected roll: PASS
- Experiment switches: all exercised
- Total frames guard: PASS
- Initial camera seed: exercised

## Browser invariant
- Method: (b) render-only alternative
- Bundle identity hashes: 7 files
- Static boundary proof: 0 HTML invocations (3 definitions in loaded modules)
- PASS: true
- Browser bundle confirmed outside deterministic generation/QC path.

## Lane-tier enforcement
- Per-case expected vs actual lane artifact comparison enforced.
- Missing/extra lane artifacts recorded per case.

## Verdict
PASS — baseline observed and frozen; no exceptions, no roll violations, no duplicate identities; all synthetic fixtures pass.

