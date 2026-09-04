# Terrain complete-pose successor acceptance oracle

This is an external, implementation-independent acceptance instrument for the
Earth Studio terrain complete-pose contract. It modifies no production module
and can judge any checkout through `--subject-root`.

The observable invariant is: every orbit-family entry around a declared 3-D
terrain focal point preserves the calibrated horizontal footprint, resolves
camera altitude from focal elevation and selected rake, and aims its optical
ray at that focal point regardless of the route used to enter or resume the
orbit.

## Commands

```sh
node oracles/terrain-complete-pose-successor/run.js \
  --subject-root=/path/to/checkout --expect=GREEN

node oracles/terrain-complete-pose-successor/oracle.test.js \
  --production-root=/home/vidtoolz/vidtoolz-episode-factory \
  --rejected-root=/home/vidtoolz/ef-heading-seam-serializer-repair-20260903
```

The runner emits JSON. `GREEN` means every semantic, metamorphic, continuity,
serialization, heading, explicit-altitude-policy, hostile-elevation, and
determinism check passed. Production `7b63c6b` and rejected `ac0ee00` are
expected `RED`; the independent mathematical reference in `oracle.test.js` is
expected `GREEN`.

## What changed from the original oracle

The original frozen oracle (`eef86bc`) correctly proved the 3-D focal-point,
calibration, optical-ray, staging-boundary, heading, antimeridian, and signed
orbit rules for the staged topology it generated. It required an incoming
segment marked as the orbit entry, so it could not observe a correction gated
to that route.

This successor retains independent WGS84 ECEF optical measurement and
great-circle footprint measurement, but adds a topology matrix: bare orbit,
one- and two-stop director, staged approach, `fly_low`, `fly_high`, `cruise`,
`fly_low -> hold -> orbit`, opening hold, text hover, continuation, repeated
continuation, and serialized readback/re-entry. Equivalent forms are checked
both against the independent complete-pose result and against each other.

It also adds two bounded rake sweeps, coherent explicit-altitude policy
classification, zero/below-sea-level/missing-elevation probes, an elevated
antimeridian twin, generated heading-seam samples, repeated generation, and
scratch-only negative controls.

## Geometry

For a calibrated case:

```text
r = calibration_altitude_m * tan(72 degrees)
A = target_elevation_m + r / tan(selected_rake)
```

The runner does not look for this expression in production. It reconstructs
the camera at orbit entry from serialized `.esp` tracks, measures its physical
ground distance to the declared focal coordinates, and compares the Earth
Studio optical ray with the independently constructed WGS84 ECEF target
vector. Plan fields are used only to locate the orbit boundary and verify that
the plan and serialized camera agree.

## Tolerances

- Radius: 5 m. Existing whole-metre planning and spherical placement produce
  about 1.1 m worst observed calibration residual; this leaves margin while
  rejecting the known 2.3–30.9 km errors.
- Altitude: 1.1 m. This covers integer rounding and the adjudicated 1.0 m
  safety-floor ceiling without admitting the known 1.1–15.2 km errors.
- Entry optical aim: 0.25 degrees (1.25% of the frozen 20-degree vertical
  field of view). The old exact-ECEF reference reached 0.181 degrees in the
  least favorable bearing; known defects are 3–39 degrees.
- Entry heading: 0.1 degrees. Authored entry states currently measure zero;
  the allowance covers serialization precision while remaining well below a
  visible seam error.
- Topology spread: 2 m altitude, 10 m radius, 0.02 degrees tilt. These are
  twice the single-pose rounding allowances and reject topology switches of
  thousands of metres.
- Continuation: 0.25 m opening position; first-15-frame deviation at most 5 m
  altitude and 10 m radius. This permits serialization noise but rejects the
  adjudicated 3,714 m / 2,664 m reset.
- Rake sweep: 2 m altitude and 10 m radius per adjacent input. The orbit rake
  is fixed in the sweep, so an approach-only 0.01-degree change has no product
  policy reason to alter the terminal pose.
- Serialized readback: 0.01 m physical position and 0.000001 degrees angles;
  JSON is lossless for the emitted numeric values.
- Playback heading: 0.75 degrees is retained from the prior oracle's measured
  wobble guard (0.646 degrees), while entry heading remains 0.1 degrees.

These thresholds are semantic separators, not exact floating-point demands.
No check names a new helper, module owner, variable, call graph, or source
line. Synthetic fixtures are explicitly labeled and injected only through the
repository's established exported fixture surface for the lifetime of the
oracle process.
