# Production heading and inverse-site inventory

Production authority: `c115ce471084175285cbf3440506373264081c79`.

The planner has six logical position-to-heading responsibilities implemented by eleven expressions, and three logical heading-to-position responsibilities implemented by four executable `state.pan - 180` expressions. Comments are not counted as sites.

## Position → heading

| Logical site | File:line | Symbol/expression | Purpose |
|---|---|---|---|
| Opening orbit and staged-hold defaults | `earth-studio-job-planner.js:1868`, `:1877` | `initialCameraState`; `state.pan = 180` | Camera placed at ring bearing 0 and aimed back toward the subject. |
| Exit-aligned staged hold | `:2085` | `theta0Staged + 180` | Aim the staged opening pose from its selected ring bearing. |
| Orbit opening/start | `:2176`, `:2273`, `:2276` | `orbitStartPan` | Establish the initial orbit heading and frame-zero pan. |
| Acquisition target and completion | `:2320`, `:2385`, `:2462`, `:2482` | `theta0 + 180`, `panTarget` | Turn acquisition toward the subject and retain its ending pan. |
| Sweep samples | `:2495`, `:2552`, `:2558` | `sweepPanBase + sweep*t` | Co-sample pan with ring position through coherent and legacy sweeps. |
| Orbit final/continuation state | `:2660` | `sweepPanBase + sweep` | Export accumulated final pan into continuation state. |

All six use the reverse construction either explicitly or through a base computed as `ring bearing + 180°`.

## Heading → position / ring bearing

| Logical site | File:line | Expression | Purpose |
|---|---|---|---|
| Pan/position agreement test | `earth-studio-job-planner.js:2168` | `state.pan - 180` | Decide whether inherited pan recovers the camera's current ring bearing. |
| Carried-camera orbit phase | `:2175` | `theta0 = state.pan - 180` | Infer the orbit start bearing from inherited pan. |
| Successor-orbit arrival and approach | `:2777`, `:2783` | `offsetPoint(..., state.pan - 180, ...)`; `entryBearing` | Place a fly/zoom endpoint on the next orbit ring and derive its tangent approach. |

The last logical site has two executable inverse expressions. A future direct camera-to-subject heading cannot safely be inverted with `pan - 180°`; ring position is a separate geometric state. The oracle therefore forbids unproved latitude/longitude or approach-position changes.

## Supporting spherical reference

`earth-studio-motion-continuity.js:553-559` exports `initialBearing(a,b)`. The diagnostic layer already uses it in the physically correct direction, camera → subject. The oracle implements its own independent bearing and ENU references rather than importing that helper.
