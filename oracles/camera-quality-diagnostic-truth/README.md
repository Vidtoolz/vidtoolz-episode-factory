# Camera-quality diagnostic-truth oracle

This is a measurement-correctness oracle for the production
`earth-studio-camera-quality.js` module. It does not select camera style,
change geometry, or loosen quality thresholds.

Its governing invariant is:

> CAMERA QUALITY MUST MEASURE THE PHYSICAL CAMERA GEOMETRY ACTUALLY PRODUCED.

The comparator owns independent spherical reference math (haversine distance,
initial bearing, shortest angular delta, adjacent-state longitude unwrapping,
and ECEF pose comparison). It loads the production camera-quality module from
the requested Git commit into a temporary directory and calls `evaluate`
directly. No production implementation helper supplies expected geometry.

Run it with:

```bash
node oracles/camera-quality-diagnostic-truth/run.js \
  --repo /home/vidtoolz/vidtoolz-episode-factory \
  --ref <commit> \
  --output /tmp/camera-quality-result.json
```

The frozen acceptance dimensions are:

- correct spherical rings: no fabricated radius/target finding;
- wrapped seam equivalents: same physical verdict as non-seam twins;
- genuine injected failures: still detected;
- public report schema: compatible;
- every recorded threshold: unchanged;
- regenerated camera artifacts and final camera: byte/semantic unchanged;
- Matterhorn complete-pose mismatch: remains independently measurable without
  choosing an altitude owner.

`results-production.json` is the production red baseline. The runner computes
the tracked differential directly between the immutable production SHA and a
requested candidate; it does not encode Fable's claimed counts.

The adapter only transports the three production modules required at a Git
ref. It contains no normalization of candidate output, repair geometry,
candidate-specific exception, or tolerance override.
