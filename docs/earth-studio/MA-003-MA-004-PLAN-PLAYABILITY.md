# MA-003 / MA-004 planner admission

Map Animator artifact admission and camera QC share `validatePlanPlayability` in `earth-studio-job-planner.js`. Every requested segment must have resolved geography, positive duration, and at least one playable frame within contiguous coverage of the plan's positive integer frame extent. Draft parsing remains inspectable. An empty `unresolved_items` array does not establish playability.

MA003_LAW: a requested segment without a resolved location must not disappear from a plan that passes admission or camera QC.

MA004_LAW: each required segment must satisfy `end_frame - start_frame >= 1`, and the plan must have a positive integer frame count. Production uses `FRAME_RATE = 30`, `Math.round(seconds * FRAME_RATE)` at cumulative boundaries, start inclusive and end exclusive. Quantization is unchanged. A shot starting at zero reaches one frame at half a frame's duration; an interior segment's result also depends on its cumulative start time. No duration is clamped or replaced by a new minimum.

`buildArtifactContextFromPlan` checks before compiling, annotating, or serializing. Text and parsed artifact wrappers and the lane share that boundary. Rejection uses the existing HTTP-400 Error pattern, with `code = PLAN_NOT_PLAYABLE` and deterministic `plan_errors`. Camera QC and `validateShotPlanPayload` consult the same authority; QC returns its existing `FAIL` / `errors` representation. Missing geography is checked on segments, independently of manual-review warning lists.

Low-level `compileTrajectory`, `buildEspKeyframes`, and `buildEsp` retain frozen M1 compatibility, including malformed-plan diagnostic probes. They do not grant admission; their results must pass the plan/camera gate. Renderer serialization and execution are unchanged.

A native template selector still works with a valid generic plan. Template-name-only descriptions that produce an unresolved zero-duration generic plan now fail admission, including when native parameters are supplied. Native template parsing, parameter validation, project bytes, and execution are unchanged.

The structured segment-spec validator retains negative-duration rejection. The existing freeform grammar leaves a negative sign in the unresolved location phrase; that draft is now refused at admission. This change does not redesign that grammar. Zero-duration drafts remain visible for correction and cannot generate artifacts.

Tests cover both audit scenarios, lane refusal, QC bypass attempts, cumulative frame transitions, stationary hover, travel, orbit, continuation, and deterministic accepted-plan properties. Unaffected artifact contexts and continuation outputs are compared with parent `a8c5b2601564e98ea69157ed1d68562cd7c55b77`. The 199 committed oracle plans remain unchanged. MA-021 and the MA-002 review minors remain separate.
