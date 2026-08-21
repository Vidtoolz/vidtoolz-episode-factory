# Orbit sampling-density audit

A changes only the coherent sample step to 30°. B is the live 10° policy. No production or accepted contract changed.

| Case | Purpose | A keys | A inward | B keys | B inward | Reduction |
|---|---|---:|---:|---:|---:|---:|
| D01-helsinki-half | small landmark half-orbit | 7 | 3.411769% | 19 | 0.392639% | 88.492% |
| D02-promoted-helsinki-establish | promoted oblique landmark establish | 7 | 3.410559% | 19 | 0.385562% | 88.695% |
| D03-helsinki-explicit-full | explicit landmark full orbit | 13 | 3.411769% | 37 | 0.39876% | 88.312% |
| D04-santorini-half | compact district half-orbit | 7 | 3.409354% | 19 | 0.390427% | 88.548% |
| D05-matterhorn-terrain | terrain orbit (72-degree policy held) | 7 | 3.418922% | 19 | 0.391284% | 88.555% |
| D06-paris-space-scale | large Paris two-revolution orbit | 25 | 3.406843% | 73 | 0.38104% | 88.815% |
| D07-equator | equatorial full orbit | 13 | 3.407393% | 37 | 0.396557% | 88.362% |
| D08-lat80 | 80-degree latitude full orbit | 13 | 3.417513% | 37 | 0.396998% | 88.383% |
| D09-near-pole | 89-degree latitude full orbit | 13 | 3.51967% | 37 | 0.409814% | 88.356% |
| D10-antimeridian | antimeridian-crossing full orbit | 13 | 3.408236% | 37 | 0.396609% | 88.363% |

See `density-audit.json` for keyframe-radius, heading, latitude, antimeridian, serialization and authority metrics.

## Real Earth Studio result

Four A/B pairs (eight projects) imported at their exact duration and 30 fps.
Each was read back from Earth Studio's scene model at start, quarter, midpoint,
three-quarter and terminal frames. All had `bodyHasError: false` and no gate
errors.

The real product disproved the internal chord model for these files. The 30° A
projects measured **0.0053–0.0167%** radius spread at those checkpoints; the 10°
B projects measured **0.0049–0.0336%**. Both are already far below the model's
3.4% / 0.4% predictions. Earth Studio's coupled interpolation does not behave as
piecewise-linear latitude/longitude chords here.

Target aim remained within 0.024°, altitude and tilt were stable, and the
antimeridian pair loaded without a globe jump. See `REAL-IMPORT-SUMMARY.json`
and `observations/` for exact readbacks and screenshots.

## Decision

**NO PRODUCTION DENSITY CHANGE JUSTIFIED.** Modern journey/director orbits
already use 10°. Unifying the legacy 30° path would break the newly accepted
space-zoom byte control and roughly double its serialization size, while these
real imports do not demonstrate a radial-stability benefit. No accepted artifact
was re-earned and no production sampler was changed.
