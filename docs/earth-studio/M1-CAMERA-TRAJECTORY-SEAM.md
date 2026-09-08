# Frozen M1 CameraTrajectory seam

Implementation against contract SHA-256 `19f98b6a39b0cb079c46e79fa4293a88c04b64a59d124f033d42be9fb3887171`. This is an in-memory extraction. The frozen oracle, motion configuration, package file lists and persisted schemas are unchanged.

## Ownership and call path

`earth-studio-camera-trajectory.js` owns the single state-machine walk, motion policy resolution, longitude export, deduplication and arrival-marker predicate. `createCompiler(dependencies)` binds the existing pure geometry helpers/constants without moving or consolidating their arithmetic (D-4). Its returned `compileTrajectory(plan, options)` has two arguments and does one policy evaluation and one walk. The planner's public compiler delegates to this instance.

`earth-studio-serializer.js` owns `buildEspFromTrajectory(trajectory, serializerConfig)`. Its factory binds only existing encoding constants and `round6`; it cannot access a plan. Longitude export precedes deduplication in the compiler. Normalization, easing and fractional-time clamping stay in the serializer with their original arithmetic.

`buildArtifactContextFromPlan` compiles once, annotates the plan once, and serializes. It returns `{plan, trajectory, serializerConfig, esp, artifacts}` as an ephemeral context. `buildArtifactsFromPlan` returns only the historical six-file map. The lane passes that identical trajectory to `cameraQuality.evaluateTrajectory`; the compatibility projection serializes it without compilation, retains the historical JSON boundary, and executes unchanged QC with its normalize/denormalize round trip. `predictPlayback(trajectory, {serializerConfig, frameRate?})` exposes the existing sampled trace through the same serialized handles and inverse projection. Existing `{plan, esp}` QC callers, including injected/malformed ESP tests, retain their original path.

## Allowed serializer inputs

- `trajectory`: schema, raw frame rate/count, keyed physical tracks, terminal camera, arrival markers and the one resolved `motion_policy` object.
- Per-build `serializerConfig`: `name`, resolved `width`, resolved `height`, and `compareLegacyMotion` (the historical comparison-only encoding switch). Aspect and dimension lookup occur upstream. This switch is explicitly supplied to both compilation and encoding; encoding never independently derives policy.
- Factory configuration: `MOTION_EASING`, `ORBIT_TRAVEL_HANDOFF`, `ESP_MODEL_VERSION`, `ESP_ALTITUDE_SCALE`, and the unchanged `round6` helper.

There is no plan/MapShotSpec argument, segment read, initial-camera input, keyframe walk or policy evaluation in the serializer. Job naming and dimensions are not stored on CameraTrajectory.

## Shape and compatibility

`terminal_camera` uses `{lat,lng,alt,pan,tilt}`, with continuous longitude. Marker records contain only `{kind:'segment-arrival',segment_id,frame}`; `role` is optional under the frozen contract. Other semantic roles remain in the promised legacy keyframe markers. There is no `frac` field. The serializer derives fractions using `min(1,max(0,frame/max(1,total_frames||1)))` before Set membership, preserving collisions and ordering.

Keyed `aimAt` uses the frozen `{lat,lng}` representation. Conversion happens after legacy longitude export and deduplication. The explicit `legacyTracksFromTrajectory` adapter restores `{latitude,longitude}` and all other legacy key fields. The pre-existing string-valued `orbitTravelHandoff` variants are preserved as required by the exact legacy marker/easing clauses; they are not collapsed to the illustrative boolean in the shape sketch.

Compiler `captureState.final` retains the complete legacy state, including `facing` and conditional `facingFromSeed`. Timing/bearing append once, in the original order. The no-resolved-segment early return still leaves caller capture untouched, exactly as baseline. No new validation rejects previously accepted inputs.

Direct `compileTrajectory`/`buildEspKeyframes` honor `options.initialCamera`. The historical `buildEsp`/artifact wrapper instead uses `plan.initial_camera`, forwards timing/bearing, and ignores capture. `buildArtifactsFromPlan` retains its private timing array. These differences are deliberately preserved.

`finalCameraState` compiles through the same canonical compiler and applies `finalCameraStateFromTrajectory`, which retains the legacy wrapping, rounding and heading projection. It contains no independent state machine. A caller already holding the appropriate trajectory can call the projection directly. The lane's legacy continuation query remains a separate public API invocation with its original unseeded options: substituting the seeded artifact terminal changes 16 natural cases. Thus one artifact build has one compile; a subsequent, semantically distinct legacy continuation query has its own single compile. This is not a second algorithm or a second walk within either compile. Lane replay verifies exact continuation bytes. The lane also retains its pre-annotation API notes while QC receives the annotated plan.

## Browser and verification

The real HTML entry loads trajectory and serializer before planner. Missing dependencies throw visibly. Browser smoke exercises the actual UI and generation route, compares marker/policy semantics with Node, compares full orbit artifacts against baseline in the same Chrome runtime, and checks exact scalar artifacts across Node/Chrome. This distinguishes pre-existing transcendental-function last-bit differences between runtimes from extraction regressions; no epsilon or oracle exception is introduced.

Read-only/focused commands:

```sh
node tests/earth-studio-m1-seam.test.js
node scripts/earth-studio-m1-seam-audit.js
```

Run the destructive-to-its-own-evidence Oracle v1.1 only in isolated worktrees. Do not run it over the live frozen evidence directory. `scripts/earth-studio-m1-compare-oracle.js BASELINE_ROOT CANDIDATE_ROOT OUTPUT_DIR` requires exact equality of all 199 complete per-case records and all synthetic fixtures, regenerates full QC reports, and additionally replays lane entry inputs into disposable directories. The lane replays validate that input route; they do not pretend description reparsing reproduces manually edited shot-plan literals.

Required suite: `VIDTOOLZ_SCRIPT_BUILDER_ROOT=<verified pinned authority> ./scripts/verify.sh`. Browser proof: `M1_BROWSER_EVIDENCE_DIR=<output directory> node scripts/earth-studio-journey-browser-smoke.js`. Neither command grants merge or production approval.
