# PROVISIONAL.md — what v1.4 deliberately does NOT freeze

Manifest field `status` is a closed vocabulary (`FROZEN_NOW`, `PROVISIONAL_UNTIL_M3`, `UNTESTED_BLOCKED`); `blocked_until` and `qualification_note` are separate structured fields. Nothing below is frozen fact.

**PROVISIONAL_UNTIL_M3 (drafts that give M3 exact questions; re-frozen only under the refreeze law in `M3-MATRIX.md`):**
- `schemas/provisional/`: `resolveSequenceLineage`, `resolveBindingSet`, `resolveBindingObservation`, `resolveMutationPlan` (v1.4: `expected_media_pool_item_unique_id`, unique `operation_id`s), `resolveTransactionJournal` (v1.4: `operation_set_digest`, `op`, `OP_STARTED`/`OP_FAILED`, operation membership), `resolveVerificationResult` (v1.4: derived `added/removed/changed`, `applied_operation_ids`, verdict enum incl. `EFFECT_NOT_SPECIFIED`/`UNOBSERVABLE_STATE`), `resolveConflict`, `resolveCommitManifest` (v1.4: `s1_guard_digest`), `resolveCheckpoint`. The expected-effect law (`expected_effects`: APPEND/DELETE/DISABLE/ENABLE/UPSERT_MARKER) and the linked-set validator `validate_transaction_set` / `verify_transaction` are references, not runtime-qualified; no runtime semantics beyond `expected_effects` are claimed for APPEND.
- `TIMEBASE.json.api_mapping` (recordFrame origin, endFrame convention, still duration, `GetStartFrame == 108000`).
- `TARGET-CONTRACT.json` fields `library.root_path`, `library.instance_uuid`, `session.launch_recipe_sha256`, `session.external_scripting_preference_observed` (required future observations; never fabricated).
- Track-policy **enforcement** by Resolve (`enforcement_evidence: NOT_TESTED`); the layout itself is frozen EF intent.
- `M3-MATRIX.md` and `M3-PROBES.json` (plan, not evidence); semantic validators and the eligibility evaluator (reference only, not runtime-qualified); the evidence-set record types and envelope (`schemas/resolveEvidenceSet.schema.json`) are a contract for records that do not yet exist — real M0 captures must reconcile against it; the derived attachment state is UNPROVISIONED until a provisioning record exists; `MAX_OBSERVATION_AGE_S = 3600` is a frozen rule whose value M0 may show needs adjusting through a versioned correction.

**UNTESTED_BLOCKED (every `CAPABILITIES.json` row with `evidence_class` NOT_TESTED or DOCUMENTED_NOT_QUALIFIED blocks each dependent milestone):** in v1.4 **every read row** is DOCUMENTED_NOT_QUALIFIED and `probe_candidate: true` (probe-callable only; PROBE_ALLOWED != QUALIFIED_READ; `refreeze.reviewed: false`) because no evidence record exists on Resolve 21.1.0 build 14 (prior-version records are attached with `version_match: false`, `result: UNQUALIFIED_PRIOR_VERSION`); all mutation rows; `-nogui` mutation; scratch lifecycle; `GetUniqueId` survival (separate from readability).

**BLOCKED in v1 regardless of tests:** `ReplaceClip`/`RelinkClips`; ripple delete; `SetCurrentDatabase`; `CloseProject`; `ImportProject`; render/delivery before M11; any MCP script tool; `EKA`; publishing.

Retired request/document fields kept here only by name so the retired-term scan can point at this list: `capability_state`, `journal_available`, `authorization_token`, `attachment_evidence`.
