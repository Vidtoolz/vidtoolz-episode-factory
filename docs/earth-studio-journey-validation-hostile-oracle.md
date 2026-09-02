# Earth Studio Journey validation hostile oracle

This test-only oracle freezes the production boundary between legitimate Journey v1 compatibility normalization and invalid semantic intent. It is based on production `f8eb499d4891ac087bf8986a92f1a7319cae6b2a`; it does not implement a validation repair and does not depend on the parser-bypass candidate.

## Authority chain

The raw production boundary is:

`earth-studio-lane.writeJob(payload.journey)`
→ Journey raw-input acceptance/rejection
→ compatibility normalization
→ `validateJourney`
→ `compileJourney`
→ planner artifacts

The authoritative movement catalogue is `earth-studio-journey.js:MOVEMENTS`. It contains 18 exact, slot-sensitive identities and no raw Journey movement aliases:

- At-location: `hold`, `slow_orbit`, `orbit`, `orbit_twice`, `half_orbit`, `zoom_in`, `zoom_out`, `reveal`, `spiral_in`, `spiral_out`.
- Travel: `fly`, `cruise`, `fly_high`, `fly_low`, `pull_back`, `climb_to_transit`, `descend`, `pause`.

After a movement has been accepted, the 18 identities intentionally compile to five planner primitives:

- `hover`: `hold`, `pause`
- `orbit`: `slow_orbit`, `orbit`, `orbit_twice`, `half_orbit`, `spiral_in`, `spiral_out`
- `zoom_in`: `zoom_in`, `descend`
- `zoom_out`: `zoom_out`, `reveal`, `pull_back`, `climb_to_transit`
- `fly_to`: `fly`, `cruise`, `fly_high`, `fly_low`

That post-acceptance semantic collapse is valid. Converting an unknown raw identity to `hold` or `fly` before rejection is not.

## Frozen corpus

The positive authority contains:

- All 148 tracked production `earth-studio/journey.json` files.
- One valid case for each of the 18 catalogue movements in its authoritative slot.
- Ten explicit compatibility cases.
- Three deterministic `autoDirect` products, including terrain and multi-stop direction.

Every positive case must remain accepted and reproduce exact bytes for all six planner artifacts:

- `README.md`
- `shot-plan.json`
- `shot-plan.md`
- `route.kml`
- `earth-studio-build-checklist.md`
- `earth-studio.esp`

`journey.json` is deliberately not byte-compared because generated movement IDs are editor identity allocated by a process-global counter. The oracle excludes only those IDs from semantic hashes; it does not normalize planner artifacts.

The negative authority contains 40 authored hostile cases and 18 one-field movement mutations. Every negative request must:

1. Be rejected.
2. Produce no `shot-plan.json` or `.esp`.
3. Retain the rejected intent or field in error evidence.

## Compatibility normalization allowed

- Exact canonical movement keys, including bare-string step shorthand.
- Bare-string start and destination names.
- Finite numeric strings in fields handled by `numOrNull`.
- Numeric or string `1`/`-1` direction representations.
- Missing/null optional numeric overrides.
- Missing version treated as Journey v1.
- Missing pace treated as `calm`.
- Empty or omitted travel arrays expanded from a valid named travel style.
- Explicit numeric zero where it is already meaningful, such as `tilt_deg: 0`.
- Existing downstream reclassification of an accepted but physically dead movement to `hover`.

There are no accepted spelling, casing, or natural-language aliases for raw Journey movement types. Natural-language synonyms belong to upstream parser/director adapters that emit canonical keys.

## Rejection required

- Unknown, misspelled, blank, null, numeric, object, wrong-slot, or malformed movement identity.
- Unknown travel style.
- Direction outside numeric/string `1` or `-1`.
- Negative, non-finite, or non-numeric revolutions.
- Negative, zero, non-finite, or non-numeric duration.
- Non-finite altitude or tilt.
- Out-of-range or malformed coordinates.
- Explicit unsupported Journey version.

The oracle does not require exact error wording. It requires rejection evidence to identify the invalid token or field.

## Baseline defect characterization

On `f8eb499`, `dollyzoom` is initially visible to `validateJourney(raw)` and rejected at all three positions:

- `start_movements[]`
- `legs[].travel[]`
- `legs[].movements[]`

The production lane first calls `normalizeJourney`, then calls `validateJourney`, which normalizes again. The second normalization loses `unsupported_type`, so the invalid movement becomes `hold`/`hover` or `fly`/`fly_to` and is generated.

The hostile suite generalizes beyond `dollyzoom`: every canonical movement has a one-field typo mutation, and malformed enums/numerics/version/timing are tested independently.

## Commands

Self-test the frozen production authority:

```sh
node scripts/run-earth-studio-journey-validation-hostile-oracle.js
```

Run unchanged against a frozen candidate repository:

```sh
node scripts/run-earth-studio-journey-validation-hostile-oracle.js \
  --candidate-command "node scripts/earth-studio-journey-validation-candidate-adapter.js --target-root /absolute/candidate/worktree" \
  --report /tmp/journey-validation-collision.json
```

The adapter exercises the candidate's real `earth-studio-lane.writeJob` raw-input boundary. It contains no candidate-specific structure or expected results.

Do not regenerate the manifest after comparing a repair. If production policy changes intentionally, that requires a separate authority decision and independent oracle review.
