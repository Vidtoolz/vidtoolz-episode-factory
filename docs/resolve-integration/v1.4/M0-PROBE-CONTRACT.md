# M0-PROBE-CONTRACT.md — READ_PRIMITIVE_QUALIFICATION_PROBE (v1.4, FROZEN_NOW as contract; nothing here has run)

Machine form: `READ-PRIMITIVES.json.logical_operations.READ_PRIMITIVE_QUALIFICATION_PROBE` (`purpose_is_qualification: true`, `read_only: true`, `promotes_capability: false`, `evidence_output: CANDIDATE_EVIDENCE`, `failure_taxonomy`, `failure_law`, `output`, every primitive `probe_allowed: true` with its `receiver`), `PERMISSIONS.json` entry `M0 / READ_PRIMITIVE_QUALIFICATION_PROBE` (prerequisite `PROBE_ALLOWED_PRIMITIVES`), `CAPABILITIES.json` rows with `probe_candidate: true`, `CAPABILITIES.json#refreeze` and `#qualification_pipeline`.

**PROBE_ALLOWED != QUALIFIED_READ. CANDIDATE_CAPABILITY_EVIDENCE != QUALIFIED_READ.** A probe may call a `DOCUMENTED_NOT_QUALIFIED` getter because calling it *is the test*. Its result is recorded, never acted on, and never qualifies anything by itself.

## What can happen before qualification (zero QUALIFIED_READ rows)

At v1.4 `CAPABILITIES.json` has zero `QUALIFIED_READ` rows and `refreeze.reviewed: false`; `callable_method_set` over the frozen matrix is empty (validator `zero-qualified-reads`). Therefore:
- the **first legal M0 operation is this probe** (target requirement SESSION; derived state `ATTACHMENT_READY`; read-only journal open; bundle independently verified against the exact active manifest);
- `CONNECT` and `TIMEBASE_OBSERVE` (`REFUSE` fallbacks) are not eligible;
- `SNAPSHOT_CAPTURE` is eligible in degraded mode once `ATTACHED_READ_ONLY` is derived, but it is **not operationally complete**: with 0 callable primitives it may produce only the pre-qualification capture defined in `SNAPSHOT-COMPLETENESS.md §Pre-qualification capture` (connection/library domains from the session's `CONNECTION_OBSERVATION`; every project/timeline field `UNAVAILABLE` with reason; no tracks, items or markers; `complete: false`). Its use is to anchor session/target identity and to exercise the honest degrade path; it is never a plan H0 and never proves any read capability.

## Isolated target, exact reviewed authority, probe permission

| Question | Answer |
|---|---|
| Which getters may it test | exactly the 47 methods listed under the probe in `READ-PRIMITIVES.json` (all `read:` rows of `CAPABILITIES.json`, each `probe_candidate: true`), each with its declared `receiver` (object class); nothing else, no mutator, no `run_script` |
| Why testing them is allowed | they are documented in the 21.1 stub/README but have no evidence on 21.1.0 build 14; the probe's purpose is qualification; results are never used to build a snapshot, plan or decision |
| Required target | `SESSION` scope; derived state ≥ `ATTACHMENT_READY` from an evidence set bound to the **exact active manifest** (`BUNDLE_VERIFICATION` for this sha and `1.4.0`, verifier ≠ preparer, this host), a `LAUNCH_RECIPE` of the current session bound to the provisioning record; `READ_ONLY_JOURNAL` open; library not prohibited; no project or timeline binding required or established |
| Session | isolated qualification session per `TARGET-CONTRACT.json.session` (dedicated config/support roots, port 1144 closed, never Mikko's live session, never `EKA`, never `Local Database`) |
| What it produces | **`CANDIDATE_CAPABILITY_EVIDENCE` only**: one `CAPABILITY_EVIDENCE` record per method (`method`, `receiver_type`, `probe_id`, `probe_authority_version`, `raw_evidence_sha256`, `parsed_observation` — type/shape, values hashed not copied — `result {classification, success, code}`, `qualification {reviewed: false, decision: null, promoted_by: null}`), one `RAW_EVIDENCE` record per capture (`content`, `content_sha256`), and one `CONNECTION_OBSERVATION`; all envelope-bound to the session and content-addressed; all appended to the read-only journal |
| How failure is recorded | per `failure_taxonomy`: a getter that raises, times out, returns an unexpected type or returns None is a **`CAPABILITY_FAILURE`** record (`success: false`, code `GETTER_RAISED`/`GETTER_TIMEOUT`/`UNEXPECTED_RETURN_TYPE`/`GETTER_RETURNED_NONE`); the probe continues. Wrong host/library/uuid/root, stale session, conflicting target, wrong manifest/authority/version is a **`FATAL_TARGET_FAILURE`** record that stops the probe and makes the session's derived state `CONFLICT`. A failed observation can never be `ACCEPT`ed (`semantic_capability_record`). Nothing is retried silently |
| What the result is | candidate evidence, not qualification. `promotes_capability: false` is machine-checked. `CAPABILITIES.json` is not modified by the run |

## Promotion pipeline (machine-checkable; `CAPABILITIES.json#qualification_pipeline`)

1. candidate `CAPABILITY_EVIDENCE` (`qualification.reviewed: false`) + `RAW_EVIDENCE` from a probe run;
2. **independent review** per record: `qualification.reviewed: true`, `decision ACCEPT | REJECT`; only a `SUCCESS` observation may be accepted;
3. **capability refreeze**: a new `CAPABILITIES.json` (successor bundle) whose `refreeze` block is `reviewed: true` with `review_decision_ref` and `promoted_probe_ids`, and whose rows become `QUALIFIED_READ` with `evidence_records` citing `(method, probe_id, raw_evidence_sha256)`, `result SUCCESS`, `version_match: true`, `reviewed_refreeze_version` equal to that matrix version (`semantic_capabilities`);
4. a `REFREEZE_RECORD` (`kind M0_READ_REQUALIFICATION`, `reviewed: true`) naming the new matrix's `capability_matrix_sha256` and the active manifest/authority;
5. accepted records carry `qualification.promoted_by = {authority_version, capability_matrix_sha256}` of that active matrix;
6. the evaluator (`primitive_status` → `capability_record_qualifies`) compares every record to the **active** authority: a record promoted by an older refreeze, another authority version, another host/product/version/build, a different receiver, a failed result, an unreviewed or rejected record, a record for an adjacent getter, or one whose raw evidence is missing or does not re-hash **never** qualifies (validator `capability-qualification-negative`, fixtures `attached-evidence-*`, eligibility cases `m0-connect-deny-hyp-*`).

Fixtures: `fixtures/eligibility/cases.json` (`m0-probe-allow-attachment-ready`; denials for unprovisioned, wrong binary pin, self-verified bundle, other-host bundle, historical-only bundle, no/ghost/previous session, missing journal, declared state, tampered/unbound records, fatal probe failure; `m0-probe-allow-after-capability-failure-only`; `m0-connect-deny-*`; `m0-connect-allow-hypothetical-refrozen-matrix` against `fixtures/eligibility/capabilities-hypothetical-refreeze.json`, which is explicitly **HYPOTHETICAL_NOT_AUTHORITY**).

This contract authorizes no run. M0 begins only on Mikko's instruction after independent review of this bundle.
