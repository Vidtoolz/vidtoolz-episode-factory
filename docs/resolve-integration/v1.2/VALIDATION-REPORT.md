# VALIDATION REPORT — Resolve authority bundle v1.2

Result: **346/346 checks passed**. Layers: parse (strict duplicate-key rejection) -> schema (Draft 2020-12) -> semantic (reference rules) -> eligibility (evaluate_eligibility). Offline; no Resolve. Node conformance = M1. SCHEMA-VALID != AUTHORIZED TO MUTATE; passing proves internal consistency of the authority documents only.

| Section | Check | Result | Detail |
|---|---|---|---|
| parse | clean.json.txt | PASS | parsed |
| parse | duplicate-key.json.txt | PASS | duplicate JSON key at parse boundary: 'a' |
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
| frozen-instance-semantic | READ-PRIMITIVES.json vs CAPABILITIES | PASS |  |
| fixture-schema-negative | canary-21-media | PASS | minItems:[{'role': 'DRAFT_BESPOKE_STILL', 'asset_id': 'draft-still-001', 'declared_path': '/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-08-31-claude-real-20-bespoke-still-draft-successor/ |
| fixture-schema-negative | canary-duplicate-record | PASS | uniqueItems:[{'role': 'DRAFT_BESPOKE_STILL', 'asset_id': 'draft-still-001', 'declared_path': '/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-08-31-claude-real-20-bespoke-still-draft-success |
| fixture-schema-positive | canary-hash-mismatch | PASS |  |
| fixture-semantic-negative | canary-hash-mismatch | PASS | hash mismatch draft-still-003 |
| fixture-schema-positive | canary-manifest-frozen | PASS |  |
| fixture-semantic-positive | canary-manifest-frozen | PASS |  |
| fixture-schema-negative | canary-path-traversal | PASS | pattern:'/home/vidtoolz/../etc/passwd' does not match '^/(?!.*(^//)\\.\\.(//$)).*$' |
| fixture-schema-positive | capabilities-frozen | PASS |  |
| fixture-semantic-positive | capabilities-frozen | PASS |  |
| fixture-schema-positive | capabilities-qualified-read-without-exact-evidence | PASS |  |
| fixture-semantic-negative | capabilities-qualified-read-without-exact-evidence | PASS | row 'read: connection': QUALIFIED_READ without exact version-matched evidence record |
| fixture-schema-negative | capabilities-unknown-evidence-class | PASS | enum:'QUALIFIED' is not one of ['QUALIFIED_READ', 'DOCUMENTED_NOT_QUALIFIED', 'NOT_TESTED', 'UNSUPPORTED', 'BLOCKED', 'QUALIFIED_EF_SIDE'] |
| fixture-schema-positive | commit-guard-mismatch | PASS |  |
| fixture-semantic-negative | commit-guard-mismatch | PASS | commit guard_digest does not match target guard |
| fixture-schema-positive | commit-journal-head-mismatch | PASS |  |
| fixture-semantic-negative | commit-journal-head-mismatch | PASS | commit journal_head_sha256 does not match journal chain head |
| fixture-schema-positive | commit-journal-not-published | PASS |  |
| fixture-semantic-negative | commit-journal-not-published | PASS | commit journal_head_sha256 does not match journal chain head; commit for journal whose last state is VERIFIED |
| fixture-schema-positive | commit-linked-eligible | PASS |  |
| fixture-semantic-positive | commit-linked-eligible | PASS |  |
| fixture-schema-negative | commit-naked-terminal-state | PASS | required:'verification_result_sha256' is a required property |
| fixture-schema-positive | commit-unresolved-conflict | PASS |  |
| fixture-semantic-negative | commit-unresolved-conflict | PASS | commit with unresolved conflicts |
| fixture-schema-positive | commit-verification-not-verified | PASS |  |
| fixture-semantic-negative | commit-verification-not-verified | PASS | commit without VERIFIED verification result |
| fixture-schema-positive | journal-broken-hash-chain | PASS |  |
| fixture-semantic-negative | journal-broken-hash-chain | PASS | seq 3: hash chain broken; seq 4: hash chain broken |
| fixture-schema-positive | journal-legal-chain | PASS |  |
| fixture-semantic-positive | journal-legal-chain | PASS |  |
| fixture-schema-positive | journal-operation-id-reused | PASS |  |
| fixture-semantic-negative | journal-operation-id-reused | PASS | seq 4: operation_id op-1 applied twice |
| fixture-schema-positive | journal-record-after-terminal | PASS |  |
| fixture-semantic-negative | journal-record-after-terminal | PASS | seq 10: illegal transition COMMITTED -> APPLIED; seq 10: record after terminal state COMMITTED |
| fixture-schema-positive | journal-recovery-committed-recovered | PASS |  |
| fixture-semantic-positive | journal-recovery-committed-recovered | PASS |  |
| fixture-schema-positive | journal-recovery-not-applied | PASS |  |
| fixture-semantic-positive | journal-recovery-not-applied | PASS |  |
| fixture-schema-positive | journal-repeated-sequence | PASS |  |
| fixture-semantic-negative | journal-repeated-sequence | PASS | seq 1: repeated sequence number; seq 1: sequence gap (expected 2); seq 3: sequence gap (expected 2); seq 3: hash chain broken |
| fixture-schema-positive | journal-sequence-gap | PASS |  |
| fixture-semantic-negative | journal-sequence-gap | PASS | seq 5: sequence gap (expected 2); seq 3: sequence gap (expected 6); seq 3: hash chain broken; seq 5: repeated sequence number |
| fixture-schema-positive | journal-skip-to-committed | PASS |  |
| fixture-semantic-negative | journal-skip-to-committed | PASS | seq 4: illegal transition CHECKPOINTED -> COMMITTED; seq 5: hash chain broken; seq 5: illegal transition COMMITTED -> READBACK_S1; seq 5: record after terminal state COMMITTED |
| fixture-schema-positive | journal-transaction-id-change | PASS |  |
| fixture-semantic-negative | journal-transaction-id-change | PASS | seq 3: transaction_id changed mid-chain; seq 4: hash chain broken |
| fixture-schema-negative | permissions-default-allow | PASS | const:'DENY' was expected |
| fixture-schema-positive | permissions-frozen | PASS |  |
| fixture-none | permissions-frozen | PASS |  |
| fixture-schema-negative | permissions-shared-library-grant | PASS | const:False was expected |
| fixture-schema-negative | permissions-unknown-prerequisite-code | PASS | enum:'TRUST_ME' is not one of ['BUNDLE_INDEPENDENTLY_VERIFIED', 'EXCLUSIVE_SESSION_ATTESTED', 'GUARD_CURRENT', 'HOST_MATCHES_CONTRACT', 'JOURNAL_PREPARED', 'LIBRARY_MATCHES_CONTRACT', 'LIBRARY_NOT_SHA |
| fixture-schema-positive | plan-delete-selector-incomplete | PASS |  |
| fixture-semantic-negative | plan-delete-selector-incomplete | PASS | selector incomplete for DELETE: missing ['expected_end', 'expected_start', 'item_unique_id'] |
| fixture-schema-positive | plan-m2-append-not-permitted | PASS |  |
| fixture-semantic-negative | plan-m2-append-not-permitted | PASS | operation APPEND not permitted at M2/SCRATCH_QUALIFICATION_LIBRARY: ['NO_EXPLICIT_ALLOW_ENTRY'] |
| fixture-schema-negative | plan-m2-non-dry-run | PASS | minItems:[] is too short |
| fixture-schema-positive | plan-m3-append-eligible | PASS |  |
| fixture-semantic-positive | plan-m3-append-eligible | PASS |  |
| fixture-schema-positive | plan-missing-m3-authorization | PASS |  |
| fixture-eligibility-negative | plan-missing-m3-authorization | PASS | operation APPEND not eligible: ['MIKKO_M3_AUTHORIZATION'] |
| fixture-schema-positive | plan-read-class-with-append | PASS |  |
| fixture-semantic-negative | plan-read-class-with-append | PASS | RESOLVE_READ permission class cannot carry write operations |
| fixture-schema-positive | plan-selector-target-mismatch | PASS |  |
| fixture-semantic-negative | plan-selector-target-mismatch | PASS | selector project_unique_id does not match plan target |
| fixture-schema-positive | plan-stale-guard | PASS |  |
| fixture-semantic-negative | plan-stale-guard | PASS | operation APPEND not eligible: ['GUARD_CURRENT']; plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT) |
| fixture-schema-positive | plan-target-library-mismatch | PASS |  |
| fixture-eligibility-negative | plan-target-library-mismatch | PASS | operation APPEND not eligible: ['LIBRARY_NOT_SHARED', 'LIBRARY_MATCHES_CONTRACT'] |
| fixture-schema-positive | read-primitives-class-mismatch-with-matrix | PASS |  |
| fixture-semantic-negative | read-primitives-class-mismatch-with-matrix | PASS | SNAPSHOT_CAPTURE: primitive GetTrackCount evidence_class QUALIFIED_READ != matrix DOCUMENTED_NOT_QUALIFIED |
| fixture-schema-positive | read-primitives-frozen | PASS |  |
| fixture-semantic-positive | read-primitives-frozen | PASS |  |
| fixture-schema-positive | snapshot-complete-empty-observed | PASS |  |
| fixture-semantic-negative | snapshot-complete-empty-observed | PASS | complete:true with empty observed_domains; complete:true but mandatory domains not observed: ['connection', 'items', 'library', 'markers', 'project', 'settings', 'timeline', 'tracks']; guard_digest do |
| fixture-schema-positive | snapshot-complete-write-precheck-missing-domains | PASS |  |
| fixture-semantic-negative | snapshot-complete-write-precheck-missing-domains | PASS | complete:true but mandatory domains not observed: ['item_identity', 'track_locks']; guard_digest does not match guard object |
| fixture-schema-positive | snapshot-duration-contradiction | PASS |  |
| fixture-semantic-negative | snapshot-duration-contradiction | PASS | duration inconsistent with both candidate conventions (raw observation contradiction); payload_sha256 does not match canonical payload |
| fixture-schema-positive | snapshot-end-before-start | PASS |  |
| fixture-semantic-negative | snapshot-end-before-start | PASS | item it-1: end < start; duration inconsistent with both candidate conventions (raw observation contradiction); payload_sha256 does not match canonical payload |
| fixture-schema-positive | snapshot-fabricated-id | PASS |  |
| fixture-semantic-negative | snapshot-fabricated-id | PASS | unique_id: status UNAVAILABLE but value present (fabrication); payload_sha256 does not match canonical payload |
| fixture-schema-positive | snapshot-guard-context-changed | PASS |  |
| fixture-semantic-negative | snapshot-guard-context-changed | PASS | guard_digest does not match guard object |
| fixture-schema-positive | snapshot-human-timeline-full-read | PASS |  |
| fixture-semantic-positive | snapshot-human-timeline-full-read | PASS |  |
| fixture-schema-positive | snapshot-incomplete-without-reason | PASS |  |
| fixture-semantic-negative | snapshot-incomplete-without-reason | PASS | complete:false must name missing domains; guard_digest does not match guard object |
| fixture-schema-negative | snapshot-invented-domain | PASS | enum:'vibes' is not one of ['adapter_bin_media', 'caches', 'connection', 'fades', 'fusion_graphs', 'grades', 'item_identity', 'item_properties', 'item_source_bounds', 'items', 'keyframe_curves', 'libr |
| fixture-schema-positive | snapshot-m0-minimal-identity-unavailable | PASS |  |
| fixture-semantic-positive | snapshot-m0-minimal-identity-unavailable | PASS |  |
| fixture-schema-negative | snapshot-missing-ordinal | PASS | oneOf:{'unique_id': 'it-1', 'name': 'still-001', 'start': 108000, 'end': 108347, 'duration': 347, 'enabled': True, 'markers': [], 'identity_observed': 'COMPLETE', 'field_status': {'unique_id': 'OBSERV |
| fixture-schema-negative | snapshot-negative-frame | PASS | oneOf:{'unique_id': 'it-1', 'observation_ordinal': 0, 'name': 'still-001', 'start': -5, 'end': 108347, 'duration': 347, 'enabled': True, 'markers': [], 'identity_observed': 'COMPLETE', 'field_status': |
| fixture-schema-positive | snapshot-observed-status-null-value | PASS |  |
| fixture-semantic-negative | snapshot-observed-status-null-value | PASS | unique_id: status OBSERVED but value null; payload_sha256 does not match canonical payload |
| fixture-schema-negative | snapshot-postgres-library | PASS | enum:'PostgreSQL' is not one of ['Disk'] |
| fixture-schema-positive | snapshot-source-bounds-inverted | PASS |  |
| fixture-semantic-negative | snapshot-source-bounds-inverted | PASS | source_end < source_start; payload_sha256 does not match canonical payload |
| fixture-schema-positive | snapshot-timeline-end-before-start | PASS |  |
| fixture-semantic-negative | snapshot-timeline-end-before-start | PASS | timeline end_frame < start_frame; payload_sha256 does not match canonical payload |
| fixture-schema-negative | target-accepts-open-session | PASS | const:False was expected |
| fixture-schema-positive | target-attached-observed-eka | PASS |  |
| fixture-semantic-negative | target-attached-observed-eka | PASS | observed database is a prohibited (shared/user) library; observed database does not match the qualification library |
| fixture-schema-positive | target-attached-read-only-valid | PASS |  |
| fixture-semantic-positive | target-attached-read-only-valid | PASS |  |
| fixture-schema-positive | target-attachment-ready-valid | PASS |  |
| fixture-semantic-positive | target-attachment-ready-valid | PASS |  |
| fixture-schema-positive | target-contract-frozen-unprovisioned | PASS |  |
| fixture-semantic-positive | target-contract-frozen-unprovisioned | PASS |  |
| fixture-schema-negative | target-empty-host | PASS | minLength:'' is too short |
| fixture-schema-negative | target-missing-denied-setcurrentdatabase | PASS | contains:['CloseProject', 'ImportProject', 'DeleteTimelines(non-owned)', 'ReplaceClip', 'ReplaceClipPreserveSubClip', 'RelinkClips', 'DeleteClips(ripple=true)', 'run_script', 'run_script_unsafe', 'exe |
| fixture-schema-negative | target-path-traversal | PASS | anyOf:'/x/../etc' is not valid under any of the given schemas |
| fixture-schema-positive | target-provisioned-not-verified-without-evidence | PASS |  |
| fixture-semantic-negative | target-provisioned-not-verified-without-evidence | PASS | attachment_state PROVISIONED_NOT_VERIFIED requires evidence library.root_path; attachment_state PROVISIONED_NOT_VERIFIED requires evidence library.instance_uuid; attachment_state PROVISIONED_NOT_VERIF |
| fixture-schema-positive | target-ready-without-launch-evidence | PASS |  |
| fixture-semantic-negative | target-ready-without-launch-evidence | PASS | attachment_state ATTACHMENT_READY requires evidence session.launch_recipe_sha256 |
| fixture-schema-negative | target-shared-postgres-library | PASS | const:'Disk' was expected / pattern:'EKA' does not match '^VIDTOOLZ Resolve Qualification v[0-9]+$' |
| fixture-schema-negative | target-unknown-attachment-state | PASS | enum:'OPEN_SESSION' is not one of ['UNPROVISIONED', 'PROVISIONED_NOT_VERIFIED', 'ATTACHMENT_READY', 'ATTACHED_READ_ONLY', 'SCRATCH_WRITE_READY'] |
| fixture-schema-negative | timebase-24fps | PASS | const:30 was expected / const:30 was expected |
| fixture-schema-negative | timebase-arbitrary-tolerance-field | PASS | additionalProperties:Additional properties are not allowed ('arbitrary_ms' was unexpected) |
| fixture-schema-negative | timebase-frame-tolerance | PASS | const:0 was expected |
| fixture-schema-positive | timebase-frozen | PASS |  |
| fixture-semantic-positive | timebase-frozen | PASS |  |
| fixture-schema-negative | timebase-half-up-law | PASS | const:'CEIL_BOUNDARY_V1' was expected / const:'CEIL' was expected |
| fixture-schema-negative | timebase-math-round-law | PASS | const:'CEIL' was expected |
| fixture-schema-negative | timebase-negative-sample-rate | PASS | const:48000 was expected |
| fixture-schema-negative | timebase-substitution-allowed | PASS | const:False was expected |
| fixture-schema-positive | track-policy-duplicate-index | PASS |  |
| fixture-semantic-negative | track-policy-duplicate-index | PASS | video indexes must be unique and ascending; video 1 must be FULL_CANVAS_VISUAL |
| fixture-schema-positive | track-policy-frozen | PASS |  |
| fixture-semantic-positive | track-policy-frozen | PASS |  |
| fixture-schema-negative | track-policy-string-index | PASS | type:'1' is not of type 'integer' |
| fixture-schema-positive | verification-verified-clean | PASS |  |
| fixture-semantic-positive | verification-verified-clean | PASS |  |
| fixture-schema-positive | verification-verified-with-unrelated | PASS |  |
| fixture-semantic-negative | verification-verified-with-unrelated | PASS | VERIFIED with unrelated or missing_expected non-empty |
| canonicalization-vector | empty_object | PASS |  |
| canonicalization-vector | key_order_codepoint | PASS |  |
| canonicalization-vector | string_escapes | PASS |  |
| canonicalization-vector | integers_and_tagged | PASS |  |
| canonicalization-vector | numeric_track_index_2_before_10 | PASS |  |
| canonicalization-vector | track_type_order_video_audio_subtitle | PASS |  |
| canonicalization-vector | markers_total_order_A | PASS |  |
| canonicalization-vector | markers_total_order_B_reversed_same_digest | PASS |  |
| canonicalization-vector | markers_differ_only_in_note | PASS |  |
| canonicalization-vector | markers_differ_only_in_duration | PASS |  |
| canonicalization-vector | unicode_byte_distinct_strings | PASS |  |
| canonicalization-vector | permutation_invariance_A | PASS |  |
| canonicalization-vector | permutation_invariance_B_same_digest | PASS |  |
| canonicalization-vector | same_frame_items_deterministic | PASS |  |
| canonicalization-vector | null_unique_ids_ordered_by_ordinal | PASS |  |
| canonicalization-vector | nullable_fields_explicit_null | PASS |  |
| canonicalization-property | permutation_invariance | PASS |  |
| canonicalization-property | markers_reversed_same_digest | PASS |  |
| canonicalization-property | numeric_index_order | PASS |  |
| canonicalization-property | type_order | PASS |  |
| canonicalization-property | unicode_not_normalized | PASS |  |
| canonicalization-rejection | marker_exact_duplicate | PASS | MARKER_COLLISION: two markers share (object_address, frame) |
| canonicalization-rejection | marker_same_object_frame_different_note | PASS | MARKER_COLLISION: two markers share (object_address, frame) |
| canonicalization-rejection | f64_not_hex | PASS | $f64 must be exactly 16 lowercase hex characters (IEEE-754 binary64 big-endian) |
| canonicalization-rejection | f64_uppercase | PASS | $f64 must be exactly 16 lowercase hex characters (IEEE-754 binary64 big-endian) |
| canonicalization-rejection | f64_short | PASS | $f64 must be exactly 16 lowercase hex characters (IEEE-754 binary64 big-endian) |
| canonicalization-rejection | f64_nan | PASS | $f64 NaN/Infinity rejected |
| canonicalization-rejection | f64_infinity | PASS | $f64 NaN/Infinity rejected |
| canonicalization-rejection | f64_negative_zero | PASS | $f64 negative zero must be normalized to 0000000000000000 |
| canonicalization-rejection | rational_unreduced | PASS | $rational must be reduced |
| canonicalization-rejection | rational_zero_denominator | PASS | $rational must match ^(0/[1-9][0-9]*)/([1-9][0-9]*)$ |
| canonicalization-rejection | rational_negative | PASS | $rational must match ^(0/[1-9][0-9]*)/([1-9][0-9]*)$ |
| canonicalization-rejection | bare_float | PASS | bare float forbidden; use {'$rational':'p/q'} or {'$f64':'hex16'} |
| canonicalization-rejection | string_track_index | PASS | track index must be integer >= 1, got '2' |
| canonicalization-rejection | duplicate_track_address | PASS | duplicate (type,index) track address |
| canonicalization-rejection | unregistered_domain | PASS | unregistered hash domain 'vidtoolz.unregistered' |
| eligibility | m0-probe-allow | PASS | policy=True failed=[] codes=['ELIGIBLE'] |
| eligibility | m0-snapshot-allow-post-probe | PASS | policy=True failed=[] codes=['ELIGIBLE'] |
| eligibility | m0-snapshot-allow-pre-probe-degraded | PASS | policy=True failed=[] codes=['ELIGIBLE'] |
| eligibility | m0-connect-deny-pre-probe-refuse-fallback | PASS | policy=True failed=['PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED'] codes=['PREREQUISITES_FAILED'] |
| eligibility | m0-connect-allow-post-probe | PASS | policy=True failed=[] codes=['ELIGIBLE'] |
| eligibility | m0-deny-unprovisioned | PASS | policy=True failed=['TARGET_STATE_ATTACHMENT_READY'] codes=['PREREQUISITES_FAILED'] |
| eligibility | m0-deny-eka-target | PASS | policy=True failed=['LIBRARY_NOT_SHARED', 'LIBRARY_MATCHES_CONTRACT'] codes=['PREREQUISITES_FAILED'] |
| eligibility | m0-deny-unknown-library | PASS | policy=True failed=['LIBRARY_MATCHES_CONTRACT'] codes=['PREREQUISITES_FAILED'] |
| eligibility | m0-deny-production-project-name | PASS | policy=True failed=['PROJECT_ADAPTER_PREFIXED'] codes=['PREREQUISITES_FAILED'] |
| eligibility | m0-deny-wrong-host | PASS | policy=True failed=['HOST_MATCHES_CONTRACT'] codes=['PREREQUISITES_FAILED'] |
| eligibility | m0-deny-missing-bundle-verification | PASS | policy=True failed=['BUNDLE_INDEPENDENTLY_VERIFIED'] codes=['PREREQUISITES_FAILED'] |
| eligibility | m0-deny-version-mismatch | PASS | policy=True failed=['RESOLVE_VERSION_MATCHES'] codes=['PREREQUISITES_FAILED'] |
| eligibility | m0-deny-no-journal | PASS | policy=True failed=['READ_ONLY_JOURNAL_OPEN'] codes=['PREREQUISITES_FAILED'] |
| eligibility | m0-deny-write-op | PASS | policy=False failed=[] codes=['NO_EXPLICIT_ALLOW_ENTRY'] |
| eligibility | m3-append-deny-without-authorization | PASS | policy=True failed=['MIKKO_M3_AUTHORIZATION'] codes=['PREREQUISITES_FAILED'] |
| eligibility | m3-append-allow-full-evidence | PASS | policy=True failed=[] codes=['ELIGIBLE'] |
| eligibility | m3-append-deny-stale-guard | PASS | policy=True failed=['GUARD_CURRENT'] codes=['PREREQUISITES_FAILED'] |
| eligibility | m3-deny-shared-library-scope | PASS | policy=False failed=[] codes=['UNKNOWN_OR_PROHIBITED_SCOPE'] |
| eligibility | m4-deny-unknown-milestone | PASS | policy=False failed=[] codes=['UNKNOWN_MILESTONE'] |
| eligibility | deny-unknown-operation | PASS | policy=False failed=[] codes=['NO_EXPLICIT_ALLOW_ENTRY'] |
| eligibility-invariant | allowed_true_is_not_eligibility | PASS |  |
| permission-invariant | no_mutation_before_M3 | PASS |  |
| permission-invariant | every_M3_mutation_requires_authorization_and_write_ready | PASS |  |
| permission-invariant | no_shared_library_grant | PASS |  |
| permission-invariant | default_deny | PASS |  |
| permission-invariant | every_entry_has_prerequisites | PASS |  |
| milestone-matrix | M0 read ops match PERMISSIONS | PASS |  |
| milestone-matrix | M0 mutation ops match PERMISSIONS | PASS |  |
| milestone-matrix | M1 read ops match PERMISSIONS | PASS |  |
| milestone-matrix | M1 mutation ops match PERMISSIONS | PASS |  |
| milestone-matrix | M2 read ops match PERMISSIONS | PASS |  |
| milestone-matrix | M2 mutation ops match PERMISSIONS | PASS |  |
| milestone-matrix | M3 read ops match PERMISSIONS | PASS |  |
| milestone-matrix | M3 mutation ops match PERMISSIONS | PASS |  |
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
| precedence | CHANGELOG-v1.2.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX-v1.2.md classified | PASS |  |
| precedence | VALIDATION-REPORT.md classified | PASS |  |
| precedence | CHANGELOG-v1.1.md classified | PASS |  |
| precedence | FINDING-RESOLUTION-MATRIX.md classified | PASS |  |
| precedence | ADJUDICATION-FREEZE-CONTRACT.md classified | PASS |  |
| precedence | AUTHORITY-ARCHITECTURE-ADJUDICATION-M0-M3.md classified | PASS |  |
| precedence-retired-terms | AUTHORITY-PRECEDENCE.md | PASS |  |
| precedence-retired-terms | AUTHORIZATION-2026-09-08.md | PASS |  |
| precedence-retired-terms | CANARIES.md | PASS |  |
| precedence-retired-terms | CANONICALIZATION.md | PASS |  |
| precedence-retired-terms | CHANGELOG-v1.2.md | PASS |  |
| precedence-retired-terms | CLIENT-VERSION-INVENTORY.md | PASS |  |
| precedence-retired-terms | DOCTRINE.md | PASS |  |
| precedence-retired-terms | DRIFT-POLICY.md | PASS |  |
| precedence-retired-terms | ELIGIBILITY.md | PASS |  |
| precedence-retired-terms | FINDING-RESOLUTION-MATRIX-v1.2.md | PASS |  |
| precedence-retired-terms | GUARD-AUTHORITY.md | PASS |  |
| precedence-retired-terms | IDENTITY-BINDING.md | PASS |  |
| precedence-retired-terms | M3-MATRIX.md | PASS |  |
| precedence-retired-terms | MILESTONES.md | PASS |  |
| precedence-retired-terms | PROVISIONAL.md | PASS |  |
| precedence-retired-terms | README.md | PASS |  |
| precedence-retired-terms | REVIEW-MARKER-POLICY.md | PASS |  |
| precedence-retired-terms | SCORECRAFT-EXTRACTION.md | PASS |  |
| precedence-retired-terms | SEMANTIC-VALIDATION.md | PASS |  |
| precedence-retired-terms | SNAPSHOT-COMPLETENESS.md | PASS |  |
| precedence-retired-terms | SNAPSHOT-CONCURRENCY-RECOVERY.md | PASS |  |
| precedence-retired-terms | TARGET-ATTACHMENT-GATE.md | PASS |  |
| precedence-retired-terms | TRANSPORT.md | PASS |  |
| precedence-retired-terms | VALIDATION-REPORT.md | PASS |  |
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
| timebase | canary_boundaries_ceil_law | PASS |  |
| timebase | canary_total_6756 | PASS |  |
| timebase | half_up_gives_6755 | PASS |  |
| guard | payload_equal_but_guard_differs | PASS |  |
| guard | guard_object_validates | PASS |  |
| manifest | schema | PASS |  |
| manifest | semantic (hashes, lineage, inheritance flags) | PASS |  |
| manifest | every file on disk is listed | PASS |  |
| manifest | no listed file missing on disk | PASS | VALIDATION-REPORT.md |
| manifest-negative | invalid status | PASS |  |
| manifest-negative | duplicate path | PASS |  |
| manifest-negative | missing hash | PASS |  |
| manifest-negative | malformed hash | PASS |  |
| manifest-negative | unknown authority classification | PASS |  |
| manifest-negative | broken parent lineage | PASS |  |
| manifest-negative | changed file marked inherited | PASS |  |
| determinism | vectors_rerun_identical | PASS |  |
| determinism | no_bytecode_cache_written | PASS |  |
