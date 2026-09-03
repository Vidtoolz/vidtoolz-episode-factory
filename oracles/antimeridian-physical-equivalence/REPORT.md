# Antimeridian Physical-Equivalence Oracle v2 Freeze Report

## Verdict

`ANTIMERIDIAN PHYSICAL-EQUIVALENCE ORACLE V2 FROZEN`

This oracle is additive. Historical oracle `c604b2cfa467630f6b0fb8747e2c34204e5d04c0` remains byte-unchanged and **VALID FOR OLD CONTRACT**. Oracle v2 supersedes it only for antimeridian physical-equivalence semantics.

## Parent and independence

- Branch: `codex/antimeridian-physical-equivalence-oracle-v2-20260903`
- Parent: `c604b2cfa467630f6b0fb8747e2c34204e5d04c0`
- Production under test: `c115ce471084175285cbf3440506373264081c79`
- Heading authority: `cad68e9425ce295ab8c998cc58865669a827feec`
- First serializer attempt: `bbf88d263a43bf7f8e93786843f4408cd923faf0`
- No future serializer repair existed or was inspected before freeze.
- No production implementation file is changed by this branch.

## Semantic contract

Authored targeted-orbit states retain strict spherical camera-to-subject bearing precision. At every rendered integer frame, a seam trajectory must be physically equivalent to the same authored trajectory translated away from the seam. Its target-residual profile must likewise match the translated control. Longitude scalar bytes are not physical authority.

The physical comparator combines wrap-safe spherical surface distance with altitude delta. The acceptance bound is 0.2 m. Targeting equivalence uses the existing serialization-derived allowance `atan2(0.2 m, radius) + 0.000001°`.

Ordinary sparse-track target residual is not forced to zero. Only additional seam-specific residual relative to the translated twin is rejected.

## Topology and easing

Latitude, longitude, altitude, pan, and tilt timestamp sets and easing topology must match the translated non-seam control. Planner-authored boundaries and easing are protected. Serializer seam pairs and co-authored pan correction keys are transport scaffolding and do not receive creative authority.

Opening seam cases are passed through the unsuppressed production diagnostic. A `HARD_START` remains red; no seam-specific waiver exists.

## Revolution, acquisition, inverse, and public-coordinate guards

The corpus checks +180°, +360°, -360°, +720°, and -720° sweep commands, a 360° zero-radius spin, and a pole-enclosing physical revolution with near-zero target-facing pan winding.

The hostile acquisition representative records production's -710.217391° jump and requires nearest-representative continuity. Heading authority and the compliant control measure +10.466571°.

An independent inverse-authority probe builds identical rings with incoming pan representatives separated by 360°. Latitude/longitude/altitude tracks and final physical position must remain identical: `PAN NO LONGER DEFINES RING POSITION`.

Shot-plan/continuation inputs and final-camera outputs are separately checked for canonical wrapped longitude. This does not constrain internal `.esp` longitude to ±180°.

## Diagnostic truth

The candidate camera-quality source must remain byte-identical to the diagnostic-truth authority, and its heading findings are compared with the unsuppressed production diagnostic on identical candidate output. `bbf88d2` fails both checks. No threshold change, seam exclusion, or pulse suppression can satisfy Oracle v2.

## Real-import evidence

`real-import-evidence.json` records the completed authenticated Google Earth Studio readback. Continuous-unwrapped seam output matched its translated control within 0.09776 m at the recorded opening samples and 0.000363 m at frame 299. Model A differed by 681.53 m at frame 1 and 36.32 m at frame 299; its pole sample differed by 3.33 m.

The browser observation and automated fixtures are separate evidence classes. `fixtures/automated/` supplies deterministic corpus fixtures for every hostile category; `fixtures/fixture-index.json` freezes their byte identities. Repository tests do not pretend to rerun Earth Studio.

## Frozen control results

| Control | Cases | Result | Deterministic reason |
|---|---:|---|---|
| production `c115ce4` | 1 pass / 14 red | RED | heading authority plus distorted seam trajectory, seam topology, opening and acquisition failures |
| heading `cad68e9` | 1 pass / 14 red | RED | strict authored heading fixed; seam physical trajectory/topology remains wrong |
| `bbf88d2` | 1 pass / 14 red | RED | physical distortion retained; pan/longitude scaffolding, opening failure, diagnostic suppression |
| historical Model A fixture | 0 pass / 1 red | RED | linked interpolation differs by up to 1,571.685 m in repository playback and retains opening `HARD_START` |
| continuous-unwrapped control | 15 pass / 0 red | GREEN | 10,650 rendered frames; zero comparator delta; all semantic guards pass |

The Model A repository-playback maximum is not substituted for the independent Earth Studio measurements above; both are retained.

## Hostile corpus

The 15 cases cover 179.99° east/west, exact +180° and -180°, 60°N, 85°N, 89°N, 89.9°N pole enclosure, seam-at-opening, fly-to acquisition, seeded continuation, short and long radius, clockwise/counterclockwise motion, half/full/twice revolutions, and zero-radius spin.

## Result interpretation

The positive control is an oracle adapter, not production serializer code: it takes independently generated non-seam output and applies only the known geographic translation to its longitude representation. It proves the comparator accepts continuous physical equivalence while remaining capable of rejecting bad continuous-unwrapped implementations on position, targeting, topology, easing, revolution, acquisition, inverse authority, diagnostics, and public schema.

## Next action

`RETURN FROZEN ORACLE V2 TO HERMES — CLAUDE IMPLEMENTATION MAY BEGIN`

No production implementation, merge, or promotion is included.
