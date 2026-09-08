# What is PROVISIONAL_UNTIL_M3 or UNTESTED_BLOCKED (not frozen fact)

**PROVISIONAL_UNTIL_M3 (drafted so M3 has exact questions; re-freeze with evidence before M4):**
- `schemas/provisional/`: `resolveSequenceLineage`, `resolveBindingSet`, `resolveBindingObservation`, `resolveMutationPlan`, `resolveVerificationResult`, `resolveConflict`, `resolveTransactionJournal`, `resolveCommitManifest`, `resolveCheckpoint` (all v1 drafts).
- `TIMEBASE.json` fields `api_mapping.record_frame_origin`, `api_mapping.end_frame_convention`, `api_mapping.still_duration_control` — the law itself is frozen; the mapping onto `AppendToTimeline` arguments is not.
- `TARGET-CONTRACT.json` fields `library.root_path`, `library.instance_uuid`, `session.launch_recipe_sha256` — filled at provisioning (a separately authorized action).
- `IDENTITY-BINDING.md` marker length/collision limits.
- Everything in `SNAPSHOT-CONCURRENCY-RECOVERY.md` that depends on `SetTrackLock` behaviour and `GetProjectLastModifiedTime` behaviour.

**UNTESTED_BLOCKED capability rows (see `CAPABILITIES.json`, status NOT_TESTED; every M4-dependent one MUST be resolved in M3):**
`GetStart`/`recordFrame` origin incl. start-TC offset; `endFrame` inclusive/exclusive; still-image duration control on append; occupied-interval collision behaviour; `GetUniqueId` scope and survival across `DuplicateTimeline`, DRT export/import, `FinalizeTake`, delete+append; marker `customData` length limits and duplicate behaviour; `SetSettings` plural acceptance and partial failure; `SetTrackLock` effect on API appends; `-nogui` non-render mutation; `CreateEmptyTimeline` duplicate-name behaviour under 21.1; `GetProjectLastModifiedTime` update semantics; `GetClipProperty` vs plural availability; TAKE_SWAP id survival.

**Explicitly BLOCKED in v1 regardless of tests:** `ReplaceClip`/`ReplaceClipPreserveSubClip`/`RelinkClips` as a single-binding change; `DeleteClips(…, true)` ripple; `SetCurrentDatabase`; `CloseProject`; `ImportProject`; any MCP script tool; network library `EKA`; render/delivery (until M11); publishing.
