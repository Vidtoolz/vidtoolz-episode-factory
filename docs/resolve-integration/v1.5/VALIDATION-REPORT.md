# VALIDATION REPORT — Resolve authority bundle v1.5

Result: **1260/1260 checks passed**. Layers: raw parse -> schema -> evidence-binding -> attachment -> capability (derived success pipeline) -> snapshot (observation model, field provenance, occurrence uniqueness) -> semantic (binding, membership, readback->S1, derived verification over the protected surface) -> eligibility -> linked-set / composed authorization (validate_transaction_set, commit_eligibility). Every layered fixture records its expected failure layer; a check that raises is a FAIL. Order-independence: seeded permutations (seed 20260909, 4 per subject). The bypass audit proves no exported validator can skip S0, S1, capability provenance, delta derivation or expected-effect validation. The exact-manifest section binds against the real FREEZE-MANIFEST.json sha without printing it. Offline; no Resolve. Node conformance = M1. SCHEMA-VALID != AUTHORIZED TO MUTATE; passing proves internal consistency of the authority documents only. The total count is not proof: see the per-finding coverage below.

Layered fixture layers: {"eligibility": 4, "none": 37, "schema": 37, "semantic": 85, "snapshot": 53}

| Finding | Sections | Checks | Passed |
|---|---|---|---|
| F1 capability success derived | capability, capability-record, capability-record-negative, capability-qualification-negative | 73 | 73 |
| F2 occurrence uniqueness | occurrence-uniqueness | 7 | 7 |
| F3 delta surface / unrelated law | delta-surface, unrelated-change-law, append-effect | 27 | 27 |
| F4 commit single authority (BLOCKER) | bypass-audit, commit-eligibility | 56 | 56 |
| F5 journal/S1 binding | journal-s1-binding | 6 | 6 |
| F6 capability -> snapshot provenance | probe-vs-qualified, degraded-snapshot, guard | 16 | 16 |
| F7 S1 coverage profile law | s1-profile-law | 5 | 5 |
| attack matrix | v1.4-attack | 8 | 8 |
| order independence | order-independence | 5 | 5 |

| Section | Checks | Passed |
|---|---|---|
| active-authority | 6 | 6 |
| append-effect | 3 | 3 |
| attachment-derived | 69 | 69 |
| bypass-audit | 20 | 20 |
| canon-invariance | 3 | 3 |
| canon-rejection | 39 | 39 |
| canon-vector | 17 | 17 |
| capability | 18 | 18 |
| capability-qualification-negative | 22 | 22 |
| capability-record | 17 | 17 |
| capability-record-negative | 16 | 16 |
| commit-eligibility | 36 | 36 |
| degraded-snapshot | 4 | 4 |
| delta-surface | 15 | 15 |
| determinism | 3 | 3 |
| eligibility | 81 | 81 |
| eligibility-invariant | 4 | 4 |
| eligibility-request-schema | 81 | 81 |
| evidence-ref-negative | 9 | 9 |
| evidence-ref-positive | 1 | 1 |
| evidence-set-binding | 56 | 56 |
| evidence-set-binding-negative | 5 | 5 |
| evidence-set-schema | 60 | 60 |
| evidence-set-schema-negative | 1 | 1 |
| exact-manifest | 8 | 8 |
| f64-exact | 2 | 2 |
| fixture-eligibility-negative | 4 | 4 |
| fixture-layers | 1 | 1 |
| fixture-none | 1 | 1 |
| fixture-schema-negative | 37 | 37 |
| fixture-schema-positive | 179 | 179 |
| fixture-semantic-negative | 85 | 85 |
| fixture-semantic-positive | 36 | 36 |
| fixture-snapshot-negative | 53 | 53 |
| frozen-instance | 19 | 19 |
| frozen-instance-schema | 7 | 7 |
| frozen-instance-semantic | 6 | 6 |
| guard | 10 | 10 |
| journal-s1-binding | 6 | 6 |
| linked-set | 1 | 1 |
| linked-set-negative | 37 | 37 |
| linked-set-positive | 3 | 3 |
| m3-probe | 1 | 1 |
| manifest | 6 | 6 |
| manifest-negative | 9 | 9 |
| manifest-positive | 1 | 1 |
| milestone-matrix | 9 | 9 |
| occurrence-uniqueness | 7 | 7 |
| order-independence | 5 | 5 |
| parse | 3 | 3 |
| permission-invariant | 5 | 5 |
| precedence | 39 | 39 |
| precedence-retired-terms | 14 | 14 |
| precedence-supersession | 31 | 31 |
| probe-vs-qualified | 2 | 2 |
| s1-profile-law | 5 | 5 |
| schema-wellformed | 21 | 21 |
| timebase | 1 | 1 |
| unrelated-change-law | 9 | 9 |
| v1.4-attack | 8 | 8 |
| zero-qualified-reads | 3 | 3 |

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
| frozen-instance | TARGET-CONTRACT carries the evidence envelope law | PASS |  |
| frozen-instance | CAPABILITIES has zero QUALIFIED_READ rows in v1.5 | PASS |  |
| frozen-instance | every read row is probe_candidate | PASS |  |
| frozen-instance | CAPABILITIES refreeze block is unreviewed and promotes nothing (no probe ids, no evidence hashes) | PASS |  |
| frozen-instance | CAPABILITIES declares the machine pipeline RAW_EVIDENCE -> PARSE -> PARSED_RESULT -> REVIEW -> REFREEZE -> ACTIVE_CAPABILITY | PASS |  |
| frozen-instance | no prior-version evidence record claims a probe result | PASS |  |
| frozen-instance | probe produces CANDIDATE_EVIDENCE only and promotes nothing | PASS |  |
| frozen-instance | probe failure taxonomy equals the reference taxonomy | PASS |  |
| frozen-instance | every read primitive declares receiver and expected_type | PASS |  |
| frozen-instance | timeline observation status model covers start/end frame, start timecode, width, height | PASS |  |
| frozen-instance | snapshot schema requires collection.method_provenance (field provenance model) and knows APPEND_VERIFY | PASS |  |
| frozen-instance | guard schema is v3 and binds provenance_sha256 | PASS |  |
| frozen-instance | journal execution law: OP_STARTED -> APPLIED / OP_FAILED; READBACK_S1 after APPLIED | PASS |  |
| frozen-instance | plan schema requires the v1.5 linked-identity fields ['session_id'] | PASS |  |
| frozen-instance | journal schema requires the v1.5 linked-identity fields ['readback_guard_digest', 'readback_snapshot_sha256', 'session_id'] | PASS |  |
| frozen-instance | verification schema requires the v1.5 linked-identity fields ['session_id'] | PASS |  |
| frozen-instance | commit schema requires the v1.5 linked-identity fields ['s1_guard_digest', 's1_snapshot_sha256', 'session_id'] | PASS |  |
| active-authority | fixture placeholder is a well-formed sha256 and is not any real manifest | PASS |  |
| active-authority | fixture capability matrix sha equals CAPABILITIES.json on disk | PASS |  |
| active-authority | fixture hypothetical matrix sha equals the hypothetical file on disk | PASS |  |
| active-authority | hypothetical matrix is labelled HYPOTHETICAL_NOT_AUTHORITY and is not the frozen matrix | PASS |  |
| active-authority | hypothetical refrozen matrix is internally consistent (reviewed refreeze block promoting exact probe ids + raw hashes) | PASS |  |
| active-authority | hypothetical refreeze names every promoted raw evidence hash | PASS |  |
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
| evidence-set-schema | attached-evidence-getter-exception-accepted | PASS |  |
| evidence-set-binding | attached-evidence-getter-exception-accepted | PASS |  |
| evidence-set-schema | attached-evidence-label-success-parse-failed | PASS |  |
| evidence-set-binding | attached-evidence-label-success-parse-failed | PASS |  |
| evidence-set-schema | attached-evidence-no-raw | PASS |  |
| evidence-set-binding | attached-evidence-no-raw | PASS |  |
| evidence-set-schema | attached-evidence-null-result | PASS |  |
| evidence-set-binding | attached-evidence-null-result | PASS |  |
| evidence-set-schema | attached-evidence-old-authority | PASS |  |
| evidence-set-binding | attached-evidence-old-authority | PASS |  |
| evidence-set-schema | attached-evidence-old-refreeze | PASS |  |
| evidence-set-binding | attached-evidence-old-refreeze | PASS |  |
| evidence-set-schema | attached-evidence-parse-failed-accepted | PASS |  |
| evidence-set-binding | attached-evidence-parse-failed-accepted | PASS |  |
| evidence-set-schema | attached-evidence-promoted-other-raw | PASS |  |
| evidence-set-binding | attached-evidence-promoted-other-raw | PASS |  |
| evidence-set-schema | attached-evidence-raw-tampered | PASS |  |
| evidence-set-binding | attached-evidence-raw-tampered | PASS |  |
| evidence-set-schema | attached-evidence-review-other-raw | PASS |  |
| evidence-set-binding | attached-evidence-review-other-raw | PASS |  |
| evidence-set-schema | attached-evidence-wrong-build | PASS |  |
| evidence-set-binding | attached-evidence-wrong-build | PASS |  |
| evidence-set-schema | attached-evidence-wrong-observed-type | PASS |  |
| evidence-set-binding | attached-evidence-wrong-observed-type | PASS |  |
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
| evidence-set-binding-negative | invalid-bundle-other-manifest-not-historical | PASS | e8f00563c91c: BUNDLE_VERIFICATION bound to manifest 999999999999 != active reviewed manifest |
| evidence-set-schema | invalid-connection-other-authority | PASS |  |
| evidence-set-binding-negative | invalid-connection-other-authority | PASS | ad81fc4282e8: CONNECTION_OBSERVATION bound to authority 1.3.0 != active 1.5.0 |
| evidence-set-schema | invalid-connection-wrong-manifest | PASS |  |
| evidence-set-binding-negative | invalid-connection-wrong-manifest | PASS | bddb49cbf6a3: CONNECTION_OBSERVATION bound to manifest 999999999999 != active reviewed manifest |
| evidence-set-schema-negative | invalid-provisioning-without-root | PASS | not:records/e6ba4cbdeaf63b1ff4baa58e22e55743b5c7574045423484fdce678ba49753f5/envelope/library_root:None should not be valid under {'type': 'null'} |
| evidence-set-binding-negative | invalid-provisioning-without-root | PASS | e6ba4cbdeaf6: PROVISIONING_RECORD: envelope.library_root required at level LIBRARY |
| evidence-set-schema | invalid-tampered-record | PASS |  |
| evidence-set-binding-negative | invalid-tampered-record | PASS | 924d26d61415: record_id does not match content digest |
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
| evidence-ref-negative | uppercase sha | PASS | M3_AUTHORIZATION: reference is not a sha256 ('2BDDCFD2B4084171D4A5FE8F4476D9645925EC7FE721C8217DE0AB687D60C3C2') |
| evidence-ref-negative | unlinked sha | PASS | M3_AUTHORIZATION: referenced record 999999999999 not in evidence set |
| evidence-ref-negative | wrong type | PASS | M3_AUTHORIZATION: record 2bddcfd2b408 has type PROVISIONING_RECORD |
| evidence-ref-negative | short hex | PASS | M3_AUTHORIZATION: reference is not a sha256 ('2bddcfd2b4084171d4a5fe8f4476d9645925ec7fe721c8217de0ab687d60c3c') |
| evidence-ref-negative | sha with newline | PASS | M3_AUTHORIZATION: reference is not a sha256 ('2bddcfd2b4084171d4a5fe8f4476d9645925ec7fe721c8217de0ab687d60c3c2\n') |
| evidence-ref-negative | record for another host | PASS |  |
| evidence-ref-negative | record bound to another manifest is not evidence for the active authority | PASS |  |
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
| attachment-derived | attached-evidence-getter-exception-accepted -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-label-success-parse-failed -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-no-raw -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-null-result -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-old-authority -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-old-refreeze -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-parse-failed-accepted -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-promoted-other-raw -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-raw-tampered -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-review-other-raw -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-wrong-build -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-wrong-observed-type -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
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
| attachment-derived | invalid-bundle-other-manifest-not-historical -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', 'e8f00563c91c: BUNDLE_VERIFICATION bound to manifest 999999999999 != active reviewed manifest'] conflicts=[] |
| attachment-derived | invalid-connection-other-authority -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', 'ad81fc4282e8: CONNECTION_OBSERVATION bound to authority 1.3.0 != active 1.5.0'] conflicts=[] |
| attachment-derived | invalid-connection-wrong-manifest -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', 'bddb49cbf6a3: CONNECTION_OBSERVATION bound to manifest 999999999999 != active reviewed manifest'] conflicts=[] |
| attachment-derived | invalid-provisioning-without-root -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', 'e6ba4cbdeaf6: PROVISIONING_RECORD: envelope.library_root required at level LIBRARY'] conflicts=[] |
| attachment-derived | invalid-tampered-record -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', '924d26d61415: record_id does not match content digest'] conflicts=[] |
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
| attachment-derived | same evidence reversed gives an identical derivation | PASS |  |
| attachment-derived | historical BUNDLE_VERIFICATION never serves as current authority | PASS |  |
| attachment-derived | CONFLICT ranks below every ladder state | PASS |  |
| capability-record | attached-candidate-evidence-unreviewed | PASS |  |
| capability-record | attached-capability-failure-only | PASS |  |
| capability-record | attached-evidence-failed-getters | PASS |  |
| capability-record-negative | attached-evidence-getter-exception-accepted | PASS | a failed observation can never be ACCEPTed; a failed observation can never be ACCEPTed |
| capability-record-negative | attached-evidence-label-success-parse-failed | PASS | label SUCCESS contradicts derived classification CAPABILITY_FAILURE (parse/raw facts win); label SUCCESS contradicts derived classification CAPABILITY_FAILURE (parse/raw facts win) |
| capability-record | attached-evidence-no-raw | PASS |  |
| capability-record | attached-evidence-null-result | PASS |  |
| capability-record | attached-evidence-old-authority | PASS |  |
| capability-record | attached-evidence-old-refreeze | PASS |  |
| capability-record-negative | attached-evidence-parse-failed-accepted | PASS | a failed observation can never be ACCEPTed; a failed observation can never be ACCEPTed |
| capability-record-negative | attached-evidence-promoted-other-raw | PASS | promotion names another raw evidence hash than this record's; promotion names another raw evidence hash than this record's |
| capability-record | attached-evidence-raw-tampered | PASS |  |
| capability-record-negative | attached-evidence-review-other-raw | PASS | reviewed record must reference its own raw evidence hash; reviewed record must reference its own raw evidence hash |
| capability-record | attached-evidence-wrong-build | PASS |  |
| capability-record-negative | attached-evidence-wrong-observed-type | PASS | SUCCESS with observed type different from the primitive's expected type; SUCCESS with observed type different from the primitive's expected type |
| capability-record | attached-evidence-wrong-receiver | PASS |  |
| capability-record | attached-fatal-probe-failure | PASS |  |
| capability-record | attached-reviewed-evidence | PASS |  |
| capability-record | attached-reviewed-evidence-minus-getstartframe | PASS |  |
| capability-record | write-ready-full | PASS |  |
| capability-record | write-ready-hyp | PASS |  |
| capability-record | write-ready-plan-validation-fail | PASS |  |
| capability-record | write-ready-stale-guard-current | PASS |  |
| capability-record-negative | SUCCESS label with a failure code | PASS | SUCCESS requires success:true and code:null |
| capability-record-negative | failed observation ACCEPTed | PASS | a failed observation can never be ACCEPTed |
| capability-record-negative | unreviewed candidate with a decision | PASS | unreviewed candidate cannot carry a decision, promotion or review reference |
| capability-record-negative | ACCEPT without promotion | PASS | ACCEPT requires promoted_by {authority_version, capability_matrix_sha256, raw_evidence_sha256} |
| capability-record-negative | unknown classification | PASS | unknown classification FAILED: getter crashed |
| capability-record-negative | SUCCESS label over a parse failure | PASS | label SUCCESS contradicts derived classification CAPABILITY_FAILURE (parse/raw facts win) |
| capability-record-negative | SUCCESS label over a getter exception | PASS | label SUCCESS contradicts derived classification CAPABILITY_FAILURE (parse/raw facts win) |
| capability-record-negative | SUCCESS label over a null result | PASS | label SUCCESS contradicts derived classification CAPABILITY_FAILURE (parse/raw facts win) |
| capability-record-negative | parse block missing | PASS | label SUCCESS contradicts derived classification CAPABILITY_FAILURE (parse/raw facts win); parse block missing parser |
| capability-record-negative | review references another raw hash | PASS | reviewed record must reference its own raw evidence hash |
| capability | canonical success predicate accepts the honest record (raw + parse + type + shape + label agree) | PASS |  |
| capability | reviewed, promoted, raw-backed derived-SUCCESS record qualifies under the hypothetical active matrix | PASS |  |
| capability-qualification-negative | parser failure + ACCEPT review | PASS | parser did not succeed; parse error: ParseError |
| capability-qualification-negative | getter exception + ACCEPT review | PASS | getter exception: RuntimeError: getter crashed; derived classification CAPABILITY_FAILURE contradicts qualification |
| capability-qualification-negative | failed parsed result + current refreeze (label says SUCCESS) | PASS | parsed output shape/type not acceptable (shape_ok/non_null); derived classification CAPABILITY_FAILURE contradicts qualification |
| capability-qualification-negative | success label but raw/parsed facts indicate failure (non_null false) | PASS | parsed output shape/type not acceptable (shape_ok/non_null); derived classification CAPABILITY_FAILURE contradicts qualification |
| capability-qualification-negative | missing raw evidence | PASS | raw evidence object missing, not re-hashing or from another session |
| capability-qualification-negative | raw evidence tampered (hash mismatch) | PASS | raw evidence object missing, not re-hashing or from another session |
| capability-qualification-negative | raw evidence from another session | PASS | raw evidence object missing, not re-hashing or from another session |
| capability-qualification-negative | parsed output wrong type | PASS | observed type object != expected str |
| capability-qualification-negative | review references a different raw hash | PASS | review does not reference this exact raw evidence hash |
| capability-qualification-negative | refreeze/promotion names a different raw hash | PASS | refreeze promotion does not name this exact raw evidence |
| capability-qualification-negative | wrong build | PASS | host/product/version/build differ from the contract environment |
| capability-qualification-negative | wrong version | PASS | host/product/version/build differ from the contract environment |
| capability-qualification-negative | wrong host | PASS | host/product/version/build differ from the contract environment |
| capability-qualification-negative | wrong receiver/object class | PASS | receiver Fusion != expected Resolve |
| capability-qualification-negative | candidate not reviewed | PASS | not reviewed ACCEPT; review does not reference this exact raw evidence hash |
| capability-qualification-negative | reviewed but REJECTed | PASS | not reviewed ACCEPT; not promoted by the active authority version + capability matrix |
| capability-qualification-negative | promoted by an old refreeze (other matrix sha) | PASS | not promoted by the active authority version + capability matrix |
| capability-qualification-negative | promoted under another authority version | PASS | not promoted by the active authority version + capability matrix |
| capability-qualification-negative | active refreeze differs from the promoting matrix | PASS | not promoted by the active authority version + capability matrix |
| capability-qualification-negative | adjacent getter evidence (a review of evidence A cannot promote evidence B) | PASS |  |
| capability-qualification-negative | active refreeze that does not explicitly promote this raw evidence | PASS |  |
| capability-qualification-negative | unreviewed refreeze block cannot qualify | PASS |  |
| capability | frozen matrix + reviewed evidence -> UNQUALIFIED (candidate evidence never qualifies without a refrozen matrix) | PASS |  |
| capability | hypothetical refrozen matrix + reviewed linked evidence -> QUALIFIED_CALLABLE | PASS |  |
| capability | hypothetical matrix + unreviewed candidates -> UNQUALIFIED | PASS |  |
| capability | hypothetical matrix + failed getters -> UNQUALIFIED | PASS |  |
| capability | hypothetical matrix + wrong build -> UNQUALIFIED | PASS |  |
| capability | hypothetical matrix + old refreeze -> UNQUALIFIED | PASS |  |
| capability | hypothetical matrix + parse failed + ACCEPT -> UNQUALIFIED | PASS |  |
| capability | hypothetical matrix + getter exception + ACCEPT -> UNQUALIFIED | PASS |  |
| capability | hypothetical matrix + label SUCCESS over parse failure -> UNQUALIFIED | PASS |  |
| capability | hypothetical matrix + wrong observed type -> UNQUALIFIED | PASS |  |
| capability | hypothetical matrix + review references other raw -> UNQUALIFIED | PASS |  |
| capability | hypothetical matrix + promotion names other raw -> UNQUALIFIED | PASS |  |
| capability | hypothetical matrix + null result -> UNQUALIFIED | PASS |  |
| capability | classification is derived from parse facts (getter exception -> CAPABILITY_FAILURE regardless of label) | PASS |  |
| capability | probe entry on a probe_candidate row -> PROBE_ALLOWED under the frozen matrix | PASS |  |
| capability | unknown method -> UNKNOWN_METHOD | PASS |  |
| zero-qualified-reads | nothing is callable under the frozen v1.5 matrix | PASS |  |
| zero-qualified-reads | hypothetical refreeze makes every read primitive callable (positive path exists) | PASS |  |
| zero-qualified-reads | GetStartFrame alone drops out when its evidence is absent | PASS |  |
| fixture-schema-positive | capabilities-frozen | PASS |  |
| fixture-semantic-positive | capabilities-frozen | PASS |  |
| fixture-schema-negative | capabilities-missing-refreeze-block | PASS | required::'refreeze' is a required property |
| fixture-schema-positive | capabilities-qualified-read-evidence-not-promoted-by-refreeze | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-evidence-not-promoted-by-refreeze | PASS | row 'read: connection': evidence GetVersionString is not explicitly promoted by the refreeze block (probe id + raw evidence hash); row 'read: connection': probe_candidate only allowed on DOCUMENTED_NOT_QUALIFIED rows |
| fixture-schema-positive | capabilities-qualified-read-on-failed-evidence | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-on-failed-evidence | PASS | row 'read: connection': QUALIFIED_READ without exact reviewed SUCCESS version-matched evidence record promoted by this matrix version; row 'read: connection': QUALIFIED_READ requires a reviewed refreeze block on the matr |
| fixture-schema-positive | capabilities-qualified-read-promoted-by-other-refreeze | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-promoted-by-other-refreeze | PASS | row 'read: connection': QUALIFIED_READ without exact reviewed SUCCESS version-matched evidence record promoted by this matrix version; row 'read: connection': QUALIFIED_READ requires a reviewed refreeze block on the matr |
| fixture-schema-positive | capabilities-qualified-read-unreviewed-refreeze-block | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-unreviewed-refreeze-block | PASS | row 'read: connection': QUALIFIED_READ requires a reviewed refreeze block on the matrix; row 'read: connection': evidence GetVersionString is not explicitly promoted by the refreeze block (probe id + raw evidence hash);  |
| fixture-schema-positive | capabilities-qualified-read-without-exact-evidence | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-without-exact-evidence | PASS | row 'read: connection': QUALIFIED_READ without exact reviewed SUCCESS version-matched evidence record promoted by this matrix version; row 'read: connection': QUALIFIED_READ requires a reviewed refreeze block on the matr |
| fixture-schema-negative | capabilities-unknown-evidence-class | PASS | enum:rows/0/evidence_class:'QUALIFIED' is not one of ['QUALIFIED_READ', 'DOCUMENTED_NOT_QUALIFIED', 'NOT_TESTED', 'UNSUPPORTED', 'BLOCKED', 'QUALIFIED_EF_SIDE'] |
| fixture-schema-positive | capabilities-version-match-lie | PASS |  |
| fixture-semantic-negative | capabilities-version-match-lie | PASS | row 'read: connection': version_match true but version differs from contract |
| fixture-schema-positive | commit-direct-false-verified-consistent-hashes | PASS |  |
| fixture-semantic-negative | commit-direct-false-verified-consistent-hashes | PASS | verification: verification.changed differs from derived truth (declared [] vs derived [{"fields":{"source_end":{"after":352,"before":347},"source_start":{"after":5,"b); verification: verification.unrelated differs from d |
| fixture-schema-positive | commit-journal-head-mismatch | PASS |  |
| fixture-semantic-negative | commit-journal-head-mismatch | PASS | commit journal_head_sha256 does not match journal chain head |
| fixture-schema-positive | commit-journal-invented-operation | PASS |  |
| fixture-semantic-negative | commit-journal-invented-operation | PASS | journal: seq 5: operation_id op-9 is not in the bound plan operation set (journal invented an operation); journal: seq 5: APPLIED without a preceding OP_STARTED for op-9; journal: seq 6: READBACK_S1 before all plan opera |
| fixture-schema-positive | commit-linked-eligible | PASS |  |
| fixture-semantic-positive | commit-linked-eligible | PASS |  |
| fixture-schema-negative | commit-missing-s1-guard | PASS | required::'s1_guard_digest' is a required property |
| fixture-schema-negative | commit-missing-s1-snapshot-digest | PASS | required::'s1_snapshot_sha256' is a required property |
| fixture-schema-negative | commit-missing-session | PASS | required::'session_id' is a required property |
| fixture-schema-positive | commit-operation-set-mismatch | PASS |  |
| fixture-semantic-negative | commit-operation-set-mismatch | PASS | commit operation_set_digest != plan |
| fixture-schema-positive | commit-s1-guard-mismatch | PASS |  |
| fixture-semantic-negative | commit-s1-guard-mismatch | PASS | commit s1_guard_digest does not match S1 |
| fixture-schema-positive | commit-s1-snapshot-digest-mismatch | PASS |  |
| fixture-semantic-negative | commit-s1-snapshot-digest-mismatch | PASS | commit s1_snapshot_sha256 does not match the supplied S1 |
| fixture-schema-positive | commit-session-mismatch | PASS |  |
| fixture-semantic-negative | commit-session-mismatch | PASS | commit session_id != plan execution session |
| fixture-schema-positive | commit-target-mismatch | PASS |  |
| fixture-semantic-negative | commit-target-mismatch | PASS | commit target != plan target |
| fixture-schema-positive | commit-verification-hash-only-object-missing | PASS |  |
| fixture-semantic-negative | commit-verification-hash-only-object-missing | PASS | commit requires plan, journal, verification, S0, S1 objects and the active authority (hash-only or partial input refused) |
| fixture-schema-positive | commit-verification-not-derived-truth | PASS |  |
| fixture-semantic-negative | commit-verification-not-derived-truth | PASS | verification: verification.missing_expected differs from derived truth (declared [] vs derived ["op-1: APPEND produced no new occurrence on video:1 [110194,110541]"]); verification: verification.verdict differs from deri |
| fixture-schema-positive | commit-with-unresolved-conflict-record | PASS |  |
| fixture-semantic-negative | commit-with-unresolved-conflict-record | PASS | commit with unresolved conflict |
| fixture-schema-positive | commit-without-s0-object | PASS |  |
| fixture-semantic-negative | commit-without-s0-object | PASS | commit requires plan, journal, verification, S0, S1 objects and the active authority (hash-only or partial input refused) |
| fixture-schema-positive | commit-without-s1-object | PASS |  |
| fixture-semantic-negative | commit-without-s1-object | PASS | commit requires plan, journal, verification, S0, S1 objects and the active authority (hash-only or partial input refused) |
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
| fixture-schema-positive | journal-duplicate-readback-events | PASS |  |
| fixture-semantic-negative | journal-duplicate-readback-events | PASS | seq 6: illegal transition READBACK_S1 -> READBACK_S1; multiple READBACK_S1 records (ambiguous readback) |
| fixture-schema-positive | journal-empty | PASS |  |
| fixture-semantic-negative | journal-empty | PASS | empty journal |
| fixture-schema-positive | journal-guard-change-without-recovery | PASS |  |
| fixture-semantic-negative | journal-guard-change-without-recovery | PASS | seq 6: guard_digest changed without a recovery transition |
| fixture-schema-positive | journal-in-flight-no-readback-with-s1-supplied | PASS |  |
| fixture-semantic-negative | journal-in-flight-no-readback-with-s1-supplied | PASS | S1 supplied but the journal has no READBACK_S1 event |
| fixture-schema-positive | journal-invented-operation-started-and-applied | PASS |  |
| fixture-semantic-negative | journal-invented-operation-started-and-applied | PASS | seq 4: operation_id op-9 is not in the bound plan operation set (journal invented an operation); seq 5: operation_id op-9 is not in the bound plan operation set (journal invented an operation); seq 6: READBACK_S1 before  |
| fixture-schema-positive | journal-legal-chain | PASS |  |
| fixture-semantic-positive | journal-legal-chain | PASS |  |
| fixture-schema-negative | journal-missing-op-field | PASS | required::'op' is a required property |
| fixture-schema-negative | journal-missing-session-id | PASS | required::'session_id' is a required property |
| fixture-schema-positive | journal-non-operation-state-carries-operation | PASS |  |
| fixture-semantic-negative | journal-non-operation-state-carries-operation | PASS | seq 1: non-operation state LEASED carries operation_id/op |
| fixture-schema-positive | journal-non-readback-carries-readback-digest | PASS |  |
| fixture-semantic-negative | journal-non-readback-carries-readback-digest | PASS | seq 5: only READBACK_S1 may carry readback digests |
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
| fixture-schema-positive | journal-readback-guard-not-s1 | PASS |  |
| fixture-semantic-negative | journal-readback-guard-not-s1 | PASS | journal READBACK_S1 guard differs from the supplied S1 guard |
| fixture-schema-positive | journal-readback-names-other-s1 | PASS |  |
| fixture-semantic-negative | journal-readback-names-other-s1 | PASS | journal READBACK_S1 names a different S1 than the one supplied; journal READBACK_S1 guard differs from the supplied S1 guard |
| fixture-schema-positive | journal-readback-without-digests | PASS |  |
| fixture-semantic-negative | journal-readback-without-digests | PASS | seq 6: READBACK_S1 must name readback_snapshot_sha256 and readback_guard_digest; journal READBACK_S1 names a different S1 than the one supplied; journal READBACK_S1 guard differs from the supplied S1 guard |
| fixture-schema-positive | journal-record-after-terminal | PASS |  |
| fixture-semantic-negative | journal-record-after-terminal | PASS | seq 11: illegal transition COMMITTED -> APPLIED; seq 11: operation_id op-1 applied twice; seq 11: record after terminal state COMMITTED |
| fixture-schema-positive | journal-recovery-committed-recovered | PASS |  |
| fixture-semantic-positive | journal-recovery-committed-recovered | PASS |  |
| fixture-schema-positive | journal-recovery-not-applied | PASS |  |
| fixture-semantic-positive | journal-recovery-not-applied | PASS |  |
| fixture-schema-positive | journal-recovery-unlinked | PASS |  |
| fixture-semantic-negative | journal-recovery-unlinked | PASS | seq 1: recovery record not linked to original transaction |
| fixture-schema-positive | journal-s1-from-other-session | PASS |  |
| fixture-semantic-negative | journal-s1-from-other-session | PASS | supplied S1 was collected in a different session than the journal's execution session |
| fixture-schema-positive | journal-sequence-gap | PASS |  |
| fixture-semantic-negative | journal-sequence-gap | PASS | seq 5: sequence not contiguous (expected 2); seq 3: sequence not contiguous (expected 6) |
| fixture-schema-positive | journal-session-changes-mid-chain | PASS |  |
| fixture-semantic-negative | journal-session-changes-mid-chain | PASS | seq 7: session_id changed mid-chain |
| fixture-schema-positive | journal-session-not-plan-session | PASS |  |
| fixture-semantic-negative | journal-session-not-plan-session | PASS | journal session_id != plan execution session; supplied S1 was collected in a different session than the journal's execution session |
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
| fixture-schema-negative | plan-authority-version-old | PASS | const:authority_version:'1.5.0' was expected |
| fixture-schema-positive | plan-digest-not-of-body | PASS |  |
| fixture-semantic-negative | plan-digest-not-of-body | PASS | plan_digest does not match plan body digest; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 5884a9247d82 plan_digest='fc3fa968f0124302167726d8637d4052d69bc3085533448aab5c7648ee6948e0' != '000 |
| fixture-schema-positive | plan-duplicate-operation-id | PASS |  |
| fixture-semantic-negative | plan-duplicate-operation-id | PASS | operation ids must be unique and non-empty; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 5884a9247d82 plan_digest='fc3fa968f0124302167726d8637d4052d69bc3085533448aab5c7648ee6948e0' != '6228 |
| fixture-schema-positive | plan-eligible-without-prepared-journal | PASS |  |
| fixture-eligibility-negative | plan-eligible-without-prepared-journal | PASS | operation APPEND not eligible: ['JOURNAL_PREPARED (JOURNAL_PREPARED: referenced record 5884a9247d82 not in evidence set)', 'PLAN_VALIDATED (PLAN_VALIDATION: referenced record 6dac706a71cb not in evidence set)', 'GUARD_CU |
| fixture-schema-positive | plan-guard-record-not-current | PASS |  |
| fixture-eligibility-negative | plan-guard-record-not-current | PASS | operation APPEND not eligible: ['GUARD_CURRENT (guard record is not the CURRENT guard observation (CURRENT))'] |
| fixture-schema-positive | plan-m2-append-not-permitted | PASS |  |
| fixture-semantic-negative | plan-m2-append-not-permitted | PASS | operation APPEND not permitted at M2/SCRATCH_QUALIFICATION_LIBRARY: ['NOT_PERMITTED_BY_POLICY:no explicit entry (default DENY)'] |
| fixture-schema-positive | plan-m3-append-eligible | PASS |  |
| fixture-semantic-positive | plan-m3-append-eligible | PASS |  |
| fixture-schema-positive | plan-missing-m3-authorization | PASS |  |
| fixture-eligibility-negative | plan-missing-m3-authorization | PASS | operation APPEND not eligible: ['MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: reference is not a sha256 (None))'] |
| fixture-schema-negative | plan-missing-session | PASS | required::'session_id' is a required property |
| fixture-schema-positive | plan-operation-set-digest-mismatch | PASS |  |
| fixture-semantic-negative | plan-operation-set-digest-mismatch | PASS | operation_set_digest does not match operations; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 5884a9247d82 plan_digest='fc3fa968f0124302167726d8637d4052d69bc3085533448aab5c7648ee6948e0' != ' |
| fixture-schema-positive | plan-plan-validation-record-fail | PASS |  |
| fixture-eligibility-negative | plan-plan-validation-record-fail | PASS | operation APPEND not eligible: ['PLAN_VALIDATED (PLAN_VALIDATION: referenced record 6dac706a71cb not in evidence set)'] |
| fixture-schema-positive | plan-read-class-with-append | PASS |  |
| fixture-semantic-negative | plan-read-class-with-append | PASS | RESOLVE_READ permission class cannot carry write operations; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 5884a9247d82 plan_digest='fc3fa968f0124302167726d8637d4052d69bc3085533448aab5c7648e |
| fixture-schema-positive | plan-selector-target-mismatch | PASS |  |
| fixture-semantic-negative | plan-selector-target-mismatch | PASS | operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 5884a9247d82 plan_digest='fc3fa968f0124302167726d8637d4052d69bc3085533448aab5c7648ee6948e0' != '2f8ba962ce5ea9d53b672eaa8126d3e531c6459599eb8277 |
| fixture-schema-positive | plan-session-not-current | PASS |  |
| fixture-semantic-negative | plan-session-not-current | PASS | plan session_id != evidence set current_session_id (execution session mismatch); operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 5884a9247d82 plan_digest='fc3fa968f0124302167726d8637d4052d69bc |
| fixture-schema-positive | plan-stale-guard | PASS |  |
| fixture-semantic-negative | plan-stale-guard | PASS | operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 5884a9247d82 plan_digest='fc3fa968f0124302167726d8637d4052d69bc3085533448aab5c7648ee6948e0' != 'd24deecb12bc3ac30f6e3cd39d26eb778c18274bd4d24995 |
| fixture-schema-positive | read-primitives-class-mismatch-with-matrix | PASS |  |
| fixture-semantic-negative | read-primitives-class-mismatch-with-matrix | PASS | SNAPSHOT_CAPTURE: primitive GetTrackCount evidence_class QUALIFIED_READ != matrix DOCUMENTED_NOT_QUALIFIED |
| fixture-schema-positive | read-primitives-frozen | PASS |  |
| fixture-semantic-positive | read-primitives-frozen | PASS |  |
| fixture-schema-negative | read-primitives-invented-target-requirement | PASS | enum:logical_operations/CONNECT/target_requirement:'CURRENT_PROJECT' is not one of ['SESSION', 'PROJECT', 'PROJECT_TIMELINE'] |
| fixture-schema-negative | read-primitives-missing-expected-type | PASS | required:logical_operations/CONNECT/primitives/0:'expected_type' is a required property |
| fixture-schema-negative | read-primitives-missing-receiver | PASS | required:logical_operations/CONNECT/primitives/0:'receiver' is a required property |
| fixture-schema-positive | read-primitives-probe-allowed-outside-probe | PASS |  |
| fixture-semantic-negative | read-primitives-probe-allowed-outside-probe | PASS | SNAPSHOT_CAPTURE: probe_allowed primitives only inside READ_PRIMITIVE_QUALIFICATION_PROBE |
| fixture-schema-positive | read-primitives-taxonomy-drift | PASS |  |
| fixture-semantic-negative | read-primitives-taxonomy-drift | PASS | probe failure_taxonomy differs from authority_lib.PROBE_FAILURE_TAXONOMY |
| fixture-schema-positive | snapshot-append-verify-profile-complete | PASS |  |
| fixture-semantic-positive | snapshot-append-verify-profile-complete | PASS |  |
| fixture-schema-positive | snapshot-candidate-observation-honest-unavailable | PASS |  |
| fixture-semantic-positive | snapshot-candidate-observation-honest-unavailable | PASS |  |
| fixture-schema-positive | snapshot-claims-callable-not-in-authority | PASS |  |
| fixture-snapshot-negative | snapshot-claims-callable-not-in-authority | PASS | collection.method_provenance claims GetStart QUALIFIED_OBSERVATION but the active authority does not qualify it |
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
| fixture-snapshot-negative | snapshot-complete-write-precheck-missing-domains | PASS | complete:true but mandatory domains not observed: ['guard', 'item_identity', 'item_source_bounds', 'policy', 'track_locks']; complete:true under WRITE_PRECHECK with unresolved item fields ['media_pool_item_unique_id', 's |
| fixture-schema-positive | snapshot-degraded-start-frame-claimed-observed | PASS |  |
| fixture-snapshot-negative | snapshot-degraded-start-frame-claimed-observed | PASS | method_provenance[GetStartFrame]: capability_evidence_record_id does not resolve to a CAPABILITY_EVIDENCE record; timeline.start_frame: OBSERVED but producing primitive(s) ['GetStartFrame'] not callable in this session;  |
| fixture-schema-positive | snapshot-degraded-start-frame-claims-complete | PASS |  |
| fixture-snapshot-negative | snapshot-degraded-start-frame-claims-complete | PASS | complete:true under FULL_TIMELINE_READ with unresolved timeline fields ['start_frame'] |
| fixture-schema-positive | snapshot-degraded-start-frame-unavailable-honest | PASS |  |
| fixture-semantic-positive | snapshot-degraded-start-frame-unavailable-honest | PASS |  |
| fixture-schema-positive | snapshot-degraded-start-frame-value-with-unavailable | PASS |  |
| fixture-snapshot-negative | snapshot-degraded-start-frame-value-with-unavailable | PASS | timeline.start_frame: status UNAVAILABLE but value present (fabrication) |
| fixture-schema-positive | snapshot-duplicate-occurrence-identity-across-tracks | PASS |  |
| fixture-snapshot-negative | snapshot-duplicate-occurrence-identity-across-tracks | PASS | DUPLICATE_OCCURRENCE_IDENTITY: it-1 at audio:1#0,video:1#0 |
| fixture-schema-positive | snapshot-duplicate-occurrence-identity-reversed-order | PASS |  |
| fixture-snapshot-negative | snapshot-duplicate-occurrence-identity-reversed-order | PASS | DUPLICATE_OCCURRENCE_IDENTITY: it-1 at video:1#0,video:1#2 |
| fixture-schema-positive | snapshot-duplicate-occurrence-identity | PASS |  |
| fixture-snapshot-negative | snapshot-duplicate-occurrence-identity | PASS | DUPLICATE_OCCURRENCE_IDENTITY: it-1 at video:1#0,video:1#2 |
| fixture-schema-positive | snapshot-duration-contradiction | PASS |  |
| fixture-snapshot-negative | snapshot-duration-contradiction | PASS | item[video:1#0]: duration inconsistent with both candidate conventions |
| fixture-schema-positive | snapshot-end-before-start | PASS |  |
| fixture-snapshot-negative | snapshot-end-before-start | PASS | item[video:1#0]: end < start; item[video:1#0]: duration inconsistent with both candidate conventions |
| fixture-schema-positive | snapshot-fabricated-id | PASS |  |
| fixture-snapshot-negative | snapshot-fabricated-id | PASS | item[video:1#0].unique_id: status UNAVAILABLE but value present (fabrication) |
| fixture-schema-positive | snapshot-full-profile-timeline-identity-unavailable-complete | PASS |  |
| fixture-snapshot-negative | snapshot-full-profile-timeline-identity-unavailable-complete | PASS | complete:true under FULL_TIMELINE_READ but timeline.unique_id not OBSERVED |
| fixture-schema-positive | snapshot-full-read-claimed-under-frozen-matrix | PASS |  |
| fixture-snapshot-negative | snapshot-full-read-claimed-under-frozen-matrix | PASS | method_provenance[GetClipEnabled]: capability_matrix_sha256 is not the active matrix; method_provenance[GetClipEnabled]: capability_evidence_record_id does not resolve to a CAPABILITY_EVIDENCE record; method_provenance[G |
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
| fixture-snapshot-negative | snapshot-m0-domain-observed-without-callable | PASS | OBSERVED data relies on GetTrackCount whose observation_class is NOT_CALLABLE (candidate/probe output is never OBSERVED); a domain cannot be both observed and unobservable/deferred; domain tracks observed but producing p |
| fixture-schema-positive | snapshot-m0-minimal-complete-qualified | PASS |  |
| fixture-semantic-positive | snapshot-m0-minimal-complete-qualified | PASS |  |
| fixture-schema-positive | snapshot-m0-minimal-nothing-qualified-honest | PASS |  |
| fixture-semantic-positive | snapshot-m0-minimal-nothing-qualified-honest | PASS |  |
| fixture-schema-positive | snapshot-m0-project-identity-error-honest | PASS |  |
| fixture-semantic-positive | snapshot-m0-project-identity-error-honest | PASS |  |
| fixture-schema-positive | snapshot-m0-timeline-frames-observed-nothing-qualified | PASS |  |
| fixture-snapshot-negative | snapshot-m0-timeline-frames-observed-nothing-qualified | PASS | OBSERVED data relies on GetEndFrame whose observation_class is NOT_CALLABLE (candidate/probe output is never OBSERVED); OBSERVED data relies on GetStartFrame whose observation_class is NOT_CALLABLE (candidate/probe outpu |
| fixture-schema-positive | snapshot-m0-track-observed-nothing-qualified | PASS |  |
| fixture-snapshot-negative | snapshot-m0-track-observed-nothing-qualified | PASS | OBSERVED data relies on GetIsTrackEnabled whose observation_class is NOT_CALLABLE (candidate/probe output is never OBSERVED); OBSERVED data relies on GetIsTrackLocked whose observation_class is NOT_CALLABLE (candidate/pr |
| fixture-schema-negative | snapshot-missing-method-provenance | PASS | required:collection:'method_provenance' is a required property |
| fixture-schema-negative | snapshot-missing-ordinal | PASS | oneOf:payload/tracks/0/items/0:{'unique_id': 'it-1', 'name': 'still-001', 'start': 108000, 'end': 108347, 'duration': 347, 'enabled': True, 'markers': [], 'identity_observed': 'COMPLETE', 'field_status': {'unique_id': 'O |
| fixture-schema-negative | snapshot-negative-frame | PASS | oneOf:payload/tracks/0/items/0:{'unique_id': 'it-1', 'observation_ordinal': 0, 'name': 'still-001', 'start': -5, 'end': 108347, 'duration': 347, 'enabled': True, 'markers': [], 'identity_observed': 'COMPLETE', 'field_sta |
| fixture-schema-positive | snapshot-not-requested-with-value | PASS |  |
| fixture-snapshot-negative | snapshot-not-requested-with-value | PASS | item[video:1#0].enabled: status NOT_REQUESTED but value present (fabrication); complete:true under FULL_TIMELINE_READ with unresolved item fields ['enabled'] |
| fixture-schema-positive | snapshot-observed-backed-by-candidate-observation | PASS |  |
| fixture-snapshot-negative | snapshot-observed-backed-by-candidate-observation | PASS | OBSERVED data relies on GetStartFrame whose observation_class is CANDIDATE_OBSERVATION (candidate/probe output is never OBSERVED) |
| fixture-schema-positive | snapshot-observed-field-without-callable-primitive | PASS |  |
| fixture-snapshot-negative | snapshot-observed-field-without-callable-primitive | PASS | method_provenance[GetClipEnabled]: capability_evidence_record_id does not resolve to a CAPABILITY_EVIDENCE record; method_provenance[GetCurrentTimeline]: capability_evidence_record_id does not resolve to a CAPABILITY_EVI |
| fixture-schema-positive | snapshot-observed-start-null | PASS |  |
| fixture-snapshot-negative | snapshot-observed-start-null | PASS | item[video:1#0].start: status OBSERVED but value null; canonicalization error: not a numeric quantity: None |
| fixture-schema-positive | snapshot-observed-status-null-value | PASS |  |
| fixture-snapshot-negative | snapshot-observed-status-null-value | PASS | item[video:1#0].unique_id: status OBSERVED but value null |
| fixture-schema-positive | snapshot-observed-without-provenance-entry | PASS |  |
| fixture-snapshot-negative | snapshot-observed-without-provenance-entry | PASS | OBSERVED data relies on GetStartFrame but collection.method_provenance has no entry (value exists != OBSERVED) |
| fixture-schema-negative | snapshot-postgres-library | PASS | enum:library/db_type:'PostgreSQL' is not one of ['Disk'] |
| fixture-schema-positive | snapshot-project-identity-null-observed | PASS |  |
| fixture-snapshot-negative | snapshot-project-identity-null-observed | PASS | project.unique_id: status OBSERVED but value null |
| fixture-schema-positive | snapshot-project-identity-value-with-unavailable | PASS |  |
| fixture-snapshot-negative | snapshot-project-identity-value-with-unavailable | PASS | project.unique_id: status UNAVAILABLE but value present (fabrication) |
| fixture-schema-positive | snapshot-provenance-cites-adjacent-getter | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-cites-adjacent-getter | PASS | method_provenance[GetStartFrame]: cited evidence is for GetEndFrame (adjacent getter) |
| fixture-schema-positive | snapshot-provenance-cites-failed-evidence | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-cites-failed-evidence | PASS | method_provenance[GetClipEnabled]: capability_evidence_record_id does not resolve to a CAPABILITY_EVIDENCE record; method_provenance[GetCurrentTimeline]: capability_evidence_record_id does not resolve to a CAPABILITY_EVI |
| fixture-schema-positive | snapshot-provenance-cites-unreviewed-evidence | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-cites-unreviewed-evidence | PASS | method_provenance[GetClipEnabled]: capability_evidence_record_id does not resolve to a CAPABILITY_EVIDENCE record; method_provenance[GetCurrentTimeline]: capability_evidence_record_id does not resolve to a CAPABILITY_EVI |
| fixture-schema-positive | snapshot-provenance-evidence-not-in-set | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-evidence-not-in-set | PASS | method_provenance[GetStartFrame]: capability_evidence_record_id does not resolve to a CAPABILITY_EVIDENCE record |
| fixture-schema-positive | snapshot-provenance-matrix-not-active | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-matrix-not-active | PASS | method_provenance[GetStartFrame]: capability_matrix_sha256 is not the active matrix |
| fixture-schema-positive | snapshot-provenance-qualified-without-evidence-id | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-qualified-without-evidence-id | PASS | method_provenance[GetStartFrame]: QUALIFIED_OBSERVATION requires capability_evidence_record_id and capability_matrix_sha256; method_provenance[GetStartFrame]: capability_evidence_record_id does not resolve to a CAPABILIT |
| fixture-schema-negative | snapshot-provenance-unknown-class | PASS | enum:collection/method_provenance/GetStartFrame/observation_class:'TRUSTED' is not one of ['QUALIFIED_OBSERVATION', 'CANDIDATE_OBSERVATION', 'NOT_CALLABLE'] |
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
| fixture-schema-positive | verification-append-on-wrong-track-not-verified | PASS |  |
| fixture-semantic-positive | verification-append-on-wrong-track-not-verified | PASS |  |
| fixture-schema-positive | verification-append-wrong-media-not-verified | PASS |  |
| fixture-semantic-positive | verification-append-wrong-media-not-verified | PASS |  |
| fixture-schema-positive | verification-arbitrary-readback-hash | PASS |  |
| fixture-semantic-negative | verification-arbitrary-readback-hash | PASS | verification S1 digests do not resolve to the supplied S1 snapshot; verification readback digest != journal READBACK_S1 digest |
| fixture-schema-positive | verification-arbitrary-s1-hash | PASS |  |
| fixture-semantic-negative | verification-arbitrary-s1-hash | PASS | verification S1 digests do not resolve to the supplied S1 snapshot |
| fixture-schema-negative | verification-claims-human-approval | PASS | const:is_human_approval:False was expected |
| fixture-schema-positive | verification-delta-authority-mismatch | PASS |  |
| fixture-semantic-negative | verification-delta-authority-mismatch | PASS | verification expected-delta authority != plan operation set |
| fixture-schema-positive | verification-derived-append-missing | PASS |  |
| fixture-semantic-positive | verification-derived-append-missing | PASS |  |
| fixture-schema-positive | verification-derived-unrelated-enabled-change | PASS |  |
| fixture-semantic-positive | verification-derived-unrelated-enabled-change | PASS |  |
| fixture-schema-positive | verification-derived-unrelated-marker-change | PASS |  |
| fixture-semantic-positive | verification-derived-unrelated-marker-change | PASS |  |
| fixture-schema-positive | verification-derived-unrelated-media-dependency-change | PASS |  |
| fixture-semantic-positive | verification-derived-unrelated-media-dependency-change | PASS |  |
| fixture-schema-positive | verification-derived-unrelated-source-bound-change | PASS |  |
| fixture-semantic-positive | verification-derived-unrelated-source-bound-change | PASS |  |
| fixture-schema-positive | verification-derived-unrelated-timeline-dimension-change | PASS |  |
| fixture-semantic-positive | verification-derived-unrelated-timeline-dimension-change | PASS |  |
| fixture-schema-positive | verification-derived-unrelated-timeline-end-change | PASS |  |
| fixture-semantic-positive | verification-derived-unrelated-timeline-end-change | PASS |  |
| fixture-schema-positive | verification-derived-unrelated-timeline-settings-change | PASS |  |
| fixture-semantic-positive | verification-derived-unrelated-timeline-settings-change | PASS |  |
| fixture-schema-positive | verification-derived-unrelated-timeline-start-change | PASS |  |
| fixture-semantic-positive | verification-derived-unrelated-timeline-start-change | PASS |  |
| fixture-schema-positive | verification-derived-unrelated-track-name-change | PASS |  |
| fixture-semantic-positive | verification-derived-unrelated-track-name-change | PASS |  |
| fixture-schema-positive | verification-derived-unrelated-track-topology-change | PASS |  |
| fixture-semantic-positive | verification-derived-unrelated-track-topology-change | PASS |  |
| fixture-schema-positive | verification-derived-verified-append-verify-profile | PASS |  |
| fixture-semantic-positive | verification-derived-verified-append-verify-profile | PASS |  |
| fixture-schema-positive | verification-derived-verified | PASS |  |
| fixture-semantic-positive | verification-derived-verified | PASS |  |
| fixture-schema-positive | verification-duplicate-identity-claims-verified | PASS |  |
| fixture-semantic-negative | verification-duplicate-identity-claims-verified | PASS | verification.added differs from derived truth (declared [{"duration":347,"enabled":true,"end":110541,"markers":[],"media_id":"mid-it-new vs derived []); verification.creation_identity_map differs from derived truth (decl |
| fixture-schema-positive | verification-duplicate-identity-reversed-claims-verified | PASS |  |
| fixture-semantic-negative | verification-duplicate-identity-reversed-claims-verified | PASS | verification.added differs from derived truth (declared [{"duration":347,"enabled":true,"end":110541,"markers":[],"media_id":"mid-it-new vs derived []); verification.creation_identity_map differs from derived truth (decl |
| fixture-schema-positive | verification-duplicate-identity-unobservable | PASS |  |
| fixture-semantic-positive | verification-duplicate-identity-unobservable | PASS |  |
| fixture-schema-positive | verification-effect-not-specified-claims-verified | PASS |  |
| fixture-semantic-negative | verification-effect-not-specified-claims-verified | PASS | VERIFIED claimed for an operation whose effect law is NOT_YET_SPECIFIED; verification.missing_expected differs from derived truth (declared [] vs derived ["op-2: effect of SET_PROPERTIES NOT_YET_SPECIFIED; cannot verify" |
| fixture-schema-positive | verification-effect-not-specified-derived | PASS |  |
| fixture-semantic-positive | verification-effect-not-specified-derived | PASS |  |
| fixture-schema-positive | verification-hides-unrelated-enabled-change | PASS |  |
| fixture-semantic-negative | verification-hides-unrelated-enabled-change | PASS | verification.changed differs from derived truth (declared [] vs derived [{"fields":{"enabled":{"after":false,"before":true}},"unique_id":"it-3"}]); verification.unrelated differs from derived truth (declared [] vs derive |
| fixture-schema-positive | verification-hides-unrelated-marker-change | PASS |  |
| fixture-semantic-negative | verification-hides-unrelated-marker-change | PASS | verification.unrelated differs from derived truth (declared [] vs derived ["marker added ''@109000"]); verification.verdict differs from derived truth (declared "VERIFIED" vs derived "UNEXPECTED_DELTA") |
| fixture-schema-positive | verification-hides-unrelated-media-dependency-change | PASS |  |
| fixture-semantic-negative | verification-hides-unrelated-media-dependency-change | PASS | verification.unrelated differs from derived truth (declared [] vs derived ["media dependency added '/qual/media/unexpected.png'"]); verification.verdict differs from derived truth (declared "VERIFIED" vs derived "UNEXPEC |
| fixture-schema-positive | verification-hides-unrelated-source-bound-change | PASS |  |
| fixture-semantic-negative | verification-hides-unrelated-source-bound-change | PASS | verification.changed differs from derived truth (declared [] vs derived [{"fields":{"source_end":{"after":352,"before":347},"source_start":{"after":5,"b); verification.unrelated differs from derived truth (declared [] vs |
| fixture-schema-positive | verification-hides-unrelated-timeline-dimension-change | PASS |  |
| fixture-semantic-negative | verification-hides-unrelated-timeline-dimension-change | PASS | verification.unrelated differs from derived truth (declared [] vs derived ["timeline.width changed"]); verification.verdict differs from derived truth (declared "VERIFIED" vs derived "UNEXPECTED_DELTA") |
| fixture-schema-positive | verification-hides-unrelated-timeline-end-change | PASS |  |
| fixture-semantic-negative | verification-hides-unrelated-timeline-end-change | PASS | verification.unrelated differs from derived truth (declared [] vs derived ["timeline.end_frame changed"]); verification.verdict differs from derived truth (declared "VERIFIED" vs derived "UNEXPECTED_DELTA") |
| fixture-schema-positive | verification-hides-unrelated-timeline-settings-change | PASS |  |
| fixture-semantic-negative | verification-hides-unrelated-timeline-settings-change | PASS | verification.unrelated differs from derived truth (declared [] vs derived ["timeline.settings changed"]); verification.verdict differs from derived truth (declared "VERIFIED" vs derived "UNEXPECTED_DELTA") |
| fixture-schema-positive | verification-hides-unrelated-timeline-start-change | PASS |  |
| fixture-semantic-negative | verification-hides-unrelated-timeline-start-change | PASS | verification.unrelated differs from derived truth (declared [] vs derived ["timeline.start_frame changed"]); verification.verdict differs from derived truth (declared "VERIFIED" vs derived "UNEXPECTED_DELTA") |
| fixture-schema-positive | verification-hides-unrelated-track-name-change | PASS |  |
| fixture-semantic-negative | verification-hides-unrelated-track-name-change | PASS | verification.unrelated differs from derived truth (declared [] vs derived ["track video:1 changed: name"]); verification.verdict differs from derived truth (declared "VERIFIED" vs derived "UNEXPECTED_DELTA") |
| fixture-schema-positive | verification-hides-unrelated-track-topology-change | PASS |  |
| fixture-semantic-negative | verification-hides-unrelated-track-topology-change | PASS | verification.unrelated differs from derived truth (declared [] vs derived ["track added video:3"]); verification.verdict differs from derived truth (declared "VERIFIED" vs derived "UNEXPECTED_DELTA") |
| fixture-schema-positive | verification-journal-readback-names-other-s1 | PASS |  |
| fixture-semantic-negative | verification-journal-readback-names-other-s1 | PASS | verification readback digest != journal READBACK_S1 digest |
| fixture-schema-negative | verification-missing-applied-ops | PASS | required::'applied_operation_ids' is a required property |
| fixture-schema-negative | verification-missing-session | PASS | required::'session_id' is a required property |
| fixture-schema-positive | verification-other-plan | PASS |  |
| fixture-semantic-negative | verification-other-plan | PASS | verification refers to another plan |
| fixture-schema-positive | verification-other-session | PASS |  |
| fixture-semantic-negative | verification-other-session | PASS | verification session_id != plan execution session |
| fixture-schema-positive | verification-other-target | PASS |  |
| fixture-semantic-negative | verification-other-target | PASS | verification refers to another target |
| fixture-schema-positive | verification-other-transaction | PASS |  |
| fixture-semantic-negative | verification-other-transaction | PASS | verification refers to another transaction |
| fixture-schema-positive | verification-s0-hash-not-plan-guard | PASS |  |
| fixture-semantic-negative | verification-s0-hash-not-plan-guard | PASS | verification guard mismatch; verification S0 digests do not resolve to the supplied S0 snapshot |
| fixture-schema-positive | verification-s1-from-other-session | PASS |  |
| fixture-semantic-negative | verification-s1-from-other-session | PASS | lineage: S1 was collected in a different session than S0; lineage: S1 session differs from the plan's execution session |
| fixture-schema-positive | verification-s1-other-epoch | PASS |  |
| fixture-semantic-negative | verification-s1-other-epoch | PASS | lineage: S1 target_epoch differs from S0 |
| fixture-schema-positive | verification-without-readback-event | PASS |  |
| fixture-semantic-negative | verification-without-readback-event | PASS | journal has no single READBACK_S1 event to bind the verification to |
| fixture-layers | layers present | PASS | {'none': 37, 'schema': 37, 'semantic': 85, 'eligibility': 4, 'snapshot': 53} |
| linked-set-negative | linked-set-append-without-effect-honest-verdict-no-commit | PASS | effects: derived verdict is EXPECTED_DELTA_MISSING (missing=['op-1: APPEND produced no new occurrence on video:1 [110194,110541]'] unrelated=[]); commit impossible; commit: commit without VERIFIED verification |
| commit-eligibility | linked-set-append-without-effect-honest-verdict-no-commit | PASS | eligible=False stages=12 errors=["effects: derived verdict is EXPECTED_DELTA_MISSING (missing=['op-1: APPEND produced no new occurrence on video:1 [110194,110541]'] unrelated=[]); commit impossible", 'commit: commit with |
| linked-set-negative | linked-set-append-without-effect | PASS | effects: derived verdict is EXPECTED_DELTA_MISSING (missing=['op-1: APPEND produced no new occurrence on video:1 [110194,110541]'] unrelated=[]); commit impossible; verification: verification.missing_expected differs fro |
| commit-eligibility | linked-set-append-without-effect | PASS | eligible=False stages=12 errors=["effects: derived verdict is EXPECTED_DELTA_MISSING (missing=['op-1: APPEND produced no new occurrence on video:1 [110194,110541]'] unrelated=[]); commit impossible", 'verification: verif |
| linked-set-negative | linked-set-combined-duplicate-identity-other-session | PASS | journal: supplied S1 was collected in a different session than the journal's execution session; s1: DUPLICATE_OCCURRENCE_IDENTITY: it-1 at video:1#0,video:1#6; lineage: S1 was collected in a different session than S0; li |
| commit-eligibility | linked-set-combined-duplicate-identity-other-session | PASS | eligible=False stages=12 errors=["journal: supplied S1 was collected in a different session than the journal's execution session", 's1: DUPLICATE_OCCURRENCE_IDENTITY: it-1 at video:1#0,video:1#6'] |
| linked-set-negative | linked-set-combined-weak-s1-other-session-hidden-change | PASS | journal: supplied S1 was collected in a different session than the journal's execution session; lineage: S1 was collected in a different session than S0; lineage: S1 session differs from the plan's execution session; s1: |
| commit-eligibility | linked-set-combined-weak-s1-other-session-hidden-change | PASS | eligible=False stages=12 errors=["journal: supplied S1 was collected in a different session than the journal's execution session", 'lineage: S1 was collected in a different session than S0'] |
| linked-set-negative | linked-set-commit-without-s1 | PASS | commit: INELIGIBLE without linked S1 and verification objects |
| commit-eligibility | linked-set-commit-without-s1 | PASS | eligible=False stages=0 errors=['commit INELIGIBLE: linked s1_snapshot missing', 'commit INELIGIBLE: linked verification missing'] |
| linked-set-positive | linked-set-committed-append-verify-profile | PASS |  |
| commit-eligibility | linked-set-committed-append-verify-profile | PASS | eligible=True stages=12 errors=[] |
| linked-set-positive | linked-set-committed-consistent | PASS |  |
| commit-eligibility | linked-set-committed-consistent | PASS | eligible=True stages=12 errors=[] |
| linked-set-negative | linked-set-committed-journal-without-commit | PASS | journal reached COMMITTED without a commit manifest |
| linked-set-negative | linked-set-direct-false-verified-consistent-hashes | PASS | effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['changed it-1: source_end,source_start']); commit impossible; verification: verification.changed differs from derived truth (declared [] vs derived [{"f |
| commit-eligibility | linked-set-direct-false-verified-consistent-hashes | PASS | eligible=False stages=12 errors=["effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['changed it-1: source_end,source_start']); commit impossible", 'verification: verification.changed differs from derive |
| linked-set-negative | linked-set-duplicate-occurrence-identity-reversed | PASS | s1: DUPLICATE_OCCURRENCE_IDENTITY: it-1 at video:1#0,video:1#6; delta: S1: DUPLICATE_OCCURRENCE_IDENTITY: it-1 at video:1#0,video:1#6; effects: derived verdict is UNOBSERVABLE_STATE (missing=['occurrence identity unobser |
| commit-eligibility | linked-set-duplicate-occurrence-identity-reversed | PASS | eligible=False stages=12 errors=['s1: DUPLICATE_OCCURRENCE_IDENTITY: it-1 at video:1#0,video:1#6', 'delta: S1: DUPLICATE_OCCURRENCE_IDENTITY: it-1 at video:1#0,video:1#6'] |
| linked-set-negative | linked-set-duplicate-occurrence-identity | PASS | s1: DUPLICATE_OCCURRENCE_IDENTITY: it-1 at video:1#0,video:1#6; delta: S1: DUPLICATE_OCCURRENCE_IDENTITY: it-1 at video:1#0,video:1#6; effects: derived verdict is UNOBSERVABLE_STATE (missing=['occurrence identity unobser |
| commit-eligibility | linked-set-duplicate-occurrence-identity | PASS | eligible=False stages=12 errors=['s1: DUPLICATE_OCCURRENCE_IDENTITY: it-1 at video:1#0,video:1#6', 'delta: S1: DUPLICATE_OCCURRENCE_IDENTITY: it-1 at video:1#0,video:1#6'] |
| linked-set-negative | linked-set-effect-not-specified-claims-verified | PASS | plan: operation SET_PROPERTIES not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 5884a9247d82 plan_digest='fc3fa968f0124302167726d8637d4052d69bc3085533448aab5c7648ee6948e0' != 'be83796cc39fef7f7464b00a4d109c2da4 |
| linked-set-negative | linked-set-guard-snapshot-stale | PASS | s0: mutation requires a complete WRITE_PRECHECK snapshot; plan: plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT); lineage: S1 project identity differs from S0; lineage: S0 guard is not th |
| commit-eligibility | linked-set-guard-snapshot-stale | PASS | eligible=False stages=12 errors=['s0: mutation requires a complete WRITE_PRECHECK snapshot', 'plan: plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT)'] |
| linked-set-positive | linked-set-in-flight-no-s1 | PASS |  |
| linked-set-negative | linked-set-journal-applied-without-started | PASS | journal: seq 4: illegal transition CHECKPOINTED -> APPLIED; journal: seq 4: APPLIED without a preceding OP_STARTED for op-1; commit: journal: seq 4: illegal transition CHECKPOINTED -> APPLIED; commit: journal: seq 4: APP |
| commit-eligibility | linked-set-journal-applied-without-started | PASS | eligible=False stages=12 errors=['journal: seq 4: illegal transition CHECKPOINTED -> APPLIED', 'journal: seq 4: APPLIED without a preceding OP_STARTED for op-1'] |
| linked-set-negative | linked-set-journal-invented-operation | PASS | journal: seq 5: operation_id op-9 is not in the bound plan operation set (journal invented an operation); journal: seq 5: APPLIED without a preceding OP_STARTED for op-9; journal: seq 6: READBACK_S1 before all plan opera |
| commit-eligibility | linked-set-journal-invented-operation | PASS | eligible=False stages=12 errors=['journal: seq 5: operation_id op-9 is not in the bound plan operation set (journal invented an operation)', 'journal: seq 5: APPLIED without a preceding OP_STARTED for op-9'] |
| linked-set-negative | linked-set-journal-names-other-s1 | PASS | journal: journal READBACK_S1 names a different S1 than the one supplied; journal: journal READBACK_S1 guard differs from the supplied S1 guard; verification: verification readback digest != journal READBACK_S1 digest; co |
| commit-eligibility | linked-set-journal-names-other-s1 | PASS | eligible=False stages=12 errors=['journal: journal READBACK_S1 names a different S1 than the one supplied', 'journal: journal READBACK_S1 guard differs from the supplied S1 guard'] |
| linked-set-negative | linked-set-marker-unrelated-change | PASS | effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=["marker added ''@109000"]); commit impossible; verification: verification.unrelated differs from derived truth (declared [] vs derived ["marker added '' |
| commit-eligibility | linked-set-marker-unrelated-change | PASS | eligible=False stages=12 errors=['effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=["marker added \'\'@109000"]); commit impossible', 'verification: verification.unrelated differs from derived truth (de |
| linked-set-negative | linked-set-media-dependency-unrelated-change | PASS | effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=["media dependency added '/qual/media/unexpected.png'"]); commit impossible; verification: verification.unrelated differs from derived truth (declared [] |
| commit-eligibility | linked-set-media-dependency-unrelated-change | PASS | eligible=False stages=12 errors=['effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=["media dependency added \'/qual/media/unexpected.png\'"]); commit impossible', 'verification: verification.unrelated d |
| linked-set-negative | linked-set-missing-readback-event-with-verification | PASS | journal: S1 supplied but the journal has no READBACK_S1 event; verification: journal has no single READBACK_S1 event to bind the verification to |
| linked-set-negative | linked-set-plan-not-eligible-no-authorization | PASS | s0: method_provenance[GetClipEnabled]: capability_evidence_record_id does not resolve to a CAPABILITY_EVIDENCE record; s0: method_provenance[GetCurrentTimeline]: capability_evidence_record_id does not resolve to a CAPABI |
| commit-eligibility | linked-set-plan-not-eligible-no-authorization | PASS | eligible=False stages=12 errors=['s0: method_provenance[GetClipEnabled]: capability_evidence_record_id does not resolve to a CAPABILITY_EVIDENCE record', 's0: method_provenance[GetCurrentTimeline]: capability_evidence_re |
| linked-set-negative | linked-set-s0-not-write-precheck | PASS | s0: mutation requires a complete WRITE_PRECHECK snapshot; plan: plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT); lineage: S0 guard is not the plan's h0_guard_digest; effects: derived ver |
| commit-eligibility | linked-set-s0-not-write-precheck | PASS | eligible=False stages=12 errors=['s0: mutation requires a complete WRITE_PRECHECK snapshot', 'plan: plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT)'] |
| linked-set-negative | linked-set-s0-observed-fields-not-callable | PASS | s0: method_provenance[GetClipEnabled]: capability_matrix_sha256 is not the active matrix; s0: method_provenance[GetClipEnabled]: capability_evidence_record_id does not resolve to a CAPABILITY_EVIDENCE record; s0: method_ |
| commit-eligibility | linked-set-s0-observed-fields-not-callable | PASS | eligible=False stages=12 errors=['s0: method_provenance[GetClipEnabled]: capability_matrix_sha256 is not the active matrix', 's0: method_provenance[GetClipEnabled]: capability_evidence_record_id does not resolve to a CAP |
| linked-set-negative | linked-set-s0-observed-fields-without-provenance | PASS | s0: OBSERVED data relies on GetStartFrame but collection.method_provenance has no entry (value exists != OBSERVED); plan: plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT); lineage: S0 gua |
| commit-eligibility | linked-set-s0-observed-fields-without-provenance | PASS | eligible=False stages=12 errors=['s0: OBSERVED data relies on GetStartFrame but collection.method_provenance has no entry (value exists != OBSERVED)', 'plan: plan bound to a different guard digest than the current snapsh |
| linked-set-negative | linked-set-s1-arbitrary-hash | PASS | verification: verification S1 digests do not resolve to the supplied S1 snapshot; commit: verification: verification S1 digests do not resolve to the supplied S1 snapshot; commit: verification_result_sha256 does not matc |
| commit-eligibility | linked-set-s1-arbitrary-hash | PASS | eligible=False stages=12 errors=['verification: verification S1 digests do not resolve to the supplied S1 snapshot', 'commit: verification: verification S1 digests do not resolve to the supplied S1 snapshot'] |
| linked-set-negative | linked-set-s1-from-other-session | PASS | journal: supplied S1 was collected in a different session than the journal's execution session; lineage: S1 was collected in a different session than S0; lineage: S1 session differs from the plan's execution session; ver |
| commit-eligibility | linked-set-s1-from-other-session | PASS | eligible=False stages=12 errors=["journal: supplied S1 was collected in a different session than the journal's execution session", 'lineage: S1 was collected in a different session than S0'] |
| linked-set-negative | linked-set-s1-incomplete | PASS | s1: verification requires a complete S1 (incomplete readback cannot prove the effect); effects: derived verdict is UNOBSERVABLE_STATE (missing=['S0/S1 incomplete'] unrelated=[]); commit impossible; verification: verifica |
| commit-eligibility | linked-set-s1-incomplete | PASS | eligible=False stages=12 errors=['s1: verification requires a complete S1 (incomplete readback cannot prove the effect)', "effects: derived verdict is UNOBSERVABLE_STATE (missing=['S0/S1 incomplete'] unrelated=[]); commi |
| linked-set-negative | linked-set-s1-minimal-m0-profile | PASS | lineage: S1 project identity differs from S0; lineage: S1 timeline identity differs from S0; s1: coverage profile MINIMAL_M0 is weaker than the required APPEND_VERIFY verify profile; s1: verification requires a complete  |
| commit-eligibility | linked-set-s1-minimal-m0-profile | PASS | eligible=False stages=12 errors=['lineage: S1 project identity differs from S0', 'lineage: S1 timeline identity differs from S0'] |
| linked-set-negative | linked-set-s1-other-epoch | PASS | lineage: S1 target_epoch differs from S0; verification: lineage: S1 target_epoch differs from S0; commit: verification: lineage: S1 target_epoch differs from S0 |
| commit-eligibility | linked-set-s1-other-epoch | PASS | eligible=False stages=12 errors=['lineage: S1 target_epoch differs from S0', 'verification: lineage: S1 target_epoch differs from S0'] |
| linked-set-negative | linked-set-s1-weaker-profile | PASS | s1: coverage profile FULL_TIMELINE_READ is weaker than the required APPEND_VERIFY verify profile |
| commit-eligibility | linked-set-s1-weaker-profile | PASS | eligible=False stages=12 errors=['s1: coverage profile FULL_TIMELINE_READ is weaker than the required APPEND_VERIFY verify profile'] |
| linked-set-negative | linked-set-schema-invalid-plan | PASS | schema/plan: additionalProperties::Additional properties are not allowed ('target_attachment_state' was unexpected) |
| commit-eligibility | linked-set-schema-invalid-plan | PASS | eligible=False stages=2 errors=["schema/plan: additionalProperties::Additional properties are not allowed ('target_attachment_state' was unexpected)"] |
| linked-set-negative | linked-set-source-bound-unrelated-change | PASS | effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['changed it-1: source_end,source_start']); commit impossible; verification: verification.changed differs from derived truth (declared [] vs derived [{"f |
| commit-eligibility | linked-set-source-bound-unrelated-change | PASS | eligible=False stages=12 errors=["effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['changed it-1: source_end,source_start']); commit impossible", 'verification: verification.changed differs from derive |
| linked-set-negative | linked-set-timeline-dimension-unrelated-change | PASS | effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['timeline.width changed']); commit impossible; verification: verification.unrelated differs from derived truth (declared [] vs derived ["timeline.width  |
| commit-eligibility | linked-set-timeline-dimension-unrelated-change | PASS | eligible=False stages=12 errors=["effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['timeline.width changed']); commit impossible", 'verification: verification.unrelated differs from derived truth (decl |
| linked-set-negative | linked-set-timeline-end-unrelated-change | PASS | effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['timeline.end_frame changed']); commit impossible; verification: verification.unrelated differs from derived truth (declared [] vs derived ["timeline.en |
| commit-eligibility | linked-set-timeline-end-unrelated-change | PASS | eligible=False stages=12 errors=["effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['timeline.end_frame changed']); commit impossible", 'verification: verification.unrelated differs from derived truth ( |
| linked-set-negative | linked-set-timeline-settings-unrelated-change | PASS | effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['timeline.settings changed']); commit impossible; verification: verification.unrelated differs from derived truth (declared [] vs derived ["timeline.set |
| commit-eligibility | linked-set-timeline-settings-unrelated-change | PASS | eligible=False stages=12 errors=["effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['timeline.settings changed']); commit impossible", 'verification: verification.unrelated differs from derived truth (d |
| linked-set-negative | linked-set-timeline-start-unrelated-change | PASS | effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['timeline.start_frame changed']); commit impossible; verification: verification.unrelated differs from derived truth (declared [] vs derived ["timeline. |
| commit-eligibility | linked-set-timeline-start-unrelated-change | PASS | eligible=False stages=12 errors=["effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['timeline.start_frame changed']); commit impossible", 'verification: verification.unrelated differs from derived truth |
| linked-set-negative | linked-set-track-topology-unrelated-change | PASS | effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['track added video:3']); commit impossible; verification: verification.unrelated differs from derived truth (declared [] vs derived ["track added video: |
| commit-eligibility | linked-set-track-topology-unrelated-change | PASS | eligible=False stages=12 errors=["effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['track added video:3']); commit impossible", 'verification: verification.unrelated differs from derived truth (declare |
| linked-set-negative | linked-set-unrelated-change-hidden | PASS | effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['changed it-3: enabled']); commit impossible; verification: verification.changed differs from derived truth (declared [] vs derived [{"fields":{"enabled |
| commit-eligibility | linked-set-unrelated-change-hidden | PASS | eligible=False stages=12 errors=["effects: derived verdict is UNEXPECTED_DELTA (missing=[] unrelated=['changed it-3: enabled']); commit impossible", 'verification: verification.changed differs from derived truth (declare |
| linked-set-negative | linked-set-unresolved-conflict | PASS | commit: commit with unresolved conflict |
| commit-eligibility | linked-set-unresolved-conflict | PASS | eligible=False stages=12 errors=['commit: commit with unresolved conflict'] |
| linked-set-negative | linked-set-verification-other-plan | PASS | verification: verification refers to another plan; commit: verification: verification refers to another plan; commit: verification_result_sha256 does not match the validated verification object |
| commit-eligibility | linked-set-verification-other-plan | PASS | eligible=False stages=12 errors=['verification: verification refers to another plan', 'commit: verification: verification refers to another plan'] |
| linked-set | plan_digest law: digest of body without refs | PASS |  |
| bypass-audit | AUTHORITY_SURFACE lists commit_eligibility and validate_transaction_set as the only transaction-authorizing entry points | PASS |  |
| bypass-audit | every exported validator touching commit/verification/journal/plan/snapshot/delta is classified | PASS |  |
| bypass-audit | every INTERNAL_NON_AUTHORIZING function says so in its docstring | PASS |  |
| bypass-audit | validate_transaction_set has no callable-set, skip or override parameter | PASS |  |
| bypass-audit | commit_eligibility composes validate_transaction_set (source-level) | PASS |  |
| bypass-audit | semantic_commit_manifest refuses hash-only / missing S0 / missing S1 / missing journal / missing active | PASS |  |
| bypass-audit | semantic_verification_result refuses missing plan / S0 / S1 / journal | PASS |  |
| bypass-audit | validate_transaction_set refuses a set without S0 | PASS |  |
| bypass-audit | validate_transaction_set refuses a commit without linked S1 and verification | PASS |  |
| bypass-audit | commit_eligibility passes only after every stage (evidence, provenance, schema, s0, plan, journal, s1, delta, effects, verification, conflicts, commit) | PASS | [] |
| bypass-audit | commit_eligibility INELIGIBLE with missing S1 | PASS |  |
| bypass-audit | commit_eligibility INELIGIBLE with missing verification | PASS |  |
| bypass-audit | commit_eligibility INELIGIBLE with missing journal | PASS |  |
| bypass-audit | commit_eligibility INELIGIBLE with missing S0 | PASS |  |
| bypass-audit | commit_eligibility INELIGIBLE with missing plan | PASS |  |
| bypass-audit | commit_eligibility INELIGIBLE with missing commit manifest | PASS |  |
| bypass-audit | commit_eligibility rejects a false VERIFIED object even when its digest is what the commit cites | PASS |  |
| bypass-audit | a syntactically valid verification hash alone never makes a commit eligible | PASS |  |
| bypass-audit | lib never selects evidence by position (array tail only on the ordered journal chain) | PASS | journal,journal_records |
| bypass-audit | callable set and provenance context are derived inside validate_transaction_set (no caller-supplied callable set) | PASS |  |
| occurrence-uniqueness | duplicate OBSERVED unique_id is rejected before any index is built | PASS |  |
| occurrence-uniqueness | duplicate rejection is identical in reversed input order | PASS |  |
| occurrence-uniqueness | derive_delta refuses duplicates (None) and verification is UNOBSERVABLE_STATE, never first/last pick | PASS |  |
| occurrence-uniqueness | unobserved identity in an authoritative index is an error (require_identity) | PASS |  |
| occurrence-uniqueness | semantic_snapshot flags duplicates in every profile (identity domain = timeline) | PASS |  |
| occurrence-uniqueness | unique identities: 8 S0/S1 permutations give identical index, delta, creation mapping and verdict | PASS |  |
| occurrence-uniqueness | duplicate identities: 8 permutations reject identically (same DUPLICATE_OCCURRENCE_IDENTITY text) | PASS |  |
| delta-surface | S0 -> S1 delta derives exactly one added occurrence and no other protected change | PASS |  |
| delta-surface | protected surface covers occurrence identity/track/range/source/media/enabled/properties/markers, timeline identity/frames/timebase/geometry/settings, track topology+fields, markers, media linkage | PASS |  |
| delta-surface | source bound change: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED | PASS | verdict=UNEXPECTED_DELTA unrelated=['changed it-1: source_end,source_start'] |
| unrelated-change-law | source bound change: a caller-declared unrelated:[] + VERIFIED is rejected against the derived truth | PASS |  |
| delta-surface | timeline width change: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED | PASS | verdict=UNEXPECTED_DELTA unrelated=['timeline.width changed'] |
| unrelated-change-law | timeline width change: a caller-declared unrelated:[] + VERIFIED is rejected against the derived truth | PASS |  |
| delta-surface | timeline start change: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED | PASS | verdict=UNEXPECTED_DELTA unrelated=['timeline.start_frame changed'] |
| unrelated-change-law | timeline start change: a caller-declared unrelated:[] + VERIFIED is rejected against the derived truth | PASS |  |
| delta-surface | timeline settings change: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED | PASS | verdict=UNEXPECTED_DELTA unrelated=['timeline.settings changed'] |
| unrelated-change-law | timeline settings change: a caller-declared unrelated:[] + VERIFIED is rejected against the derived truth | PASS |  |
| delta-surface | track topology change: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED | PASS | verdict=UNEXPECTED_DELTA unrelated=['track added video:3'] |
| unrelated-change-law | track topology change: a caller-declared unrelated:[] + VERIFIED is rejected against the derived truth | PASS |  |
| delta-surface | track lock change: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED | PASS | verdict=UNEXPECTED_DELTA unrelated=['track video:1 changed: locked'] |
| unrelated-change-law | track lock change: a caller-declared unrelated:[] + VERIFIED is rejected against the derived truth | PASS |  |
| delta-surface | unrelated marker: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED | PASS | verdict=UNEXPECTED_DELTA unrelated=["marker added ''@109000"] |
| unrelated-change-law | unrelated marker: a caller-declared unrelated:[] + VERIFIED is rejected against the derived truth | PASS |  |
| delta-surface | unrelated occurrence property (enabled): derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED | PASS | verdict=UNEXPECTED_DELTA unrelated=['changed it-3: enabled'] |
| unrelated-change-law | unrelated occurrence property (enabled): a caller-declared unrelated:[] + VERIFIED is rejected against the derived truth | PASS |  |
| delta-surface | unrelated media dependency: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED | PASS | verdict=UNEXPECTED_DELTA unrelated=["media dependency added '/x.png'"] |
| unrelated-change-law | unrelated media dependency: a caller-declared unrelated:[] + VERIFIED is rejected against the derived truth | PASS |  |
| delta-surface | APPEND that extends the timeline exactly to the new occurrence end is an explained end_frame change | PASS |  |
| delta-surface | end_frame moved beyond the appended range is unrelated | PASS |  |
| delta-surface | is_current is outside the protected surface (adapter selection, documented) | PASS |  |
| delta-surface | identical S0/S1 derives an empty delta | PASS |  |
| append-effect | APPEND with no new occurrence -> EXPECTED_DELTA_MISSING, empty creation map, never VERIFIED | PASS |  |
| append-effect | APPEND not APPLIED in the journal cannot verify | PASS |  |
| append-effect | incomplete S1 -> UNOBSERVABLE_STATE | PASS |  |
| journal-s1-binding | journal READBACK_S1 names exactly the supplied S1 (snapshot object digest + guard) | PASS |  |
| journal-s1-binding | journal validated against a different S1 fails (journal points to S1 A, validator receives S1 B) | PASS |  |
| journal-s1-binding | S1 from another session is rejected by journal, lineage and verification | PASS |  |
| journal-s1-binding | verification without a READBACK_S1 event is rejected | PASS |  |
| journal-s1-binding | two READBACK_S1 events are ambiguous | PASS |  |
| journal-s1-binding | linked identity is bound across plan, journal, S0, S1, verification and commit (session, plan digest, transaction, target, guards, operation set, S1 digest) | PASS |  |
| s1-profile-law | APPEND requires the APPEND_VERIFY profile; S0 requires WRITE_PRECHECK | PASS |  |
| s1-profile-law | WRITE_PRECHECK satisfies APPEND_VERIFY; FULL_TIMELINE_READ and MINIMAL_M0 do not | PASS |  |
| s1-profile-law | APPEND_VERIFY mandates identity, track, range, source/media identity, locks, guard and the protected timeline metadata | PASS |  |
| s1-profile-law | operations without a verify profile cannot be verified by any S1 | PASS |  |
| s1-profile-law | the APPEND_VERIFY S1 fixture validates and verifies | PASS |  |
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
| canon-vector | payload domain is v1.5, guard v3 and provenance v1 registered; guard v1/v2 and payload v1.4 unregistered | PASS |  |
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
| canon-rejection | unregistered_domain_old_guard_v2 | PASS | unregistered hash domain 'vidtoolz.resolveGuard.v2' |
| canon-rejection | unregistered_domain_old_payload_v1_4 | PASS | unregistered hash domain 'vidtoolz.resolveSnapshotPayload.v1.4' |
| canon-rejection | items_missing_ordinal | PASS | item.observation_ordinal (position in GetItemListInTrack) is required for total ordering |
| canon-rejection | items_duplicate_ordinal | PASS | two items share the full sort key: identity collision |
| canon-rejection | items_observed_end_null_in_sort | PASS | not a numeric quantity: None |
| f64-exact | fullmatch semantics used | PASS |  |
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
| eligibility-request-schema | m0-connect-deny-hyp-parse-failed-accepted | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-parse-failed-accepted | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-getter-exception-accepted | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-getter-exception-accepted | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-label-success-parse-failed | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-label-success-parse-failed | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-wrong-observed-type | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-wrong-observed-type | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-review-references-other-raw | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-review-references-other-raw | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-promotion-names-other-raw | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-promotion-names-other-raw | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-null-result | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-null-result | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-deny-write-op | PASS | request schema-valid=True |
| eligibility | m0-deny-write-op | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:no explicit entry (default DENY)'] |
| eligibility-request-schema | m0-deny-ref-empty-string | PASS | request schema-valid=False |
| eligibility | m0-deny-ref-empty-string | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: reference is not a sha256 (''))"] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-deny-ref-false-string | PASS | request schema-valid=False |
| eligibility | m0-deny-ref-false-string | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: reference is not a sha256 ('false'))"] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-deny-ref-unlinked-sha | PASS | request schema-valid=True |
| eligibility | m0-deny-ref-unlinked-sha | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: referenced record 999999999999 not in evidence set)'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-deny-ref-wrong-record-type | PASS | request schema-valid=True |
| eligibility | m0-deny-ref-wrong-record-type | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: record 924d26d61415 has type CONNECTION_OBSERVATION)'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m2-set-current-timeline-deny-production-project-name | PASS | request schema-valid=True |
| eligibility | m2-set-current-timeline-deny-production-project-name | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=['PROJECT_ADAPTER_PREFIXED', "TARGET_REQUIREMENT_SATISFIED (project 'PYSTY UHD' is neither adapter-prefixed nor operator-provisioned in the contract lib |
| eligibility-request-schema | m2-set-current-timeline-allow | PASS | request schema-valid=True |
| eligibility | m2-set-current-timeline-allow | PASS | eligible=True state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m3-append-deny-without-authorization | PASS | request schema-valid=True |
| eligibility | m3-append-deny-without-authorization | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: reference is not a sha256 (None))', 'TARGET_STATE_SCRATCH_WRITE_READY (no M3_AUTHORIZATION for scratch scope  |
| eligibility-request-schema | m3-append-deny-authorization-old-authority | PASS | request schema-valid=True |
| eligibility | m3-append-deny-authorization-old-authority | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: referenced record d1cf9a2c4329 not in evidence set)', 'TARGET_STATE_SCRATCH_WRITE_READY (no M3_AUTHORIZATION  |
| eligibility-request-schema | m3-append-deny-refreeze-unreviewed | PASS | request schema-valid=True |
| eligibility | m3-append-deny-refreeze-unreviewed | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['TARGET_STATE_SCRATCH_WRITE_READY (no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix)', 'JOURNAL_PREPARED (JOURNAL_PR |
| eligibility-request-schema | m3-append-deny-refreeze-for-other-matrix | PASS | request schema-valid=True |
| eligibility | m3-append-deny-refreeze-for-other-matrix | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['TARGET_STATE_SCRATCH_WRITE_READY (no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix)', 'JOURNAL_PREPARED (JOURNAL_PR |
| eligibility-request-schema | m3-append-deny-no-journal-guard-plan-records | PASS | request schema-valid=True |
| eligibility | m3-append-deny-no-journal-guard-plan-records | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=['JOURNAL_PREPARED (JOURNAL_PREPARED: reference is not a sha256 (None))', 'PLAN_VALIDATED (PLAN_VALIDATION: reference is not a sha256 (None))'] codes=[' |
| eligibility-request-schema | m3-save-deny-ids-unavailable | PASS | request schema-valid=True |
| eligibility | m3-save-deny-ids-unavailable | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT failed=['M2_EXIT_EVIDENCE (MILESTONE_EXIT: referenced record 999d8e0cc523 not in evidence set)', 'MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: referenced record d1cf9a2c432 |
| eligibility-request-schema | m3-deny-shared-library-scope | PASS | request schema-valid=True |
| eligibility | m3-deny-shared-library-scope | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:unknown milestone or scope'] |
| eligibility-request-schema | m4-deny-unknown-milestone | PASS | request schema-valid=True |
| eligibility | m4-deny-unknown-milestone | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:unknown milestone or scope'] |
| eligibility-request-schema | deny-unknown-operation | PASS | request schema-valid=True |
| eligibility | deny-unknown-operation | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:no explicit entry (default DENY)'] |
| eligibility-invariant | allowed_true_is_not_eligibility | PASS |  |
| eligibility-invariant | capabilities argument is consumed (hypothetical matrix flips CONNECT; frozen matrix does not) | PASS |  |
| eligibility-invariant | active authority argument is consumed | PASS |  |
| eligibility-invariant | CONFLICT short-circuits | PASS |  |
| permission-invariant | no_mutation_before_M3 | PASS |  |
| permission-invariant | every_M3_mutation_requires_authorization_and_write_ready | PASS |  |
| permission-invariant | no_shared_library_grant | PASS |  |
| permission-invariant | default_deny | PASS |  |
| permission-invariant | prerequisite_codes == library set | PASS |  |
| order-independence | eligibility: 81 cases x 4 evidence/request permutations give identical decisions | PASS | 324 permutations |
| order-independence | attachment: 61 evidence sets x 4 record-map permutations give identical derivations | PASS |  |
| order-independence | snapshots: every snapshot fixture x 4 track/item/marker/ledger permutations keeps payload, guard and object digests and the semantic result | PASS | 28 permutations |
| order-independence | linked sets: 40 sets x 4 permutations of evidence map, conflicts, snapshot arrays and key order give identical validation (incl. duplicate-identity sets) | PASS |  |
| order-independence | two current-sequence contradictions stay CONFLICT in both input orders | PASS |  |
| v1.4-attack | F1 parsed capability failure qualifies under a reviewed/refrozen matrix | PASS |  |
| v1.4-attack | F2 duplicate occurrence ids make verification order-dependent / false VERIFIED | PASS |  |
| v1.4-attack | F3 unrelated source-bound and timeline metadata changes escape delta detection | PASS |  |
| v1.4-attack | F4 BLOCKER direct commit validation accepts false VERIFIED without S0/S1 | PASS |  |
| v1.4-attack | F5 journal readback/session not bound to supplied S1 | PASS |  |
| v1.4-attack | F6 composed validation omits capability-to-snapshot enforcement | PASS |  |
| v1.4-attack | F7 weaker S1 coverage profile bypasses write-readback completeness | PASS |  |
| v1.4-attack | combinations | PASS |  |
| milestone-matrix | M0 read ops match PERMISSIONS | PASS |  |
| milestone-matrix | M0 mutation ops match PERMISSIONS | PASS |  |
| milestone-matrix | M1 read ops match PERMISSIONS | PASS |  |
| milestone-matrix | M1 mutation ops match PERMISSIONS | PASS |  |
| milestone-matrix | M2 read ops match PERMISSIONS | PASS |  |
| milestone-matrix | M2 mutation ops match PERMISSIONS | PASS |  |
| milestone-matrix | M3 read ops match PERMISSIONS | PASS |  |
| milestone-matrix | M3 mutation ops match PERMISSIONS | PASS |  |
| milestone-matrix | M3 is the only mutation milestone | PASS |  |
| m3-probe | 19 probes P1..P19, all M3-permitted; P15 claims no rename | PASS |  |
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
| precedence | CHANGELOG-v1.5.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.5.md classified | PASS |  |
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
| precedence-supersession | S25 | PASS |  |
| precedence-supersession | S26 | PASS |  |
| precedence-supersession | S27 | PASS |  |
| precedence-supersession | S28 | PASS |  |
| precedence-supersession | S29 | PASS |  |
| precedence-supersession | S30 | PASS |  |
| precedence-supersession | S31 | PASS |  |
| precedence | v1.5 supersessions present | PASS |  |
| precedence | v1.4 changelog and finding matrix are HISTORICAL; v1.5 ones are active | PASS |  |
| precedence | SCORECRAFT-EXTRACTION.md cites v1.5 active schemas, not v1.1/v1.4 | PASS |  |
| timebase | canary_boundaries_ceil_law | PASS |  |
| guard | payload_equal_but_guard_differs (same payload, different project) | PASS |  |
| guard | UNAVAILABLE != ERROR project identity produces different guards over an identical payload | PASS |  |
| guard | provenance authority is part of the guard (same payload, different capability evidence -> different guard) | PASS |  |
| guard | append-verify-s1-after-append guard v3 validates, recomputes and binds provenance | PASS |  |
| guard | full-read-degraded-start-frame guard v3 validates, recomputes and binds provenance | PASS |  |
| guard | full-read-partial-item-ledger guard v3 validates, recomputes and binds provenance | PASS |  |
| guard | human-timeline-mixed-provenance guard v3 validates, recomputes and binds provenance | PASS |  |
| guard | m0-minimal-nothing-qualified guard v3 validates, recomputes and binds provenance | PASS |  |
| guard | write-precheck-complete guard v3 validates, recomputes and binds provenance | PASS |  |
| guard | write-precheck-s1-after-append guard v3 validates, recomputes and binds provenance | PASS |  |
| degraded-snapshot | pre-qualification capture: every timeline/project field UNAVAILABLE, no tracks, complete:false, every method NOT_CALLABLE | PASS |  |
| degraded-snapshot | pre-qualification capture classifies as INCOMPLETE_NOT_QUALIFIED | PASS |  |
| degraded-snapshot | GetStartFrame not callable -> start_frame null, UNAVAILABLE + reason, provenance NOT_CALLABLE, complete:false | PASS |  |
| degraded-snapshot | degraded snapshot passes under the matching reduced evidence set and fails when it claims OBSERVED | PASS |  |
| probe-vs-qualified | CANDIDATE_OBSERVATION is distinct from QUALIFIED_OBSERVATION and never backs an OBSERVED field | PASS |  |
| probe-vs-qualified | probe output (unreviewed candidates) cannot qualify a primitive nor back OBSERVED fields, even under the hypothetical matrix | PASS |  |
| exact-manifest | real manifest sha differs from the fixture placeholder | PASS |  |
| exact-manifest | placeholder-bound fixture evidence does not derive against the real manifest (CONFLICT) | PASS |  |
| exact-manifest | evidence re-minted against the real manifest derives ATTACHMENT_READY / ATTACHED_READ_ONLY | PASS |  |
| exact-manifest | probe eligible on re-minted ready evidence | PASS |  |
| exact-manifest | re-minted evidence is structurally valid against the real manifest | PASS |  |
| exact-manifest | arbitrary 64-hex manifest sha is rejected (CONFLICT) | PASS |  |
| exact-manifest | v1.4 manifest / authority 1.4.0 evidence is rejected as current authority (CONFLICT) | PASS |  |
| exact-manifest | real-manifest verification for another host / other version / self-verified does not count | PASS |  |
| manifest | parent manifest sha pinned | PASS |  |
| manifest | schema | PASS |  |
| manifest | semantic (hashes, byte counts, lineage, inheritance flags) | PASS |  |
| manifest | every file on disk is listed | PASS |  |
| manifest | no listed file missing on disk | PASS | VALIDATION-REPORT.md |
| manifest | validation tools listed as TOOL | PASS |  |
| manifest-negative | invalid status | PASS |  |
| manifest-negative | duplicate path | PASS |  |
| manifest-negative | malformed hash | PASS |  |
| manifest-negative | broken parent lineage | PASS |  |
| manifest-negative | parent manifest sha changed | PASS |  |
| manifest-negative | changed file marked inherited | PASS |  |
| manifest-negative | bytes +1 | PASS |  |
| manifest-negative | wrong size with correct sha | PASS |  |
| manifest-negative | correct size with wrong sha | PASS |  |
| manifest-positive | actual bytes equal on disk for every file | PASS |  |
| determinism | vectors_rerun_identical | PASS |  |
| determinism | evidence record ids recompute | PASS |  |
| determinism | no_bytecode_cache_written | PASS |  |
