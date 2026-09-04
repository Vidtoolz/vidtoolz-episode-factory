# Terrain complete-pose successor oracle V2

This directory is an implementation-independent acceptance oracle for the
adjudicated Earth Studio terrain complete-pose contract. It changes no
production module and evaluates a subject only through public generation
surfaces and serialized `.esp`/plan artifacts.

Semantic authority:

`/home/vidtoolz/outputs/terrain-complete-pose-contract-adjudication-2026-09-04/TERRAIN-COMPLETE-POSE-CONTRACT-ADJUDICATION-2026-09-04.md`

## Contract

For automatic terrain framing, the oracle independently derives:

```text
calibrated radius = calibration_altitude_m * tan(72°)
camera altitude   = focal_elevation_m + calibrated_radius / tan(morphology_rake)
```

It then measures the emitted camera rather than importing the production
complete-pose implementation. Horizontal distance is measured geodesically;
optical aim is measured against an independent WGS84/ECEF focal vector.

The temporal model is:

```text
APPROACH -> OPTIONAL BOUNDED ACQUISITION -> SETTLED ORBIT SWEEP
```

Stageable AUTO arrivals must own canonical altitude, radius, target and
heading at the shared boundary. Rake may already be canonical or converge
monotonically within 15 frames and 20% of the orbit, with acquisition aim
below 1 degree and settled aim at most 0.25 degrees.

Continuation permits normal 10-degree chord breathing up to 1% of ring
radius. It separately requires a physical frame-0 delta at most 0.25 m,
altitude continuity at most 1.1 m, rake continuity at most 0.02 degrees,
fresh-orbit radial parity at most 5 m, focal aim at most 0.25 degrees, and no
semantic drift over repeated continuations.

Explicit camera fields follow Policy B. Authored altitude and rake outrank
automatic framing; the coherent radius is:

```text
r = (authored_altitude - focal_elevation) * tan(authored_rake)
```

For a partial override, the non-authored dimension follows existing
repository authority: an explicit altitude uses the automatic morphology
rake; an explicit rake retains the calibrated automatic footprint and derives
altitude from the focal elevation. Requests at or below the focal elevation
must be clearly rejected.

## Files

- `contract.json` freezes authorities, targets and tolerances.
- `geometry.js` contains oracle-owned spherical and WGS84/ECEF math plus `.esp`
  decoding.
- `run.js` produces F1–F5 subject classifications.
- `selftest.js` exercises independent references and hostile mutations.
- `historical-controls.js` runs each authorized historical subject twice,
  checks exact SHA/cleanliness, verifies the semantic matrix, and hashes the
  deterministic reports.

## Commands

Run one immutable subject:

```sh
node oracles/terrain-complete-pose-successor-v2/run.js \
  --subject-root=/absolute/detached/worktree \
  --expected-sha=<AUTHORIZED_EXACT_SHA> \
  --write=/absolute/report.json
```

Run mutation/self-audit controls against an authorized clean subject root:

```sh
node oracles/terrain-complete-pose-successor-v2/selftest.js \
  --subject-root=/absolute/production-detached-worktree \
  --expected-sha=7b63c6b430f964087665a6c9a4626b79e42bcad9 \
  --write=/absolute/selftest.json
```

Run the frozen historical matrix twice:

```sh
node oracles/terrain-complete-pose-successor-v2/historical-controls.js \
  --production-root=/absolute/production-detached-worktree \
  --rejected-root=/absolute/rejected-detached-worktree \
  --topology-root=/absolute/topology-detached-worktree \
  --handoff-root=/absolute/handoff-detached-worktree \
  --write-dir=/absolute/evidence-directory
```

The runner refuses a requested/actual SHA mismatch or a dirty subject.
