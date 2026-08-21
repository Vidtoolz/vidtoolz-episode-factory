# Earth Studio terrain motion calibration

The eight-subject grammar review rejected both primitives. Production grammar, morphology and motion remain unchanged.

- `orbit-full-frame-traces/`: five reviewed terrain orbits plus a Colosseum control, sampled at every real Earth Studio frame.
- `reveal-full-frame-traces/`: five reviewed production reveals, sampled at every frame.
- `candidates/`: experiment-only orbit tangent-envelope and reveal custom-departure candidates.
- `candidate-orbit-traces/` and `candidate-reveal-traces/`: real playback measurements.
- `human-review/`: Mikko's isolated orbit and reveal micro-review session.

Rejected experiments were not advanced to review: endpoint resampling increased
radius variation, changing only `easeOut.x` had no real-playback effect, and a
fixed-influence custom handle with varied x also played identically. Their
reproducible raw dumps were kept out of this compact durable package.

Run: `node scripts/earth-studio-terrain-motion-review.js`

## Human result

- First micro-review: all orbit and reveal candidates `NONE_GOOD`. The tangent
  orbit was better, but retained a small wobble after launch and before settle.
- Continuous coordinate tangents produced no measurable real-playback change.
- A pan-only target-lock schedule reduced aim error only marginally and was not
  promoted to another visual claim.
- Second reveal review: Grand Canyon `CALM_RAMP_B` was the only acceptable
  launch. Alps and Yosemite remained `NONE_GOOD`, so no general production
  reveal rule is authorized.

Production motion, terrain morphology and terrain grammar remain unchanged.
