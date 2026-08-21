# Earth Studio orbit transition calibration

Experiment-only diagnosis of the launch→cruise and cruise→settle velocity seam. Production remains unchanged.

Real full-frame traces prove that the prior tangent envelope exits launch above cruise speed and accelerates again at settle entry. `LOCAL_MATCH_MILD` retimes only the first and last existing spatial segments, consistently reducing both position and pan boundary acceleration while keeping real target-facing error below 0.2°. Direct custom handles and global retiming were technically rejected before review.

Generate: `node scripts/earth-studio-orbit-transition-calibration.js`

Analyze real traces: `node scripts/earth-studio-orbit-transition-calibration.js --analyze-real`

Human micro-review: `node scripts/earth-studio-terrain-motion-review.js --transition`
