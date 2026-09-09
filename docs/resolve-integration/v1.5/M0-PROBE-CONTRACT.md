# M0-PROBE-CONTRACT.md — READ_PRIMITIVE_QUALIFICATION_PROBE (v1.5, FROZEN_NOW as contract; nothing here has run)

Machine form: `READ-PRIMITIVES.json.logical_operations.READ_PRIMITIVE_QUALIFICATION_PROBE` (`purpose_is_qualification: true`, `read_only: true`, `promotes_capability: false`, `evidence_output: CANDIDATE_EVIDENCE`, `failure_taxonomy`, every primitive with `receiver` and `expected_type`), `PERMISSIONS.json` entry `M0 / READ_PRIMITIVE_QUALIFICATION_PROBE`, `CAPABILITIES.json` rows with `probe_candidate: true`, `CAPABILITIES.json#refreeze` and `#qualification_pipeline`, `schemas/resolveEvidenceSet.schema.json` (`CAPABILITY_EVIDENCE`, `RAW_EVIDENCE`).

**PROBE_ALLOWED != QUALIFIED_READ. CANDIDATE_CAPABILITY_EVIDENCE != QUALIFIED_READ. CANDIDATE_OBSERVATION != QUALIFIED_OBSERVATION. Capability success is DERIVED, never label-trusted.**

## What can happen before qualification (zero QUALIFIED_READ rows)

`CAPABILITIES.json` has zero `QUALIFIED_READ` rows and `refreeze.reviewed: false` with empty `promoted_probe_ids` / `promoted_evidence_sha256`; `callable_method_set` under the frozen matrix is empty. The first legal M0 operation is this probe; `CONNECT`/`TIMEBASE_OBSERVE` are ineligible; `SNAPSHOT_CAPTURE` may only produce the pre-qualification capture of `SNAPSHOT-COMPLETENESS.md`, whose `method_provenance` entries are `NOT_CALLABLE`/`CANDIDATE_OBSERVATION` and whose dependent fields are `UNAVAILABLE`. Probe output may populate candidate observations; it never counts as ordinary authoritative OBSERVED snapshot data until the capability is refrozen and the snapshot cites the qualified evidence.

## Isolated target, exact reviewed authority, probe permission

| Question | Answer |
|---|---|
| Which getters may it test | exactly the 47 methods listed under the probe, each with its declared `receiver` (object class) and `expected_type` (documented 21.1 return type); nothing else, no mutator, no `run_script` |
| Required target | `SESSION` scope; derived state ≥ `ATTACHMENT_READY` from an evidence set bound to the **exact active manifest**; `READ_ONLY_JOURNAL` open; library not prohibited; no project/timeline binding |
| What it produces | per method: one `RAW_EVIDENCE` record (`content`, `content_sha256`) and one `CAPABILITY_EVIDENCE` record: `method`, `receiver_type`, `probe_id`, `probe_authority_version`, `raw_evidence_sha256`, **`parse`** `{parser, succeeded, error, getter_exception, observed_type, shape_ok}`, `parsed_observation {type, non_null}`, `result {classification, success, code}` whose classification MUST equal the classification derived from the parse facts (`classify_capability_record`), `qualification {reviewed: false, decision: null, review_raw_evidence_sha256: null, promoted_by: null}`; plus one `CONNECTION_OBSERVATION`; all envelope-bound to the session, content-addressed, appended to the read-only journal |
| How failure is recorded | `CAPABILITY_FAILURE` (getter raised/timed out, parse failed, unexpected type/shape, None) — the probe continues; `FATAL_TARGET_FAILURE` (wrong host/library/uuid/root/manifest/authority/version, stale/conflicting target) — the probe stops and the session derives `CONFLICT`. A failed observation can never be `ACCEPT`ed; a `SUCCESS` label over parsed failure facts is a semantic error |
| What the result is | candidate evidence, not qualification; `CAPABILITIES.json` is not modified by the run |

## Pipeline (machine-checkable; `CAPABILITIES.json#qualification_pipeline`)

`RAW_EVIDENCE` → `PARSE` → `PARSED_RESULT` → `REVIEW` → `REFREEZE` → `ACTIVE_CAPABILITY`. Each downstream step binds the exact upstream digest:
1. **RAW_EVIDENCE**: `content_sha256 = sha256(content)`, same session as the capability record;
2. **PARSE**: `parse.succeeded`, no `error`, no `getter_exception`, `observed_type == expected_type`, `shape_ok`, `parsed_observation.non_null`;
3. **PARSED_RESULT**: derived classification `SUCCESS` and label `SUCCESS` agree (label mismatch = error);
4. **REVIEW**: `qualification.reviewed: true`, `decision ACCEPT | REJECT`, `review_raw_evidence_sha256` = this record's raw hash (a review of evidence A cannot promote evidence B); only a derived SUCCESS may be accepted;
5. **REFREEZE**: successor `CAPABILITIES.json` whose `refreeze` block is `reviewed: true` and lists `promoted_probe_ids` **and** `promoted_evidence_sha256`, rows `QUALIFIED_READ` with `evidence_records` citing `(method, probe_id, raw_evidence_sha256, result SUCCESS, version_match true, reviewed_refreeze_version == matrix version)`; a `REFREEZE_RECORD` names the new matrix sha; a refreeze of failed evidence cannot create `QUALIFIED_READ` (`semantic_capabilities`, `primitive_status`);
6. **ACTIVE_CAPABILITY**: accepted records carry `promoted_by = {authority_version, capability_matrix_sha256, raw_evidence_sha256}` of the active matrix. `primitive_status` → `capability_record_qualifies` → `capability_success` re-derives every link against the ACTIVE authority: raw present and re-hashing, parse facts, receiver/type/shape, review reference, promotion reference, host/product/version/build, active refreeze naming the exact evidence. A label, a review or a refreeze can never override a parsed failure.

Adversarial fixtures (all rejected): parser failure + ACCEPT, getter exception + ACCEPT, failed parsed result + current refreeze, success label but raw/parsed facts indicate failure, missing raw evidence, tampered raw evidence, raw evidence from another session, parsed output wrong type, review references a different raw hash, promotion names a different raw hash, null result, unreviewed candidates, REJECTed, old refreeze, other authority version, wrong host/build/version/receiver, adjacent getter, refreeze not listing the raw hash, unreviewed refreeze block.

This contract authorizes no run. M0 begins only on Mikko's instruction after independent review of this bundle.
