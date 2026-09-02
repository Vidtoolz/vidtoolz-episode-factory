# Earth Studio hold-semantics hostile oracle

This independent, test-only oracle is frozen against production commit `818db55f1e88c1b014cfb5b1f1a0509e31e31a0e`. It does not implement camera behavior. It defines one boundary: a non-opening Journey `hold` or travel `pause` owns time, not camera motion. Omitted camera fields inherit incoming canonical camera state. An explicit `altitude_m` or `tilt_deg` on any non-opening hold is invalid at raw Journey validation. An opening hold may establish framing. Future explicit re-frame or re-tilt requires a distinct movement primitive and is outside this oracle.

## Frozen protocol

The corpus contains 16 legitimate and 16 hostile authored Journeys. Every request is executed through both production ingestion paths:

1. `earth-studio-lane.writeJob`, exercising the raw Journey boundary and filesystem artifact creation.
2. `compileJourneyToParsed` followed by `buildShotPlanFromParsed` / `buildArtifactsFromParsed`, exercising Direct Journey IR without text parsing.

The adapter emits NDJSON using protocol `earth-studio-hold-semantics-oracle-v1`. The comparator fails closed on a malformed protocol, missing or duplicate cases, missing paths, missing output hashes, invalid error arrays, generated artifacts after rejection, hash differences, or semantic cursor differences.

The candidate must reject every hostile case with status 400 on both paths, create or return no `shot-plan.json` or `earth-studio.esp`, and identify every forbidden field plus its exact non-opening Journey location. Both fields must be named when both were supplied.

Legitimate cases cover explicit opening framing, fresh and continuation openings, mid-journey and terminal holds, movement/hold/movement boundaries, travel pause, repeated holds, settle/launch, terrain, fly/hold/orbit staging, omitted and null fields, and short/long dwell durations. Playback observations compare position, altitude, pan and tilt at each hold boundary. Compiler altitude/tilt must equal planner-applied state, and the following movement's compiler altitude must start from that same state.

## Current-production defect proof

Current production accepts all 16 hostile cases through both paths (32/32 incorrect acceptances) and generates Earth Studio artifacts. In the canonical `fly → hold(tilt_deg: 30) → half_orbit` reproduction, the compiler records hold tilt 30°, suppresses it from the planner phrase, and advances its cursor to 30°. The planner correctly holds the actually incoming 0° camera, while the next orbit inherits the compiler's unapplied 30°. The oracle records the acceptance collision and the compiler/planner mismatch; it does not bless either.

Current production also exposes legitimate omitted-field defects: terminal holds after orbit retain planner-applied camera state but the compiler tilt cursor says 0°, and a continuation-opening hold with omitted fields moves away from its incoming continuation camera. Those are expected baseline failures, not candidate allowances. Twelve authored positive cases already satisfy the semantic checks on production and remain byte-frozen. The continuation-opening repair is the only authored positive allowed to change baseline artifact hashes, and even there lane and Direct IR must remain byte-identical. All other positive differences fail closed.

## Tracked-production preservation

The manifest freezes every one of the 148 Git-tracked `package-runs/**/earth-studio/journey.json` inputs. For each it records the input byte identity and the exact production-base SHA-256 of `shot-plan.json` and `earth-studio.esp` on both paths. Candidate hashes must match. No tracked Journey contains an explicit camera field on a non-opening hold, so strict rejection creates no preservation conflict. The runner has no re-pin mode: its one-time manifest command refuses when the manifest already exists.

## Existing invalid test fixtures

Existing tests are not edited. The corpus records all 12 exact registered test names whose setup constructs an explicit camera field on a non-opening hold. All 12 setups are semantically invalid, although most carry a legitimate orbit, acquisition, duration, aim, or quality assertion. A later repair can restate those at planner-fixture level with the same already-applied incoming camera state, then preserve the orbit assertions unchanged. The path-equivalence case should become a two-path rejection check while its omitted-field neighbor remains the positive equivalence case.

The classified tests are:

- `path-equivalence adversarial: mid-journey hold with explicit tilt (known leak preserved, not repaired)`
- `staging: explicit hold geometry keeps the acquisition fallback`
- `top-down hold: the hold stays exactly as asked for`
- `top-down hold: the following orbit keeps its own tilt and a real ring`
- `top-down hold: the requested orbit actually orbits`
- `top-down hold: the bounded acquisition carries the entry, monotonically`
- `top-down hold: the subject stays framed through acquisition and sweep`
- `top-down hold: the orbit keeps its whole arc, duration and no roll`
- `dead-orbit gate: a healthy orbit and an ordinary hold are not flagged`
- `duration: an acquisition compresses the sweep, and the amount is reported`
- `duration: total shot time still equals the sum of segment durations`
- `duration: the compression is stated in the plan the operator reads`

Nearby explicit-looking cases that remain valid are separately listed in the corpus: explicit opening holds, null-as-omitted fields, and opening-place altitude framing.

## Explicit exclusions

This oracle does not alter or judge trajectory authority, planar/spherical geometry, the TERRAIN 6.39° authority, camera policy, footprint law, canaries, PRESTO routing, or any preservation authority. It requires no human visual authority because it compares validation outcomes, byte identities, and the planner's own applied camera tracks.

## Commands

Self-test the frozen production authority:

```sh
node scripts/run-earth-studio-hold-semantics-hostile-oracle.js
```

Collide an unchanged oracle with a future frozen candidate:

```sh
node scripts/run-earth-studio-hold-semantics-hostile-oracle.js \
  --candidate-command "node scripts/earth-studio-hold-semantics-candidate-adapter.js --target-root /absolute/candidate/worktree" \
  --report /tmp/earth-studio-hold-semantics-collision.json
```

The adapter contains no candidate-specific assumptions beyond the frozen public production module entry points. Do not regenerate or re-pin the manifest for a candidate.
