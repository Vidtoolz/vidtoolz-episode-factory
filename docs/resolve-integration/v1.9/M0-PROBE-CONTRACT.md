# M0-PROBE-CONTRACT.md — READ_PRIMITIVE_QUALIFICATION_PROBE (v1.7, FROZEN_NOW as contract; nothing here has run)

Machine form: `READ-PRIMITIVES.json.logical_operations.READ_PRIMITIVE_QUALIFICATION_PROBE` (`purpose_is_qualification: true`, `read_only: true`, `promotes_capability: false`, `evidence_output: RAW_CAPABILITY_CAPTURE`, `capture_shim_contract: CAPTURE-SHIM.md`, `phases`, `failure_taxonomy`, and a full expectation spec per primitive), `PERMISSIONS.json` entry `M0 / READ_PRIMITIVE_QUALIFICATION_PROBE`, `CAPABILITIES.json` rows with `probe_candidate: true`, `CAPABILITIES.json#refreeze` and `#qualification_pipeline`, `schemas/resolveEvidenceSet.schema.json` (`RAW_CAPABILITY_CAPTURE`, `DERIVED_CAPABILITY_RESULT`, `REVIEW_DECISION`, `REFREEZE_RECORD`, `IDENTITY_*_OBSERVATION`).

**PROBE_ALLOWED != QUALIFIED_READ. A CAPTURE != EVIDENCE THAT SOMETHING WORKS. CANDIDATE_OBSERVATION != QUALIFIED_OBSERVATION. The probe never classifies: meaning is derived by the reference parser and decided by a human who is not the operator.**

## What can happen before qualification (zero QUALIFIED_READ rows)

`CAPABILITIES.json` has zero `QUALIFIED_READ` rows and `refreeze.reviewed: false` with empty promotion lists; `callable_method_set` under the frozen matrix is empty. The first legal M0 operation is this probe; `CONNECT` / `TIMEBASE_OBSERVE` are ineligible; `SNAPSHOT_CAPTURE` may only produce the pre-qualification capture of `SNAPSHOT-COMPLETENESS.md`, whose `method_provenance` entries are `NOT_CALLABLE` or `CANDIDATE_OBSERVATION` and whose dependent fields are `UNAVAILABLE`. Probe output never becomes ordinary authoritative OBSERVED snapshot data until the capability is refrozen and the snapshot cites the promoted capture.

## Isolated target, exact reviewed authority, probe permission

| Question | Answer |
|---|---|
| Which getters may it call | exactly the 47 methods listed under the probe, each with its declared receiver class, argument types, nullability, expected type, shape rule and completeness (`PRIMITIVE-SPEC.md`); nothing else; no mutator; no script tool |
| Required target | `SESSION` scope; derived state ≥ `ATTACHMENT_READY` from an evidence set bound to the **exact active manifest**; `READ_ONLY_JOURNAL` open; library not prohibited; no project/timeline binding |
| How it calls | through the capture shim of `CAPTURE-SHIM.md`, which refuses non-allowlisted, non-getter, write-like and monkeypatched names **before invocation** and records the mechanical outcome only |
| What it produces | per attempt one `RAW_CAPABILITY_CAPTURE` (`RAW-CAPTURE.md`): run identity, authority binding, observed environment, target, receiver class **and navigation path**, method, typed arguments, mechanical outcome with its typed payload, serialization and truncation facts, stream digests, shim identity, operator; plus one `CONNECTION_OBSERVATION`, the identity read passes (`IDENTITY-EVIDENCE.md`) and an append-only finalized evidence root (`EVIDENCE-ROOT.md`) |
| What it must not produce | any success, qualification, expected-type, shape, review or promotion field (`RAW-CAPTURE.md` §2); any normalization of an empty return, a `None` or an exception into a benign value; any change to `CAPABILITIES.json` |
| How failure is recorded | mechanically, then derived offline: `EXCEPTION`, `TIMEOUT`, `UNSUPPORTED`, `TYPE_MISMATCH`, `NULL_NOT_ALLOWED`, `TRUNCATED`, `MALFORMED`, `RECEIVER_MISMATCH`, `ARGS_MISMATCH`, `TRANSPORT_FAILURE`, `REFUSED`, `UNSERIALIZABLE` (family `CAPABILITY_FAILURE` → reviewed `REJECT`, the run continues) or `BINDING_MISMATCH` (family `FATAL_TARGET_FAILURE` → the run STOPS and the session derives `CONFLICT`) |
| What the result is | candidate captures, not qualification |

## Pipeline (machine-checkable; `CAPABILITIES.json#qualification_pipeline`)

`RAW_CAPABILITY_CAPTURE` → `derive_capability_result` → `REVIEW_DECISION` → `REFREEZE_RECORD` + successor matrix → active capability → derived promotion state. Each step binds the exact upstream digest:

1. **M0A CAPTURE** — sealed with `raw_digest` over the canonical body; written once, never overwritten (`EVIDENCE-ROOT.md`).
2. **M0B DERIVE** — `authority_lib.derive_capability_result(capture, primitive_spec, contract_env, active)` in the fixed order of `REFERENCE-PARSER.md`; `parser_version` + `parser_sha256` identify the parser; a stored `DERIVED_CAPABILITY_RESULT` is only a cache and must equal the recomputation.
3. **M0B REVIEW** — `REVIEW_DECISION` binding `raw_capture_sha256`, `derived_result_sha256`, parser and `primitive_spec_sha256`; `ACCEPT` only over a recomputed `SUCCESS`; reviewer ≠ operator (`REVIEW-REFREEZE.md`).
4. **M0C REFREEZE** — successor `CAPABILITIES.json` + `REFREEZE_RECORD` promoting exactly those digests, naming parent and successor matrix content digests, the environment and a human approver; Mikko approves.
5. **M0D ACTIVE** — `active.capability_matrix_sha256` is the successor matrix's content digest; `primitive_status` → `capability_qualification` recomputes every link on every call: matrix content, refreeze block, refreeze record, capture well-formedness and binding, the parser's `SUCCESS`, the review's validity. A label, a review or a refreeze can never override a derived failure, and an invented matrix can never stand in for the active one.

Adversarial fixtures (all rejected): raw `RAISED` + `ACCEPT` review; the same with a fabricated successful parse block injected into the capture; timeout, attribute-missing, wrong-type, null, truncated and unserializable captures with `ACCEPT` reviews; tampered capture bytes; missing capture; review of a different capture; review bound to an old parser or an old spec; reviewer = operator; `REJECT` promoted; refreeze with a stale parser, a stale spec, another session, another probe, an unlisted capture, an unreviewed block; a forged `DERIVED_CAPABILITY_RESULT` cache; an invented `QUALIFIED_READ` matrix under the real frozen digest; evidence from another host or build.

This contract authorizes no run. M0A begins only on Mikko's instruction after independent review of this bundle, and M0C additionally requires Mikko's approval of the successor bundle.

## v1.8: evidence goes to exactly one store

Every artifact an M0A run produces — raw frames, derived results, human reviews, promotion records — is written
through `tools/evidence_store.py` and nothing else. The probe does not choose paths, does not create the layout and
does not decide what a valid session is. The runbook step that used to describe an evidence root maintained by the
capture shim is superseded: that implementation is removed (precedence S47).

A run is complete only when the session is **finalized**, which writes the closed-world inventory, and
`verify()` returns no errors. A session that is not finalized is not an M0A evidence package, whatever it contains.
