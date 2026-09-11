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

`finalCameraState` compiles through the same canonical compiler and applies `finalCameraStateFromTrajectory`, which retains the legacy wrapping, rounding and heading projection. It contains no independent state machine. A caller already holding the appropriate trajectory can call the projection directly. One artifact build has one compile; a subsequent continuation query has its own single compile. The lane also retains its pre-annotation API notes while QC receives the annotated plan.

## MA-001 intentional correctness migration (2026-09-11)

The original M1 freeze preserved a defect: the lane's continuation query ignored `plan.initial_camera`, so a generated trajectory ending at pan 210° could write a continuation sidecar at 0°. MA-001 intentionally changes that observable continuation/final-state behavior. Historical byte equality for the incorrect seeded continuation is no longer the acceptance law.

The small shared `withInitialCamera` resolver applies only seed precedence: an explicit `options.initialCamera` wins; otherwise a plan seed is used; otherwise behavior stays unseeded. `undefined` means absent; explicit `null` retains the existing no-seed behavior. Partial seeds, including the lane's Director `openingCamera` pan/tilt input, remain supported. The continuation journey's compiled `initial_camera` and the Director opening route both become `plan.initial_camera` through the existing lane normalization.

`finalCameraState` retains all other caller options and its historical private `captureState` object. It does not pass its public options through `artifactCompileOptions`. That artifact-only whitelist remains unchanged in scope, including its historical treatment of caller `initialCamera`; it invokes the shared seed resolver after selecting its own options. Direct `compileTrajectory` and `buildEspKeyframes` remain options-only APIs. No camera, terrain, easing, normalization or serializer mathematics changes.

The 199-plan M1 seam test retains exact artifact/keyframe checks. For a plan with `initial_camera`, its terminal comparison now invokes the frozen old planner with that plan seed as an explicit option; unseeded plans retain the old direct comparison. The frozen `f30e454` planner blob, all 199 shot plans and historical oracle/audit evidence are unchanged. MA-001 regressions in `tests/earth-studio-journey.test.js` exercise actual lane-written sidecars, continuation and partial Director seeds, explicit override, undefined/null handling, heading wrap, unseeded byte equality and public option preservation in Node/browser-module execution. MA-002, MA-004 and MA-021 remain separate and untouched.

Three repeated-continuation expectations in the terrain handoff/complete-pose tests also encoded the dropped-seed behavior: they required byte-identical ESPs across successive orbits with different seeds. Correct continuation preserves accumulated pan (for example 540°, 900°, 1260°), so those different inputs need not yield identical serialized pan ranges. The old planner with explicit seeds reproduces this behavior without any math change. These tests now compare each continuation to the explicitly seeded trajectory and require byte-identical replay of the same seed; their terrain altitude, tilt, geometry and optical checks remain intact.

## Browser and verification

The real HTML entry loads trajectory and serializer before planner. Missing dependencies throw visibly. Browser smoke exercises the actual UI and generation route, compares marker/policy semantics with Node, compares full orbit artifacts against baseline in the same Chrome runtime, and checks exact scalar artifacts across Node/Chrome. This distinguishes pre-existing transcendental-function last-bit differences between runtimes from extraction regressions; no epsilon or oracle exception is introduced.

Read-only/focused commands:

```sh
node tests/earth-studio-m1-seam.test.js
node scripts/earth-studio-m1-seam-audit.js
```

Run the destructive-to-its-own-evidence Oracle v1.1 only in isolated worktrees. Do not run it over the live frozen evidence directory. `scripts/earth-studio-m1-compare-oracle.js BASELINE_ROOT CANDIDATE_ROOT OUTPUT_DIR` requires exact equality of all 199 complete per-case records and all synthetic fixtures, regenerates full QC reports, and additionally replays lane entry inputs into disposable directories. The lane replays validate that input route; they do not pretend description reparsing reproduces manually edited shot-plan literals.

Required suite: `VIDTOOLZ_SCRIPT_BUILDER_ROOT=<verified pinned authority> ./scripts/verify.sh`. Browser proof: `M1_BROWSER_EVIDENCE_DIR=<output directory> node scripts/earth-studio-journey-browser-smoke.js`. Neither command grants merge or production approval.
