# SEMANTIC-VALIDATION.md — schema validity is not authorization (v1.1, FROZEN_NOW as doctrine; validators NOT runtime-qualified)

**SCHEMA-VALID != AUTHORIZED TO MUTATE.** JSON Schema proves shape. Authority requires a second layer, the *semantic validator*, implemented as a reference in `tools/authority_lib.py` and exercised by `tools/validate_v1_1.py` against fixtures only. It has not run against Resolve and is not runtime-qualified.

Relationships the semantic layer MUST enforce before any operation may execute (M3 onward):
- **permission × operation × milestone × scope**: `PERMISSIONS.json` lookup, default DENY; unknown anything → DENY; `mutation_allowed` only reachable at M3; `shared_library_allowed` never.
- **target scope × operation**: a plan's scope must be `SCRATCH_QUALIFICATION_LIBRARY` and its target contract `PROVISIONED`; `accepts_current_open_session_as_target` is false.
- **selector completeness**: every mutating operation names library UUID, project id, timeline id, target epoch, track type and integer index; non-APPEND operations also name `item_unique_id`, `expected_start`, `expected_end` (and, when known, expected pool id and marker customData).
- **guard binding**: `plan.h0_guard_digest` equals the current stable guard; otherwise `STALE_SNAPSHOT`.
- **dry-run law**: `dry_run` false only at M3.
- **verification-result eligibility**: `VERIFIED` requires `unrelated == []` and `missing_expected == []`; `is_human_approval` is always false.
- **journal transitions**: only the transitions in `authority_lib.JOURNAL_TRANSITIONS`; hash chain intact; intent before mutator.
- **commit eligibility**: a commit manifest exists only for a transaction that reached `PUBLISHED`.
- **expected/actual delta consistency**: comparator output must map every created identity and account for every field change.
- **coverage**: `coverage.complete` is false whenever a required domain is unobservable.

Fixtures under `fixtures/semantic/` are candidates that document the intended behaviour; passing them proves the reference implementation matches the documents, nothing more.
