# PROVISIONAL.md — what v1.1 deliberately does NOT freeze

Manifest field `status` is a closed vocabulary (`FROZEN_NOW`, `PROVISIONAL_UNTIL_M3`, `UNTESTED_BLOCKED`); `blocked_until` and `qualification_note` are separate structured fields. Nothing below is frozen fact.

**PROVISIONAL_UNTIL_M3 (drafts that give M3 exact questions; re-frozen only under the refreeze law in `M3-MATRIX.md`):**
- `schemas/provisional/`: `resolveSequenceLineage`, `resolveBindingSet`, `resolveBindingObservation`, `resolveMutationPlan` (now with `milestone`, `h0_guard_digest`, typed selector), `resolveVerificationResult`, `resolveConflict` (policy `PROPOSE_REVIEW_NOTE`, `authority_effect`), `resolveTransactionJournal`, `resolveCommitManifest`, `resolveCheckpoint`.
- `TIMEBASE.json.api_mapping` (recordFrame origin, endFrame convention, still duration, `GetStartFrame == 108000`).
- `TARGET-CONTRACT.json` fields `library.root_path`, `library.instance_uuid`, `session.launch_recipe_sha256`, `session.external_scripting_preference_observed` (required future observations; never fabricated).
- Track-policy **enforcement** by Resolve (`enforcement_evidence: NOT_TESTED`); the layout itself is frozen EF intent.
- `M3-MATRIX.md` (plan, not evidence); semantic validators (reference only, not runtime-qualified).

**UNTESTED_BLOCKED (every `CAPABILITIES.json` row with `evidence_class` NOT_TESTED or DOCUMENTED_NOT_QUALIFIED blocks each dependent milestone):** plural `GetSettings/GetProperties`, subframe getters, source-boundary getters, `GetUniqueId` family, track lock/enable getters, `GetStartTimecode`, `GetProjectLastModifiedTime`; all mutation rows; `-nogui` mutation; scratch lifecycle.

**BLOCKED in v1 regardless of tests:** `ReplaceClip`/`RelinkClips`; ripple delete; `SetCurrentDatabase`; `CloseProject`; `ImportProject`; render/delivery before M11; any MCP script tool; `EKA`; publishing.
