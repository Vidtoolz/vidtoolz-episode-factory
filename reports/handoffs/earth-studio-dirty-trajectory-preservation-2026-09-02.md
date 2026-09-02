# Superseded dirty Earth Studio trajectory record

This archive branch records the unapproved dirty planner and height-framing state found on live `main` at base `f8eb499d4891ac087bf8986a92f1a7319cae6b2a`. It is a replay/archive authority only and must not be merged as production behavior.

The existing Codex branch-chain tip `codex/terrain-orbit-wobble-20260825` at `54a63d2e65f0bb1b9f833e17a3c88acd1b5ad07e` substantially supersedes this planner. The Codex chain adds explicit smooth-travel gating and other changes; the dirty implementation remained globally reached through `policy.coherentTrajectory` and was not accepted.

The identified unique dirty-tree difference is the antimeridian exclusion around sampled geographic trajectory generation:

```js
const crossesAntimeridian = Math.abs(wrapLng(state.longitude) - wrapLng(destLng)) > 180;
if (policy.coherentTrajectory && positionChanges && !crossesAntimeridian
    && !segment.holds_camera && !segment.stages_orbit_entry) {
```

This guard is preserved as evidence and an explicit later design question. It is not promoted or evaluated here.

Machine-replay patches in this directory record the exact delta from `f8eb499` and the relation to `54a63d2`. The complete pre-clean source snapshot is `/home/vidtoolz/episode-factory-preservation/2026-09-02-pre-parser-bypass/`.
