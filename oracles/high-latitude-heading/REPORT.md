# Independent high-latitude heading authority report

## 1. Verdict

`HIGH-LATITUDE HEADING ORACLE FROZEN — DETERMINISTIC DEFECT CONFIRMED`

## 2. Production baseline

`main == origin/main == direct remote == c115ce471084175285cbf3440506373264081c79`; ahead/behind `0/0`; production worktree clean.

## 3. Production heading sites

Six logical position-to-heading responsibilities use eleven expressions in `earth-studio-job-planner.js`: opening orbit/staged hold (`1868`, `1877`), exit-aligned staged hold (`2085`), opening/start (`2176`, `2273`, `2276`), acquisition (`2320`, `2385`, `2462`, `2482`), sweep (`2495`, `2552`, `2558`), and final/continuation state (`2660`). See `INVENTORY.md`.

## 4. Inverse sites

Three logical inverse responsibilities use four executable expressions: pan/position agreement (`2168`), carried-camera phase (`2175`), and successor ring-entry/approach geometry (`2777`, `2783`). A 1.254481° heading correction naively inverted into a 29,469 m Stockholm ring moves entry by 645.206 m. Position and heading must therefore be separate authorities.

## 5. Independent geometric reference

Independent spherical initial bearing and independent ECEF/local-ENU azimuth agree within `2.6262e-11°` over 504 cases. No production or future-candidate bearing helper is imported.

## 6. Spherical asymmetry

Initial bearing is a local tangent direction. Along a non-meridional great circle, convergence of longitude meridians rotates that tangent relative to local north. Therefore the arrival tangent at B is not generally the initial tangent at A plus 180°. Algebraically, swapping `(lat1,lat2)` in `atan2(sin Δλ cos lat2, cos lat1 sin lat2 − sin lat1 cos lat2 cos Δλ)` changes both numerator sign and denominator; it does not simply add π.

## 7. Error envelope

Maximum error across eight compass bearings, in degrees:

| Latitude | 1 km | 3 km | 10 km | 35 km | 80 km | 100 km | 500 km |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0° | 0.000000 | 0.000003 | 0.000035 | 0.000432 | 0.002259 | 0.003529 | 0.088315 |
| 30° | 0.005192 | 0.015577 | 0.051922 | 0.181727 | 0.415361 | 0.519188 | 2.591685 |
| 45° | 0.008993 | 0.026980 | 0.089932 | 0.314758 | 0.719401 | 0.899211 | 4.482824 |
| 60° | 0.015577 | 0.046730 | 0.155767 | 0.545166 | 1.245907 | 1.557223 | 7.733061 |
| 65° | 0.019286 | 0.057858 | 0.192859 | 0.674976 | 1.542468 | 1.927794 | 9.543852 |
| 70° | 0.024709 | 0.074126 | 0.247085 | 0.864733 | 1.975857 | 2.469235 | 12.155918 |
| 80° | 0.051003 | 0.153009 | 0.510017 | 1.784521 | 4.073262 | 5.086690 | 24.790243 |
| 85° | 0.102793 | 0.308376 | 1.027819 | 3.593017 | 8.167444 | 10.170679 | 60.129803 |
| 89° | 0.515207 | 1.545288 | 5.138388 | 17.470302 | 45.997707 | 60.204303 | 180.000000 |

The oracle evaluates all 504 individual direction cases, not only these maxima.

## 8. High-latitude cases

Planner keyframe maxima are 1.245925° at 60°N/80 km, 8.247727° at 85°N/80 km, and 18.142089° at 89°N/34.641 km. Fine-grained independent geometry gives 1.246309°, 8.252371°, and 18.344742° respectively.

## 9. Pole / zero-radius contract

At radius zero, camera equals subject and bearing is undefined. The declared spin remains stationary and preserves its 360° pan sweep. At distinct camera/target positions, including a target at 90°N, direct local bearing remains finite. A ring enclosing the pole has target-facing pan winding 0 even though position completes a revolution; position sweep proves the orbit there. No NaN, wrap oscillation, or arbitrary heading flip is allowed.

## 10. Heading continuity

Target-facing angles use the scalar representative nearest the previous pan. Production ordinary and seam rings remain bounded per sample, but the hostile acquisition case jumps from 729.955230° at frame 48 to 19.737839° at frame 63: −710.217391° over 15 frames.

## 11. Revolution authority

Production preserves +180°, ±360°, and ±720° requested sweeps. Independent direct target bearings have the same winding for ordinary non-pole-enclosing half/full/twice rings. At pole-enclosing rings, semantic revolution belongs to position while target-facing pan may have zero winding.

## 12. Acquisition → sweep

Production is RED. Equivalent target-facing headings at a movement boundary must use a continuous scalar representative; modulo-equal endpoints are insufficient.

## 13. Tracked corpus distribution

199 plans contain 106 orbit plans, 115 non-zero-radius orbit segments, one explicit zero-radius spin, and one indeterminate legacy London orbit lacking tilt/radius authority. Segment/plan counts above descriptive bins: >0.1° `70/59`; >0.5° `2/2`; >1° `2/2`; >2°, >5°, >10° all `0/0`. Maximum tracked miss is 1.784016° at 89°N on D09 near-pole A-coarse.

## 14. Dry-run field differential

Oracle-only direct-bearing simulation classifies 96 plans IDENTICAL, 93 HEADING_ONLY, nine SECONDARY_POSITION_RISK, and one ZERO_RADIUS_SPIN. It would change 1,101 measured pan keyframes and zero non-pan fields. The nine risk plans contain eleven current inverse-coupling events; risk is not permission to move position.

## 15. Allowed future change contract

Allowed: pan track values, final pan, continuation pan. Disallowed by default: latitude, longitude, altitude, tilt, keyframe timing, easing, segment count, ring radius, and approach position. A future collision must prove any claimed geometry exception independently.

## 16. Terrain horizontal control

Matterhorn horizontal-only orbit miss is 0.186279°. Altitude ownership, vertical aim, and target elevation are excluded.

## 17. Human review evidence

The authoritative SETTLE_THEN_LAUNCH review covers Helsinki and Stockholm orbits whose measured misses are 0.462198° and 0.446754°. Correcting those small horizontal errors does not alter position/timing/easing under the oracle contract. The review cannot authorize unreviewed high-latitude errors.

## 18. Production oracle result

Independent reference: PASS. Physical envelope: 167 PASS / 337 RED. Planner targeted cases: one PASS / 15 RED. Zero-radius spin: PASS. Pole finite guard: PASS. Revolution controls: PASS. Acquisition continuity: one RED. Inverse coupling: observation/risk gate. Tracked corpus: observation-only.

## 19. Frozen identity

Branch and hashes are recorded after commit/push/read-back in the mission handoff. The manifest binds corpus, comparator, runner, test, inventory, report, and production summary.

## 20. Independence

`HIGH-LATITUDE HEADING REPAIR INSPECTED BEFORE ORACLE FREEZE: NO`

No repair branch existed when the oracle was constructed.

## 21. Semantic authority

For every non-zero-radius targeted orbit camera position C around declared subject S, authoritative horizontal pan is the local spherical bearing C→S, expressed using a continuous scalar representative. Ring position is independent geometric state, not `pan − 180°`. Zero-radius declared spins retain their authored pan sweep.

## 22. Human authority

`NOT REQUIRED`

Production doctrine already requires the camera to face the declared orbit subject; no intentional look-ahead/offset orbit framing contract was found.

## 23. Next mission

`FABLE 5.1 HIGH-LATITUDE HEADING AUTHORITY REPAIR`

No repair is implemented here.
