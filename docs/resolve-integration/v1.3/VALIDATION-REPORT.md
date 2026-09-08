# VALIDATION REPORT — Resolve authority bundle v1.3

Result: **686/686 checks passed**. Layers: raw parse (strict duplicate-key rejection) -> schema (Draft 2020-12) -> semantic (reference rules) -> eligibility (evidence-derived evaluate_eligibility) -> linked-set (validate_transaction_set). Every layered fixture records its expected failure layer; a check that raises is a FAIL. Offline; no Resolve. Node conformance = M1. SCHEMA-VALID != AUTHORIZED TO MUTATE; passing proves internal consistency of the authority documents only.

Layered fixture layers: {"eligibility": 5, "none": 16, "schema": 38, "semantic": 77}

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
| frozen-instance | CAPABILITIES has zero QUALIFIED_READ rows in v1.3 | PASS |  |
| frozen-instance | every read row is probe_candidate | PASS |  |
| evidence-set-schema | attached-candidate-evidence-unreviewed | PASS |  |
| evidence-set-structural | attached-candidate-evidence-unreviewed | PASS |  |
| evidence-set-schema | attached-eka-observed | PASS |  |
| evidence-set-structural | attached-eka-observed | PASS |  |
| evidence-set-schema | attached-evidence-wrong-build | PASS |  |
| evidence-set-structural | attached-evidence-wrong-build | PASS |  |
| evidence-set-schema | attached-local-database-observed | PASS |  |
| evidence-set-structural | attached-local-database-observed | PASS |  |
| evidence-set-schema | attached-no-ids | PASS |  |
| evidence-set-structural | attached-no-ids | PASS |  |
| evidence-set-schema | attached-reviewed-evidence | PASS |  |
| evidence-set-structural | attached-reviewed-evidence | PASS |  |
| evidence-set-schema | attached-tampered-record | PASS |  |
| evidence-set-structural | attached-tampered-record | PASS | 0abce834353c: record_id does not match content digest |
| evidence-set-schema | attached-version-mismatch | PASS |  |
| evidence-set-structural | attached-version-mismatch | PASS |  |
| evidence-set-schema | attached-wrong-host | PASS |  |
| evidence-set-structural | attached-wrong-host | PASS |  |
| evidence-set-schema | attached | PASS |  |
| evidence-set-structural | attached | PASS |  |
| evidence-set-schema | empty | PASS |  |
| evidence-set-structural | empty | PASS |  |
| evidence-set-schema-negative | provisioned-bad-uuid | PASS | pattern:records/2d0b0207f36a244d74592157d93756faf0b78b5f5fb6f349edd048d268d0f6c8/instance_uuid:'not-a-uuid' does not match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' |
| evidence-set-structural | provisioned-bad-uuid | PASS |  |
| evidence-set-schema | provisioned-only | PASS |  |
| evidence-set-structural | provisioned-only | PASS |  |
| evidence-set-schema | ready-bundle-verified-for-v1.2-only | PASS |  |
| evidence-set-structural | ready-bundle-verified-for-v1.2-only | PASS |  |
| evidence-set-schema | ready-self-verified-bundle | PASS |  |
| evidence-set-structural | ready-self-verified-bundle | PASS |  |
| evidence-set-schema | ready-wrong-binary-pin | PASS |  |
| evidence-set-structural | ready-wrong-binary-pin | PASS |  |
| evidence-set-schema | ready | PASS |  |
| evidence-set-structural | ready | PASS |  |
| evidence-set-schema | write-ready-authorization-for-v1.2 | PASS |  |
| evidence-set-structural | write-ready-authorization-for-v1.2 | PASS |  |
| evidence-set-schema | write-ready-base | PASS |  |
| evidence-set-structural | write-ready-base | PASS |  |
| evidence-set-schema | write-ready-full | PASS |  |
| evidence-set-structural | write-ready-full | PASS |  |
| evidence-set-schema | write-ready-plan-validation-fail | PASS |  |
| evidence-set-structural | write-ready-plan-validation-fail | PASS |  |
| evidence-set-schema | write-ready-refreeze-unreviewed | PASS |  |
| evidence-set-structural | write-ready-refreeze-unreviewed | PASS |  |
| evidence-set-schema | write-ready-stale-guard | PASS |  |
| evidence-set-structural | write-ready-stale-guard | PASS |  |
| evidence-set-schema | write-ready-without-authorization | PASS |  |
| evidence-set-structural | write-ready-without-authorization | PASS |  |
| evidence-ref-negative | empty string | PASS | M3_AUTHORIZATION: reference is not a sha256 ('') |
| evidence-ref-negative | boolean-string false | PASS | M3_AUTHORIZATION: reference is not a sha256 ('false') |
| evidence-ref-negative | uppercase sha | PASS | M3_AUTHORIZATION: reference is not a sha256 ('44774D7DC4E16803E019905DB4074FB6E9A8C5CC3FE5162A2BDDF52F5A5623A5') |
| evidence-ref-negative | unlinked sha | PASS | M3_AUTHORIZATION: referenced record 999999999999 not in evidence set |
| evidence-ref-negative | wrong type | PASS | M3_AUTHORIZATION: record 44774d7dc4e1 has type PROVISIONING_RECORD |
| evidence-ref-negative | short hex | PASS | M3_AUTHORIZATION: reference is not a sha256 ('44774d7dc4e16803e019905db4074fb6e9a8c5cc3fe5162a2bddf52f5a5623a') |
| evidence-ref-negative | sha with newline | PASS | M3_AUTHORIZATION: reference is not a sha256 ('44774d7dc4e16803e019905db4074fb6e9a8c5cc3fe5162a2bddf52f5a5623a5\n') |
| evidence-ref-negative | record for another host | PASS |  |
| evidence-ref-positive | linked correct-type record resolves | PASS |  |
| attachment-derived | empty -> UNPROVISIONED | PASS | got UNPROVISIONED; failures=['no valid PROVISIONING_RECORD for contract host/library'] |
| attachment-derived | provisioned-only -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no LAUNCH_RECIPE record for host matching contract version/binary pin/Local scripting preference', 'no independent BUNDLE_VERIFICATION record for authority version'] |
| attachment-derived | provisioned-bad-uuid -> UNPROVISIONED | PASS | got UNPROVISIONED; failures=['no valid PROVISIONING_RECORD for contract host/library'] |
| attachment-derived | ready -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=[] |
| attachment-derived | ready-wrong-binary-pin -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no LAUNCH_RECIPE record for host matching contract version/binary pin/Local scripting preference'] |
| attachment-derived | ready-self-verified-bundle -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no independent BUNDLE_VERIFICATION record for authority version'] |
| attachment-derived | ready-bundle-verified-for-v1.2-only -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no independent BUNDLE_VERIFICATION record for authority version'] |
| attachment-derived | attached -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope', 'no EXCLUSIVE_SESSION_ATTESTATION'] |
| attachment-derived | attached-eka-observed -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=["OBSERVED_TARGET_MISMATCH: observed db_type PostgreSQL is not Disk; observed database 'EKA' != contract library; observed database is a prohibited (shared/user) library"] |
| attachment-derived | attached-local-database-observed -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=["OBSERVED_TARGET_MISMATCH: observed database 'Local Database' != contract library; observed database is a prohibited (shared/user) library"] |
| attachment-derived | attached-version-mismatch -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=['OBSERVED_TARGET_MISMATCH: observed product/version DaVinci Resolve Studio 21.0.3.0007 != contract DaVinci Resolve Studio 21.1.0.0014'] |
| attachment-derived | attached-wrong-host -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=[] |
| attachment-derived | write-ready-without-authorization -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope'] |
| attachment-derived | write-ready-authorization-for-v1.2 -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope'] |
| attachment-derived | write-ready-refreeze-unreviewed -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0 requalification REFREEZE_RECORD'] |
| attachment-derived | write-ready-base -> SCRATCH_WRITE_READY | PASS | got SCRATCH_WRITE_READY; failures=[] |
| attachment-derived | write-ready-full -> SCRATCH_WRITE_READY | PASS | got SCRATCH_WRITE_READY; failures=[] |
| attachment-derived | mismatched observation reports OBSERVED_TARGET_MISMATCH | PASS |  |
| attachment-derived | contract naming a prohibited library is UNPROVISIONED | PASS |  |
| attachment-derived | every state has required_records in TARGET-CONTRACT | PASS |  |
| fixture-schema-positive | capabilities-frozen | PASS |  |
| fixture-semantic-positive | capabilities-frozen | PASS |  |
| fixture-schema-positive | capabilities-probe-candidate-on-mutation-row | PASS |  |
| fixture-semantic-negative | capabilities-probe-candidate-on-mutation-row | PASS | row 'identity: GetUniqueId survives mutation (separate claim)': probe_candidate only allowed on DOCUMENTED_NOT_QUALIFIED rows |
| fixture-schema-positive | capabilities-qualified-read-unreviewed-candidate | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-unreviewed-candidate | PASS | row 'read: connection': QUALIFIED_READ without exact reviewed version-matched evidence record; row 'read: connection': probe_candidate only allowed on DOCUMENTED_NOT_QUALIFIED rows |
| fixture-schema-positive | capabilities-qualified-read-without-exact-evidence | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-without-exact-evidence | PASS | row 'read: connection': QUALIFIED_READ without exact reviewed version-matched evidence record; row 'read: connection': probe_candidate only allowed on DOCUMENTED_NOT_QUALIFIED rows |
| fixture-schema-negative | capabilities-unknown-evidence-class | PASS | enum:rows/0/evidence_class:'QUALIFIED' is not one of ['QUALIFIED_READ', 'DOCUMENTED_NOT_QUALIFIED', 'NOT_TESTED', 'UNSUPPORTED', 'BLOCKED', 'QUALIFIED_EF_SIDE'] |
| fixture-schema-positive | capabilities-version-match-lie | PASS |  |
| fixture-semantic-negative | capabilities-version-match-lie | PASS | row 'read: connection': version_match true but version differs from contract |
| fixture-schema-positive | commit-guard-mismatch | PASS |  |
| fixture-semantic-negative | commit-guard-mismatch | PASS | commit guard_digest does not match plan/target guard |
| fixture-schema-positive | commit-journal-from-other-transaction | PASS |  |
| fixture-semantic-negative | commit-journal-from-other-transaction | PASS | journal: journal transaction_id != plan; commit transaction_id mismatch; commit journal_head_sha256 does not match journal chain head |
| fixture-schema-positive | commit-journal-head-mismatch | PASS |  |
| fixture-semantic-negative | commit-journal-head-mismatch | PASS | commit journal_head_sha256 does not match journal chain head |
| fixture-schema-positive | commit-journal-not-published | PASS |  |
| fixture-semantic-negative | commit-journal-not-published | PASS | commit journal_head_sha256 does not match journal chain head; commit for journal whose last state is VERIFIED |
| fixture-schema-positive | commit-linked-eligible | PASS |  |
| fixture-semantic-positive | commit-linked-eligible | PASS |  |
| fixture-schema-negative | commit-missing-target | PASS | required::'target' is a required property |
| fixture-schema-negative | commit-naked-terminal-state | PASS | required::'verification_result_sha256' is a required property |
| fixture-schema-positive | commit-target-mismatch | PASS |  |
| fixture-semantic-negative | commit-target-mismatch | PASS | commit target != plan target |
| fixture-schema-positive | commit-unresolved-conflict-listed | PASS |  |
| fixture-semantic-negative | commit-unresolved-conflict-listed | PASS | commit with unresolved_conflicts listed |
| fixture-schema-positive | commit-verification-from-other-plan-with-matching-hash | PASS |  |
| fixture-semantic-negative | commit-verification-from-other-plan-with-matching-hash | PASS | verification: verification refers to another plan |
| fixture-schema-positive | commit-verification-hash-only-object-missing | PASS |  |
| fixture-semantic-negative | commit-verification-hash-only-object-missing | PASS | commit requires plan, journal and verification objects (not only their hashes) |
| fixture-schema-positive | commit-verification-not-verified | PASS |  |
| fixture-semantic-negative | commit-verification-not-verified | PASS | verification_result_sha256 does not match the validated verification object; commit without VERIFIED verification |
| fixture-schema-positive | commit-with-unresolved-conflict-record | PASS |  |
| fixture-semantic-negative | commit-with-unresolved-conflict-record | PASS | commit with unresolved conflict |
| fixture-schema-positive | conflict-bound-resolved | PASS |  |
| fixture-semantic-positive | conflict-bound-resolved | PASS |  |
| fixture-schema-positive | conflict-other-plan | PASS |  |
| fixture-semantic-negative | conflict-other-plan | PASS | conflict not bound to this plan/transaction |
| fixture-schema-negative | conflict-with-authority-effect | PASS | const:authority_effect:'NONE_UNTIL_HUMAN_ADJUDICATION' was expected |
| fixture-schema-positive | journal-aborted | PASS |  |
| fixture-semantic-positive | journal-aborted | PASS |  |
| fixture-schema-positive | journal-applied-without-operation-id | PASS |  |
| fixture-semantic-negative | journal-applied-without-operation-id | PASS | seq 3: APPLIED without operation_id |
| fixture-schema-positive | journal-bound-to-other-plan | PASS |  |
| fixture-semantic-negative | journal-bound-to-other-plan | PASS | journal plan_digest != plan |
| fixture-schema-positive | journal-bound-to-other-transaction | PASS |  |
| fixture-semantic-negative | journal-bound-to-other-transaction | PASS | journal transaction_id != plan |
| fixture-schema-positive | journal-broken-hash-chain | PASS |  |
| fixture-semantic-negative | journal-broken-hash-chain | PASS | seq 3: hash chain broken; seq 4: hash chain broken |
| fixture-schema-positive | journal-empty | PASS |  |
| fixture-semantic-negative | journal-empty | PASS | empty journal |
| fixture-schema-positive | journal-guard-change-without-recovery | PASS |  |
| fixture-semantic-negative | journal-guard-change-without-recovery | PASS | seq 5: guard_digest changed without a recovery transition |
| fixture-schema-positive | journal-legal-chain | PASS |  |
| fixture-semantic-positive | journal-legal-chain | PASS |  |
| fixture-schema-negative | journal-missing-target-ref | PASS | required::'target_ref' is a required property |
| fixture-schema-positive | journal-operation-id-reused | PASS |  |
| fixture-semantic-negative | journal-operation-id-reused | PASS | seq 4: operation_id op-1 applied twice |
| fixture-schema-positive | journal-plan-digest-change-mid-chain | PASS |  |
| fixture-semantic-negative | journal-plan-digest-change-mid-chain | PASS | seq 5: plan_digest changed mid-chain |
| fixture-schema-positive | journal-record-after-terminal | PASS |  |
| fixture-semantic-negative | journal-record-after-terminal | PASS | seq 10: illegal transition COMMITTED -> APPLIED; seq 10: record after terminal state COMMITTED |
| fixture-schema-positive | journal-recovery-committed-recovered | PASS |  |
| fixture-semantic-positive | journal-recovery-committed-recovered | PASS |  |
| fixture-schema-positive | journal-recovery-not-applied | PASS |  |
| fixture-semantic-positive | journal-recovery-not-applied | PASS |  |
| fixture-schema-positive | journal-recovery-unlinked | PASS |  |
| fixture-semantic-negative | journal-recovery-unlinked | PASS | seq 1: recovery record not linked to original transaction |
| fixture-schema-positive | journal-repeated-sequence | PASS |  |
| fixture-semantic-negative | journal-repeated-sequence | PASS | seq 1: sequence not contiguous (expected 2); seq 3: sequence not contiguous (expected 2) |
| fixture-schema-positive | journal-sequence-gap | PASS |  |
| fixture-semantic-negative | journal-sequence-gap | PASS | seq 5: sequence not contiguous (expected 2); seq 3: sequence not contiguous (expected 6) |
| fixture-schema-positive | journal-skip-to-committed | PASS |  |
| fixture-semantic-negative | journal-skip-to-committed | PASS | seq 4: illegal transition CHECKPOINTED -> COMMITTED; seq 5: illegal transition COMMITTED -> READBACK_S1; seq 5: record after terminal state COMMITTED |
| fixture-schema-positive | journal-target-change-mid-chain | PASS |  |
| fixture-semantic-negative | journal-target-change-mid-chain | PASS | seq 5: target_ref changed mid-chain |
| fixture-schema-positive | journal-transaction-id-change | PASS |  |
| fixture-semantic-negative | journal-transaction-id-change | PASS | seq 3: transaction_id changed mid-chain |
| fixture-schema-negative | permissions-default-allow | PASS | const:default:'DENY' was expected |
| fixture-schema-negative | permissions-entry-without-target-requirement-code | PASS | contains:entries/1/prerequisites:['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY', 'HOST_MATCHES_CONTRACT', 'LIBRARY_NOT_SHARED', 'LIBRARY_MATCHES_CONTRACT', 'READ_ONLY_JOURNAL_OPEN', 'PRIMITIVES_QUALIFI |
| fixture-schema-positive | permissions-frozen | PASS |  |
| fixture-none | permissions-frozen | PASS |  |
| fixture-schema-negative | permissions-m0-mutation | PASS | const:entries/0/milestone:'M3' was expected / contains:entries/0/prerequisites:['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY', 'HOST_MATCHES_CONTRACT', 'LIBRARY_NOT_SHARED', 'LIBRARY_MATCHES_CONTRACT', |
| fixture-schema-negative | permissions-missing-target-requirement | PASS | required:entries/0:'target_requirement' is a required property |
| fixture-schema-negative | permissions-shared-library-grant | PASS | const:entries/0/shared_library_allowed:False was expected |
| fixture-schema-positive | permissions-target-requirement-disagrees-with-read-primitives | PASS |  |
| fixture-semantic-negative | permissions-target-requirement-disagrees-with-read-primitives | PASS | PERMISSIONS/M0/CONNECT: target_requirement differs from READ-PRIMITIVES |
| fixture-schema-negative | permissions-unknown-prerequisite-code | PASS | enum:entries/0/prerequisites/0:'TRUST_ME' is not one of ['BUNDLE_INDEPENDENTLY_VERIFIED', 'EXCLUSIVE_SESSION_ATTESTED', 'GUARD_CURRENT', 'HOST_MATCHES_CONTRACT', 'JOURNAL_PREPARED', 'LIBRARY_MATCHES_CONTRACT', 'LIBRARY_N |
| fixture-schema-negative | plan-authority-version-old | PASS | const:authority_version:'1.3.0' was expected |
| fixture-schema-negative | plan-authorization-ref-empty | PASS | pattern:refs/authorization:'' does not match '^[a-f0-9]{64}$' |
| fixture-schema-positive | plan-authorization-ref-wrong-type | PASS |  |
| fixture-eligibility-negative | plan-authorization-ref-wrong-type | PASS | operation APPEND not eligible: ['MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: record b1cefc5e45b0 has type READ_ONLY_JOURNAL)'] |
| fixture-schema-negative | plan-declared-attachment-state | PASS | additionalProperties::Additional properties are not allowed ('target_attachment_state' was unexpected) |
| fixture-schema-positive | plan-delete-selector-incomplete | PASS |  |
| fixture-semantic-negative | plan-delete-selector-incomplete | PASS | operation DELETE not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 4f83a75f1991 plan_digest='80097efebbf4d3d916f19780b24de40251cc9c5b86b52c1b773a71960dccb457' != '435f909e30c6d2fccbd96fdadc3183619b1bb2578c8a0115 |
| fixture-schema-positive | plan-digest-not-of-body | PASS |  |
| fixture-semantic-negative | plan-digest-not-of-body | PASS | plan_digest does not match plan body digest; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 4f83a75f1991 plan_digest='80097efebbf4d3d916f19780b24de40251cc9c5b86b52c1b773a71960dccb457' != '000 |
| fixture-schema-positive | plan-eligible-but-guard-record-stale | PASS |  |
| fixture-eligibility-negative | plan-eligible-but-guard-record-stale | PASS | operation APPEND not eligible: ['GUARD_CURRENT (GUARD_SNAPSHOT: referenced record a1dce6d1ce16 not in evidence set)'] |
| fixture-schema-positive | plan-eligible-without-prepared-journal | PASS |  |
| fixture-eligibility-negative | plan-eligible-without-prepared-journal | PASS | operation APPEND not eligible: ['JOURNAL_PREPARED (JOURNAL_PREPARED: referenced record 4f83a75f1991 not in evidence set)', 'PLAN_VALIDATED (PLAN_VALIDATION: referenced record b0f1b67d3021 not in evidence set)', 'GUARD_CU |
| fixture-schema-negative | plan-legacy-authorization-token-field | PASS | additionalProperties::Additional properties are not allowed ('authorization_token' was unexpected) |
| fixture-schema-positive | plan-m2-append-not-permitted | PASS |  |
| fixture-semantic-negative | plan-m2-append-not-permitted | PASS | operation APPEND not permitted at M2/SCRATCH_QUALIFICATION_LIBRARY: ['NOT_PERMITTED_BY_POLICY:no explicit entry (default DENY)'] |
| fixture-schema-negative | plan-m2-non-dry-run | PASS | minItems:operations:[] is too short |
| fixture-schema-positive | plan-m3-append-eligible | PASS |  |
| fixture-semantic-positive | plan-m3-append-eligible | PASS |  |
| fixture-schema-positive | plan-missing-m3-authorization | PASS |  |
| fixture-eligibility-negative | plan-missing-m3-authorization | PASS | operation APPEND not eligible: ['MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: reference is not a sha256 (None))'] |
| fixture-schema-positive | plan-operation-set-digest-mismatch | PASS |  |
| fixture-semantic-negative | plan-operation-set-digest-mismatch | PASS | operation_set_digest does not match operations; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 4f83a75f1991 plan_digest='80097efebbf4d3d916f19780b24de40251cc9c5b86b52c1b773a71960dccb457' != ' |
| fixture-schema-positive | plan-payload-as-guard | PASS |  |
| fixture-semantic-negative | plan-payload-as-guard | PASS | operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 4f83a75f1991 plan_digest='80097efebbf4d3d916f19780b24de40251cc9c5b86b52c1b773a71960dccb457' != '0b8daa3a0e1d93ea7d185659331bc84fe645050a619e056d |
| fixture-schema-positive | plan-plan-validation-record-fail | PASS |  |
| fixture-eligibility-negative | plan-plan-validation-record-fail | PASS | operation APPEND not eligible: ['PLAN_VALIDATED (PLAN_VALIDATION: referenced record b0f1b67d3021 not in evidence set)'] |
| fixture-schema-positive | plan-read-class-with-append | PASS |  |
| fixture-semantic-negative | plan-read-class-with-append | PASS | RESOLVE_READ permission class cannot carry write operations; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 4f83a75f1991 plan_digest='80097efebbf4d3d916f19780b24de40251cc9c5b86b52c1b773a71960 |
| fixture-schema-positive | plan-selector-target-mismatch | PASS |  |
| fixture-semantic-negative | plan-selector-target-mismatch | PASS | operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 4f83a75f1991 plan_digest='80097efebbf4d3d916f19780b24de40251cc9c5b86b52c1b773a71960dccb457' != '2e681e6b26315d3a32657549ec945c60654d68deb77ba88e |
| fixture-schema-positive | plan-stale-guard | PASS |  |
| fixture-semantic-negative | plan-stale-guard | PASS | operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 4f83a75f1991 plan_digest='80097efebbf4d3d916f19780b24de40251cc9c5b86b52c1b773a71960dccb457' != '281d7bf637cec89f6cfe83053173420b02e589e3694b1ca3 |
| fixture-schema-positive | read-primitives-class-mismatch-with-matrix | PASS |  |
| fixture-semantic-negative | read-primitives-class-mismatch-with-matrix | PASS | SNAPSHOT_CAPTURE: primitive GetTrackCount evidence_class QUALIFIED_READ != matrix DOCUMENTED_NOT_QUALIFIED |
| fixture-schema-positive | read-primitives-frozen | PASS |  |
| fixture-semantic-positive | read-primitives-frozen | PASS |  |
| fixture-schema-negative | read-primitives-invented-target-requirement | PASS | enum:logical_operations/CONNECT/target_requirement:'CURRENT_PROJECT' is not one of ['SESSION', 'PROJECT', 'PROJECT_TIMELINE'] |
| fixture-schema-negative | read-primitives-missing-target-requirement | PASS | required:logical_operations/CONNECT:'target_requirement' is a required property |
| fixture-schema-positive | read-primitives-probe-allowed-outside-probe | PASS |  |
| fixture-semantic-negative | read-primitives-probe-allowed-outside-probe | PASS | SNAPSHOT_CAPTURE: probe_allowed primitives only inside READ_PRIMITIVE_QUALIFICATION_PROBE |
| fixture-schema-negative | read-primitives-probe-promotes | PASS | const:logical_operations/READ_PRIMITIVE_QUALIFICATION_PROBE/promotes_capability:False was expected |
| fixture-schema-positive | snapshot-complete-empty-observed | PASS |  |
| fixture-semantic-negative | snapshot-complete-empty-observed | PASS | complete:true with empty observed_domains; complete:true but mandatory domains not observed: ['connection', 'items', 'library', 'markers', 'project', 'settings', 'timeline', 'tracks'] |
| fixture-schema-positive | snapshot-complete-with-observation-failures | PASS |  |
| fixture-semantic-negative | snapshot-complete-with-observation-failures | PASS | complete:true with observation_failures present |
| fixture-schema-positive | snapshot-complete-with-partial-item-full-profile | PASS |  |
| fixture-semantic-negative | snapshot-complete-with-partial-item-full-profile | PASS | complete:true under FULL_TIMELINE_READ with unresolved item fields ['enabled', 'end'] |
| fixture-schema-positive | snapshot-complete-write-precheck-missing-domains | PASS |  |
| fixture-semantic-negative | snapshot-complete-write-precheck-missing-domains | PASS | complete:true but mandatory domains not observed: ['guard', 'item_identity', 'policy', 'track_locks']; complete:true under WRITE_PRECHECK with unresolved item fields ['media_pool_item_unique_id'] |
| fixture-schema-positive | snapshot-duration-contradiction | PASS |  |
| fixture-semantic-negative | snapshot-duration-contradiction | PASS | duration inconsistent with both candidate conventions |
| fixture-schema-positive | snapshot-end-before-start | PASS |  |
| fixture-semantic-negative | snapshot-end-before-start | PASS | item it-1: end < start; duration inconsistent with both candidate conventions |
| fixture-schema-positive | snapshot-fabricated-id | PASS |  |
| fixture-semantic-negative | snapshot-fabricated-id | PASS | item[0].unique_id: status UNAVAILABLE but value present (fabrication) |
| fixture-schema-negative | snapshot-failure-ledger-without-reason | PASS | minLength:payload/observation_failures/0/reason:'' is too short |
| fixture-schema-positive | snapshot-full-profile-timeline-identity-unavailable-complete | PASS |  |
| fixture-semantic-negative | snapshot-full-profile-timeline-identity-unavailable-complete | PASS | complete:true under FULL_TIMELINE_READ but timeline.unique_id not OBSERVED |
| fixture-schema-positive | snapshot-guard-context-changed-raw | PASS |  |
| fixture-semantic-negative | snapshot-guard-context-changed-raw | PASS | guard_digest does not match guard object |
| fixture-schema-positive | snapshot-human-timeline-full-read | PASS |  |
| fixture-semantic-positive | snapshot-human-timeline-full-read | PASS |  |
| fixture-schema-positive | snapshot-incomplete-nothing-missing-named | PASS |  |
| fixture-semantic-negative | snapshot-incomplete-nothing-missing-named | PASS | complete:false must name missing domains/fields |
| fixture-schema-positive | snapshot-incomplete-without-reasons | PASS |  |
| fixture-semantic-negative | snapshot-incomplete-without-reasons | PASS | complete:false must list incomplete_reasons |
| fixture-schema-negative | snapshot-invented-domain | PASS | enum:coverage/observed_domains/9:'vibes' is not one of ['adapter_bin_media', 'caches', 'connection', 'fades', 'fusion_graphs', 'grades', 'guard', 'item_identity', 'item_properties', 'item_source_bounds', 'items', 'keyfra |
| fixture-schema-negative | snapshot-invented-field-status-name | PASS | oneOf:payload/tracks/0/items/0:{'unique_id': 'it-1', 'observation_ordinal': 0, 'name': 'still-001', 'start': 108000, 'end': 108347, 'duration': 347, 'enabled': True, 'markers': [], 'identity_observed': 'COMPLETE', 'field |
| fixture-schema-positive | snapshot-m0-complete-missing-mandatory-domain | PASS |  |
| fixture-semantic-negative | snapshot-m0-complete-missing-mandatory-domain | PASS | complete:true but mandatory domains not observed: ['timeline'] |
| fixture-schema-positive | snapshot-m0-complete-with-partial-item | PASS |  |
| fixture-semantic-negative | snapshot-m0-complete-with-partial-item | PASS | complete:true with observation_failures present |
| fixture-schema-positive | snapshot-m0-minimal-complete-identity-unavailable | PASS |  |
| fixture-semantic-positive | snapshot-m0-minimal-complete-identity-unavailable | PASS |  |
| fixture-schema-positive | snapshot-m0-minimal-partial-honest | PASS |  |
| fixture-semantic-positive | snapshot-m0-minimal-partial-honest | PASS |  |
| fixture-schema-negative | snapshot-missing-ordinal | PASS | oneOf:payload/tracks/0/items/0:{'unique_id': 'it-1', 'name': 'still-001', 'start': 108000, 'end': 108347, 'duration': 347, 'enabled': True, 'markers': [], 'identity_observed': 'COMPLETE', 'field_status': {'unique_id': 'O |
| fixture-schema-negative | snapshot-negative-frame | PASS | oneOf:payload/tracks/0/items/0:{'unique_id': 'it-1', 'observation_ordinal': 0, 'name': 'still-001', 'start': -5, 'end': 108347, 'duration': 347, 'enabled': True, 'markers': [], 'identity_observed': 'COMPLETE', 'field_sta |
| fixture-schema-positive | snapshot-not-requested-with-value | PASS |  |
| fixture-semantic-negative | snapshot-not-requested-with-value | PASS | item[0].enabled: status NOT_REQUESTED but value present (fabrication); complete:true under FULL_TIMELINE_READ with unresolved item fields ['enabled'] |
| fixture-schema-positive | snapshot-observed-start-null | PASS |  |
| fixture-semantic-negative | snapshot-observed-start-null | PASS | item[0].start: status OBSERVED but value null; canonicalization error: not a numeric quantity: None |
| fixture-schema-positive | snapshot-observed-status-null-value | PASS |  |
| fixture-semantic-negative | snapshot-observed-status-null-value | PASS | item[0].unique_id: status OBSERVED but value null |
| fixture-schema-negative | snapshot-postgres-library | PASS | enum:library/db_type:'PostgreSQL' is not one of ['Disk'] |
| fixture-schema-positive | snapshot-project-identity-null-observed | PASS |  |
| fixture-semantic-negative | snapshot-project-identity-null-observed | PASS | project.unique_id: status OBSERVED but value null |
| fixture-schema-positive | snapshot-project-identity-value-with-unavailable | PASS |  |
| fixture-semantic-negative | snapshot-project-identity-value-with-unavailable | PASS | project.unique_id: status UNAVAILABLE but value present (fabrication) |
| fixture-schema-positive | snapshot-source-bounds-inverted | PASS |  |
| fixture-semantic-negative | snapshot-source-bounds-inverted | PASS | source_end < source_start |
| fixture-schema-positive | snapshot-timeline-end-before-start | PASS |  |
| fixture-semantic-negative | snapshot-timeline-end-before-start | PASS | timeline end_frame < start_frame |
| fixture-schema-positive | snapshot-timeline-identity-null-observed | PASS |  |
| fixture-semantic-negative | snapshot-timeline-identity-null-observed | PASS | timeline.unique_id: status OBSERVED but value null |
| fixture-schema-positive | snapshot-unavailable-end-with-value | PASS |  |
| fixture-semantic-negative | snapshot-unavailable-end-with-value | PASS | item[0].end: status UNAVAILABLE but value present (fabrication); complete:true under FULL_TIMELINE_READ with unresolved item fields ['end'] |
| fixture-schema-positive | snapshot-unavailable-without-reason | PASS |  |
| fixture-semantic-negative | snapshot-unavailable-without-reason | PASS | item[0].enabled: status UNAVAILABLE requires a reason; complete:true under FULL_TIMELINE_READ with unresolved item fields ['enabled'] |
| fixture-schema-negative | snapshot-unknown-status-word | PASS | oneOf:payload/tracks/0/items/0:{'unique_id': 'it-1', 'observation_ordinal': 0, 'name': 'still-001', 'start': 108000, 'end': 108347, 'duration': 347, 'enabled': True, 'markers': [], 'identity_observed': 'COMPLETE', 'field |
| fixture-schema-positive | snapshot-write-precheck-complete | PASS |  |
| fixture-semantic-positive | snapshot-write-precheck-complete | PASS |  |
| fixture-schema-positive | snapshot-write-precheck-item-id-unavailable | PASS |  |
| fixture-semantic-negative | snapshot-write-precheck-item-id-unavailable | PASS | complete:true under WRITE_PRECHECK with unresolved item fields ['unique_id'] |
| fixture-schema-positive | snapshot-write-precheck-media-pool-id-unavailable | PASS |  |
| fixture-semantic-negative | snapshot-write-precheck-media-pool-id-unavailable | PASS | complete:true under WRITE_PRECHECK with unresolved item fields ['media_pool_item_unique_id'] |
| fixture-schema-positive | snapshot-write-precheck-missing-guard-domain | PASS |  |
| fixture-semantic-negative | snapshot-write-precheck-missing-guard-domain | PASS | complete:true but mandatory domains not observed: ['guard'] |
| fixture-schema-positive | snapshot-write-precheck-missing-policy-domain | PASS |  |
| fixture-semantic-negative | snapshot-write-precheck-missing-policy-domain | PASS | complete:true but mandatory domains not observed: ['policy'] |
| fixture-schema-positive | snapshot-write-precheck-null-lock | PASS |  |
| fixture-semantic-negative | snapshot-write-precheck-null-lock | PASS | complete:true under WRITE_PRECHECK with unresolved track locks |
| fixture-schema-positive | snapshot-write-precheck-project-id-unavailable | PASS |  |
| fixture-semantic-negative | snapshot-write-precheck-project-id-unavailable | PASS | complete:true under WRITE_PRECHECK but project.unique_id not OBSERVED |
| fixture-schema-negative | target-accepts-open-session | PASS | const:accepts_current_open_session_as_target:False was expected |
| fixture-schema-positive | target-contract-frozen-derived | PASS |  |
| fixture-semantic-positive | target-contract-frozen-derived | PASS |  |
| fixture-schema-negative | target-declared-attachment-state | PASS | additionalProperties::Additional properties are not allowed ('attachment_state' was unexpected) |
| fixture-schema-negative | target-declared-flag-true | PASS | const:attachment_state_is_declared:False was expected |
| fixture-schema-negative | target-empty-host | PASS | minLength:host/name:'' is too short |
| fixture-schema-negative | target-library-is-prohibited | PASS | pattern:library/name:'EKA' does not match '^VIDTOOLZ Resolve Qualification v[0-9]+$' |
| fixture-schema-negative | target-missing-denied-setcurrentdatabase | PASS | contains:denied_calls_all_scopes:['CloseProject', 'ImportProject', 'DeleteTimelines(non-owned)', 'ReplaceClip', 'ReplaceClipPreserveSubClip', 'RelinkClips', 'DeleteClips(ripple=true)', 'run_script', 'run_script_unsafe',  |
| fixture-schema-negative | target-path-traversal | PASS | anyOf:library/root_path:'/home/vidtoolz/../etc/resolve-qual' is not valid under any of the given schemas |
| fixture-schema-negative | target-prohibited-list-drops-eka | PASS | contains:library/prohibited_library_names:['Local Database', 'nelja'] does not contain items matching the given schema |
| fixture-schema-negative | target-shared-postgres-library | PASS | const:library/kind:'Disk' was expected |
| fixture-schema-negative | target-unknown-record-type | PASS | enum:attachment_states/ATTACHED_READ_ONLY/required_records/0:'VIBES' is not one of ['BUNDLE_VERIFICATION', 'CAPABILITY_EVIDENCE', 'CONNECTION_OBSERVATION', 'DESTINATION_TIMELINE', 'EXCLUSIVE_SESSION_ATTESTATION', 'GUARD_ |
| fixture-schema-negative | verification-claims-human-approval | PASS | const:is_human_approval:False was expected |
| fixture-schema-positive | verification-delta-authority-mismatch | PASS |  |
| fixture-semantic-negative | verification-delta-authority-mismatch | PASS | verification expected-delta authority != plan operation set |
| fixture-schema-positive | verification-guard-mismatch | PASS |  |
| fixture-semantic-negative | verification-guard-mismatch | PASS | verification guard mismatch |
| fixture-schema-negative | verification-missing-transaction | PASS | required::'transaction_id' is a required property |
| fixture-schema-positive | verification-other-plan | PASS |  |
| fixture-semantic-negative | verification-other-plan | PASS | verification refers to another plan |
| fixture-schema-positive | verification-other-target | PASS |  |
| fixture-semantic-negative | verification-other-target | PASS | verification refers to another target |
| fixture-schema-positive | verification-other-transaction | PASS |  |
| fixture-semantic-negative | verification-other-transaction | PASS | verification refers to another transaction |
| fixture-schema-positive | verification-verified-clean | PASS |  |
| fixture-semantic-positive | verification-verified-clean | PASS |  |
| fixture-schema-positive | verification-verified-with-missing-expected | PASS |  |
| fixture-semantic-negative | verification-verified-with-missing-expected | PASS | VERIFIED with unrelated or missing_expected non-empty |
| fixture-schema-positive | verification-verified-with-unrelated | PASS |  |
| fixture-semantic-negative | verification-verified-with-unrelated | PASS | VERIFIED with unrelated or missing_expected non-empty |
| fixture-layers | layers present | PASS | {'none': 16, 'semantic': 77, 'schema': 38, 'eligibility': 5} |
| linked-set-negative | linked-set-commit-authority-version-old | PASS | schema/commit: const:authority_version:'1.3.0' was expected |
| linked-set-negative | linked-set-commit-other-target | PASS | commit: commit target != plan target |
| linked-set-positive | linked-set-committed-consistent | PASS |  |
| linked-set-negative | linked-set-committed-journal-without-commit | PASS | journal reached COMMITTED without a commit manifest |
| linked-set-negative | linked-set-guard-snapshot-stale | PASS | plan: plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT); commit: commit guard_digest does not match plan/target guard |
| linked-set-positive | linked-set-in-flight-no-commit | PASS |  |
| linked-set-negative | linked-set-journal-other-transaction | PASS | journal: journal transaction_id != plan; commit: journal: journal transaction_id != plan; commit: commit transaction_id mismatch; commit: commit journal_head_sha256 does not match journal chain head |
| linked-set-negative | linked-set-journal-plan-digest-drift | PASS | journal: seq 6: plan_digest changed mid-chain; commit: journal: seq 6: plan_digest changed mid-chain; commit: commit journal_head_sha256 does not match journal chain head |
| linked-set-negative | linked-set-plan-not-eligible-no-authorization | PASS | plan: operation APPEND not eligible: ['MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: referenced record 7363bbda89b0 not in evidence set)', 'TARGET_STATE_SCRATCH_WRITE_READY (no M3_AUTHORIZATION for scratch scope)', 'JOURNAL_ |
| linked-set-negative | linked-set-schema-invalid-plan | PASS | schema/plan: additionalProperties::Additional properties are not allowed ('target_attachment_state' was unexpected) |
| linked-set-negative | linked-set-unresolved-conflict | PASS | commit: commit with unresolved conflict |
| linked-set-negative | linked-set-verification-delta-authority-mismatch | PASS | verification: verification expected-delta authority != plan operation set; commit: verification: verification expected-delta authority != plan operation set |
| linked-set-negative | linked-set-verification-other-plan | PASS | verification: verification refers to another plan; commit: verification: verification refers to another plan |
| linked-set | commit checker refuses hash-only verification | PASS |  |
| linked-set | plan_digest law: digest of body without refs | PASS |  |
| linked-set | plan_digest changes when an operation changes | PASS |  |
| canon-vector | empty_object | PASS |  |
| canon-vector | key_order_codepoint | PASS |  |
| canon-vector | string_escapes | PASS |  |
| canon-vector | integers_and_tagged | PASS |  |
| canon-vector | f64_one_canonical_form_positive_zero | PASS |  |
| canon-vector | numeric_track_index_2_before_10 | PASS |  |
| canon-vector | track_type_order_video_audio_subtitle | PASS |  |
| canon-vector | markers_total_order_A | PASS |  |
| canon-vector | markers_total_order_B_reversed_same_digest | PASS |  |
| canon-vector | markers_differ_only_in_note | PASS |  |
| canon-vector | markers_differ_only_in_duration | PASS |  |
| canon-vector | unicode_byte_distinct_strings | PASS |  |
| canon-vector | permutation_invariance_A | PASS |  |
| canon-vector | permutation_invariance_B_same_digest | PASS |  |
| canon-vector | same_frame_items_deterministic | PASS |  |
| canon-vector | partial_items_status_aware_order_A | PASS |  |
| canon-vector | partial_items_status_aware_order_B_same_digest | PASS |  |
| canon-vector | observation_failures_ledger_ordered | PASS |  |
| canon-vector | nullable_fields_explicit_null | PASS |  |
| canon-invariance | markers_total_order_A == markers_total_order_B_reversed_same_digest | PASS |  |
| canon-invariance | permutation_invariance_A == permutation_invariance_B_same_digest | PASS |  |
| canon-invariance | partial_items_status_aware_order_A == partial_items_status_aware_order_B_same_digest | PASS |  |
| canon-vector | payload domain is v1.3 | PASS |  |
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
| canon-rejection | items_missing_ordinal | PASS | item.observation_ordinal (position in GetItemListInTrack) is required for total ordering |
| canon-rejection | items_duplicate_ordinal | PASS | two items share the full sort key: identity collision |
| canon-rejection | items_observed_end_null_in_sort | PASS | not a numeric quantity: None |
| f64-exact | fullmatch semantics used | PASS |  |
| f64-exact | valid canonical value accepted | PASS |  |
| f64-exact | one bit pattern one text (uppercase rejected, -0 rejected, whitespace rejected) | PASS |  |
| eligibility-request-schema | m0-probe-allow-attachment-ready | PASS | request schema-valid=True |
| eligibility | m0-probe-allow-attachment-ready | PASS | eligible=True state=ATTACHMENT_READY tr=SESSION failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-probe-deny-unprovisioned | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-unprovisioned | PASS | eligible=False state=UNPROVISIONED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no valid PROVISIONING_RECORD for contract host/library)', 'HOST_MATCHES_CONTRACT'] codes=['PREREQUISI |
| eligibility-request-schema | m0-probe-deny-provisioned-not-verified | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-provisioned-not-verified | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no LAUNCH_RECIPE record for host matching contract version/binary pin/Local scripting pref |
| eligibility-request-schema | m0-probe-deny-bad-provisioning-uuid | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-bad-provisioning-uuid | PASS | eligible=False state=UNPROVISIONED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no valid PROVISIONING_RECORD for contract host/library)', 'HOST_MATCHES_CONTRACT'] codes=['PREREQUISI |
| eligibility-request-schema | m0-probe-deny-launch-recipe-wrong-binary | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-launch-recipe-wrong-binary | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no LAUNCH_RECIPE record for host matching contract version/binary pin/Local scripting pref |
| eligibility-request-schema | m0-probe-deny-self-verified-bundle | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-self-verified-bundle | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no independent BUNDLE_VERIFICATION record for authority version)'] codes=['PREREQUISITES_F |
| eligibility-request-schema | m0-probe-deny-bundle-verified-for-other-version | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-bundle-verified-for-other-version | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no independent BUNDLE_VERIFICATION record for authority version)'] codes=['PREREQUISITES_F |
| eligibility-request-schema | m0-probe-deny-no-read-only-journal-ref | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-no-read-only-journal-ref | PASS | eligible=False state=ATTACHMENT_READY tr=SESSION failed=['READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: reference is not a sha256 (None))'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-probe-deny-declared-state-ignored | PASS | request schema-valid=False |
| eligibility | m0-probe-deny-declared-state-ignored | PASS | eligible=False state=UNPROVISIONED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no valid PROVISIONING_RECORD for contract host/library)', 'HOST_MATCHES_CONTRACT'] codes=['PREREQUISI |
| eligibility-request-schema | m0-probe-deny-eka-observed | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-eka-observed | PASS | eligible=False state=ATTACHMENT_READY tr=SESSION failed=['LIBRARY_NOT_SHARED', 'LIBRARY_MATCHES_CONTRACT'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-probe-deny-tampered-record | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-tampered-record | PASS | eligible=False state=None tr=None failed=[] codes=['EVIDENCE_SET_INVALID', '0abce834353c: record_id does not match content digest'] |
| eligibility-request-schema | m0-snapshot-allow-degraded-attached | PASS | request schema-valid=True |
| eligibility | m0-snapshot-allow-degraded-attached | PASS | eligible=True state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-snapshot-deny-attachment-ready-only | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-attachment-ready-only | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=['TARGET_STATE_ATTACHED_READ_ONLY', 'RESOLVE_VERSION_MATCHES', "TARGET_REQUIREMENT_SATISFIED (no PROJECT_BINDING_OBSERVATION for expected project 'VIDTOOLZ |
| eligibility-request-schema | m0-snapshot-deny-no-timeline-binding | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-no-timeline-binding | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["TARGET_REQUIREMENT_SATISFIED (no TIMELINE_BINDING_OBSERVATION for 'VIDTOOLZ_RESOLVE_QUAL_V1_FIXTURE'/'VIDTOOLZ__other__r1')", "TARGET_REQUIREMENT_SATIS |
| eligibility-request-schema | m0-snapshot-deny-no-expected-timeline | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-no-expected-timeline | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['TARGET_REQUIREMENT_SATISFIED (target requirement PROJECT_TIMELINE: expected_timeline_name missing)', 'TARGET_REQUIREMENT_SATISFIED (target requirement  |
| eligibility-request-schema | m0-snapshot-deny-no-expected-project | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-no-expected-project | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['TARGET_REQUIREMENT_SATISFIED (target requirement PROJECT: expected_project_name missing)', 'TARGET_REQUIREMENT_SATISFIED (target requirement PROJECT: e |
| eligibility-request-schema | m0-snapshot-deny-unbound-project-name | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-unbound-project-name | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["TARGET_REQUIREMENT_SATISFIED (no PROJECT_BINDING_OBSERVATION for expected project 'VIDTOOLZ_RESOLVE_QUAL_V1_GHOST'; no TIMELINE_BINDING_OBSERVATION for |
| eligibility-request-schema | m0-snapshot-deny-human-project-without-operator-record | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-human-project-without-operator-record | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT failed=["TARGET_REQUIREMENT_SATISFIED (project 'PYSTY UHD' is neither adapter-prefixed nor operator-provisioned)", "TARGET_REQUIREMENT_SATISFIED (project 'PYSTY UHD' is  |
| eligibility-request-schema | m0-enumerate-timelines-allow-operator-provisioned-project | PASS | request schema-valid=True |
| eligibility | m0-enumerate-timelines-allow-operator-provisioned-project | PASS | eligible=True state=ATTACHED_READ_ONLY tr=PROJECT failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-enumerate-projects-allow-session-scope | PASS | request schema-valid=True |
| eligibility | m0-enumerate-projects-allow-session-scope | PASS | eligible=True state=ATTACHED_READ_ONLY tr=SESSION failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-enumerate-timelines-deny-no-project | PASS | request schema-valid=True |
| eligibility | m0-enumerate-timelines-deny-no-project | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT failed=['TARGET_REQUIREMENT_SATISFIED (target requirement PROJECT: expected_project_name missing)', 'TARGET_REQUIREMENT_SATISFIED (target requirement PROJECT: expected_p |
| eligibility-request-schema | m0-snapshot-deny-eka-observed | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-eka-observed | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=["TARGET_STATE_ATTACHED_READ_ONLY (OBSERVED_TARGET_MISMATCH: observed db_type PostgreSQL is not Disk; observed database 'EKA' != contract library; observed |
| eligibility-request-schema | m0-snapshot-deny-local-database-observed | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-local-database-observed | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=["TARGET_STATE_ATTACHED_READ_ONLY (OBSERVED_TARGET_MISMATCH: observed database 'Local Database' != contract library; observed database is a prohibited (sha |
| eligibility-request-schema | m0-snapshot-deny-version-mismatch | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-version-mismatch | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=['TARGET_STATE_ATTACHED_READ_ONLY (OBSERVED_TARGET_MISMATCH: observed product/version DaVinci Resolve Studio 21.0.3.0007 != contract DaVinci Resolve Studio |
| eligibility-request-schema | m0-snapshot-deny-wrong-host-observation | PASS | request schema-valid=True |
| eligibility | m0-snapshot-deny-wrong-host-observation | PASS | eligible=False state=ATTACHMENT_READY tr=PROJECT_TIMELINE failed=['TARGET_STATE_ATTACHED_READ_ONLY', 'RESOLVE_VERSION_MATCHES'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-connect-deny-refuse-fallback-no-qualified-rows | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-refuse-fallback-no-qualified-rows | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-qualified-read-string-ignored | PASS | request schema-valid=False |
| eligibility | m0-connect-deny-qualified-read-string-ignored | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-candidate-evidence-unreviewed | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-candidate-evidence-unreviewed | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-reviewed-evidence-but-matrix-not-refrozen | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-reviewed-evidence-but-matrix-not-refrozen | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-allow-hypothetical-refrozen-matrix | PASS | request schema-valid=True |
| eligibility | m0-connect-allow-hypothetical-refrozen-matrix | PASS | eligible=True state=ATTACHED_READ_ONLY tr=SESSION failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-connect-deny-hypothetical-matrix-unreviewed-evidence | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hypothetical-matrix-unreviewed-evidence | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hypothetical-matrix-wrong-build-evidence | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hypothetical-matrix-wrong-build-evidence | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hypothetical-matrix-no-linked-evidence | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hypothetical-matrix-no-linked-evidence | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-deny-write-op | PASS | request schema-valid=True |
| eligibility | m0-deny-write-op | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:no explicit entry (default DENY)'] |
| eligibility-request-schema | m0-deny-ref-empty-string | PASS | request schema-valid=False |
| eligibility | m0-deny-ref-empty-string | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: reference is not a sha256 (''))"] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-deny-ref-false-string | PASS | request schema-valid=False |
| eligibility | m0-deny-ref-false-string | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: reference is not a sha256 ('false'))"] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-deny-ref-uppercase-sha | PASS | request schema-valid=False |
| eligibility | m0-deny-ref-uppercase-sha | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: reference is not a sha256 ('B1CEFC5E45B0D5E7A7354599C0FCB040F6FC12FDAD420C0D8070D033C64F5670'))"] codes=['PR |
| eligibility-request-schema | m0-deny-ref-unlinked-sha | PASS | request schema-valid=True |
| eligibility | m0-deny-ref-unlinked-sha | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: referenced record 999999999999 not in evidence set)'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-deny-ref-wrong-record-type | PASS | request schema-valid=True |
| eligibility | m0-deny-ref-wrong-record-type | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: record 0abce834353c has type CONNECTION_OBSERVATION)'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m2-set-current-timeline-deny-production-project-name | PASS | request schema-valid=True |
| eligibility | m2-set-current-timeline-deny-production-project-name | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=['PROJECT_ADAPTER_PREFIXED', "TARGET_REQUIREMENT_SATISFIED (no PROJECT_BINDING_OBSERVATION for expected project 'PYSTY UHD'; project 'PYSTY UHD' is neit |
| eligibility-request-schema | m2-set-current-timeline-allow | PASS | request schema-valid=True |
| eligibility | m2-set-current-timeline-allow | PASS | eligible=True state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m2-deny-exit-ref-for-other-milestone | PASS | request schema-valid=True |
| eligibility | m2-deny-exit-ref-for-other-milestone | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=["M1_EXIT_EVIDENCE (MILESTONE_EXIT: record bbe3b00633cf milestone='M0' != 'M1')"] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m3-append-deny-without-authorization | PASS | request schema-valid=True |
| eligibility | m3-append-deny-without-authorization | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: reference is not a sha256 (None))', 'TARGET_STATE_SCRATCH_WRITE_READY (no M3_AUTHORIZATION for scratch scope) |
| eligibility-request-schema | m3-append-deny-authorization-for-old-authority | PASS | request schema-valid=True |
| eligibility | m3-append-deny-authorization-for-old-authority | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: record cfac00f73c91 authority_version='1.2.0' != '1.3.0')", 'TARGET_STATE_SCRATCH_WRITE_READY (no M3_AUTHORIZ |
| eligibility-request-schema | m3-append-deny-refreeze-unreviewed | PASS | request schema-valid=True |
| eligibility | m3-append-deny-refreeze-unreviewed | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['TARGET_STATE_SCRATCH_WRITE_READY (no reviewed M0 requalification REFREEZE_RECORD)', 'JOURNAL_PREPARED (JOURNAL_PREPARED: reference is not a sha256 (Non |
| eligibility-request-schema | m3-append-deny-no-journal-guard-plan-records | PASS | request schema-valid=True |
| eligibility | m3-append-deny-no-journal-guard-plan-records | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=['JOURNAL_PREPARED (JOURNAL_PREPARED: reference is not a sha256 (None))', 'PLAN_VALIDATED (PLAN_VALIDATION: reference is not a sha256 (None))', 'GUARD_C |
| eligibility-request-schema | m3-append-deny-ids-unavailable | PASS | request schema-valid=True |
| eligibility | m3-append-deny-ids-unavailable | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT failed=['M2_EXIT_EVIDENCE (MILESTONE_EXIT: referenced record ec9aff5cc951 not in evidence set)', 'MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: referenced record 7363bbda89b |
| eligibility-request-schema | m3-deny-shared-library-scope | PASS | request schema-valid=True |
| eligibility | m3-deny-shared-library-scope | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:unknown milestone or scope'] |
| eligibility-request-schema | m4-deny-unknown-milestone | PASS | request schema-valid=True |
| eligibility | m4-deny-unknown-milestone | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:unknown milestone or scope'] |
| eligibility-request-schema | deny-unknown-operation | PASS | request schema-valid=True |
| eligibility | deny-unknown-operation | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:no explicit entry (default DENY)'] |
| eligibility-invariant | allowed_true_is_not_eligibility | PASS |  |
| eligibility-invariant | declared attachment_state in request is ignored | PASS |  |
| eligibility-invariant | capabilities argument is consumed (hypothetical matrix flips CONNECT) | PASS |  |
| eligibility-invariant | probe expands only probe_allowed primitives (no QUALIFIED_CALLABLE needed) | PASS |  |
| permission-invariant | no_mutation_before_M3 | PASS |  |
| permission-invariant | every_M3_mutation_requires_authorization_and_write_ready | PASS |  |
| permission-invariant | no_shared_library_grant | PASS |  |
| permission-invariant | default_deny | PASS |  |
| permission-invariant | every_entry_has_prerequisites_and_target_requirement | PASS |  |
| permission-invariant | probe entry carries PROBE_ALLOWED_PRIMITIVES | PASS |  |
| permission-invariant | no non-probe entry carries PROBE_ALLOWED_PRIMITIVES | PASS |  |
| permission-invariant | CONNECT/ENUMERATE_PROJECTS are SESSION scope; SNAPSHOT_CAPTURE is PROJECT_TIMELINE | PASS |  |
| permission-invariant | prerequisite_codes == library set | PASS |  |
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
| m3-probe | M3-MATRIX.md P15 row claims no rename | PASS | / P15 / project/timeline identity stable across save/reopen (v1.3: rename claim removed — no rename operation exists and |
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
| precedence-retired-terms | CANONICALIZATION.md | PASS |  |
| precedence-retired-terms | CLIENT-VERSION-INVENTORY.md | PASS |  |
| precedence-retired-terms | DOCTRINE.md | PASS |  |
| precedence-retired-terms | GUARD-AUTHORITY.md | PASS |  |
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
| precedence | v1.3 supersessions present | PASS |  |
| precedence | SCORECRAFT-EXTRACTION.md cites v1.3 active schemas, not v1.1 | PASS |  |
| timebase | canary_boundaries_ceil_law | PASS |  |
| timebase | canary_total_6756 | PASS |  |
| timebase | half_up_gives_6755 | PASS |  |
| guard | payload_equal_but_guard_differs | PASS |  |
| guard | human-timeline-mixed-provenance guard object validates | PASS |  |
| guard | human-timeline-mixed-provenance digests recompute | PASS |  |
| guard | m0-minimal-partial-observation guard object validates | PASS |  |
| guard | m0-minimal-partial-observation digests recompute | PASS |  |
| guard | write-precheck-complete guard object validates | PASS |  |
| guard | write-precheck-complete digests recompute | PASS |  |
| snapshot | partial item kept in canonical list with null end (not omitted, not invented) | PASS |  |
| snapshot | enumeration failure recorded in ledger | PASS |  |
| manifest | parent manifest sha pinned | PASS |  |
| manifest | schema | PASS |  |
| manifest | semantic (hashes, byte counts, lineage, inheritance flags) | PASS |  |
| manifest | every file on disk is listed | PASS |  |
| manifest | no listed file missing on disk | PASS | VALIDATION-REPORT.md |
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
