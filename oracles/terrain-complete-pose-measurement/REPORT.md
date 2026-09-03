# Independent terrain complete-pose measurement report

## Verdict

`TERRAIN COMPLETE-POSE DEFECT INDEPENDENTLY CONFIRMED`

The three current staged terrain arrivals are horizontally aimed at their declared subject to numerical precision, yet their full optical rays do not hit the same zero-elevation target point. The defect is a complete-pose inconsistency, not a horizontal-bearing defect. No altitude, tilt, or target-elevation owner is selected here.

## Production authority

- `main`, `origin/main`, direct remote, and the clean production worktree were all `7b63c6b430f964087665a6c9a4626b79e42bcad9` with ahead/behind `0/0` before isolation.
- Oracle work was performed in a separate worktree and branch.
- No Claude live terrain worktree, conclusion, or diff was inspected.

## Measurement authority

At serialized camera geodetic state `C=(lat, lon, altitude)` and target `S=(lat, lon, elevation)`:

1. Convert `C` and `S` independently to ECEF.
2. Build local east/north/up at `C`.
3. Interpret pan as clockwise azimuth from local north and tilt as degrees from local nadir.
4. Build the unit optical ray
   `sin(tilt)(cos(pan) north + sin(pan) east) - cos(tilt) up`.
5. Measure complete error as the angle between that ray and `normalize(S_ECEF-C_ECEF)`.
6. Measure horizontal error separately as wrap-safe pan minus the azimuth of the target ray projected into local ENU.
7. Measure the vertical component as serialized tilt minus the target ray's required tilt from nadir.

This is not a ground-intersection-angle calculation. It directly compares the camera optical ray with the true camera-to-target ECEF ray.

## Exact production measurements

Primary WGS84 results, using the explicitly frozen `target elevation = 0 m` compatibility assumption:

| Case | Frame | Serialized camera `(lat, lon, alt, pan, tilt)` | Slant distance | Horizontal error | Required tilt | Vertical component | Full 3-D error |
|---|---:|---|---:|---:|---:|---:|---:|
| Matterhorn | 330 | `(45.796701, 7.658500, 6500 m, 0°, 74°)` | 21,035.263 m | 0° | 71.910800° | +2.089200° | 2.089200° |
| Mount Fuji | 270 | `(35.208372, 138.727400, 5500 m, 0°, 45°)` | 17,768.986 m | ~0° | 71.893109° | -26.893109° | 26.893109° |
| Geirangerfjord | 390 | `(62.035702, 7.205400, 2500 m, 0°, 65°)` | 8,108.423 m | 0° | 72.007308° | -7.007308° | 7.007308° |
| Grand Canyon | 540 | `(36.054400, -112.140100, 48194 m, 0°, 72°)` | 48,194.000 m | undefined | 0° | +72° | 72° |

Grand Canyon's camera is directly above the coordinate, so its horizontal target direction is undefined; inventing an `atan2` bearing would be a measurement bug. Its 72° figure is a pure-travel/hold observation and is not counted as a staged-orbit-boundary defect.

Exact WGS84 vectors (metres for positions, unitless for rays) are frozen in `production-results.json`. Compact values:

| Case | Camera ECEF | Target ECEF | Optical ray |
|---|---|---|---|
| Matterhorn | `(4419303.624, 594254.143, 4554181.513)` | `(4400584.137, 591736.975, 4563440.397)` | `(-0.873415247, -0.117446248, 0.472601508)` |
| Mount Fuji | `(-3924468.511, 3444405.982, 3659950.380)` | `(-3913758.825, 3435006.364, 3670565.778)` | `(0.740631231, -0.650033154, 0.170065511)` |
| Grand Canyon | `(-1960269.550, -4817885.745, 3761438.106)` | `(-1945585.518, -4781795.815, 3733073.377)` | `(0.305106547, 0.749880792, 0.587016859)` |
| Geirangerfjord | `(2976166.699, 376262.266, 5612590.188)` | `(2968243.831, 375260.617, 5613994.243)` | `(-0.990775404, -0.125258911, 0.051713683)` |

## Historical figures reproduced

The historical approximations reproduce exactly only with all of these assumptions:

- spherical Earth with radius `6,371,000 m`;
- target elevation `0 m`;
- last serialized frame of the incoming segment marked `ends_at_orbit_entry`;
- pan clockwise from local north;
- tilt measured from nadir;
- camera altitude taken from the incoming serialized state;
- true ECEF ray angle, not ground-intersection angle.

| Case | Historical approximation | Independent spherical result | WGS84 result |
|---|---:|---:|---:|
| Matterhorn | ~2.082° | 2.082264285593° | 2.089200356406° |
| Geirangerfjord | ~6.969° | 6.969270111278° | 7.007307515728° |
| Mount Fuji | ~26.931° | 26.930884809907° | 26.893109473040° |

Thus the historical measurement is confirmed as a spherical zero-height compatibility measurement, not as an assumption-free terrain truth.

## Input ownership and constraint composition

- Target elevation currently used by this planner path: **none**. Subject records provide latitude/longitude and camera framing/floor metadata, but no serialized target elevation. The oracle's `0 m` is explicit and replaceable.
- Incoming boundary camera altitude: gazetteer framing — Matterhorn `6500 m`, Fuji `5500 m`, Geirangerfjord `2500 m`.
- Morphology tilt: `earth-studio-terrain-morphology.js` supplies `74°`, `45°`, and `65°`; the Director emits those numbers into the description, so the downstream shot plan labels them `explicit`.
- Morphology orbit altitude: derived by preserving the old 72° reference radius, yielding approximately `5736.325 m`, `16927.259 m`, and `3587.869 m`, then serialized as rounded explicit orbit values.
- Boundary horizontal position: the planner uses successor orbit altitude and tilt to construct the entry ring.
- Boundary altitude: the incoming segment retains its gazetteer altitude.

Those independently owned quantities over-constrain a zero-height complete pose: successor-orbit geometry chooses horizontal range, incoming framing chooses altitude, and morphology chooses tilt. Horizontal pan remains correct. As a measurement-only sensitivity check, replacing only the incoming altitude with the successor orbit altitude reduces WGS84 error to `0.089324°` (Matterhorn), `0.102270°` (Fuji), and `0.021091°` (Geirangerfjord). This is not an altitude-owner recommendation; the small residual reflects spherical/ellipsoidal curvature versus the tangent `altitude*tan(tilt)` construction.

Holding the serialized camera pose fixed and solving only for an elevation on the subject's geodetic vertical makes the same conflict visible another way: the ray intersects at about `+797.038 m` for Matterhorn, `-11,336.520 m` for Fuji, and `-1,090.842 m` for Geirangerfjord. These are sensitivity results, not adopted terrain elevations. In particular, production does not carry values that could explain the large Fuji and Geirangerfjord mismatch.

The production provenance is directly visible at the frozen SHA:

- `earth-studio-journey.js:743-770` selects calibrated gazetteer altitude on automatic framing.
- `earth-studio-director.js:879-895` obtains and emits morphology tilt/altitude policy.
- `earth-studio-terrain-morphology.js:31-60,77-110` defines the morphology tilts and preserves the old 72-degree footprint while deriving orbit altitude.
- `earth-studio-job-planner.js:1868-1874` defines the tangent-plane orbit radius, and `:2819-2829` builds the arrival entry position from the successor orbit altitude and tilt while leaving the incoming altitude track under its own authority.

## Existing test/QC coverage

Current camera-quality evaluates all four generated artifacts as `PASS_FOR_HUMAN_REVIEW`, despite the complete-pose values above. That verdict is structurally incomplete for this question: production camera-quality explicitly defines aim as **horizontal** heading-to-subject error and does not calculate a 3-D optical ray.

Related tests do not supply missing coverage:

- `tests/earth-studio-heading-authority.test.js` explicitly verifies horizontal aim and that altitude/tilt remain untouched.
- `tests/earth-studio-director.test.js` checks the tangent `altitude*tan(tilt)` ring feasibility and preserved footprint, not the serialized arrival boundary's ECEF ray.
- `tests/earth-studio-visual-review.test.js` requires camera-quality `PASS_FOR_HUMAN_REVIEW`, inheriting that horizontal-only blind spot.

These checks are valid for their narrow contracts but incorrectly serve as a complete-pose certification if interpreted broadly. No current test computes the serialized boundary camera-to-target ECEF angular error.

## Scope and human authority

The deterministic finding is: for an explicitly chosen target point, the serialized camera pose either points at it or it does not. Under the only currently reproducible compatibility target (`lat/lon, 0 m`), the staged boundaries do not.

Still undecided and deliberately not encoded as acceptance policy:

- whether incoming/gazetteer altitude, morphology/orbit altitude, or a transition owns the boundary;
- what terrain elevation defines the visual target;
- whether tilt, altitude, range, or framing should yield in a joint solve;
- whether Grand Canyon pure travel should target the coordinate while tilted.

The frozen comparator is therefore a measurement authority, not a repair-policy oracle.
