# Identity and binding authority v1 (FROZEN_NOW for the relationship; schemas PROVISIONAL_UNTIL_M3)

```
run_id + story pin {project_id, version_id, content_hash}
  └ sequence_lineage_id                 (Resolve-integration state only; initial handoff + explicit successor links)
      └ handoff_id (immutable, content-addressed) / revision
          ├ beat_id (composition beat, e.g. draft-still-007) → layer_id → binding_id → occurrence[]
          └ programme/section audio role (NARRATION, MUSIC) → binding_id → occurrence[]
binding revision → accepted asset {asset_id, sha256} | selected take | recipe → planned half-open record range [O+B(a), O+B(b))
occurrence (observed only) → target epoch + project_unique_id + timeline_unique_id + item_unique_id + media_pool_item {unique_id, media_id} + source sha256
```

Rules (MUST): no upstream `episode_id` is invented. `binding_id` is allocated from `sequence_lineage_id` + semantic scope/key and survives asset replacement and handoff revision; it MUST NOT embed asset sha, handoff digest, array index, time position or `final_beat_id`. `final_beat_id` (`final-visual-NNN`) is positional (`final-production-package.js:279`) and MUST NOT be used as identity. `visual-beat-<ULID>` is plan-scoped. A layer MAY produce zero, one or many occurrences; zero requires explicit `NO_TIMELINE_ITEM` with reason. Narration and music are programme/section-scope bindings. A Resolve timeline item corresponds to a layer occurrence, not a beat. Splits/merges receive new binding ids with explicit lineage. Cross-run successors name predecessors explicitly; equal `draft-still-007` in two runs is not the same beat.

Markers: namespace `vidtoolz:resolve:binding:v1:<target_epoch>:<binding_id>:<occurrence_id>`; the adapter owns only that prefix (never all `vidtoolz:`, never `scorecraft:cue:v1:`). Item markers recover identity; timeline markers are navigation summaries. Resolution: bound ids within target epoch, cross-checked with occurrence metadata and observed source/range; source sha256 is corroboration only; ambiguity → `IDENTITY_AMBIGUOUS`, preserve all candidates. Duplicate/import → new target epoch + explicit remap after whole-content comparison.

Track policy v1 (derived from layer type + z; no canonical layout existed before): V1 `FULL_CANVAS_VISUAL`, V2 `PRESENTER|PRESENTER_PROXY`, V3 `TYPOGRAPHY`, V4 reserved; A1 `NARRATION`, A2 `MUSIC`, A3+ reserved. Media-pool bin per run `VIDTOOLZ/<run_id>/`; one media-pool item per layer-asset (so `ReplaceClip` blast radius is bounded, and it is denied anyway in v1). Timeline naming `VIDTOOLZ__<run_id>__<handoff_id[0:8]>__r<N>`; destination names never reused.
