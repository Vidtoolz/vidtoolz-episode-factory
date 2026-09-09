# VALIDATION REPORT — Resolve authority bundle v1.4

Result: **1033/1033 checks passed**. Layers: raw parse (strict duplicate-key rejection) -> schema (Draft 2020-12) -> evidence-binding (envelope + active manifest) -> attachment (derived, current, coherent) -> capability (qualification authenticity) -> snapshot (observation model + capability coupling) -> semantic (binding, membership, derived verification) -> eligibility (evaluate_eligibility) -> linked-set (validate_transaction_set). Every layered fixture records its expected failure layer; a check that raises is a FAIL. Order-independence: seeded permutations (seed 20260909, 4 per subject). The exact-manifest section binds against the real FREEZE-MANIFEST.json sha without printing it. Offline; no Resolve. Node conformance = M1. SCHEMA-VALID != AUTHORIZED TO MUTATE; passing proves internal consistency of the authority documents only.

Layered fixture layers: {"eligibility": 4, "none": 25, "schema": 29, "semantic": 54, "snapshot": 42}

| Section | Checks | Passed |
|---|---|---|
| active-authority | 5 | 5 |
| append-effect | 10 | 10 |
| attachment-derived | 67 | 67 |
| canon-invariance | 3 | 3 |
| canon-rejection | 37 | 37 |
| canon-vector | 18 | 18 |
| capability | 11 | 11 |
| capability-qualification-negative | 15 | 15 |
| capability-record-negative | 6 | 6 |
| degraded-snapshot | 9 | 9 |
| derived-delta | 6 | 6 |
| determinism | 3 | 3 |
| eligibility | 74 | 74 |
| eligibility-invariant | 7 | 7 |
| eligibility-request-schema | 74 | 74 |
| evidence-ref-negative | 10 | 10 |
| evidence-ref-positive | 1 | 1 |
| evidence-set-binding | 49 | 49 |
| evidence-set-binding-negative | 5 | 5 |
| evidence-set-schema | 53 | 53 |
| evidence-set-schema-negative | 1 | 1 |
| exact-manifest | 12 | 12 |
| f64-exact | 3 | 3 |
| fixture-eligibility-negative | 4 | 4 |
| fixture-layers | 1 | 1 |
| fixture-none | 1 | 1 |
| fixture-schema-negative | 29 | 29 |
| fixture-schema-positive | 125 | 125 |
| fixture-semantic-negative | 54 | 54 |
| fixture-semantic-positive | 24 | 24 |
| fixture-snapshot-negative | 42 | 42 |
| frozen-instance | 14 | 14 |
| frozen-instance-schema | 7 | 7 |
| frozen-instance-semantic | 6 | 6 |
| guard | 20 | 20 |
| journal-membership | 2 | 2 |
| linked-set | 4 | 4 |
| linked-set-negative | 16 | 16 |
| linked-set-positive | 2 | 2 |
| m3-probe | 1 | 1 |
| m3-probe-count | 2 | 2 |
| m3-probe-permission | 19 | 19 |
| manifest | 6 | 6 |
| manifest-negative | 15 | 15 |
| manifest-positive | 1 | 1 |
| milestone-matrix | 17 | 17 |
| order-independence | 7 | 7 |
| parse | 3 | 3 |
| permission-invariant | 9 | 9 |
| precedence | 37 | 37 |
| precedence-retired-terms | 14 | 14 |
| precedence-supersession | 24 | 24 |
| s0-s1-resolution | 4 | 4 |
| schema-wellformed | 21 | 21 |
| timebase | 3 | 3 |
| v1.3-attack | 16 | 16 |
| zero-qualified-reads | 4 | 4 |

| Section | Check | Result | Detail |
|---|---|---|---|
| parse | clean.json.txt | PASS | parsed |
| parse | duplicate-key.json.txt | PASS | duplicate JSON key at parse boundary: 'a' |
| parse | all bundle JSON parses strictly | PASS |  |
| schema-wellformed | resolveTargetContract | PASS |  |
| schema-wellformed | resolveTimebase | PASS |  |
| schema-wellformed | resolveTrackPolicy | PASS |  |
| schema-wellformed | resolveCanarySourceManifest | PASS |  |
| schema-wellformed | resolveSnapshot | PASS |  |
| schema-wellformed | resolveGuard | PASS |  |
| schema-wellformed | resolvePermissions | PASS |  |
| schema-wellformed | resolveCapabilityMatrix | PASS |  |
| schema-wellformed | resolveReadPrimitives | PASS |  |
| schema-wellformed | resolveFreezeManifest | PASS |  |
| schema-wellformed | resolveEvidenceSet | PASS |  |
| schema-wellformed | resolveEligibilityRequest | PASS |  |
| schema-wellformed | provisional/resolveSequenceLineage | PASS |  |
| schema-wellformed | provisional/resolveBindingSet | PASS |  |
| schema-wellformed | provisional/resolveBindingObservation | PASS |  |
| schema-wellformed | provisional/resolveMutationPlan | PASS |  |
| schema-wellformed | provisional/resolveVerificationResult | PASS |  |
| schema-wellformed | provisional/resolveConflict | PASS |  |
| schema-wellformed | provisional/resolveTransactionJournal | PASS |  |
| schema-wellformed | provisional/resolveCommitManifest | PASS |  |
| schema-wellformed | provisional/resolveCheckpoint | PASS |  |
| frozen-instance-schema | TARGET-CONTRACT.json | PASS |  |
| frozen-instance-semantic | TARGET-CONTRACT.json | PASS |  |
| frozen-instance-schema | TIMEBASE.json | PASS |  |
| frozen-instance-semantic | TIMEBASE.json | PASS |  |
| frozen-instance-schema | schemas/resolveTrackPolicy.v1.json | PASS |  |
| frozen-instance-semantic | schemas/resolveTrackPolicy.v1.json | PASS |  |
| frozen-instance-schema | CANARY-SOURCE-MANIFEST.json | PASS |  |
| frozen-instance-semantic | CANARY-SOURCE-MANIFEST.json | PASS |  |
| frozen-instance-schema | PERMISSIONS.json | PASS |  |
| frozen-instance-schema | CAPABILITIES.json | PASS |  |
| frozen-instance-semantic | CAPABILITIES.json | PASS |  |
| frozen-instance-schema | READ-PRIMITIVES.json | PASS |  |
| frozen-instance-semantic | READ-PRIMITIVES.json | PASS |  |
| frozen-instance | TARGET-CONTRACT has no declared attachment_state | PASS |  |
| frozen-instance | TARGET-CONTRACT enumerates CONFLICT as an attachment state | PASS |  |
| frozen-instance | TARGET-CONTRACT carries the evidence envelope law (levels, coherence fields, currency, binding) | PASS |  |
| frozen-instance | CAPABILITIES has zero QUALIFIED_READ rows in v1.4 | PASS |  |
| frozen-instance | every read row is probe_candidate | PASS |  |
| frozen-instance | CAPABILITIES refreeze block is unreviewed and promotes nothing | PASS |  |
| frozen-instance | CAPABILITIES declares the machine qualification pipeline (candidate -> review -> refreeze -> REFREEZE_RECORD -> active matrix) | PASS |  |
| frozen-instance | no prior-version evidence record claims a probe result | PASS |  |
| frozen-instance | probe produces CANDIDATE_EVIDENCE only and promotes nothing | PASS |  |
| frozen-instance | probe failure taxonomy equals the reference taxonomy | PASS |  |
| frozen-instance | every read primitive declares its receiver/object class | PASS |  |
| frozen-instance | timeline observation status model covers start/end frame, start timecode, width, height | PASS |  |
| frozen-instance | timeline frame/geometry values are nullable in the schema (no fabricated values needed) | PASS |  |
| frozen-instance | journal execution law: OP_STARTED -> APPLIED / OP_FAILED; READBACK_S1 after APPLIED | PASS |  |
| active-authority | fixture placeholder is a well-formed sha256 and is not any real manifest | PASS |  |
| active-authority | fixture capability matrix sha equals CAPABILITIES.json on disk | PASS |  |
| active-authority | fixture hypothetical matrix sha equals the hypothetical file on disk | PASS |  |
| active-authority | hypothetical matrix is labelled HYPOTHETICAL_NOT_AUTHORITY and is not the frozen matrix | PASS |  |
| active-authority | hypothetical refrozen matrix is internally consistent (reviewed refreeze block, SUCCESS evidence per row) | PASS |  |
| evidence-set-schema | attached-ancient-observation | PASS |  |
| evidence-set-binding | attached-ancient-observation | PASS |  |
| evidence-set-schema | attached-binding-other-session | PASS |  |
| evidence-set-binding | attached-binding-other-session | PASS |  |
| evidence-set-schema | attached-candidate-evidence-unreviewed | PASS |  |
| evidence-set-binding | attached-candidate-evidence-unreviewed | PASS |  |
| evidence-set-schema | attached-capability-failure-only | PASS |  |
| evidence-set-binding | attached-capability-failure-only | PASS |  |
| evidence-set-schema | attached-changed-uuid-in-connection | PASS |  |
| evidence-set-binding | attached-changed-uuid-in-connection | PASS |  |
| evidence-set-schema | attached-connection-previous-session-only | PASS |  |
| evidence-set-binding | attached-connection-previous-session-only | PASS |  |
| evidence-set-schema | attached-cross-library-timeline-binding | PASS |  |
| evidence-set-binding | attached-cross-library-timeline-binding | PASS |  |
| evidence-set-schema | attached-current-good-stale-eka | PASS |  |
| evidence-set-binding | attached-current-good-stale-eka | PASS |  |
| evidence-set-schema | attached-duplicate-sequence-conflict | PASS |  |
| evidence-set-binding | attached-duplicate-sequence-conflict | PASS |  |
| evidence-set-schema | attached-duplicate-timestamp-distinct-sequence | PASS |  |
| evidence-set-binding | attached-duplicate-timestamp-distinct-sequence | PASS |  |
| evidence-set-schema | attached-eka-observed | PASS |  |
| evidence-set-binding | attached-eka-observed | PASS |  |
| evidence-set-schema | attached-evidence-failed-getters | PASS |  |
| evidence-set-binding | attached-evidence-failed-getters | PASS |  |
| evidence-set-schema | attached-evidence-no-raw | PASS |  |
| evidence-set-binding | attached-evidence-no-raw | PASS |  |
| evidence-set-schema | attached-evidence-old-authority | PASS |  |
| evidence-set-binding | attached-evidence-old-authority | PASS |  |
| evidence-set-schema | attached-evidence-old-refreeze | PASS |  |
| evidence-set-binding | attached-evidence-old-refreeze | PASS |  |
| evidence-set-schema | attached-evidence-raw-tampered | PASS |  |
| evidence-set-binding | attached-evidence-raw-tampered | PASS |  |
| evidence-set-schema | attached-evidence-wrong-build | PASS |  |
| evidence-set-binding | attached-evidence-wrong-build | PASS |  |
| evidence-set-schema | attached-evidence-wrong-receiver | PASS |  |
| evidence-set-binding | attached-evidence-wrong-receiver | PASS |  |
| evidence-set-schema | attached-fatal-probe-failure | PASS |  |
| evidence-set-binding | attached-fatal-probe-failure | PASS |  |
| evidence-set-schema | attached-local-database-observed | PASS |  |
| evidence-set-binding | attached-local-database-observed | PASS |  |
| evidence-set-schema | attached-missing-root-in-connection | PASS |  |
| evidence-set-binding | attached-missing-root-in-connection | PASS |  |
| evidence-set-schema | attached-no-ids | PASS |  |
| evidence-set-binding | attached-no-ids | PASS |  |
| evidence-set-schema | attached-reversed-order | PASS |  |
| evidence-set-binding | attached-reversed-order | PASS |  |
| evidence-set-schema | attached-reviewed-evidence-minus-getstartframe | PASS |  |
| evidence-set-binding | attached-reviewed-evidence-minus-getstartframe | PASS |  |
| evidence-set-schema | attached-reviewed-evidence | PASS |  |
| evidence-set-binding | attached-reviewed-evidence | PASS |  |
| evidence-set-schema | attached-second-provisioning-other-uuid | PASS |  |
| evidence-set-binding | attached-second-provisioning-other-uuid | PASS |  |
| evidence-set-schema | attached-sequence-timestamp-disorder | PASS |  |
| evidence-set-binding | attached-sequence-timestamp-disorder | PASS |  |
| evidence-set-schema | attached-stale-good-current-eka | PASS |  |
| evidence-set-binding | attached-stale-good-current-eka | PASS |  |
| evidence-set-schema | attached-version-mismatch | PASS |  |
| evidence-set-binding | attached-version-mismatch | PASS |  |
| evidence-set-schema | attached | PASS |  |
| evidence-set-binding | attached | PASS |  |
| evidence-set-schema | empty | PASS |  |
| evidence-set-binding | empty | PASS |  |
| evidence-set-schema | invalid-bundle-other-manifest-not-historical | PASS |  |
| evidence-set-binding-negative | invalid-bundle-other-manifest-not-historical | PASS | 4cff759bf3e9: BUNDLE_VERIFICATION bound to manifest 999999999999 != active reviewed manifest |
| evidence-set-schema | invalid-connection-other-authority | PASS |  |
| evidence-set-binding-negative | invalid-connection-other-authority | PASS | f63779cbc358: CONNECTION_OBSERVATION bound to authority 1.3.0 != active 1.4.0 |
| evidence-set-schema | invalid-connection-wrong-manifest | PASS |  |
| evidence-set-binding-negative | invalid-connection-wrong-manifest | PASS | 6e0627923899: CONNECTION_OBSERVATION bound to manifest 999999999999 != active reviewed manifest |
| evidence-set-schema-negative | invalid-provisioning-without-root | PASS | not:records/1e7dcac66b3210ea89006bc8ab047ca8e9498a16c1eba210155881e931475194/envelope/library_root:None should not be valid under {'type': 'null'} |
| evidence-set-binding-negative | invalid-provisioning-without-root | PASS | 1e7dcac66b32: PROVISIONING_RECORD: envelope.library_root required at level LIBRARY |
| evidence-set-schema | invalid-tampered-record | PASS |  |
| evidence-set-binding-negative | invalid-tampered-record | PASS | 2f4b66121803: record_id does not match content digest |
| evidence-set-schema | provisioned-only | PASS |  |
| evidence-set-binding | provisioned-only | PASS |  |
| evidence-set-schema | ready-bundle-historical-only | PASS |  |
| evidence-set-binding | ready-bundle-historical-only | PASS |  |
| evidence-set-schema | ready-bundle-other-host | PASS |  |
| evidence-set-binding | ready-bundle-other-host | PASS |  |
| evidence-set-schema | ready-ghost-session-without-launch | PASS |  |
| evidence-set-binding | ready-ghost-session-without-launch | PASS |  |
| evidence-set-schema | ready-launch-previous-session-only | PASS |  |
| evidence-set-binding | ready-launch-previous-session-only | PASS |  |
| evidence-set-schema | ready-no-current-session | PASS |  |
| evidence-set-binding | ready-no-current-session | PASS |  |
| evidence-set-schema | ready-self-verified-bundle | PASS |  |
| evidence-set-binding | ready-self-verified-bundle | PASS |  |
| evidence-set-schema | ready-wrong-binary-pin | PASS |  |
| evidence-set-binding | ready-wrong-binary-pin | PASS |  |
| evidence-set-schema | ready | PASS |  |
| evidence-set-binding | ready | PASS |  |
| evidence-set-schema | write-ready-authorization-old-authority | PASS |  |
| evidence-set-binding | write-ready-authorization-old-authority | PASS |  |
| evidence-set-schema | write-ready-base | PASS |  |
| evidence-set-binding | write-ready-base | PASS |  |
| evidence-set-schema | write-ready-full | PASS |  |
| evidence-set-binding | write-ready-full | PASS |  |
| evidence-set-schema | write-ready-hyp | PASS |  |
| evidence-set-binding | write-ready-hyp | PASS |  |
| evidence-set-schema | write-ready-plan-validation-fail | PASS |  |
| evidence-set-binding | write-ready-plan-validation-fail | PASS |  |
| evidence-set-schema | write-ready-refreeze-other-matrix | PASS |  |
| evidence-set-binding | write-ready-refreeze-other-matrix | PASS |  |
| evidence-set-schema | write-ready-refreeze-unreviewed | PASS |  |
| evidence-set-binding | write-ready-refreeze-unreviewed | PASS |  |
| evidence-set-schema | write-ready-stale-guard-current | PASS |  |
| evidence-set-binding | write-ready-stale-guard-current | PASS |  |
| evidence-set-schema | write-ready-without-authorization | PASS |  |
| evidence-set-binding | write-ready-without-authorization | PASS |  |
| evidence-ref-negative | empty string | PASS | M3_AUTHORIZATION: reference is not a sha256 ('') |
| evidence-ref-negative | boolean-string false | PASS | M3_AUTHORIZATION: reference is not a sha256 ('false') |
| evidence-ref-negative | uppercase sha | PASS | M3_AUTHORIZATION: reference is not a sha256 ('3714990B13B7A03661F2BC810DE115FF2F611AD1C9B52A25CD2A6661ACAF1BE0') |
| evidence-ref-negative | unlinked sha | PASS | M3_AUTHORIZATION: referenced record 999999999999 not in evidence set |
| evidence-ref-negative | wrong type | PASS | M3_AUTHORIZATION: record 3714990b13b7 has type PROVISIONING_RECORD |
| evidence-ref-negative | short hex | PASS | M3_AUTHORIZATION: reference is not a sha256 ('3714990b13b7a03661f2bc810de115ff2f611ad1c9b52a25cd2a6661acaf1be') |
| evidence-ref-negative | sha with newline | PASS | M3_AUTHORIZATION: reference is not a sha256 ('3714990b13b7a03661f2bc810de115ff2f611ad1c9b52a25cd2a6661acaf1be0\n') |
| evidence-ref-negative | record for another host | PASS |  |
| evidence-ref-negative | record bound to another manifest is not evidence for the active authority | PASS |  |
| evidence-ref-negative | record bound to another authority version is not evidence | PASS |  |
| evidence-ref-positive | linked correct-type record bound to the active authority resolves | PASS |  |
| attachment-derived | every evidence fixture has a pinned expected state | PASS |  |
| attachment-derived | attached -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-ancient-observation -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=['latest CONNECTION_OBSERVATION is STALE'] conflicts=[] |
| attachment-derived | attached-binding-other-session -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-candidate-evidence-unreviewed -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-capability-failure-only -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-changed-uuid-in-connection -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=['OBSERVED_TARGET_MISMATCH: observed library uuid differs from provisioning record (or missing)'] conflicts=[] |
| attachment-derived | attached-connection-previous-session-only -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=['no CONNECTION_OBSERVATION in the current session'] conflicts=[] |
| attachment-derived | attached-cross-library-timeline-binding -> CONFLICT | PASS | got CONFLICT; failures=[] conflicts=['library_name'] |
| attachment-derived | attached-current-good-stale-eka -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-duplicate-sequence-conflict -> CONFLICT | PASS | got CONFLICT; failures=[] conflicts=['two CONNECTION_OBSERVATIONs share the highest sequence in the current session'] |
| attachment-derived | attached-duplicate-timestamp-distinct-sequence -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-eka-observed -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=["OBSERVED_TARGET_MISMATCH: observed db_type PostgreSQL is not Disk; observed database 'EKA' != contract library; observed database is a prohibited (shared/user) library; observed library r |
| attachment-derived | attached-evidence-failed-getters -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-no-raw -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-old-authority -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-old-refreeze -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-raw-tampered -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-wrong-build -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-wrong-receiver -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-fatal-probe-failure -> CONFLICT | PASS | got CONFLICT; failures=[] conflicts=['FATAL_TARGET_FAILURE recorded in the current session: WRONG_LIBRARY'] |
| attachment-derived | attached-local-database-observed -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=["OBSERVED_TARGET_MISMATCH: observed database 'Local Database' != contract library; observed database is a prohibited (shared/user) library; observed library root differs from provisioning  |
| attachment-derived | attached-missing-root-in-connection -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=['OBSERVED_TARGET_MISMATCH: observed library root differs from provisioning record (or missing)'] conflicts=[] |
| attachment-derived | attached-no-ids -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-reversed-order -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-reviewed-evidence -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-reviewed-evidence-minus-getstartframe -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-second-provisioning-other-uuid -> CONFLICT | PASS | got CONFLICT; failures=[] conflicts=['multiple PROVISIONING_RECORDs with different uuid/root for the contract library'] |
| attachment-derived | attached-sequence-timestamp-disorder -> CONFLICT | PASS | got CONFLICT; failures=[] conflicts=['CONNECTION_OBSERVATION: captured_at decreases while sequence increases'] |
| attachment-derived | attached-stale-good-current-eka -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=["OBSERVED_TARGET_MISMATCH: observed db_type PostgreSQL is not Disk; observed database 'EKA' != contract library; observed database is a prohibited (shared/user) library; observed library r |
| attachment-derived | attached-version-mismatch -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=['OBSERVED_TARGET_MISMATCH: observed product/version DaVinci Resolve Studio 21.0.3.0007 != contract'] conflicts=[] |
| attachment-derived | empty -> UNPROVISIONED | PASS | got UNPROVISIONED; failures=['no valid PROVISIONING_RECORD for contract host/library (Disk, uuid, absolute root, provisioned_by, envelope == body)'] conflicts=[] |
| attachment-derived | invalid-bundle-other-manifest-not-historical -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', '4cff759bf3e9: BUNDLE_VERIFICATION bound to manifest 999999999999 != active reviewed manifest'] conflicts=[] |
| attachment-derived | invalid-connection-other-authority -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', 'f63779cbc358: CONNECTION_OBSERVATION bound to authority 1.3.0 != active 1.4.0'] conflicts=[] |
| attachment-derived | invalid-connection-wrong-manifest -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', '6e0627923899: CONNECTION_OBSERVATION bound to manifest 999999999999 != active reviewed manifest'] conflicts=[] |
| attachment-derived | invalid-provisioning-without-root -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', '1e7dcac66b32: PROVISIONING_RECORD: envelope.library_root required at level LIBRARY'] conflicts=[] |
| attachment-derived | invalid-tampered-record -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', '2f4b66121803: record_id does not match content digest'] conflicts=[] |
| attachment-derived | provisioned-only -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host', 'no current_session_id'] conflicts=[] |
| attachment-derived | ready -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=['no CONNECTION_OBSERVATION in the current session'] conflicts=[] |
| attachment-derived | ready-bundle-historical-only -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host'] conflicts=[] |
| attachment-derived | ready-bundle-other-host -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host'] conflicts=[] |
| attachment-derived | ready-ghost-session-without-launch -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no LAUNCH_RECIPE for the current session bound to this provisioning record, contract version, binary pin and Local scripting'] conflicts=[] |
| attachment-derived | ready-launch-previous-session-only -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no LAUNCH_RECIPE for the current session bound to this provisioning record, contract version, binary pin and Local scripting'] conflicts=[] |
| attachment-derived | ready-no-current-session -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no current_session_id'] conflicts=[] |
| attachment-derived | ready-self-verified-bundle -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host'] conflicts=[] |
| attachment-derived | ready-wrong-binary-pin -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no LAUNCH_RECIPE for the current session bound to this provisioning record, contract version, binary pin and Local scripting'] conflicts=[] |
| attachment-derived | write-ready-authorization-old-authority -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority'] conflicts=[] |
| attachment-derived | write-ready-base -> SCRATCH_WRITE_READY | PASS | got SCRATCH_WRITE_READY; failures=[] conflicts=[] |
| attachment-derived | write-ready-full -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-hyp -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-plan-validation-fail -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-refreeze-other-matrix -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-refreeze-unreviewed -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-stale-guard-current -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-without-authorization -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority'] conflicts=[] |
| attachment-derived | write-ready-hyp under hypothetical refreeze -> SCRATCH_WRITE_READY | PASS | got SCRATCH_WRITE_READY; failures=[] |
| attachment-derived | write-ready-full under hypothetical refreeze -> SCRATCH_WRITE_READY | PASS | got SCRATCH_WRITE_READY; failures=[] |
| attachment-derived | write-ready-stale-guard-current under hypothetical refreeze -> SCRATCH_WRITE_READY | PASS | got SCRATCH_WRITE_READY; failures=[] |
| attachment-derived | write-ready-plan-validation-fail under hypothetical refreeze -> SCRATCH_WRITE_READY | PASS | got SCRATCH_WRITE_READY; failures=[] |
| attachment-derived | refreeze for another capability matrix never reaches SCRATCH_WRITE_READY | PASS |  |
| attachment-derived | mismatched observation reports OBSERVED_TARGET_MISMATCH | PASS |  |
| attachment-derived | stale observation is reported as STALE, not silently ignored | PASS |  |
| attachment-derived | missing connection root and changed uuid are OBSERVED_TARGET_MISMATCH, not accepted | PASS |  |
| attachment-derived | same evidence reversed gives an identical derivation | PASS |  |
| attachment-derived | contract naming a prohibited library is UNPROVISIONED | PASS |  |
| attachment-derived | historical BUNDLE_VERIFICATION never serves as current authority | PASS |  |
| attachment-derived | CONFLICT ranks below every ladder state | PASS |  |
| capability | every fixture CAPABILITY_EVIDENCE record obeys the result/qualification law | PASS |  |
| capability-record-negative | SUCCESS with a failure code | PASS | SUCCESS requires success:true and code:null |
| capability-record-negative | failed observation ACCEPTed | PASS | a failed observation can never be ACCEPTed |
| capability-record-negative | unreviewed candidate with a decision | PASS | unreviewed candidate cannot carry a decision or promotion |
| capability-record-negative | ACCEPT without promotion | PASS | ACCEPT requires promoted_by {authority_version, capability_matrix_sha256} |
| capability-record-negative | unknown classification | PASS | unknown classification FAILED: getter crashed |
| capability-record-negative | fatal code under capability class | PASS | code WRONG_LIBRARY does not belong to CAPABILITY_FAILURE; a failed observation can never be ACCEPTed |
| capability | reviewed, promoted, raw-backed SUCCESS record qualifies under the hypothetical active matrix | PASS |  |
| capability-qualification-negative | wrong build | PASS |  |
| capability-qualification-negative | wrong version | PASS |  |
| capability-qualification-negative | wrong host | PASS |  |
| capability-qualification-negative | wrong product | PASS |  |
| capability-qualification-negative | wrong receiver/object class | PASS |  |
| capability-qualification-negative | adjacent getter evidence (method renamed) | PASS |  |
| capability-qualification-negative | FAILED: getter crashed | PASS |  |
| capability-qualification-negative | candidate not reviewed | PASS |  |
| capability-qualification-negative | reviewed but REJECTed | PASS |  |
| capability-qualification-negative | promoted by an old refreeze (other matrix sha) | PASS |  |
| capability-qualification-negative | promoted under another authority version | PASS |  |
| capability-qualification-negative | active refreeze differs from the promoting matrix | PASS |  |
| capability-qualification-negative | raw evidence missing | PASS |  |
| capability-qualification-negative | raw evidence tampered | PASS |  |
| capability-qualification-negative | raw hash does not match the record | PASS |  |
| capability | frozen matrix + reviewed evidence -> UNQUALIFIED (candidate evidence never qualifies without a refrozen matrix) | PASS |  |
| capability | hypothetical refrozen matrix + reviewed linked evidence -> QUALIFIED_CALLABLE | PASS |  |
| capability | hypothetical matrix + unreviewed candidates -> UNQUALIFIED | PASS |  |
| capability | hypothetical matrix + failed getters -> UNQUALIFIED | PASS |  |
| capability | hypothetical matrix + wrong build evidence -> UNQUALIFIED | PASS |  |
| capability | hypothetical matrix + old refreeze evidence -> UNQUALIFIED | PASS |  |
| capability | probe entry on a probe_candidate row -> PROBE_ALLOWED under the frozen matrix | PASS |  |
| capability | the same getter outside the probe -> UNQUALIFIED under the frozen matrix | PASS |  |
| capability | unknown method -> UNKNOWN_METHOD | PASS |  |
| zero-qualified-reads | nothing is callable under the frozen v1.4 matrix (0 of every read primitive) | PASS |  |
| zero-qualified-reads | hypothetical refreeze makes every read primitive callable (positive path exists) | PASS |  |
| zero-qualified-reads | GetStartFrame alone drops out when its evidence is absent (degraded timeline observation) | PASS |  |
| zero-qualified-reads | CONNECT/TIMEBASE_OBSERVE carry REFUSE fallbacks; SNAPSHOT_CAPTURE degrades | PASS |  |
| fixture-schema-positive | capabilities-frozen | PASS |  |
| fixture-semantic-positive | capabilities-frozen | PASS |  |
| fixture-schema-negative | capabilities-missing-refreeze-block | PASS | required::'refreeze' is a required property |
| fixture-schema-positive | capabilities-qualified-read-on-failed-evidence | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-on-failed-evidence | PASS | row 'read: connection': QUALIFIED_READ without exact reviewed SUCCESS version-matched evidence record promoted by this matrix version; row 'read: connection': QUALIFIED_READ requires a reviewed refreeze block on the matr |
| fixture-schema-positive | capabilities-qualified-read-promoted-by-other-refreeze | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-promoted-by-other-refreeze | PASS | row 'read: connection': QUALIFIED_READ without exact reviewed SUCCESS version-matched evidence record promoted by this matrix version; row 'read: connection': QUALIFIED_READ requires a reviewed refreeze block on the matr |
| fixture-schema-positive | capabilities-qualified-read-unreviewed-refreeze-block | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-unreviewed-refreeze-block | PASS | row 'read: connection': QUALIFIED_READ requires a reviewed refreeze block on the matrix; row 'read: connection': probe_candidate only allowed on DOCUMENTED_NOT_QUALIFIED rows |
| fixture-schema-positive | capabilities-qualified-read-without-exact-evidence | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-without-exact-evidence | PASS | row 'read: connection': QUALIFIED_READ without exact reviewed SUCCESS version-matched evidence record promoted by this matrix version; row 'read: connection': QUALIFIED_READ requires a reviewed refreeze block on the matr |
| fixture-schema-negative | capabilities-unknown-evidence-class | PASS | enum:rows/0/evidence_class:'QUALIFIED' is not one of ['QUALIFIED_READ', 'DOCUMENTED_NOT_QUALIFIED', 'NOT_TESTED', 'UNSUPPORTED', 'BLOCKED', 'QUALIFIED_EF_SIDE'] |
| fixture-schema-positive | capabilities-version-match-lie | PASS |  |
| fixture-semantic-negative | capabilities-version-match-lie | PASS | row 'read: connection': version_match true but version differs from contract |
| fixture-schema-positive | commit-journal-head-mismatch | PASS |  |
| fixture-semantic-negative | commit-journal-head-mismatch | PASS | commit journal_head_sha256 does not match journal chain head |
| fixture-schema-positive | commit-journal-invented-operation | PASS |  |
| fixture-semantic-negative | commit-journal-invented-operation | PASS | journal: seq 5: operation_id op-9 is not in the bound plan operation set (journal invented an operation); journal: seq 5: APPLIED without a preceding OP_STARTED for op-9; journal: seq 6: READBACK_S1 before all plan opera |
| fixture-schema-positive | commit-linked-eligible | PASS |  |
| fixture-semantic-positive | commit-linked-eligible | PASS |  |
| fixture-schema-negative | commit-missing-s1-guard | PASS | required::'s1_guard_digest' is a required property |
| fixture-schema-positive | commit-operation-set-mismatch | PASS |  |
| fixture-semantic-negative | commit-operation-set-mismatch | PASS | commit operation_set_digest != plan |
| fixture-schema-positive | commit-s1-guard-mismatch | PASS |  |
| fixture-semantic-negative | commit-s1-guard-mismatch | PASS | commit s1_guard_digest does not match S1 |
| fixture-schema-positive | commit-target-mismatch | PASS |  |
| fixture-semantic-negative | commit-target-mismatch | PASS | commit target != plan target |
| fixture-schema-positive | commit-verification-hash-only-object-missing | PASS |  |
| fixture-semantic-negative | commit-verification-hash-only-object-missing | PASS | commit requires plan, journal and verification objects (not only their hashes) |
| fixture-schema-positive | commit-verification-not-derived-truth | PASS |  |
| fixture-semantic-negative | commit-verification-not-derived-truth | PASS | verification: verification.missing_expected differs from derived truth (declared [] vs derived ["op-1: APPEND produced no new occurrence on video:1 [110194,110541]"]); verification: verification.verdict differs from deri |
| fixture-schema-positive | commit-with-unresolved-conflict-record | PASS |  |
| fixture-semantic-negative | commit-with-unresolved-conflict-record | PASS | commit with unresolved conflict |
| fixture-schema-positive | conflict-bound-resolved | PASS |  |
| fixture-semantic-positive | conflict-bound-resolved | PASS |  |
| fixture-schema-positive | conflict-other-plan | PASS |  |
| fixture-semantic-negative | conflict-other-plan | PASS | conflict not bound to this plan/transaction |
| fixture-schema-positive | journal-applied-operation-not-in-plan | PASS |  |
| fixture-semantic-negative | journal-applied-operation-not-in-plan | PASS | seq 5: operation_id op-9 is not in the bound plan operation set (journal invented an operation); seq 5: APPLIED without a preceding OP_STARTED for op-9; seq 6: READBACK_S1 before all plan operations applied (missing ['op |
| fixture-schema-positive | journal-applied-without-started | PASS |  |
| fixture-semantic-negative | journal-applied-without-started | PASS | seq 4: illegal transition CHECKPOINTED -> APPLIED; seq 4: APPLIED without a preceding OP_STARTED for op-1 |
| fixture-schema-positive | journal-broken-hash-chain | PASS |  |
| fixture-semantic-negative | journal-broken-hash-chain | PASS | seq 3: hash chain broken; seq 4: hash chain broken |
| fixture-schema-positive | journal-empty | PASS |  |
| fixture-semantic-negative | journal-empty | PASS | empty journal |
| fixture-schema-positive | journal-guard-change-without-recovery | PASS |  |
| fixture-semantic-negative | journal-guard-change-without-recovery | PASS | seq 6: guard_digest changed without a recovery transition |
| fixture-schema-positive | journal-invented-operation-started-and-applied | PASS |  |
| fixture-semantic-negative | journal-invented-operation-started-and-applied | PASS | seq 4: operation_id op-9 is not in the bound plan operation set (journal invented an operation); seq 5: operation_id op-9 is not in the bound plan operation set (journal invented an operation); seq 6: READBACK_S1 before  |
| fixture-schema-positive | journal-legal-chain | PASS |  |
| fixture-semantic-positive | journal-legal-chain | PASS |  |
| fixture-schema-negative | journal-missing-op-field | PASS | required::'op' is a required property |
| fixture-schema-positive | journal-non-operation-state-carries-operation | PASS |  |
| fixture-semantic-negative | journal-non-operation-state-carries-operation | PASS | seq 1: non-operation state LEASED carries operation_id/op |
| fixture-schema-positive | journal-op-type-inconsistent-with-plan | PASS |  |
| fixture-semantic-negative | journal-op-type-inconsistent-with-plan | PASS | seq 5: op DELETE inconsistent with plan entry APPEND |
| fixture-schema-positive | journal-operation-applied-twice | PASS |  |
| fixture-semantic-negative | journal-operation-applied-twice | PASS | seq 5: operation op-1 started twice; seq 6: operation_id op-1 applied twice |
| fixture-schema-positive | journal-operation-failed-aborted | PASS |  |
| fixture-semantic-positive | journal-operation-failed-aborted | PASS |  |
| fixture-schema-positive | journal-operation-set-digest-drift | PASS |  |
| fixture-semantic-negative | journal-operation-set-digest-drift | PASS | seq 6: operation_set_digest changed mid-chain |
| fixture-schema-positive | journal-operation-set-digest-not-plan | PASS |  |
| fixture-semantic-negative | journal-operation-set-digest-not-plan | PASS | journal operation_set_digest != plan |
| fixture-schema-positive | journal-plan-digest-change-mid-chain | PASS |  |
| fixture-semantic-negative | journal-plan-digest-change-mid-chain | PASS | seq 6: plan_digest changed mid-chain |
| fixture-schema-positive | journal-readback-before-all-applied | PASS |  |
| fixture-semantic-negative | journal-readback-before-all-applied | PASS | seq 3: illegal transition PREFLIGHT_OK -> READBACK_S1; seq 3: READBACK_S1 before all plan operations applied (missing ['op-1']) |
| fixture-schema-positive | journal-record-after-terminal | PASS |  |
| fixture-semantic-negative | journal-record-after-terminal | PASS | seq 11: illegal transition COMMITTED -> APPLIED; seq 11: operation_id op-1 applied twice; seq 11: record after terminal state COMMITTED |
| fixture-schema-positive | journal-recovery-committed-recovered | PASS |  |
| fixture-semantic-positive | journal-recovery-committed-recovered | PASS |  |
| fixture-schema-positive | journal-recovery-not-applied | PASS |  |
| fixture-semantic-positive | journal-recovery-not-applied | PASS |  |
| fixture-schema-positive | journal-recovery-unlinked | PASS |  |
| fixture-semantic-negative | journal-recovery-unlinked | PASS | seq 1: recovery record not linked to original transaction |
| fixture-schema-positive | journal-sequence-gap | PASS |  |
| fixture-semantic-negative | journal-sequence-gap | PASS | seq 5: sequence not contiguous (expected 2); seq 3: sequence not contiguous (expected 6) |
| fixture-schema-positive | journal-skip-to-committed | PASS |  |
| fixture-semantic-negative | journal-skip-to-committed | PASS | seq 5: illegal transition OP_STARTED -> COMMITTED; seq 5: non-operation state COMMITTED carries operation_id/op; seq 6: illegal transition COMMITTED -> READBACK_S1; seq 6: READBACK_S1 before all plan operations applied ( |
| fixture-schema-positive | journal-transaction-id-change | PASS |  |
| fixture-semantic-negative | journal-transaction-id-change | PASS | seq 3: transaction_id changed mid-chain |
| fixture-schema-negative | journal-unknown-state | PASS | enum:state:'APPLIED_MAYBE' is not one of ['ABORTED', 'APPLIED', 'CHECKPOINTED', 'COMMITTED', 'COMMITTED_RECOVERED', 'CONFLICT', 'LEASED', 'NOT_APPLIED', 'OP_FAILED', 'OP_STARTED', 'ORPHANED_AMBIGUOUS', 'ORPHANED_PARTIAL' |
| fixture-schema-negative | permissions-default-allow | PASS | const:default:'DENY' was expected |
| fixture-schema-positive | permissions-frozen | PASS |  |
| fixture-none | permissions-frozen | PASS |  |
| fixture-schema-negative | permissions-m0-mutation | PASS | const:entries/0/milestone:'M3' was expected / contains:entries/0/prerequisites:['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY', 'HOST_MATCHES_CONTRACT', 'LIBRARY_NOT_SHARED', 'LIBRARY_MATCHES_CONTRACT', |
| fixture-schema-negative | permissions-shared-library-grant | PASS | const:entries/0/shared_library_allowed:False was expected |
| fixture-schema-positive | permissions-target-requirement-disagrees-with-read-primitives | PASS |  |
| fixture-semantic-negative | permissions-target-requirement-disagrees-with-read-primitives | PASS | PERMISSIONS/M0/CONNECT: target_requirement differs from READ-PRIMITIVES |
| fixture-schema-negative | plan-authority-version-old | PASS | const:authority_version:'1.4.0' was expected |
| fixture-schema-positive | plan-digest-not-of-body | PASS |  |
| fixture-semantic-negative | plan-digest-not-of-body | PASS | plan_digest does not match plan body digest; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record daa02f04c750 plan_digest='54d49270e89ce7effcd7ac0d66a10b0815c83bbbe009c10f20e07f0acb8d59f6' != '000 |
| fixture-schema-positive | plan-duplicate-operation-id | PASS |  |
| fixture-semantic-negative | plan-duplicate-operation-id | PASS | operation ids must be unique and non-empty; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record daa02f04c750 plan_digest='54d49270e89ce7effcd7ac0d66a10b0815c83bbbe009c10f20e07f0acb8d59f6' != '0c49 |
| fixture-schema-positive | plan-eligible-without-prepared-journal | PASS |  |
| fixture-eligibility-negative | plan-eligible-without-prepared-journal | PASS | operation APPEND not eligible: ['JOURNAL_PREPARED (JOURNAL_PREPARED: referenced record daa02f04c750 not in evidence set)', 'PLAN_VALIDATED (PLAN_VALIDATION: referenced record 6dde4f358dea not in evidence set)', 'GUARD_CU |
| fixture-schema-positive | plan-guard-record-not-current | PASS |  |
| fixture-eligibility-negative | plan-guard-record-not-current | PASS | operation APPEND not eligible: ['GUARD_CURRENT (guard record is not the CURRENT guard observation (CURRENT))'] |
| fixture-schema-positive | plan-m2-append-not-permitted | PASS |  |
| fixture-semantic-negative | plan-m2-append-not-permitted | PASS | operation APPEND not permitted at M2/SCRATCH_QUALIFICATION_LIBRARY: ['NOT_PERMITTED_BY_POLICY:no explicit entry (default DENY)'] |
| fixture-schema-positive | plan-m3-append-eligible | PASS |  |
| fixture-semantic-positive | plan-m3-append-eligible | PASS |  |
| fixture-schema-positive | plan-missing-m3-authorization | PASS |  |
| fixture-eligibility-negative | plan-missing-m3-authorization | PASS | operation APPEND not eligible: ['MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: reference is not a sha256 (None))'] |
| fixture-schema-positive | plan-operation-set-digest-mismatch | PASS |  |
| fixture-semantic-negative | plan-operation-set-digest-mismatch | PASS | operation_set_digest does not match operations; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record daa02f04c750 plan_digest='54d49270e89ce7effcd7ac0d66a10b0815c83bbbe009c10f20e07f0acb8d59f6' != ' |
| fixture-schema-positive | plan-plan-validation-record-fail | PASS |  |
| fixture-eligibility-negative | plan-plan-validation-record-fail | PASS | operation APPEND not eligible: ['PLAN_VALIDATED (PLAN_VALIDATION: referenced record 6dde4f358dea not in evidence set)'] |
| fixture-schema-positive | plan-read-class-with-append | PASS |  |
| fixture-semantic-negative | plan-read-class-with-append | PASS | RESOLVE_READ permission class cannot carry write operations; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record daa02f04c750 plan_digest='54d49270e89ce7effcd7ac0d66a10b0815c83bbbe009c10f20e07f0ac |
| fixture-schema-positive | plan-selector-target-mismatch | PASS |  |
| fixture-semantic-negative | plan-selector-target-mismatch | PASS | operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record daa02f04c750 plan_digest='54d49270e89ce7effcd7ac0d66a10b0815c83bbbe009c10f20e07f0acb8d59f6' != '4ab05280a433adfa52db3359455001ac28bce4e2d7101957 |
| fixture-schema-positive | plan-stale-guard | PASS |  |
| fixture-semantic-negative | plan-stale-guard | PASS | operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record daa02f04c750 plan_digest='54d49270e89ce7effcd7ac0d66a10b0815c83bbbe009c10f20e07f0acb8d59f6' != '57527759c6cc4111963bbdea222ae337c6815358fbc3346e |
| fixture-schema-positive | read-primitives-class-mismatch-with-matrix | PASS |  |
| fixture-semantic-negative | read-primitives-class-mismatch-with-matrix | PASS | SNAPSHOT_CAPTURE: primitive GetTrackCount evidence_class QUALIFIED_READ != matrix DOCUMENTED_NOT_QUALIFIED |
| fixture-schema-positive | read-primitives-frozen | PASS |  |
| fixture-semantic-positive | read-primitives-frozen | PASS |  |
| fixture-schema-negative | read-primitives-invented-target-requirement | PASS | enum:logical_operations/CONNECT/target_requirement:'CURRENT_PROJECT' is not one of ['SESSION', 'PROJECT', 'PROJECT_TIMELINE'] |
| fixture-schema-negative | read-primitives-missing-receiver | PASS | required:logical_operations/CONNECT/primitives/0:'receiver' is a required property |
| fixture-schema-positive | read-primitives-probe-allowed-outside-probe | PASS |  |
| fixture-semantic-negative | read-primitives-probe-allowed-outside-probe | PASS | SNAPSHOT_CAPTURE: probe_allowed primitives only inside READ_PRIMITIVE_QUALIFICATION_PROBE |
| fixture-schema-positive | read-primitives-taxonomy-drift | PASS |  |
| fixture-semantic-negative | read-primitives-taxonomy-drift | PASS | probe failure_taxonomy differs from authority_lib.PROBE_FAILURE_TAXONOMY |
| fixture-schema-positive | snapshot-claims-callable-not-in-authority | PASS |  |
| fixture-snapshot-negative | snapshot-claims-callable-not-in-authority | PASS | collection.primitive_status claims GetStart callable but the active authority does not qualify it |
| fixture-schema-positive | snapshot-complete-empty-observed | PASS |  |
| fixture-snapshot-negative | snapshot-complete-empty-observed | PASS | complete:true with empty observed_domains; complete:true but mandatory domains not observed: ['connection', 'items', 'library', 'markers', 'project', 'settings', 'timeline', 'tracks'] |
| fixture-schema-positive | snapshot-complete-with-incomplete-reasons | PASS |  |
| fixture-snapshot-negative | snapshot-complete-with-incomplete-reasons | PASS | complete:true with incomplete_reasons listed |
| fixture-schema-positive | snapshot-complete-with-observation-failures | PASS |  |
| fixture-snapshot-negative | snapshot-complete-with-observation-failures | PASS | complete:true with observation_failures present |
| fixture-schema-positive | snapshot-complete-with-partial-item-full-profile | PASS |  |
| fixture-snapshot-negative | snapshot-complete-with-partial-item-full-profile | PASS | complete:true under FULL_TIMELINE_READ with unresolved item fields ['enabled', 'end'] |
| fixture-schema-positive | snapshot-complete-with-unresolved-timeline-fields | PASS |  |
| fixture-snapshot-negative | snapshot-complete-with-unresolved-timeline-fields | PASS | complete:true under FULL_TIMELINE_READ with unresolved timeline fields ['end_frame', 'start_frame'] |
| fixture-schema-positive | snapshot-complete-write-precheck-missing-domains | PASS |  |
| fixture-snapshot-negative | snapshot-complete-write-precheck-missing-domains | PASS | complete:true but mandatory domains not observed: ['guard', 'item_identity', 'policy', 'track_locks']; complete:true under WRITE_PRECHECK with unresolved item fields ['media_pool_item_unique_id'] |
| fixture-schema-positive | snapshot-degraded-start-frame-claimed-observed | PASS |  |
| fixture-snapshot-negative | snapshot-degraded-start-frame-claimed-observed | PASS | timeline.start_frame: OBSERVED but producing primitive(s) ['GetStartFrame'] not callable in this session; collection.primitive_status claims GetStartFrame callable but the active authority does not qualify it |
| fixture-schema-positive | snapshot-degraded-start-frame-claims-complete | PASS |  |
| fixture-snapshot-negative | snapshot-degraded-start-frame-claims-complete | PASS | complete:true under FULL_TIMELINE_READ with unresolved timeline fields ['start_frame'] |
| fixture-schema-positive | snapshot-degraded-start-frame-unavailable-honest | PASS |  |
| fixture-semantic-positive | snapshot-degraded-start-frame-unavailable-honest | PASS |  |
| fixture-schema-positive | snapshot-degraded-start-frame-value-with-unavailable | PASS |  |
| fixture-snapshot-negative | snapshot-degraded-start-frame-value-with-unavailable | PASS | timeline.start_frame: status UNAVAILABLE but value present (fabrication) |
| fixture-schema-positive | snapshot-duration-contradiction | PASS |  |
| fixture-snapshot-negative | snapshot-duration-contradiction | PASS | item[video:1#0]: duration inconsistent with both candidate conventions |
| fixture-schema-positive | snapshot-end-before-start | PASS |  |
| fixture-snapshot-negative | snapshot-end-before-start | PASS | item[video:1#0]: end < start; item[video:1#0]: duration inconsistent with both candidate conventions |
| fixture-schema-positive | snapshot-fabricated-id | PASS |  |
| fixture-snapshot-negative | snapshot-fabricated-id | PASS | item[video:1#0].unique_id: status UNAVAILABLE but value present (fabrication) |
| fixture-schema-positive | snapshot-full-profile-timeline-identity-unavailable-complete | PASS |  |
| fixture-snapshot-negative | snapshot-full-profile-timeline-identity-unavailable-complete | PASS | complete:true under FULL_TIMELINE_READ but timeline.unique_id not OBSERVED |
| fixture-schema-positive | snapshot-full-read-claimed-under-frozen-matrix | PASS |  |
| fixture-snapshot-negative | snapshot-full-read-claimed-under-frozen-matrix | PASS | project.unique_id: OBSERVED but producing primitive(s) ['Project.GetUniqueId'] not callable in this session; project.name: OBSERVED but producing primitive(s) ['Project.GetName'] not callable in this session; timeline.un |
| fixture-schema-positive | snapshot-full-read-partial-item-honest | PASS |  |
| fixture-semantic-positive | snapshot-full-read-partial-item-honest | PASS |  |
| fixture-schema-positive | snapshot-guard-context-changed-raw | PASS |  |
| fixture-snapshot-negative | snapshot-guard-context-changed-raw | PASS | guard_digest does not match guard object |
| fixture-schema-positive | snapshot-human-timeline-full-read | PASS |  |
| fixture-semantic-positive | snapshot-human-timeline-full-read | PASS |  |
| fixture-schema-positive | snapshot-incomplete-nothing-missing-named | PASS |  |
| fixture-snapshot-negative | snapshot-incomplete-nothing-missing-named | PASS | complete:false must name missing domains/fields (profile-mandatory gaps, degraded timeline/project/track fields or a failure ledger) |
| fixture-schema-positive | snapshot-incomplete-without-reasons | PASS |  |
| fixture-snapshot-negative | snapshot-incomplete-without-reasons | PASS | complete:false must list incomplete_reasons |
| fixture-schema-negative | snapshot-invented-domain | PASS | enum:coverage/observed_domains/9:'vibes' is not one of ['adapter_bin_media', 'caches', 'connection', 'fades', 'fusion_graphs', 'grades', 'guard', 'item_identity', 'item_properties', 'item_source_bounds', 'items', 'keyfra |
| fixture-schema-negative | snapshot-invented-field-status-name | PASS | oneOf:payload/tracks/0/items/0:{'unique_id': 'it-1', 'observation_ordinal': 0, 'name': 'still-001', 'start': 108000, 'end': 108347, 'duration': 347, 'enabled': True, 'markers': [], 'identity_observed': 'COMPLETE', 'field |
| fixture-schema-positive | snapshot-m0-complete-claimed-nothing-qualified | PASS |  |
| fixture-snapshot-negative | snapshot-m0-complete-claimed-nothing-qualified | PASS | complete:true but mandatory domains not observed: ['project', 'timeline'] |
| fixture-schema-positive | snapshot-m0-domain-observed-without-callable | PASS |  |
| fixture-snapshot-negative | snapshot-m0-domain-observed-without-callable | PASS | a domain cannot be both observed and unobservable/deferred; domain tracks observed but producing primitive(s) ['GetTrackCount'] not callable |
| fixture-schema-positive | snapshot-m0-minimal-complete-qualified | PASS |  |
| fixture-semantic-positive | snapshot-m0-minimal-complete-qualified | PASS |  |
| fixture-schema-positive | snapshot-m0-minimal-nothing-qualified-honest | PASS |  |
| fixture-semantic-positive | snapshot-m0-minimal-nothing-qualified-honest | PASS |  |
| fixture-schema-positive | snapshot-m0-project-identity-error-honest | PASS |  |
| fixture-semantic-positive | snapshot-m0-project-identity-error-honest | PASS |  |
| fixture-schema-positive | snapshot-m0-timeline-frames-observed-nothing-qualified | PASS |  |
| fixture-snapshot-negative | snapshot-m0-timeline-frames-observed-nothing-qualified | PASS | timeline.start_frame: OBSERVED but producing primitive(s) ['GetStartFrame'] not callable in this session; timeline.end_frame: OBSERVED but producing primitive(s) ['GetEndFrame'] not callable in this session |
| fixture-schema-positive | snapshot-m0-track-observed-nothing-qualified | PASS |  |
| fixture-snapshot-negative | snapshot-m0-track-observed-nothing-qualified | PASS | track[video:1].name: OBSERVED but producing primitive(s) ['GetTrackName'] not callable in this session; track[video:1].enabled: OBSERVED but producing primitive(s) ['GetIsTrackEnabled'] not callable in this session; trac |
| fixture-schema-negative | snapshot-missing-ordinal | PASS | oneOf:payload/tracks/0/items/0:{'unique_id': 'it-1', 'name': 'still-001', 'start': 108000, 'end': 108347, 'duration': 347, 'enabled': True, 'markers': [], 'identity_observed': 'COMPLETE', 'field_status': {'unique_id': 'O |
| fixture-schema-negative | snapshot-negative-frame | PASS | oneOf:payload/tracks/0/items/0:{'unique_id': 'it-1', 'observation_ordinal': 0, 'name': 'still-001', 'start': -5, 'end': 108347, 'duration': 347, 'enabled': True, 'markers': [], 'identity_observed': 'COMPLETE', 'field_sta |
| fixture-schema-positive | snapshot-not-requested-with-value | PASS |  |
| fixture-snapshot-negative | snapshot-not-requested-with-value | PASS | item[video:1#0].enabled: status NOT_REQUESTED but value present (fabrication); complete:true under FULL_TIMELINE_READ with unresolved item fields ['enabled'] |
| fixture-schema-positive | snapshot-observed-field-without-callable-primitive | PASS |  |
| fixture-snapshot-negative | snapshot-observed-field-without-callable-primitive | PASS | project.unique_id: OBSERVED but producing primitive(s) ['Project.GetUniqueId'] not callable in this session; project.name: OBSERVED but producing primitive(s) ['Project.GetName'] not callable in this session; timeline.un |
| fixture-schema-positive | snapshot-observed-start-null | PASS |  |
| fixture-snapshot-negative | snapshot-observed-start-null | PASS | item[video:1#0].start: status OBSERVED but value null; canonicalization error: not a numeric quantity: None |
| fixture-schema-positive | snapshot-observed-status-null-value | PASS |  |
| fixture-snapshot-negative | snapshot-observed-status-null-value | PASS | item[video:1#0].unique_id: status OBSERVED but value null |
| fixture-schema-negative | snapshot-postgres-library | PASS | enum:library/db_type:'PostgreSQL' is not one of ['Disk'] |
| fixture-schema-positive | snapshot-project-identity-null-observed | PASS |  |
| fixture-snapshot-negative | snapshot-project-identity-null-observed | PASS | project.unique_id: status OBSERVED but value null |
| fixture-schema-positive | snapshot-project-identity-value-with-unavailable | PASS |  |
| fixture-snapshot-negative | snapshot-project-identity-value-with-unavailable | PASS | project.unique_id: status UNAVAILABLE but value present (fabrication) |
| fixture-schema-positive | snapshot-source-bounds-inverted | PASS |  |
| fixture-snapshot-negative | snapshot-source-bounds-inverted | PASS | item[video:1#0]: source_end < source_start |
| fixture-schema-positive | snapshot-timeline-end-before-start | PASS |  |
| fixture-snapshot-negative | snapshot-timeline-end-before-start | PASS | timeline end_frame < start_frame |
| fixture-schema-positive | snapshot-timeline-identity-null-observed | PASS |  |
| fixture-snapshot-negative | snapshot-timeline-identity-null-observed | PASS | timeline.unique_id: status OBSERVED but value null |
| fixture-schema-negative | snapshot-timeline-missing-field-status | PASS | required:payload/timeline:'field_status' is a required property |
| fixture-schema-positive | snapshot-timeline-settings-unavailable-without-reason | PASS |  |
| fixture-snapshot-negative | snapshot-timeline-settings-unavailable-without-reason | PASS | timeline.settings: status UNAVAILABLE requires a reason |
| fixture-schema-positive | snapshot-timeline-start-frame-null-observed | PASS |  |
| fixture-snapshot-negative | snapshot-timeline-start-frame-null-observed | PASS | timeline.start_frame: status OBSERVED but value null |
| fixture-schema-positive | snapshot-timeline-width-value-with-unavailable | PASS |  |
| fixture-snapshot-negative | snapshot-timeline-width-value-with-unavailable | PASS | timeline.width: status UNAVAILABLE but value present (fabrication); complete:true under FULL_TIMELINE_READ with unresolved timeline fields ['width'] |
| fixture-schema-positive | snapshot-track-lock-value-with-unavailable | PASS |  |
| fixture-snapshot-negative | snapshot-track-lock-value-with-unavailable | PASS | track[video:1].locked: status UNAVAILABLE but value present (fabrication) |
| fixture-schema-positive | snapshot-unavailable-end-with-value | PASS |  |
| fixture-snapshot-negative | snapshot-unavailable-end-with-value | PASS | item[video:1#0].end: status UNAVAILABLE but value present (fabrication); complete:true under FULL_TIMELINE_READ with unresolved item fields ['end'] |
| fixture-schema-positive | snapshot-unavailable-without-reason | PASS |  |
| fixture-snapshot-negative | snapshot-unavailable-without-reason | PASS | item[video:1#0].enabled: status UNAVAILABLE requires a reason; complete:true under FULL_TIMELINE_READ with unresolved item fields ['enabled'] |
| fixture-schema-negative | snapshot-unknown-status-word | PASS | oneOf:payload/tracks/0/items/0:{'unique_id': 'it-1', 'observation_ordinal': 0, 'name': 'still-001', 'start': 108000, 'end': 108347, 'duration': 347, 'enabled': True, 'markers': [], 'identity_observed': 'COMPLETE', 'field |
| fixture-schema-positive | snapshot-write-precheck-complete | PASS |  |
| fixture-semantic-positive | snapshot-write-precheck-complete | PASS |  |
| fixture-schema-positive | snapshot-write-precheck-item-id-unavailable | PASS |  |
| fixture-snapshot-negative | snapshot-write-precheck-item-id-unavailable | PASS | complete:true under WRITE_PRECHECK with unresolved item fields ['unique_id'] |
| fixture-schema-positive | snapshot-write-precheck-missing-guard-domain | PASS |  |
| fixture-snapshot-negative | snapshot-write-precheck-missing-guard-domain | PASS | complete:true but mandatory domains not observed: ['guard'] |
| fixture-schema-positive | snapshot-write-precheck-null-lock | PASS |  |
| fixture-snapshot-negative | snapshot-write-precheck-null-lock | PASS | complete:true under WRITE_PRECHECK with unresolved track locks |
| fixture-schema-positive | snapshot-write-precheck-project-id-unavailable | PASS |  |
| fixture-snapshot-negative | snapshot-write-precheck-project-id-unavailable | PASS | complete:true under WRITE_PRECHECK but project.unique_id not OBSERVED |
| fixture-schema-positive | snapshot-write-precheck-timecode-unavailable | PASS |  |
| fixture-snapshot-negative | snapshot-write-precheck-timecode-unavailable | PASS | complete:true under WRITE_PRECHECK with unresolved timeline fields ['start_timecode'] |
| fixture-schema-negative | target-accepts-open-session | PASS | const:accepts_current_open_session_as_target:False was expected |
| fixture-schema-positive | target-contract-frozen-derived | PASS |  |
| fixture-semantic-positive | target-contract-frozen-derived | PASS |  |
| fixture-schema-negative | target-declared-attachment-state | PASS | additionalProperties::Additional properties are not allowed ('attachment_state' was unexpected) |
| fixture-schema-negative | target-declared-flag-true | PASS | const:attachment_state_is_declared:False was expected |
| fixture-schema-negative | target-empty-host | PASS | minLength:host/name:'' is too short |
| fixture-schema-negative | target-library-is-prohibited | PASS | pattern:library/name:'EKA' does not match '^VIDTOOLZ Resolve Qualification v[0-9]+$' |
| fixture-schema-negative | target-missing-conflict-state | PASS | required:attachment_states:'CONFLICT' is a required property |
| fixture-schema-negative | target-missing-denied-setcurrentdatabase | PASS | contains:denied_calls_all_scopes:['CloseProject', 'ImportProject', 'DeleteTimelines(non-owned)', 'ReplaceClip', 'ReplaceClipPreserveSubClip', 'RelinkClips', 'DeleteClips(ripple=true)', 'run_script', 'run_script_unsafe',  |
| fixture-schema-negative | target-missing-envelope-law | PASS | required::'evidence_envelope_law' is a required property |
| fixture-schema-negative | target-shared-postgres-library | PASS | const:library/kind:'Disk' was expected |
| fixture-schema-positive | verification-append-no-added-item-claims-verified | PASS |  |
| fixture-semantic-negative | verification-append-no-added-item-claims-verified | PASS | verification.missing_expected differs from derived truth (declared [] vs derived ["op-1: APPEND produced no new occurrence on video:1 [110194,110541]"]); verification.verdict differs from derived truth (declared "VERIFIE |
| fixture-schema-positive | verification-append-not-applied-in-journal | PASS |  |
| fixture-semantic-positive | verification-append-not-applied-in-journal | PASS |  |
| fixture-schema-positive | verification-append-on-wrong-track-not-verified | PASS |  |
| fixture-semantic-positive | verification-append-on-wrong-track-not-verified | PASS |  |
| fixture-schema-positive | verification-append-wrong-media-not-verified | PASS |  |
| fixture-semantic-positive | verification-append-wrong-media-not-verified | PASS |  |
| fixture-schema-positive | verification-arbitrary-readback-hash | PASS |  |
| fixture-semantic-negative | verification-arbitrary-readback-hash | PASS | verification S1 digests do not resolve to the supplied S1 snapshot |
| fixture-schema-positive | verification-arbitrary-s1-hash | PASS |  |
| fixture-semantic-negative | verification-arbitrary-s1-hash | PASS | verification S1 digests do not resolve to the supplied S1 snapshot |
| fixture-schema-negative | verification-claims-human-approval | PASS | const:is_human_approval:False was expected |
| fixture-schema-positive | verification-delta-authority-mismatch | PASS |  |
| fixture-semantic-negative | verification-delta-authority-mismatch | PASS | verification expected-delta authority != plan operation set |
| fixture-schema-positive | verification-derived-append-missing | PASS |  |
| fixture-semantic-positive | verification-derived-append-missing | PASS |  |
| fixture-schema-positive | verification-derived-unexpected-delta | PASS |  |
| fixture-semantic-positive | verification-derived-unexpected-delta | PASS |  |
| fixture-schema-positive | verification-derived-verified | PASS |  |
| fixture-semantic-positive | verification-derived-verified | PASS |  |
| fixture-schema-positive | verification-effect-not-specified-claims-verified | PASS |  |
| fixture-semantic-negative | verification-effect-not-specified-claims-verified | PASS | VERIFIED claimed for an operation whose effect law is NOT_YET_SPECIFIED; verification.missing_expected differs from derived truth (declared [] vs derived ["op-2: effect of SET_PROPERTIES NOT_YET_SPECIFIED; cannot verify" |
| fixture-schema-positive | verification-effect-not-specified-derived | PASS |  |
| fixture-semantic-positive | verification-effect-not-specified-derived | PASS |  |
| fixture-schema-positive | verification-hides-unrelated-change | PASS |  |
| fixture-semantic-negative | verification-hides-unrelated-change | PASS | verification.changed differs from derived truth (declared [] vs derived [{"fields":{"enabled":{"after":false,"before":true}},"unique_id":"it-3"}]); verification.unrelated differs from derived truth (declared [] vs derive |
| fixture-schema-negative | verification-missing-applied-ops | PASS | required::'applied_operation_ids' is a required property |
| fixture-schema-positive | verification-other-plan | PASS |  |
| fixture-semantic-negative | verification-other-plan | PASS | verification refers to another plan |
| fixture-schema-positive | verification-other-target | PASS |  |
| fixture-semantic-negative | verification-other-target | PASS | verification refers to another target |
| fixture-schema-positive | verification-other-transaction | PASS |  |
| fixture-semantic-negative | verification-other-transaction | PASS | verification refers to another transaction |
| fixture-schema-positive | verification-s0-hash-not-plan-guard | PASS |  |
| fixture-semantic-negative | verification-s0-hash-not-plan-guard | PASS | verification guard mismatch; verification S0 digests do not resolve to the supplied S0 snapshot |
| fixture-schema-positive | verification-s1-other-epoch | PASS |  |
| fixture-semantic-negative | verification-s1-other-epoch | PASS | lineage: S1 target_epoch differs from S0 |
| fixture-layers | layers present | PASS | {'none': 25, 'schema': 29, 'semantic': 54, 'eligibility': 4, 'snapshot': 42} |
| linked-set-negative | linked-set-append-without-effect-honest-verdict-no-commit | PASS | commit: commit without VERIFIED verification |
| linked-set-negative | linked-set-append-without-effect | PASS | verification: verification.missing_expected differs from derived truth (declared [] vs derived ["op-1: APPEND produced no new occurrence on video:1 [110194,110541]"]); verification: verification.verdict differs from deri |
| linked-set-positive | linked-set-committed-consistent | PASS |  |
| linked-set-negative | linked-set-committed-journal-without-commit | PASS | journal reached COMMITTED without a commit manifest |
| linked-set-negative | linked-set-effect-not-specified-claims-verified | PASS | plan: operation SET_PROPERTIES not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record daa02f04c750 plan_digest='54d49270e89ce7effcd7ac0d66a10b0815c83bbbe009c10f20e07f0acb8d59f6' != '4be88d164ac01e39d448ebe3b8891c3de5 |
| linked-set-negative | linked-set-guard-snapshot-stale | PASS | s0: mutation requires a complete WRITE_PRECHECK snapshot; plan: plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT); lineage: S1 project identity differs from S0; lineage: S0 guard is not th |
| linked-set-positive | linked-set-in-flight-no-s1 | PASS |  |
| linked-set-negative | linked-set-journal-applied-without-started | PASS | journal: seq 4: illegal transition CHECKPOINTED -> APPLIED; journal: seq 4: APPLIED without a preceding OP_STARTED for op-1; commit: journal: seq 4: illegal transition CHECKPOINTED -> APPLIED; commit: journal: seq 4: APP |
| linked-set-negative | linked-set-journal-invented-operation | PASS | journal: seq 5: operation_id op-9 is not in the bound plan operation set (journal invented an operation); journal: seq 5: APPLIED without a preceding OP_STARTED for op-9; journal: seq 6: READBACK_S1 before all plan opera |
| linked-set-negative | linked-set-plan-not-eligible-no-authorization | PASS | s0: project.unique_id: OBSERVED but producing primitive(s) ['Project.GetUniqueId'] not callable in this session; s0: project.name: OBSERVED but producing primitive(s) ['Project.GetName'] not callable in this session; s0: |
| linked-set-negative | linked-set-s0-not-write-precheck | PASS | s0: mutation requires a complete WRITE_PRECHECK snapshot; plan: plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT); lineage: S0 guard is not the plan's h0_guard_digest; verification: verifi |
| linked-set-negative | linked-set-s0-observed-fields-not-callable | PASS | s0: project.unique_id: OBSERVED but producing primitive(s) ['Project.GetUniqueId'] not callable in this session; s0: project.name: OBSERVED but producing primitive(s) ['Project.GetName'] not callable in this session; s0: |
| linked-set-negative | linked-set-s1-arbitrary-hash | PASS | verification: verification S1 digests do not resolve to the supplied S1 snapshot; commit: verification: verification S1 digests do not resolve to the supplied S1 snapshot; commit: verification_result_sha256 does not matc |
| linked-set-negative | linked-set-s1-other-epoch | PASS | lineage: S1 target_epoch differs from S0; verification: lineage: S1 target_epoch differs from S0; commit: verification: lineage: S1 target_epoch differs from S0; commit: commit s1_guard_digest does not match S1; commit:  |
| linked-set-negative | linked-set-schema-invalid-plan | PASS | schema/plan: additionalProperties::Additional properties are not allowed ('target_attachment_state' was unexpected) |
| linked-set-negative | linked-set-unrelated-change-hidden | PASS | verification: verification.changed differs from derived truth (declared [] vs derived [{"fields":{"enabled":{"after":false,"before":true}},"unique_id":"it-3"}]); verification: verification.unrelated differs from derived  |
| linked-set-negative | linked-set-unresolved-conflict | PASS | commit: commit with unresolved conflict |
| linked-set-negative | linked-set-verification-other-plan | PASS | verification: verification refers to another plan; commit: verification: verification refers to another plan; commit: verification_result_sha256 does not match the validated verification object |
| linked-set | commit checker refuses hash-only verification | PASS |  |
| linked-set | linked set without S0 is refused | PASS |  |
| linked-set | plan_digest law: digest of body without refs | PASS |  |
| linked-set | plan_digest changes when an operation changes | PASS |  |
| derived-delta | S0 -> S1 delta derives exactly one added occurrence, nothing removed or changed | PASS |  |
| derived-delta | identical S0/S1 derives an empty delta | PASS |  |
| derived-delta | a property change is derived as changed (enabled before/after) | PASS |  |
| derived-delta | a missing occurrence is derived as removed | PASS |  |
| derived-delta | delta is not derivable when item identity is unobserved (returns None, never guesses) | PASS |  |
| derived-delta | S1 with every occurrence gone derives removals, not an error | PASS |  |
| append-effect | APPEND with the expected new occurrence -> VERIFIED with creation identity mapped | PASS |  |
| append-effect | APPEND with no new occurrence -> EXPECTED_DELTA_MISSING, empty creation map, never VERIFIED | PASS |  |
| append-effect | APPEND plus an unrelated property change -> UNEXPECTED_DELTA | PASS |  |
| append-effect | APPEND whose new occurrence has the wrong media identity is not the expected effect | PASS |  |
| append-effect | APPEND whose new occurrence is at the wrong position/range is not the expected effect | PASS |  |
| append-effect | APPEND not APPLIED in the journal cannot verify | PASS |  |
| append-effect | incomplete S1 -> UNOBSERVABLE_STATE | PASS |  |
| append-effect | expected effect of APPEND is an ADDED_ITEM on the selector track at the planned range | PASS |  |
| append-effect | effects are specified only for APPEND/DELETE/DISABLE/ENABLE/UPSERT_MARKER; others are NOT_YET_SPECIFIED | PASS |  |
| append-effect | declared APPEND+VERIFIED+added:[]+empty creation map is rejected against derived truth | PASS |  |
| s0-s1-resolution | verification whose S1 digests are syntactically valid but do not resolve to the S1 record is rejected | PASS |  |
| s0-s1-resolution | verification whose S0 digests do not resolve to the plan's S0 is rejected | PASS |  |
| s0-s1-resolution | S1 for another target epoch breaks lineage | PASS |  |
| s0-s1-resolution | S0 that is not the plan's H0 breaks lineage | PASS |  |
| journal-membership | journal APPLIED operation ids are derived from records, not declared | PASS |  |
| journal-membership | op-NOT-IN-PLAN is rejected as an invented operation | PASS |  |
| canon-vector | empty_object | PASS |  |
| canon-vector | key_order_codepoint | PASS |  |
| canon-vector | string_escapes | PASS |  |
| canon-vector | integers_and_tagged | PASS |  |
| canon-vector | f64_one_canonical_form_positive_zero | PASS |  |
| canon-vector | numeric_track_index_2_before_10 | PASS |  |
| canon-vector | track_type_order_video_audio_subtitle | PASS |  |
| canon-vector | markers_total_order_A | PASS |  |
| canon-vector | markers_total_order_B_reversed_same_digest | PASS |  |
| canon-vector | permutation_invariance_A | PASS |  |
| canon-vector | permutation_invariance_B_same_digest | PASS |  |
| canon-vector | same_frame_items_deterministic | PASS |  |
| canon-vector | partial_items_status_aware_order_A | PASS |  |
| canon-vector | partial_items_status_aware_order_B_same_digest | PASS |  |
| canon-vector | unobserved_timeline_all_null_with_status | PASS |  |
| canon-vector | nullable_fields_explicit_null | PASS |  |
| canon-invariance | markers_total_order_A == markers_total_order_B_reversed_same_digest | PASS |  |
| canon-invariance | permutation_invariance_A == permutation_invariance_B_same_digest | PASS |  |
| canon-invariance | partial_items_status_aware_order_A == partial_items_status_aware_order_B_same_digest | PASS |  |
| canon-vector | payload domain is v1.4 and guard domain v2 is registered; guard v1 is not | PASS |  |
| canon-vector | a timeline with every field UNAVAILABLE is representable and hashable | PASS |  |
| canon-rejection | f64_trailing_newline | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_leading_space | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_trailing_space | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_trailing_tab | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_leading_tab | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_crlf | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_uppercase | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_mixed_case | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_short | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_fifteen | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_long | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_not_hex | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_prefix_0x | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_unicode_digit | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_empty | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_nonstring | PASS | $f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian) |
| canon-rejection | f64_nan | PASS | $f64 NaN/Infinity rejected |
| canon-rejection | f64_nan_payload | PASS | $f64 NaN/Infinity rejected |
| canon-rejection | f64_infinity | PASS | $f64 NaN/Infinity rejected |
| canon-rejection | f64_negative_infinity | PASS | $f64 NaN/Infinity rejected |
| canon-rejection | f64_negative_zero | PASS | $f64 negative zero must be normalized to 0000000000000000 |
| canon-rejection | rational_unreduced | PASS | $rational must be reduced |
| canon-rejection | rational_zero_denominator | PASS | $rational must fully match (0/[1-9][0-9]*)/([1-9][0-9]*) with no surrounding whitespace |
| canon-rejection | rational_negative | PASS | $rational must fully match (0/[1-9][0-9]*)/([1-9][0-9]*) with no surrounding whitespace |
| canon-rejection | rational_trailing_newline | PASS | $rational must fully match (0/[1-9][0-9]*)/([1-9][0-9]*) with no surrounding whitespace |
| canon-rejection | rational_leading_space | PASS | $rational must fully match (0/[1-9][0-9]*)/([1-9][0-9]*) with no surrounding whitespace |
| canon-rejection | rational_leading_zero | PASS | $rational must fully match (0/[1-9][0-9]*)/([1-9][0-9]*) with no surrounding whitespace |
| canon-rejection | bare_float | PASS | bare float forbidden; use {'$rational':'p/q'} or {'$f64':'hex16'} |
| canon-rejection | marker_exact_duplicate | PASS | MARKER_COLLISION: two markers share (object_address, frame) |
| canon-rejection | marker_same_object_frame_different_note | PASS | MARKER_COLLISION: two markers share (object_address, frame) |
| canon-rejection | string_track_index | PASS | track index must be integer >= 1, got '2' |
| canon-rejection | duplicate_track_address | PASS | duplicate (type,index) track address |
| canon-rejection | unregistered_domain | PASS | unregistered hash domain 'vidtoolz.unregistered' |
| canon-rejection | unregistered_domain_old_guard_v1 | PASS | unregistered hash domain 'vidtoolz.resolveGuard.v1' |
| canon-rejection | items_missing_ordinal | PASS | item.observation_ordinal (position in GetItemListInTrack) is required for total ordering |
| canon-rejection | items_duplicate_ordinal | PASS | two items share the full sort key: identity collision |
| canon-rejection | items_observed_end_null_in_sort | PASS | not a numeric quantity: None |
| f64-exact | fullmatch semantics used | PASS |  |
| f64-exact | valid canonical value accepted | PASS |  |
| f64-exact | one bit pattern one text (uppercase rejected, -0 rejected, whitespace rejected) | PASS |  |
| eligibility-request-schema | m0-probe-allow-attachment-ready | PASS | request schema-valid=True |
| eligibility | m0-probe-allow-attachment-ready | PASS | eligible=True state=ATTACHMENT_READY tr=SESSION failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-probe-deny-unprovisioned | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-unprovisioned | PASS | eligible=False state=UNPROVISIONED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no valid PROVISIONING_RECORD for contract host/library (Disk, uuid, absolute root, provisioned_by, en |
| eligibility-request-schema | m0-probe-deny-provisioned-not-verified | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-provisioned-not-verified | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host; no |
| eligibility-request-schema | m0-probe-deny-launch-wrong-binary | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-launch-wrong-binary | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no LAUNCH_RECIPE for the current session bound to this provisioning record, contract versi |
| eligibility-request-schema | m0-probe-deny-self-verified-bundle | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-self-verified-bundle | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host)']  |
| eligibility-request-schema | m0-probe-deny-bundle-other-host | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-bundle-other-host | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host)']  |
| eligibility-request-schema | m0-probe-deny-bundle-historical-only | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-bundle-historical-only | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host)']  |
| eligibility-request-schema | m0-probe-deny-no-current-session | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-no-current-session | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no current_session_id)'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-probe-deny-launch-previous-session-only | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-launch-previous-session-only | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no LAUNCH_RECIPE for the current session bound to this provisioning record, contract versi |
| eligibility-request-schema | m0-probe-deny-no-read-only-journal-ref | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-no-read-only-journal-ref | PASS | eligible=False state=ATTACHMENT_READY tr=SESSION failed=['READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: reference is not a sha256 (None))'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-probe-deny-declared-state-ignored | PASS | request schema-valid=False |
| eligibility | m0-probe-deny-declared-state-ignored | PASS | eligible=False state=UNPROVISIONED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no valid PROVISIONING_RECORD for contract host/library (Disk, uuid, absolute root, provisioned_by, en |
| eligibility-request-schema | m0-probe-deny-tampered-record | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-tampered-record | PASS | eligible=False state=CONFLICT tr=None failed=[] codes=['ATTACHMENT_CONFLICT', 'EVIDENCE_SET_INVALID'] |
| eligibility-request-schema | m0-probe-deny-provisioning-without-root | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-provisioning-without-root | PASS | eligible=False state=CONFLICT tr=None failed=[] codes=['ATTACHMENT_CONFLICT', 'EVIDENCE_SET_INVALID'] |
| eligibility-request-schema | m0-probe-deny-wrong-manifest-record | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-wrong-manifest-record | PASS | eligible=False state=CONFLICT tr=None failed=[] codes=['ATTACHMENT_CONFLICT', 'EVIDENCE_SET_INVALID'] |
| eligibility-request-schema | m0-probe-deny-other-authority-record | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-other-authority-record | PASS | eligible=False state=CONFLICT tr=None failed=[] codes=['ATTACHMENT_CONFLICT', 'EVIDENCE_SET_INVALID'] |
| eligibility-request-schema | m0-probe-deny-bundle-other-manifest-not-historical | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-bundle-other-manifest-not-historical | PASS | eligible=False state=CONFLICT tr=None failed=[] codes=['ATTACHMENT_CONFLICT', 'EVIDENCE_SET_INVALID'] |
| eligibility-request-schema | m0-probe-deny-fatal-probe-failure-in-session | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-fatal-probe-failure-in-session | PASS | eligible=False state=CONFLICT tr=None failed=[] codes=['ATTACHMENT_CONFLICT', 'FATAL_TARGET_FAILURE recorded in the current session: WRONG_LIBRARY'] |
| eligibility-request-schema | m0-probe-allow-after-capability-failure-only | PASS | request schema-valid=True |
| eligibility | m0-probe-allow-after-capability-failure-only | PASS | eligible=True state=ATTACHED_READ_ONLY tr=SESSION failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-snapshot-allow-degraded-attached | PASS | request schema-valid=True |
| eligibility | m0-snapshot-allow-degraded-attached | PASS | eligible=True state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-snapshot-allow-reversed-record-order | PASS | request schema-valid=True |
| eligibility | m0-snapshot-allow-reversed-record-order | PASS | eligible=True state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-snapshot-deny-attachment-ready-only | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-attachment-ready-only | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=['TARGET_STATE_ATTACHED_READ_ONLY (no CONNECTION_OBSERVATION in the current session)', 'RESOLVE_VERSION_MATCHES'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-snapshot-deny-stale-good-current-eka | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-stale-good-current-eka | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=["TARGET_STATE_ATTACHED_READ_ONLY (OBSERVED_TARGET_MISMATCH: observed db_type PostgreSQL is not Disk; observed database 'EKA' != contract library; observed |
| eligibility-request-schema | m0-snapshot-allow-current-good-stale-eka | PASS | request schema-valid=True |
| eligibility | m0-snapshot-allow-current-good-stale-eka | PASS | eligible=True state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-snapshot-deny-duplicate-sequence-conflict | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-duplicate-sequence-conflict | PASS | eligible=False state=CONFLICT tr=None failed=[] codes=['ATTACHMENT_CONFLICT', 'two CONNECTION_OBSERVATIONs share the highest sequence in the current session'] |
| eligibility-request-schema | m0-snapshot-allow-duplicate-timestamp-distinct-sequence | PASS | request schema-valid=True |
| eligibility | m0-snapshot-allow-duplicate-timestamp-distinct-sequence | PASS | eligible=True state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-snapshot-deny-connection-previous-session-only | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-connection-previous-session-only | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=['TARGET_STATE_ATTACHED_READ_ONLY (no CONNECTION_OBSERVATION in the current session)', 'RESOLVE_VERSION_MATCHES'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-snapshot-deny-ancient-observation | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-ancient-observation | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=['TARGET_STATE_ATTACHED_READ_ONLY (latest CONNECTION_OBSERVATION is STALE)', 'RESOLVE_VERSION_MATCHES'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-snapshot-deny-sequence-timestamp-disorder | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-sequence-timestamp-disorder | PASS | eligible=False state=CONFLICT tr=None failed=[] codes=['ATTACHMENT_CONFLICT', 'CONNECTION_OBSERVATION: captured_at decreases while sequence increases'] |
| eligibility-request-schema | m0-snapshot-deny-missing-root-in-connection | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-missing-root-in-connection | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=['TARGET_STATE_ATTACHED_READ_ONLY (OBSERVED_TARGET_MISMATCH: observed library root differs from provisioning record (or missing))', 'LIBRARY_MATCHES_CONTRA |
| eligibility-request-schema | m0-snapshot-deny-changed-uuid-in-connection | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-changed-uuid-in-connection | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=['TARGET_STATE_ATTACHED_READ_ONLY (OBSERVED_TARGET_MISMATCH: observed library uuid differs from provisioning record (or missing))', 'LIBRARY_MATCHES_CONTRA |
| eligibility-request-schema | m0-snapshot-deny-second-provisioning-other-uuid | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-second-provisioning-other-uuid | PASS | eligible=False state=CONFLICT tr=None failed=[] codes=['ATTACHMENT_CONFLICT', 'multiple PROVISIONING_RECORDs with different uuid/root for the contract library'] |
| eligibility-request-schema | m0-snapshot-deny-cross-library-timeline-binding | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-cross-library-timeline-binding | PASS | eligible=False state=CONFLICT tr=None failed=[] codes=['ATTACHMENT_CONFLICT', 'library_name'] |
| eligibility-request-schema | m0-snapshot-deny-binding-from-other-session | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-binding-from-other-session | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["TARGET_REQUIREMENT_SATISFIED (no CURRENT PROJECT_BINDING_OBSERVATION for expected project 'VIDTOOLZ_RESOLVE_QUAL_V1_FIXTURE' in the current session (NO |
| eligibility-request-schema | m0-snapshot-deny-no-timeline-binding | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-no-timeline-binding | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["TARGET_REQUIREMENT_SATISFIED (no CURRENT TIMELINE_BINDING_OBSERVATION for 'VIDTOOLZ_RESOLVE_QUAL_V1_FIXTURE'/'VIDTOOLZ__other__r1' in the current sessi |
| eligibility-request-schema | m0-snapshot-deny-no-expected-timeline | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-no-expected-timeline | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['TARGET_REQUIREMENT_SATISFIED (target requirement PROJECT_TIMELINE: expected_timeline_name missing)', 'TARGET_REQUIREMENT_SATISFIED (target requirement  |
| eligibility-request-schema | m0-snapshot-deny-no-expected-project | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-no-expected-project | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['TARGET_REQUIREMENT_SATISFIED (target requirement PROJECT: expected_project_name missing)', 'TARGET_REQUIREMENT_SATISFIED (target requirement PROJECT: e |
| eligibility-request-schema | m0-snapshot-deny-unbound-project-name | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-unbound-project-name | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["TARGET_REQUIREMENT_SATISFIED (no CURRENT PROJECT_BINDING_OBSERVATION for expected project 'VIDTOOLZ_RESOLVE_QUAL_V1_GHOST' in the current session (NONE |
| eligibility-request-schema | m0-enumerate-timelines-deny-human-project-without-operator-record | PASS | request schema-valid=True |
| eligibility | m0-enumerate-timelines-deny-human-project-without-operator-record | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT failed=["TARGET_REQUIREMENT_SATISFIED (project 'PYSTY UHD' is neither adapter-prefixed nor operator-provisioned in the contract library)", "TARGET_REQUIREMENT_SATISFIED  |
| eligibility-request-schema | m0-enumerate-timelines-allow-operator-provisioned-project | PASS | request schema-valid=True |
| eligibility | m0-enumerate-timelines-allow-operator-provisioned-project | PASS | eligible=True state=ATTACHED_READ_ONLY tr=PROJECT failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-enumerate-projects-allow-session-scope-no-project | PASS | request schema-valid=True |
| eligibility | m0-enumerate-projects-allow-session-scope-no-project | PASS | eligible=True state=ATTACHED_READ_ONLY tr=SESSION failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-enumerate-projects-allow-without-any-binding-records | PASS | request schema-valid=True |
| eligibility | m0-enumerate-projects-allow-without-any-binding-records | PASS | eligible=True state=ATTACHED_READ_ONLY tr=SESSION failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-enumerate-timelines-deny-no-project | PASS | request schema-valid=True |
| eligibility | m0-enumerate-timelines-deny-no-project | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT failed=['TARGET_REQUIREMENT_SATISFIED (target requirement PROJECT: expected_project_name missing)', 'TARGET_REQUIREMENT_SATISFIED (target requirement PROJECT: expected_p |
| eligibility-request-schema | m0-snapshot-deny-eka-observed | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-eka-observed | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=["TARGET_STATE_ATTACHED_READ_ONLY (OBSERVED_TARGET_MISMATCH: observed db_type PostgreSQL is not Disk; observed database 'EKA' != contract library; observed |
| eligibility-request-schema | m0-snapshot-deny-local-database-observed | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-local-database-observed | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=["TARGET_STATE_ATTACHED_READ_ONLY (OBSERVED_TARGET_MISMATCH: observed database 'Local Database' != contract library; observed database is a prohibited (sha |
| eligibility-request-schema | m0-snapshot-deny-version-mismatch | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-version-mismatch | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=['TARGET_STATE_ATTACHED_READ_ONLY (OBSERVED_TARGET_MISMATCH: observed product/version DaVinci Resolve Studio 21.0.3.0007 != contract)', 'LIBRARY_MATCHES_CO |
| eligibility-request-schema | m0-connect-deny-refuse-fallback-no-qualified-rows | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-refuse-fallback-no-qualified-rows | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-qualified-read-string-ignored | PASS | request schema-valid=False |
| eligibility | m0-connect-deny-qualified-read-string-ignored | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-reviewed-evidence-but-matrix-not-refrozen | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-reviewed-evidence-but-matrix-not-refrozen | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-allow-hypothetical-refrozen-matrix | PASS | request schema-valid=True |
| eligibility | m0-connect-allow-hypothetical-refrozen-matrix | PASS | eligible=True state=ATTACHED_READ_ONLY tr=SESSION failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-connect-deny-hyp-unreviewed-candidates | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-unreviewed-candidates | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-failed-getters | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-failed-getters | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-wrong-build | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-wrong-build | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-old-refreeze | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-old-refreeze | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-old-authority | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-old-authority | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-no-raw-evidence | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-no-raw-evidence | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-raw-tampered | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-raw-tampered | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-wrong-receiver | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-wrong-receiver | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-no-linked-evidence | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-no-linked-evidence | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-deny-write-op | PASS | request schema-valid=True |
| eligibility | m0-deny-write-op | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:no explicit entry (default DENY)'] |
| eligibility-request-schema | m0-deny-ref-empty-string | PASS | request schema-valid=False |
| eligibility | m0-deny-ref-empty-string | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: reference is not a sha256 (''))"] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-deny-ref-false-string | PASS | request schema-valid=False |
| eligibility | m0-deny-ref-false-string | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: reference is not a sha256 ('false'))"] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-deny-ref-unlinked-sha | PASS | request schema-valid=True |
| eligibility | m0-deny-ref-unlinked-sha | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: referenced record 999999999999 not in evidence set)'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-deny-ref-wrong-record-type | PASS | request schema-valid=True |
| eligibility | m0-deny-ref-wrong-record-type | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: record 2f4b66121803 has type CONNECTION_OBSERVATION)'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m2-set-current-timeline-deny-production-project-name | PASS | request schema-valid=True |
| eligibility | m2-set-current-timeline-deny-production-project-name | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=['PROJECT_ADAPTER_PREFIXED', "TARGET_REQUIREMENT_SATISFIED (project 'PYSTY UHD' is neither adapter-prefixed nor operator-provisioned in the contract lib |
| eligibility-request-schema | m2-set-current-timeline-allow | PASS | request schema-valid=True |
| eligibility | m2-set-current-timeline-allow | PASS | eligible=True state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m3-append-deny-without-authorization | PASS | request schema-valid=True |
| eligibility | m3-append-deny-without-authorization | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: reference is not a sha256 (None))', 'TARGET_STATE_SCRATCH_WRITE_READY (no M3_AUTHORIZATION for scratch scope  |
| eligibility-request-schema | m3-append-deny-authorization-old-authority | PASS | request schema-valid=True |
| eligibility | m3-append-deny-authorization-old-authority | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: referenced record 005a947383dc not in evidence set)', 'TARGET_STATE_SCRATCH_WRITE_READY (no M3_AUTHORIZATION  |
| eligibility-request-schema | m3-append-deny-refreeze-unreviewed | PASS | request schema-valid=True |
| eligibility | m3-append-deny-refreeze-unreviewed | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['TARGET_STATE_SCRATCH_WRITE_READY (no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix)', 'JOURNAL_PREPARED (JOURNAL_PR |
| eligibility-request-schema | m3-append-deny-refreeze-for-other-matrix | PASS | request schema-valid=True |
| eligibility | m3-append-deny-refreeze-for-other-matrix | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['TARGET_STATE_SCRATCH_WRITE_READY (no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix)', 'JOURNAL_PREPARED (JOURNAL_PR |
| eligibility-request-schema | m3-append-deny-no-journal-guard-plan-records | PASS | request schema-valid=True |
| eligibility | m3-append-deny-no-journal-guard-plan-records | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=['JOURNAL_PREPARED (JOURNAL_PREPARED: reference is not a sha256 (None))', 'PLAN_VALIDATED (PLAN_VALIDATION: reference is not a sha256 (None))'] codes=[' |
| eligibility-request-schema | m3-save-deny-ids-unavailable | PASS | request schema-valid=True |
| eligibility | m3-save-deny-ids-unavailable | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT failed=['M2_EXIT_EVIDENCE (MILESTONE_EXIT: referenced record 402642d6755d not in evidence set)', 'MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: referenced record 005a947383d |
| eligibility-request-schema | m3-deny-shared-library-scope | PASS | request schema-valid=True |
| eligibility | m3-deny-shared-library-scope | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:unknown milestone or scope'] |
| eligibility-request-schema | m4-deny-unknown-milestone | PASS | request schema-valid=True |
| eligibility | m4-deny-unknown-milestone | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:unknown milestone or scope'] |
| eligibility-request-schema | deny-unknown-operation | PASS | request schema-valid=True |
| eligibility | deny-unknown-operation | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:no explicit entry (default DENY)'] |
| eligibility-invariant | allowed_true_is_not_eligibility | PASS |  |
| eligibility-invariant | declared attachment_state in request is ignored | PASS |  |
| eligibility-invariant | capabilities argument is consumed (hypothetical matrix flips CONNECT; frozen matrix does not) | PASS |  |
| eligibility-invariant | active authority argument is consumed (hypothetical matrix under the frozen matrix sha does not flip CONNECT) | PASS |  |
| eligibility-invariant | probe expands only probe_allowed primitives (no QUALIFIED_CALLABLE needed) | PASS |  |
| eligibility-invariant | CONFLICT short-circuits: nothing is eligible and the conflicts are reported | PASS |  |
| eligibility-invariant | operation-specific attachment: ENUMERATE_PROJECTS needs no project binding while SNAPSHOT_CAPTURE needs project+timeline | PASS |  |
| permission-invariant | no_mutation_before_M3 | PASS |  |
| permission-invariant | every_M3_mutation_requires_authorization_and_write_ready | PASS |  |
| permission-invariant | no_shared_library_grant | PASS |  |
| permission-invariant | default_deny | PASS |  |
| permission-invariant | every_entry_has_prerequisites_and_target_requirement | PASS |  |
| permission-invariant | probe entry carries PROBE_ALLOWED_PRIMITIVES | PASS |  |
| permission-invariant | no non-probe entry carries PROBE_ALLOWED_PRIMITIVES | PASS |  |
| permission-invariant | CONNECT/ENUMERATE_PROJECTS/probe are SESSION; ENUMERATE_TIMELINES is PROJECT; SNAPSHOT_CAPTURE is PROJECT_TIMELINE | PASS |  |
| permission-invariant | prerequisite_codes == library set | PASS |  |
| order-independence | eligibility: 74 cases x 4 evidence/request permutations give identical decisions | PASS | 296 permutations |
| order-independence | attachment: 54 evidence sets x 4 record-map permutations give identical derivations (state, proofs, failures, conflicts) | PASS |  |
| order-independence | snapshots: every snapshot fixture x 4 track/item/marker/ledger permutations keeps payload digest, guard digest and semantic result | PASS | 24 permutations |
| order-independence | linked sets: 18 sets x 4 permutations of evidence map, conflicts, snapshot arrays and key order give identical validation | PASS |  |
| order-independence | two current-sequence contradictions stay CONFLICT in both input orders (no record[-1] shortcut) | PASS |  |
| order-independence | stale-good/current-bad decides by sequence in both input orders (current EKA wins -> not attached) | PASS |  |
| order-independence | lib never selects evidence by position (array tail only on the ordered journal chain) | PASS | journal,journal_records |
| v1.3-attack | wrong manifest accepted | PASS |  |
| v1.3-attack | v1.3 manifest used as current qualification authority | PASS |  |
| v1.3-attack | verification for another authority version | PASS |  |
| v1.3-attack | other-host verification | PASS |  |
| v1.3-attack | EKA timeline mixed with qualification library | PASS |  |
| v1.3-attack | UUID mismatch | PASS |  |
| v1.3-attack | missing connection root | PASS |  |
| v1.3-attack | stale/current contradiction | PASS |  |
| v1.3-attack | failed getter evidence | PASS |  |
| v1.3-attack | old refreeze evidence | PASS |  |
| v1.3-attack | unreviewed candidate evidence | PASS |  |
| v1.3-attack | unplanned journal operation | PASS |  |
| v1.3-attack | APPEND verified with no created item | PASS |  |
| v1.3-attack | arbitrary S1 hashes | PASS |  |
| v1.3-attack | declared attachment/capability state in the request | PASS |  |
| v1.3-attack | snapshot claims OBSERVED fields nothing can produce | PASS |  |
| milestone-matrix | M0 read ops match PERMISSIONS | PASS |  |
| milestone-matrix | M0 mutation ops match PERMISSIONS | PASS |  |
| milestone-matrix | M0 target requirements match PERMISSIONS | PASS |  |
| milestone-matrix | M1 read ops match PERMISSIONS | PASS |  |
| milestone-matrix | M1 mutation ops match PERMISSIONS | PASS |  |
| milestone-matrix | M1 target requirements match PERMISSIONS | PASS |  |
| milestone-matrix | M2 read ops match PERMISSIONS | PASS |  |
| milestone-matrix | M2 mutation ops match PERMISSIONS | PASS |  |
| milestone-matrix | M2 target requirements match PERMISSIONS | PASS |  |
| milestone-matrix | M3 read ops match PERMISSIONS | PASS |  |
| milestone-matrix | M3 mutation ops match PERMISSIONS | PASS |  |
| milestone-matrix | M3 target requirements match PERMISSIONS | PASS |  |
| milestone-matrix | M0 has no mutation ops | PASS |  |
| milestone-matrix | M1 has no mutation ops | PASS |  |
| milestone-matrix | M2 has no mutation ops | PASS |  |
| milestone-matrix | M3 is the only mutation milestone | PASS |  |
| milestone-matrix | EKA not a scope anywhere | PASS |  |
| m3-probe-permission | P1 | PASS |  |
| m3-probe-permission | P2 | PASS |  |
| m3-probe-permission | P3 | PASS |  |
| m3-probe-permission | P4 | PASS |  |
| m3-probe-permission | P5 | PASS |  |
| m3-probe-permission | P6 | PASS |  |
| m3-probe-permission | P7 | PASS |  |
| m3-probe-permission | P8 | PASS |  |
| m3-probe-permission | P9 | PASS |  |
| m3-probe-permission | P10 | PASS |  |
| m3-probe-permission | P11 | PASS |  |
| m3-probe-permission | P12 | PASS |  |
| m3-probe-permission | P13 | PASS |  |
| m3-probe-permission | P14 | PASS |  |
| m3-probe-permission | P15 | PASS |  |
| m3-probe-permission | P16 | PASS |  |
| m3-probe-permission | P17 | PASS |  |
| m3-probe-permission | P18 | PASS |  |
| m3-probe-permission | P19 | PASS |  |
| m3-probe-count | 19 probes P1..P19; P0 is M0 preflight | PASS |  |
| m3-probe-count | M3-MATRIX.md rows match M3-PROBES.json ids | PASS |  |
| m3-probe | P15 claims no rename (no rename operation exists) | PASS |  |
| precedence | README.md classified | PASS |  |
| precedence | AUTHORIZATION-2026-09-08.md classified | PASS |  |
| precedence | DOCTRINE.md classified | PASS |  |
| precedence | TRANSPORT.md classified | PASS |  |
| precedence | ELIGIBILITY.md classified | PASS |  |
| precedence | TARGET-ATTACHMENT-GATE.md classified | PASS |  |
| precedence | SNAPSHOT-COMPLETENESS.md classified | PASS |  |
| precedence | GUARD-AUTHORITY.md classified | PASS |  |
| precedence | CANONICALIZATION.md classified | PASS |  |
| precedence | IDENTITY-BINDING.md classified | PASS |  |
| precedence | SNAPSHOT-CONCURRENCY-RECOVERY.md classified | PASS |  |
| precedence | DRIFT-POLICY.md classified | PASS |  |
| precedence | REVIEW-MARKER-POLICY.md classified | PASS |  |
| precedence | SEMANTIC-VALIDATION.md classified | PASS |  |
| precedence | CANARIES.md classified | PASS |  |
| precedence | MILESTONES.md classified | PASS |  |
| precedence | M3-MATRIX.md classified | PASS |  |
| precedence | SCORECRAFT-EXTRACTION.md classified | PASS |  |
| precedence | CLIENT-VERSION-INVENTORY.md classified | PASS |  |
| precedence | PROVISIONAL.md classified | PASS |  |
| precedence | AUTHORITY-PRECEDENCE.md classified | PASS |  |
| precedence | M0-PROBE-CONTRACT.md classified | PASS |  |
| precedence | CHANGELOG-v1.4.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.4.md classified | PASS |  |
| precedence | CHANGELOG-v1.3.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.3.md classified | PASS |  |
| precedence | CHANGELOG-v1.2.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.2.md classified | PASS |  |
| precedence | VALIDATION-REPORT.md classified | PASS |  |
| precedence | CHANGELOG-v1.1.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX.md classified | PASS |  |
| precedence | ADJUDICATION-FREEZE-CONTRACT.md classified | PASS |  |
| precedence | AUTHORITY-ARCHITECTURE-ADJUDICATION-M0-M3.md classified | PASS |  |
| precedence-retired-terms | AUTHORIZATION-2026-09-08.md | PASS |  |
| precedence-retired-terms | CANARIES.md | PASS |  |
| precedence-retired-terms | CLIENT-VERSION-INVENTORY.md | PASS |  |
| precedence-retired-terms | DOCTRINE.md | PASS |  |
| precedence-retired-terms | IDENTITY-BINDING.md | PASS |  |
| precedence-retired-terms | M0-PROBE-CONTRACT.md | PASS |  |
| precedence-retired-terms | M3-MATRIX.md | PASS |  |
| precedence-retired-terms | MILESTONES.md | PASS |  |
| precedence-retired-terms | README.md | PASS |  |
| precedence-retired-terms | REVIEW-MARKER-POLICY.md | PASS |  |
| precedence-retired-terms | SEMANTIC-VALIDATION.md | PASS |  |
| precedence-retired-terms | SNAPSHOT-COMPLETENESS.md | PASS |  |
| precedence-retired-terms | TARGET-ATTACHMENT-GATE.md | PASS |  |
| precedence-retired-terms | TRANSPORT.md | PASS |  |
| precedence | every top-level document has an entry | PASS |  |
| precedence-supersession | S1 | PASS |  |
| precedence-supersession | S2 | PASS |  |
| precedence-supersession | S3 | PASS |  |
| precedence-supersession | S4 | PASS |  |
| precedence-supersession | S5 | PASS |  |
| precedence-supersession | S6 | PASS |  |
| precedence-supersession | S7 | PASS |  |
| precedence-supersession | S8 | PASS |  |
| precedence-supersession | S9 | PASS |  |
| precedence-supersession | S10 | PASS |  |
| precedence-supersession | S11 | PASS |  |
| precedence-supersession | S12 | PASS |  |
| precedence-supersession | S13 | PASS |  |
| precedence-supersession | S14 | PASS |  |
| precedence-supersession | S15 | PASS |  |
| precedence-supersession | S16 | PASS |  |
| precedence-supersession | S17 | PASS |  |
| precedence-supersession | S18 | PASS |  |
| precedence-supersession | S19 | PASS |  |
| precedence-supersession | S20 | PASS |  |
| precedence-supersession | S21 | PASS |  |
| precedence-supersession | S22 | PASS |  |
| precedence-supersession | S23 | PASS |  |
| precedence-supersession | S24 | PASS |  |
| precedence | v1.4 supersessions present | PASS |  |
| precedence | v1.3 changelog and finding matrix are HISTORICAL; v1.4 ones are active | PASS |  |
| precedence | SCORECRAFT-EXTRACTION.md cites v1.4 active schemas, not v1.1/v1.3 | PASS |  |
| timebase | canary_boundaries_ceil_law | PASS |  |
| timebase | canary_total_6756 | PASS |  |
| timebase | half_up_gives_6755 | PASS |  |
| guard | payload_equal_but_guard_differs (same payload, different project) | PASS |  |
| guard | UNAVAILABLE != ERROR project identity produces different guards over an identical payload | PASS |  |
| guard | full-read-degraded-start-frame guard object validates against resolveGuard v2 | PASS |  |
| guard | full-read-degraded-start-frame digests recompute | PASS |  |
| guard | full-read-degraded-start-frame guard carries identity observation status and reason | PASS |  |
| guard | full-read-partial-item-ledger guard object validates against resolveGuard v2 | PASS |  |
| guard | full-read-partial-item-ledger digests recompute | PASS |  |
| guard | full-read-partial-item-ledger guard carries identity observation status and reason | PASS |  |
| guard | human-timeline-mixed-provenance guard object validates against resolveGuard v2 | PASS |  |
| guard | human-timeline-mixed-provenance digests recompute | PASS |  |
| guard | human-timeline-mixed-provenance guard carries identity observation status and reason | PASS |  |
| guard | m0-minimal-nothing-qualified guard object validates against resolveGuard v2 | PASS |  |
| guard | m0-minimal-nothing-qualified digests recompute | PASS |  |
| guard | m0-minimal-nothing-qualified guard carries identity observation status and reason | PASS |  |
| guard | write-precheck-complete guard object validates against resolveGuard v2 | PASS |  |
| guard | write-precheck-complete digests recompute | PASS |  |
| guard | write-precheck-complete guard carries identity observation status and reason | PASS |  |
| guard | write-precheck-s1-after-append guard object validates against resolveGuard v2 | PASS |  |
| guard | write-precheck-s1-after-append digests recompute | PASS |  |
| guard | write-precheck-s1-after-append guard carries identity observation status and reason | PASS |  |
| degraded-snapshot | pre-qualification capture: every timeline/project field UNAVAILABLE with reason, no tracks, complete:false | PASS |  |
| degraded-snapshot | pre-qualification capture classifies as INCOMPLETE_NOT_QUALIFIED and is schema-valid | PASS |  |
| degraded-snapshot | pre-qualification capture is canonical and hashable (no crash on all-null timeline) | PASS |  |
| degraded-snapshot | partial item kept in canonical list with null end and ERROR status (not omitted, not invented) | PASS |  |
| degraded-snapshot | enumeration failure recorded in the ledger and forces complete:false | PASS |  |
| degraded-snapshot | GetStartFrame unavailable -> start_frame null, status UNAVAILABLE + reason, complete:false, reason recorded | PASS |  |
| degraded-snapshot | degraded timeline snapshot passes the semantic layer under the matching (reduced) callable set | PASS |  |
| degraded-snapshot | degraded snapshot's guard differs from the complete snapshot's guard (coverage is in the guard) | PASS |  |
| degraded-snapshot | a WRITE_PRECHECK snapshot with an UNSUPPORTED start_timecode can only be incomplete | PASS |  |
| exact-manifest | real manifest sha differs from the fixture placeholder | PASS |  |
| exact-manifest | placeholder-bound fixture evidence does not derive against the real manifest (CONFLICT: not bound to active manifest) | PASS |  |
| exact-manifest | placeholder-bound evidence makes the probe ineligible under the real manifest | PASS |  |
| exact-manifest | evidence re-minted against the real manifest derives ATTACHMENT_READY / ATTACHED_READ_ONLY | PASS |  |
| exact-manifest | probe eligible on re-minted ready evidence; SNAPSHOT_CAPTURE eligible (degraded) on re-minted attached evidence | PASS |  |
| exact-manifest | re-minted evidence is structurally valid against the real manifest | PASS |  |
| exact-manifest | arbitrary 64-hex manifest sha is rejected (CONFLICT) | PASS |  |
| exact-manifest | v1.3 manifest / authority 1.3.0 evidence is rejected as current authority (CONFLICT) | PASS |  |
| exact-manifest | a historical v1.3 verification alongside the real one is tolerated but never the proof | PASS |  |
| exact-manifest | real-manifest verification for another host does not count | PASS |  |
| exact-manifest | real-manifest verification claiming another authority version does not count | PASS |  |
| exact-manifest | self-verified real-manifest bundle does not count | PASS |  |
| manifest | parent manifest sha pinned | PASS |  |
| manifest | schema | PASS |  |
| manifest | semantic (hashes, byte counts, lineage, inheritance flags) | PASS |  |
| manifest | every file on disk is listed | PASS |  |
| manifest | no listed file missing on disk | PASS | VALIDATION-REPORT.md |
| manifest | validation tools listed as TOOL | PASS |  |
| manifest-negative | invalid status | PASS |  |
| manifest-negative | duplicate path | PASS |  |
| manifest-negative | missing hash | PASS |  |
| manifest-negative | malformed hash | PASS |  |
| manifest-negative | unknown authority classification | PASS |  |
| manifest-negative | broken parent lineage | PASS |  |
| manifest-negative | parent manifest sha changed | PASS |  |
| manifest-negative | changed file marked inherited | PASS |  |
| manifest-negative | bytes +1 | PASS |  |
| manifest-negative | bytes -1 | PASS |  |
| manifest-negative | bytes zero | PASS |  |
| manifest-negative | wrong size with correct sha | PASS |  |
| manifest-negative | correct size with wrong sha | PASS |  |
| manifest-negative | negative bytes | PASS |  |
| manifest-negative | bytes as string | PASS |  |
| manifest-positive | actual bytes equal on disk for every file | PASS |  |
| determinism | vectors_rerun_identical | PASS |  |
| determinism | evidence record ids recompute | PASS |  |
| determinism | no_bytecode_cache_written | PASS |  |
