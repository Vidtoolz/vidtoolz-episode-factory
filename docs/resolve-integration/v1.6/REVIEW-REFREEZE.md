# REVIEW-REFREEZE.md — human review, capability refreeze and the derived promotion state (v1.6, FROZEN_NOW; nothing promoted)

## 1. REVIEW_DECISION (M0B)

The reviewer sees: the canonical capture bytes, the recomputed derived result with its `reasons`, the primitive spec (receiver, arg types, nullability, expected type, shape rule, completeness, expectation status and source), the contract environment, and the capture's session/probe/sequence identity. The reviewer never sees a probe-authored interpretation, because none exists.

Record: `{raw_capture_sha256, derived_result_sha256, parser_version, parser_sha256, primitive_spec_sha256, method, receiver_class, probe_id, session_id, reviewer, decision, rationale, reviewed_at}` (BUNDLE-level envelope, content-addressed).

Machine law (`authority_lib.semantic_review_decision`): the referenced capture must resolve and be well formed; the referenced derived digest must equal the recomputation under the active parser **and** the active primitive spec; `decision ∈ ACCEPT | REJECT | DEFER`; a rationale is required; **`ACCEPT` is valid only over a recomputed `SUCCESS`**; the review's method/receiver/probe/session must equal the capture's; and **the reviewer must not be the capture operator**. A reviewer cannot convert `EXCEPTION`, `TIMEOUT`, `TYPE_MISMATCH`, `TRUNCATED`, `MALFORMED` or any other class into success — that is a defect to fix in the parser or the spec through a new authority version, not a decision to make.

## 2. REFREEZE_RECORD and the successor matrix (M0C)

A successor `CAPABILITIES.json` may mark a read row `QUALIFIED_READ` only with, per primitive, an evidence entry
`{method, receiver_class, host, product, resolve_version, build, run_ref, evidence_path, evidence_sha256, version_match: true, reviewed_refreeze_version = matrix version, probe_id, raw_capture_sha256, derived_result_sha256, review_decision_sha256, parser_version, parser_sha256, primitive_spec_sha256, result: null}`.
There is no `success`, `classification`, `observed_result` or `qualified` field: the entry names evidence, it does not assert an outcome.

The matrix `refreeze` block carries `{kind: M0_READ_REQUALIFICATION, reviewed, review_decision_ref, parent_capability_matrix_sha256, parser_version, parser_sha256, primitive_spec_sha256, promoted_probe_ids, promoted_raw_capture_sha256, promoted_derived_result_sha256, promoted_review_decision_sha256}`.

The `REFREEZE_RECORD` in the evidence set binds the same digests plus `{manifest_sha256, authority_version, parent + successor capability_matrix_sha256, probe_id, session_id, host_name, product, resolve_version, build, approver}`. `authority_lib.semantic_refreeze_record` requires, for every promoted capture: the capture resolves and is bound; the reference parser recomputes `SUCCESS`; the recomputed derived digest is among the promoted derived digests; a promoted `REVIEW_DECISION` for that exact raw+derived pair is a valid `ACCEPT`; the capture belongs to the record's probe and session; host/product/version/build equal the contract; the successor matrix content digest equals the record's `capability_matrix_sha256`; the parent matrix and the promoted digest sets agree between record and matrix block; and a human `approver` is named.

## 3. Content-bound active authority

`active.capability_matrix_sha256` **is** `digest(matrix object, vidtoolz.resolveCapabilityMatrix.v1)`. Every authorizing entry point first checks that the matrix object it was handed is that content (`active_authority_errors` → `CAPABILITY_MATRIX_NOT_ACTIVE`). Passing an invented matrix — even a schema-valid one, even with plausible promotion metadata, even citing the digest of the real zero-qualified matrix — qualifies nothing: the digest does not match, and `primitive_status`, `callable_method_set`, `provenance_errors`, `evaluate_eligibility` and `validate_transaction_set` all refuse (Codex F15-02).

## 4. Derived promotion state

`authority_lib.promotion_state(raw_capture_sha256, caps, es, rp, env, active)` derives, never reads:

```
CANDIDATE                (a well-formed capture resolves)
  -> REVIEWED_ACCEPTED   (a valid ACCEPT review of exactly that raw+derived pair exists)
  -> REVIEWED_REJECTED   (a valid REJECT review exists; terminal)
  -> PROMOTED_IN_REFREEZE (a valid reviewed REFREEZE_RECORD promotes exactly that capture)
  -> ACTIVE_QUALIFIED_READ (that successor matrix is the active matrix and the method derives QUALIFIED_CALLABLE through this capture)
```

`promotion_step` is the transition table with fail-closed guards; no state can be skipped, `REVIEWED_REJECTED` and `ACTIVE_QUALIFIED_READ` are terminal, and each state re-verifies the evidence of the previous one, so removing or altering any link (capture, review, refreeze, matrix) drops the state back rather than leaving a stale promotion in place.
