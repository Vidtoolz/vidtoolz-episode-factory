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
