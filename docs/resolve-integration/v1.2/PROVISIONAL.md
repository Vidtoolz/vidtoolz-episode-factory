# PROVISIONAL.md — what v1.2 deliberately does NOT freeze

Manifest field `status` is a closed vocabulary (`FROZEN_NOW`, `PROVISIONAL_UNTIL_M3`, `UNTESTED_BLOCKED`); `blocked_until` and `qualification_note` are separate structured fields. Nothing below is frozen fact.

**PROVISIONAL_UNTIL_M3 (drafts that give M3 exact questions; re-frozen only under the refreeze law in `M3-MATRIX.md`):**
- `schemas/provisional/`: `resolveSequenceLineage`, `resolveBindingSet`, `resolveBindingObservation`, `resolveMutationPlan` (v1.2: `target`, `target_attachment_state`, `evidence`, `authorization_token`, `journal_available`), `resolveVerificationResult`, `resolveConflict` (policy `PROPOSE_REVIEW_NOTE`, `authority_effect`), `resolveTransactionJournal`, `resolveCommitManifest`, `resolveCheckpoint`.
- `TIMEBASE.json.api_mapping` (recordFrame origin, endFrame convention, still duration, `GetStartFrame == 108000`).
- `TARGET-CONTRACT.json` fields `library.root_path`, `library.instance_uuid`, `session.launch_recipe_sha256`, `session.external_scripting_preference_observed` (required future observations; never fabricated).
- Track-policy **enforcement** by Resolve (`enforcement_evidence: NOT_TESTED`); the layout itself is frozen EF intent.
- `M3-MATRIX.md` and `M3-PROBES.json` (plan, not evidence); semantic validators and the eligibility evaluator (reference only, not runtime-qualified); `TARGET-CONTRACT.json` attachment evidence (state UNPROVISIONED until provisioning).

**UNTESTED_BLOCKED (every `CAPABILITIES.json` row with `evidence_class` NOT_TESTED or DOCUMENTED_NOT_QUALIFIED blocks each dependent milestone):** in v1.2 **every read row** is DOCUMENTED_NOT_QUALIFIED because no evidence record exists on Resolve 21.1.0 build 14 (prior-version records are attached with `version_match: false`); all mutation rows; `-nogui` mutation; scratch lifecycle; `GetUniqueId` survival (separate from readability).

**BLOCKED in v1 regardless of tests:** `ReplaceClip`/`RelinkClips`; ripple delete; `SetCurrentDatabase`; `CloseProject`; `ImportProject`; render/delivery before M11; any MCP script tool; `EKA`; publishing.
