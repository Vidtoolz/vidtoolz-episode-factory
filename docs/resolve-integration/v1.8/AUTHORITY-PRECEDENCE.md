# AUTHORITY-PRECEDENCE.md (v1.6, FROZEN_NOW)

Machine form: `AUTHORITY-PRECEDENCE.json`. Law: when two frozen statements conflict, the entry here decides. A HISTORICAL document is never an implementation authority. Implementers read `MILESTONES.md`, `PERMISSIONS.json`, `ELIGIBILITY.md`, `M0-PROBE-CONTRACT.md`, `M0-PHASES.md`, `RAW-CAPTURE.md`, `CAPTURE-SHIM.md`, `REFERENCE-PARSER.md`, `PRIMITIVE-SPEC.md`, `REVIEW-REFREEZE.md`, `IDENTITY-EVIDENCE.md`, `EVIDENCE-ROOT.md`, `TARGET-ATTACHMENT-GATE.md`, `SNAPSHOT-COMPLETENESS.md`, `GUARD-AUTHORITY.md`, `CANONICALIZATION.md`, `DRIFT-POLICY.md`, `REVIEW-MARKER-POLICY.md`, `THREAT-MODEL.md` and the schemas; they do not need to guess.

**Journal-state enumeration authority (v1.6):** only `SEMANTIC-VALIDATION.md` and `tools/authority_lib.py#JOURNAL_TRANSITIONS` enumerate transaction journal states. The validator's `precedence` section fails if any other STILL_ACTIVE document enumerates them.

## Documents

| Path | Status | Reason |
|---|---|---|
| `ADJUDICATION-FREEZE-CONTRACT.md` | HISTORICAL | 2026-09-08 three-way adjudication; input to v1.0; several sections superseded (see superseded_statements) |
| `AUTHORITY-ARCHITECTURE-ADJUDICATION-M0-M3.md` | HISTORICAL | input to v1.1; M0 definition and marker wording superseded |
| `AUTHORITY-PRECEDENCE.md` | STILL_ACTIVE | current normative or reference document |
| `AUTHORIZATION-2026-09-08.md` | STILL_ACTIVE | current normative or reference document |
| `CANARIES.md` | STILL_ACTIVE | current normative or reference document |
| `CANONICALIZATION.md` | STILL_ACTIVE | current normative or reference document |
| `CAPTURE-SHIM.md` | STILL_ACTIVE | current normative or reference document (v1.6) |
| `CHANGELOG-v1.1.md` | HISTORICAL | v1.1 history |
| `CHANGELOG-v1.2.md` | HISTORICAL | v1.2 history |
| `CHANGELOG-v1.3.md` | HISTORICAL | v1.3 history |
| `CHANGELOG-v1.4.md` | HISTORICAL | v1.4 history |
| `CHANGELOG-v1.5.md` | HISTORICAL | v1.5 history |
| `CHANGELOG-v1.6.md` | STILL_ACTIVE | current normative or reference document (v1.6) |
| `CLIENT-VERSION-INVENTORY.md` | STILL_ACTIVE | current normative or reference document |
| `DOCTRINE.md` | STILL_ACTIVE | current normative or reference document |
| `DRIFT-POLICY.md` | STILL_ACTIVE | current normative or reference document |
| `ELIGIBILITY.md` | STILL_ACTIVE | current normative or reference document |
| `EVIDENCE-ROOT.md` | STILL_ACTIVE | current normative or reference document (v1.6) |
| `FINDING-RESOLUTION-MATRIX-v1.2.md` | HISTORICAL | v1.2 history; v1.3 map is FINDING-RESOLUTION-MATRIX-v1.3.md |
| `FINDING-RESOLUTION-MATRIX-v1.3.md` | HISTORICAL | v1.3 finding map; v1.4 map is FINDING-RESOLUTION-MATRIX-v1.4.md |
| `FINDING-RESOLUTION-MATRIX-v1.4.md` | HISTORICAL | v1.4 finding map; v1.5 map is FINDING-RESOLUTION-MATRIX-v1.5.md |
| `FINDING-RESOLUTION-MATRIX-v1.5.md` | HISTORICAL | v1.5 finding map; v1.6 map is FINDING-RESOLUTION-MATRIX-v1.6.md |
| `FINDING-RESOLUTION-MATRIX-v1.6.md` | STILL_ACTIVE | current normative or reference document (v1.6) |
| `FINDING-RESOLUTION-MATRIX.md` | HISTORICAL | v1.1 finding map; v1.2 map is FINDING-RESOLUTION-MATRIX-v1.2.md |
| `GUARD-AUTHORITY.md` | STILL_ACTIVE | current normative or reference document |
| `IDENTITY-BINDING.md` | STILL_ACTIVE | current normative or reference document |
| `IDENTITY-EVIDENCE.md` | STILL_ACTIVE | current normative or reference document (v1.6) |
| `M0-PHASES.md` | STILL_ACTIVE | current normative or reference document (v1.6) |
| `M0-PROBE-CONTRACT.md` | STILL_ACTIVE | current normative or reference document |
| `M0A-PROBE-COMPATIBILITY.md` | STILL_ACTIVE | current normative or reference document (v1.6) |
| `M3-MATRIX.md` | STILL_ACTIVE | current normative or reference document |
| `MILESTONES.md` | STILL_ACTIVE | current normative or reference document |
| `PRIMITIVE-SPEC.md` | STILL_ACTIVE | current normative or reference document (v1.6) |
| `PROVISIONAL.md` | STILL_ACTIVE | current normative or reference document |
| `RAW-CAPTURE.md` | STILL_ACTIVE | current normative or reference document (v1.6) |
| `README.md` | STILL_ACTIVE | current normative or reference document |
| `REFERENCE-PARSER.md` | STILL_ACTIVE | current normative or reference document (v1.6) |
| `REVIEW-MARKER-POLICY.md` | STILL_ACTIVE | current normative or reference document |
| `REVIEW-REFREEZE.md` | STILL_ACTIVE | current normative or reference document (v1.6) |
| `SCORECRAFT-EXTRACTION.md` | STILL_ACTIVE | current normative or reference document |
| `SEMANTIC-VALIDATION.md` | STILL_ACTIVE | current normative or reference document |
| `SNAPSHOT-COMPLETENESS.md` | STILL_ACTIVE | current normative or reference document |
| `SNAPSHOT-CONCURRENCY-RECOVERY.md` | STILL_ACTIVE | doctrine, verified facts, guarantees/non-guarantees, recovery and conflict codes only; its transaction state-machine enumeration and snapshot field enumeration are SUPERSEDED (S32, S33) |
| `TARGET-ATTACHMENT-GATE.md` | STILL_ACTIVE | current normative or reference document |
| `THREAT-MODEL.md` | STILL_ACTIVE | current normative or reference document (v1.6) |
| `TRANSPORT.md` | STILL_ACTIVE | current normative or reference document |
| `VALIDATION-REPORT.md` | STILL_ACTIVE | generated report; not normative |

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
| S11 | v1.2 ELIGIBILITY.md / evaluate_eligibility(perms, request, read_primitives, capabilities) trusting request.target.attachment_state, capability_state, evidence strings, journal_available, guard_available, authorization_token | `ELIGIBILITY.md; TARGET-ATTACHMENT-GATE.md; schemas/resolveEligibilityRequest.schema.json; schemas/resolveEvidenceSet.schema.json; tools/authority_lib.py#evaluate_eligibility` | SUPERSEDED | 1.3.0 | evaluator consumes frozen authorities + content-addressed evidence; state and qualification derived, never declared |
| S12 | v1.2 TARGET-CONTRACT.json attachment_state / attachment_evidence fields and TARGET-ATTACHMENT-GATE.md evidence-field table | `TARGET-ATTACHMENT-GATE.md; TARGET-CONTRACT.json; tools/authority_lib.py#derive_attachment_state` | SUPERSEDED | 1.3.0 | attachment state is a function of (contract, evidence set); declared state is schema-invalid |
| S13 | v1.2 PERMISSIONS.json/READ-PRIMITIVES.json without target requirements (CONNECT and other M0 ops accepted any project name) | `PERMISSIONS.json; READ-PRIMITIVES.json; MILESTONE-MATRIX.json; ELIGIBILITY.md` | SUPERSEDED | 1.3.0 | operation-specific target_requirement SESSION/PROJECT/PROJECT_TIMELINE with binding observations |
| S14 | v1.2 READ_PRIMITIVE_QUALIFICATION_PROBE described only as PROBE_ONLY fallback; QUALIFIED_READ assertable by request | `M0-PROBE-CONTRACT.md; CAPABILITIES.json; READ-PRIMITIVES.json` | SUPERSEDED | 1.3.0 | PROBE_ALLOWED != QUALIFIED_READ; probe_candidate/probe_allowed flags; candidate evidence; reviewed refreeze required |
| S15 | v1.2 SNAPSHOT-COMPLETENESS.md (status on 5 identity fields only; items sorted by numeric end; complete:false without reasons) and resolveSnapshot.v1.2 / resolveSnapshotPayload.v1.2 domain | `SNAPSHOT-COMPLETENESS.md; CANONICALIZATION.md; schemas/resolveSnapshot.schema.json` | SUPERSEDED | 1.3.0 | status on all frame/identity fields; status-aware order; failure ledger; incomplete_reasons; per-profile completeness incl. WRITE_PRECHECK fail-closed |
| S16 | v1.2 CANONICALIZATION.md §2 $f64 validation via prefix match; v1.2 SEMANTIC-VALIDATION.md per-document checks without cross-artifact binding; v1.2 commit checker trusting verification by hash | `CANONICALIZATION.md; SEMANTIC-VALIDATION.md; tools/authority_lib.py#validate_transaction_set` | SUPERSEDED | 1.3.0 | fullmatch f64; binding tuple across plan/journal/verification/conflict/commit; composed commit validation; linked-set validator |
| S17 | v1.2 M3-PROBES.json/M3-MATRIX.md P15 "identity stable across rename/save/reopen"; v1.2 SCORECRAFT-EXTRACTION.md referring to resolveTargetContract.v1.1 / resolveSnapshot.v1.1 as extraction targets; v1.2 manifest validation without byte counts | `M3-PROBES.json; M3-MATRIX.md; SCORECRAFT-EXTRACTION.md; schemas/resolveFreezeManifest.schema.json` | SUPERSEDED | 1.3.0 | rename claim removed (option B); active references v1.3; byte-count equality |
| S18 | v1.3 evidence records tagged only with a target {host_name, library_name}; BUNDLE_VERIFICATION matched by authority_version alone (any manifest sha); latest CONNECTION_OBSERVATION / binding chosen by record position (conns[-1], pb[-1], tb[-1]); no session identity | `schemas/resolveEvidenceSet.schema.json; TARGET-CONTRACT.json; TARGET-ATTACHMENT-GATE.md; tools/authority_lib.py#derive_attachment_state` | SUPERSEDED | 1.4.0 | envelope law (level BUNDLE/LIBRARY/SESSION), exact active-manifest binding, current_session_id + sequence-based currency with AMBIGUOUS/STALE, coherence -> CONFLICT; no positional selection |
| S19 | v1.3 CAPABILITY_EVIDENCE record (method, host, resolve_version, build, observed_result, evidence_sha256, reviewed_refreeze_version string) and primitive_status accepting any linked record with a non-null reviewed_refreeze_version; probe failures recorded as observed_result 'FAILED:' strings | `CAPABILITIES.json; READ-PRIMITIVES.json; M0-PROBE-CONTRACT.md; tools/authority_lib.py#capability_record_qualifies` | SUPERSEDED | 1.4.0 | QUALIFIED_CALLABLE requires active matrix row + reviewed refreeze block + linked SUCCESS record with exact receiver/host/product/version/build, reviewed ACCEPT, promotion by the active authority version and matrix sha, RAW_EVIDENCE re-hashing; failure taxonomy CAPABILITY_FAILURE / FATAL_TARGET_FAILURE |
| S20 | v1.3 resolveSnapshot.v1.3 timeline block with mandatory numeric start_frame/end_frame/width/height/start_timecode (status only on identity); MINIMAL_M0 fixture built from probe-enumerated tracks; payload domain vidtoolz.resolveSnapshotPayload.v1.3 | `schemas/resolveSnapshot.schema.json; SNAPSHOT-COMPLETENESS.md; CANONICALIZATION.md` | SUPERSEDED | 1.4.0 | status on every timeline/project/track/item field, nullable values, capability->coverage coupling, pre-qualification capture defined; payload domain v1.4 |
| S21 | v1.3 guard v1 (vidtoolz.resolveGuard.v1: project/timeline identity without observation status or reason) | `GUARD-AUTHORITY.md; schemas/resolveGuard.schema.json` | SUPERSEDED | 1.4.0 | guard v2 carries unique_id_status, unique_id_reason, name_status; UNAVAILABLE != ERROR; policy.capability_matrix_sha256 |
| S22 | v1.3 journal law: APPLIED with any operation_id (uniqueness only), PREFLIGHT_OK/CHECKPOINTED -> APPLIED directly, no operation_set_digest in records | `schemas/provisional/resolveTransactionJournal.schema.json; SEMANTIC-VALIDATION.md; tools/authority_lib.py#semantic_journal` | SUPERSEDED | 1.4.0 | operation membership against the bound plan (id + op type), OP_STARTED -> APPLIED | OP_FAILED lifecycle, READBACK_S1 after all applied, operation_set_digest in every record |
| S23 | v1.3 verification and commit trusting declared added/removed/unrelated/missing_expected lists and s1_guard_digest / readback_snapshot_sha256 strings | `schemas/provisional/resolveVerificationResult.schema.json; schemas/provisional/resolveCommitManifest.schema.json; SEMANTIC-VALIDATION.md; tools/authority_lib.py#verify_transaction` | SUPERSEDED | 1.4.0 | S0/S1 resolved by digest and lineage, delta derived, expected effects (provisional APPEND law), declared result must equal derived truth; commit binds s1_guard_digest |
| S24 | v1.3 validate_transaction_set over {plan, journal, verification, commit, conflicts} without S0/S1 | `tools/authority_lib.py#validate_transaction_set; SEMANTIC-VALIDATION.md` | SUPERSEDED | 1.4.0 | composed S0 -> plan -> journal -> S1 -> derived delta -> expected effect -> verification -> commit; no commit-by-hash shortcut |
| S25 | v1.4 capability_record_qualifies trusting result.classification SUCCESS / qualification.reviewed labels; review and promotion not bound to the exact raw evidence hash; refreeze block without promoted_evidence_sha256 | `CAPABILITIES.json; READ-PRIMITIVES.json; M0-PROBE-CONTRACT.md; schemas/resolveEvidenceSet.schema.json; tools/authority_lib.py#capability_success` | SUPERSEDED | 1.5.0 | success DERIVED from RAW_EVIDENCE + parse block; review_raw_evidence_sha256 and promoted_by.raw_evidence_sha256 bind the exact evidence; refreeze lists promoted_evidence_sha256 |
| S26 | v1.4 _item_index / derive_delta trusting item unique_id as unique (last occurrence wins) | `SNAPSHOT-COMPLETENESS.md; tools/authority_lib.py#occurrence_index` | SUPERSEDED | 1.5.0 | DUPLICATE_OCCURRENCE_IDENTITY fails closed before any index; canonical address order; no positional pick |
| S27 | v1.4 derive_delta comparing only track/start/end/enabled/media-pool-id/name and timeline markers | `SEMANTIC-VALIDATION.md; tools/authority_lib.py#derive_delta` | SUPERSEDED | 1.5.0 | protected surface: occurrence identity/range/source bounds/media identity/properties/markers, timeline identity/frames/timebase/geometry/settings, track topology+fields, media linkage; unrelated-change law |
| S28 | v1.4 semantic_commit_manifest / semantic_verification_result accepting s0=None, s1=None, active=None (direct commit path) and validate_transaction_set(callable_methods=...) caller override | `SEMANTIC-VALIDATION.md; tools/authority_lib.py#commit_eligibility; tools/authority_lib.py#validate_transaction_set` | SUPERSEDED | 1.5.0 | commit_eligibility -> validate_transaction_set is the only authorizing path; helpers INTERNAL_NON_AUTHORIZING and refuse partial input; no callable-set parameter; AUTHORITY_SURFACE + bypass audit |
| S29 | v1.4 journal READBACK_S1 without readback digests or session; verification/commit not bound to the journal's readback or to the execution session | `schemas/provisional/resolveTransactionJournal.schema.json; schemas/provisional/resolveMutationPlan.schema.json; schemas/provisional/resolveVerificationResult.schema.json; schemas/provisional/resolveCommitManifest.schema.json; SEMANTIC-VALIDATION.md; tools/authority_lib.py#semantic_journal` | SUPERSEDED | 1.5.0 | session_id on plan/journal/verification/commit; READBACK_S1 names S1 object digest + guard; verification and commit name the same S1; S1 from another session rejected |
| S30 | v1.4 semantic_snapshot(snap, callable_methods) coupling only by a caller-supplied callable set and a collection status map; resolveGuard.v2 without provenance | `schemas/resolveSnapshot.schema.json; schemas/resolveGuard.schema.json; SNAPSHOT-COMPLETENESS.md; GUARD-AUTHORITY.md; tools/authority_lib.py#provenance_errors` | SUPERSEDED | 1.5.0 | collection.method_provenance (QUALIFIED_OBSERVATION / CANDIDATE_OBSERVATION / NOT_CALLABLE) cited per method and verified against the active authority inside the composed validator; guard v3 binds provenance_sha256 |
| S31 | v1.4 linked set accepting any complete S1 profile | `SNAPSHOT-COMPLETENESS.md; tools/authority_lib.py#required_s1_profile` | SUPERSEDED | 1.5.0 | OPERATION_VERIFY_PROFILE (APPEND -> APPEND_VERIFY), S0 WRITE_PRECHECK incl. source bounds, profile_satisfies superset law, S1 complete |
| S32 | SNAPSHOT-CONCURRENCY-RECOVERY.md#Transaction state machine (APPLIED_n with intermediate readback per phase; VERIFIED as a declared-list condition; no OP_STARTED/OP_FAILED; no readback binding) | `tools/authority_lib.py#JOURNAL_TRANSITIONS; SEMANTIC-VALIDATION.md; tools/authority_lib.py#commit_eligibility` | SUPERSEDED | 1.6.0 | one active transaction lifecycle: PREPARED -> LEASED -> PREFLIGHT_OK -> CHECKPOINTED (mandatory, with checkpoint evidence) -> OP_STARTED -> APPLIED | OP_FAILED -> READBACK_S1 (naming the exact S1) -> VERIFIED (derived from S0/S1) -> SAVED -> PUBLISHED -> COMMITTED; a commit is decided only by commit_eligibility -> validate_transaction_set |
| S33 | SNAPSHOT-CONCURRENCY-RECOVERY.md#Snapshot (fixed envelope/payload field enumeration incl. speed, transforms/audio properties, fades, links, takes and effect coverage) | `schemas/resolveSnapshot.schema.json; SNAPSHOT-COMPLETENESS.md; GUARD-AUTHORITY.md` | SUPERSEDED | 1.6.0 | snapshot content, per-field observation status, coverage profiles and completeness are defined by the schema and SNAPSHOT-COMPLETENESS.md; item properties, fades, speed, takes, links and unowned media hashes are explicitly NOT represented (PROTECTED_SURFACE_EXCLUSIONS) |
| S34 | v1.5 CAPABILITY_EVIDENCE record with a probe-authored parse block / parsed_observation / result, and capability_success reading those claims | `RAW-CAPTURE.md; CAPTURE-SHIM.md; REFERENCE-PARSER.md; schemas/resolveEvidenceSet.schema.json; tools/authority_lib.py#derive_capability_result` | SUPERSEDED | 1.6.0 | the probe records mechanical facts only (interpretation fields are schema-forbidden); meaning is derived by the versioned reference parser and recomputed by every validator; CAPABILITY_EVIDENCE is a retired record type |
| S35 | v1.5 primitive_status / capability matrix comparing references without proving that the supplied matrix is the matrix named by active.capability_matrix_sha256 | `REVIEW-REFREEZE.md; tools/authority_lib.py#capability_matrix_digest; tools/authority_lib.py#active_authority_errors` | SUPERSEDED | 1.6.0 | the active capability authority is the canonical content digest of the matrix object; every authorizing entry point refuses any other content with CAPABILITY_MATRIX_NOT_ACTIVE |
| S36 | v1.5 GUARD_SNAPSHOT record (guard_digest + payload_sha256 only) and GUARD_CURRENT / PLAN_VALIDATION accepting it as a write precondition | `GUARD-AUTHORITY.md; ELIGIBILITY.md; tools/authority_lib.py#guard_record_errors` | SUPERSEDED | 1.6.0 | the guard record carries the guard object and the provenance map; the pre-write gate recomputes both digests and proves profile, completeness, qualified provenance, matrix, authority and target before any mutator; PLAN_VALIDATION must come from the composed validator and name this plan's H0 |
| S37 | v1.5 validate_transaction_set(..., schema_validate=None) and commit_eligibility(..., schema_validate=None) defaults, and verification comparison omitting applied_operation_ids | `SEMANTIC-VALIDATION.md; tools/authority_lib.py#validate_transaction_set; tools/authority_lib.py#semantic_verification_result` | SUPERSEDED | 1.6.0 | schema enforcement is a required parameter of both authorizing entry points (a call without it refuses); applied_operation_ids and unobserved_domains are derived and compared |
| S38 | v1.5 READ-PRIMITIVES.expected_type as a single heuristic expectation without nullability, argument types, shape rule, completeness, status or digest | `PRIMITIVE-SPEC.md; READ-PRIMITIVES.json#primitive_spec_sha256; tools/authority_lib.py#primitive_spec_digest` | SUPERSEDED | 1.6.0 | a versioned expectation authority: every primitive declares receiver, arg_types, nullable, expected_type, shape_rule, completeness and expectation_status DOCUMENTED_HYPOTHESIS with its source; the spec digest is bound by every review, refreeze and matrix entry |

## Retired terms

These strings must not appear in a STILL_ACTIVE document except in the exempt list of `AUTHORITY-PRECEDENCE.json` (history, changelogs, finding matrices, the generated report, and the documents that name them only as retired):

```
--dump-tools, 18 probes, APPLIED_n, CAPABILITY_EVIDENCE, IMPORT_OVERRIDE, QUALIFIED_READ (inspect row), attachment_evidence, attachment_state:, authorization_token, callable_methods=, canonicalization_version: 1.1, canonicalization_version: 1.2, canonicalization_version: 1.3, canonicalization_version: 1.4, capability_evidence_record_id, capability_record_qualifies, capability_state, capability_success, collection.primitive_status, conns[-1], journal_available, parsed_observation, promoted_evidence_sha256, raw_evidence_sha256, resolveGuard.v2", resolveSnapshot.v1.1, resolveSnapshot.v1.2, resolveSnapshot.v1.3, resolveSnapshot.v1.4, review_raw_evidence_sha256, schema_validate=None, target.host_name, target_attachment_state
```

Exempt: `AUTHORITY-PRECEDENCE.md`, `CANONICALIZATION.md`, `CHANGELOG-v1.2.md`, `CHANGELOG-v1.3.md`, `CHANGELOG-v1.4.md`, `CHANGELOG-v1.5.md`, `CHANGELOG-v1.6.md`, `DRIFT-POLICY.md`, `ELIGIBILITY.md`, `FINDING-RESOLUTION-MATRIX-v1.2.md`, `FINDING-RESOLUTION-MATRIX-v1.3.md`, `FINDING-RESOLUTION-MATRIX-v1.4.md`, `FINDING-RESOLUTION-MATRIX-v1.5.md`, `FINDING-RESOLUTION-MATRIX-v1.6.md`, `GUARD-AUTHORITY.md`, `M0-PROBE-CONTRACT.md`, `M0A-PROBE-COMPATIBILITY.md`, `PRIMITIVE-SPEC.md`, `PROVISIONAL.md`, `RAW-CAPTURE.md`, `README.md`, `REFERENCE-PARSER.md`, `REVIEW-REFREEZE.md`, `SCORECRAFT-EXTRACTION.md`, `SEMANTIC-VALIDATION.md`, `SNAPSHOT-COMPLETENESS.md`, `SNAPSHOT-CONCURRENCY-RECOVERY.md`, `THREAT-MODEL.md`, `VALIDATION-REPORT.md`.

## v1.7 supersessions (S39–S45)

Each of these replaces a v1.6 statement that Codex's forensic adjudication showed to be unenforceable as written.
The machine-readable form, including the full text of every statement, is `AUTHORITY-PRECEDENCE.json`.

| id | superseded v1.6 statement | new authority | why |
|---|---|---|---|
| S39 | Derived authority results may be memoized per authority object identity plus content (v1.6 authority_lib: qualification keyed on id(caps)/id(es)/id(rp… | AUTHORITY-CACHING.md; tools/authority_lib.py#content_key | Codex v1.6 BLOCKER C16-B1: an object identity is not its content. Mutating a qualified chain in place left the warm answer QUALIFIED_CALLABLE while a cold process refused… |
| S40 | The composed validation path requires the caller to supply a schema validator, and requiring it (rather than defaulting it) makes schema enforcement m… | SCHEMA-REGISTRY.md; tools/authority_lib.py#internal_schema_errors | Codex v1.6 BLOCKER C16-B2: a required parameter still lets the caller define validity. An always-empty, partial, permissive or stale validator authorized an invalid commi… |
| S41 | A raw capture records its capture shim version and shim sha256 as provenance facts (v1.6 RAW-CAPTURE.md, CAPTURE-SHIM.md).… | TRUSTED-SHIM.md; TRUSTED-SHIM.json; tools/authority_lib.py#capture_shim_trust_errors | Codex v1.6 BLOCKER C16-B3: recorded provenance that nothing compares is not provenance. A capture declaring any shim hash qualified. The bundle now pins one trusted shim … |
| S42 | A stored derived capability result is a cache: qualification recomputes it and compares digests, and any stored copy must equal the recomputation (v1.… | STORED-CHAIN.md; tools/authority_lib.py#resolve_stored_chain | Codex v1.6 BLOCKER C16-B4: comparing digests closes forgery of the value but not substitution of the artifact. A claimed derived artifact that was absent, or that belonge… |
| S43 | Identity claims are derived by mapping each observed receiver path to its returned identity value within a pass, and claim C compares those maps acros… | IDENTITY-EVIDENCE.md#v17; tools/authority_lib.py#identity_claim_input_errors | Codex v1.6 M0A MAJOR C16-M1: writing each observation into a map keyed by receiver path let a duplicate path overwrite the first observation, so the conflict disappeared … |
| S44 | A RAW_CAPABILITY_CAPTURE enters the authority as a parsed capture object whose structure and digest are validated (v1.6 RAW-CAPTURE.md).… | RAW-CAPTURE.md#v17; tools/authority_lib.py#ingest_raw_frame | Codex v1.6 M0A MAJOR C16-M2: a parsed object cannot show that duplicate JSON keys, control characters or trailing bytes were ever rejected, and the standard parser silent… |
| S45 | The append-only evidence root is defined by the layout and rules of EVIDENCE-ROOT.md, with EvidenceRoot in the reference capture shim as an illustrati… | EVIDENCE-ROOT.md#v17; tools/evidence_store.py | Codex v1.6 M0A MAJOR C16-M3: the layout was prose. Nothing could be run to prove that an evidence root refuses an overwrite, a reused attempt id, a write after finalizati… |

The four v1.7 documents `AUTHORITY-CACHING.md`, `SCHEMA-REGISTRY.md`, `TRUSTED-SHIM.md` and `STORED-CHAIN.md` are
STILL_ACTIVE. `CHANGELOG-v1.6.md` and `FINDING-RESOLUTION-MATRIX-v1.6.md` become HISTORICAL: they remain the input
of record for what v1.6 claimed, and `CHANGELOG-v1.7.md` with `FINDING-RESOLUTION-MATRIX-v1.7.md` are the active
correction record.

## v1.8 supersessions (S46–S47)

Both replace a v1.7 statement that Codex's forensic adjudication showed to be unenforceable as written. The
machine-readable form is `AUTHORITY-PRECEDENCE.json`.

| id | superseded v1.7 statement | new authority | why |
|---|---|---|---|
| S46 | An evidence session is verified by recomputing the digests of the records the verifier expects to find: record files under the four layers, the sessio… | EVIDENCE-ROOT.md; tools/evidence_store.py#finalize; tools/evidence_store.py#verify | Codex v1.7 BLOCKER ES-1, independent attack STORE-14: a verifier that only examines what it expects cannot notice what it does not. A file planted in a finalized session root was i… |
| S47 | The append-only evidence root has a reference implementation in the capture shim (EvidenceRoot in tools/capture_shim_reference.py) alongside the norma… | EVIDENCE-ROOT.md; tools/evidence_store.py | Codex v1.7 BLOCKER ES-2: two competing evidence-storage surfaces existed, and the legacy one built filesystem paths from caller-supplied strings. All four of its write methods esca… |

`EVIDENCE-ROOT.md` is rewritten as the single normative evidence-store document and names
`tools/evidence_store.py` as the one `EVIDENCE_STORE_AUTHORIZING` implementation. `CHANGELOG-v1.7.md` and
`FINDING-RESOLUTION-MATRIX-v1.7.md` become HISTORICAL; `CHANGELOG-v1.8.md` and
`FINDING-RESOLUTION-MATRIX-v1.8.md` are the active correction record.

