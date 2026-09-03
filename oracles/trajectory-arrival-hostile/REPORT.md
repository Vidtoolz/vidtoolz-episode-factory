# Independent trajectory / arrival hostile oracle — 2026-09-03

## 1. VERDICT

**`TRAJECTORY/ARRIVAL ORACLE FROZEN — ENGINEERING DEFECTS CONFIRMED`**

The endpoint primitive is already spherical in production and both preserved
candidate lines. The antimeridian defect and terrain boundary pose mismatch are
real. The oracle also found two qualifications to the Fable report:

1. its `6.446° / 21.525° / 55.757°` terrain values are reproducible, but are
   ground-intercept-offset surrogate angles, not the true 3-D angle between the
   camera ray and the target ray;
2. the Codex smooth-calm lane has an additional exact-sample seam failure on a
   pure `179.9° → -179.9°` flight, despite the prior report describing that lane
   as seam-safe.

No trajectory repair was inspected or implemented. Neither preserved branch is
adopted.

## 2. PRODUCTION BASELINE

| Item | Observed |
| --- | --- |
| repository | `/home/vidtoolz/vidtoolz-episode-factory` |
| `main` | `6e71c5b39a3c15c656b77548f139e5cf44fb2bbf` |
| `origin/main` after fetch | `6e71c5b39a3c15c656b77548f139e5cf44fb2bbf` |
| ahead / behind | `0 / 0` |
| production worktree | clean |
| oracle worktree | isolated at `/home/vidtoolz/vidtoolz-episode-factory-trajectory-arrival-hostile-oracle-20260902` |

The production checkout was not reset or modified.

## 3. ENDPOINT AUTHORITY

**`CONFIRMED — SAME SPHERICAL ENDPOINT AUTHORITY`**

Production `main`, dirty archive `7aeda9d`, and Codex chain `54a63d2` contain
byte-identical `offsetPoint` function bodies (SHA-256
`f1f6a3dc9e1cc6a22e9c85624c2ab3b31e69df2dad54c1547ee120bdfec20cdb`).
All six hostile primitive cases agree with independent forward-geodesic math to
under `0.2 m`, including the seam and `89.9°N` cases.

The production move-to-orbit endpoint is constructed by `offsetPoint`, assigned
to `entry`, then consumed as `destLat/destLng`. Orbit samples also use
`offsetPoint`. No actual production camera endpoint was found using a planar
placement formula. Planar `111320·cos(latitude)` calculations remain in quality,
bearing, acquisition, and handoff diagnostics/policy sites; those are not
endpoint constructors.

The Codex smooth-calm helper has its own separately formatted but still
spherical forward-geodesic `offsetPoint`. Replacing planar diagnostics with
spherical calculations would therefore not change an approved endpoint.

## 4. SPHERICAL PRIMITIVE

The independently checked invariant is the spherical forward solution:

`φ₂ = asin(sinφ₁ cosδ + cosφ₁ sinδ cosθ)`

`λ₂ = λ₁ + atan2(sinθ sinδ cosφ₁, cosδ − sinφ₁ sinφ₂)`

with `δ = distance / 6,371,000`. Production rounds to six decimals and wraps
the returned longitude into `[-180°, 180°)`. The math is correct; the returned
representation is unsafe when consumed directly by an unwrapped state machine.

Required behavioral invariant:

> For every consecutive camera state, choose the longitude representative
> congruent modulo 360° that preserves intended local continuity. Interpolate
> in that continuous frame; wrap only at serialization, with explicit
> adjacent-frame seam pairs.

Always-wrapped internal state cannot satisfy this. Per-interval shortest-arc
logic is sufficient only if continuation and every ring sample share one
accumulated continuous frame.

## 5. ANTIMERIDIAN REPRODUCTION

Production Earth-Studio-style scalar playback, excluding valid adjacent-frame
`+180/-180` serialization pairs:

| Hostile case | total `|Δlongitude|` | wrong-way travel | result |
| --- | ---: | ---: | --- |
| `179 → -179`, fly only | `2.000°` | `0°` | pass |
| `179.9 → -179.9`, fly only | `0.200°` | `0°` | pass |
| `-179.9 → 179.9`, fly only | `0.200°` | `0°` | pass |
| fly `170 → -170` directly into orbit | `380.303°` | `350.000°` | red |
| fly + zoom into orbit, eastbound | `380.220°` | `350.000°` | red |
| fly + zoom into orbit, westbound | `380.220°` | `350.000°` | red |
| orbit centered `45,179.99` | `720.185°` | `719.982°` | red |
| orbit at seam → travel | `730.196°` | `719.981°` | red |
| travel → hold → orbit | `380.220°` | `350.000°` | red |
| seeded `179.9` continuation → `-179.9` orbit | `360.219°` | `359.916°` | red |
| Tokyo → Los Angeles → orbit | `462.364°` | `298.244°` | red |
| non-seam control | `20.248°` | `0°` | pass |

Mechanism: `targetLng` is first expressed in the state machine's unwrapped
frame. `offsetPoint` then wraps the orbit entry. Production assigns
`destLng = entry.longitude` without re-anchoring it to `state.longitude`. The
serializer faithfully treats that large numerical change as intended motion.

The dirty archive's `crossesAntimeridian` guard does not repair the wrapped
orbit endpoint: direct fly-to-orbit is `340°` wrong and the seam ring still
laps twice. The Codex chain behaves the same in its relevant orbit cases.

Additional oracle finding: Codex smooth-calm pure travel emits an exact `180°`
sample followed later by `-179.95°`, rather than an adjacent seam pair. It
therefore produces about `359.95°` of wrong-way scalar travel on the nominally
safe `179.9° → -179.9°` case. The helper's seam loop excludes a crossing that
equals a sample endpoint.

## 6. ORBIT-SEAM RESULTS

The frozen ring is `orbit 45,179.99 once clockwise tilted 60 degrees for 20
seconds`. Its raw keys include:

`f17 179.999759 → f33 -179.991333` and
`f267 -179.991357 → f283 179.999746`.

Those two intervals are `-359.991092°` and `+359.991103°`; neither is a legal
one-frame serialization seam. Total wrong-way travel is `719.982195°`.

During scalar interpolation, target bearing changes by as much as
`108.076143°/frame`; camera pan changes by only `0.6°/frame`, producing a
maximum computed heading-to-target error of `178.678771°`. The final camera
state is nevertheless correct (`179.99°`, heading `180°`). Thus final-state and
continuation equality do not detect the two laps.

The seeded continuation case likewise ends at the emitted final state but
contains a `359.915567°` acquisition lap, a `125.710387°/frame` target-bearing
step, and up to `179.219315°` heading error.

## 7. TERRAIN POSE DECOMPOSITION

Production encodes no subject elevation. The oracle therefore reports the
current implicit zero-elevation/tangent-plane target separately from any real
terrain-elevation policy. It computes both:

- the existing spherical ground-intercept diagnostic metric; and
- a full ECEF ray-to-target angular separation on a spherical Earth.

For Matterhorn at frame 330:

| Quantity | Value |
| --- | ---: |
| camera lat/lng | `45.796701, 7.658500` |
| camera altitude | `6500 m` |
| target lat/lng | `45.976600, 7.658500` |
| production target elevation | absent; oracle control `0 m` |
| horizontal camera-target distance | `20003.856 m` |
| actual pan / tilt | `0° / 74°` |
| ECEF expected pan / tilt | `0° / 71.917736°` |
| true combined ray error | `2.082264°` |
| spherical ground-intercept surrogate | `6.446126°` (`2664.338 m` miss) |
| planar surrogate | `6.392141°` (`2641.837 m` miss) |
| planar minus spherical surrogate | `-0.053985°` |

The endpoint lies on the orbit's `5736 m / 74°` ring (`20003.809 m`) but carries
the incoming `6500 m / 74°` pose. Its tangent-plane axis ground range is
`22668.194 m`, leaving a `2664.385 m` range mismatch. Counterfactually changing
only altitude to the orbit altitude reduces the spherical intercept metric to
`0.000129°` and the physical ECEF residual to `0.083070°`. That small ECEF
residual is the curvature consequence of sizing the ring as `h·tan(tilt)`.

Heading contributes `0°` here. Tilt is not independently wrong as an authored
value; it is inconsistent with the retained altitude and ring. Target elevation
is an unresolved policy term because the production model does not encode it.

## 8. TERRAIN CORPUS

| Fresh current director case | incoming/orbit altitude | tilt | spherical intercept surrogate | true ECEF ray error | ECEF error with orbit altitude |
| --- | ---: | ---: | ---: | ---: | ---: |
| Matterhorn | `6500 / 5736 m` | `74°` | `6.446126°` | `2.082264°` | `0.083070°` |
| Geirangerfjord | `2500 / 3588 m` | `65°` | `21.525319°` | `6.969270°` | `0.028487°` |
| Mount Fuji | `5500 / 16927 m` | `45°` | `55.757469°` | `26.930885°` | `0.038097°` |

Fresh current director calls for Grand Canyon and Yosemite did not emit a
move-to-orbit staged boundary, so they are observation-only controls rather
than forced terrain reds. This distinguishes current canyon/valley grammar from
the peak/fjord/cone cases.

All three staged cases fail the policy-neutral structural assertion: a boundary
position sized with the successor orbit's altitude/tilt cannot carry a different
altitude/tilt pose.

## 9. THE `6.39°` CASE

The earlier `6.39°` value is reproduced as `6.392141°` by the planar
ground-intercept diagnostic. The same surrogate using a spherical forward
intercept is `6.446126°`; projection accounts for `-0.053985°`. The underlying
range mismatch is `2664.385 m`, caused by `6500 m` arriving on a ring sized for
`5736 m` at the same `74°` tilt.

The technically correct statement is therefore:

- the pose mismatch is real and altitude ownership creates it;
- planar-vs-spherical endpoint placement does not create it;
- `6.446°` is not the actual angular difference between camera and target rays;
  the full 3-D angle is `2.082°` under the code's implicit zero-elevation target.

No acceptability judgment is made for either metric.

## 10. PLANAR DIAGNOSTIC ACCURACY

Each control camera was generated to aim correctly using independent spherical
forward geometry. Maximum false planar error over bearings `0° / 45° / 90°`:

| Scale/control | max false error |
| --- | ---: |
| landmark, `60°N`, `600 m/60°` | `0.058767°` |
| terrain, `46°N`, `6500 m/74°` | `0.145817°` |
| city, `60°N`, `20 km/45°` | `0.144684°` |
| region, `60°N`, `300 km/30°` | `0.786994°` |
| region, `80°N`, `300 km/30°` | `2.683055°` |
| country, `60°N`, `1500 km/20°` | `1.781949°` |
| polar, `85°N`, `20 km/60°` | `1.799598°` |
| polar, `89°N`, `20 km/60°` | `9.951559°` |

Local landmark/terrain/city use stays below `0.15°`. Four cases cross a `1°`
warning threshold despite being constructed as correct spherical controls. The
diagnostic is therefore locally approximate and globally unreliable; this is a
diagnostic-truth defect, not evidence for changing camera endpoints.

## 11. STALE CANARY FINDING

**`PARTIALLY STALE`**

The pinned Aug 19 Matterhorn plan is valid frozen historical evidence:
arrival/orbit are `6500/6500 m` at `72°`. Fresh production emits `6500/5736 m`
at `74°`. Production's quality test reads the pinned `.esp` and `shot-plan.json`
directly; director tests regenerate only high-level decisions. The morphology
evidence script explicitly labels the expected terrain byte change
`EXPECTED_BYTE_CHANGE_NOT_REPINNED`.

Therefore the fixture is intentionally frozen but structurally incomplete as a
canary for current director-to-planner complete pose. Its green result cannot
cover the current mismatch. It should not be re-pinned by this mission.

Human-review applicability is separately negative. The Aug 25 Matterhorn media
used the Codex fixed-pose `.esp` with SHA-256
`49381bd9077b4a914606668529c11f20d49f8cb180debd601134e831ee258e23`;
that artifact emits the boundary at the orbit altitude (`5736 m`). Fresh main
emits the mismatched boundary in an `.esp` with SHA-256
`ce9ce17d7a6b8868e238c3370881e216e0fb7629c79fd087710b919283477bf3`.
The hashes differ, the committed Aug 25 review record has null verdicts, and the
populated uncommitted review/clarification records identify later circling
wobble rather than the current boundary. No tracked review record names the
fresh hash. Therefore:

**`CURRENT PRODUCTION TERRAIN BOUNDARY HAS NEVER BEEN HUMAN-REVIEWED`**

## 12. PURE-TRAVEL SEMANTIC DIFFERENCE

| Case | production / dirty final offset | Codex candidate final offset | final altitude | Codex tilt | Codex frames |
| --- | ---: | ---: | ---: | ---: | ---: |
| Helsinki → Stockholm | `0 m` | `6769.214 m` | `2500 m` | `69.729936°` | `564` vs production `390` |
| same, explicit `45°` tilt | `0 m` | `2499.996 m` | `2500 m` | `45°` | `564` |
| Helsinki → New York | `0 m` | `6769.214 m` | `2500 m` | `69.729936°` | `866` vs production `630` |
| high-latitude control | `0 m` | `6769.214 m` | `2500 m` | `69.729936°` | `564` vs production `390` |

Production and dirty archive arrive directly over the subject. The Codex chain
changes to an offset, target-facing pose only when both candidate lane flags are
enabled; the same branch with flags off retains the production semantic. Public
continuation state changes to that offset pose and longer timing. This is an
observation, not a preference.

## 13. DIRN17 AUTHORITY CONFLICT

`SETTLE_THEN_LAUNCH`:

- source: main
  `package-runs/2026-08-21-earth-studio-orbit-travel-handoff/human-review.json`;
- Mikko verdict completed `2026-08-22T06:45:00+03:00`;
- reviewed videos: `DIRN17-SIDE-BY-SIDE-NORMAL.mp4` and
  `DIRN17-SIDE-BY-SIDE-SLOWMO-x4.mp4`;
- accepted `.esp` SHA-256:
  `2e27fdcdff5d8844dcbe9c5df26da6b3e56497d20d9506b9ee41db5d20d507e9`.

`NEW_BETTER`:

- source branch/SHA: `codex/terrain-orbit-wobble-20260825` /
  `54a63d2e65f0bb1b9f833e17a3c88acd1b5ad07e`;
- source:
  `package-runs/2026-08-25-dirn17-smooth-calm-byte-review/review-session.json`;
- Mikko verdict recorded `2026-08-25T11:04:46.175Z`;
- old/new `.esp` hashes: `2e27fdc…` / `1bdf7b37f4c8eb1e157edbf28f1a5b598426801871c0cd24982c2c12194276fd`;
- real outputs are frozen as OLD/NEW `.esp` plus authenticated `real-traces/OLD.json`
  and `real-traces/NEW.json`.

They do not contradict on settle behavior. Both retain boundary frame `1590`, a
`15`-frame settle hold, unchanged orbit policy, and explicit duration/altitude/
tilt locks. NEW changes geographic path sampling and serialized position
handles. The unresolved conflict is which byte contract/promotion record is
authoritative, because the later accepted contract remains on an unmerged local
chain while main retains the older frozen bytes.

## 14. `100 KM` SWITCH

The Codex/dirty `geographicPathPoint` uses linear latitude/longitude when
`haversine <= 100000`, and slerp above it. The threshold first appears in the
Aug 25 smooth-calm promotion commit `c8e906d`; no rationale beyond “short/local”
was located.

At a `60°N`, bearing-45 control:

- `99 km`: linear, midpoint is `378.551 m` from the great circle;
- `100 km`: this run selected slerp because floating inverse distance landed
  infinitesimally above the literal boundary;
- `101 km`: slerp, midpoint displacement `0 m`.

The one-sided linear-versus-slerp midpoint discontinuity at exactly `100 km` is
`386.301 m`. Classification: **unsupported heuristic with a mathematical path
discontinuity**, but bounded to hundreds of metres in this control and not shown
necessary. It is not an endpoint defect.

## 15. PARTIALLY SPHERICAL PATH FINDING

Arrival endpoints are correct; travel paths are not universally geodesic.

| Equal-latitude leg | geodesic endpoint distance | candidate path excess | max midpoint/cross-track displacement | initial heading candidate / GC |
| --- | ---: | ---: | ---: | ---: |
| `60°N`, ~1000 km | `996.561 km` | `3.081 km` | `33.993 km` | `89.992° / 82.198°` |
| `45°N`, ~5000 km | `4865.205 km` | `135.452 km` | `515.837 km` | `89.978° / 66.326°` |
| `89.9°N`, `0→180` | `22.239 km` | `12.694 km` | `11.119 km` | `89.910° / 0°` |

The single-axis shortcut follows a parallel for every equal-latitude leg,
regardless of length. Equal-longitude meridians are geodesics. This finding must
not be conflated with endpoint correctness.

## 16. APPROACH-POINT CONSEQUENCE

Production computes and emits a shaping point at 80% of a staged fly-to-orbit
move. In the non-seam control its longitude keys are `f60 10°`, `f300
30.041276°`, `f360 30°`, creating a behind-the-tangent acquisition before ring
entry.

Dirty and Codex compute `orbitEntryApproach` but explicitly do not emit it. Dirty
instead emits six sampled geographic points; Codex with candidate flags off has
only the start/end keys. Removal changes staging direction, target acquisition,
and incoming position velocity. It is not itself a seam guard. On a seam case,
production's re-anchored approach contains the bad wrapped endpoint to the final
20%; removing it can expose the entire leg to the wrong-way endpoint.

No global good/bad judgment is made about approach-point removal.

## 17. TECHNICALLY DETERMINISTIC DEFECTS

1. Wrapped `offsetPoint` results are consumed by an unwrapped longitude state,
   causing long-way interpolation and two laps per seam-straddling orbit.
2. The Codex smooth-calm seam emitter misses a crossing exactly on a sampled
   `180°` endpoint.
3. Fresh peak/fjord/cone staged boundaries combine orbit-ring position from one
   altitude/tilt pose with another emitted altitude/tilt pose.
4. Planar diagnostics manufacture threshold-crossing errors at high latitude
   and regional/global scale.
5. The frozen terrain canary is not coverage for current director complete pose;
   it is only historical authority.

The 100 km switch and equal-latitude parallel path are technical observations,
but travel-path authority is not frozen by this mission.

## 18. HUMAN-AUTHORITY QUESTIONS

1. At a staged boundary, does incoming/gazetteer altitude, successor morphology/
   orbit altitude, an explicit pre-orbit transition, or a joint framing solve own
   the pose?
2. Does pure `fly to X` mean hover over X or look at X from an offset?
3. Does the later DIRN17 NEW byte contract supersede the older main contract?
4. What physical elevation or feature is the target for terrain framing? The
   current model supplies no target elevation.

## 19. ORACLE GROUPS

- A — pass/fail: independent geometric primitives and endpoint-constructor truth.
- B — pass/fail: antimeridian scalar playback and continuous-longitude invariant.
- C — pass/fail: internally consistent complete pose, without choosing altitude owner.
- D — pass/fail: diagnostic truth against spherical controls.
- E — observation only: pure-travel semantics and continuation consequences.
- F — observation only: DIRN17/human evidence identity.
- G — pass/fail: canary freshness versus current generation.

## 20. PRODUCTION ORACLE RESULT

| Group | pass | red | observation |
| --- | ---: | ---: | ---: |
| A geometric primitives | 3 | 0 | 0 |
| B antimeridian | 4 | 8 | 0 |
| C terrain complete pose | 0 | 3 | 2 |
| D diagnostic truth | 4 | 4 | 0 |
| E pure travel | 0 | 0 | 4 |
| F DIRN17 evidence | 0 | 0 | 1 |
| G canary freshness | 0 | 1 | 0 |
| **total** | **11** | **16** | **7** |

Oracle exit code on main: `1`, intentionally. Reds were not weakened.

## 21. FROZEN IDENTITY

| Item | Identity |
| --- | --- |
| branch | `codex/trajectory-arrival-hostile-oracle-20260902` |
| oracle commit | branch HEAD recorded in the final handoff; a commit cannot contain its own SHA |
| corpus SHA-256 | `7d692f9581c7284f27852ca9b5eab405d6cf975d6bd2f913691ebea58ce25fc0` |
| comparator SHA-256 | `38a9c6e481568ee25f31e7025ea8a096ebf399348689ae57e3d2a23fbc372a5f` |
| manifest SHA-256 | `87c9044951bd594e5cf79df57c62b4e6014044d5a6a077d299fc9388b1754a71` |

Remote equality and final cleanliness are verified after push and recorded in
the handoff.

## 22. INDEPENDENCE

`TRAJECTORY / ARRIVAL REPAIR INSPECTED BEFORE ORACLE FREEZE: NO`

The Fable report was read as a claim inventory. Expected values were recomputed
from production source and output using independent geodesic, ECEF, and scalar
playback calculations. No repair branch exists in this mission.

## 23. HUMAN DECISION PACKAGE

### Boundary altitude / pose ownership

| Option | Measurable consequence |
| --- | --- |
| A incoming/gazetteer owns | no boundary altitude step; current cases retain surrogate errors `6.446° / 21.525° / 55.757°`; correction is carried into the orbit (`-764 m`, `+1088 m`, `+11427 m`) |
| B orbit/morphology owns at boundary | surrogate error falls near zero; a boundary-only application creates the full altitude step unless the arrival is changed |
| C arrival explicitly transitions | same consistent boundary as B; mean altitude rates over the arrival are fixed by delta/duration, with a rest-to-rest smoothstep peak `1.5×` mean; no orbit correction |
| D joint pose solve | can keep position/altitude and solve pan/tilt, or keep altitude/tilt and move the ring; Matterhorn ring-position alternative shifts `2664.385 m`; no unique solve exists until preserved framing variables are named |

### Pure-travel arrival

| Option | Measurable consequence |
| --- | --- |
| hover over destination | final horizontal offset `0 m`, default `2500 m/45°`, current durations and continuation state |
| offset look-at | final offset `2.500–6.769 km` in the hostile corpus, target-facing tilt `45–69.73°`, longer timing (`390→564`, `630→866`), continuation seeds from the offset pose |

### DIRN17

| Option | Measurable consequence |
| --- | --- |
| retain main contract | SHA `2e27fdc…`; preserves Aug 22 reviewed bytes and 15-frame settle |
| promote later NEW contract | SHA `1bdf7b3…`; preserves the same settle boundary/hold and explicit locks, but changes path sampling and serialized position handles |

The oracle gives no recommendation on these human-owned choices.

## 24. NEXT MISSION

Recommend the hardest technically deterministic repair for Fable 5.1:

**`ANTIMERIDIAN CONTINUOUS-LONGITUDE AUTHORITY REPAIR`**

It is catastrophic, global, reproducible without an aesthetic decision, and
currently hidden by correct final states. The repair mission must also include
the exact-sample seam case in the Codex smooth-calm emitter. This oracle does not
implement that repair.
