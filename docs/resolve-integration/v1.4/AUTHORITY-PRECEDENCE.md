# AUTHORITY-PRECEDENCE.md (v1.4, FROZEN_NOW)

Machine form: `AUTHORITY-PRECEDENCE.json`. Law: when two frozen statements conflict, the entry here decides. A HISTORICAL document is never an implementation authority. Implementers read `MILESTONES.md`, `PERMISSIONS.json`, `ELIGIBILITY.md`, `M0-PROBE-CONTRACT.md`, `TARGET-ATTACHMENT-GATE.md`, `SNAPSHOT-COMPLETENESS.md`, `GUARD-AUTHORITY.md`, `CANONICALIZATION.md`, `DRIFT-POLICY.md`, `REVIEW-MARKER-POLICY.md` and the schemas; they do not need to guess.

## Documents

| Path | Status | Reason |
|---|---|---|
| `README.md` | STILL_ACTIVE | current |
| `AUTHORIZATION-2026-09-08.md` | STILL_ACTIVE | current |
| `DOCTRINE.md` | STILL_ACTIVE | current |
| `TRANSPORT.md` | STILL_ACTIVE | current |
| `ELIGIBILITY.md` | STILL_ACTIVE | current |
| `TARGET-ATTACHMENT-GATE.md` | STILL_ACTIVE | current |
| `SNAPSHOT-COMPLETENESS.md` | STILL_ACTIVE | current |
| `GUARD-AUTHORITY.md` | STILL_ACTIVE | current |
| `CANONICALIZATION.md` | STILL_ACTIVE | current |
| `IDENTITY-BINDING.md` | STILL_ACTIVE | current |
| `SNAPSHOT-CONCURRENCY-RECOVERY.md` | STILL_ACTIVE | current |
| `DRIFT-POLICY.md` | STILL_ACTIVE | current |
| `REVIEW-MARKER-POLICY.md` | STILL_ACTIVE | current |
| `SEMANTIC-VALIDATION.md` | STILL_ACTIVE | current |
| `CANARIES.md` | STILL_ACTIVE | current |
| `MILESTONES.md` | STILL_ACTIVE | current |
| `M3-MATRIX.md` | STILL_ACTIVE | current |
| `SCORECRAFT-EXTRACTION.md` | STILL_ACTIVE | current |
| `CLIENT-VERSION-INVENTORY.md` | STILL_ACTIVE | current |
| `PROVISIONAL.md` | STILL_ACTIVE | current |
| `AUTHORITY-PRECEDENCE.md` | STILL_ACTIVE | current |
| `M0-PROBE-CONTRACT.md` | STILL_ACTIVE | current |
| `CHANGELOG-v1.4.md` | STILL_ACTIVE | current |
| `FINDING-RESOLUTION-MATRIX-v1.4.md` | STILL_ACTIVE | current |
| `CHANGELOG-v1.3.md` | HISTORICAL | v1.3 history |
| `FINDING-RESOLUTION-MATRIX-v1.3.md` | HISTORICAL | v1.3 finding map; v1.4 map is FINDING-RESOLUTION-MATRIX-v1.4.md |
| `CHANGELOG-v1.2.md` | HISTORICAL | v1.2 history |
| `FINDING-RESOLUTION-MATRIX-v1.2.md` | HISTORICAL | v1.2 finding map; v1.3 map is FINDING-RESOLUTION-MATRIX-v1.3.md |
| `VALIDATION-REPORT.md` | STILL_ACTIVE | generated report; not normative |
| `CHANGELOG-v1.1.md` | HISTORICAL | v1.1 history |
| `FINDING-RESOLUTION-MATRIX.md` | HISTORICAL | v1.1 finding map; v1.2 map is FINDING-RESOLUTION-MATRIX-v1.2.md |
| `ADJUDICATION-FREEZE-CONTRACT.md` | HISTORICAL | 2026-09-08 three-way adjudication; input to v1.0; several sections superseded (see superseded_statements) |
| `AUTHORITY-ARCHITECTURE-ADJUDICATION-M0-M3.md` | HISTORICAL | input to v1.1; M0 definition and marker wording superseded |

## Superseded statements

| Id | Old authority | New authority | Status | Effective | Reason |
|---|---|---|---|---|---|
| S1 | ADJUDICATION-FREEZE-CONTRACT.md#10 (M0: 'any Resolve call beyond --dump-tools' forbidden; M0 = static inventory only) | `MILESTONES.md#M0` | SUPERSEDED | 1.1.0 | v1.1/v1.2 M0 is a read-only connection/observation milestone gated by TARGET-ATTACHMENT-GATE.md and ELIGIBILITY.md; the static inventory became bundle v1.0 itself |
| S2 | ADJUDICATION-FREEZE-CONTRACT.md#5.2, #6 (payload_sha256 / 'H0 = payload digest' as the version token) | `GUARD-AUTHORITY.md` | SUPERSEDED | 1.1.0 | composite guard digest (model A) is the version token; payload digest proves content only |
| S3 | ADJUDICATION-FREEZE-CONTRACT.md#5.2 snapshot context wording ('target_contract_digest', 'target epoch' inside snapshot envelope hash) | `schemas/resolveSnapshot.schema.json; SNAPSHOT-COMPLETENESS.md` | SUPERSEDED | 1.2.0 | v1.2 snapshot carries coverage profile, per-field observation status, guard digest and hash domains |
| S4 | ADJUDICATION-FREEZE-CONTRACT.md#7, #10, #16 (milestone table and refreeze wording; v1.1 M3-MATRIX '18 probes') | `MILESTONES.md; M3-MATRIX.md; M3-PROBES.json` | SUPERSEDED | 1.2.0 | v1.2 milestone boundaries are machine-checked against PERMISSIONS.json (MILESTONE-MATRIX.json); M3 has 19 probes P1-P19 and P0 is an M0 preflight |
| S5 | ADJUDICATION-FREEZE-CONTRACT.md#7 M9 row and AUTHORITY-ARCHITECTURE-ADJUDICATION-M0-M3.md ('markers -> review notes with target_domain from colour/name') | `REVIEW-MARKER-POLICY.md` | SUPERSEDED | 1.1.0 | markers locate candidates only; dispositions require human attestation |
| S6 | ADJUDICATION-FREEZE-CONTRACT.md#5.5 and v1.0 SNAPSHOT-CONCURRENCY-RECOVERY.md drift table (IMPORT_OVERRIDE; STALE_ASSET vs 'newer handoff') | `DRIFT-POLICY.md; schemas/provisional/resolveConflict.schema.json` | SUPERSEDED | 1.1.0 | PROPOSE_REVIEW_NOTE; STALE_ASSET vs EF canonical head |
| S7 | v1.1 PERMISSIONS.json entries with prose 'evidence_prerequisite' only | `PERMISSIONS.json; ELIGIBILITY.md; tools/authority_lib.py#evaluate_eligibility` | SUPERSEDED | 1.2.0 | declaration vs eligibility split; machine-evaluable prerequisites |
| S8 | v1.1 CAPABILITIES.json rows with evidence_class QUALIFIED_READ citing scripts | `CAPABILITIES.json#evidence_records` | SUPERSEDED | 1.2.0 | no exact evidence exists on 21.1.0 build 14; rows downgraded |
| S9 | v1.1 CANONICALIZATION.md marker sort key (object_address, frame, custom_data, name, color) | `CANONICALIZATION.md#3` | SUPERSEDED | 1.2.0 | total order incl. duration and note; (object_address, frame) collision rejection |
| S10 | v1.1 SCORECRAFT-EXTRACTION.md ('guards exist only in the hardlink fixture') | `SCORECRAFT-EXTRACTION.md` | SUPERSEDED | 1.2.0 | guards also exist in scorecraft-resolve-driver.py and scorecraft-resolve-production-fixture.py; production driver still lacks one |

Retired terms (must not appear in STILL_ACTIVE documents except the exempt list): `IMPORT_OVERRIDE`, `--dump-tools`, `18 probes`, `resolveSnapshot.v1.1`, `canonicalization_version: 1.1`, `QUALIFIED_READ (inspect row)`.
| S11 | v1.2 ELIGIBILITY.md / evaluate_eligibility(perms, request, read_primitives, capabilities) trusting request.target.attachment_state, capability_state, evidence strings, journal_available, guard_available, authorization_token | `ELIGIBILITY.md; TARGET-ATTACHMENT-GATE.md; schemas/resolveEligibilityRequest.schema.json; schemas/resolveEvidenceSet.schema.json; tools/authority_lib.py#evaluate_eligibility` | SUPERSEDED | 1.3.0 | evaluator consumes frozen authorities + content-addressed evidence; state and qualification derived, never declared |
| S12 | v1.2 TARGET-CONTRACT.json attachment_state / attachment_evidence fields and TARGET-ATTACHMENT-GATE.md evidence-field table | `TARGET-ATTACHMENT-GATE.md; TARGET-CONTRACT.json; tools/authority_lib.py#derive_attachment_state` | SUPERSEDED | 1.3.0 | attachment state is a function of (contract, evidence set); declared state is schema-invalid |
| S13 | v1.2 PERMISSIONS.json/READ-PRIMITIVES.json without target requirements (CONNECT and other M0 ops accepted any project name) | `PERMISSIONS.json; READ-PRIMITIVES.json; MILESTONE-MATRIX.json; ELIGIBILITY.md` | SUPERSEDED | 1.3.0 | operation-specific target_requirement SESSION/PROJECT/PROJECT_TIMELINE with binding observations |
| S14 | v1.2 READ_PRIMITIVE_QUALIFICATION_PROBE described only as PROBE_ONLY fallback; QUALIFIED_READ assertable by request | `M0-PROBE-CONTRACT.md; CAPABILITIES.json; READ-PRIMITIVES.json` | SUPERSEDED | 1.3.0 | PROBE_ALLOWED != QUALIFIED_READ; probe_candidate/probe_allowed flags; candidate evidence; reviewed refreeze required |
| S15 | v1.2 SNAPSHOT-COMPLETENESS.md (status on 5 identity fields only; items sorted by numeric end; complete:false without reasons) and resolveSnapshot.v1.2 / resolveSnapshotPayload.v1.2 domain | `SNAPSHOT-COMPLETENESS.md; CANONICALIZATION.md; schemas/resolveSnapshot.schema.json` | SUPERSEDED | 1.3.0 | status on all frame/identity fields; status-aware order; failure ledger; incomplete_reasons; per-profile completeness incl. WRITE_PRECHECK fail-closed |
| S16 | v1.2 CANONICALIZATION.md §2 $f64 validation via prefix match; v1.2 SEMANTIC-VALIDATION.md per-document checks without cross-artifact binding; v1.2 commit checker trusting verification by hash | `CANONICALIZATION.md; SEMANTIC-VALIDATION.md; tools/authority_lib.py#validate_transaction_set` | SUPERSEDED | 1.3.0 | fullmatch f64; binding tuple across plan/journal/verification/conflict/commit; composed commit validation; linked-set validator |
| S17 | v1.2 M3-PROBES.json/M3-MATRIX.md P15 "identity stable across rename/save/reopen"; v1.2 SCORECRAFT-EXTRACTION.md referring to resolveTargetContract.v1.1 / resolveSnapshot.v1.1 as extraction targets; v1.2 manifest validation without byte counts | `M3-PROBES.json; M3-MATRIX.md; SCORECRAFT-EXTRACTION.md; schemas/resolveFreezeManifest.schema.json` | SUPERSEDED | 1.3.0 | rename claim removed (option B); active references v1.3; byte-count equality |

## Retired terms (v1.3 additions)

`resolveSnapshot.v1.2`, `canonicalization_version: 1.2`, `target_attachment_state`, `capability_state`, `journal_available`, `authorization_token`, `attachment_evidence`, `attachment_state:` — must not appear in STILL_ACTIVE documents except the exempt list in `AUTHORITY-PRECEDENCE.json` (history/changelog/matrix/report, and `ELIGIBILITY.md`/`PROVISIONAL.md`, which name them only as retired).
| S18 | v1.3 evidence records tagged only with a target {host_name, library_name}; BUNDLE_VERIFICATION matched by authority_version alone (any manifest sha); latest CONNECTION_OBSERVATION / binding chosen by record position (conns[-1], pb[-1], tb[-1]); no session identity | `schemas/resolveEvidenceSet.schema.json; TARGET-CONTRACT.json; TARGET-ATTACHMENT-GATE.md; tools/authority_lib.py#derive_attachment_state` | SUPERSEDED | 1.4.0 | envelope law (level BUNDLE/LIBRARY/SESSION), exact active-manifest binding, current_session_id + sequence-based currency with AMBIGUOUS/STALE, coherence -> CONFLICT; no positional selection |
| S19 | v1.3 CAPABILITY_EVIDENCE record (method, host, resolve_version, build, observed_result, evidence_sha256, reviewed_refreeze_version string) and primitive_status accepting any linked record with a non-null reviewed_refreeze_version; probe failures recorded as observed_result 'FAILED:' strings | `CAPABILITIES.json; READ-PRIMITIVES.json; M0-PROBE-CONTRACT.md; tools/authority_lib.py#capability_record_qualifies` | SUPERSEDED | 1.4.0 | QUALIFIED_CALLABLE requires active matrix row + reviewed refreeze block + linked SUCCESS record with exact receiver/host/product/version/build, reviewed ACCEPT, promotion by the active authority version and matrix sha, RAW_EVIDENCE re-hashing; failure taxonomy CAPABILITY_FAILURE / FATAL_TARGET_FAILURE |
| S20 | v1.3 resolveSnapshot.v1.3 timeline block with mandatory numeric start_frame/end_frame/width/height/start_timecode (status only on identity); MINIMAL_M0 fixture built from probe-enumerated tracks; payload domain vidtoolz.resolveSnapshotPayload.v1.3 | `schemas/resolveSnapshot.schema.json; SNAPSHOT-COMPLETENESS.md; CANONICALIZATION.md` | SUPERSEDED | 1.4.0 | status on every timeline/project/track/item field, nullable values, capability->coverage coupling, pre-qualification capture defined; payload domain v1.4 |
| S21 | v1.3 guard v1 (vidtoolz.resolveGuard.v1: project/timeline identity without observation status or reason) | `GUARD-AUTHORITY.md; schemas/resolveGuard.schema.json` | SUPERSEDED | 1.4.0 | guard v2 carries unique_id_status, unique_id_reason, name_status; UNAVAILABLE != ERROR; policy.capability_matrix_sha256 |
| S22 | v1.3 journal law: APPLIED with any operation_id (uniqueness only), PREFLIGHT_OK/CHECKPOINTED -> APPLIED directly, no operation_set_digest in records | `schemas/provisional/resolveTransactionJournal.schema.json; SEMANTIC-VALIDATION.md; tools/authority_lib.py#semantic_journal` | SUPERSEDED | 1.4.0 | operation membership against the bound plan (id + op type), OP_STARTED -> APPLIED | OP_FAILED lifecycle, READBACK_S1 after all applied, operation_set_digest in every record |
| S23 | v1.3 verification and commit trusting declared added/removed/unrelated/missing_expected lists and s1_guard_digest / readback_snapshot_sha256 strings | `schemas/provisional/resolveVerificationResult.schema.json; schemas/provisional/resolveCommitManifest.schema.json; SEMANTIC-VALIDATION.md; tools/authority_lib.py#verify_transaction` | SUPERSEDED | 1.4.0 | S0/S1 resolved by digest and lineage, delta derived, expected effects (provisional APPEND law), declared result must equal derived truth; commit binds s1_guard_digest |
| S24 | v1.3 validate_transaction_set over {plan, journal, verification, commit, conflicts} without S0/S1 | `tools/authority_lib.py#validate_transaction_set; SEMANTIC-VALIDATION.md` | SUPERSEDED | 1.4.0 | composed S0 -> plan -> journal -> S1 -> derived delta -> expected effect -> verification -> commit; no commit-by-hash shortcut |

## Retired terms (v1.4 additions)

`resolveSnapshot.v1.3`, `canonicalization_version: 1.3`, `target.host_name` (v1.3 record target tag; replaced by the envelope), `conns[-1]` (positional latest-record selection) — must not appear in STILL_ACTIVE documents except the exempt list in `AUTHORITY-PRECEDENCE.json`.
