# Trajectory / arrival hostile oracle

This directory is an isolated read-only oracle against production base
`6e71c5b39a3c15c656b77548f139e5cf44fb2bbf`. It contains probes, a frozen
corpus, raw results, and a forensic report. It does not change the journey
compiler, planner, camera geometry, quality policy, morphology policy, or any
production canary.

Run:

```sh
node oracles/trajectory-arrival-hostile/run.js --write
```

Exit code `1` is expected on the frozen production base because the pass/fail
groups intentionally expose production defects. The exact classifications and
raw longitude sequences are in `results-main.json`.

The comparator implements its own forward/inverse spherical geometry, ECEF
camera-ray comparison, scalar longitude playback accounting, and planar
diagnostic control. Candidate branch observations are loaded by exact Git SHA;
they are evidence inputs, not expected-output authorities.

`results-main.json` includes observations from a local-only Codex chain SHA.
The production red groups remain independent of that branch. A clone that does
not possess the local-only object can inspect the frozen results but cannot
regenerate candidate-only observation groups until that exact object is made
available.

`TRAJECTORY / ARRIVAL REPAIR INSPECTED BEFORE ORACLE FREEZE: NO`
