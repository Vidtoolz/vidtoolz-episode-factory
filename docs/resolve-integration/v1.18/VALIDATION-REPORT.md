# VALIDATION REPORT — Resolve authority bundle v1.18

Result: **2654/2654 checks passed**. IMPLEMENTATION AUTHOR self-validation; independent review required. Offline synthetic tests only; no operational A2/A2V/A1/A3 execution. Protected runtime tests retained; scanner/release assertions replaced as documented in REQUIRED-VALIDATION-CHECKS.json.

| Finding | Sections | Checks | Passed |
|---|---|---|---|
| V115-B1 active TARGET-CONTRACT and SCHEMA-REGISTRY authority classifications contradictory (BLOCKER) | b1-classification, b1-property | 11 | 11 |
| V115-M1 machine-readable location-receipt binding omits three runtime-bound fields (MERGE MAJOR) | m1-receipt-parity, m1-property | 12 | 12 |
| v1.16 static audits | v116-static | 5 | 5 |
| V114-B1 consumed evidence not bound to the validated governed bytes; a FALSE ATTACHMENT_READY under valid provenance (BLOCKER) | b1-consumed-evidence, b1-positive | 19 | 19 |
| V114-B2 diagnostic eligibility reaching commit authority (BLOCKER) | b2-transaction-authority | 13 | 13 |
| V114-B3 active authority artifacts naming diagnostic entrypoints (BLOCKER) | b3-active-naming | 5 | 5 |
| V114-B4 governed loader following a symlinked WORKFLOW.json; FIFO hang; raw IsADirectoryError (BLOCKER) | b4-workflow-file | 11 | 11 |
| V114-M1 malformed nominal carrier leaking a raw AttributeError (MERGE MAJOR) | m1-malformed-carrier | 15 | 15 |
| V114-N1 canonicalization documentation omitting registered hash domains (MINOR) | hash-domain-parity | 5 | 5 |
| v1.15 static audits and focused property suites (fixed seed) | v115-static, v115-property | 10 | 10 |
| V113-B1 forbidden-location evidence authorized by the CORE derivation and eligibility (BLOCKER, authorizing location bypass) | core-authority, core-bypass, core-positive, core-callgraph, core-selflocation, core-static | 52 | 52 |
| v1.14 focused property suites (fixed seed) | core-property | 2 | 2 |
| V112-RP1 caller-selectable and symlinked governed evidence root derived ATTACHMENT_READY (BLOCKER, WORKFLOW_CONTRADICTORY) | root-law, root-parity, root-property, root-static | 38 | 38 |
| V112-1 no governed persistence location for the evidence-set document (AUTHORITY_UNDERSPECIFIED) | workflow-persistence | 8 | 8 |
| V112-2 no evidence-set document lifecycle sequencing preparer against verifier (AUTHORITY_UNDERSPECIFIED) | workflow-lifecycle | 7 | 7 |
| V112-3 no writer designated; independence rested on two self-declared strings (AUTHORITY_UNDERSPECIFIED) | workflow-principals | 6 | 6 |
| V112-4 no production BUNDLE_VERIFICATION write authority; no runtime path to ATTACHMENT_READY (AUTHORITY_UNDERSPECIFIED) | workflow-e2e-positive, workflow-e2e-negative, workflow-parity | 40 | 40 |
| v1.12 static audits of the workflow authority | workflow-static | 14 | 14 |
| F110-A boundary receipt normative fields consistently rewritable and still authorizing (BLOCKER) | evidence-boundary-fields | 27 | 27 |
| F110-B six inventory header fields not independently compared; extra semantic field survives (BLOCKER) | evidence-inventory-fields | 27 | 27 |
| F110-C marker/record reconciliation without exact one-to-one cardinality (BLOCKER) | evidence-marker-cardinality | 19 | 19 |
| F110-D public authority-bearing methods without a boundary recheck first (MERGE MAJOR / M0A MAJOR) | evidence-public-surface | 12 | 12 |
| v1.11 self-review: the four defect PATTERNS are closed, not just their instances | evidence-provenance | 6 | 6 |
| v1.11 focused property suites (fixed seed) | property | 4 | 4 |
| S110-1 session boundary not persisted or rechecked (BLOCKER) | evidence-boundary-receipt | 17 | 17 |
| S110-2 inventory / finalization semantics partly self-asserted (BLOCKER) | evidence-recomputed-model, evidence-finalization-fields | 31 | 31 |
| S110-3 stored attempt marker authority incomplete (BLOCKER) | evidence-attempt-derivation | 11 | 11 |
| S110-4 mode authority incomplete before finalization (MAJOR) | evidence-mode-authority | 21 | 21 |
| S110-5 filesystem error vocabulary (MINOR) | evidence-fs-errors | 8 | 8 |
| S19-1 symlinked session root accepted before the trust boundary (BLOCKER) | evidence-root-trust | 0 | 0 |
| S19-2 inventory / session semantics incomplete; renamed or cross-session directory validates (BLOCKER) | evidence-session-identity, evidence-semantic-inventory | 2 | 2 |
| S19-3 attempt id binding digest-bound rather than tuple-bound (BLOCKER) | evidence-attempt-tuple | 6 | 6 |
| S19-4 finalized permission change undetected (MAJOR) | evidence-mode-authority | 21 | 21 |
| ES-1 finalized evidence session is not a closed world (BLOCKER, Codex STORE-14) | evidence-closed-world, evidence-store | 11 | 11 |
| ES-2 competing EvidenceRoot storage authority accepting traversal (BLOCKER) | evidence-single-authority, evidence-traversal | 3 | 3 |
| C16-B1 content-insensitive authority caches (BLOCKER) | cache-law, cache-mutation, matrix-forgery-warm | 22 | 22 |
| C16-B2 caller-supplied schema validators (BLOCKER) | validator-injection, schema-registry | 28 | 28 |
| C16-B3 capture-shim digest not bound to a trusted authority (BLOCKER) | shim-trust | 12 | 12 |
| C16-B4 derived / review / refreeze chain substitution (BLOCKER) | stored-chain | 16 | 16 |
| C16-M1 duplicate receiver paths overwrite identity observations (M0A MAJOR) | identity-duplicates | 8 | 8 |
| C16-M2 absent strict byte-level raw ingestion (M0A MAJOR) | raw-ingestion | 34 | 34 |
| C16-M3 append-only evidence store not executable (M0A MAJOR) | evidence-store | 3 | 3 |
| C16-OP1 Hermes M0A binding values not operationally closed | m0a-binding, codex-matrix | 50 | 50 |
| v1.7 retained v1.6 guarantees (M0 phases, H0 gate, composed commit, precedence, exclusions) | v17-retained | 5 | 5 |
| v1.7 canonical text unchanged under a faster implementation | canonicalization-equivalence | 6 | 6 |
| R1 F15-01 / M-RAW raw truth vs fabricated interpretation | raw-capture, codec, re-parser, raw-vs-fake-parse, review-law, shim-safety | 119 | 119 |
| R2 F15-02 capability/refreeze content forgery (BLOCKER) | matrix-integrity | 7 | 7 |
| R3 F15-03 / M-H0 degraded H0 passes early write eligibility (BLOCKER) | h0-early-gate | 12 | 12 |
| R4 F15-04 default commit path omits schema validation (BLOCKER) | bypass-audit, commit-eligibility | 63 | 63 |
| R5 F15-05 protected property completeness unrepresentable | protected-surface-exclusions | 4 | 4 |
| R6 F15-06 verification claims an unapplied ghost operation | ghost-operation | 3 | 3 |
| R7 F15-07 / M-PRECEDENCE transaction lifecycle precedence | precedence, precedence-supersession, precedence-retired-terms | 246 | 246 |
| R8 M-ID occurrence-identity evidence contract | identity-evidence | 10 | 10 |
| R9 m-TYPE versioned primitive-spec authority | refreeze-law, promotion | 31 | 31 |
| inherited v1.4/v1.5 laws still closed | occurrence-uniqueness, delta-surface, unrelated-change-law, append-effect, journal-s1-binding, s1-profile-law, probe-vs-qualified, degraded-snapshot, guard | 61 | 61 |
| M0 phase model and driver contract | m0-phases | 2 | 2 |
| attack matrix (Codex F15-01..07 + independent findings) | v1.5-attack | 12 | 12 |
| order independence | order-independence | 5 | 5 |

| Section | Checks | Passed |
|---|---|---|
| active-authority | 7 | 7 |
| append-effect | 3 | 3 |
| attachment-derived | 104 | 104 |
| b1-classification | 9 | 9 |
| b1-consumed-evidence | 14 | 14 |
| b1-positive | 5 | 5 |
| b1-property | 2 | 2 |
| b2-transaction-authority | 13 | 13 |
| b3-active-naming | 5 | 5 |
| b4-workflow-file | 11 | 11 |
| bypass-audit | 25 | 25 |
| cache-law | 4 | 4 |
| cache-mutation | 13 | 13 |
| canon-invariance | 3 | 3 |
| canon-rejection | 39 | 39 |
| canon-vector | 17 | 17 |
| canonicalization-equivalence | 6 | 6 |
| codec | 13 | 13 |
| codex-matrix | 25 | 25 |
| commit-eligibility | 38 | 38 |
| core-authority | 10 | 10 |
| core-bypass | 19 | 19 |
| core-callgraph | 7 | 7 |
| core-positive | 1 | 1 |
| core-property | 2 | 2 |
| core-selflocation | 2 | 2 |
| core-static | 13 | 13 |
| current-reference-classes | 1 | 1 |
| degraded-snapshot | 4 | 4 |
| delta-surface | 15 | 15 |
| determinism | 3 | 3 |
| eligibility | 107 | 107 |
| eligibility-invariant | 5 | 5 |
| eligibility-request-schema | 107 | 107 |
| evidence-attempt-derivation | 11 | 11 |
| evidence-attempt-tuple | 6 | 6 |
| evidence-boundary-fields | 27 | 27 |
| evidence-boundary-receipt | 17 | 17 |
| evidence-closed-world | 8 | 8 |
| evidence-finalization-fields | 11 | 11 |
| evidence-fs-errors | 8 | 8 |
| evidence-inventory-fields | 27 | 27 |
| evidence-marker-cardinality | 19 | 19 |
| evidence-mode-authority | 21 | 21 |
| evidence-provenance | 6 | 6 |
| evidence-public-surface | 12 | 12 |
| evidence-recomputed-model | 20 | 20 |
| evidence-ref-negative | 9 | 9 |
| evidence-ref-positive | 1 | 1 |
| evidence-session-identity | 2 | 2 |
| evidence-set-binding | 87 | 87 |
| evidence-set-binding-negative | 9 | 9 |
| evidence-set-schema | 92 | 92 |
| evidence-set-schema-negative | 4 | 4 |
| evidence-single-authority | 2 | 2 |
| evidence-store | 3 | 3 |
| evidence-traversal | 1 | 1 |
| exact-manifest | 8 | 8 |
| f64-exact | 2 | 2 |
| fixture-eligibility-negative | 4 | 4 |
| fixture-layers | 1 | 1 |
| fixture-none | 1 | 1 |
| fixture-schema-negative | 44 | 44 |
| fixture-schema-positive | 190 | 190 |
| fixture-semantic-negative | 92 | 92 |
| fixture-semantic-positive | 36 | 36 |
| fixture-snapshot-negative | 57 | 57 |
| frozen-instance | 29 | 29 |
| frozen-instance-schema | 7 | 7 |
| frozen-instance-semantic | 6 | 6 |
| ghost-operation | 3 | 3 |
| guard | 10 | 10 |
| h0-early-gate | 12 | 12 |
| hash-domain-parity | 5 | 5 |
| identity-duplicates | 8 | 8 |
| identity-evidence | 10 | 10 |
| journal-s1-binding | 6 | 6 |
| linked-set | 1 | 1 |
| linked-set-negative | 39 | 39 |
| linked-set-positive | 3 | 3 |
| m0-phases | 2 | 2 |
| m0a-binding | 25 | 25 |
| m1-malformed-carrier | 15 | 15 |
| m1-property | 1 | 1 |
| m1-receipt-parity | 11 | 11 |
| m3-probe | 1 | 1 |
| manifest | 16 | 16 |
| manifest-negative | 9 | 9 |
| manifest-positive | 1 | 1 |
| matrix-forgery-warm | 5 | 5 |
| matrix-integrity | 7 | 7 |
| milestone-matrix | 9 | 9 |
| occurrence-uniqueness | 7 | 7 |
| order-independence | 5 | 5 |
| parse | 3 | 3 |
| permission-invariant | 5 | 5 |
| precedence | 151 | 151 |
| precedence-retired-terms | 31 | 31 |
| precedence-supersession | 64 | 64 |
| probe-vs-qualified | 2 | 2 |
| promotion | 16 | 16 |
| property | 4 | 4 |
| protected-surface-exclusions | 4 | 4 |
| raw-capture | 19 | 19 |
| raw-ingestion | 34 | 34 |
| raw-vs-fake-parse | 36 | 36 |
| re-parser | 23 | 23 |
| refreeze-law | 15 | 15 |
| required-check-plan | 1 | 1 |
| review-law | 11 | 11 |
| root-law | 26 | 26 |
| root-parity | 3 | 3 |
| root-property | 2 | 2 |
| root-static | 7 | 7 |
| s1-profile-law | 5 | 5 |
| schema-registry | 5 | 5 |
| schema-wellformed | 21 | 21 |
| shim-safety | 17 | 17 |
| shim-trust | 12 | 12 |
| stored-chain | 16 | 16 |
| timebase | 1 | 1 |
| unrelated-change-law | 9 | 9 |
| v1.5-attack | 12 | 12 |
| v115-property | 1 | 1 |
| v115-static | 9 | 9 |
| v116-static | 5 | 5 |
| v118-release-scanner | 238 | 238 |
| v17-retained | 5 | 5 |
| validator-injection | 23 | 23 |
| workflow-e2e-negative | 29 | 29 |
| workflow-e2e-positive | 6 | 6 |
| workflow-lifecycle | 7 | 7 |
| workflow-parity | 5 | 5 |
| workflow-persistence | 8 | 8 |
| workflow-principals | 6 | 6 |
| workflow-static | 14 | 14 |

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
| frozen-instance | CAPABILITIES has zero QUALIFIED_READ rows in v1.6 | PASS |  |
| frozen-instance | every read row is probe_candidate | PASS |  |
| frozen-instance | CAPABILITIES refreeze block is unreviewed and promotes nothing (no probe ids, no raw/derived/review digests) | PASS |  |
| frozen-instance | CAPABILITIES refreeze block binds the active parser and primitive spec digests | PASS |  |
| frozen-instance | CAPABILITIES declares the machine pipeline M0A RAW_CAPABILITY_CAPTURE -> DERIVE -> REVIEW_DECISION -> REFREEZE -> ACTIVE_CAPABILITY -> derived PROMOTION STATE | PASS |  |
| frozen-instance | CAPABILITIES carries the matrix content law and the active digest is its canonical content digest | PASS |  |
| frozen-instance | no evidence record carries an interpretation field; prior-version records are marked UNQUALIFIED_PRIOR_VERSION with no probe id | PASS |  |
| frozen-instance | probe produces RAW_CAPABILITY_CAPTURE only, promotes nothing and names its shim contract and M0 phases | PASS |  |
| frozen-instance | every probe primitive carries the full expectation spec, all DOCUMENTED_HYPOTHESIS, and READ-PRIMITIVES pins their digest | PASS |  |
| frozen-instance | the 47 probe primitives are exactly the specs of the fixture tool (no method without an expectation, no expectation without a method) | PASS |  |
| frozen-instance | CAPABILITY_EVIDENCE is retired and no record type carries a parse block | PASS |  |
| frozen-instance | probe failure taxonomy equals the reference taxonomy | PASS |  |
| frozen-instance | every read primitive declares receiver and expected_type | PASS |  |
| frozen-instance | the probe failure taxonomy is derived-class based (no probe-written failure codes) and BINDING_MISMATCH is fatal | PASS |  |
| frozen-instance | timeline observation status model covers start/end frame, start timecode, width, height | PASS |  |
| frozen-instance | snapshot schema requires collection.method_provenance citing RAW captures and knows APPEND_VERIFY | PASS |  |
| frozen-instance | the snapshot item schema has no property/fade/speed/take payload (F15-05 honest exclusion, named in PROTECTED_SURFACE_EXCLUSIONS) | PASS |  |
| frozen-instance | guard schema is v3 and binds provenance_sha256 | PASS |  |
| frozen-instance | journal execution law: CHECKPOINTED is mandatory before any operation; OP_STARTED -> APPLIED / OP_FAILED; READBACK_S1 after APPLIED | PASS |  |
| frozen-instance | plan schema requires the linked-identity fields ['session_id'] | PASS |  |
| frozen-instance | journal schema requires the linked-identity fields ['readback_guard_digest', 'readback_snapshot_sha256', 'session_id'] | PASS |  |
| frozen-instance | verification schema requires the linked-identity fields ['session_id'] | PASS |  |
| frozen-instance | commit schema requires the linked-identity fields ['s1_guard_digest', 's1_snapshot_sha256', 'session_id'] | PASS |  |
| frozen-instance | verification schema requires the derived applied_operation_ids and unobserved_domains (F15-06/F15-05) | PASS |  |
| frozen-instance | GUARD_SNAPSHOT records must carry the guard object, method_provenance and snapshot digest (F15-03) | PASS |  |
| frozen-instance | PLAN_VALIDATION records must name the composed validator, the H0 guard and the completed stages | PASS |  |
| active-authority | fixture placeholder is a well-formed sha256 and is not any real manifest | PASS |  |
| active-authority | the active capability authority is the CONTENT digest of the matrix object, not a file hash | PASS |  |
| active-authority | the fixture pins the active parser, primitive spec and reference shim identities | PASS |  |
| active-authority | fixture hypothetical matrix digest equals the content digest of the hypothetical matrix | PASS |  |
| active-authority | hypothetical matrix is labelled HYPOTHETICAL_NOT_AUTHORITY and is not the frozen matrix | PASS |  |
| active-authority | hypothetical refrozen matrix is internally consistent (reviewed refreeze block promoting exact probe ids + raw/derived/review digests) | PASS |  |
| active-authority | hypothetical refreeze names every promoted raw, derived and review digest of its QUALIFIED_READ rows | PASS |  |
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
| evidence-set-schema | attached-evidence-attribute-missing-accepted | PASS |  |
| evidence-set-binding | attached-evidence-attribute-missing-accepted | PASS |  |
| evidence-set-schema | attached-evidence-conflicting-current-reviews | PASS |  |
| evidence-set-binding | attached-evidence-conflicting-current-reviews | PASS |  |
| evidence-set-schema | attached-evidence-derived-artifact-missing | PASS |  |
| evidence-set-binding | attached-evidence-derived-artifact-missing | PASS |  |
| evidence-set-schema | attached-evidence-derived-artifact-of-other-raw | PASS |  |
| evidence-set-binding | attached-evidence-derived-artifact-of-other-raw | PASS |  |
| evidence-set-schema | attached-evidence-derived-cache-forged | PASS |  |
| evidence-set-binding | attached-evidence-derived-cache-forged | PASS |  |
| evidence-set-schema | attached-evidence-derived-cache-honest | PASS |  |
| evidence-set-binding | attached-evidence-derived-cache-honest | PASS |  |
| evidence-set-schema | attached-evidence-duplicate-current-refreeze | PASS |  |
| evidence-set-binding | attached-evidence-duplicate-current-refreeze | PASS |  |
| evidence-set-schema | attached-evidence-duplicate-current-review | PASS |  |
| evidence-set-binding | attached-evidence-duplicate-current-review | PASS |  |
| evidence-set-schema | attached-evidence-failed-getters | PASS |  |
| evidence-set-binding | attached-evidence-failed-getters | PASS |  |
| evidence-set-schema | attached-evidence-no-raw | PASS |  |
| evidence-set-binding | attached-evidence-no-raw | PASS |  |
| evidence-set-schema | attached-evidence-no-refreeze-record | PASS |  |
| evidence-set-binding | attached-evidence-no-refreeze-record | PASS |  |
| evidence-set-schema | attached-evidence-null-accepted | PASS |  |
| evidence-set-binding | attached-evidence-null-accepted | PASS |  |
| evidence-set-schema | attached-evidence-old-authority | PASS |  |
| evidence-set-binding | attached-evidence-old-authority | PASS |  |
| evidence-set-schema | attached-evidence-old-refreeze | PASS |  |
| evidence-set-binding | attached-evidence-old-refreeze | PASS |  |
| evidence-set-schema | attached-evidence-raised-accepted | PASS |  |
| evidence-set-binding | attached-evidence-raised-accepted | PASS |  |
| evidence-set-schema-negative | attached-evidence-raised-fake-parse-block | PASS | additionalProperties:records/<SHA256>/capture:Additional properties are not allowed ('parse', 'result' were unexpected) |
| evidence-set-binding-negative | attached-evidence-raised-fake-parse-block | PASS | 072efb17d0ec: capture carries forbidden interpretation field 'parse'; 072efb17d0ec: capture carries forbidden interpretation field 'result' |
| evidence-set-schema | attached-evidence-raw-tampered | PASS |  |
| evidence-set-binding-negative | attached-evidence-raw-tampered | PASS | 0337ef3bc3ca: capture raw_digest does not re-hash; 0db9df10dcd0: capture raw_digest does not re-hash |
| evidence-set-schema | attached-evidence-refreeze-other-session | PASS |  |
| evidence-set-binding | attached-evidence-refreeze-other-session | PASS |  |
| evidence-set-schema | attached-evidence-refreeze-stale-parser | PASS |  |
| evidence-set-binding | attached-evidence-refreeze-stale-parser | PASS |  |
| evidence-set-schema | attached-evidence-refreeze-stale-spec | PASS |  |
| evidence-set-binding | attached-evidence-refreeze-stale-spec | PASS |  |
| evidence-set-schema | attached-evidence-refreeze-unlisted-raw | PASS |  |
| evidence-set-binding | attached-evidence-refreeze-unlisted-raw | PASS |  |
| evidence-set-schema | attached-evidence-refreeze-unreviewed | PASS |  |
| evidence-set-binding | attached-evidence-refreeze-unreviewed | PASS |  |
| evidence-set-schema | attached-evidence-review-other-raw | PASS |  |
| evidence-set-binding | attached-evidence-review-other-raw | PASS |  |
| evidence-set-schema | attached-evidence-review-reject | PASS |  |
| evidence-set-binding | attached-evidence-review-reject | PASS |  |
| evidence-set-schema-negative | attached-evidence-review-stale-parser | PASS | const:records/<SHA256>/parser_version:'vidtoolz.resolveProbeParser.v1' was expected |
| evidence-set-binding | attached-evidence-review-stale-parser | PASS |  |
| evidence-set-schema | attached-evidence-review-stale-spec | PASS |  |
| evidence-set-binding | attached-evidence-review-stale-spec | PASS |  |
| evidence-set-schema | attached-evidence-reviewer-is-operator | PASS |  |
| evidence-set-binding | attached-evidence-reviewer-is-operator | PASS |  |
| evidence-set-schema | attached-evidence-superseded-review | PASS |  |
| evidence-set-binding | attached-evidence-superseded-review | PASS |  |
| evidence-set-schema | attached-evidence-timeout-accepted | PASS |  |
| evidence-set-binding | attached-evidence-timeout-accepted | PASS |  |
| evidence-set-schema | attached-evidence-truncated-accepted | PASS |  |
| evidence-set-binding | attached-evidence-truncated-accepted | PASS |  |
| evidence-set-schema | attached-evidence-unserializable-accepted | PASS |  |
| evidence-set-binding | attached-evidence-unserializable-accepted | PASS |  |
| evidence-set-schema | attached-evidence-wrong-build | PASS |  |
| evidence-set-binding | attached-evidence-wrong-build | PASS |  |
| evidence-set-schema | attached-evidence-wrong-receiver | PASS |  |
| evidence-set-binding | attached-evidence-wrong-receiver | PASS |  |
| evidence-set-schema | attached-evidence-wrong-type-accepted | PASS |  |
| evidence-set-binding | attached-evidence-wrong-type-accepted | PASS |  |
| evidence-set-schema | attached-fatal-probe-failure | PASS |  |
| evidence-set-binding-negative | attached-fatal-probe-failure | PASS | 3ee75546d6c5: capture binding library_root disagrees with envelope/contract/active authority; 3ee75546d6c5: capture binding library_uuid disagrees with envelope/contract/active authority |
| evidence-set-schema | attached-identity-duplicates-claimed-unique | PASS |  |
| evidence-set-binding | attached-identity-duplicates-claimed-unique | PASS |  |
| evidence-set-schema | attached-identity-duplicates-honest | PASS |  |
| evidence-set-binding | attached-identity-duplicates-honest | PASS |  |
| evidence-set-schema | attached-identity-observations | PASS |  |
| evidence-set-binding | attached-identity-observations | PASS |  |
| evidence-set-schema | attached-identity-stability-two-passes | PASS |  |
| evidence-set-binding | attached-identity-stability-two-passes | PASS |  |
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
| evidence-set-binding-negative | invalid-bundle-other-manifest-not-historical | PASS | 0f8cad61a010: BUNDLE_VERIFICATION bound to manifest 999999999999 != active reviewed manifest |
| evidence-set-schema | invalid-connection-other-authority | PASS |  |
| evidence-set-binding-negative | invalid-connection-other-authority | PASS | 25f8eb7155e5: CONNECTION_OBSERVATION bound to authority 1.5.0 != active 1.18.0 |
| evidence-set-schema | invalid-connection-wrong-manifest | PASS |  |
| evidence-set-binding-negative | invalid-connection-wrong-manifest | PASS | 21e6b5b0182c: CONNECTION_OBSERVATION bound to manifest 999999999999 != active reviewed manifest |
| evidence-set-schema-negative | invalid-provisioning-without-root | PASS | not:records/<SHA256>/envelope/library_root:None should not be valid under {'type': 'null'} |
| evidence-set-binding-negative | invalid-provisioning-without-root | PASS | d9d94b7e4788: PROVISIONING_RECORD: envelope.library_root required at level LIBRARY |
| evidence-set-schema-negative | invalid-retired-capability-evidence-type | PASS | enum:records/<SHA256>/record_type:'CAPABILITY_EVIDENCE' is not one of ['BUNDLE_VERIFICATION', 'CONNECTION_OBSERVATION', 'DERIVED_CAPABILITY_RESULT', 'DESTINATION_TIMELINE', 'EXCLUSIVE_SESSION_ATTESTATION', 'GUARD_SNAPSHO |
| evidence-set-binding-negative | invalid-retired-capability-evidence-type | PASS | 0e4daa5f3612: record_type CAPABILITY_EVIDENCE is RETIRED in v1.6 (capability evidence is RAW_CAPABILITY_CAPTURE + derived result + review) |
| evidence-set-schema | invalid-tampered-record | PASS |  |
| evidence-set-binding-negative | invalid-tampered-record | PASS | db2363bc6920: record_id does not match content digest |
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
| evidence-set-schema | write-ready-h0-candidate-provenance | PASS |  |
| evidence-set-binding | write-ready-h0-candidate-provenance | PASS |  |
| evidence-set-schema | write-ready-h0-forged-guard-object | PASS |  |
| evidence-set-binding | write-ready-h0-forged-guard-object | PASS |  |
| evidence-set-schema | write-ready-h0-full-timeline-read | PASS |  |
| evidence-set-binding | write-ready-h0-full-timeline-read | PASS |  |
| evidence-set-schema | write-ready-h0-incomplete-write-precheck | PASS |  |
| evidence-set-binding | write-ready-h0-incomplete-write-precheck | PASS |  |
| evidence-set-schema | write-ready-h0-minimal-m0 | PASS |  |
| evidence-set-binding | write-ready-h0-minimal-m0 | PASS |  |
| evidence-set-schema | write-ready-h0-other-matrix | PASS |  |
| evidence-set-binding | write-ready-h0-other-matrix | PASS |  |
| evidence-set-schema | write-ready-h0-other-target | PASS |  |
| evidence-set-binding | write-ready-h0-other-target | PASS |  |
| evidence-set-schema | write-ready-h0-provenance-swapped | PASS |  |
| evidence-set-binding | write-ready-h0-provenance-swapped | PASS |  |
| evidence-set-schema | write-ready-hyp | PASS |  |
| evidence-set-binding | write-ready-hyp | PASS |  |
| evidence-set-schema | write-ready-plan-validation-fail | PASS |  |
| evidence-set-binding | write-ready-plan-validation-fail | PASS |  |
| evidence-set-schema | write-ready-plan-validation-from-helper | PASS |  |
| evidence-set-binding | write-ready-plan-validation-from-helper | PASS |  |
| evidence-set-schema | write-ready-plan-validation-other-h0 | PASS |  |
| evidence-set-binding | write-ready-plan-validation-other-h0 | PASS |  |
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
| evidence-ref-negative | uppercase sha | PASS | M3_AUTHORIZATION: reference is not a sha256 ('2988F5A7A7E512C02175232118E478F4356AA126ADB90CCABF810DC812109064') |
| evidence-ref-negative | unlinked sha | PASS | M3_AUTHORIZATION: referenced record 999999999999 not in evidence set |
| evidence-ref-negative | wrong type | PASS | M3_AUTHORIZATION: record 2988f5a7a7e5 has type PROVISIONING_RECORD |
| evidence-ref-negative | short hex | PASS | M3_AUTHORIZATION: reference is not a sha256 ('2988f5a7a7e512c02175232118e478f4356aa126adb90ccabf810dc81210906') |
| evidence-ref-negative | sha with newline | PASS | M3_AUTHORIZATION: reference is not a sha256 ('<SHA256>\n') |
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
| attachment-derived | attached-evidence-attribute-missing-accepted -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-conflicting-current-reviews -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-derived-artifact-missing -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-derived-artifact-of-other-raw -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-derived-cache-forged -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-derived-cache-honest -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-duplicate-current-refreeze -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-duplicate-current-review -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-failed-getters -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-no-raw -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-no-refreeze-record -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-null-accepted -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-old-authority -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-old-refreeze -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-raised-accepted -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-raised-fake-parse-block -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', "072efb17d0ec: capture carries forbidden interpretation field 'parse'"] conflicts=[] |
| attachment-derived | attached-evidence-raw-tampered -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', '0337ef3bc3ca: capture raw_digest does not re-hash'] conflicts=[] |
| attachment-derived | attached-evidence-refreeze-other-session -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-refreeze-stale-parser -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-refreeze-stale-spec -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-refreeze-unlisted-raw -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-refreeze-unreviewed -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-review-other-raw -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-review-reject -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-review-stale-parser -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-review-stale-spec -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-reviewer-is-operator -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-superseded-review -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-timeout-accepted -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-truncated-accepted -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-unserializable-accepted -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-wrong-build -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-wrong-receiver -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-evidence-wrong-type-accepted -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-fatal-probe-failure -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', '3ee75546d6c5: capture binding library_root disagrees with envelope/contract/active authority'] conflicts=[] |
| attachment-derived | attached-identity-duplicates-claimed-unique -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-identity-duplicates-honest -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-identity-observations -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
| attachment-derived | attached-identity-stability-two-passes -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority', 'no current EXCLUSIVE_SESSION_ATTESTATION (NONE)'] conflicts=[] |
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
| attachment-derived | invalid-bundle-other-manifest-not-historical -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', '0f8cad61a010: BUNDLE_VERIFICATION bound to manifest 999999999999 != active reviewed manifest'] conflicts=[] |
| attachment-derived | invalid-connection-other-authority -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', '25f8eb7155e5: CONNECTION_OBSERVATION bound to authority 1.5.0 != active 1.18.0'] conflicts=[] |
| attachment-derived | invalid-connection-wrong-manifest -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', '21e6b5b0182c: CONNECTION_OBSERVATION bound to manifest 999999999999 != active reviewed manifest'] conflicts=[] |
| attachment-derived | invalid-provisioning-without-root -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', 'd9d94b7e4788: PROVISIONING_RECORD: envelope.library_root required at level LIBRARY'] conflicts=[] |
| attachment-derived | invalid-retired-capability-evidence-type -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', '0e4daa5f3612: record_type CAPABILITY_EVIDENCE is RETIRED in v1.6 (capability evidence is RAW_CAPABILITY_CAPTURE + derived result + review)'] conflicts=[] |
| attachment-derived | invalid-tampered-record -> CONFLICT | PASS | got CONFLICT; failures=['EVIDENCE_SET_INVALID', 'db2363bc6920: record_id does not match content digest'] conflicts=[] |
| attachment-derived | provisioned-only -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host (v1.12: result PASS, registered distinct-actor principals, the exact verified provisioning r |
| attachment-derived | ready -> ATTACHMENT_READY | PASS | got ATTACHMENT_READY; failures=['no CONNECTION_OBSERVATION in the current session'] conflicts=[] |
| attachment-derived | ready-bundle-historical-only -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host (v1.12: result PASS, registered distinct-actor principals, the exact verified provisioning r |
| attachment-derived | ready-bundle-other-host -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host (v1.12: result PASS, registered distinct-actor principals, the exact verified provisioning r |
| attachment-derived | ready-ghost-session-without-launch -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no LAUNCH_RECIPE for the current session bound to this provisioning record, contract version, binary pin and Local scripting'] conflicts=[] |
| attachment-derived | ready-launch-previous-session-only -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no LAUNCH_RECIPE for the current session bound to this provisioning record, contract version, binary pin and Local scripting'] conflicts=[] |
| attachment-derived | ready-no-current-session -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no current_session_id'] conflicts=[] |
| attachment-derived | ready-self-verified-bundle -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host (v1.12: result PASS, registered distinct-actor principals, the exact verified provisioning r |
| attachment-derived | ready-wrong-binary-pin -> PROVISIONED_NOT_VERIFIED | PASS | got PROVISIONED_NOT_VERIFIED; failures=['no LAUNCH_RECIPE for the current session bound to this provisioning record, contract version, binary pin and Local scripting'] conflicts=[] |
| attachment-derived | write-ready-authorization-old-authority -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no M3_AUTHORIZATION for scratch scope under the active authority'] conflicts=[] |
| attachment-derived | write-ready-base -> SCRATCH_WRITE_READY | PASS | got SCRATCH_WRITE_READY; failures=[] conflicts=[] |
| attachment-derived | write-ready-full -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-h0-candidate-provenance -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-h0-forged-guard-object -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-h0-full-timeline-read -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-h0-incomplete-write-precheck -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-h0-minimal-m0 -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-h0-other-matrix -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-h0-other-target -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-h0-provenance-swapped -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-hyp -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-plan-validation-fail -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-plan-validation-from-helper -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
| attachment-derived | write-ready-plan-validation-other-h0 -> ATTACHED_READ_ONLY | PASS | got ATTACHED_READ_ONLY; failures=['no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix'] conflicts=[] |
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
| raw-capture | an honest capture record validates against the evidence-set schema and its structural law | PASS |  |
| raw-capture | the capture body re-hashes to its raw_digest and the record names it | PASS |  |
| raw-capture | forbidden interpretation field 'success' makes the capture MALFORMED and schema-invalid | PASS |  |
| raw-capture | forbidden interpretation field 'qualified' makes the capture MALFORMED and schema-invalid | PASS |  |
| raw-capture | forbidden interpretation field 'reviewed' makes the capture MALFORMED and schema-invalid | PASS |  |
| raw-capture | forbidden interpretation field 'expected_type_match' makes the capture MALFORMED and schema-invalid | PASS |  |
| raw-capture | forbidden interpretation field 'classification' makes the capture MALFORMED and schema-invalid | PASS |  |
| raw-capture | forbidden interpretation field 'parse' makes the capture MALFORMED and schema-invalid | PASS |  |
| raw-capture | forbidden interpretation field 'parsed_observation' makes the capture MALFORMED and schema-invalid | PASS |  |
| raw-capture | forbidden interpretation field 'result' makes the capture MALFORMED and schema-invalid | PASS |  |
| raw-capture | forbidden interpretation field 'decision' makes the capture MALFORMED and schema-invalid | PASS |  |
| raw-capture | forbidden interpretation field 'promotion' makes the capture MALFORMED and schema-invalid | PASS |  |
| raw-capture | forbidden interpretation field 'promoted' makes the capture MALFORMED and schema-invalid | PASS |  |
| raw-capture | forbidden interpretation field 'shape_ok' makes the capture MALFORMED and schema-invalid | PASS |  |
| raw-capture | forbidden interpretation field 'observed_type' makes the capture MALFORMED and schema-invalid | PASS |  |
| raw-capture | the mechanical outcome vocabulary is closed and exclusive (a second outcome block is refused) | PASS |  |
| raw-capture | one changed byte in the returned value breaks the digest -> MALFORMED (never silently reinterpreted) | PASS |  |
| raw-capture | the capture pins the shim identity, the operator and the serialization limits | PASS |  |
| raw-capture | the receiver navigation path and handle token are recorded (a capture cannot be relocated to another receiver) | PASS |  |
| codec | None/bool/int/float/str are tagged and bool is never an int | PASS |  |
| codec | mapping key order never changes the encoding (canonical ordered pairs) | PASS |  |
| codec | empty containers are distinct from None and from each other | PASS |  |
| codec | integers beyond 2^53 become explicit bigint strings | PASS |  |
| codec | positive and negative zero stay distinct facts | PASS |  |
| codec | NaN and infinities are recorded as explicit non-finite facts, never as numbers | PASS |  |
| codec | bytes are recorded by length + digest + head, never inlined | PASS |  |
| codec | an opaque Resolve-like object becomes a descriptor (class, module, handle token, repr digest); no identity is inferred | PASS |  |
| codec | cyclic value -> UnsupportedValue (never guessed) | PASS | CYCLE |
| codec | callable value -> UnsupportedValue (never guessed) | PASS | CALLABLE_OR_TYPE |
| codec | oversized/deep values are elided with a truncation flag, elided paths and a full-value digest | PASS |  |
| codec | structural codec validation accepts honest values and rejects unknown tags / bad payloads | PASS |  |
| codec | the codec broad type maps every tag into the expectation vocabulary | PASS |  |
| shim-safety | SetName: refused BEFORE invocation even when wrongly allowlisted | PASS |  |
| shim-safety | AppendToTimeline: refused BEFORE invocation even when wrongly allowlisted | PASS |  |
| shim-safety | DeleteClips: refused BEFORE invocation even when wrongly allowlisted | PASS |  |
| shim-safety | CreateEmptyTimeline: refused BEFORE invocation even when wrongly allowlisted | PASS |  |
| shim-safety | ImportMedia: refused BEFORE invocation even when wrongly allowlisted | PASS |  |
| shim-safety | run_script: refused BEFORE invocation even when wrongly allowlisted | PASS |  |
| shim-safety | execute_lua: refused BEFORE invocation even when wrongly allowlisted | PASS |  |
| shim-safety | SaveProject: refused BEFORE invocation even when wrongly allowlisted | PASS |  |
| shim-safety | no write-like or script method was ever invoked by the shim | PASS | [] |
| shim-safety | a non-allowlisted getter is refused, not invoked | PASS |  |
| shim-safety | the allowlist is the static 47-method probe list | PASS |  |
| shim-safety | an instance-level monkeypatched getter is refused (the shim only calls class methods) | PASS |  |
| shim-safety | a getter that raises is recorded as RAISED with class/module/message and no classification | PASS |  |
| shim-safety | a getter that hangs is recorded as TIMEOUT with integer milliseconds | PASS |  |
| shim-safety | a missing attribute is ATTRIBUTE_MISSING, an unserializable return is UNSERIALIZABLE (never a guess) | PASS |  |
| shim-safety | an absent receiver is TRANSPORT_FAILURE | PASS |  |
| shim-safety | the reference shim never imports a Resolve bridge, never writes a matrix and never reviews | PASS |  |
| re-parser | an honest capture derives SUCCESS with facts and the hypothesis status of the spec | PASS |  |
| re-parser | the same capture + parser + spec derive the same digest (8 repeats, shuffled input key order) | PASS |  |
| re-parser | the derived result carries the parser identity and re-hashes | PASS |  |
| re-parser | every one of the 47 honest captures derives SUCCESS under its documented expectation | PASS |  |
| re-parser | derived class EXCEPTION for its capture shape | PASS | got EXCEPTION: ['RuntimeError: getter crashed'] |
| re-parser | derived class TIMEOUT for its capture shape | PASS | got TIMEOUT: [] |
| re-parser | derived class UNSUPPORTED for its capture shape | PASS | got UNSUPPORTED: [] |
| re-parser | derived class UNSERIALIZABLE for its capture shape | PASS | got UNSERIALIZABLE: [] |
| re-parser | derived class TYPE_MISMATCH for its capture shape | PASS | got TYPE_MISMATCH: ['int != expected str'] |
| re-parser | derived class NULL_NOT_ALLOWED for its capture shape | PASS | got NULL_NOT_ALLOWED: ['None returned; primitive is non-nullable'] |
| re-parser | derived class TRUNCATED for its capture shape | PASS | got TRUNCATED: ['value truncated/elided but the primitive requires a complete value'] |
| re-parser | derived class REFUSED for its capture shape | PASS | got REFUSED: [] |
| re-parser | derived class TRANSPORT_FAILURE for its capture shape | PASS | got TRANSPORT_FAILURE: [] |
| re-parser | derived class RECEIVER_MISMATCH for its capture shape | PASS | got RECEIVER_MISMATCH: ['Timeline != Resolve'] |
| re-parser | derived class ARGS_MISMATCH for its capture shape | PASS | got ARGS_MISMATCH: ["['int'] != ['str']"] |
| re-parser | derived class MALFORMED for its capture shape | PASS | got MALFORMED: ['raw_digest does not re-hash'] |
| re-parser | derived class BINDING_MISMATCH for its capture shape | PASS | got BINDING_MISMATCH: ["resolve_version='21.0.3.0007' != active/contract '21.1.0.0014'"] |
| re-parser | the derived class vocabulary is closed and every non-SUCCESS class has a family | PASS |  |
| re-parser | an empty value where the expectation says NON_EMPTY is TYPE_MISMATCH, and NONE shape rules accept empty containers | PASS |  |
| re-parser | a nullable primitive accepts None as SUCCESS with an explicit null fact | PASS |  |
| re-parser | a capture evaluated against another method's spec is MALFORMED (a spec can never be swapped in) | PASS |  |
| re-parser | a spec whose expectation changed produces a different derived digest (spec digest is part of the derivation) | PASS |  |
| re-parser | the parser identity is the hash of its own source: a changed parser cannot pretend to be the active one | PASS |  |
| raw-vs-fake-parse | raw RAISED RuntimeError + an EXTERNAL fabricated successful parse block: the machine derives EXCEPTION and the fake block is not an input at all | PASS |  |
| raw-vs-fake-parse | the same fabricated block injected INTO the capture makes it MALFORMED (schema-forbidden interpretation fields) | PASS |  |
| raw-vs-fake-parse | a reviewer cannot ACCEPT a derived EXCEPTION (review law refuses it) | PASS |  |
| raw-vs-fake-parse | no refreeze can promote it: the recomputation is EXCEPTION, so the promotion is refused | PASS |  |
| raw-vs-fake-parse | QUALIFIED_READ is unreachable: under every fabricated-interpretation evidence set the primitive stays UNQUALIFIED and the callable set stays empty | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (RAISED getter): matrix, refreeze record and ACCEPT review all name this capture, and it is still UNQUALIFIED because the parser derives EXCEPTION | PASS | status=UNQUALIFIED reasons=['reference parser derives EXCEPTION (RuntimeError: getter crashed); not SUCCESS'] |
| raw-vs-fake-parse | COHERENT hostile chain (RAISED getter): the promoted review is refused and the refreeze record is refused for the same reason | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (RAISED getter): the callable set stays empty and the promotion state never reaches ACTIVE_QUALIFIED_READ | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (TIMEOUT getter): matrix, refreeze record and ACCEPT review all name this capture, and it is still UNQUALIFIED because the parser derives TIMEOUT | PASS | status=UNQUALIFIED reasons=['reference parser derives TIMEOUT (); not SUCCESS'] |
| raw-vs-fake-parse | COHERENT hostile chain (TIMEOUT getter): the promoted review is refused and the refreeze record is refused for the same reason | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (TIMEOUT getter): the callable set stays empty and the promotion state never reaches ACTIVE_QUALIFIED_READ | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (missing attribute): matrix, refreeze record and ACCEPT review all name this capture, and it is still UNQUALIFIED because the parser derives UNSUPPORTED | PASS | status=UNQUALIFIED reasons=['reference parser derives UNSUPPORTED (); not SUCCESS'] |
| raw-vs-fake-parse | COHERENT hostile chain (missing attribute): the promoted review is refused and the refreeze record is refused for the same reason | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (missing attribute): the callable set stays empty and the promotion state never reaches ACTIVE_QUALIFIED_READ | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (wrong return type): matrix, refreeze record and ACCEPT review all name this capture, and it is still UNQUALIFIED because the parser derives TYPE_MISMATCH | PASS | status=UNQUALIFIED reasons=['reference parser derives TYPE_MISMATCH (int != expected str); not SUCCESS'] |
| raw-vs-fake-parse | COHERENT hostile chain (wrong return type): the promoted review is refused and the refreeze record is refused for the same reason | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (wrong return type): the callable set stays empty and the promotion state never reaches ACTIVE_QUALIFIED_READ | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (None where non-nullable): matrix, refreeze record and ACCEPT review all name this capture, and it is still UNQUALIFIED because the parser derives NULL_NOT_ALLOWED | PASS | status=UNQUALIFIED reasons=['reference parser derives NULL_NOT_ALLOWED (None returned; primitive is non-nullable); not SUCCESS'] |
| raw-vs-fake-parse | COHERENT hostile chain (None where non-nullable): the promoted review is refused and the refreeze record is refused for the same reason | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (None where non-nullable): the callable set stays empty and the promotion state never reaches ACTIVE_QUALIFIED_READ | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (unserializable return): matrix, refreeze record and ACCEPT review all name this capture, and it is still UNQUALIFIED because the parser derives UNSERIALIZABLE | PASS | status=UNQUALIFIED reasons=['reference parser derives UNSERIALIZABLE (); not SUCCESS'] |
| raw-vs-fake-parse | COHERENT hostile chain (unserializable return): the promoted review is refused and the refreeze record is refused for the same reason | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (unserializable return): the callable set stays empty and the promotion state never reaches ACTIVE_QUALIFIED_READ | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (empty value where NON_EMPTY): matrix, refreeze record and ACCEPT review all name this capture, and it is still UNQUALIFIED because the parser derives TYPE_MISMATCH | PASS | status=UNQUALIFIED reasons=['reference parser derives TYPE_MISMATCH (empty value where NON_EMPTY required); not SUCCESS'] |
| raw-vs-fake-parse | COHERENT hostile chain (empty value where NON_EMPTY): the promoted review is refused and the refreeze record is refused for the same reason | PASS |  |
| raw-vs-fake-parse | COHERENT hostile chain (empty value where NON_EMPTY): the callable set stays empty and the promotion state never reaches ACTIVE_QUALIFIED_READ | PASS |  |
| raw-vs-fake-parse | the same coherent chain over the HONEST capture does qualify (the control is valid: only the derived class differs) | PASS |  |
| raw-vs-fake-parse | timeout + ACCEPT review -> UNQUALIFIED (derived TIMEOUT or unresolvable evidence) | PASS | status=UNQUALIFIED reasons=['raw capture missing, malformed, unbound, untrusted or ambiguous'] |
| raw-vs-fake-parse | attribute missing + ACCEPT review -> UNQUALIFIED (derived UNSUPPORTED or unresolvable evidence) | PASS | status=UNQUALIFIED reasons=['raw capture missing, malformed, unbound, untrusted or ambiguous'] |
| raw-vs-fake-parse | wrong type + ACCEPT review -> UNQUALIFIED (derived TYPE_MISMATCH or unresolvable evidence) | PASS | status=UNQUALIFIED reasons=['raw capture missing, malformed, unbound, untrusted or ambiguous'] |
| raw-vs-fake-parse | null + ACCEPT review -> UNQUALIFIED (derived NULL_NOT_ALLOWED or unresolvable evidence) | PASS | status=UNQUALIFIED reasons=['raw capture missing, malformed, unbound, untrusted or ambiguous'] |
| raw-vs-fake-parse | truncated + ACCEPT review -> UNQUALIFIED (derived TRUNCATED or unresolvable evidence) | PASS | status=UNQUALIFIED reasons=['raw capture missing, malformed, unbound, untrusted or ambiguous'] |
| raw-vs-fake-parse | unserializable + ACCEPT review -> UNQUALIFIED (derived UNSERIALIZABLE or unresolvable evidence) | PASS | status=UNQUALIFIED reasons=['raw capture missing, malformed, unbound, untrusted or ambiguous'] |
| raw-vs-fake-parse | tampered raw + ACCEPT review -> UNQUALIFIED (derived MALFORMED or unresolvable evidence) | PASS | status=UNQUALIFIED reasons=['raw capture missing, malformed, unbound, untrusted or ambiguous'] |
| raw-vs-fake-parse | wrong receiver + ACCEPT review -> UNQUALIFIED (derived RECEIVER_MISMATCH or unresolvable evidence) | PASS | status=UNQUALIFIED reasons=['raw capture missing, malformed, unbound, untrusted or ambiguous'] |
| raw-vs-fake-parse | wrong build/session + ACCEPT review -> UNQUALIFIED (derived BINDING_MISMATCH or unresolvable evidence) | PASS | status=UNQUALIFIED reasons=['raw capture missing, malformed, unbound, untrusted or ambiguous'] |
| review-law | an honest ACCEPT review of a derived SUCCESS is valid and binds raw, derived, parser and spec digests | PASS |  |
| review-law | a review of another raw capture is refused | PASS | review references a raw capture that is missing, malformed or ambiguous |
| review-law | a review naming a derived digest that does not recompute is refused | PASS | review references a derived result that does not recompute under the active parser/spec |
| review-law | a review bound to an older parser is refused | PASS | review bound to another parser version/hash |
| review-law | a review bound to another primitive spec is refused | PASS | review bound to another primitive spec digest |
| review-law | a review by the probe operator is refused | PASS | reviewer must differ from the probe operator |
| review-law | a review of another method is refused | PASS | review method/receiver differ from the raw capture |
| review-law | a review from another probe run is refused | PASS | review probe/session differ from the raw capture |
| review-law | a review without a rationale is refused | PASS | reviewer and rationale required |
| review-law | REJECT and DEFER are valid decisions over any derived class, but only ACCEPT can promote | PASS |  |
| review-law | the stored derived result is only a cache: a forged cache is rejected against the recomputation | PASS |  |
| refreeze-law | the honest refreeze record validates against the successor matrix and every promotion re-derives to SUCCESS | PASS |  |
| refreeze-law | a refreeze bound to another parser is refused | PASS | refreeze bound to another parser version/hash |
| refreeze-law | a refreeze bound to another primitive spec is refused | PASS | refreeze bound to another primitive spec digest |
| refreeze-law | a refreeze naming another successor matrix is refused | PASS | refreeze does not name the supplied successor matrix |
| refreeze-law | a refreeze with a stale parent matrix is refused | PASS | parent matrix differs between record and matrix block |
| refreeze-law | a refreeze from another session is refused | PASS | GetItemListInTrack: raw capture from another probe/session |
| refreeze-law | a refreeze from another probe run is refused | PASS | GetItemListInTrack: raw capture from another probe/session |
| refreeze-law | a refreeze on another host is refused | PASS | refreeze host_name differs from the contract environment |
| refreeze-law | a refreeze on another build is refused | PASS | refreeze build differs from the contract environment |
| refreeze-law | a refreeze without a human approver is refused | PASS | refreeze requires a human approver |
| refreeze-law | a refreeze promoting a raw capture that is not in the evidence set is refused | PASS | refreeze record promoted_raw_capture_sha256 differs from the matrix refreeze block |
| refreeze-law | a refreeze whose promoted review digest is absent is refused | PASS | refreeze record promoted_review_decision_sha256 differs from the matrix refreeze block |
| refreeze-law | a refreeze whose promoted derived digest is not the recomputation is refused | PASS | refreeze record promoted_derived_result_sha256 differs from the matrix refreeze block |
| refreeze-law | evidence A reviewed but evidence B promoted (a review of one capture can never promote another) | PASS |  |
| refreeze-law | the refreeze record and the matrix refreeze block must promote identical digest sets | PASS |  |
| matrix-integrity | the frozen matrix is the active matrix; a forged QUALIFIED_READ matrix under the same active digest is refused | PASS |  |
| matrix-integrity | an invented QUALIFIED_READ matrix cited under the REAL frozen zero-qualified digest cannot qualify anything (primitive_status and the callable set stay empty) | PASS |  |
| matrix-integrity | the hypothetical successor matrix qualifies ONLY when supplied as its own content (its digest is the active one) | PASS |  |
| matrix-integrity | a single changed byte of the successor matrix changes its digest and revokes qualification | PASS |  |
| matrix-integrity | the frozen matrix qualifies nothing and the hypothetical one qualifies exactly the 47 probe methods | PASS |  |
| matrix-integrity | GetStartFrame alone drops out when its capture is absent (per-method evidence, not a blanket flag) | PASS |  |
| matrix-integrity | the retired CAPABILITY_EVIDENCE record type is refused by the evidence-set law | PASS |  |
| promotion | an honest capture with a valid ACCEPT review, refreeze and active matrix derives ACTIVE_QUALIFIED_READ | PASS |  |
| promotion | the same evidence under the frozen (non-active) matrix stops at PROMOTED_IN_REFREEZE | PASS |  |
| promotion | a capture with no review is CANDIDATE; with a REJECT review it is REVIEWED_REJECTED (terminal) | PASS |  |
| promotion | a valid ACCEPT without a refreeze stops at REVIEWED_ACCEPTED | PASS |  |
| promotion | CANDIDATE --REFREEZE--> refused | PASS | illegal transition CANDIDATE --REFREEZE--> PROMOTED_IN_REFREEZE |
| promotion | CANDIDATE --ACTIVATE--> refused | PASS | illegal transition CANDIDATE --ACTIVATE--> ACTIVE_QUALIFIED_READ |
| promotion | CANDIDATE --REVIEW_ACCEPT--> refused | PASS | REVIEW_ACCEPT guard failed (review invalid or derived not SUCCESS) |
| promotion | CANDIDATE --REVIEW_ACCEPT--> allowed | PASS |  |
| promotion | REVIEWED_ACCEPTED --REFREEZE--> refused | PASS | REFREEZE guard failed |
| promotion | REVIEWED_ACCEPTED --REFREEZE--> allowed | PASS |  |
| promotion | PROMOTED_IN_REFREEZE --ACTIVATE--> refused | PASS | ACTIVATE guard failed (matrix not active or primitive not derivable as QUALIFIED_CALLABLE) |
| promotion | PROMOTED_IN_REFREEZE --ACTIVATE--> refused | PASS | ACTIVATE guard failed (matrix not active or primitive not derivable as QUALIFIED_CALLABLE) |
| promotion | PROMOTED_IN_REFREEZE --ACTIVATE--> allowed | PASS |  |
| promotion | REVIEWED_REJECTED --REFREEZE--> refused | PASS | illegal transition REVIEWED_REJECTED --REFREEZE--> PROMOTED_IN_REFREEZE |
| promotion | ACTIVE_QUALIFIED_READ --REVIEW_ACCEPT--> refused | PASS | illegal transition ACTIVE_QUALIFIED_READ --REVIEW_ACCEPT--> REVIEWED_ACCEPTED |
| promotion | the promotion state vocabulary and transitions are closed (no direct jump exists) | PASS |  |
| identity-evidence | A callable, B unique within a pass and C stable across 3 passes are all true on the honest fixture and are separate claims | PASS |  |
| identity-evidence | duplicate ids: A true, B FALSE with the duplicate listed, and C NOT claimed either (v1.7 C16-M1: identity that is not unique within one pass is not identity, so its apparent stability proves nothing) | PASS |  |
| identity-evidence | two passes are never enough for C, and a failed capture breaks A and B | PASS |  |
| identity-evidence | no identity claim covers mutation or save/reopen survival (M3 P6/P15 remain the only place for that) | PASS |  |
| identity-evidence | honest uniqueness and stability observations validate (claims recomputed from the re-parsed captures) | PASS |  |
| identity-evidence | an observation claiming uniqueness over duplicate captures is refused against the recomputation | PASS |  |
| identity-evidence | an honest observation that records the duplicates is valid evidence (a failure is recorded, not hidden) | PASS |  |
| identity-evidence | a stability observation with fewer than three passes is refused | PASS |  |
| identity-evidence | an identity observation may not carry a survival claim | PASS |  |
| identity-evidence | occurrence identity stays fail-closed on duplicates regardless of the identity claims | PASS |  |
| fixture-schema-positive | capabilities-frozen | PASS |  |
| fixture-semantic-positive | capabilities-frozen | PASS |  |
| fixture-schema-negative | capabilities-missing-content-law | PASS | required::'matrix_content_law' is a required property |
| fixture-schema-negative | capabilities-missing-refreeze-block | PASS | required::'refreeze' is a required property |
| fixture-schema-negative | capabilities-prior-record-claims-success | PASS | enum:rows/0/evidence_records/0/result:'SUCCESS' is not one of ['UNQUALIFIED_PRIOR_VERSION', None] |
| fixture-schema-negative | capabilities-qualified-read-entry-with-success-flag | PASS | additionalProperties:rows/0/evidence_records/0:Additional properties are not allowed ('success' was unexpected) |
| fixture-schema-positive | capabilities-qualified-read-evidence-not-promoted-by-refreeze | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-evidence-not-promoted-by-refreeze | PASS | row 'read: connection': evidence GetVersionString is not explicitly promoted by the refreeze block (probe id + raw + derived + review digests); row 'read: connection': probe_candidate only allowed on DOCUMENTED_NOT_QUALI |
| fixture-schema-positive | capabilities-qualified-read-promoted-by-other-refreeze | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-promoted-by-other-refreeze | PASS | row 'read: connection': QUALIFIED_READ without exact version-matched v1.6 evidence entry (raw/derived/review digests) promoted by this matrix version; row 'read: connection': QUALIFIED_READ requires a reviewed refreeze b |
| fixture-schema-positive | capabilities-qualified-read-unreviewed-refreeze-block | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-unreviewed-refreeze-block | PASS | row 'read: connection': QUALIFIED_READ requires a reviewed refreeze block on the matrix; row 'read: connection': evidence GetVersionString is not explicitly promoted by the refreeze block (probe id + raw + derived + revi |
| fixture-schema-positive | capabilities-qualified-read-without-exact-evidence | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-without-exact-evidence | PASS | row 'read: connection': QUALIFIED_READ without exact version-matched v1.6 evidence entry (raw/derived/review digests) promoted by this matrix version; row 'read: connection': QUALIFIED_READ requires a reviewed refreeze b |
| fixture-schema-negative | capabilities-refreeze-block-old-parser-version | PASS | const:refreeze/parser_version:'vidtoolz.resolveProbeParser.v1' was expected |
| fixture-schema-positive | capabilities-refreeze-block-stale-parser | PASS |  |
| fixture-semantic-negative | capabilities-refreeze-block-stale-parser | PASS | refreeze block: refreeze block bound to another parser version/hash |
| fixture-schema-negative | capabilities-unknown-evidence-class | PASS | enum:rows/0/evidence_class:'QUALIFIED' is not one of ['QUALIFIED_READ', 'DOCUMENTED_NOT_QUALIFIED', 'NOT_TESTED', 'UNSUPPORTED', 'BLOCKED', 'QUALIFIED_EF_SIDE'] |
| fixture-schema-positive | capabilities-unreviewed-block-promotes | PASS |  |
| fixture-semantic-negative | capabilities-unreviewed-block-promotes | PASS | unreviewed refreeze block promotes evidence |
| fixture-schema-positive | capabilities-v16-entry-on-unqualified-row | PASS |  |
| fixture-semantic-negative | capabilities-v16-entry-on-unqualified-row | PASS | row 'read: connection': v1.6 evidence entry on a row that is not QUALIFIED_READ |
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
| fixture-schema-positive | journal-checkpointed-without-checkpoint-evidence | PASS |  |
| fixture-semantic-negative | journal-checkpointed-without-checkpoint-evidence | PASS | seq 3: CHECKPOINTED must carry checkpoint {checkpoint_sha256} (DuplicateTimeline + DRT export + SaveProject evidence) |
| fixture-schema-positive | journal-duplicate-readback-events | PASS |  |
| fixture-semantic-negative | journal-duplicate-readback-events | PASS | seq 7: illegal transition READBACK_S1 -> READBACK_S1; multiple READBACK_S1 records (ambiguous readback) |
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
| fixture-schema-positive | journal-non-checkpoint-carries-checkpoint | PASS |  |
| fixture-semantic-negative | journal-non-checkpoint-carries-checkpoint | PASS | seq 5: only CHECKPOINTED may carry a checkpoint |
| fixture-schema-positive | journal-non-operation-state-carries-operation | PASS |  |
| fixture-semantic-negative | journal-non-operation-state-carries-operation | PASS | seq 1: non-operation state LEASED carries operation_id/op |
| fixture-schema-positive | journal-non-readback-carries-readback-digest | PASS |  |
| fixture-semantic-negative | journal-non-readback-carries-readback-digest | PASS | seq 5: only READBACK_S1 may carry readback digests |
| fixture-schema-positive | journal-op-started-without-checkpoint | PASS |  |
| fixture-semantic-negative | journal-op-started-without-checkpoint | PASS | seq 3: illegal transition PREFLIGHT_OK -> OP_STARTED; S1 supplied but the journal has no READBACK_S1 event |
| fixture-schema-positive | journal-op-type-inconsistent-with-plan | PASS |  |
| fixture-semantic-negative | journal-op-type-inconsistent-with-plan | PASS | seq 5: op DELETE inconsistent with plan entry APPEND |
| fixture-schema-positive | journal-operation-applied-twice | PASS |  |
| fixture-semantic-negative | journal-operation-applied-twice | PASS | seq 6: operation op-1 started twice; seq 7: operation_id op-1 applied twice |
| fixture-schema-positive | journal-operation-failed-aborted | PASS |  |
| fixture-semantic-positive | journal-operation-failed-aborted | PASS |  |
| fixture-schema-positive | journal-operation-set-digest-drift | PASS |  |
| fixture-semantic-negative | journal-operation-set-digest-drift | PASS | seq 6: operation_set_digest changed mid-chain |
| fixture-schema-positive | journal-operation-set-digest-not-plan | PASS |  |
| fixture-semantic-negative | journal-operation-set-digest-not-plan | PASS | journal operation_set_digest != plan |
| fixture-schema-positive | journal-plan-digest-change-mid-chain | PASS |  |
| fixture-semantic-negative | journal-plan-digest-change-mid-chain | PASS | seq 6: plan_digest changed mid-chain |
| fixture-schema-positive | journal-readback-before-all-applied | PASS |  |
| fixture-semantic-negative | journal-readback-before-all-applied | PASS | seq 4: illegal transition CHECKPOINTED -> READBACK_S1; seq 4: READBACK_S1 before all plan operations applied (missing ['op-1']) |
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
| fixture-schema-negative | plan-authority-version-old | PASS | const:authority_version:'1.18.0' was expected |
| fixture-schema-positive | plan-digest-not-of-body | PASS |  |
| fixture-semantic-negative | plan-digest-not-of-body | PASS | plan_digest does not match plan body digest; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", "PLAN_VALIDATED (PLAN_VALIDATION: record 1fe7b |
| fixture-schema-positive | plan-duplicate-operation-id | PASS |  |
| fixture-semantic-negative | plan-duplicate-operation-id | PASS | operation ids must be unique and non-empty; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", "PLAN_VALIDATED (PLAN_VALIDATION: record 1fe7b6 |
| fixture-schema-positive | plan-eligible-without-prepared-journal | PASS |  |
| fixture-eligibility-negative | plan-eligible-without-prepared-journal | PASS | operation APPEND not eligible: ['JOURNAL_PREPARED (JOURNAL_PREPARED: referenced record 883af2969407 not in evidence set)', 'PLAN_VALIDATED (PLAN_VALIDATION: referenced record 1fe7b6a908b7 not in evidence set)', 'GUARD_CU |
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
| fixture-semantic-negative | plan-operation-set-digest-mismatch | PASS | operation_set_digest does not match operations; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", "PLAN_VALIDATED (PLAN_VALIDATION: record 1f |
| fixture-schema-positive | plan-plan-validation-record-fail | PASS |  |
| fixture-eligibility-negative | plan-plan-validation-record-fail | PASS | operation APPEND not eligible: ['PLAN_VALIDATED (PLAN_VALIDATION: referenced record 1fe7b6a908b7 not in evidence set)'] |
| fixture-schema-positive | plan-read-class-with-append | PASS |  |
| fixture-semantic-negative | plan-read-class-with-append | PASS | RESOLVE_READ permission class cannot carry write operations; operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", "PLAN_VALIDATED (PLAN_VALIDATI |
| fixture-schema-positive | plan-selector-target-mismatch | PASS |  |
| fixture-semantic-negative | plan-selector-target-mismatch | PASS | operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", "PLAN_VALIDATED (PLAN_VALIDATION: record 1fe7b6a908b7 plan_digest='<SHA256>' != '<SHA256>') |
| fixture-schema-positive | plan-session-not-current | PASS |  |
| fixture-semantic-negative | plan-session-not-current | PASS | plan session_id != evidence set current_session_id (execution session mismatch); operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", "PLAN_VALI |
| fixture-schema-positive | plan-stale-guard | PASS |  |
| fixture-semantic-negative | plan-stale-guard | PASS | operation APPEND not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", "PLAN_VALIDATED (PLAN_VALIDATION: record 1fe7b6a908b7 plan_digest='<SHA256>' != '<SHA256>') |
| fixture-schema-positive | read-primitives-class-mismatch-with-matrix | PASS |  |
| fixture-semantic-negative | read-primitives-class-mismatch-with-matrix | PASS | SNAPSHOT_CAPTURE: primitive GetTrackCount evidence_class QUALIFIED_READ != matrix DOCUMENTED_NOT_QUALIFIED |
| fixture-schema-positive | read-primitives-frozen-expectation-without-refreeze | PASS |  |
| fixture-semantic-negative | read-primitives-frozen-expectation-without-refreeze | PASS | READ_PRIMITIVE_QUALIFICATION_PROBE: primitive Folder.GetUniqueId claims FROZEN expectation without probe-validated refreeze |
| fixture-schema-positive | read-primitives-frozen | PASS |  |
| fixture-semantic-positive | read-primitives-frozen | PASS |  |
| fixture-schema-negative | read-primitives-invented-target-requirement | PASS | enum:logical_operations/CONNECT/target_requirement:'CURRENT_PROJECT' is not one of ['SESSION', 'PROJECT', 'PROJECT_TIMELINE'] |
| fixture-schema-negative | read-primitives-missing-expected-type | PASS | required:logical_operations/CONNECT/primitives/0:'expected_type' is a required property |
| fixture-schema-negative | read-primitives-missing-nullable | PASS | required:logical_operations/READ_PRIMITIVE_QUALIFICATION_PROBE/primitives/0:'nullable' is a required property |
| fixture-schema-negative | read-primitives-missing-receiver | PASS | required:logical_operations/CONNECT/primitives/0:'receiver' is a required property |
| fixture-schema-positive | read-primitives-probe-allowed-outside-probe | PASS |  |
| fixture-semantic-negative | read-primitives-probe-allowed-outside-probe | PASS | SNAPSHOT_CAPTURE: probe_allowed primitives only inside READ_PRIMITIVE_QUALIFICATION_PROBE |
| fixture-schema-negative | read-primitives-probe-output-not-raw | PASS | enum:logical_operations/READ_PRIMITIVE_QUALIFICATION_PROBE/evidence_output:'CANDIDATE_EVIDENCE' is not one of ['RAW_CAPABILITY_CAPTURE', 'NONE'] |
| fixture-schema-positive | read-primitives-spec-changed-without-digest | PASS |  |
| fixture-semantic-negative | read-primitives-spec-changed-without-digest | PASS | READ-PRIMITIVES.primitive_spec_sha256 does not equal the digest of the probe primitive specs |
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
| fixture-snapshot-negative | snapshot-degraded-start-frame-claimed-observed | PASS | method_provenance[GetStartFrame]: raw_capture_record_id does not resolve to a RAW_CAPABILITY_CAPTURE record; timeline.start_frame: OBSERVED but producing primitive(s) ['GetStartFrame'] not callable in this session; colle |
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
| fixture-snapshot-negative | snapshot-full-read-claimed-under-frozen-matrix | PASS | method_provenance[GetClipEnabled]: capability_matrix_sha256 is not the active matrix; method_provenance[GetClipEnabled]: raw_capture_record_id does not resolve to a RAW_CAPABILITY_CAPTURE record; method_provenance[GetCur |
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
| fixture-schema-negative | snapshot-item-property-payload-unrepresentable | PASS | oneOf:payload/tracks/0/items/0:{'unique_id': 'it-1', 'observation_ordinal': 0, 'name': 'still-001', 'start': 108000, 'end': 108347, 'duration': 347, 'enabled': True, 'markers': [], 'identity_observed': 'COMPLETE', 'field |
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
| fixture-schema-positive | snapshot-observed-domain-item-properties-excluded | PASS |  |
| fixture-snapshot-negative | snapshot-observed-domain-item-properties-excluded | PASS | domain(s) ['item_properties'] are in PROTECTED_SURFACE_EXCLUSIONS: v1.6 does not represent, compare or claim them; they may only be deferred/unobservable; a domain cannot be both observed and unobservable/deferred |
| fixture-schema-positive | snapshot-observed-field-without-callable-primitive | PASS |  |
| fixture-snapshot-negative | snapshot-observed-field-without-callable-primitive | PASS | method_provenance[GetClipEnabled]: raw_capture_record_id does not resolve to a RAW_CAPABILITY_CAPTURE record; method_provenance[GetCurrentTimeline]: raw_capture_record_id does not resolve to a RAW_CAPABILITY_CAPTURE reco |
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
| fixture-snapshot-negative | snapshot-provenance-cites-adjacent-getter | PASS | method_provenance[GetStartFrame]: cited capture is for GetEndFrame (adjacent getter) |
| fixture-schema-positive | snapshot-provenance-cites-failed-evidence | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-cites-failed-evidence | PASS | method_provenance[GetClipEnabled]: primitive is not QUALIFIED_CALLABLE under the active capability matrix (raw capture missing, malformed, unbound, untrusted or ambiguous); method_provenance[GetCurrentTimeline]: primitiv |
| fixture-schema-positive | snapshot-provenance-cites-other-capture-than-promoted | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-cites-other-capture-than-promoted | PASS | method_provenance[GetClipEnabled]: raw_capture_record_id does not resolve to a RAW_CAPABILITY_CAPTURE record; method_provenance[GetCurrentTimeline]: raw_capture_record_id does not resolve to a RAW_CAPABILITY_CAPTURE reco |
| fixture-schema-positive | snapshot-provenance-cites-raised-accepted-evidence | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-cites-raised-accepted-evidence | PASS | method_provenance[GetClipEnabled]: primitive is not QUALIFIED_CALLABLE under the active capability matrix (raw capture missing, malformed, unbound, untrusted or ambiguous); method_provenance[GetCurrentTimeline]: primitiv |
| fixture-schema-positive | snapshot-provenance-cites-unreviewed-evidence | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-cites-unreviewed-evidence | PASS | method_provenance[GetClipEnabled]: primitive is not QUALIFIED_CALLABLE under the active capability matrix (REVIEW_NONE: no single current REVIEW_DECISION of exactly this raw+derived pair); method_provenance[GetCurrentTim |
| fixture-schema-positive | snapshot-provenance-evidence-not-in-set | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-evidence-not-in-set | PASS | method_provenance[GetStartFrame]: raw_capture_record_id does not resolve to a RAW_CAPABILITY_CAPTURE record |
| fixture-schema-positive | snapshot-provenance-matrix-not-active | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-matrix-not-active | PASS | method_provenance[GetStartFrame]: capability_matrix_sha256 is not the active matrix |
| fixture-schema-positive | snapshot-provenance-qualified-without-evidence-id | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-qualified-without-evidence-id | PASS | method_provenance[GetStartFrame]: QUALIFIED_OBSERVATION requires raw_capture_record_id and capability_matrix_sha256; method_provenance[GetStartFrame]: raw_capture_record_id does not resolve to a RAW_CAPABILITY_CAPTURE re |
| fixture-schema-positive | snapshot-provenance-under-forged-matrix-digest | PASS |  |
| fixture-snapshot-negative | snapshot-provenance-under-forged-matrix-digest | PASS | provenance: CAPABILITY_MATRIX_NOT_ACTIVE: supplied matrix content digest differs from active.capability_matrix_sha256; project.unique_id: OBSERVED but producing primitive(s) ['Project.GetUniqueId'] not callable in this s |
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
| fixture-layers | layers present | PASS | {'none': 37, 'schema': 44, 'semantic': 92, 'eligibility': 4, 'snapshot': 57} |
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
| linked-set-negative | linked-set-effect-not-specified-claims-verified | PASS | plan: operation SET_PROPERTIES not eligible: ["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", "PLAN_VALIDATED (PLAN_VALIDATION: record 1fe7b6a908b7 plan_digest='<SHA256>'  |
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
| linked-set-negative | linked-set-plan-not-eligible-no-authorization | PASS | s0: method_provenance[GetClipEnabled]: raw_capture_record_id does not resolve to a RAW_CAPABILITY_CAPTURE record; s0: method_provenance[GetCurrentTimeline]: raw_capture_record_id does not resolve to a RAW_CAPABILITY_CAPT |
| commit-eligibility | linked-set-plan-not-eligible-no-authorization | PASS | eligible=False stages=12 errors=['s0: method_provenance[GetClipEnabled]: raw_capture_record_id does not resolve to a RAW_CAPABILITY_CAPTURE record', 's0: method_provenance[GetCurrentTimeline]: raw_capture_record_id does  |
| linked-set-negative | linked-set-s0-not-write-precheck | PASS | s0: mutation requires a complete WRITE_PRECHECK snapshot; plan: plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT); lineage: S0 guard is not the plan's h0_guard_digest; effects: derived ver |
| commit-eligibility | linked-set-s0-not-write-precheck | PASS | eligible=False stages=12 errors=['s0: mutation requires a complete WRITE_PRECHECK snapshot', 'plan: plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT)'] |
| linked-set-negative | linked-set-s0-observed-fields-not-callable | PASS | s0: method_provenance[GetClipEnabled]: capability_matrix_sha256 is not the active matrix; s0: method_provenance[GetClipEnabled]: raw_capture_record_id does not resolve to a RAW_CAPABILITY_CAPTURE record; s0: method_prove |
| commit-eligibility | linked-set-s0-observed-fields-not-callable | PASS | eligible=False stages=12 errors=['s0: method_provenance[GetClipEnabled]: capability_matrix_sha256 is not the active matrix', 's0: method_provenance[GetClipEnabled]: raw_capture_record_id does not resolve to a RAW_CAPABIL |
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
| linked-set-negative | linked-set-s1-weaker-profile | PASS | s1: coverage profile FULL_TIMELINE_READ is weaker than the required APPEND_VERIFY verify profile; verification: verification.unobserved_domains differs from derived truth (declared ["caches","fades","fusion_graphs","grad |
| commit-eligibility | linked-set-s1-weaker-profile | PASS | eligible=False stages=12 errors=['s1: coverage profile FULL_TIMELINE_READ is weaker than the required APPEND_VERIFY verify profile', 'verification: verification.unobserved_domains differs from derived truth (declared ["c |
| linked-set-negative | linked-set-schema-invalid-plan | PASS | schema/plan: Additional properties are not allowed ('target_attachment_state' was unexpected) |
| commit-eligibility | linked-set-schema-invalid-plan | PASS | eligible=False stages=2 errors=["schema/plan: Additional properties are not allowed ('target_attachment_state' was unexpected)"] |
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
| linked-set-negative | linked-set-verification-ghost-applied-operation | PASS | verification: verification.applied_operation_ids differs from derived truth (declared ["op-1","op-ghost"] vs derived ["op-1"]); commit: verification: verification.applied_operation_ids differs from derived truth (declare |
| commit-eligibility | linked-set-verification-ghost-applied-operation | PASS | eligible=False stages=12 errors=['verification: verification.applied_operation_ids differs from derived truth (declared ["op-1","op-ghost"] vs derived ["op-1"])', 'commit: verification: verification.applied_operation_ids |
| linked-set-negative | linked-set-verification-hides-unobserved-domains | PASS | verification: verification.unobserved_domains differs from derived truth (declared [] vs derived ["caches","fades","fusion_graphs","grades","item_properties","keyframe_curves","); commit: verification: verification.unobs |
| commit-eligibility | linked-set-verification-hides-unobserved-domains | PASS | eligible=False stages=12 errors=['verification: verification.unobserved_domains differs from derived truth (declared [] vs derived ["caches","fades","fusion_graphs","grades","item_properties","keyframe_curves",")', 'comm |
| linked-set-negative | linked-set-verification-other-plan | PASS | verification: verification refers to another plan; commit: verification: verification refers to another plan; commit: verification_result_sha256 does not match the validated verification object |
| commit-eligibility | linked-set-verification-other-plan | PASS | eligible=False stages=12 errors=['verification: verification refers to another plan', 'commit: verification: verification refers to another plan'] |
| linked-set | plan_digest law: digest of body without refs | PASS |  |
| bypass-audit | AUTHORITY_SURFACE lists commit_eligibility_authorizing and validate_transaction_set_authorizing as the only transaction-authorizing entry points; the v1.14 bare-dict pair is PROVISIONAL_UNTIL_M3 and non-authorizing (V114-B2) | PASS |  |
| bypass-audit | every exported validator touching commit/verification/journal/plan/snapshot/delta is classified into exactly one of the four surface classes | PASS |  |
| bypass-audit | the four surface classes are DISJOINT: no function is both authorizing and non-authorizing | PASS |  |
| bypass-audit | every INTERNAL_NON_AUTHORIZING function says so in its docstring | PASS |  |
| bypass-audit | validate_transaction_set has no callable-set, skip or override parameter | PASS |  |
| bypass-audit | neither authorizing entry point has a schema-validator parameter at all (v1.7 C16-B2 replaces the v1.6 required-parameter design: the caller cannot name the law) | PASS |  |
| bypass-audit | the composed call with no validator argument enforces schemas from the internally pinned registry (v1.7: the default IS enforcement, and passing None is refused as a caller-supplied validator) | PASS |  |
| bypass-audit | an unsupported property field in S0 is refused by the mandatory schema stage (F15-04 attack shape: recomputed digests do not help) | PASS |  |
| bypass-audit | a forged in-memory matrix under the real active digest is refused before any stage (F15-02) | PASS |  |
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
| eligibility | m0-probe-deny-provisioned-not-verified | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host (v1 |
| eligibility-request-schema | m0-probe-deny-launch-wrong-binary | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-launch-wrong-binary | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no LAUNCH_RECIPE for the current session bound to this provisioning record, contract versi |
| eligibility-request-schema | m0-probe-deny-self-verified-bundle | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-self-verified-bundle | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host (v1 |
| eligibility-request-schema | m0-probe-deny-bundle-other-host | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-bundle-other-host | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host (v1 |
| eligibility-request-schema | m0-probe-deny-bundle-historical-only | PASS | request schema-valid=True |
| eligibility | m0-probe-deny-bundle-historical-only | PASS | eligible=False state=PROVISIONED_NOT_VERIFIED tr=SESSION failed=['BUNDLE_INDEPENDENTLY_VERIFIED', 'TARGET_STATE_ATTACHMENT_READY (no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host (v1 |
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
| eligibility | m0-probe-deny-fatal-probe-failure-in-session | PASS | eligible=False state=CONFLICT tr=None failed=[] codes=['ATTACHMENT_CONFLICT', 'EVIDENCE_SET_INVALID'] |
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
| eligibility | m0-connect-deny-hyp-raw-tampered | PASS | eligible=False state=CONFLICT tr=None failed=[] codes=['ATTACHMENT_CONFLICT', 'EVIDENCE_SET_INVALID'] |
| eligibility-request-schema | m0-connect-deny-hyp-wrong-receiver | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-wrong-receiver | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-no-linked-evidence | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-no-linked-evidence | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-raised-accepted | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-raised-accepted | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-raised-fake-parse-block | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-raised-fake-parse-block | PASS | eligible=False state=CONFLICT tr=None failed=[] codes=['ATTACHMENT_CONFLICT', 'EVIDENCE_SET_INVALID'] |
| eligibility-request-schema | m0-connect-deny-hyp-timeout-accepted | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-timeout-accepted | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString)'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-connect-deny-hyp-attribute-missing-accepted | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-attribute-missing-accepted | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-wrong-type-accepted | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-wrong-type-accepted | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-null-accepted | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-null-accepted | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-truncated-accepted | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-truncated-accepted | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-unserializable-accepted | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-unserializable-accepted | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-review-other-raw | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-review-other-raw | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-review-stale-parser | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-review-stale-parser | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-review-stale-spec | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-review-stale-spec | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-reviewer-is-operator | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-reviewer-is-operator | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-review-reject | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-review-reject | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-refreeze-stale-parser | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-refreeze-stale-parser | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-refreeze-stale-spec | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-refreeze-stale-spec | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-refreeze-other-session | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-refreeze-other-session | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-refreeze-unreviewed | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-refreeze-unreviewed | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-refreeze-unlisted-raw | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-refreeze-unlisted-raw | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-no-refreeze-record | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-no-refreeze-record | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-deny-hyp-derived-cache-forged | PASS | request schema-valid=True |
| eligibility | m0-connect-deny-hyp-derived-cache-forged | PASS | eligible=False state=ATTACHED_READ_ONLY tr=SESSION failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED (REFUSE fallback on unqualified primitive(s): GetVersionString,GetProductName,GetProjectManager,GetCurrentDatabase)' |
| eligibility-request-schema | m0-connect-allow-hyp-derived-cache-honest | PASS | request schema-valid=True |
| eligibility | m0-connect-allow-hyp-derived-cache-honest | PASS | eligible=True state=ATTACHED_READ_ONLY tr=SESSION failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m0-deny-write-op | PASS | request schema-valid=True |
| eligibility | m0-deny-write-op | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:no explicit entry (default DENY)'] |
| eligibility-request-schema | m0-deny-ref-empty-string | PASS | request schema-valid=False |
| eligibility | m0-deny-ref-empty-string | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: reference is not a sha256 (''))"] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-deny-ref-false-string | PASS | request schema-valid=False |
| eligibility | m0-deny-ref-false-string | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=["READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: reference is not a sha256 ('false'))"] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-deny-ref-unlinked-sha | PASS | request schema-valid=True |
| eligibility | m0-deny-ref-unlinked-sha | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: referenced record 999999999999 not in evidence set)'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m0-deny-ref-wrong-record-type | PASS | request schema-valid=True |
| eligibility | m0-deny-ref-wrong-record-type | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['READ_ONLY_JOURNAL_OPEN (READ_ONLY_JOURNAL: record db2363bc6920 has type CONNECTION_OBSERVATION)'] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m2-set-current-timeline-deny-production-project-name | PASS | request schema-valid=True |
| eligibility | m2-set-current-timeline-deny-production-project-name | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=['PROJECT_ADAPTER_PREFIXED', "TARGET_REQUIREMENT_SATISFIED (project 'PYSTY UHD' is neither adapter-prefixed nor operator-provisioned in the contract lib |
| eligibility-request-schema | m2-set-current-timeline-allow | PASS | request schema-valid=True |
| eligibility | m2-set-current-timeline-allow | PASS | eligible=True state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m3-append-deny-without-authorization | PASS | request schema-valid=True |
| eligibility | m3-append-deny-without-authorization | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: reference is not a sha256 (None))', 'TARGET_STATE_SCRATCH_WRITE_READY (no M3_AUTHORIZATION for scratch scope  |
| eligibility-request-schema | m3-append-deny-authorization-old-authority | PASS | request schema-valid=True |
| eligibility | m3-append-deny-authorization-old-authority | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: referenced record 7c0e7bda6e5e not in evidence set)', 'TARGET_STATE_SCRATCH_WRITE_READY (no M3_AUTHORIZATION  |
| eligibility-request-schema | m3-append-deny-refreeze-unreviewed | PASS | request schema-valid=True |
| eligibility | m3-append-deny-refreeze-unreviewed | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['TARGET_STATE_SCRATCH_WRITE_READY (no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix)', 'JOURNAL_PREPARED (JOURNAL_PR |
| eligibility-request-schema | m3-append-deny-refreeze-for-other-matrix | PASS | request schema-valid=True |
| eligibility | m3-append-deny-refreeze-for-other-matrix | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT_TIMELINE failed=['TARGET_STATE_SCRATCH_WRITE_READY (no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix)', 'JOURNAL_PREPARED (JOURNAL_PR |
| eligibility-request-schema | m3-append-deny-no-journal-guard-plan-records | PASS | request schema-valid=True |
| eligibility | m3-append-deny-no-journal-guard-plan-records | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=['JOURNAL_PREPARED (JOURNAL_PREPARED: reference is not a sha256 (None))', 'PLAN_VALIDATED (PLAN_VALIDATION: reference is not a sha256 (None))'] codes=[' |
| eligibility-request-schema | m3-save-deny-ids-unavailable | PASS | request schema-valid=True |
| eligibility | m3-save-deny-ids-unavailable | PASS | eligible=False state=ATTACHED_READ_ONLY tr=PROJECT failed=['M2_EXIT_EVIDENCE (MILESTONE_EXIT: referenced record ad40fea62c79 not in evidence set)', 'MIKKO_M3_AUTHORIZATION (M3_AUTHORIZATION: referenced record 7c0e7bda6e5 |
| eligibility-request-schema | m3-deny-shared-library-scope | PASS | request schema-valid=True |
| eligibility | m3-deny-shared-library-scope | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:unknown milestone or scope'] |
| eligibility-request-schema | m4-deny-unknown-milestone | PASS | request schema-valid=True |
| eligibility | m4-deny-unknown-milestone | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:unknown milestone or scope'] |
| eligibility-request-schema | deny-unknown-operation | PASS | request schema-valid=True |
| eligibility | deny-unknown-operation | PASS | eligible=False state=None tr=None failed=[] codes=['NOT_PERMITTED_BY_POLICY:no explicit entry (default DENY)'] |
| eligibility-request-schema | m3-append-deny-h0-minimal-m0 | PASS | request schema-valid=True |
| eligibility | m3-append-deny-h0-minimal-m0 | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", "GUARD_CURRENT (H0_PROFILE: snapshot profile 'MINIMAL_ |
| eligibility-request-schema | m3-append-deny-h0-full-timeline-read | PASS | request schema-valid=True |
| eligibility | m3-append-deny-h0-full-timeline-read | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", "GUARD_CURRENT (H0_PROFILE: snapshot profile 'FULL_TIM |
| eligibility-request-schema | m3-append-deny-h0-incomplete-write-precheck | PASS | request schema-valid=True |
| eligibility | m3-append-deny-h0-incomplete-write-precheck | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", "GUARD_CURRENT (H0_INCOMPLETE: guarded snapshot is not |
| eligibility-request-schema | m3-append-deny-h0-candidate-provenance | PASS | request schema-valid=True |
| eligibility | m3-append-deny-h0-candidate-provenance | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", 'GUARD_CURRENT (H0_PROVENANCE: Folder.GetUniqueId is C |
| eligibility-request-schema | m3-append-deny-h0-other-matrix | PASS | request schema-valid=True |
| eligibility | m3-append-deny-h0-other-matrix | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", 'GUARD_CURRENT (H0_MATRIX: guarded snapshot collected  |
| eligibility-request-schema | m3-append-deny-h0-other-target | PASS | request schema-valid=True |
| eligibility | m3-append-deny-h0-other-target | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=["JOURNAL_PREPARED (JOURNAL_PREPARED: record 883af2969407 plan_digest='<SHA256>' != '<SHA256>')", 'GUARD_CURRENT (H0_TARGET: guarded snapshot identity d |
| eligibility-request-schema | m3-append-deny-h0-forged-guard-object | PASS | request schema-valid=True |
| eligibility | m3-append-deny-h0-forged-guard-object | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=['GUARD_CURRENT (guard object does not re-hash to guard_digest; method_provenance does not re-hash to guard.provenance_sha256; record payload_sha256 !=  |
| eligibility-request-schema | m3-append-deny-h0-provenance-swapped | PASS | request schema-valid=True |
| eligibility | m3-append-deny-h0-provenance-swapped | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=["GUARD_CURRENT (method_provenance does not re-hash to guard.provenance_sha256; H0_PROFILE: snapshot profile 'MINIMAL_M0' does not satisfy WRITE_PRECHEC |
| eligibility-request-schema | m3-append-allow-complete-write-precheck-h0 | PASS | request schema-valid=True |
| eligibility | m3-append-allow-complete-write-precheck-h0 | PASS | eligible=True state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=[] codes=['ELIGIBLE'] |
| eligibility-request-schema | m3-append-deny-plan-validation-from-helper | PASS | request schema-valid=True |
| eligibility | m3-append-deny-plan-validation-from-helper | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=["PLAN_VALIDATED (PLAN_VALIDATION: record 7f7df785026e validator='tools/authority_lib.py#semantic_mutation_plan' != 'tools/authority_lib.py#validate_tra |
| eligibility-request-schema | m3-append-deny-plan-validation-other-h0 | PASS | request schema-valid=True |
| eligibility | m3-append-deny-plan-validation-other-h0 | PASS | eligible=False state=SCRATCH_WRITE_READY tr=PROJECT_TIMELINE failed=["PLAN_VALIDATED (PLAN_VALIDATION must come from the composed validator (stages s0+plan) and name this plan's H0 guard)"] codes=['PREREQUISITES_FAILED'] |
| eligibility-request-schema | m3-append-deny-forged-matrix-under-active-digest | PASS | request schema-valid=True |
| eligibility | m3-append-deny-forged-matrix-under-active-digest | PASS | eligible=False state=None tr=None failed=[] codes=['CAPABILITY_MATRIX_NOT_ACTIVE', 'CAPABILITY_MATRIX_NOT_ACTIVE: supplied matrix content digest differs from active.capability_matrix_sha256'] |
| eligibility-invariant | allowed_true_is_not_eligibility | PASS |  |
| eligibility-invariant | capabilities argument is consumed (hypothetical matrix flips CONNECT; frozen matrix does not) | PASS |  |
| eligibility-invariant | active authority argument is consumed | PASS |  |
| eligibility-invariant | a capture that carries a forbidden interpretation field, or whose bytes were tampered with, invalidates the whole evidence set (CONFLICT) instead of being reinterpreted | PASS |  |
| eligibility-invariant | CONFLICT short-circuits | PASS |  |
| permission-invariant | no_mutation_before_M3 | PASS |  |
| permission-invariant | every_M3_mutation_requires_authorization_and_write_ready | PASS |  |
| permission-invariant | no_shared_library_grant | PASS |  |
| permission-invariant | default_deny | PASS |  |
| permission-invariant | prerequisite_codes == library set | PASS |  |
| order-independence | eligibility: 107 cases x 4 evidence/request permutations give identical decisions | PASS | 428 permutations |
| order-independence | attachment: 96 evidence sets x 4 record-map permutations give identical derivations | PASS |  |
| order-independence | snapshots: every snapshot fixture x 4 track/item/marker/ledger permutations keeps payload, guard and object digests and the semantic result | PASS | 28 permutations |
| order-independence | linked sets: 42 sets x 4 permutations of evidence map, conflicts, snapshot arrays and key order give identical validation (incl. duplicate-identity sets) | PASS |  |
| order-independence | two current-sequence contradictions stay CONFLICT in both input orders | PASS |  |
| h0-early-gate | a complete WRITE_PRECHECK guard record with qualified provenance satisfies the gate | PASS |  |
| h0-early-gate | h0-minimal-m0 is refused with H0_PROFILE | PASS | H0_PROFILE: snapshot profile 'MINIMAL_M0' does not satisfy WRITE_PRECHECK (degraded/M0-only snapshot can never be a write precondition) |
| h0-early-gate | h0-full-timeline-read is refused with H0_PROFILE | PASS | H0_PROFILE: snapshot profile 'FULL_TIMELINE_READ' does not satisfy WRITE_PRECHECK (degraded/M0-only snapshot can never be a write precondition) |
| h0-early-gate | h0-incomplete-write-precheck is refused with H0_INCOMPLETE | PASS | H0_INCOMPLETE: guarded snapshot is not complete |
| h0-early-gate | h0-candidate-provenance is refused with H0_PROVENANCE | PASS | H0_PROVENANCE: Folder.GetUniqueId is CANDIDATE_OBSERVATION; a write precondition requires QUALIFIED_OBSERVATION for every provenance entry |
| h0-early-gate | h0-other-matrix is refused with H0_MATRIX | PASS | H0_MATRIX: guarded snapshot collected under another capability matrix |
| h0-early-gate | h0-other-target is refused with H0_TARGET | PASS | H0_TARGET: guarded snapshot identity differs from the plan target |
| h0-early-gate | h0-forged-guard-object is refused with does not re-hash | PASS | guard object does not re-hash to guard_digest |
| h0-early-gate | h0-provenance-swapped is refused with does not re-hash | PASS | method_provenance does not re-hash to guard.provenance_sha256 |
| h0-early-gate | a complete FULL_TIMELINE_READ guard is accepted for a NON-write operation and refused as a write precondition (the gate is operation-specific, not a blanket ban on read snapshots) | PASS |  |
| h0-early-gate | the early gate is evaluated by evaluate_eligibility itself, before any mutator, and does not depend on the composed path | PASS |  |
| h0-early-gate | PLAN_VALIDATION must come from the composed validator and name this plan's H0 | PASS |  |
| protected-surface-exclusions | item properties, fades, speed, takes, links and unowned media hashes are named as exclusions and have no payload in the item schema | PASS |  |
| protected-surface-exclusions | a property payload on an item is schema-invalid (not silently ignored) | PASS |  |
| protected-surface-exclusions | declaring an excluded domain as observed is a snapshot error | PASS |  |
| protected-surface-exclusions | every verification result names the unobserved/excluded domains and the declaration is compared | PASS |  |
| ghost-operation | a ghost applied_operation_id is rejected against the derived applied list | PASS |  |
| ghost-operation | the derived applied list comes from the journal's APPLIED records only | PASS |  |
| ghost-operation | a commit citing the ghost verification is INELIGIBLE through the only authorizing path | PASS |  |
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
| precedence | ADJUDICATION-FREEZE-CONTRACT.md classified | PASS |  |
| precedence | AUTHOR-REGRESSION-RESULTS.json classified | PASS |  |
| precedence | AUTHORITY-ARCHITECTURE-ADJUDICATION-M0-M3.md classified | PASS |  |
| precedence | AUTHORITY-CACHING.md classified | PASS |  |
| precedence | AUTHORITY-DOCUMENT-UNIVERSE.json classified | PASS |  |
| precedence | AUTHORITY-FUNCTION-CLASSES.json classified | PASS |  |
| precedence | AUTHORITY-PRECEDENCE.json classified | PASS |  |
| precedence | AUTHORITY-PRECEDENCE.md classified | PASS |  |
| precedence | AUTHORITY-REFERENCE-METADATA.json classified | PASS |  |
| precedence | AUTHORITY-SLOT-INVENTORY.json classified | PASS |  |
| precedence | AUTHORIZATION-2026-09-08.md classified | PASS |  |
| precedence | CANARIES.md classified | PASS |  |
| precedence | CANARY-SOURCE-MANIFEST.json classified | PASS |  |
| precedence | CANONICALIZATION.md classified | PASS |  |
| precedence | CAPABILITIES.json classified | PASS |  |
| precedence | CAPTURE-SHIM.md classified | PASS |  |
| precedence | CHANGELOG-v1.1.md classified | PASS |  |
| precedence | CHANGELOG-v1.10.md classified | PASS |  |
| precedence | CHANGELOG-v1.11.md classified | PASS |  |
| precedence | CHANGELOG-v1.12.md classified | PASS |  |
| precedence | CHANGELOG-v1.13.md classified | PASS |  |
| precedence | CHANGELOG-v1.14.md classified | PASS |  |
| precedence | CHANGELOG-v1.15.md classified | PASS |  |
| precedence | CHANGELOG-v1.16.md classified | PASS |  |
| precedence | CHANGELOG-v1.17.md classified | PASS |  |
| precedence | CHANGELOG-v1.18.md classified | PASS |  |
| precedence | CHANGELOG-v1.2.md classified | PASS |  |
| precedence | CHANGELOG-v1.3.md classified | PASS |  |
| precedence | CHANGELOG-v1.4.md classified | PASS |  |
| precedence | CHANGELOG-v1.5.md classified | PASS |  |
| precedence | CHANGELOG-v1.6.md classified | PASS |  |
| precedence | CHANGELOG-v1.7.md classified | PASS |  |
| precedence | CHANGELOG-v1.8.md classified | PASS |  |
| precedence | CHANGELOG-v1.9.md classified | PASS |  |
| precedence | CLIENT-VERSION-INVENTORY.md classified | PASS |  |
| precedence | DOCTRINE.md classified | PASS |  |
| precedence | DRIFT-POLICY.md classified | PASS |  |
| precedence | ELIGIBILITY.md classified | PASS |  |
| precedence | EVIDENCE-ROOT.md classified | PASS |  |
| precedence | EVIDENCE-SET-WORKFLOW.json classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.10.json classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.10.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.11.json classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.11.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.12.json classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.12.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.13.json classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.13.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.14.json classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.14.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.15.json classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.15.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.16.json classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.16.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.17.json classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.17.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.18.json classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.18.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.2.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.3.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.4.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.5.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.6.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.7.json classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.7.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.8.json classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.8.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.9.json classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.9.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX.md classified | PASS |  |
| precedence | FREEZE-MANIFEST.json classified | PASS |  |
| precedence | GUARD-AUTHORITY.md classified | PASS |  |
| precedence | IDENTITY-BINDING.md classified | PASS |  |
| precedence | IDENTITY-EVIDENCE.md classified | PASS |  |
| precedence | INVENTORY-FIELD-PROVENANCE.json classified | PASS |  |
| precedence | M0-PHASES.md classified | PASS |  |
| precedence | M0-PROBE-CONTRACT.md classified | PASS |  |
| precedence | M0A-BINDING-VALUES.json classified | PASS |  |
| precedence | M0A-PROBE-COMPATIBILITY.md classified | PASS |  |
| precedence | M3-MATRIX.md classified | PASS |  |
| precedence | M3-PROBES.json classified | PASS |  |
| precedence | MILESTONE-MATRIX.json classified | PASS |  |
| precedence | MILESTONES.md classified | PASS |  |
| precedence | PERMISSIONS.json classified | PASS |  |
| precedence | PRIMITIVE-SPEC.md classified | PASS |  |
| precedence | PRINCIPALS.json classified | PASS |  |
| precedence | PROVISIONAL.md classified | PASS |  |
| precedence | QUARANTINE-MANIFEST.json classified | PASS |  |
| precedence | RAW-CAPTURE.md classified | PASS |  |
| precedence | READ-PRIMITIVES.json classified | PASS |  |
| precedence | README.md classified | PASS |  |
| precedence | REFERENCE-PARSER.md classified | PASS |  |
| precedence | RELEASE-AUTHORITY.md classified | PASS |  |
| precedence | REQUIRED-VALIDATION-CHECKS.json classified | PASS |  |
| precedence | REVIEW-MARKER-POLICY.md classified | PASS |  |
| precedence | REVIEW-REFREEZE.md classified | PASS |  |
| precedence | SCHEMA-REGISTRY.json classified | PASS |  |
| precedence | SCHEMA-REGISTRY.md classified | PASS |  |
| precedence | SCORECRAFT-EXTRACTION.md classified | PASS |  |
| precedence | SEMANTIC-VALIDATION.md classified | PASS |  |
| precedence | SNAPSHOT-COMPLETENESS.md classified | PASS |  |
| precedence | SNAPSHOT-CONCURRENCY-RECOVERY.md classified | PASS |  |
| precedence | STORED-CHAIN.md classified | PASS |  |
| precedence | TARGET-ATTACHMENT-GATE.md classified | PASS |  |
| precedence | TARGET-CONTRACT.json classified | PASS |  |
| precedence | THREAT-MODEL.md classified | PASS |  |
| precedence | TIMEBASE.json classified | PASS |  |
| precedence | TRANSPORT.md classified | PASS |  |
| precedence | TRUSTED-SHIM.json classified | PASS |  |
| precedence | TRUSTED-SHIM.md classified | PASS |  |
| precedence | V117-REPRODUCTION.json classified | PASS |  |
| precedence | VALIDATION-REPORT.md classified | PASS |  |
| precedence-retired-terms | AUTHORITY-DOCUMENT-UNIVERSE.json | PASS |  |
| precedence-retired-terms | AUTHORITY-FUNCTION-CLASSES.json | PASS |  |
| precedence-retired-terms | AUTHORITY-REFERENCE-METADATA.json | PASS |  |
| precedence-retired-terms | AUTHORIZATION-2026-09-08.md | PASS |  |
| precedence-retired-terms | CANARIES.md | PASS |  |
| precedence-retired-terms | CANARY-SOURCE-MANIFEST.json | PASS |  |
| precedence-retired-terms | CAPABILITIES.json | PASS |  |
| precedence-retired-terms | CLIENT-VERSION-INVENTORY.md | PASS |  |
| precedence-retired-terms | DOCTRINE.md | PASS |  |
| precedence-retired-terms | EVIDENCE-SET-WORKFLOW.json | PASS |  |
| precedence-retired-terms | IDENTITY-BINDING.md | PASS |  |
| precedence-retired-terms | INVENTORY-FIELD-PROVENANCE.json | PASS |  |
| precedence-retired-terms | M0-PHASES.md | PASS |  |
| precedence-retired-terms | M0A-BINDING-VALUES.json | PASS |  |
| precedence-retired-terms | M3-MATRIX.md | PASS |  |
| precedence-retired-terms | M3-PROBES.json | PASS |  |
| precedence-retired-terms | MILESTONE-MATRIX.json | PASS |  |
| precedence-retired-terms | MILESTONES.md | PASS |  |
| precedence-retired-terms | PERMISSIONS.json | PASS |  |
| precedence-retired-terms | PRINCIPALS.json | PASS |  |
| precedence-retired-terms | QUARANTINE-MANIFEST.json | PASS |  |
| precedence-retired-terms | READ-PRIMITIVES.json | PASS |  |
| precedence-retired-terms | RELEASE-AUTHORITY.md | PASS |  |
| precedence-retired-terms | REQUIRED-VALIDATION-CHECKS.json | PASS |  |
| precedence-retired-terms | REVIEW-MARKER-POLICY.md | PASS |  |
| precedence-retired-terms | SCHEMA-REGISTRY.json | PASS |  |
| precedence-retired-terms | TARGET-ATTACHMENT-GATE.md | PASS |  |
| precedence-retired-terms | TARGET-CONTRACT.json | PASS |  |
| precedence-retired-terms | TIMEBASE.json | PASS |  |
| precedence-retired-terms | TRANSPORT.md | PASS |  |
| precedence-retired-terms | TRUSTED-SHIM.json | PASS |  |
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
| precedence-supersession | S32 | PASS |  |
| precedence-supersession | S33 | PASS |  |
| precedence-supersession | S34 | PASS |  |
| precedence-supersession | S35 | PASS |  |
| precedence-supersession | S36 | PASS |  |
| precedence-supersession | S37 | PASS |  |
| precedence-supersession | S38 | PASS |  |
| precedence-supersession | S39 | PASS |  |
| precedence-supersession | S40 | PASS |  |
| precedence-supersession | S41 | PASS |  |
| precedence-supersession | S42 | PASS |  |
| precedence-supersession | S43 | PASS |  |
| precedence-supersession | S44 | PASS |  |
| precedence-supersession | S45 | PASS |  |
| precedence-supersession | S46 | PASS |  |
| precedence-supersession | S47 | PASS |  |
| precedence-supersession | S48 | PASS |  |
| precedence-supersession | S49 | PASS |  |
| precedence-supersession | S50 | PASS |  |
| precedence-supersession | S51 | PASS |  |
| precedence-supersession | S52 | PASS |  |
| precedence-supersession | S53 | PASS |  |
| precedence-supersession | S54 | PASS |  |
| precedence-supersession | S55 | PASS |  |
| precedence-supersession | S56 | PASS |  |
| precedence-supersession | S57 | PASS |  |
| precedence-supersession | S58 | PASS |  |
| precedence-supersession | S59 | PASS |  |
| precedence-supersession | S60 | PASS |  |
| precedence-supersession | S61 | PASS |  |
| precedence-supersession | S62 | PASS |  |
| precedence-supersession | S63 | PASS |  |
| precedence-supersession | S64 | PASS |  |
| precedence | v1.5 supersessions present | PASS |  |
| precedence | the v1.5 through v1.16 changelogs and finding matrices are HISTORICAL; the v1.18 ones are active | PASS |  |
| precedence | the four v1.7 correction laws are retained as STILL_ACTIVE with supersession statements S39-S45 | PASS |  |
| precedence | the v1.8 evidence-store supersessions S46-S47 are retained and EVIDENCE-ROOT.md is the single STILL_ACTIVE store document | PASS |  |
| precedence | the v1.9 evidence-store supersessions S48-S49 are retained | PASS |  |
| precedence | the v1.10 evidence-store supersessions S50-S51 are retained | PASS |  |
| precedence | the v1.11 evidence-store supersessions S52-S55 are retained | PASS |  |
| precedence | the v1.12 pre-M0A workflow supersessions S56-S59 are retained | PASS |  |
| precedence | the v1.13 governed-root supersession S60 is retained | PASS |  |
| precedence | the v1.14 authorizing-location supersession S61 is retained | PASS |  |
| precedence | the v1.15 consumed-evidence supersession S62 is retained | PASS |  |
| precedence | the v1.16 classification/receipt-publication supersession S63 is retained and its records are now HISTORICAL | PASS |  |
| precedence | THREAT-MODEL.md records the v1.18 audit-fragility residuals and restates the still-open authorizing-transaction control | PASS |  |
| precedence | S63 names the v1.15 statement it replaces, the generated artifacts that now hold the law, and both of Codex's findings | PASS |  |
| precedence | the v1.16 supersession table in the markdown mirrors the machine form, keeps S62 standing, and states that precedence is not a band-aid for CURRENT inconsistency | PASS |  |
| precedence | THREAT-MODEL.md records the v1.16 consumer-facing residuals and restates the still-open authorizing-transaction control | PASS |  |
| precedence | S62 names the v1.14 statement it replaces, the core functions that now hold the law, and every one of Codex's six findings | PASS |  |
| precedence | the v1.15 supersession table in the markdown mirrors the machine form, keeps S61 standing, and states the essential law | PASS |  |
| precedence | AUTHORITY-PRECEDENCE.json carries the blanket clause that re-reads every earlier statement's demoted function names as their authorizing counterparts, and v1.18 makes that clause itself clause-local: every demoted name in it carries its class token in the same clause (V114-B3, V116-B1) | PASS |  |
| precedence | THREAT-MODEL.md records the v1.15 residuals: the interpreter boundary, the absent authorizing-transaction positive control, and no cryptographic location proof | PASS |  |
| precedence | S61 names the v1.13 statement it replaces, the core functions that now hold the law, and the V113-B1 finding that forced it | PASS |  |
| precedence | the v1.14 supersession table in the markdown mirrors the machine form and does not withdraw S60 | PASS |  |
| precedence | THREAT-MODEL.md records the v1.14 authorizing-location residual, states the M3 diagnostic-eligibility residual honestly and claims no cryptographic location proof | PASS |  |
| precedence | S60 names the v1.12 statement it replaces, the new authority and the V112-RP1 finding that forced it | PASS |  |
| precedence | THREAT-MODEL.md records the v1.13 governed-location residual and claims no TOCTOU or cryptographic location guarantee | PASS |  |
| precedence | the new v1.12 workflow trust roots are classified STILL_ACTIVE | PASS |  |
| precedence | each v1.12 supersession names the v1.11 statement it replaces, the new authority and the V112 finding that forced it | PASS |  |
| precedence | the v1.12 supersession table in the markdown mirrors the machine form | PASS |  |
| precedence | THREAT-MODEL.md states the v1.12 residual honestly and claims no cryptographic identity | PASS |  |
| precedence | each v1.11 supersession names the v1.10 statement it replaces, the new authority and the Codex finding that forced it | PASS |  |
| precedence | the v1.11 supersession table in the markdown mirrors the machine form | PASS |  |
| precedence | EVIDENCE-ROOT.md names tools/evidence_store.py as the one authorizing store and explicitly withdraws the EvidenceRoot pointer (section 21) | PASS |  |
| precedence | the M0A compatibility contract and the probe contract point only at the canonical store | PASS |  |
| precedence | no active document still presents EvidenceRoot as an implementation (only as removed/superseded history) | PASS |  |
| precedence | only SEMANTIC-VALIDATION.md and authority_lib enumerate journal states | PASS |  |
| precedence | the journal chain quoted in SEMANTIC-VALIDATION.md is a legal path through JOURNAL_TRANSITIONS (the document mirrors the code; it is not a second independent authority) | PASS | PREPARED,LEASED,PREFLIGHT_OK,CHECKPOINTED,OP_STARTED,APPLIED |
| m0-phases | the four M0 phases are declared identically in the library, READ-PRIMITIVES and M0-PHASES.md, and none implies the next | PASS |  |
| m0-phases | the M0A driver contract states seven must-change requirements plus the compatible, transformable and open sets | PASS |  |
| precedence | the precedence authority names the journal-state enumeration authority | PASS |  |
| precedence | SCORECRAFT-EXTRACTION.md cites v1.8 active schemas, not earlier ones | PASS |  |
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
| exact-manifest | the M0A probe is eligible on re-minted ready evidence (and nothing else is) | PASS |  |
| exact-manifest | re-minted evidence is structurally valid against the real manifest | PASS |  |
| exact-manifest | arbitrary 64-hex manifest sha is rejected (CONFLICT) | PASS |  |
| exact-manifest | v1.5 manifest / authority 1.5.0 evidence is rejected as current authority (CONFLICT) | PASS |  |
| exact-manifest | real-manifest verification for another host / other version / self-verified does not count | PASS |  |
| manifest | parent (v1.16) manifest sha pinned | PASS |  |
| manifest | grandparent (v1.15) manifest sha pinned | PASS |  |
| manifest | great-grandparent (v1.14) manifest sha pinned | PASS |  |
| manifest | great-grandparent (v1.13) manifest sha pinned | PASS |  |
| manifest | grandparent (v1.12) manifest sha pinned | PASS |  |
| manifest | great-grandparent (v1.11) manifest sha pinned | PASS |  |
| manifest | great-grandparent (v1.10) manifest sha pinned | PASS |  |
| manifest | great-grandparent (v1.9) manifest sha pinned | PASS |  |
| manifest | great-grandparent (v1.8) manifest sha pinned | PASS |  |
| manifest | the parent block records the v1.17 branch HEAD and its semantic commit, which for v1.17 are the same commit because its bundle and registration were committed together (section 29) | PASS |  |
| manifest | v1.0-v1.16 bundles are byte-identical to their frozen manifests (history preserved) | PASS |  |
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
| workflow-persistence | exactly one governed attachment root is frozen, absolute, normalised and none of the forbidden locations | PASS | /home/vidtoolz/resolve-qualification-evidence/attachment |
| workflow-persistence | the path law is derived from the session id alone: the resolver takes NO argument (V112-RP1) | PASS |  |
| workflow-persistence | a session id that is not a safe basename is refused, so the path law cannot be escaped | PASS |  |
| workflow-persistence | the document and its workflow state are written at the governed path with governed modes | PASS |  |
| workflow-persistence | a MOVED or COPIED document is refused: the document records where it lives | PASS |  |
| workflow-persistence | writer exclusivity: a second writer while the lock is held is refused LOCK_HELD | PASS |  |
| workflow-persistence | the lock is released after use, so the next writer is not blocked by a stale lock | PASS |  |
| workflow-persistence | re-creating an existing document is refused SET_EXISTS, and a missing one is SET_NOT_FOUND | PASS |  |
| workflow-lifecycle | the three states and their (state, role) grants are frozen; VERIFIED grants nothing to anyone | PASS |  |
| workflow-lifecycle | OPEN grants the PREPARER exactly its three record types and the VERIFIER nothing | PASS |  |
| workflow-lifecycle | PREPARED grants the VERIFIER exactly BUNDLE_VERIFICATION and the PREPARER nothing | PASS |  |
| workflow-lifecycle | after PREPARED the preparer can no longer write any record type (WRITE_NOT_GRANTED) | PASS |  |
| workflow-lifecycle | PREPARED cannot be re-entered, and mark_prepared without both preparer records is refused | PASS |  |
| workflow-lifecycle | after VERIFIED nothing may be written by anyone, including a second verification | PASS |  |
| workflow-lifecycle | the VERIFIED document and its workflow state are sealed read-only and the document digest is sealed | PASS |  |
| workflow-principals | the registry is role-keyed, every principal is '<ROLE>:<actor>' and resolves to exactly its own role | PASS |  |
| workflow-principals | no ACTOR holds two roles, so independence is not defeatable by relabelling | PASS |  |
| workflow-principals | an unregistered, empty, malformed or wrong-role principal is refused PRINCIPAL_INVALID | PASS |  |
| workflow-principals | a PREPARER cannot author BUNDLE_VERIFICATION through any production entry point | PASS |  |
| workflow-principals | a VERIFIER cannot author a preparer record through any production entry point | PASS |  |
| workflow-principals | the frozen write grants give the PREPARER three types, the VERIFIER one and the APPROVER none | PASS |  |
| workflow-e2e-positive | MANDATORY (V112-4): using ONLY production authoring tools and no fixture synthesis, adopt -> provisioning -> launch -> prepare -> independent verify derives ATTACHMENT_READY. This is the test v1.11 lacked. | PASS | ATTACHMENT_READY; ['no CONNECTION_OBSERVATION in the current session'] |
| workflow-e2e-positive | the derivation names both principals and all three proof records | PASS |  |
| workflow-e2e-positive | the verification result is PASS and the record binds the exact verified inputs and the contract pin set | PASS |  |
| workflow-e2e-positive | the governed document validates under the unchanged v1.11 validator and the registered schema | PASS |  |
| workflow-e2e-positive | the two production CLIs drive the whole authoring path with no root option at all: adopt / prepare / check all exit 0 and the workflow reaches ATTACHMENT_READY mechanically | PASS | exit codes [0, 0, 0, 2, 2]; ATTACHMENT_READY |
| workflow-e2e-positive | V112-RP1 PARITY: the same CLIs REFUSE to hand back authority for a document outside the frozen root - verify and status exit non-zero on the authorizing derivation while the mechanics are sound. In v1.12 they returned ATTACHMENT_READY here. | PASS | verify/status exit codes [2, 2] |
| workflow-e2e-negative | never ATTACHMENT_READY: no verifier at all (document left PREPARED) | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: same actor is preparer and verifier | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: unauthorized verifier principal | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: preparer attempts BUNDLE_VERIFICATION | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: verifier attempts a preparer record type | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: missing launch recipe | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: invalid provisioning (non-uuid) | PASS | UNPROVISIONED |
| workflow-e2e-negative | never ATTACHMENT_READY: invalid provisioning (relative root) | PASS | UNPROVISIONED |
| workflow-e2e-negative | never ATTACHMENT_READY: second provisioning identity refused | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: arbitrary body-only JSON planted into a governed document | PASS | CONFLICT |
| workflow-e2e-negative | never ATTACHMENT_READY: record missing its envelope | PASS | CONFLICT |
| workflow-e2e-negative | never ATTACHMENT_READY: record missing its record_id | PASS | CONFLICT |
| workflow-e2e-negative | never ATTACHMENT_READY: verified provisioning record edited after verification (TOCTOU) | PASS | REFUSED_AT_AUTHORING |
| workflow-e2e-negative | never ATTACHMENT_READY: verified launch recipe edited after verification (TOCTOU) | PASS | REFUSED_AT_AUTHORING |
| workflow-e2e-negative | never ATTACHMENT_READY: verification_result forced to FAIL | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: verification_result removed | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: bundle bound to another manifest | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: bundle pinned-file digest set replaced with a preparer-friendly one | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: bundle naming another provisioning record | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: bundle naming another launch recipe | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: bundle with an unregistered verifier principal | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: bundle whose principals are the same actor | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: bundle historical:true | PASS | PROVISIONED_NOT_VERIFIED |
| workflow-e2e-negative | never ATTACHMENT_READY: document at an unauthorized path (copied elsewhere) | PASS | REFUSED_AT_AUTHORING |
| workflow-e2e-negative | never ATTACHMENT_READY: stale document (evaluated_at far in the past) | PASS | REFUSED_AT_AUTHORING |
| workflow-e2e-negative | never ATTACHMENT_READY: document dated in the future | PASS | REFUSED_AT_AUTHORING |
| workflow-e2e-negative | never ATTACHMENT_READY: wrong target: provisioning envelope names another library | PASS | UNPROVISIONED |
| workflow-e2e-negative | never ATTACHMENT_READY: wrong root: provisioning envelope root disagrees with the body | PASS | UNPROVISIONED |
| workflow-e2e-negative | the negative matrix is complete and every case refused (28/28) | PASS | 28 cases |
| workflow-parity | MANDATORY: the production BUNDLE_VERIFICATION field set is EXACTLY the fixture field set, so no positive ATTACHMENT_READY state is reachable from a shape production cannot build | PASS | identical |
| workflow-parity | the production PROVISIONING_RECORD field set matches the fixture field set exactly | PASS | identical |
| workflow-parity | the production LAUNCH_RECIPE field set matches the fixture field set exactly | PASS | identical |
| workflow-parity | the production READ_ONLY_JOURNAL field set matches the fixture field set exactly | PASS | identical |
| workflow-parity | every positive-ATTACHMENT_READY fixture set carries a BUNDLE_VERIFICATION whose field set production can emit | PASS |  |
| workflow-static | each of the three attachment record types has a production constructor that routes through make_record | PASS |  |
| workflow-static | there is NO body-only authoring path: every record passes _add, which registers and validates the envelope | PASS |  |
| workflow-static | the authoring module never touches Store.v5: it does not import it and holds no reference to it | PASS |  |
| workflow-static | the verifier computes the pinned digests itself and never accepts a caller-supplied digest set | PASS |  |
| workflow-static | add_bundle_verification takes no verifier-supplied result, preparer principal, record ids OR ROOT | PASS |  |
| workflow-static | no append-after-finalization workaround exists: VERIFIED grants nothing and the sealed digest is re-checked on load | PASS |  |
| workflow-static | the derivation cannot be satisfied by an arbitrary verifier string: it requires registered principals of distinct actors | PASS |  |
| workflow-static | no A1 / M0B phase conflation: the authoring module records no capture, review, refreeze or connection observation | PASS |  |
| workflow-static | the new production authoring and verification entry points are on the frozen AUTHORIZING surface, unlike v1.11's fixture-only minter which the manifest labelled 'never an authority' | PASS | all present |
| workflow-static | READ_ONLY_JOURNAL is owned by the PREPARER, sits in the probe-eligibility layer and is not attachment evidence | PASS |  |
| workflow-static | the published workflow law agrees with the executable authority in every table | PASS |  |
| workflow-static | a caller may not inject a derived envelope field; only sequence and captured_at are its own | PASS |  |
| workflow-static | the record_type_version the constructors stamp is the v1.11 authority value, not the stale prose value | PASS |  |
| workflow-static | the launch recipe the constructor derives carries the COMPUTED contract version, closing the v1.11 trap | PASS |  |
| root-law | V112-RP1 section 1: exactly ONE governed attachment root is frozen and it is the required path | PASS |  |
| root-law | V112-RP1 sections 2/4: NO authorizing function takes a governed-root parameter of any name | PASS | none |
| root-law | the root resolver takes NO argument, so there is nothing for a caller to pass | PASS |  |
| root-law | add_provisioning_record's root_path is the RESOLVE LIBRARY path (a record field), not the evidence root: the two are distinguishable | PASS |  |
| root-law | V112-RP1 section 3: NEITHER production CLI exposes an option that could change the governed root. v1.12 exposed --evidence-root on both. | PASS | prepare=[] verify=[] |
| root-law | the preparer's library path is named --library-root so no production CLI carries an option literally called --root | PASS | --by,--help,--journal-sha,--launch-script,--library-root,--principal,--recipe-sha,--session,--uuid |
| root-law | V112-RP1 pinned: the exact v1.12 attack invocations are now rejected by argument parsing itself | PASS |  |
| root-law | V112-RP1 section 8 PINNED: a SYMLINKED governed root is refused BEFORE any evidence set is created. In v1.12 the identical workflow derived ATTACHMENT_READY. | PASS | ROOT_SYMLINK_REFUSED |
| root-law | nothing was created under the symlink target, so the refusal happened before any write | PASS |  |
| root-law | root entry trust: a regular file as the governed root is refused ROOT_NOT_A_DIRECTORY | PASS | ROOT_NOT_A_DIRECTORY |
| root-law | root entry trust: a governed root with the wrong mode is refused ROOT_MODE_INVALID | PASS | ROOT_MODE_INVALID |
| root-law | root entry trust: an absent governed root is refused ROOT_NOT_FOUND | PASS | ROOT_NOT_FOUND |
| root-law | V112-RP1 section 6 / V113-B1 section 7: entry classification happens by lstat BEFORE anything is resolved, realpath is only ever a later alias check, and there is now exactly ONE implementation of it in the CORE | PASS |  |
| root-law | V112-RP1 section 9/14 PINNED: a SYMLINKED session directory is refused, on load and on derive, even though the document behind it is valid | PASS | SESSION_SYMLINK_REFUSED/SESSION_SYMLINK_REFUSED |
| root-law | restoring the real session directory restores the workflow, so the refusal was the symlink and not the document | PASS |  |
| root-law | V112-RP1 section 13 PINNED: a valid evidence set copied to /tmp, a sibling root or an alternate user path is refused before attachment derivation | PASS | /tmp->SET_LOCATION_MISMATCH; a sibling root->SET_LOCATION_MISMATCH; an alternate user path->SET_LOCATION_MISMATCH |
| root-law | V112-RP1 sections 10/12: the AUTHORIZING derivation refuses every sandboxed document outright, whatever its contents | PASS | SET_NOT_FOUND |
| root-law | no evidence can appear anywhere but the canonical path: with the frozen root present the production authoring path writes at the canonical location and nowhere else | PASS | root present; production paths are the canonical paths |
| root-law | the production root resolver is not configurable in either environment: no argument, no override, and the authoring layer delegates to the core constant | PASS |  |
| root-law | V112-RP1 section 10: neither the Store.v5 evidence root nor any EKA/shared path can become the attachment root; there is no parameter to say so | PASS |  |
| root-law | V112-RP1 section 5: every forbidden session-id shape is refused SESSION_ID_INVALID, so no traversal is possible through the session id | PASS | 18 rejected shapes |
| root-law | the session id law rejects separators, traversal, leading dots, NUL, absolute syntax and over-length, and accepts an ordinary id | PASS |  |
| root-law | V112-RP1 section 15: the scratch-root mechanism lives in a separate INTERNAL_NON_AUTHORIZING module | PASS |  |
| root-law | V112-RP1 section 15: neither production CLI imports the testkit, so the override is unreachable in production mode | PASS |  |
| root-law | the authoring module never imports the testkit: the arming variable is module-private, and the testkit is the only code that assigns it | PASS |  |
| root-law | the testkit refuses to sandbox the real authority root, so the suite can never write evidence there | PASS |  |
| root-parity | V112-RP1 section 19: the sandbox differs from production in the ROOT PREFIX ONLY - the same resolver, the same trust checks and the same freshness law run on the same code | PASS |  |
| root-parity | no fixture or test path can establish a state production location policy forbids: the sandboxed document is mechanically sound yet the AUTHORIZING derivation refuses it outright | PASS | mechanics=ATTACHMENT_READY; authorizing=SET_NOT_FOUND |
| root-parity | the positive ATTACHMENT_READY fixtures carry no evidence-set location at all, so they cannot assert a location production would refuse | PASS |  |
| root-property | 24 seeded root, symlink, relocation, sibling-prefix, relative and normalisation attacks: none yields ATTACHMENT_READY outside the governed root (seed 20261022) | PASS | all refused |
| root-property | 40 seeded session-id shapes: the safe-basename law and the path law agree exactly, and no traversal is ever accepted (seed 20261022) | PASS | consistent |
| root-static | no production authorizing arbitrary-root parameter survives anywhere in the authoring module or either CLI | PASS |  |
| root-static | exactly one governed-root constant exists and every path derives from it; there is no second resolver | PASS |  |
| root-static | no symlink-follow-before-check anywhere: neither the core nor the authoring module calls .resolve(), and in the ONE trust implementation realpath appears only after lstat classification | PASS |  |
| root-static | no production runtime path under /tmp, and the frozen root is neither a Store.v5 root nor an EKA/shared path | PASS |  |
| root-static | derive AND verify both re-check the canonical governed location, not only create | PASS |  |
| root-static | the production tools do not import the test helper, and the test helper is not on the authorizing surface | PASS |  |
| root-static | the workflow law document publishes the frozen root, the refusal codes and the test-override separation | PASS |  |
| core-authority | V113-B1 sections 1/10: derive_attachment_state and evaluate_eligibility are NO LONGER on the authorizing surface; they are declared DIAGNOSTIC / NON_AUTHORIZING | PASS | derive_attachment_state,evaluate_eligibility |
| core-authority | the authorizing surface names the governed loader, the four authorizing entry points and the two location predicates | PASS | all present |
| core-authority | every name on the authorizing surface is real: each core name is a callable in authority_lib and each declared evidence-set OPERATION is implemented by the authoring module, so the surface is not aspirational | PASS | all resolved |
| core-authority | the declared authorizing evidence-set derivation operation is the AUTHORIZING wrapper, which now routes through the core's governed loader rather than deciding locality by itself | PASS |  |
| core-authority | V113-B1 section 6: no authorizing core entry point accepts a root, evidence_root, path or base_dir parameter, and the root resolver takes no argument at all | PASS |  |
| core-authority | the core root resolver has NO override of any kind, not even for tests, and the canonical path law is derived from the frozen constant | PASS |  |
| core-authority | V113-B1 section 20: GovernedEvidenceSet is constructible ONLY by the canonical loader - a direct construction with a wrong token is refused | PASS | RAW_AuthorityTrustError |
| core-authority | it has __slots__ and no dict, so provenance fields cannot be grafted onto an instance after the fact | PASS |  |
| core-authority | the location receipt is a digest under a REGISTERED hash domain and separates session id, document digest and active manifest | PASS |  |
| core-authority | every code the core's location predicates can emit is in the frozen LOCATION_ERRORS vocabulary | PASS | LOCATION_PROVENANCE_MISSING |
| core-bypass | control: the forbidden-location document is mechanically perfect. The wrapper refuses it, and the DIAGNOSTIC core still derives ATTACHMENT_READY and diagnostic eligibility - which is exactly what made this a real bypass surface in v1.13 | PASS | wrapper=NOT_PRODUCTION_ROOT diagnostic_state=ATTACHMENT_READY diagnostic_eligible=True |
| core-bypass | V113-B1 PINNED (section 13): the AUTHORIZING core derivation refuses the same evidence and never returns a readiness value. In v1.13 authority_lib.derive_attachment_state returned ATTACHMENT_READY here. | PASS | CONFLICT authorizing=False ['LOCATION_AUTHORITY_INVALID'] |
| core-bypass | V113-B1 PINNED (section 13): AUTHORIZING eligibility is fail-closed on the same evidence. In v1.13 authority_lib.evaluate_eligibility returned eligible=true with derived_attachment_state ATTACHMENT_READY. | PASS | eligible=False codes=['LOCATION_AUTHORITY_INVALID'] |
| core-bypass | V113-B1 section 9: location authority strictly DOMINATES attachment semantics - the authorizing path checks provenance BEFORE it computes readiness, rather than computing readiness and retracting it afterwards | PASS |  |
| core-bypass | the diagnostic functions are unchanged in behaviour: v1.14 demotes them, it does not weaken the semantic derivation the whole v1.11 suite depends on | PASS |  |
| core-bypass | V113-B1 sections 12/19: no diagnostic->authority escalation via the raw evidence-set dict | PASS | eligible=False authorizing=False |
| core-bypass | V113-B1 sections 12/19: no diagnostic->authority escalation via the diagnostic derivation result | PASS | eligible=False authorizing=False |
| core-bypass | V113-B1 sections 12/19: no diagnostic->authority escalation via a bare ATTACHMENT_READY state string | PASS | eligible=False authorizing=False |
| core-bypass | V113-B1 sections 12/19: no diagnostic->authority escalation via the diagnostic eligibility result | PASS | eligible=False authorizing=False |
| core-bypass | V113-B1 sections 12/19: no diagnostic->authority escalation via None | PASS | eligible=False authorizing=False |
| core-bypass | V113-B1 sections 12/19: no diagnostic->authority escalation via a dict carrying every GovernedEvidenceSet field, all correct-looking | PASS | eligible=False authorizing=False |
| core-bypass | V113-B1 sections 12/19: no diagnostic->authority escalation via a namespace object with the same attributes | PASS | eligible=False authorizing=False |
| core-bypass | V113-B1 sections 12/19: no diagnostic->authority escalation via a subclass instance built without the token | PASS | eligible=False authorizing=False |
| core-bypass | the escalation matrix is complete and every route is refused (8/8) | PASS |  |
| core-bypass | V113-B1 section 15: a relocation attack cannot even be EXPRESSED against the core - the authorizing loader takes only (session_id, active) and derives the path itself, so identical bytes elsewhere are unreachable | PASS |  |
| core-bypass | V113-B1 section 16: the core's single trust implementation refuses a symlinked entry, a non-directory and a wrong mode, and accepts only a real 0700 directory | PASS |  |
| core-bypass | the classification is lstat-FIRST: the symlink is refused as an entry, so nothing is resolved before it is trusted | PASS |  |
| core-bypass | V113-B1 section 17: the testkit reaches ATTACHMENT_READY on the DIAGNOSTIC path only; its own document cannot bootstrap the authorizing core or authorizing eligibility | PASS | testkit_diagnostic=ATTACHMENT_READY |
| core-bypass | the testkit refuses to sandbox the frozen authority root, so no suite path can write evidence there | PASS |  |
| core-positive | SKIPPED BY DESIGN: the governed evidence root already exists on this host, so the suite must not create, touch or remove operator evidence there. Run the positive authorizing control on a host where it is absent. | PASS | governed root present; positive control not run |
| core-callgraph | V113-B1 section 18: no PRODUCTION module calls the diagnostic core derivation or the diagnostic eligibility; the authoring layer routes through the governed loader and the authorizing entry points | PASS |  |
| core-callgraph | the testkit is the ONLY module in the bundle that calls the DIAGNOSTIC core derivation, and it is INTERNAL_NON_AUTHORIZING; both production CLIs call the authoring wrapper instead, which is the authorizing path | PASS | CLIs -> A.derive_attachment_state -> L.derive_attachment_state_authorizing |
| core-callgraph | neither production CLI imports the testkit or can reach the diagnostic path through it | PASS |  |
| core-callgraph | the in-core consumer graph of the DIAGNOSTIC derivation is exactly one hop (AST, not text): only the authorizing derivation and the diagnostic eligibility call it, and only semantic_mutation_plan - declared INTERNAL_NON_AUTHORIZING - calls that | PASS | derive<-['derive_attachment_state_authorizing', 'evaluate_eligibility'] elig<-['evaluate_eligibility_authorizing', 'semantic_mutation_plan'] |
| core-callgraph | V113-B1 section 18: semantic_mutation_plan is reached ONLY from the M3 composed path, which is PROVISIONAL_UNTIL_M3 and cannot yield M0A probe eligibility - it requires a mutation plan and a complete S0 snapshot before it runs at all, and an M0 read primitive has neither. Pre-M3 transaction authority is deliberately outside v1.14's scope and is recorded as a scoped residual in THREAT-MODEL.md. | PASS | _validate_transaction_set_impl |
| core-callgraph | the M0A probe request is not a mutation plan: fed to semantic_mutation_plan as one it produces errors and never an approval, so the M3 path is not an alternative route to probe eligibility | PASS |  |
| core-callgraph | the composed M3 path also refuses an empty linked set outright, so it cannot be entered with the objects an M0 read has | PASS |  |
| core-selflocation | V113-B1 section 21: the core loader independently compares the document's own recorded location and session identity against the canonical path it actually loaded from, and requires the frozen authority root plus written_under_production_root | PASS |  |
| core-selflocation | the loader reads the document ONLY from the canonical path it computed, never from a caller-supplied path | PASS |  |
| core-property | 24 seeded forbidden-root, precomputed-state, diagnostic-result, raw-dict, symlinked-root and sibling-prefix cases: not one yields authorizing readiness or eligible=true (seed 20261023) | PASS | all refused |
| core-property | 40 seeded session ids: the CORE law and the authoring layer agree exactly, because after v1.14 there is ONE implementation, and no traversal form is accepted (seed 20261023) | PASS | consistent |
| core-static | section 32: authorizing eligibility cannot accept a raw or precomputed attachment state - it has no state parameter and recomputes from the governed document | PASS |  |
| core-static | section 32: a production caller cannot invoke the diagnostic derivation, and both diagnostic functions declare NON-AUTHORIZING and name V113-B1 in their own docstrings | PASS |  |
| core-static | section 32: the authorizing derivation checks the canonical location itself and does not delegate that to a wrapper | PASS |  |
| core-static | section 32: there is exactly ONE governed-root resolver and ONE directory-trust implementation, both in the core, and the authoring layer delegates to them rather than restating them | PASS |  |
| core-static | section 32: the authoring layer no longer carries its own realpath alias check, so root trust cannot drift between the two layers | PASS |  |
| core-static | section 32: the CORE never imports the authoring layer or the testkit, so location authority cannot be armed from outside it | PASS |  |
| core-static | section 32: fixture and testkit helpers are not on the authority surface | PASS |  |
| core-static | the location refusal vocabulary is frozen and closed, and names the four codes v1.14 introduces | PASS |  |
| core-static | EVIDENCE-SET-WORKFLOW.json publishes the v1.14 core_authority block: the only door, the provenance object, the four authorizing entry points, the two demoted ones, the receipt and the fail-closed law | PASS |  |
| core-static | the workflow law document publishes the v1.15 consumed-evidence, authority-file, malformed-carrier and transaction-authority laws (V114-B1/B2/B4/M1) | PASS |  |
| core-static | the published core_authority precedence matches the code: location authority, then attachment semantics, then eligibility | PASS |  |
| core-static | M0A-BINDING-VALUES.json publishes the v1.14 authorizing entry points, the governed loader, the receipt domain, the refusal vocabulary and the harness update requirement, with no placeholder | PASS |  |
| core-static | V113-B1 MINOR fixed: the stale test_root_override text claiming the authoring API takes a root parameter is gone from EVIDENCE-SET-WORKFLOW.json, and what remains matches the code | PASS |  |
| m1-malformed-carrier | V114-M1: object.__new__(GovernedEvidenceSet) fails closed at all three public authorizing boundaries, with no raw Python exception | PASS | derive=ok eligibility=ok commit=ok |
| m1-malformed-carrier | V114-M1: object.__new__(subclass) fails closed at all three public authorizing boundaries, with no raw Python exception | PASS | derive=ok eligibility=ok commit=ok |
| m1-malformed-carrier | V114-M1: a bare dict fails closed at all three public authorizing boundaries, with no raw Python exception | PASS | derive=ok eligibility=ok commit=ok |
| m1-malformed-carrier | V114-M1: None fails closed at all three public authorizing boundaries, with no raw Python exception | PASS | derive=ok eligibility=ok commit=ok |
| m1-malformed-carrier | V114-M1: a bare ATTACHMENT_READY string fails closed at all three public authorizing boundaries, with no raw Python exception | PASS | derive=ok eligibility=ok commit=ok |
| m1-malformed-carrier | V114-M1: a namespace object with every field name fails closed at all three public authorizing boundaries, with no raw Python exception | PASS | derive=ok eligibility=ok commit=ok |
| m1-malformed-carrier | V114-M1: a nominal instance with SOME slots set fails closed at all three public authorizing boundaries, with no raw Python exception | PASS | derive=ok eligibility=ok commit=ok |
| m1-malformed-carrier | V114-M1: a nominal instance with a None slot fails closed at all three public authorizing boundaries, with no raw Python exception | PASS | derive=ok eligibility=ok commit=ok |
| m1-malformed-carrier | V114-M1: a nominal instance with wrong-typed slots fails closed at all three public authorizing boundaries, with no raw Python exception | PASS | derive=ok eligibility=ok commit=ok |
| m1-malformed-carrier | V114-M1: a nominal instance with a malformed receipt fails closed at all three public authorizing boundaries, with no raw Python exception | PASS | derive=ok eligibility=ok commit=ok |
| m1-malformed-carrier | V114-M1 PINNED: the exact Codex reproduction. object.__new__(GovernedEvidenceSet) passes isinstance and has no slots set; in v1.14 provenance validation dereferenced .session_id and leaked a raw AttributeError out of BOTH public boundaries. It is now GOVERNED_EVIDENCE_INVALID. | PASS |  |
| m1-malformed-carrier | the malformed-carrier matrix is complete and every case fails closed (10 cases) | PASS | all fail closed |
| m1-malformed-carrier | V114-M1 section 31: genuine PROGRAMMING errors are NOT masked - only malformed external authority input is normalised, so the v1.10 programming-error distinction survives | PASS | malformed input normalised; a wrong-arity call or an unserialisable value still raises |
| m1-malformed-carrier | the structural validator is called FIRST inside governed_consume, before any field is dereferenced | PASS |  |
| m1-malformed-carrier | GOVERNED_EVIDENCE_INVALID is in the frozen location vocabulary, and so are the other three v1.15 codes | PASS |  |
| b3-active-naming | V114-B3 PINNED: no ACTIVE authority artifact names a diagnostic or provisional-until-M3 function except explicitly AS diagnostic. In v1.14 TARGET-CONTRACT.json, PERMISSIONS.json, TARGET-ATTACHMENT-GATE.md and ELIGIBILITY.md designated the raw derivation and the raw eligibility as current authority, contradicting the code registry. | PASS | 61 active documents clean |
| b3-active-naming | the four artifacts Codex named now designate the AUTHORIZING entry points | PASS |  |
| b3-active-naming | V114-B3 section 21: every function name an active artifact designates as authority IS on the authorizing surface, and no diagnostic name occupies an authorizing binding field | PASS |  |
| b3-active-naming | V114-B3 section 20: precedence is explicit - the code registry and the active documents now agree, and the workflow law and M0A bindings publish the same four surface classes | PASS |  |
| b3-active-naming | the audit actually scanned every CURRENT artifact, machine and prose, not a sample (61 documents) | PASS | 61 scanned |
| hash-domain-parity | V114-N1 PINNED: every hash domain the authorizing code registers is documented in CANONICALIZATION.md. In v1.14 the closed list omitted vidtoolz.resolveLocationReceipt.v1 and recorded two evidence-store domains at superseded versions. | PASS | 33 domains documented |
| hash-domain-parity | and the reverse: the documented closed list names no domain the code does not register (the codec domain is documented as a codec, not a digest domain) | PASS | exact |
| hash-domain-parity | V114-N1 section 34: the parity assertion itself is published in the document, so the omission cannot recur silently | PASS |  |
| hash-domain-parity | the two v1.14/v1.15 governed-location domains are documented with what they bind | PASS |  |
| hash-domain-parity | the receipt and the snapshot are DIFFERENT digests of the same document, and neither is the record-id domain | PASS |  |
| b2-transaction-authority | control: the exact Codex reproduction still behaves as it did - the complete committed-consistent fixture supplied as a BARE evidence dict completes all twelve stages and the composed commit says eligible=true. That is why v1.14's classification of these two functions as AUTHORIZING was the defect. | PASS | stages=12/12 composed_eligible=True |
| b2-transaction-authority | V114-B2 PINNED: those two functions are NO LONGER authorizing. They are PROVISIONAL_UNTIL_M3 / NON-AUTHORIZING on the surface and say so in their own docstrings. | PASS |  |
| b2-transaction-authority | V114-B2 PINNED: the AUTHORIZING transaction and commit entry points refuse the same bare dict with GOVERNED_EVIDENCE_REQUIRED, before any stage runs | PASS | ['GOVERNED_EVIDENCE_REQUIRED: authorizing transaction validation requires a GovernedEvidenceSet from authority_lib.load_governed_evidence_set, got dict'] |
| b2-transaction-authority | V114-B2 section 14: no diagnostic result can poison the commit path via the diagnostic eligibility result | PASS | commit_eligible=False vts_errors=1 |
| b2-transaction-authority | V114-B2 section 14: no diagnostic result can poison the commit path via the diagnostic derivation result | PASS | commit_eligible=False vts_errors=1 |
| b2-transaction-authority | V114-B2 section 14: no diagnostic result can poison the commit path via a bare eligible=true dict | PASS | commit_eligible=False vts_errors=1 |
| b2-transaction-authority | V114-B2 section 14: no diagnostic result can poison the commit path via the raw evidence dict | PASS | commit_eligible=False vts_errors=1 |
| b2-transaction-authority | V114-B2 section 14: no diagnostic result can poison the commit path via the diagnostic transaction result | PASS | commit_eligible=False vts_errors=1 |
| b2-transaction-authority | the diagnostic-poison matrix is complete and every route is refused (5/5) | PASS |  |
| b2-transaction-authority | V114-B2 sections 11/13: semantic_mutation_plan chooses its eligibility law BY TYPE, never by a caller-supplied callback - a governed carrier routes to evaluate_eligibility_authorizing, a bare dict to the diagnostic gate - and it remains INTERNAL_NON_AUTHORIZING | PASS |  |
| b2-transaction-authority | the authorizing transaction entry point consumes the bytes-bound snapshot and threads the carrier to the plan stage; the public signature carries no validator and no evidence dict | PASS |  |
| b2-transaction-authority | V114-B2 section 16: the twelve commit stages, their order and the internally pinned schemas are UNCHANGED - v1.15 adds a provenance gate in front of them and changes no stage law | PASS |  |
| b2-transaction-authority | a caller cannot smuggle a law into the authorizing pair: extra positional or keyword arguments are refused by name, exactly as on the demoted pair | PASS |  |
| b1-positive | MANDATORY positive control at the REAL canonical governed root: the authorizing derivation returns ATTACHMENT_READY with authorizing=true, the location receipt and the consumed-snapshot digest | PASS | ATTACHMENT_READY authorizing=True |
| b1-positive | and authorizing eligibility returns eligible=true with reason code ELIGIBLE, so the v1.15 bindings did not turn the authority into refuse-everything | PASS | eligible=True codes=['ELIGIBLE'] |
| b1-positive | the by-session-id paths and the authoring wrapper agree with the by-object paths | PASS |  |
| b1-positive | the second session is honestly PROVISIONED_NOT_VERIFIED, so the two carriers hold genuinely different authority - which is what makes the substitution attack below meaningful | PASS |  |
| b1-positive | v1.15 section 35: the suite runs this control in BOTH reviewer environments and leaves the governed root exactly as it found it | PASS |  |
| b1-consumed-evidence | V114-B1 PINNED: the carrier is IMMUTABLE - assigning evidence_set, document_bytes or any provenance field is refused. In v1.14 a plain slot assignment replaced the consumed evidence while the receipt, digest and live file stayed valid, and the authorizing derivation consumed the substituted object. | PASS |  |
| b1-consumed-evidence | V114-B1: evidence_set is a read-only PROPERTY that reparses the validated bytes on every access, so mutating what a caller received changes nothing the authority will ever see | PASS |  |
| b1-consumed-evidence | V114-B1 sections 5/8: no authorizing entry point takes a governed carrier AND a separate evidence argument - there is exactly ONE evidence authority input | PASS |  |
| b1-consumed-evidence | V114-B1 section 8: object.__setattr__ forcing bytes only of the READY session onto the PREPARED session's carrier still cannot authorize | PASS | CONFLICT authorizing=False ["EVIDENCE_SNAPSHOT_MISMATCH: the carrier's bytes are not the live governed bytes"] |
| b1-consumed-evidence | V114-B1 section 8: object.__setattr__ forcing bytes + document digest of the READY session onto the PREPARED session's carrier still cannot authorize | PASS | CONFLICT authorizing=False ['LOCATION_RECEIPT_INVALID: the document changed since it was loaded'] |
| b1-consumed-evidence | V114-B1 section 8: object.__setattr__ forcing bytes + digest + snapshot digest of the READY session onto the PREPARED session's carrier still cannot authorize | PASS | CONFLICT authorizing=False ['LOCATION_RECEIPT_INVALID: the document changed since it was loaded'] |
| b1-consumed-evidence | V114-B1 section 8: object.__setattr__ forcing bytes + digest + snapshot + receipt of the READY session onto the PREPARED session's carrier still cannot authorize | PASS | CONFLICT authorizing=False ['LOCATION_RECEIPT_INVALID: the document changed since it was loaded'] |
| b1-consumed-evidence | the substitution matrix is complete: forcing every provenance field in turn never authorizes (4/4) | PASS |  |
| b1-consumed-evidence | V114-B1 section 9: authority depends on BYTES, not on Python object identity - two independently loaded carriers for the same document are different objects with identical digests and identical authorizing results | PASS |  |
| b1-consumed-evidence | V114-B1 section 3: the consumed object is the parse of the bytes just read - governed_consume reads the live file, compares the live digest to the minted one AND to the carrier's own bytes, parses those exact bytes and checks the bound snapshot digest | PASS |  |
| b1-consumed-evidence | and the authorizing entry points consume THAT returned object, not a field of the carrier | PASS |  |
| b1-consumed-evidence | V114-B1 section 7 PINNED: a held carrier whose document changed underneath it cannot authorize anything - derivation, eligibility and commit all refuse with LOCATION_RECEIPT_INVALID / DOCUMENT CHANGED | PASS | ['LOCATION_RECEIPT_INVALID: the document changed since it was loaded'] |
| b1-consumed-evidence | restoring the exact bytes restores authority, so the refusal was the change and not the holding | PASS |  |
| b4-workflow-file | V114-B4: WORKFLOW.json as a symlink OUTSIDE the governed root is refused WORKFLOW_SYMLINK_REFUSED by the loader, by the wrapper and by the published location predicate - with no read through the target and no hang | PASS | loader=refused:WORKFLOW_SYMLINK_REFUSED: /home/vidtoolz/resolve-qualificati wrapper=refused |
| b4-workflow-file | V114-B4: WORKFLOW.json as a symlink to the sibling EVIDENCE-SET.json is refused WORKFLOW_SYMLINK_REFUSED by the loader, by the wrapper and by the published location predicate - with no read through the target and no hang | PASS | loader=refused:WORKFLOW_SYMLINK_REFUSED: /home/vidtoolz/resolve-qualificati wrapper=refused |
| b4-workflow-file | V114-B4: WORKFLOW.json as a symlink to the other governed session's workflow is refused WORKFLOW_SYMLINK_REFUSED by the loader, by the wrapper and by the published location predicate - with no read through the target and no hang | PASS | loader=refused:WORKFLOW_SYMLINK_REFUSED: /home/vidtoolz/resolve-qualificati wrapper=refused |
| b4-workflow-file | V114-B4: WORKFLOW.json as a FIFO is refused WORKFLOW_NOT_A_REGULAR_FILE by the loader, by the wrapper and by the published location predicate - with no read through the target and no hang | PASS | loader=refused:WORKFLOW_NOT_A_REGULAR_FILE: /home/vidtoolz/resolve-qualific wrapper=refused |
| b4-workflow-file | V114-B4: WORKFLOW.json as a directory is refused WORKFLOW_NOT_A_REGULAR_FILE by the loader, by the wrapper and by the published location predicate - with no read through the target and no hang | PASS | loader=refused:WORKFLOW_NOT_A_REGULAR_FILE: /home/vidtoolz/resolve-qualific wrapper=refused |
| b4-workflow-file | V114-B4: WORKFLOW.json as a dangling symlink is refused WORKFLOW_SYMLINK_REFUSED by the loader, by the wrapper and by the published location predicate - with no read through the target and no hang | PASS | loader=refused:WORKFLOW_SYMLINK_REFUSED: /home/vidtoolz/resolve-qualificati wrapper=refused |
| b4-workflow-file | the WORKFLOW.json file-type matrix is complete and every substitution is refused (6/6) | PASS |  |
| b4-workflow-file | V114-B4 PINNED: the v1.14 reproduction is exactly the first case. Its loader checked only that WORKFLOW.json existed and then opened it through strict_load, which followed the symlink and returned a GovernedEvidenceSet (ACCEPTED_WORKFLOW_SYMLINK); v1.15 refuses before any read. | PASS |  |
| b4-workflow-file | V114-B4 sections 23/24: WORKFLOW.json is treated as governed evidence - its bytes are digested, bound into the location receipt and re-checked on every authorizing call, so its authority-bearing claims cannot be swapped after minting | PASS |  |
| b4-workflow-file | V114-B4 section 27: replacing WORKFLOW.json AFTER a valid load is detected on the next authorizing call | PASS | LOCATION_RECEIPT_INVALID: the workflow file changed since it was loade |
| b4-workflow-file | both authority files get the SAME entry law from the same implementation, and the evidence document's own symlink/file-type refusals still hold | PASS |  |
| v115-property | 32 seeded cases over carrier substitution, receipt/snapshot mismatch, malformed carriers, diagnostic-into-commit injection and WORKFLOW.json path/file types: not one authorizes, and not one raises (seed 20261024) | PASS | all refused |
| v115-static | THE ESSENTIAL v1.15 LAW, asserted end to end: for every governed session the object the authorizing derivation consumes is byte-for-byte the parse of the file it validated, and nothing else can be substituted for it | PASS |  |
| b1-consumed-evidence | once the governed session is removed, a carrier held from it authorizes nothing: the location is revalidated on every call, not remembered | PASS |  |
| v115-static | section 55: the authorizing derivation has exactly ONE semantic evidence source - governed_consume - and the carrier exposes no stored parsed object at all | PASS |  |
| v115-static | section 55: consumed evidence is bound to the loaded bytes - the carrier is frozen, and __copy__, __deepcopy__ and __reduce__ all refuse, so provenance cannot be cloned out of the loader | PASS |  |
| v115-static | section 55: no diagnostic eligibility appears in the AUTHORIZING transaction call graph (AST, not text) | PASS |  |
| v115-static | section 55: no diagnostic or provisional name occupies an authorizing registry slot, in code or in any active machine artifact | PASS |  |
| v115-static | section 55: WORKFLOW.json is read no-follow, from the canonical path only, by the same implementation as the evidence document | PASS |  |
| v115-static | section 55: the malformed-external-object guard is on the shared provenance path, so all four public authorizing boundaries inherit it | PASS |  |
| v115-static | section 55: every hash domain the code registers is documented, asserted by section hash-domain-parity above | PASS |  |
| v115-static | the v1.14 good core is retained, not reverted: the type separation, the raw/precomputed refusals, the live receipt revalidation, the no-state-parameter eligibility signature and the location precedence all still hold | PASS |  |
| b1-classification | V115-B1 sections 2/3/4/5: ONE canonical machine-readable function->class map exists, is generated from the executable AUTHORITY_SURFACE, and classifies all twelve decision functions with no duplicate and no contradiction | PASS | 12 decision functions classified |
| b1-classification | the four classes partition the surface exactly: every classified name has ONE class, and the published per-class lists equal the executable lists | PASS |  |
| b1-classification | V115-B1 section 3: the authorizing class contains exactly the entry points that require governed provenance, and the twelve decision functions land where the executable code puts them | PASS | derive_attachment_state=diagnostic_non_authorizing,derive_attachment_state_authorizing=authorizing,derive_attachment_state_for_session=authorizing,evaluate_eligibility=diagnostic_non_authorizing,evaluate_eligibility_auth |
| b1-classification | V115-B1 section 5: the provisional pair is NOT relabelled to make the contradiction go away - it keeps its exact class, and its semantic behaviour is unchanged | PASS |  |
| b1-classification | V115-B1 PINNED (group 1): TARGET-CONTRACT.json#qualification_note - which v1.15 left saying 'attachment state is derived by tools/authority_lib.py#derive_attachment_state' - now names the authorizing entry points and marks the bare function DIAGNOSTIC / NON_AUTHORIZING | PASS |  |
| b1-classification | V115-B1 PINNED (group 1): TARGET-CONTRACT.json#attachment_law - which v1.15 left saying the state is 'computed by derive_attachment_state' - now names the authorizing state function and marks the bare one diagnostic | PASS |  |
| b1-classification | V115-B1 section 6: every TARGET-CONTRACT field that describes attachment, eligibility or M0A gate authority names an authorizing entry point, and the only field naming the bare function declares it diagnostic in its own text | PASS |  |
| b1-classification | V115-B1 PINNED (group 2): SCHEMA-REGISTRY.md no longer says the *_authorizing pair is PROVISIONAL_UNTIL_M3 and non-authorizing - it says the LEGACY BARE pair is, which is what the executable surface says | PASS |  |
| b1-classification | and SCHEMA-REGISTRY.md's own authorizing statements name the authorizing pair, so the document no longer contradicts itself | PASS |  |
| current-reference-classes | all current references classified without ambiguous or demoted authority | PASS | [] |
| b1-property | 24 seeded (demoted function x authorizing slot) pairs: a demoted name never occupies an authorizing slot except inside a clause that declares it demoted (seed 20261025) | PASS | no stale designation |
| b1-property | and the exhaustive scan covers every current artifact, machine and prose, with no key-name exemption list (61 artifacts) | PASS | 61 artifacts |
| m1-receipt-parity | V115-M1 PINNED: RUNTIME_BOUND_FIELDS == PUBLISHED_BOUND_FIELDS exactly, in both directions and in order, in BOTH machine artifacts. v1.15 published seven fields while the runtime bound ten. | PASS | 10 fields, published == runtime |
| m1-receipt-parity | V115-M1 section 16 PINNED: the declared field tuple IS what location_receipt() assembles and digests - read out of the function by AST, not taken on trust - and the function refuses RECEIPT_BINDING_DRIFT if they ever disagree | PASS | session_id,document_path,workflow_path,governed_root,authority_version,manifest_sha256,document_sha256,workflow_sha256,evidence_snapshot_digest,location_validated |
| m1-receipt-parity | V115-M1 section 15: the three fields v1.15 omitted are exactly workflow_path, workflow_sha256 and evidence_snapshot_digest, and all three are published now | PASS |  |
| m1-receipt-parity | V115-M1 section 19: every bound field publishes its operational semantics - source, normative, digest inclusion, live revalidation and whether the authorizing core consumes it - so a consumer can reproduce the receipt from machine authority alone | PASS |  |
| m1-receipt-parity | the published semantics are true of the implementation: every field is inside the digest, the frozen constants are named as constants, and location_validated is a constant True rather than a caller claim | PASS |  |
| m1-receipt-parity | V115-M1 section 20: the receipt domain is UNCHANGED - documentation catching up is not a contract change - and section 21: the snapshot domain remains distinct and is published as distinct | PASS |  |
| m1-receipt-parity | V115-M1 section 22 PINNED: removing ANY ONE of the 10 runtime-bound fields from the publication fails the parity law - including each of the three v1.15 omitted exactly as they were | PASS | all 10 omissions caught |
| m1-receipt-parity | V115-M1 section 22 PINNED: the exact v1.15 published list - the seven v1.14 fields - fails the law with BOUND_NOT_PUBLISHED naming precisely workflow_path, workflow_sha256 and evidence_snapshot_digest | PASS | ORDERED_SET_MISMATCH;BOUND_NOT_PUBLISHED: ['evidence_snapshot_digest', 'workflow_path', 'w |
| m1-receipt-parity | V115-M1 section 22 PINNED: claiming a field the runtime does not bind also fails - the law is exact-set equality, not containment (five plausible extras tested) | PASS | every over-claim caught |
| m1-property | 24 seeded permutations, omissions and additions of the receipt field list: every deviation from the runtime set is caught, and only the exact ordered set passes (seed 20261025) | PASS | exact-set law holds |
| m1-receipt-parity | V115-M1 section 23 PINNED: Hermes's package can derive the exact runtime receipt field set from frozen machine authority WITHOUT inspecting Python - two artifacts publish it, they agree with each other, and M0A-BINDING-VALUES names them and the field list | PASS |  |
| m1-receipt-parity | and a consumer who recomputes the receipt from the PUBLISHED field list gets the authority's own value, which is the operational point of the fix | PASS |  |
| v116-static | section 42: every current authority-function reference resolves to exactly one class, and the canonical map is the only source | PASS |  |
| v116-static | section 42: TARGET-CONTRACT and SCHEMA-REGISTRY agree with each other and with the code on every one of the twelve decision functions | PASS |  |
| v116-static | section 42: the runtime receipt field set equals the published set, and both receipt domains are documented in CANONICALIZATION.md | PASS |  |
| v116-static | section 42: no active v1.15 contradiction survives - the two TARGET-CONTRACT fields, the SCHEMA-REGISTRY sentence and the seven-field receipt publication are all corrected, and each is asserted by its own pinned check above | PASS |  |
| v116-static | section 46: no current contradiction hides behind a precedence statement - the precedence document's blanket clause covers HISTORICAL statements only, and every CURRENT artifact is asserted correct on its own | PASS |  |
| v118-release-scanner | registration-current | PASS | [] |
| v118-release-scanner | external-final-bytes | PASS | [] |
| v118-release-scanner | document-universe | PASS | [] |
| v118-release-scanner | active-finding-map-schema | PASS | [] |
| v118-release-scanner | zero-current | PASS |  |
| v118-release-scanner | duplicate-selector | PASS |  |
| v118-release-scanner | old-current | PASS |  |
| v118-release-scanner | missing-registration | PASS |  |
| v118-release-scanner | stale-prose | PASS |  |
| v118-release-scanner | both-current | PASS |  |
| v118-release-scanner | current-rejected | PASS |  |
| v118-release-scanner | stale-prose-current authority | PASS |  |
| v118-release-scanner | stale-prose-current version | PASS |  |
| v118-release-scanner | stale-prose-active authority | PASS |  |
| v118-release-scanner | stale-prose-active version | PASS |  |
| v118-release-scanner | stale-prose-controlling authority | PASS |  |
| v118-release-scanner | stale-prose-authoritative version | PASS |  |
| v118-release-scanner | external-digest-negative | PASS |  |
| v118-release-scanner | parent-document-pin-negative | PASS |  |
| v118-release-scanner | check-omission-negative | PASS |  |
| v118-release-scanner | check-duplicate-negative | PASS |  |
| v118-release-scanner | actual-required-check-omission | PASS | author bootstrap empty plan is never release validation |
| v118-release-scanner | inventory-full-equality | PASS |  |
| v118-release-scanner | independent-reference-equality | PASS |  |
| v118-release-scanner | metadata-reference-set-equality | PASS |  |
| v118-release-scanner | independent-source-role-bindings | PASS | [] |
| v118-release-scanner | independent-role-equality | PASS |  |
| v118-release-scanner | independent-slot-equality | PASS |  |
| v118-release-scanner | all-current-reference-roles | PASS | [] |
| v118-release-scanner | former-slot-0 | PASS | PERMISSIONS.json#law |
| v118-release-scanner | former-slot-1 | PASS | M0A-BINDING-VALUES.json#values.verification_result_law |
| v118-release-scanner | former-slot-2 | PASS | M0A-BINDING-VALUES.json#values.toctou_law |
| v118-release-scanner | former-slot-3 | PASS | FREEZE-MANIFEST.json#rules.[4] |
| v118-release-scanner | former-slot-4 | PASS | FREEZE-MANIFEST.json#files.[82].qualification_note |
| v118-release-scanner | slot-omission-00 | PASS |  |
| v118-release-scanner | slot-omission-01 | PASS |  |
| v118-release-scanner | slot-omission-02 | PASS |  |
| v118-release-scanner | slot-omission-03 | PASS |  |
| v118-release-scanner | slot-omission-04 | PASS |  |
| v118-release-scanner | slot-omission-05 | PASS |  |
| v118-release-scanner | slot-omission-06 | PASS |  |
| v118-release-scanner | slot-omission-07 | PASS |  |
| v118-release-scanner | slot-omission-08 | PASS |  |
| v118-release-scanner | slot-omission-09 | PASS |  |
| v118-release-scanner | slot-omission-10 | PASS |  |
| v118-release-scanner | slot-omission-11 | PASS |  |
| v118-release-scanner | slot-omission-12 | PASS |  |
| v118-release-scanner | slot-omission-13 | PASS |  |
| v118-release-scanner | slot-omission-14 | PASS |  |
| v118-release-scanner | slot-omission-15 | PASS |  |
| v118-release-scanner | slot-omission-16 | PASS |  |
| v118-release-scanner | slot-omission-17 | PASS |  |
| v118-release-scanner | slot-omission-18 | PASS |  |
| v118-release-scanner | slot-omission-19 | PASS |  |
| v118-release-scanner | slot-omission-20 | PASS |  |
| v118-release-scanner | slot-omission-21 | PASS |  |
| v118-release-scanner | slot-omission-22 | PASS |  |
| v118-release-scanner | slot-omission-23 | PASS |  |
| v118-release-scanner | edit-after-manifest | PASS |  |
| v118-release-scanner | registration-omission-00 | PASS |  |
| v118-release-scanner | registration-omission-01 | PASS |  |
| v118-release-scanner | registration-omission-02 | PASS |  |
| v118-release-scanner | registration-omission-03 | PASS |  |
| v118-release-scanner | registration-omission-04 | PASS |  |
| v118-release-scanner | registration-omission-05 | PASS |  |
| v118-release-scanner | registration-omission-06 | PASS |  |
| v118-release-scanner | registration-omission-07 | PASS |  |
| v118-release-scanner | registration-omission-08 | PASS |  |
| v118-release-scanner | registration-omission-09 | PASS |  |
| v118-release-scanner | registration-omission-10 | PASS |  |
| v118-release-scanner | registration-omission-11 | PASS |  |
| v118-release-scanner | registration-omission-12 | PASS |  |
| v118-release-scanner | registration-omission-13 | PASS |  |
| v118-release-scanner | registration-omission-14 | PASS |  |
| v118-release-scanner | registration-omission-15 | PASS |  |
| v118-release-scanner | registration-omission-16 | PASS |  |
| v118-release-scanner | registration-omission-17 | PASS |  |
| v118-release-scanner | registration-omission-18 | PASS |  |
| v118-release-scanner | registration-omission-19 | PASS |  |
| v118-release-scanner | registration-omission-20 | PASS |  |
| v118-release-scanner | registration-omission-21 | PASS |  |
| v118-release-scanner | registration-omission-22 | PASS |  |
| v118-release-scanner | registration-omission-23 | PASS |  |
| v118-release-scanner | exact-misregistration-mutant-refused | PASS |  |
| v118-release-scanner | extra-unregistered-normative | PASS |  |
| v118-release-scanner | thirty-case-corpus-size | PASS |  |
| v118-release-scanner | v117-regression-NEG-4 | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-NO-LONGER-DIAGNOSTIC-SINGLE | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-DIAGNOSTIC-REFUSES | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-UNRELATED-NEGATION | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-MIXED-SAME-CLAUSE | PASS | [('derive_attachment_state', 'DIAGNOSTIC_DECLARATION'), ('derive_attachment_state_authorizing', 'AUTHORIZING_DESIGNATION'), ('commit_eligibility', 'DIAGNOSTIC_DECLARATION')] |
| v118-release-scanner | v117-regression-CURRENT-HISTORY-corrected | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-CURRENT-HISTORY-v1.16 | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-CURRENT-HISTORY-historical | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-KEY-DIAGNOSTIC-SUPPRESSION | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-SAFE-KEY-WITHOUT-CLASS | PASS | [('derive_attachment_state', 'AMBIGUOUS_CURRENT_REFERENCE')] |
| v118-release-scanner | v117-regression-VERB-governs-derive_attachment_state | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-governs-derive_attachment_state_authorizing | PASS | [('derive_attachment_state_authorizing', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-controls-derive_attachment_state | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-controls-derive_attachment_state_authorizing | PASS | [('derive_attachment_state_authorizing', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-determines-derive_attachment_state | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-determines-derive_attachment_state_authorizing | PASS | [('derive_attachment_state_authorizing', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-adjudicates-derive_attachment_state | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-adjudicates-derive_attachment_state_authorizing | PASS | [('derive_attachment_state_authorizing', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-blocks-derive_attachment_state | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-blocks-derive_attachment_state_authorizing | PASS | [('derive_attachment_state_authorizing', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-permits-derive_attachment_state | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-permits-derive_attachment_state_authorizing | PASS | [('derive_attachment_state_authorizing', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-certifies-derive_attachment_state | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-certifies-derive_attachment_state_authorizing | PASS | [('derive_attachment_state_authorizing', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-rejects-derive_attachment_state | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-rejects-derive_attachment_state_authorizing | PASS | [('derive_attachment_state_authorizing', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-establishes-derive_attachment_state | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-VERB-establishes-derive_attachment_state_authorizing | PASS | [('derive_attachment_state_authorizing', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | v117-regression-MODULE-unfamiliar_module | PASS | [('derive_attachment_state', 'MENTION')] |
| v118-release-scanner | v117-regression-WRAP-BULLET | PASS | [('derive_attachment_state', 'AUTHORIZING_DESIGNATION')] |
| v118-release-scanner | unknown-key-00 | PASS |  |
| v118-release-scanner | unknown-key-01 | PASS |  |
| v118-release-scanner | unknown-key-02 | PASS |  |
| v118-release-scanner | unknown-key-03 | PASS |  |
| v118-release-scanner | unknown-key-04 | PASS |  |
| v118-release-scanner | unknown-key-05 | PASS |  |
| v118-release-scanner | unknown-key-06 | PASS |  |
| v118-release-scanner | unknown-key-07 | PASS |  |
| v118-release-scanner | unknown-key-08 | PASS |  |
| v118-release-scanner | unknown-key-09 | PASS |  |
| v118-release-scanner | unknown-key-10 | PASS |  |
| v118-release-scanner | unknown-key-11 | PASS |  |
| v118-release-scanner | unknown-key-12 | PASS |  |
| v118-release-scanner | unknown-key-13 | PASS |  |
| v118-release-scanner | unknown-key-14 | PASS |  |
| v118-release-scanner | unknown-key-15 | PASS |  |
| v118-release-scanner | unknown-key-16 | PASS |  |
| v118-release-scanner | unknown-key-17 | PASS |  |
| v118-release-scanner | unknown-key-18 | PASS |  |
| v118-release-scanner | unknown-key-19 | PASS |  |
| v118-release-scanner | unknown-key-20 | PASS |  |
| v118-release-scanner | unknown-key-21 | PASS |  |
| v118-release-scanner | unknown-key-22 | PASS |  |
| v118-release-scanner | unknown-key-23 | PASS |  |
| v118-release-scanner | unknown-key-24 | PASS |  |
| v118-release-scanner | unknown-key-25 | PASS |  |
| v118-release-scanner | unknown-key-26 | PASS |  |
| v118-release-scanner | unknown-key-27 | PASS |  |
| v118-release-scanner | unknown-key-28 | PASS |  |
| v118-release-scanner | unknown-key-29 | PASS |  |
| v118-release-scanner | unknown-key-30 | PASS |  |
| v118-release-scanner | unknown-key-31 | PASS |  |
| v118-release-scanner | unknown-key-32 | PASS |  |
| v118-release-scanner | unknown-key-33 | PASS |  |
| v118-release-scanner | unknown-key-34 | PASS |  |
| v118-release-scanner | unknown-key-35 | PASS |  |
| v118-release-scanner | unknown-key-36 | PASS |  |
| v118-release-scanner | unknown-key-37 | PASS |  |
| v118-release-scanner | unknown-key-38 | PASS |  |
| v118-release-scanner | unknown-key-39 | PASS |  |
| v118-release-scanner | unknown-key-40 | PASS |  |
| v118-release-scanner | unknown-key-41 | PASS |  |
| v118-release-scanner | unknown-key-42 | PASS |  |
| v118-release-scanner | unknown-key-43 | PASS |  |
| v118-release-scanner | unknown-key-44 | PASS |  |
| v118-release-scanner | unknown-key-45 | PASS |  |
| v118-release-scanner | unknown-key-46 | PASS |  |
| v118-release-scanner | unknown-key-47 | PASS |  |
| v118-release-scanner | unknown-key-48 | PASS |  |
| v118-release-scanner | unknown-key-49 | PASS |  |
| v118-release-scanner | unknown-key-50 | PASS |  |
| v118-release-scanner | unknown-key-51 | PASS |  |
| v118-release-scanner | unknown-key-52 | PASS |  |
| v118-release-scanner | unknown-key-53 | PASS |  |
| v118-release-scanner | unknown-key-54 | PASS |  |
| v118-release-scanner | unknown-key-55 | PASS |  |
| v118-release-scanner | unknown-key-56 | PASS |  |
| v118-release-scanner | unknown-key-57 | PASS |  |
| v118-release-scanner | unknown-key-58 | PASS |  |
| v118-release-scanner | unknown-key-59 | PASS |  |
| v118-release-scanner | unknown-key-60 | PASS |  |
| v118-release-scanner | unknown-key-61 | PASS |  |
| v118-release-scanner | unknown-key-62 | PASS |  |
| v118-release-scanner | unknown-key-63 | PASS |  |
| v118-release-scanner | foreign-module-00 | PASS |  |
| v118-release-scanner | foreign-module-01 | PASS |  |
| v118-release-scanner | foreign-module-02 | PASS |  |
| v118-release-scanner | foreign-module-03 | PASS |  |
| v118-release-scanner | foreign-module-04 | PASS |  |
| v118-release-scanner | foreign-module-05 | PASS |  |
| v118-release-scanner | foreign-module-06 | PASS |  |
| v118-release-scanner | foreign-module-07 | PASS |  |
| v118-release-scanner | foreign-module-08 | PASS |  |
| v118-release-scanner | foreign-module-09 | PASS |  |
| v118-release-scanner | foreign-module-10 | PASS |  |
| v118-release-scanner | foreign-module-11 | PASS |  |
| v118-release-scanner | foreign-module-12 | PASS |  |
| v118-release-scanner | foreign-module-13 | PASS |  |
| v118-release-scanner | foreign-module-14 | PASS |  |
| v118-release-scanner | foreign-module-15 | PASS |  |
| v118-release-scanner | foreign-module-16 | PASS |  |
| v118-release-scanner | foreign-module-17 | PASS |  |
| v118-release-scanner | foreign-module-18 | PASS |  |
| v118-release-scanner | foreign-module-19 | PASS |  |
| v118-release-scanner | foreign-module-20 | PASS |  |
| v118-release-scanner | foreign-module-21 | PASS |  |
| v118-release-scanner | foreign-module-22 | PASS |  |
| v118-release-scanner | foreign-module-23 | PASS |  |
| v118-release-scanner | bare-name-no-context | PASS |  |
| v118-release-scanner | unlisted-predicate-ambiguous | PASS |  |
| v118-release-scanner | diagnostic-negation-not | PASS |  |
| v118-release-scanner | wrap-property-01 | PASS |  |
| v118-release-scanner | wrap-property-02 | PASS |  |
| v118-release-scanner | wrap-property-03 | PASS |  |
| v118-release-scanner | wrap-property-04 | PASS |  |
| v118-release-scanner | wrap-property-05 | PASS |  |
| v118-release-scanner | wrap-property-06 | PASS |  |
| v118-release-scanner | wrap-property-07 | PASS |  |
| v118-release-scanner | runtime-byte-evidence_authoring.py | PASS |  |
| v118-release-scanner | runtime-byte-a2_prepare.py | PASS |  |
| v118-release-scanner | runtime-byte-a2_verify.py | PASS |  |
| v118-release-scanner | runtime-byte-evidence_store.py | PASS |  |
| v118-release-scanner | runtime-authority-ast | PASS |  |
| v118-release-scanner | receipt-ten-fields | PASS |  |
| v118-release-scanner | history-v1 | PASS |  |
| v118-release-scanner | history-v1.1 | PASS |  |
| v118-release-scanner | history-v1.2 | PASS |  |
| v118-release-scanner | history-v1.3 | PASS |  |
| v118-release-scanner | history-v1.4 | PASS |  |
| v118-release-scanner | history-v1.5 | PASS |  |
| v118-release-scanner | history-v1.6 | PASS |  |
| v118-release-scanner | history-v1.7 | PASS |  |
| v118-release-scanner | history-v1.8 | PASS |  |
| v118-release-scanner | history-v1.9 | PASS |  |
| v118-release-scanner | history-v1.10 | PASS |  |
| v118-release-scanner | history-v1.11 | PASS |  |
| v118-release-scanner | history-v1.12 | PASS |  |
| v118-release-scanner | history-v1.13 | PASS |  |
| v118-release-scanner | history-v1.14 | PASS |  |
| v118-release-scanner | history-v1.15 | PASS |  |
| v118-release-scanner | history-v1.16 | PASS |  |
| v118-release-scanner | history-v1.17 | PASS |  |
| determinism | vectors_rerun_identical | PASS |  |
| determinism | evidence record ids recompute | PASS |  |
| determinism | no_bytecode_cache_written | PASS |  |
| v1.5-attack | F15-01 MAJOR raw failure qualifies through fabricated successful parse facts (= M-RAW) | PASS |  |
| v1.5-attack | F15-02 BLOCKER capability/refreeze content forgery under the real active digest | PASS |  |
| v1.5-attack | F15-03 BLOCKER degraded H0/S0 passes early write eligibility (= M-H0) | PASS |  |
| v1.5-attack | F15-04 BLOCKER default direct commit path omits schema validation | PASS |  |
| v1.5-attack | F15-05 MAJOR protected property completeness claimed but unrepresentable | PASS |  |
| v1.5-attack | F15-06 MAJOR verification can claim an unapplied ghost operation | PASS |  |
| v1.5-attack | F15-07 MAJOR transaction lifecycle precedence (mandatory checkpoint) (= M-PRECEDENCE) | PASS |  |
| v1.5-attack | M-ID no occurrence-identity evidence contract | PASS |  |
| v1.5-attack | m-TYPE heuristic expectations | PASS |  |
| v1.5-attack | shim containment (probe-tool compromise) | PASS |  |
| v1.5-attack | stale parser / stale spec / stale matrix replay | PASS |  |
| v1.5-attack | inherited v1.4/v1.5 attacks still closed | PASS |  |
| cache-law | no authority cache in authority_lib is keyed on id(), object identity or a caller container | PASS |  |
| cache-law | every cache key is derived by content_key/content_digest and carries the authority version | PASS |  |
| cache-law | an unserializable input yields no cache key at all (fail-closed: recompute, never reuse) | PASS |  |
| cache-law | clear_authority_caches empties every registered cache and authority_cache_stats reports them | PASS |  |
| cache-mutation | control: the untouched chain is QUALIFIED_CALLABLE both cold and warm | PASS |  |
| cache-mutation | raw capture mutated in place to RAISED after qualification: warm result equals cold result and both are NOT QUALIFIED | PASS | before=QUALIFIED_CALLABLE warm=UNQUALIFIED cold=UNQUALIFIED equal=True |
| cache-mutation | primitive spec expectation edited in place: warm result equals cold result and both are NOT QUALIFIED | PASS | before=QUALIFIED_CALLABLE warm=UNQUALIFIED cold=UNQUALIFIED equal=True |
| cache-mutation | review decision flipped to REJECT in place: warm result equals cold result and both are NOT QUALIFIED | PASS | before=QUALIFIED_CALLABLE warm=UNQUALIFIED cold=UNQUALIFIED equal=True |
| cache-mutation | refreeze record un-reviewed in place: warm result equals cold result and both are NOT QUALIFIED | PASS | before=QUALIFIED_CALLABLE warm=UNQUALIFIED cold=UNQUALIFIED equal=True |
| cache-mutation | active matrix row demoted in place: warm result equals cold result and both are NOT QUALIFIED | PASS | before=QUALIFIED_CALLABLE warm=UNQUALIFIED cold=UNQUALIFIED equal=True |
| cache-mutation | stored derived result edited in place: warm result equals cold result and both are NOT QUALIFIED | PASS | before=QUALIFIED_CALLABLE warm=UNQUALIFIED cold=UNQUALIFIED equal=True |
| cache-mutation | capture host_name changed in place: warm result equals cold result and both are NOT QUALIFIED | PASS | before=QUALIFIED_CALLABLE warm=UNQUALIFIED cold=UNQUALIFIED equal=True |
| cache-mutation | capture build changed in place: warm result equals cold result and both are NOT QUALIFIED | PASS | before=QUALIFIED_CALLABLE warm=UNQUALIFIED cold=UNQUALIFIED equal=True |
| cache-mutation | matrix evidence reference repointed in place: warm result equals cold result and both are NOT QUALIFIED | PASS | before=QUALIFIED_CALLABLE warm=UNQUALIFIED cold=UNQUALIFIED equal=True |
| cache-mutation | parser identity: replacing derive_capability_result changes parser_sha256 immediately (the memo is keyed on the live code, not on a process flag) | PASS |  |
| cache-mutation | callable_method_set: mutating one capture in place drops exactly that method, warm and cold alike | PASS |  |
| cache-mutation | two evidence sets evaluated in one warm process do not contaminate each other | PASS |  |
| validator-injection | control: the tampered commit manifest is refused by the internally pinned schema registry | PASS |  |
| validator-injection | commit_eligibility refuses an always-true callback positionally and stays INELIGIBLE | PASS | ['commit INELIGIBLE: schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): 1 extra positional argument(s) (v1.6 accepted a caller-supplied schema validator in this position). Schemas are resolved internally from the  |
| validator-injection | commit_eligibility refuses an always-true callback as a schema_validate keyword | PASS | ["commit INELIGIBLE: schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): keyword 'schema_validate' (a known validator/override keyword). Schemas are resolved internally from the pinned SCHEMA-REGISTRY.json for this |
| validator-injection | validate_transaction_set refuses an always-true callback | PASS | ['schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): 1 extra positional argument(s) (v1.6 accepted a caller-supplied schema validator in this position). Schemas are resolved internally from the pinned SCHEMA-REGIS |
| validator-injection | commit_eligibility refuses an always-empty callback positionally and stays INELIGIBLE | PASS | ['commit INELIGIBLE: schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): 1 extra positional argument(s) (v1.6 accepted a caller-supplied schema validator in this position). Schemas are resolved internally from the  |
| validator-injection | commit_eligibility refuses an always-empty callback as a schema_validate keyword | PASS | ["commit INELIGIBLE: schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): keyword 'schema_validate' (a known validator/override keyword). Schemas are resolved internally from the pinned SCHEMA-REGISTRY.json for this |
| validator-injection | validate_transaction_set refuses an always-empty callback | PASS | ['schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): 1 extra positional argument(s) (v1.6 accepted a caller-supplied schema validator in this position). Schemas are resolved internally from the pinned SCHEMA-REGIS |
| validator-injection | commit_eligibility refuses a partial callback that only validates snapshots positionally and stays INELIGIBLE | PASS | ['commit INELIGIBLE: schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): 1 extra positional argument(s) (v1.6 accepted a caller-supplied schema validator in this position). Schemas are resolved internally from the  |
| validator-injection | commit_eligibility refuses a partial callback that only validates snapshots as a schema_validate keyword | PASS | ["commit INELIGIBLE: schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): keyword 'schema_validate' (a known validator/override keyword). Schemas are resolved internally from the pinned SCHEMA-REGISTRY.json for this |
| validator-injection | validate_transaction_set refuses a partial callback that only validates snapshots | PASS | ['schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): 1 extra positional argument(s) (v1.6 accepted a caller-supplied schema validator in this position). Schemas are resolved internally from the pinned SCHEMA-REGIS |
| validator-injection | commit_eligibility refuses a permissive wrong schema positionally and stays INELIGIBLE | PASS | ['commit INELIGIBLE: schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): 1 extra positional argument(s) (v1.6 accepted a caller-supplied schema validator in this position). Schemas are resolved internally from the  |
| validator-injection | commit_eligibility refuses a permissive wrong schema as a schema_validate keyword | PASS | ["commit INELIGIBLE: schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): keyword 'schema_validate' (a known validator/override keyword). Schemas are resolved internally from the pinned SCHEMA-REGISTRY.json for this |
| validator-injection | validate_transaction_set refuses a permissive wrong schema | PASS | ['schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): 1 extra positional argument(s) (v1.6 accepted a caller-supplied schema validator in this position). Schemas are resolved internally from the pinned SCHEMA-REGIS |
| validator-injection | commit_eligibility refuses the real validator supplied by the caller positionally and stays INELIGIBLE | PASS | ['commit INELIGIBLE: schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): 1 extra positional argument(s) (v1.6 accepted a caller-supplied schema validator in this position). Schemas are resolved internally from the  |
| validator-injection | commit_eligibility refuses the real validator supplied by the caller as a schema_validate keyword | PASS | ["commit INELIGIBLE: schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): keyword 'schema_validate' (a known validator/override keyword). Schemas are resolved internally from the pinned SCHEMA-REGISTRY.json for this |
| validator-injection | validate_transaction_set refuses the real validator supplied by the caller | PASS | ['schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): 1 extra positional argument(s) (v1.6 accepted a caller-supplied schema validator in this position). Schemas are resolved internally from the pinned SCHEMA-REGIS |
| validator-injection | commit_eligibility refuses the 'validator' keyword by name | PASS |  |
| validator-injection | commit_eligibility refuses the 'schema_validator' keyword by name | PASS |  |
| validator-injection | commit_eligibility refuses the 'registry' keyword by name | PASS |  |
| validator-injection | commit_eligibility refuses the 'callable_set' keyword by name | PASS |  |
| validator-injection | commit_eligibility refuses the 's0_override' keyword by name | PASS |  |
| validator-injection | the diagnostic helper is marked INTERNAL_NON_AUTHORIZING and returns no eligibility a caller could mistake for one | PASS |  |
| validator-injection | a stale schema from the frozen v1.6 bundle validates v1.6 artifacts only and can never be resolved for the active authority | PASS |  |
| schema-registry | the registry is pinned for exactly this authority version and re-derives its own digest | PASS |  |
| schema-registry | every schema file on disk is pinned by content digest and byte count | PASS |  |
| schema-registry | an unregistered artifact schema id is a refusal, never a pass | PASS |  |
| schema-registry | ONE changed byte in ONE pinned schema file makes the whole registry untrusted and nothing can be validated | PASS | schema registry not trusted: resolveSnapshot: schema file bytes do not hash to the pinned digest; resolveSnapshot: schem |
| schema-registry | a tampered registry record is refused (field set / self digest) | PASS | SCHEMA-REGISTRY.json field set is not the canonical schema-registry field set |
| shim-trust | the bundle pins exactly one trusted capture shim and it re-verifies against the shim source on disk | PASS |  |
| shim-trust | the trusted shim pins the allowlist, the codec and the raw schema version | PASS |  |
| shim-trust | the ACTIVE authority names the trusted shim, and an active authority without it authorizes nothing | PASS |  |
| shim-trust | a capture claiming the right shim version with a wrong sha is refused by the trusted-shim law and derives SHIM_UNTRUSTED | PASS | SHIM_UNTRUSTED: capture_shim_sha256 000000000000... is not the trusted caf310438232... |
| shim-trust | a capture from a stale shim build is refused by the trusted-shim law and derives SHIM_UNTRUSTED | PASS | SHIM_UNTRUSTED: capture_shim_sha256 fdec41d62304... is not the trusted caf310438232... |
| shim-trust | a capture from an unknown shim is refused by the trusted-shim law and derives SHIM_UNTRUSTED | PASS | SHIM_UNTRUSTED: capture_shim_version 'someone.elses.shim.v9' is not the trusted 'vidtoolz.captureShim.refe |
| shim-trust | a capture from the same shim version with changed code is refused by the trusted-shim law and derives SHIM_UNTRUSTED | PASS | SHIM_UNTRUSTED: capture_shim_sha256 8727f1fb7bed... is not the trusted caf310438232... |
| shim-trust | a capture emitted under another codec is refused by the trusted-shim law and derives MALFORMED | PASS | MALFORMED: serialization codec 'vidtoolz.someOtherCodec.v1' is not the trusted 'vidtoolz.resolvePyVal |
| shim-trust | a capture emitted under another raw frame schema is refused by the trusted-shim law (and by the structure law before it) | PASS |  |
| shim-trust | a capture of a method outside the trusted allowlist is refused | PASS |  |
| shim-trust | SHIM_UNTRUSTED is a closed derived class in the FATAL_TARGET_FAILURE family | PASS |  |
| shim-trust | a whole chain over a wrong-shim capture cannot qualify (v1.6 promoted it) | PASS |  |
| stored-chain | attached-evidence-derived-artifact-missing: refused, and the refusal names the substituted link | PASS | DERIVED_ARTIFACT_MISSING: the chain claims a DERIVED_CAPABILITY_RESULT that this evidence set does not contain; a missing derived artifact is never replaced by  |
| stored-chain | attached-evidence-derived-artifact-of-other-raw: refused, and the refusal names the substituted link | PASS | DERIVED_ARTIFACT_MISSING: the chain claims a DERIVED_CAPABILITY_RESULT that this evidence set does not contain; a missing derived artifact is never replaced by  |
| stored-chain | attached-evidence-duplicate-current-review: refused, and the refusal names the substituted link | PASS | REVIEW: 2 current candidates (385151a5864e, 8e557c1b0cfd); an explicit supersession is required and insertion order never decides; REVIEW_CONFLICT: no single cu |
| stored-chain | attached-evidence-conflicting-current-reviews: refused, and the refusal names the substituted link | PASS | REVIEW_CONFLICT: a current review of this raw capture references a different derived digest; the conflict must be resolved by explicit supersession |
| stored-chain | attached-evidence-duplicate-current-refreeze: refused, and the refusal names the substituted link | PASS | REFREEZE: 2 current candidates (e6270426b5a3, fc9b3f431938); an explicit supersession is required and insertion order never decides; REFREEZE_CONFLICT: no singl |
| stored-chain | two reviews resolve deterministically when the second explicitly supersedes the first, and the entry must then name the surviving one | PASS | REVIEW_SUBSTITUTED: the current review is not the review the entry names |
| stored-chain | supersession_resolve never uses insertion order: none/one/many are NONE/CURRENT/CONFLICT | PASS |  |
| stored-chain | a supersession cycle resolves to nothing, never to an arbitrary winner | PASS |  |
| stored-chain | a promoted row binds the exact stored chain: raw, stored derived record, review, refreeze block, probe/session, trusted shim, parser and spec | PASS |  |
| stored-chain | the honest chain resolves completely and yields a chain digest over the exact stored identities | PASS |  |
| stored-chain | an entry that does not bind derived_record_sha256 cannot resolve a chain | PASS |  |
| stored-chain | an entry that does not bind refreeze_block_sha256 cannot resolve a chain | PASS |  |
| stored-chain | an entry that does not bind session_id cannot resolve a chain | PASS |  |
| stored-chain | an entry that does not bind capture_shim_sha256 cannot resolve a chain | PASS |  |
| stored-chain | an entry that does not bind trusted_shim_sha256 cannot resolve a chain | PASS |  |
| stored-chain | naming a derived record id that does not exist is DERIVED_ARTIFACT_SUBSTITUTED, never a silent recomputation | PASS |  |
| identity-duplicates | control: three distinct paths with distinct ids over three passes claim A, B and C | PASS |  |
| identity-duplicates | the same receiver path observed twice with different ids: refused before any index is built, and no claim survives | PASS | ['pass 0: DUPLICATE_RECEIVER_PATH: track1/item1 observed by observations 0 and 1'] A=False B=False C=False |
| identity-duplicates | the same receiver path under two different handle tokens: refused before any index is built, and no claim survives | PASS | ['pass 0: DUPLICATE_RECEIVER_PATH: track1/item1 observed by observations 0 and 1'] A=False B=False C=False |
| identity-duplicates | the same receiver path returning two different ids: refused before any index is built, and no claim survives | PASS | ['pass 0: DUPLICATE_RECEIVER_PATH: track1/item1 observed by observations 0 and 1'] A=False B=False C=False |
| identity-duplicates | two observations sharing one getter attempt id: refused before any index is built, and no claim survives | PASS | ['pass 0: DUPLICATE_ATTEMPT_ID: probe:1 used by observations 0 and 1'] A=False B=False C=False |
| identity-duplicates | two distinct paths returning ONE id: uniqueness fails and stability is not claimed either (v1.6 claimed stability) | PASS |  |
| identity-duplicates | the claim input of one pass is an ordered list of every observation, so nothing can overwrite anything | PASS |  |
| identity-duplicates | a pass observing a different receiver-path set cannot support a stability claim | PASS |  |
| raw-ingestion | control: honest frame BYTES ingest to a record whose digest and strict-parse receipt both close | PASS |  |
| raw-ingestion | a duplicate JSON key is refused at the byte boundary as DUPLICATE_JSON_KEY | PASS | DUPLICATE_JSON_KEY (expected DUPLICATE_JSON_KEY) |
| raw-ingestion | malformed UTF-8 is refused at the byte boundary as MALFORMED_UTF8 | PASS | MALFORMED_UTF8 (expected MALFORMED_UTF8) |
| raw-ingestion | trailing garbage after the object is refused at the byte boundary as TRAILING_BYTES | PASS | TRAILING_BYTES (expected TRAILING_BYTES) |
| raw-ingestion | a second JSON object in one frame is refused at the byte boundary as MULTIPLE_JSON_VALUES | PASS | MULTIPLE_JSON_VALUES (expected MULTIPLE_JSON_VALUES) |
| raw-ingestion | invalid number syntax is refused at the byte boundary as STRUCTURE_INVALID | PASS | STRUCTURE_INVALID (expected STRUCTURE_INVALID) |
| raw-ingestion | the non-finite constant NaN is refused at the byte boundary as NON_FINITE_NUMBER | PASS | NON_FINITE_NUMBER (expected NON_FINITE_NUMBER) |
| raw-ingestion | a raw control character is refused at the byte boundary as CONTROL_CHARACTER | PASS | CONTROL_CHARACTER (expected CONTROL_CHARACTER) |
| raw-ingestion | an oversized frame is refused at the byte boundary as FRAME_TOO_LARGE | PASS | FRAME_TOO_LARGE (expected FRAME_TOO_LARGE) |
| raw-ingestion | a UTF-8 byte order mark is refused at the byte boundary as BOM_PRESENT | PASS | BOM_PRESENT (expected BOM_PRESENT) |
| raw-ingestion | an unknown raw schema version is refused at the byte boundary as UNKNOWN_SCHEMA_VERSION | PASS | UNKNOWN_SCHEMA_VERSION (expected UNKNOWN_SCHEMA_VERSION) |
| raw-ingestion | a top-level array instead of an object is refused at the byte boundary as NOT_A_JSON_OBJECT | PASS | NOT_A_JSON_OBJECT (expected NOT_A_JSON_OBJECT) |
| raw-ingestion | an empty frame is refused at the byte boundary as EMPTY_FRAME | PASS | EMPTY_FRAME (expected EMPTY_FRAME) |
| raw-ingestion | a parsed object instead of bytes is refused at the byte boundary as NOT_BYTES | PASS | NOT_BYTES (expected NOT_BYTES) |
| raw-ingestion | json.loads keeps the LAST duplicate key while the strict parse refuses the frame outright (this is why a parsed object is not authority) | PASS |  |
| raw-ingestion | a RAW_CAPABILITY_CAPTURE record without a strict-parse receipt is inadmissible | PASS |  |
| raw-ingestion | a receipt that does not name this capture's digest is inadmissible | PASS |  |
| raw-ingestion | a receipt that does not assert strict parsing is inadmissible | PASS |  |
| raw-ingestion | the strict-ingestion negative fixtures are replayable frame FILES with pinned byte counts and digests | PASS |  |
| raw-ingestion | replayed fixture honest-frame: ingests cleanly | PASS | got None: ingested |
| raw-ingestion | replayed fixture duplicate-json-key: DUPLICATE_JSON_KEY | PASS | got DUPLICATE_JSON_KEY: DUPLICATE_JSON_KEY: duplicate JSON key at parse boundary: 'method' |
| raw-ingestion | replayed fixture malformed-utf8: MALFORMED_UTF8 | PASS | got MALFORMED_UTF8: MALFORMED_UTF8: 'utf-8' codec can't decode byte 0xff in position 20: invalid start byte |
| raw-ingestion | replayed fixture trailing-bytes: TRAILING_BYTES | PASS | got TRAILING_BYTES: TRAILING_BYTES: ' trailing\n' |
| raw-ingestion | replayed fixture multiple-json-values: MULTIPLE_JSON_VALUES | PASS | got MULTIPLE_JSON_VALUES: MULTIPLE_JSON_VALUES: '{"a":1}' |
| raw-ingestion | replayed fixture invalid-number-syntax: STRUCTURE_INVALID | PASS | got STRUCTURE_INVALID: STRUCTURE_INVALID: Expecting ',' delimiter: line 1 column 1046 (char 1045) |
| raw-ingestion | replayed fixture non-finite-number: NON_FINITE_NUMBER | PASS | got NON_FINITE_NUMBER: NON_FINITE_NUMBER: NaN |
| raw-ingestion | replayed fixture control-character: CONTROL_CHARACTER | PASS | got CONTROL_CHARACTER: CONTROL_CHARACTER: U+0001 at offset 587 |
| raw-ingestion | replayed fixture oversized-frame: FRAME_TOO_LARGE | PASS | got FRAME_TOO_LARGE: FRAME_TOO_LARGE: 1048608 > 1048576 |
| raw-ingestion | replayed fixture byte-order-mark: BOM_PRESENT | PASS | got BOM_PRESENT: BOM_PRESENT: UTF-8 BOM |
| raw-ingestion | replayed fixture unknown-schema-version: UNKNOWN_SCHEMA_VERSION | PASS | got UNKNOWN_SCHEMA_VERSION: UNKNOWN_SCHEMA_VERSION: 'vidtoolz.resolveRawCapabilityCapture.v0' |
| raw-ingestion | replayed fixture top-level-array: NOT_A_JSON_OBJECT | PASS | got NOT_A_JSON_OBJECT: NOT_A_JSON_OBJECT: list |
| raw-ingestion | replayed fixture empty-frame: EMPTY_FRAME | PASS | got EMPTY_FRAME: EMPTY_FRAME: 4 |
| raw-ingestion | replayed fixture digest-mismatch: DIGEST_MISMATCH | PASS | got DIGEST_MISMATCH: DIGEST_MISMATCH: raw_digest does not re-hash the frame content |
| raw-ingestion | every raw capture fixture in the bundle carries a closed strict-parse receipt | PASS |  |
| evidence-boundary-receipt | control: a session on its established boundary verifies clean and reports FINALIZED | PASS |  |
| evidence-boundary-receipt | the SESSION_BOUNDARY receipt is persisted as governed evidence and binds root path, device and inode plus session basename, device and inode (section 1) | PASS |  |
| evidence-boundary-receipt | the boundary identity is part of the session identity tuple, so root identity is bound (section 2) | PASS |  |
| evidence-boundary-receipt | SESSION DIRECTORY REPLACEMENT (Codex S110-1, pinned): the same basename and the same content in a NEW directory is refused SESSION_BOUNDARY_CHANGED. v1.9 verified it clean. | PASS | SESSION_BOUNDARY_CHANGED |
| evidence-boundary-receipt | a boundary-changed session refuses every further authorizing operation | PASS |  |
| evidence-boundary-receipt | ALTERNATE ROOT (Codex S110-1, pinned): the same session basename copied under another root is refused ROOT_IDENTITY_MISMATCH. v1.9 verified it clean. | PASS | ROOT_IDENTITY_MISMATCH: opened under '<TMPROOT><TMPDIR>/ROOT-B' but the receipt was established under '/tmp/resolve- |
| evidence-boundary-receipt | the session in its own root still verifies clean, so the refusal is the root and not the bytes | PASS | clean |
| evidence-boundary-receipt | a boundary receipt with a mutated root inode is refused in the frozen BOUNDARY precedence class | PASS | ROOT_IDENTITY_MISMATCH |
| evidence-boundary-receipt | a boundary receipt with a mutated session inode is refused in the frozen BOUNDARY precedence class | PASS | SESSION_BOUNDARY_CHANGED |
| evidence-boundary-receipt | a boundary receipt with a mutated root path is refused in the frozen BOUNDARY precedence class | PASS | ROOT_REPLACED |
| evidence-boundary-receipt | a boundary receipt with a mutated session basename is refused in the frozen BOUNDARY precedence class | PASS | BOUNDARY_RECEIPT_INVALID |
| evidence-boundary-receipt | a boundary receipt whose own digest no longer re-derives is BOUNDARY_RECEIPT_INVALID | PASS |  |
| evidence-boundary-receipt | restoring the receipt restores a clean verification | PASS |  |
| evidence-boundary-receipt | a deleted boundary receipt is BOUNDARY_RECEIPT_MISSING and blocks everything | PASS |  |
| evidence-boundary-receipt | the boundary detection scope is stated honestly: ordinary replacement is detectable, deliberate device/inode reuse is not claimed (section 6) | PASS |  |
| evidence-boundary-receipt | property test: six randomized replacements of the session directory, a populated layer directory or a symlink insertion are all detected (section 30) | PASS |  |
| evidence-boundary-receipt | DOCUMENTED SCOPE LIMIT (section 30): replacing an EMPTY layer directory with an identical empty one at the same mode is not detected, and is deliberately out of scope because it changes no governed evidence. Only the root and session directory inodes are bound; a populated layer directory is detected through its lost records. | PASS | empty-to-empty layer replacement has no evidentiary consequence; verify clean=True |
| evidence-recomputed-model | control: the untouched session verifies clean with every normative counter zero | PASS |  |
| evidence-recomputed-model | the expected model is rebuilt from independent sources and never reads the stored inventory or marker (section 9/27) | PASS |  |
| evidence-recomputed-model | the inventory field provenance table classifies every normative field and forbids TRUSTED_FROM_INVENTORY_ITSELF (section 8) | PASS |  |
| evidence-recomputed-model | an inventory whose evidence_store_version disagrees with the independently derived model is refused | PASS | FINALIZATION_MARKER_INVALID, INVENTORY_TAMPERED |
| evidence-recomputed-model | an inventory whose authority_version disagrees with the independently derived model is refused | PASS | FINALIZATION_MARKER_INVALID, INVENTORY_TAMPERED |
| evidence-recomputed-model | an inventory whose platform_scope disagrees with the independently derived model is refused | PASS | FINALIZATION_MARKER_INVALID, INVENTORY_TAMPERED |
| evidence-recomputed-model | an inventory whose session_identity_sha256 disagrees with the independently derived model is refused | PASS | FINALIZATION_MARKER_INVALID, INVENTORY_TAMPERED |
| evidence-recomputed-model | an inventory whose boundary_identity_sha256 disagrees with the independently derived model is refused | PASS | FINALIZATION_MARKER_INVALID, INVENTORY_TAMPERED |
| evidence-recomputed-model | an inventory whose boundary_sha256 disagrees with the independently derived model is refused | PASS | FINALIZATION_MARKER_INVALID, INVENTORY_TAMPERED |
| evidence-recomputed-model | an inventory whose mode_table disagrees with the independently derived model is refused | PASS | FINALIZATION_MARKER_INVALID, INVENTORY_TAMPERED |
| evidence-recomputed-model | an inventory whose a record's logical identity disagrees with the independently derived model is refused | PASS | FINALIZATION_MARKER_INVALID, LOGICAL_IDENTITY_MISMATCH |
| evidence-recomputed-model | an inventory whose a record's mode disagrees with the independently derived model is refused | PASS | FINALIZATION_MARKER_INVALID, MODE_MISMATCH |
| evidence-recomputed-model | an inventory whose a record's layer disagrees with the independently derived model is refused | PASS | FINALIZATION_MARKER_INVALID, LAYER_IDENTITY_MISMATCH |
| evidence-recomputed-model | an inventory whose a record's attempt ids disagrees with the independently derived model is refused | PASS | FINALIZATION_MARKER_INVALID, INVENTORY_TAMPERED |
| evidence-recomputed-model | a duplicate directory path is refused before any index is built | PASS | FINALIZATION_MARKER_INVALID, INVENTORY_DUPLICATE_KEY |
| evidence-recomputed-model | a directory with a conflicting kind is refused before any index is built | PASS | FINALIZATION_MARKER_INVALID, INVENTORY_TAMPERED |
| evidence-recomputed-model | a directory with a conflicting mode is refused before any index is built | PASS | FINALIZATION_MARKER_INVALID, MODE_MISMATCH |
| evidence-recomputed-model | a duplicate entry path is refused before any index is built | PASS | FINALIZATION_MARKER_INVALID, INVENTORY_DUPLICATE_KEY |
| evidence-recomputed-model | a layer directory represented twice is refused before any index is built | PASS | FINALIZATION_MARKER_INVALID, INVENTORY_DUPLICATE_KEY |
| evidence-recomputed-model | the session verifies clean after every inventory attack is reverted | PASS | clean |
| evidence-finalization-fields | finalization marker with a mutated session_id is refused (v1.9 ignored the store and authority versions) | PASS | FINALIZATION_MARKER_INVALID |
| evidence-finalization-fields | finalization marker with a mutated session identity digest is refused (v1.9 ignored the store and authority versions) | PASS | FINALIZATION_MARKER_INVALID |
| evidence-finalization-fields | finalization marker with a mutated boundary identity digest is refused (v1.9 ignored the store and authority versions) | PASS | FINALIZATION_MARKER_INVALID |
| evidence-finalization-fields | finalization marker with a mutated inventory digest is refused (v1.9 ignored the store and authority versions) | PASS | FINALIZATION_MARKER_INVALID |
| evidence-finalization-fields | finalization marker with a mutated evidence store version is refused (v1.9 ignored the store and authority versions) | PASS | FINALIZATION_MARKER_INVALID |
| evidence-finalization-fields | finalization marker with a mutated authority version is refused (v1.9 ignored the store and authority versions) | PASS | FINALIZATION_MARKER_INVALID |
| evidence-finalization-fields | finalization marker with a mutated platform scope is refused (v1.9 ignored the store and authority versions) | PASS | FINALIZATION_MARKER_INVALID |
| evidence-finalization-fields | finalization marker with a mutated finalization schema is refused (v1.9 ignored the store and authority versions) | PASS | FINALIZATION_MARKER_INVALID |
| evidence-finalization-fields | finalization marker with a mutated state is refused (v1.9 ignored the store and authority versions) | PASS | FINALIZATION_MARKER_INVALID |
| evidence-finalization-fields | a finalization marker missing a normative field is refused (no field is ignored) | PASS |  |
| evidence-finalization-fields | the session verifies clean after every finalization attack is reverted | PASS | clean |
| evidence-attempt-derivation | FOREIGN ATTEMPT MARKER (Codex S110-3, pinned): a marker from another session planted into an ACTIVE session is refused, and it blocks the next write BEFORE finalization. v1.9 accepted write, finalize and verify. | PASS | FOREIGN_ATTEMPT_MARKER |
| evidence-attempt-derivation | removing the foreign marker restores an ACTIVE session that can finalize | PASS |  |
| evidence-attempt-derivation | a marker claiming a record that does not exist is FOREIGN_ATTEMPT_MARKER | PASS | FOREIGN_ATTEMPT_MARKER |
| evidence-attempt-derivation | a record with no attempt marker is ORPHANED_RECORD | PASS | ORPHANED_RECORD, UNEXPECTED_ENTRY |
| evidence-attempt-derivation | attempt ids are unique in addition to attempt keys (section 11): a second marker reusing one attempt id under another identity is refused | PASS |  |
| evidence-attempt-derivation | property test: eight randomized single-field mutations of a stored attempt marker all fail reconciliation (section 31) | PASS |  |
| evidence-attempt-derivation | cross-session ACTIVE insertion: a foreign session manifest makes the next canonical operation refuse (section 28) | PASS | SESSION_INVALID |
| evidence-attempt-derivation | cross-session ACTIVE insertion: a foreign boundary receipt makes the next canonical operation refuse (section 28) | PASS | SESSION_BOUNDARY_CHANGED |
| evidence-attempt-derivation | cross-session ACTIVE insertion: a foreign record makes the next canonical operation refuse (section 28) | PASS | SESSION_INVALID |
| evidence-attempt-derivation | cross-session ACTIVE insertion: a foreign attempt marker makes the next canonical operation refuse (section 28) | PASS | SESSION_INVALID |
| evidence-attempt-derivation | the target session is ACTIVE again once every foreign artifact is removed | PASS | clean |
| evidence-mode-authority | the mode table derives expected modes per KIND, including the session directory (sections 17/21) | PASS |  |
| evidence-mode-authority | FINALIZED chmod of the SESSION DIRECTORY (v1.9 ignored it) is detected as MODE_MISMATCH | PASS | MODE_MISMATCH: session directory mode 0o777 != 0o700 |
| evidence-mode-authority | FINALIZED chmod of a layer directory is detected as MODE_MISMATCH | PASS | MODE_MISMATCH: directory RAW (LAYER_DIRECTORY) mode 0o777 != expected 0o700 |
| evidence-mode-authority | FINALIZED chmod of a shard directory is detected as MODE_MISMATCH | PASS | MODE_MISMATCH: directory AUTHORITY_PROMOTION/d0 (SHARD_DIRECTORY) mode 0o777 != expected 0o700 |
| evidence-mode-authority | FINALIZED chmod of the attempts directory is detected as MODE_MISMATCH | PASS | MODE_MISMATCH: directory ATTEMPTS (ATTEMPTS_DIRECTORY) mode 0o750 != expected 0o700 |
| evidence-mode-authority | FINALIZED chmod of a stored record is detected as MODE_MISMATCH | PASS | MODE_MISMATCH: AUTHORITY_PROMOTION/d0/<SHA256>.json (RECORD) mode 0o666 != expected  |
| evidence-mode-authority | FINALIZED chmod of an attempt marker is detected as MODE_MISMATCH | PASS | MODE_MISMATCH: ATTEMPTS/sess-mode:1003 (ATTEMPT_MARKER) mode 0o644 != expected 0o400 |
| evidence-mode-authority | FINALIZED chmod of the session manifest is detected as MODE_MISMATCH | PASS | MODE_MISMATCH: SESSION.json (SESSION_MANIFEST) mode 0o666 != expected 0o444 |
| evidence-mode-authority | FINALIZED chmod of the boundary receipt is detected as MODE_MISMATCH | PASS | MODE_MISMATCH: BOUNDARY.json (BOUNDARY_RECEIPT) mode 0o666 != expected 0o444 |
| evidence-mode-authority | FINALIZED chmod of the journal is detected as MODE_MISMATCH | PASS | MODE_MISMATCH: JOURNAL.ndjson (JOURNAL) mode 0o644 != expected 0o600 |
| evidence-mode-authority | FINALIZED chmod of the inventory is detected as MODE_MISMATCH | PASS | MODE_MISMATCH: INVENTORY.json (INVENTORY) mode 0o666 != expected 0o444 |
| evidence-mode-authority | FINALIZED chmod of the finalization marker is detected as MODE_MISMATCH | PASS | MODE_MISMATCH: FINALIZED (FINALIZATION_MARKER) mode 0o666 != expected 0o444 |
| evidence-mode-authority | the finalized session verifies clean once every mode is restored | PASS | clean |
| evidence-mode-authority | ACTIVE chmod of the session directory refuses the next canonical operation (v1.9 allowed it) | PASS | MODE_MISMATCH |
| evidence-mode-authority | ACTIVE chmod of a layer directory refuses the next canonical operation (v1.9 allowed it) | PASS | SESSION_INVALID |
| evidence-mode-authority | ACTIVE chmod of the session manifest refuses the next canonical operation (v1.9 allowed it) | PASS | SESSION_INVALID |
| evidence-mode-authority | ACTIVE chmod of a record refuses the next canonical operation (v1.9 allowed it) | PASS | SESSION_INVALID |
| evidence-mode-authority | ACTIVE chmod of an attempt marker refuses the next canonical operation (v1.9 allowed it) | PASS | SESSION_INVALID |
| evidence-mode-authority | ACTIVE chmod of the journal refuses the next canonical operation (v1.9 allowed it) | PASS | SESSION_INVALID |
| evidence-mode-authority | an ACTIVE session with drifted modes cannot finalize, and recovers once restored | PASS |  |
| evidence-mode-authority | property test: eight randomized permission-bit flips across governed entry classes are detected in both ACTIVE and FINALIZED states (section 32) | PASS |  |
| evidence-fs-errors | one normalization boundary maps errno to frozen FS_* classes and nothing else leaks (section 24) | PASS |  |
| evidence-fs-errors | EACCES on a governed directory becomes a frozen class, not a raw PermissionError (v1.9 leaked one) | PASS | SESSION_INVALID |
| evidence-fs-errors | a symlink loop as the evidence root is a frozen class | PASS |  |
| evidence-fs-errors | a missing session and a missing root are frozen classes | PASS |  |
| evidence-fs-errors | a regular file used as an evidence root is a frozen class | PASS |  |
| evidence-fs-errors | an over-long identifier is a frozen class rather than ENAMETOOLONG | PASS |  |
| evidence-fs-errors | a session that disappears between operations is a frozen class, not a traceback | PASS |  |
| evidence-fs-errors | no public store entry point lets a raw OSError escape: every os call goes through the fs() boundary | PASS |  |
| evidence-boundary-fields | every BOUNDARY.json field is classified with EXACTLY ONE provenance class and no field is unclassified (section 1) | PASS | DERIVED_FROM_FILESYSTEM,DERIVED_FROM_SESSION_AUTHORITY,FROZEN_CONSTANT,INFORMATIONAL_NON_AUTHORIZING |
| evidence-boundary-fields | the four FROZEN_CONSTANT receipt fields are exactly the ones bound to a constant of THIS authority (sections 2-5) | PASS |  |
| evidence-boundary-fields | created_at is explicitly and deliberately classified INFORMATIONAL_NON_AUTHORIZING (section 6, option A) | PASS |  |
| evidence-boundary-fields | the attack matrix covers EVERY receipt field: the twelve normative ones plus the one informational field, with nothing skipped (section 8) | PASS | complete |
| evidence-boundary-fields | F110-A pinned: receipt field authority_version (FROZEN_CONSTANT) rewritten with a recomputed boundary_sha256 refuses the next canonical operation. v1.10 accepted schema, evidence_store_version, authority_version and platform_scope. | PASS | BOUNDARY_RECEIPT_INVALID: authority_version='1.10.0' is not the frozen FROZEN_CONSTANT '1.18.0' of this ev |
| evidence-boundary-fields | F110-A pinned: receipt field boundary_sha256 (DERIVED_FROM_SESSION_AUTHORITY) rewritten with a recomputed boundary_sha256 refuses the next canonical operation. v1.10 accepted schema, evidence_store_version, authority_version and platform_scope. | PASS | BOUNDARY_RECEIPT_INVALID: boundary_sha256 is not the digest of this receipt |
| evidence-boundary-fields | F110-A pinned: receipt field evidence_store_version (FROZEN_CONSTANT) rewritten with a recomputed boundary_sha256 refuses the next canonical operation. v1.10 accepted schema, evidence_store_version, authority_version and platform_scope. | PASS | BOUNDARY_RECEIPT_INVALID: evidence_store_version='vidtoolz.resolveEvidenceStore.v4' is not the frozen FROZ |
| evidence-boundary-fields | F110-A pinned: receipt field platform_scope (FROZEN_CONSTANT) rewritten with a recomputed boundary_sha256 refuses the next canonical operation. v1.10 accepted schema, evidence_store_version, authority_version and platform_scope. | PASS | BOUNDARY_RECEIPT_INVALID: platform_scope='WINDOWS' is not the frozen FROZEN_CONSTANT 'POSIX' of this evide |
| evidence-boundary-fields | F110-A pinned: receipt field root_device (DERIVED_FROM_FILESYSTEM) rewritten with a recomputed boundary_sha256 refuses the next canonical operation. v1.10 accepted schema, evidence_store_version, authority_version and platform_scope. | PASS | ROOT_IDENTITY_MISMATCH: <TMPROOT><TMPDIR> is not the root this session was established |
| evidence-boundary-fields | F110-A pinned: receipt field root_inode (DERIVED_FROM_FILESYSTEM) rewritten with a recomputed boundary_sha256 refuses the next canonical operation. v1.10 accepted schema, evidence_store_version, authority_version and platform_scope. | PASS | ROOT_IDENTITY_MISMATCH: <TMPROOT><TMPDIR> is not the root this session was established |
| evidence-boundary-fields | F110-A pinned: receipt field root_path (DERIVED_FROM_FILESYSTEM) rewritten with a recomputed boundary_sha256 refuses the next canonical operation. v1.10 accepted schema, evidence_store_version, authority_version and platform_scope. | PASS | ROOT_REPLACED: /somewhere/else no longer exists |
| evidence-boundary-fields | F110-A pinned: receipt field schema (FROZEN_CONSTANT) rewritten with a recomputed boundary_sha256 refuses the next canonical operation. v1.10 accepted schema, evidence_store_version, authority_version and platform_scope. | PASS | BOUNDARY_RECEIPT_INVALID: schema='vidtoolz.resolveEvidenceBoundary.vFORGED' is not the frozen FROZEN_CONST |
| evidence-boundary-fields | F110-A pinned: receipt field session_basename (DERIVED_FROM_FILESYSTEM) rewritten with a recomputed boundary_sha256 refuses the next canonical operation. v1.10 accepted schema, evidence_store_version, authority_version and platform_scope. | PASS | BOUNDARY_RECEIPT_INVALID: receipt session_id 'sess-bfields' != session_basename 'other' |
| evidence-boundary-fields | F110-A pinned: receipt field session_device (DERIVED_FROM_FILESYSTEM) rewritten with a recomputed boundary_sha256 refuses the next canonical operation. v1.10 accepted schema, evidence_store_version, authority_version and platform_scope. | PASS | SESSION_BOUNDARY_CHANGED: the session directory is not the one this session was created in |
| evidence-boundary-fields | F110-A pinned: receipt field session_id (DERIVED_FROM_SESSION_AUTHORITY) rewritten with a recomputed boundary_sha256 refuses the next canonical operation. v1.10 accepted schema, evidence_store_version, authority_version and platform_scope. | PASS | BOUNDARY_RECEIPT_INVALID: receipt session_id 'other-session' != session_basename 'sess-bfields' |
| evidence-boundary-fields | F110-A pinned: receipt field session_inode (DERIVED_FROM_FILESYSTEM) rewritten with a recomputed boundary_sha256 refuses the next canonical operation. v1.10 accepted schema, evidence_store_version, authority_version and platform_scope. | PASS | SESSION_BOUNDARY_CHANGED: the session directory is not the one this session was created in |
| evidence-boundary-fields | created_at behaves EXACTLY as its documented informational law: a consistently rewritten created_at does NOT refuse, because nothing outside the receipt can attest it | PASS | NONE |
| evidence-boundary-fields | an UNrecomputed created_at edit is still caught as byte tampering, so the digest still buys integrity over the whole receipt (section 7) | PASS | BOUNDARY_RECEIPT_INVALID |
| evidence-boundary-fields | created_at is outside boundary_identity, so it is outside the session identity too | PASS |  |
| evidence-boundary-fields | structural law: a non-string created_at is refused even with a recomputed digest | PASS | BOUNDARY_RECEIPT_INVALID |
| evidence-boundary-fields | structural law: a non-integer inode is refused even with a recomputed digest | PASS | BOUNDARY_RECEIPT_INVALID |
| evidence-boundary-fields | structural law: an empty root path is refused even with a recomputed digest | PASS | BOUNDARY_RECEIPT_INVALID |
| evidence-boundary-fields | structural law: a receipt whose session_id and session_basename disagree is refused even with a recomputed digest | PASS | BOUNDARY_RECEIPT_INVALID |
| evidence-boundary-fields | L14: an extra semantic field in the receipt is refused; the boundary field set is exact | PASS | BOUNDARY_RECEIPT_INVALID |
| evidence-boundary-fields | L14: a removed normative field in the receipt is refused; the boundary field set is exact | PASS | BOUNDARY_RECEIPT_INVALID |
| evidence-boundary-fields | the untouched session still authorizes and verifies, so every refusal above is the mutation and not the harness | PASS |  |
| evidence-boundary-fields | an ACTIVE v1.10 (Store.v4) receipt cannot authorize under v1.11: the store law changed, so the version pin is a real refusal, not decoration | PASS |  |
| evidence-inventory-fields | the top-level INVENTORY field vocabulary is EXACT and frozen (section 10) | PASS | 23 fields |
| evidence-inventory-fields | EVERY inventory field is accounted for by exactly one reconciliation route: the frozen-property check, the derived-header comparison, mode_table, the entry/directory reconciliations or the digest. Nothing is left self-asserted (self-review 57). | PASS |  |
| evidence-inventory-fields | the frozen total_bytes scope is published and names exactly the entries finalization can count (section 13) | PASS |  |
| evidence-inventory-fields | control: the finalized session verifies clean and its stored inventory carries EXACTLY the frozen vocabulary | PASS | clean |
| evidence-inventory-fields | all six previously self-asserted fields recompute EXACTLY from the independent model and the frozen store layout (sections 11-16) | PASS | records=4 entries=11 attempts=4 bytes=6312 |
| evidence-inventory-fields | F110-B pinned: inventory record_count mutated with a recomputed inventory digest AND an updated finalization reference is refused. v1.10 verified all six clean. | PASS | INVENTORY_TAMPERED |
| evidence-inventory-fields | F110-B pinned: inventory entry_count mutated with a recomputed inventory digest AND an updated finalization reference is refused. v1.10 verified all six clean. | PASS | INVENTORY_TAMPERED |
| evidence-inventory-fields | F110-B pinned: inventory total_bytes mutated with a recomputed inventory digest AND an updated finalization reference is refused. v1.10 verified all six clean. | PASS | INVENTORY_TAMPERED |
| evidence-inventory-fields | F110-B pinned: inventory attempt_count mutated with a recomputed inventory digest AND an updated finalization reference is refused. v1.10 verified all six clean. | PASS | INVENTORY_TAMPERED |
| evidence-inventory-fields | F110-B pinned: inventory self_path mutated with a recomputed inventory digest AND an updated finalization reference is refused. v1.10 verified all six clean. | PASS | INVENTORY_TAMPERED |
| evidence-inventory-fields | F110-B pinned: inventory finalized_marker_path mutated with a recomputed inventory digest AND an updated finalization reference is refused. v1.10 verified all six clean. | PASS | INVENTORY_TAMPERED |
| evidence-inventory-fields | a counter understated by one is refused as well as an overstated one (record_count) | PASS | INVENTORY_TAMPERED |
| evidence-inventory-fields | a counter understated by one is refused as well as an overstated one (entry_count) | PASS | INVENTORY_TAMPERED |
| evidence-inventory-fields | a counter understated by one is refused as well as an overstated one (total_bytes) | PASS | INVENTORY_TAMPERED |
| evidence-inventory-fields | a counter understated by one is refused as well as an overstated one (attempt_count) | PASS | INVENTORY_TAMPERED |
| evidence-inventory-fields | F110-B pinned (section 17): an extra syntactically valid SEMANTIC top-level inventory field, with a recomputed digest and an updated finalization reference, is refused INVENTORY_FIELD_SET_INVALID. v1.10 verified it clean. | PASS | INVENTORY_FIELD_SET_INVALID |
| evidence-inventory-fields | a REMOVED normative inventory field is refused INVENTORY_FIELD_SET_INVALID | PASS | INVENTORY_FIELD_SET_INVALID |
| evidence-inventory-fields | a WRONG-TYPE inventory field is refused (record_count) | PASS | INVENTORY_FIELD_SET_INVALID |
| evidence-inventory-fields | a WRONG-TYPE inventory field is refused (total_bytes) | PASS | INVENTORY_FIELD_SET_INVALID |
| evidence-inventory-fields | a WRONG-TYPE inventory field is refused (self_path) | PASS | INVENTORY_FIELD_SET_INVALID |
| evidence-inventory-fields | a WRONG-TYPE inventory field is refused (entries) | PASS | INVENTORY_FIELD_SET_INVALID |
| evidence-inventory-fields | a WRONG-TYPE inventory field is refused (mode_table) | PASS | INVENTORY_FIELD_SET_INVALID |
| evidence-inventory-fields | a DUPLICATE top-level inventory field is refused at the strict parse boundary, before any field is interpreted | PASS | INVENTORY_TAMPERED |
| evidence-inventory-fields | expected_model() is untouched and still consumes no inventory or finalization claim (section 19: architecture retained) | PASS |  |
| evidence-inventory-fields | the FINALIZATION field set is exact and unchanged from v1.10 (nine normative fields, no marker-format redesign) | PASS |  |
| evidence-inventory-fields | the inventory schema was VERSIONED for the new closed vocabulary rather than silently tightened (v3 -> v4), and the old inventory hash domain is unregistered | PASS |  |
| evidence-inventory-fields | the session still verifies clean after every inventory attack, so each refusal is the mutation | PASS | clean |
| evidence-marker-cardinality | the bijection law is published with EXACT cardinality in both directions (sections 21, 22) | PASS |  |
| evidence-marker-cardinality | F110-C pinned (section 23): a SECOND attempt id over the same session, layer, logical identity and bytes is refused MARKER_CARDINALITY_VIOLATION at the write. v1.10 accepted it, then finalized and verified clean. | PASS | MARKER_CARDINALITY_VIOLATION: attempt 'card-a2' would be a second marker for the record already stored at RAW/e0/e064ab9 |
| evidence-marker-cardinality | the refusal happens BEFORE anything is persisted: no second marker, no second record, no journal-visible ambiguity | PASS | card-a1 |
| evidence-marker-cardinality | the surviving record still has EXACTLY one attempt marker and one attempt key | PASS |  |
| evidence-marker-cardinality | F110-C pinned: a PERSISTED many-to-one state (a second structurally valid marker planted on disk, whose tuple recomputes the same record) is refused by ACTIVE integrity. v1.10 accepted it. | PASS | MARKER_CARDINALITY_VIOLATION, UNEXPECTED_ENTRY |
| evidence-marker-cardinality | the same persisted state blocks finalization and every further write (section 24: the public API and the persisted verifier agree) | PASS |  |
| evidence-marker-cardinality | removing the planted marker restores a clean ACTIVE session, so the refusal is the cardinality and nothing else | PASS | clean |
| evidence-marker-cardinality | a planted twin marker on an ALREADY FINALIZED session is refused by verify() and the session becomes INVALID | PASS | INVENTORY_TAMPERED, MARKER_CARDINALITY_VIOLATION, RECORD_MISSING, UNEXPECTED_ENTRY |
| evidence-marker-cardinality | the finalized session verifies clean again once the twin is gone | PASS | clean |
| evidence-marker-cardinality | RETAINED (section 25): the same attempt tuple with the same bytes is still idempotent and does NOT trip the cardinality guard | PASS |  |
| evidence-marker-cardinality | RETAINED: same bytes under a DIFFERENT logical identity is a legitimately different record, not a cardinality violation | PASS |  |
| evidence-marker-cardinality | RETAINED: same bytes in a DIFFERENT layer is a different record too | PASS |  |
| evidence-marker-cardinality | RETAINED: same tuple different bytes is still refused ATTEMPT_ID_REUSED | PASS |  |
| evidence-marker-cardinality | RETAINED: cross-layer attempt reuse is still refused ATTEMPT_ID_CROSS_LAYER | PASS |  |
| evidence-marker-cardinality | RETAINED: cross-identity attempt reuse is still refused ATTEMPT_ID_CROSS_IDENTITY | PASS |  |
| evidence-marker-cardinality | RETAINED: the one-record-per-marker direction still refuses a FOREIGN marker | PASS | FOREIGN_ATTEMPT_MARKER |
| evidence-marker-cardinality | RETAINED: cardinality ZERO is still ORPHANED_RECORD | PASS | ORPHANED_RECORD, UNEXPECTED_ENTRY |
| evidence-marker-cardinality | the retained-law session finalizes and verifies clean | PASS | clean |
| evidence-marker-cardinality | the M0A package can never emit two attempt ids for one (session, layer, logical identity, content): every prepared caller derives the attempt id from the probe attempt, and the published attempt law says so (section 26) | PASS |  |
| evidence-public-surface | the public authority-bearing method inventory is COMPLETE against dir(EvidenceStore): every public member is classified, by discovery and not by naming convention (section 27) | PASS | complete |
| evidence-public-surface | the four unchecked internals are PRIVATE and the checked public wrappers exist (section 30) | PASS |  |
| evidence-public-surface | the error precedence is frozen with BOUNDARY first (section 33) | PASS |  |
| evidence-public-surface | every public authority-bearing reader either names check_boundary in its own body or delegates to a member that does; there is no unchecked public authority surface left (self-review 59) | PASS | all checked |
| evidence-public-surface | the negative test is built from the DISCOVERED method inventory, not from the five known methods (section 32) | PASS | exact |
| evidence-public-surface | control: on an intact session inventory() still answers SESSION_NOT_FINALIZED when the session simply is not finalized | PASS | SESSION_NOT_FINALIZED |
| evidence-public-surface | F110-D pinned: after session replacement EVERY public authority-bearing method of a FINALIZED session refuses at the BOUNDARY before any other semantic result. v1.10 returned live data from attempts, expected_model, manifest and identity. | PASS | unchecked=- masked=- |
| evidence-public-surface | F110-D pinned: after session replacement EVERY public authority-bearing method of a ACTIVE session refuses at the BOUNDARY before any other semantic result. v1.10 returned live data from attempts, expected_model, manifest and identity. | PASS | unchecked=- masked=- |
| evidence-public-surface | F110-D pinned (section 29): inventory() on a replaced session answers the BOUNDARY refusal and no longer MASKS it with SESSION_NOT_FINALIZED | PASS | SESSION_BOUNDARY_CHANGED |
| evidence-public-surface | finalization_marker() has the same corrected precedence | PASS | SESSION_BOUNDARY_CHANGED |
| evidence-public-surface | record_path() is the only public non-authority surface and it reads no session content (it derives a path under store law) | PASS |  |
| evidence-public-surface | the module-level entry points still establish or re-check the boundary (create_session, open_session) | PASS |  |
| evidence-provenance | self-review 56: there is NO boundary field that is stored and digested but not independently compared, except the one deliberately classified informational | PASS | none |
| evidence-provenance | self-review 57: every normative inventory field the provenance table classifies as derived is named in the verifier's comparison source | PASS | none |
| evidence-provenance | self-review 58: the marker grouping logic has no accepted path with more than one marker per record: both the write guard and the model guard are present | PASS |  |
| evidence-provenance | the PUBLISHED provenance document agrees with the executable authority in every table, so the document can never again claim an unperformed derivation | PASS |  |
| evidence-provenance | every verifier_binding entry names a real attribute of the evidence store, so the published binding is checkable and not prose | PASS |  |
| evidence-provenance | the boundary source vocabulary is exactly the four required classes and TRUSTED_FROM_INVENTORY_ITSELF is still forbidden | PASS |  |
| property | boundary receipt: 24 seeded single-field mutations of normative fields, each with a recomputed digest, all refuse in the BOUNDARY class (seed 20261020) | PASS | all refused |
| property | inventory header: 24 seeded counter perturbations, each with a recomputed inventory digest and an updated finalization reference, all refuse (seed 20261020) | PASS | all refused |
| property | marker cardinality: 8 seeded sessions over random bytes and identities all refuse the second attempt id and all finalize with exactly one marker per record (seed 20261020) | PASS | all refused |
| property | public-surface ordering: 6 seeded replaced sessions (ACTIVE and FINALIZED) x 6 sampled methods each refuse at the BOUNDARY first (seed 20261020) | PASS | all refused |
| evidence-closed-world | control: the retained-regression session verifies clean | PASS | clean |
| evidence-closed-world | STORE-14 still closed: an unexpected file in the finalized session root is refused | PASS | UNEXPECTED_ENTRY |
| evidence-closed-world | still closed: an unexpected nested file invalidates the session | PASS | UNEXPECTED_ENTRY |
| evidence-closed-world | still closed: an unexpected directory invalidates the session | PASS | UNEXPECTED_ENTRY |
| evidence-closed-world | an internal symlink is still SYMLINK_REJECTED | PASS |  |
| evidence-closed-world | a FIFO inside a session is still FILE_TYPE_REJECTED | PASS |  |
| evidence-closed-world | post-finalization writes are still refused on every layer | PASS |  |
| evidence-closed-world | the retained session verifies clean after every regression attack | PASS | clean |
| evidence-session-identity | session rename is still refused (now by the persisted boundary as well as the path law) | PASS |  |
| evidence-session-identity | renaming it back restores a clean verification | PASS |  |
| evidence-attempt-tuple | public API retained: same tuple same bytes is idempotent | PASS |  |
| evidence-attempt-tuple | public API retained: same tuple different bytes is refused ATTEMPT_ID_REUSED | PASS |  |
| evidence-attempt-tuple | public API retained: same id different layer is refused ATTEMPT_ID_CROSS_LAYER | PASS |  |
| evidence-attempt-tuple | public API retained: same id different identity is refused ATTEMPT_ID_CROSS_IDENTITY | PASS |  |
| evidence-attempt-tuple | public API retained: no logical identity is refused LOGICAL_IDENTITY_INVALID | PASS |  |
| evidence-attempt-tuple | the attempt session finalizes and verifies clean | PASS | clean |
| evidence-single-authority | exactly one module is still EVIDENCE_STORE_AUTHORIZING and no boundary helper became a second store (section 33) | PASS |  |
| evidence-single-authority | the write API still exposes no path parameter and content addressing is retained | PASS |  |
| evidence-traversal | legacy traversal still closed across every entry point, and nothing appears outside the session root | PASS |  |
| evidence-store | partial state retained: a stray temp file makes the session PARTIAL and blocks finalization | PASS |  |
| evidence-store | the store still never truncates, renames over or unlinks a final record | PASS |  |
| evidence-store | the session manifest still pins the active authority and refuses a mismatch | PASS |  |
| canonicalization-equivalence | canon() is byte-identical to the v1.5/v1.6 reference implementation over the whole bundle and an adversarial corpus | PASS |  |
| canonicalization-equivalence | canon() and the reference agree on refusing float '1.5' | PASS | [('err', 'CanonError'), ('err', 'CanonError')] |
| canonicalization-equivalence | canon() and the reference agree on refusing int '9007199254740992' | PASS | [('err', 'CanonError'), ('err', 'CanonError')] |
| canonicalization-equivalence | canon() and the reference agree on refusing str '\ud800' | PASS | [('err', 'CanonError'), ('err', 'CanonError')] |
| canonicalization-equivalence | canon() and the reference agree on refusing object '<object object a' | PASS | [('err', 'CanonError'), ('err', 'CanonError')] |
| canonicalization-equivalence | CANONICALIZATION_VERSION is unchanged: v1.7 changes the implementation, never the canonical text | PASS |  |
| matrix-forgery-warm | warm cache: the honest matrix qualifies, then every forged variant is refused without clearing the cache | PASS |  |
| matrix-forgery-warm | warm cache: one changed byte of the matrix (coverage_caveat) revokes qualification immediately | PASS |  |
| matrix-forgery-warm | warm cache: one changed byte of the matrix (version) revokes qualification immediately | PASS |  |
| matrix-forgery-warm | warm cache: qualifying a matrix and then editing that same object in place revokes qualification | PASS |  |
| matrix-forgery-warm | no cache pollution: after the whole warm sequence the honest chain still qualifies and a cold process agrees | PASS |  |
| v17-retained | the M0 phase model M0A/M0B/M0C/M0D is unchanged | PASS |  |
| v17-retained | the H0 early write gate is still evaluated inside evaluate_eligibility, before any mutator | PASS |  |
| v17-retained | the composed commit design is retained minus the caller-supplied validator | PASS |  |
| v17-retained | the v1.6 precedence corrections are unchanged (S32-S38 and the single journal-state authority) | PASS |  |
| v17-retained | the protected-surface exclusion set is unchanged | PASS |  |
| codex-matrix | the inherited v1.8 evidence-store matrix is retained unchanged and still enumerates S19-1..S19-4 | PASS |  |
| codex-matrix | the inherited v1.7 evidence-store matrix is retained unchanged as history and still enumerates ES-1 and ES-2 | PASS |  |
| codex-matrix | the inherited v1.6 finding matrix is retained unchanged as history and its seven ids are still enumerated | PASS |  |
| codex-matrix | Store.v5 carries NO semantic change in v1.16: evidence_store.py differs from the v1.15 bundle by exactly one comment line and every semantic constant is identical | PASS | one comment line |
| codex-matrix | the inherited v1.12 workflow matrix is retained unchanged and still enumerates V112-1..V112-4 | PASS |  |
| codex-matrix | the inherited v1.11 evidence-store matrix is retained unchanged and still enumerates F110-A..F110-D | PASS |  |
| codex-matrix | the inherited v1.9 evidence-store matrix is retained unchanged and still enumerates S110-1..S110-5 | PASS |  |
| codex-matrix | the ACTIVE v1.16 finding-resolution matrix enumerates exactly Codex's two v1.15 release findings | PASS |  |
| codex-matrix | the v1.16 matrix records the 54/57 harness result, the one BLOCKER and one MERGE MAJOR, the frozen v1.15 reproduction head, and that every executable v1.15 repair was confirmed CLOSED | PASS |  |
| codex-matrix | each v1.16 finding carries Codex's exact evidence: the key paths, the current values, the reproduction against the frozen parent and the affected gates | PASS |  |
| codex-matrix | the v1.16 matrix records that the exhaustive invariant surfaced FOUR further stale statements Codex had not named, and that the provisional pair kept its class | PASS |  |
| codex-matrix | the inherited v1.15 matrix is retained unchanged and still enumerates the six V114 findings against the frozen v1.14 head | PASS |  |
| codex-matrix | the markdown matrix mirrors the machine form: both ids, every validation section they name, the exact key paths and the still-open residual | PASS |  |
| codex-matrix | the inherited v1.15 matrix still records its four-BLOCKER/one-MAJOR/one-MINOR adjudication and the essential consumed-bytes law | PASS |  |
| codex-matrix | both v1.16 findings pin their reproduction against the frozen v1.15 head and carry the severities Codex assigned | PASS |  |
| codex-matrix | the inherited v1.14 matrix is retained unchanged and still enumerates V113-B1 against the frozen v1.13 head | PASS |  |
| codex-matrix | the inherited v1.15 markdown matrix is retained unchanged and still mirrors its own machine form | PASS |  |
| codex-matrix | the inherited v1.14 matrix still records Codex's 93/96 result and its own MINOR | PASS |  |
| codex-matrix | the inherited v1.13 governed-root matrix is retained unchanged and still enumerates V112-RP1 against the frozen v1.12 head | PASS |  |
| codex-matrix | the inherited v1.14 markdown matrix is retained unchanged and still mirrors its own machine form | PASS |  |
| codex-matrix | the inherited v1.12 matrix still records the AUTHORITY_UNDERSPECIFIED classification and its protected-surface promise | PASS |  |
| codex-matrix | the inherited v1.11 matrix still pins its reproduction against the frozen v1.10 head | PASS |  |
| codex-matrix | every validation section the ACTIVE v1.11 matrix names actually EXISTS: a published coverage claim that resolves to no checks is exactly the defect class F110-A and F110-B were | PASS | all present |
| codex-matrix | V115-B1: correction, negative fixture and expected layer are named, and its validation sections all pass | PASS | 16 checks; failing=[] |
| codex-matrix | V115-M1: correction, negative fixture and expected layer are named, and its validation sections all pass | PASS | 17 checks; failing=[] |
| m0a-binding | every Hermes M0A binding value is published and none is a placeholder | PASS |  |
| m0a-binding | published authority_version is the value this bundle actually implements | PASS | published=1.18.0 actual=1.18.0 |
| m0a-binding | published capture_allowlist_digest is the value this bundle actually implements | PASS | published=ead63126d6e4032f2854f16d actual=ead63126d6e4032f2854f16d |
| m0a-binding | published codec_version is the value this bundle actually implements | PASS | published=vidtoolz.resolvePyValue. actual=vidtoolz.resolvePyValue. |
| m0a-binding | published evidence_inventory_schema is the value this bundle actually implements | PASS | published=vidtoolz.resolveEvidence actual=vidtoolz.resolveEvidence |
| m0a-binding | published evidence_session_schema is the value this bundle actually implements | PASS | published=vidtoolz.resolveEvidence actual=vidtoolz.resolveEvidence |
| m0a-binding | published evidence_store_authority_class is the value this bundle actually implements | PASS | published=EVIDENCE_STORE_AUTHORIZI actual=EVIDENCE_STORE_AUTHORIZI |
| m0a-binding | published evidence_store_module is the value this bundle actually implements | PASS | published=tools/evidence_store.py actual=tools/evidence_store.py |
| m0a-binding | published evidence_store_sha256 is the value this bundle actually implements | PASS | published=6364535417489c26e2f0911a actual=6364535417489c26e2f0911a |
| m0a-binding | published evidence_store_version is the value this bundle actually implements | PASS | published=vidtoolz.resolveEvidence actual=vidtoolz.resolveEvidence |
| m0a-binding | published path_identifier_constraints is the value this bundle actually implements | PASS | published=^[A-Za-z0-9][A-Za-z0-9._ actual=^[A-Za-z0-9][A-Za-z0-9._ |
| m0a-binding | published primitive_spec_sha256 is the value this bundle actually implements | PASS | published=3a7d7241316297ecc9fb5ba2 actual=3a7d7241316297ecc9fb5ba2 |
| m0a-binding | published raw_ingest_version is the value this bundle actually implements | PASS | published=vidtoolz.resolveRawInges actual=vidtoolz.resolveRawInges |
| m0a-binding | published raw_schema_id is the value this bundle actually implements | PASS | published=vidtoolz.resolveRawCapab actual=vidtoolz.resolveRawCapab |
| m0a-binding | published raw_schema_version is the value this bundle actually implements | PASS | published=1.10 actual=1.10 |
| m0a-binding | published reference_parser_sha256 is the value this bundle actually implements | PASS | published=01a39890a27deecdefd4b173 actual=01a39890a27deecdefd4b173 |
| m0a-binding | published reference_parser_version is the value this bundle actually implements | PASS | published=vidtoolz.resolveProbePar actual=vidtoolz.resolveProbePar |
| m0a-binding | published schema_registry_sha256 is the value this bundle actually implements | PASS | published=03470248942c11a75247ca56 actual=03470248942c11a75247ca56 |
| m0a-binding | published trusted_shim_sha256 is the value this bundle actually implements | PASS | published=caf310438232c65d010942a4 actual=caf310438232c65d010942a4 |
| m0a-binding | published trusted_shim_source_sha256 is the value this bundle actually implements | PASS | published=4132e5bd30339d68cd80c2bb actual=4132e5bd30339d68cd80c2bb |
| m0a-binding | published trusted_shim_version is the value this bundle actually implements | PASS | published=vidtoolz.captureShim.ref actual=vidtoolz.captureShim.ref |
| m0a-binding | the published closed-world verification rule is stated and names the three required counts (section 22) | PASS |  |
| m0a-binding | the published canonical store tool path and hash are the store this bundle actually ships | PASS |  |
| m0a-binding | the published evidence-layer vocabulary is the store's own | PASS |  |
| m0a-binding | the stdout/stderr retention rule is closed and matches the evidence store | PASS |  |
| required-check-plan | actual check IDs equal required check IDs | PASS | [] |
