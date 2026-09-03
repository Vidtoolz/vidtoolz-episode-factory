# Terrain complete-pose measurement oracle

This is a measurement-only oracle for production `7b63c6b430f964087665a6c9a4626b79e42bcad9`. It decodes the final serialized `.esp` camera tracks, constructs camera and target ECEF coordinates, constructs the optical ray from Earth Studio pan/tilt semantics, and measures the true 3-D ray-to-target angle. It neither chooses an altitude owner nor changes production geometry.

Run the frozen fixtures:

```bash
node oracles/terrain-complete-pose-measurement/run.js
node oracles/terrain-complete-pose-measurement/oracle.test.js
```

`run.js --live` regenerates the same director cases from the checked-out code without changing fixtures. `--write-fixtures` is freeze-time only and must not be used after the oracle identity is recorded.

The comparator is implementation-independent: it imports no planner, journey, morphology, or camera-quality helper. The runner imports production only to generate fixtures and record provenance.

Two Earth models are reported:

- WGS84 geodetic ECEF is the primary physical measurement.
- A 6,371,000 m sphere is retained only to reproduce the historical figures and expose their assumptions.

Production carries no terrain target-elevation field in this planner path. The frozen zero-metre target is therefore an explicit compatibility assumption, not a claim about real terrain and not a policy decision. A future authority may rerun the comparator with any explicit target elevation without changing its mathematics.

Grand Canyon is deliberately observation-only. Current director output is a fly followed by a hold, not a staged orbit arrival.
