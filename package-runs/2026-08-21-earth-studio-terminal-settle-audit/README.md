# Earth Studio terminal-settle audit

Authenticated Google Earth Studio consecutive-frame readback disproves the predicted terminal orbit reversal. Production camera motion and orbit density remain unchanged; only the internal diagnostic's terminal custom-handle semantics are calibrated.

## Result

- Verdict: **TERMINAL SETTLE CLEAN — EVALUATOR FIXED**
- Nine projects imported successfully.
- Eight end-of-project orbits contributed 60 consecutive final playable frames each.
- The orbit-to-hold case contributed 71 frames spanning the final 60 orbit frames, the boundary, and ten hold frames.
- Real pan reversals above 0.00001°: zero.
- Real position-bearing reversals above 0.00001°: zero.
- Production camera/density changes: none.

## Evaluator versus real Earth Studio

| Case | Old model reversal | Real pan reversal | Real position reversal | Authority result |
|---|---:|---:|---:|---|
| T01-promoted-helsinki-half | 0.224835° / 1 | 0.000000° | 0.000000° | TERMINAL_SETTLE_CLEAN |
| T02-helsinki-explicit-full | 0.227241° / 1 | 0.000000° | 0.000000° | TERMINAL_SETTLE_CLEAN |
| T04-matterhorn-terrain | 0.225146° / 2 | 0.000000° | 0.000000° | TERMINAL_SETTLE_CLEAN |
| T05-santorini-half | 0.225146° / 2 | 0.000000° | 0.000000° | TERMINAL_SETTLE_CLEAN |
| T06-paris-two-revolution | 0.224834° / 1 | 0.000000° | 0.000000° | TERMINAL_SETTLE_CLEAN |
| T07-high-latitude | 0.227241° / 1 | 0.000000° | 0.000000° | TERMINAL_SETTLE_CLEAN |
| T08-antimeridian | 0.227241° / 1 | 0.000000° | 0.000000° | TERMINAL_SETTLE_CLEAN |
| T03-colosseum-explicit-full | 0.227241° / 1 | 0.000000° | 0.000000° | TERMINAL_SETTLE_CLEAN |
| T09-helsinki-orbit-to-hold | 0.000000° / 0 | 0.000000° | 0.000000° | TERMINAL_SETTLE_CLEAN |

The old model's value is total reverse displacement and reverse-frame count. Full frame traces and final-step values are in `evaluator-vs-real.json` and `real-traces/`.

## Root cause and correction

The evaluator added a half-influence extrapolation to every custom arrival handle. That approximation is retained for interior custom handles, where earlier fly-to-orbit calibration supports it. It is no longer applied to a track's terminal custom handle: eight real imports show those endpoints remain monotonic. The detector also distinguishes serialized, modeled, and real authority and reports model-only disagreements as uncertain.

Most old predictions occurred on the authored terminal key at frame `duration`, outside Earth Studio's playable `0…duration−1` range. Matterhorn and Santorini are the stronger control: the old model also predicted −0.034498° on playable frame 479, while real Earth Studio continued forward in both pan and physical bearing.

## Method and contents

- `original-evaluator-signal.json`: frozen pre-fix prediction.
- `internal-audit.json`: corrected evaluator result and serialized terminal keys.
- `canary-manifest.json`: ESP paths and SHA-256 provenance.
- `real-traces/*.json`: per-frame Earth Studio latitude, longitude, altitude, pan, tilt, derived target bearing and radius.
- `real-earth-studio-summary.json`: import and reversal summary.
- `evaluator-vs-real.json`: machine-readable comparison and hold continuity.
- `operator-authority.json`: hover/show/orbit/negative/continuation regression measurements.
- `screenshots/T04-matterhorn-terrain/`: five supplemental terminal checkpoints; numerical readback, not still imagery, is the motion authority.
- `projects/`: only the two missing compact fixtures; seven ESPs are reused by immutable hash from the prior density audit.
