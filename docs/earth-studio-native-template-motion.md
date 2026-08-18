# Earth Studio native Quick Start motion — Gate 2 derivation authority

**Status: IMPLEMENTED (Gate 3, 2026-08-18) — Gate 4 visual acceptance pending.**
Derived from the frozen Gate 1 native evidence corpus
(`package-runs/2026-08-18-earth-studio-native-templates/`,
15 references + gate-0 probe + determinism repeat + 2 Gate 2 supplements).
Machine-readable authority: `…/derivation/native-template-motion-v1.json`
(pinned by sha256 in `earth-studio-native-template-profiles.js`).

Status vocabulary (do not collapse these):

- **NATIVE EVIDENCE** — frozen Gate 1 captures of the real templates.
- **DERIVED SPEC** — the Gate 2 grammar below (unchanged by Gate 3).
- **IMPLEMENTED** — Gate 3 builders in `earth-studio-native-template-profiles.js`
  (`ges-native-derived-v1`), reconstruction-tested against every frozen reference
  (`scripts/earth-studio-reconstruction-matrix.js`; frozen matrix under
  `package-runs/2026-08-18-earth-studio-native-template-implementation/comparison/`).
- **IMPORT VERIFIED** — proven by a real Google Earth Studio import +
  re-export round-trip (Gate 3C, 2026-08-18): Orbit (active Camera Target,
  linear altitude) and Zoom-To (logarithmic altitude, inert target) fixtures
  imported cleanly, behaved correctly live, and re-exported with only
  Save-As name / scrub-state / ≤1e-12 rounding differences. Point-to-Point,
  Spiral and Fly-To-and-Orbit share those exact serialization shapes and are
  COMPONENTS_IMPORT_VERIFIED (not directly imported).
- **VISUAL ACCEPTED** — Gate 4, Mikko's verdict only. **No template is
  `VERIFIED_NATIVE_MATCH` yet.**

## Gate 3 implementation summary

- Module: `earth-studio-native-template-profiles.js` — additive; the generic
  planner path stays byte-identical (enforced against
  `controls/v094-byte-control-manifest.json` by the BYTE-STABILITY test).
- Runtime template IDs: `ges_zoom_to_derived_v1`, `ges_orbit_derived_v1`,
  `ges_point_to_point_derived_v1`, `ges_spiral_derived_v1`,
  `ges_fly_to_and_orbit_derived_v1`; profile version `ges-native-derived-v1`.
- Explicit intent only: GUI selector on `project-earth-studio.html`, or an
  explicit phrase (`template: orbit`, `Earth Studio Spiral template`,
  `use Quick Start Fly-To-and-Orbit`). Generic wording never activates one.
- Required explicit derived inputs (never invented): Zoom-To end framing
  (lon/lat/altitude), Point-to-Point per-point framing + POI + transit peak
  (default law flagged MEDIUM), Orbit/Spiral/Fly-Orbit target altitude,
  Spiral start/end altitudes, Fly-Orbit end altitude.
- modelVersion strategy: templates serialize the native shape
  (`type:"quickstart"`, `modelVersion:18`, `groupedPosition`, per-project
  `animationModel.logarithmic`); the generic planner's legacy import shape is
  untouched; the inspector parses both (and now decodes logarithmic altitude
  via the per-attribute `value.logarithmic` flag, exponent 15).

## Global findings

- **Determinism**: identical wizard inputs produce bit-identical camera
  keyframes. Only `settings.name` and `sunGroup.worldTime` value ranges
  (capture wall-clock) differ. Classification:
  `SEMANTICALLY_DETERMINISTIC` — exact fitting is valid. (HIGH)
- **Geodesic basis**: all template distances are exact on a sphere of radius
  **6,378,137 m**: orbit default radius 624.0 m, spiral 2000→500 m, fly-orbit
  approach offset 20,000.0 m. (HIGH)
- **Altitude encoding is per-project**: `animationModel.logarithmic=false`
  (orbit, spiral, fly-orbit) stores `(alt+500)/65,117,981` linearly;
  `logarithmic=true` (zoom-to, point-to-point) stores
  `((alt+500)/65,117,981)^(1/15)` — **exponent 15 is an exact native
  constant** (0.3 m residual over the full range). Interpolation happens in
  the stored space, which is what produces the perceptual zoom curve. (HIGH)
- **Rotation**: no template writes pan/tilt keyframes. Orbit/Spiral/Fly-Orbit
  aim the camera exclusively through `cameraTargetEffect` (influence 1);
  Zoom-To/Point-to-Point keep pan/tilt at 0/0 with an inert (influence 0)
  target group. Tilt observed in the editor is always the geometric look-at
  angle `atan(horizontal_radius / vertical_separation)` — verified 63.435°,
  82.88°, 45.2° cases. (HIGH)
- **Tool defect (FIXED in Gate 3)**: `scripts/inspect-earth-studio-project.js`
  previously linear-denormalized altitude even for logarithmic-model projects;
  it now decodes via the per-attribute `value.logarithmic` flag (exponent 15).
  The frozen Gate 1 `inspector-full.json` dumps for zoom-to/point-to-point
  still carry the old wrong altitude *meters* (raw normalized values are
  correct) — they are frozen evidence and were not regenerated.

## Zoom-To (`ges_zoom_to_derived_v1`)

2 keyframes per property at **t = 0 and t = 0.8** (final 20% = implicit
hold); invariant across 5 s and 15 s (FULL_NORMALIZED_SCALING). Lon/lat
constant (camera fixed above the end framing). Altitude descends from
Starting Altitude (default 65,117,481 m = slider max) to the post-search
framing altitude (Earth-Studio-derived; 1028.3 m London Eye, 530.5 m Empire
State), interpolated in power-15 space with `out=auto(0.2)` at start and
`in=custom(x=-0.32, influence 0.4)` at the end keyframe. No target lock
(influence 0). Confidence HIGH throughout; the end-framing altitude itself
is Google-derived and must be treated as an input in Gate 3.

## Orbit (`ges_orbit_derived_v1`)

5 keyframes at **t = 0/0.25/0.5/0.75/1**, exactly 90° of azimuth apart,
radius constant (<0.01 m drift), altitude constant. Default duration 50 s;
25 s reference keeps identical normalized times (FULL_NORMALIZED_SCALING —
angular velocity = 360°/duration). Defaults: radius **624 m**
(site-independent), camera altitude ≈ **round(target_alt + 312)** (fits both
sites; exact rounding law ambiguous), start heading 0° = camera starts due
north. Direction: default counter-clockwise (bearing decreasing 0→−360°).
Easing: endpoints `linear`, interiors `auto(x=±0.066, influence 0.5)` —
constant angular velocity. Tilt = `atan(radius/Δalt)` via target lock
(verified two radius regimes). Confidence HIGH except the altitude-default
rounding law and the clockwise sign for the *standalone* template (inferred
from fly-orbit supplement; MEDIUM).

## Point-to-Point (`ges_point_to_point_derived_v1`)

Timing is **ABSOLUTE_SEGMENTS**: per-point hold (default 2 s) + per-leg
transit (default 5 s); keyframe times = cumulative seconds / total
(verified 2/5/2 → 0, 0.2222, 0.5, 0.7778, 1 and 2/12/2 → 0, 0.125, 0.5,
0.875, 1). Five keyframes for two points: hold-start, departure, transit-mid
(CURVE_SUPPORT at the temporal midpoint), arrival, hold-end. Horizontal path
is **per-channel property interpolation, not great-circle** — the transit-mid
lon/lat is the arithmetic endpoint mean even London→Paris (341 km). Altitude
(power-15 space): holds at the point framing altitude; explicit transit peak
≈ **1.57–1.63 × leg distance** above the holds (5.09 km @ 3.12 km;
533.96 km @ 340.95 km) — functional form AMBIGUOUS (k·distance vs FOV-fit),
needs one mid-distance supplement. Easing: hold-exit
`custom(x=1, influence 0.2)`, arrival `custom(x=-1, influence 0.2)`,
transit-mid `auto(influence 0.35)`. Pan/tilt untouched (top-down
throughout); target group inert with zero-valued influence keyframes at hold
boundaries. Confidence HIGH except the peak-altitude law (MEDIUM) and 3–6
point interior topology (unobserved).

## Spiral (`ges_spiral_derived_v1`)

Keyframes at **exactly 90° of swept angle** + endpoint (360°→5, 720°→9).
With f = swept/total angle fraction:

- **radius(f) = end + (start−end)·(1−f)³** (cubic; ≤0.1% residual, confirmed
  by the 720° reference's independent f=0.125 sample)
- **altitude(f) = end + (start−end)·(1−f)²** (quadratic; same validation)
- keyframe **times follow constant 3D path speed** (arc-length-uniform;
  predicted 0.4437/0.6985/0.8627 vs observed 0.4413/0.6947/0.8613, <0.5%)
- rotation is **clockwise (bearing increasing) with no UI toggle** — note:
  opposite of Orbit's default direction.

Endpoint keyframes `linear`, interiors `auto` with spacing-derived
influence. Target lock influence 1; tilt fully look-at-derived. Duration
scales the whole schedule (FULL_NORMALIZED_SCALING). Confidence HIGH
(placement, laws), MEDIUM (exact arc-length metric, <0.5% effect).
**Spiral is no longer unimplementable-for-lack-of-evidence.**

## Fly-To and Orbit (`ges_fly_to_and_orbit_derived_v1`)

Two-phase grammar, 6 keyframes, invariant at 25 s and 50 s:

- **APPROACH, t ∈ [0, 0.2]** — one eased segment. Start position:
  azimuth = **approach_angle − 90°·orbit_sign**, horizontal distance =
  **orbit_radius + 20,000 m** (exact), altitude = **end_altitude +
  20,000 m** (exact, 0.0 m residual across 4 refs). The equal 20 km
  offsets produce the observed ≈45° initial look-at tilt. The approach
  sweeps 90° of azimuth in the orbit's rotational direction, decelerating to
  zero vertical speed at entry (`altitude in=custom(x=-0.5, influence 1)`)
  and near-zero horizontal speed (`in=custom(x=-0.198, influence 0.99)`).
- **ORBIT, t ∈ [0.2, 1.0]** — **grammar identical to standalone Orbit**
  (90°-per-keyframe, endpoint-linear/interior-auto, constant radius =
  orbit_radius UI, constant altitude = end_altitude): entry azimuth =
  **approach_angle** (supplement E: 90° → entry due east), sweep 360° with
  orbit_sign (+ = clockwise when checked, − default).

Duration: FULL_NORMALIZED_SCALING (approach always 20%). Verdict vs
standalone Orbit: **SHARED_GRAMMAR**, different parameter sources (radius
default 400 vs 624; altitude = end_altitude vs target+312). Confidence HIGH;
residual unknowns: behavior at non-cardinal approach angles (0° and 90°
captured; law consistent) and clockwise topology confirmed by a single
supplement.

## Camera-target serialization (IMPLEMENTED + IMPORT VERIFIED)

`cameraGroup → cameraTargetEffect { enabled{relative:0|1},
poi{longitudePOI, latitudePOI, altitudePOI — normalized keyframes},
influence{{}=default 1 | {relative:0}} }`. POI denormalization: lon
`v·360−180`, lat `v·180−90`, alt `v·65,117,981−500`. Implemented by
`buildLockedCameraTarget` (byte-equal to the frozen native Orbit subtree)
plus the per-template inert scaffolding shapes, and **IMPORT VERIFIED** by
the Gate 3C real Earth Studio round-trip: the imported locked target drove
pan/tilt live exactly per the look-at law and re-exported byte-faithfully.
The generic (untemplated) serializer still authors no target (empty default
scaffold only).

## Per-template Gate 3 status

| Template | Reconstruction vs frozen refs | Import status | Gate 3 status |
|---|---|---|---|
| Zoom-To | RECONSTRUCTED_EXACT (all 3 refs) | IMPORT_VERIFIED (real round-trip) | IMPLEMENTED_IMPORT_VERIFIED_VISUAL_PENDING |
| Orbit | RECONSTRUCTED_EXACT (all 3 refs) | IMPORT_VERIFIED (real round-trip, live target lock) | IMPLEMENTED_IMPORT_VERIFIED_VISUAL_PENDING |
| Point-to-Point | EXACT (ref-a/c), inert-scaffolding variance only (ref-b) | COMPONENTS_IMPORT_VERIFIED | IMPLEMENTED_EXPERIMENTAL_VISUAL_PENDING |
| Spiral | SEMANTIC_MATCH (values exact; timing within the documented <0.5% native residual) | COMPONENTS_IMPORT_VERIFIED | IMPLEMENTED_EXPERIMENTAL_VISUAL_PENDING |
| Fly-To-and-Orbit | RECONSTRUCTED_EXACT (all 4 refs incl. sup-e) modulo jittered entry in-handles (asserted semantically) | COMPONENTS_IMPORT_VERIFIED | IMPLEMENTED_EXPERIMENTAL_VISUAL_PENDING |

## Retained Gate 2 MEDIUM/UNKNOWN items (implementation does not erase these)

- P2P transit-peak functional form (k·distance with k≈1.6 implemented as the
  default; observed 1.57–1.63; explicit override supported).
- Orbit default camera-altitude rounding law (round(target+312) implemented;
  exact native rounding unproven).
- Standalone-orbit clockwise sign (inferred from the fly-orbit supplement).
- Non-cardinal approach/start azimuths (0°/90° evidence only; others
  generated but flagged EXTRAPOLATED).
- P2P 3–6 point topology (unobserved; builder enforces 2 points).
- Spiral angle_start > 0 (uncaptured; flagged EXTRAPOLATED).
- Spiral exact arc-length metric (<0.5% timing effect; numeric approximation)
  and the interior 0.16-handle y geometry (few-percent save-state jitter in
  the native corpus itself).

## Gate 3 constraints (standing)

1. Untemplated plans stay byte-identical to the v0.9.4 controls
   (`controls/v094-byte-control-manifest.json`).
2. Templates activate only on explicit intent; provenance records
   `template_id` + `template_profile_version`.
3. `cameraTargetEffect` authoring: **IMPORT_VERIFIED** as of Gate 3C
   (2026-08-18) — evidence under
   `package-runs/2026-08-18-earth-studio-native-template-implementation/`.
4. No `VERIFIED_NATIVE_MATCH` claim before Mikko's Gate 4 visual acceptance.
5. 9:16 Fly-To-and-Orbit validation is mandatory before production use (no
   aspect-dependent motion parameters observed in `.esp`, but visual
   confirmation is required) — flagship candidate:
   `…implementation/gate4-candidates/VIDTOOLZ-G3-FLY-ORBIT-916.esp`.
6. Browser automation stays research/acceptance infrastructure only — the
   production planner never drives Earth Studio; operators import the `.esp`.
