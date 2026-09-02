# Earth Studio direct Journey IR hostile oracle

This document defines an implementation-independent oracle for comparing any future structured Journey IR path with production semantics frozen at Episode Factory commit `f8eb499d4891ac087bf8986a92f1a7319cae6b2a`. Production remains the legacy text path. The oracle neither implements nor activates a bypass and does not decide trajectory, arrival-geometry, or TERRAIN policy.

## Production call graph

```text
earth-studio-director.js:autoDirect (optional producer)
  -> Journey v1 object

earth-studio-lane.js:writeJob (line 95)
  -> earth-studio-journey.js:normalizeJourney (line 609)
  -> earth-studio-journey.js:validateJourney (line 1418)
       -> compileJourney (line 773)
            -> ordered planned steps
            -> phraseFor/orbitPhrase/descriptionName (lines 673, 744, 757)
            -> English joined with " then "
       -> verifyCompilation (line 1384)
            -> earth-studio-job-planner.js:parseDescription (line 1055)
                 -> splitSegments (line 612)
                 -> parseSegment (line 875)
                 -> orbit-entry annotation pass
  -> lane selects compiled.description (line 114)
  -> lane supplies aspect, initialCamera, motionPolicy (lines 119, 146-168)
  -> earth-studio-job-planner.js:buildArtifacts (line 3184)
       -> buildShotPlan (line 1249)
            -> parseDescription
            -> plan literal, defaults, normalization and provenance
       -> buildEsp/buildEspKeyframes (lines 2783, 1788)
            -> motionPolicy (line 1716)
            -> Earth Studio position/rotation tracks
       -> annotateOrbitTiming (line 3159)
       -> shot-plan.json and earth-studio.esp bytes
  -> earth-studio-journey.js:continuationStateFromPlan (line 1653)
       -> planner.finalCameraState from the real keyframe engine
```

The authoritative comparison boundary is therefore not merely a parsed object. It is:

```text
Journey input + aspect + initial camera + motion policy
  -> compiled English
  -> parsed-description object
  -> shot-plan.json bytes
  -> earth-studio.esp bytes and complete camera-keyframe trajectory
```

## Semantic field matrix

| Field or state | Input type / range | Default or normalization | Legacy parser behavior | Downstream authority |
| --- | --- | --- | --- | --- |
| `journey_version` | Version-like value | Always normalized to `1` | Never serialized | `journey.json` provenance only |
| `pace` | `calm`, `relaxed`, `standard`, `quick` | Unknown/missing becomes `calm` | Only the computed duration reaches text; parser labels it `explicit` | Segment timing and frames |
| `aspect` | Known aspect string | Lane/planner fallback `16:9`; unknown planner option falls back with warning | Not in English | Plan aspect, render dimensions and `.esp` dimensions |
| `preset` | String/null | Carried but not compiled | Absent | Journey provenance only |
| `start.source` | `location` or `continuation` | Anything else becomes `location` | Not in English | Controls initial-camera structured option and cursor seed |
| `start.continuation.camera.latitude` | Finite `[-90,90]` | Required for continuation | Not parsed from English | Initial latitude keyframe |
| `start.continuation.camera.longitude` | Finite `[-180,180]` | Required | Not parsed from English | Initial longitude keyframe; final export wraps to ±180 |
| `start.continuation.camera.altitude_m` | Finite `>=0` | Required | Not parsed from English | Initial altitude keyframe |
| `start.continuation.camera.pan_deg` | Finite `[-100000,100000]` | Required; not wrapped during normalization | Not parsed from English | Initial `rotationX`; human `heading_deg` wraps to `[0,360)` only at export |
| `start.continuation.camera.tilt_deg` | Finite `[-360,360]` | Required | Not parsed from English | Initial `rotationY` |
| Roll / FOV / exposure / aperture / focus | Not part of Journey camera authority | Extra values are ignored | Never parsed or generated | No `rotationZ`, FOV, exposure, aperture or focus keyframes |
| Place `location` | Gazetteer string or legal coordinate string | Trimmed; aliases/case normalize; coordinates preserve raw phrase until parser | Parser resolves fixture/alias or coordinates; coordinate display name is fixed to four decimals | Segment target latitude/longitude and location metadata |
| Place `story.role`, `importance`, `purposes` | Strings/string array | Carried and sanitized | Never serialized | Director/journey provenance; no planner effect |
| Place `framing` | `auto` or scale key | Unknown/missing becomes `auto` | Scale identity is lost; only an emitted altitude or gazetteer omission survives | Camera altitude |
| Place `altitude_m` | Finite number or null | `numOrNull`; numeric strings accepted | Emitted integer altitude becomes `explicit`; absent may become gazetteer/action default | Camera altitude |
| Place `tilt_deg` | Finite number or null | `numOrNull`; numeric strings accepted | Emitted to two decimals and becomes `explicit`; absent uses action/default/carry | Camera `rotationY` and orbit radius |
| `start_movements[]` | Ordered at-location steps | Missing becomes empty | Phrases preserve array order | Segment and keyframe order |
| `legs[]` | Ordered legs | Missing becomes empty | Travel phrases precede at-destination phrases per leg | Shot ordering and target transitions |
| `legs[].destination` | Place | Required when travel exists | Same place rules as start | Travel/arrival target |
| `legs[].travel_style` | Known style enum | Unknown becomes `direct` | Only used to populate an absent/empty travel list; never serialized | Indirectly selects movement sequence |
| `legs[].travel[]` | Ordered travel steps | Empty/absent is populated from `travel_style` | Parsed as ordinary action segments | Departure/travel/arrival state |
| `legs[].movements[]` | Ordered at-location steps | Missing becomes empty | Parsed as ordinary action segments | Post-arrival shot sequence |
| Step `id` | String/absent | Missing gets generated `sN` | Never serialized | No planner authority |
| Step `type` | Slot-specific movement enum | Unsupported values become fallback plus `unsupported_type`, then validation rejects | Eighteen movements collapse to five actions: hover/fly/orbit/zoom-in/zoom-out | Keyframe-engine action branch and movement intent |
| Step `duration_seconds` | Finite number/null | Null becomes paced suggestion; `<=0` rejected; sub-second warns | Text rounds to two decimals; parser always marks journey duration `explicit`; frames use `Math.round(seconds*30)` | Timing, frame boundaries and interpolation |
| Step `pace` | Pace enum/null | Null inherits journey pace | Identity lost into duration | Timing only |
| Step `emphasis` | Finite number/null | Clamped for suggestion calculation | Identity lost into duration | Timing only |
| Step `direction` | `-1` or other | Exactly `-1` stays CCW; everything else becomes CW | Orbit phrase always says clockwise/counterclockwise; non-orbit value is ignored | Orbit sweep sign |
| Step `altitude_m` | Finite number/null | Manual override except non-opening holds | Text emits integer and parser clamps to `[150,63170000]`; hidden hold override is ignored | Camera altitude and zoom magnitude |
| Step `tilt_deg` | Finite number/null | Manual override; non-opening hold hides it from its own phrase but still advances compiler cursor | Text emits two decimals; hidden hold parses carried prior tilt | Camera tilt; hidden value can leak into successor orbit |
| Step `revolutions` | Finite number/null | Definition default when null | `round(revolutions*360)`; zero survives as `0 degrees`; direction parsed separately | Orbit sweep amount |
| Step `framing` | Scale enum/null | Null inherits place framing | Scale label is lost; only altitude survives | Camera altitude |
| Unknown fields / optional booleans | No Journey v1 boolean authority exists | Unknown keys, including explicit `false`, are dropped | Absent | No planner effect |
| Missing versus null optionals | Missing, null or empty string | `numOrNull` makes them equivalent | Same phrase/plan when other inputs match | Lossy compatibility behavior |
| Numeric strings | String containing finite number | Coerced by `Number` | Emitted as numeric text | Compatibility behavior |
| `motionPolicy` option | Object booleans + source | Lane injects journey policy | Not parsed from English; normalized by `buildShotPlan` | Plan field, coherent trajectory and keyframe dedupe |
| Segment `source_text` | Exact phrase bytes | Trimmed only | Phrase retained verbatim | Plan byte/provenance authority |
| `action` / `requested_action` | Five parser actions | Detected from verb grammar | Both equal parser action on journey path | Engine behavior and diagnostics |
| `location_name` / `location` | Resolved target | Carries previous location when phrase omits it | Source is fixture, coordinates or `carried_over` | Target coordinates, terrain metadata and location list |
| `altitude_source` | Provenance label | Emitted values become `explicit`; omitted calibrated values become `gazetteer`; held values become `carried_over` | Exact parser labels are authoritative | Diagnostics and byte identity |
| `tilt_source` | Provenance label | Emitted values become `explicit`; defaults/carries receive parser label | Exact labels authoritative | Diagnostics and byte identity |
| `duration_source` | Provenance label | Journey compiler always emits duration | Parser reports `explicit` | Diagnostics and byte identity |
| Segment start/end seconds and frames | Derived numbers | Ordered cumulative sum; 30 fps | Parser performs the sum and rounding | Shot and keyframe timing |
| `holds_camera` | Optional boolean on parsed hover | Same target plus omitted altitude/tilt | Injected by parser | Freezes prior terminal camera state |
| `ends_at_orbit_entry` | Optional successor segment ID | Same target, positive durations, altitude within 1 m, tilt within 0.5° | Re-derived by parser lookahead | Arrival geometry and orbit launch |
| `stages_orbit_entry` | Optional successor segment ID | Opening hover/orbit with same target/framing | Re-derived by parser lookahead | Opening camera sits on orbit ring |
| `orbit_degrees`, `orbit_direction` | Numeric/sign | Present only on orbit | Parsed from wording | Orbit trajectory |
| Terrain metadata | Gazetteer fields such as `terrain_morphology`, floor and scale | Present only for curated fixture | Copied verbatim into parsed location; coordinate-equivalent target does not receive it | Framing floors, diagnostics and plan bytes |
| Arrival/departure state | Derived from ordered segments and predecessor camera | Not a standalone Journey field | Segment annotations plus keyframe engine | Visual trajectory, continuity and final camera |
| Target/look-at | Implicit segment location | No independent Journey camera-target field | Target coordinates feed orbit/zoom/fly math | Camera position/pan/tilt; no promoted Camera Target attribute |
| Keyframe count/order/easing | Not supplied by Journey | Generated by planner policy and segment transitions | Not in parsed object | Exact `.esp` track arrays are final authority |

## Legacy round-trip transformations

| Transformation | Production example | Classification | Lossy? |
| --- | --- | --- | --- |
| Duration rounds to two decimals | `12.345 -> "12.35 seconds" -> 12.35`, end frame `371` | Parser syntax / numeric serialization | Yes |
| Altitude derives before tilt text rounds | `tilt 45.678 -> altitude 991 m`, then text/parsed tilt `45.68` | Compatibility behavior required for equivalence | Yes |
| Tiny tilt rounds to zero after altitude derivation | `0.0049 -> altitude 1418 m, "tilted 0 degrees"` | Compatibility behavior | Yes |
| Negative zero becomes textual zero | Structured `-0` survives normalization but emits/parses `0` | Numeric serialization | Yes |
| Revolutions become integer degrees | `revolutions:0 -> "0 degrees" -> orbit_degrees:0` | Parser syntax | Yes for fractional identity |
| Movement types collapse | `climb_to_transit` may become `hover`; `cruise/fly_high/fly_low` become `fly_to` | Intentional compatibility / movement-intent policy | Yes |
| Suggested duration provenance disappears | Null duration becomes a number and parser source `explicit` | Default injection | Yes |
| Gazetteer calibration provenance changes | Compiler `gazetteer_calibrated` omission becomes parser `gazetteer` | Compatibility behavior | Yes |
| Emitted sources become explicit | Manual or derived emitted altitude/tilt/duration receives parser `explicit` | Parser provenance | Yes |
| Non-opening hold carries camera | Omitted modifiers become `carried_over` and `holds_camera:true` | Intentional compatibility | No camera loss |
| Mid-hold tilt leaks forward | Hold hides explicit 30°, holds prior 0°, successor orbit emits 30° | Likely defect, deliberately frozen | Yes / asymmetric |
| Mid-hold altitude is ignored | Explicit `9999` disappears; hold carries prior altitude | Likely defect, deliberately frozen | Yes |
| Null and missing optionals converge | Explicit null and absent fields produce identical parsed state | Compatibility behavior | Yes |
| Empty travel list populates style | `travel:[]` under direct style inserts one `fly` | Default injection | Yes |
| Numeric strings coerce | `"1200"`, `"45"`, `"5"` become numbers | Compatibility behavior | Yes for type identity |
| Unknown false flags disappear | Unknown root/place/step booleans are removed | Compatibility behavior | Yes |
| Coordinate display precision | Raw coordinate location resolves to a four-decimal display name | Parser normalization | Yes for name precision; numeric coordinates retained |
| Roll/FOV disappear | Extra continuation `roll_deg` and `fov_deg` do not reach `initial_camera` | Schema boundary, intentional absence | Yes |
| Orbit-entry flags are reconstructed | Numeric equality and same target produce staging annotations | Intentional parser post-pass | No if reproduced exactly |

No transformation above is corrected by this branch.

## Comparator contract

The oracle compares `shot-plan.json` and `earth-studio.esp` bytes exactly. There is no numeric tolerance. If bytes differ, the comparator parses JSON only to classify the mismatch:

- `BYTE_DIFFERENCE`: raw bytes differ.
- `REPRESENTATION_DIFFERENCE`: parsed values are identical, or only non-semantic plan envelope fields differ.
- `SEMANTIC_DIFFERENCE`: any plan semantic projection, `.esp` value, keyframe time, keyframe order, transition/easing object, trajectory coordinate, altitude, rotation, target-derived state, or frame boundary differs.
- `NUMERIC DIFFERENCE WITHIN EXPLICIT CONTRACT`: no such tolerance exists for this gate. Every serialized numeric difference is reported and fails.

Canonicalization is deliberately minimal: JSON parsing may disregard whitespace and object-key order for classification only. Arrays are never reordered. Numbers are never rounded. Exact bytes remain the acceptance requirement.

The baseline manifest also fingerprints normalized Journey semantics. It removes
only movement `id` values from that one fingerprint because `newStep` allocates
them from a process-global editor counter, and the legacy text path never sends
them to the parser. Original input bytes are still hashed with any supplied IDs,
and parsed state, shot-plan bytes, `.esp` bytes, trajectory, and final camera are
all frozen independently. No behavior-bearing field is canonicalized away.

## Frozen corpus and candidate protocol

The committed manifest freezes the legacy result hashes for:

- all 148 tracked `package-runs/**/earth-studio/journey.json` inputs;
- 6 ordinary valid cases;
- 37 hostile valid cases;
- 14 malformed cases rejected by production;
- 6 explicitly indexed historical regression authorities.

`scripts/run-earth-studio-direct-ir-hostile-oracle.js --candidate-command '<command>'` sends one JSON object per line. The adapter receives Journey input, job metadata and structured options and returns one JSON object per line:

```json
{
  "case_id": "ordinary_valid:ordinary-city-travel",
  "accepted": true,
  "artifacts": {
    "shot-plan.json": "<exact JSON bytes>",
    "earth-studio.esp": "<exact JSON bytes>"
  },
  "parsed": { "optional": "canonical representation" }
}
```

For malformed inputs, `accepted:false` is sufficient; candidate error prose need not be identical. NaN/Infinity/-0 use the documented `special-number-tags-v1` encoding. The adapter is external to the oracle commit, so a completely different candidate architecture can be tested without changing expectations.

## Preserved regressions

The corpus indexes the clean baseline TERRAIN mountain journey without judging its 6.39° case, long-distance travel/orbit, fly-to-orbit staging, hold-to-orbit geometry, a morphology-bearing Matterhorn journey, and zoom/climb movement intent. The verification protocol also executes these exact registered tests:

- `settle-then-launch: serialized handles match the human-approved candidate`
- `coherence: known-good directed canaries have zero interior ground-path reversals`

## Authority boundary

- Trajectory authority remains unresolved.
- Planar versus spherical arrival geometry remains unresolved.
- TERRAIN 6.39° judgment remains unresolved.
- Production stays on the text path.

`NO HUMAN AUTHORITY DECISION INFERRED`
