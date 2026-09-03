# Independent camera-quality diagnostic-truth oracle — production freeze report

## Authority and independence

Production `main`, `origin/main`, and direct remote resolve to
`00bba82faa1a31f3db3d16c68c991765ae1b6d3a`, with ahead/behind `0/0` and a
clean production worktree.

The reported Fable candidate branch name and opaque commit identity were
resolved only so a later collision can name an immutable object. No candidate
commit, tree, parent, diff, or file was read while constructing this oracle.

`FABLE DIAGNOSTIC REPAIR INSPECTED BEFORE ORACLE FREEZE: NO`

## Independent physical reference

The oracle implements a spherical central angle/haversine on radius
`6,371,000 m`, spherical forward geodesic, spherical initial bearing,
wrap-safe signed angular difference, adjacency-based longitude unwrapping,
and an ECEF complete-pose ray check. Synthetic rings are generated from those
references and serialized only into legal `[-180°,180°]` longitudes. Production
`earth-studio-camera-quality.js` is then loaded and called directly.

## Production false-failure reproduction

Across 24 ordinary-longitude scale/latitude controls plus eight seam controls:

- 17 physically correct cases receive fabricated orbit-geometry findings;
- 14 physically correct cases become hard false failures;
- all 8 seam controls hard-fail;
- all 6 deliberately injected failure classes remain detected.

The physical synthetic path's maximum interpolation artifact stays under
`0.0357%` radius breathing and `0.0061°` target error. This is far below the
unchanged `2%/4%` and `2°/5°` warning/error bands.

## Scale / latitude evidence

Selected ordinary-longitude controls (physical versus production planar
measurement):

| Latitude | Radius | Physical breathing | Planar breathing | Physical aim | Planar aim | Production verdict |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 0° | 1,000 km | 0.0037% | 0.1051% | 0.00002° | 0.1859° | PASS |
| 30° | 1,000 km | 0.0041% | 3.5190% | 0.00008° | 2.6277° | PASS + false warnings |
| 60° | 1,000 km | 0.0051% | 10.7857% | 0.00028° | 7.9067° | false FAIL |
| 80° | 100 km | 0.0040% | 3.4348% | 0.00008° | 2.5525° | PASS + false warnings |
| 80° | 1,000 km | 0.0353% | 51.5059% | 0.00593° | 29.3470° | false FAIL |
| 85° | 100 km | 0.0045% | 6.9747% | 0.00017° | 5.1590° | false FAIL |
| 89° | 10 km | 0.0040% | 3.4697% | 0.00008° | 2.5784° | PASS + false warnings |
| 89° | 100 km | 0.0356% | 51.9688% | 0.00605° | 29.4934° | false FAIL |

The complete 24-row matrix is frozen in `results-production.json`.

## Seam evidence

| Case | Physical breathing | Planar breathing | Physical aim | Planar aim | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| 179.99°, equator, 100 km east | 0.00366% | 201.3078% | 0.000005° | 180° | false FAIL |
| -179.99°, equator, 100 km west | 0.00366% | 201.3078% | 0.000005° | 180° | false FAIL |
| 179.99°, 60°N, 80 km | 0.00374% | 200.8891% | 0.000020° | 179.9560° | false FAIL |
| 179.99°, 80°N, 100 km | 0.00404% | 198.0297% | 0.000080° | 179.7256° | false FAIL |
| -179.99°, 85°N, 35 km | 0.00392% | 199.2181% | 0.000056° | 179.9818° | false FAIL |
| 179.99°, 89°N, 35 km | 0.00540% | 188.8281% | 0.000349° | 179.8742° | false FAIL |
| exactly +180°, 30°N, 10 km | 0.00366% | 197.9491% | 0.000005° | 179.9481° | false FAIL |
| exactly -180°, 30°N, 10 km | 0.00366% | 201.9319% | 0.000005° | 179.9481° | false FAIL |

The production planar diagnostic interprets a canonical wrap as geographic
distance. Equivalent physical rings therefore receive different QC results.

## True failures and schema

The oracle injects and confirms six independent real failures:
`RADIUS_BREATHING`, `TARGET_DRIFT`, dead orbit, dead fly,
`TRAJECTORY_REVERSAL`, and `HARD_START`. All six fail on production. The
top-level report keys and the eleven-field smoothness defect schema are frozen.

All ten scalar constants and all sixteen exported smoothness thresholds match
the values in `corpus.json`. Candidate acceptance requires exact equality; no
latitude/seam exception or suppression is authorized.

## Terrain guard

The fresh Matterhorn staged boundary remains a real complete-pose control:

- camera: `45.796701, 7.658500`, altitude `6500 m`, pan `0°`, tilt `74°`;
- target: `45.976600, 7.658500`, implicit production elevation `0 m`;
- horizontal distance: `20003.856108 m`;
- orbit altitude: `5736 m`;
- independent ECEF ray error: `2.082264286°`.

This measurement does not choose which altitude or target elevation should own
the boundary. It must remain measurable, and camera output must not change.

## Additional production controls

Independent spherical measurement of production planner output after the first
40% of three high-latitude orbit segments finds maximum true target offsets of
`1.349670°` (60°N / 80 km), `3.661708°` (85°N / 35 km), and `17.897945°`
(89°N / 35 km). These controls distinguish corrected measurement from a
perfect-camera assumption; their classification is deferred until collision.

The tracked production tree contains 196 shot plans at this immutable commit,
not 199. Production-to-production control yields 196/196 identical diagnostic
reports and zero camera artifact/final-camera differences. The later candidate
comparison will use this exact discovered corpus without assuming Fable's
reported counts.

## Frozen acceptance

Candidate acceptance requires: no fabricated findings on the perfect spherical
controls; all real failures retained; thresholds and schema unchanged; zero
camera-output differences; public continuation longitudes legal; and the
terrain complete-pose guard unchanged. Remaining genuine findings are reported
as new production defects, not suppressed to obtain green.

`NO HUMAN AUTHORITY DECISION INFERRED`
