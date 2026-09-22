# resolve-control-production-read — production-library READ-ONLY worker CANDIDATE (0.2.0)

**Status: CANDIDATE_FOR_INDEPENDENT_REVIEW. Not deployed. No live production read has been performed.**
Derived from the frozen Phase 1 worker (`resolve-control/worker/resolve_worker.py`, 0.1.1, sha 371caf13…, commit 77c26103), which remains
frozen and untouched. Candidate worker sha256: `c9290b6d62ff7ee6b4ac876d340c690c92d3ce605fee1d2ffc3208027924d466`.

## What it adds (and only this)
- An explicit **read profile** `--mode QUALIFICATION_READ|PRODUCTION_READ` (default QUALIFICATION_READ = frozen behaviour, byte-for-byte
  gate semantics; the frozen Phase 1 test suites pass unchanged against this file).
- **PRODUCTION_READ**: a read succeeds only when BOTH the CURRENT library (kind Disk + display name + verbatim registered root from the
  host's `.dblist`/`dblist.conf`) AND the CURRENT project UUID are listed for THIS host in a compiled policy
  (`vidtoolz.resolveProductionReadRuntimePolicy.v1`) whose file digest is pinned on the command line and re-verified at EVERY operation.
  Deny by default; empty never means all; wildcards and names are refused; network/PostgreSQL libraries (EKA, nelja) are refused (v1 Disk only).
- Nothing else: same nine read operations, same FORBIDDEN_OPS refusal before any Resolve call, same HMAC/replay/pool/journal/liveness code,
  no LoadProject/SetCurrentProject/SetCurrentDatabase/SaveProject anywhere. A wrong library or project fails; the worker never switches.
- Error mapping onto the FROZEN code set so the accepted facade (8e068fea) is untouched: library not authorized / policy missing, tampered or
  malformed → `LIBRARY_MISMATCH` (detail.reason = LIBRARY_NOT_AUTHORIZED | LIBRARY_IDENTITY_UNAVAILABLE | PRODUCTION_POLICY_MISSING |
  PRODUCTION_POLICY_PIN_MISMATCH | PRODUCTION_POLICY_INVALID | PRODUCTION_POLICY_WILDCARD | HOST_NOT_AUTHORIZED); project not authorized →
  `PROJECT_IDENTITY_MISMATCH` (detail.reason = PROJECT_NOT_AUTHORIZED); no project open → `PROJECT_NOT_OPEN`.
- Additive envelope fields (validator-tolerated): top-level `read_profile`, `worker.read_profile`, `worker.production_policy_sha256`,
  `worker.derived_from`, `resolve.authorization` (library/project/policy digest on success), `resolve.project_gate` (health, on refusal).

## Files
- `worker/resolve_worker.py` — the candidate (144 changed lines vs frozen; `diff` it against the frozen file).
- `tools/compile_production_read_policy.py` — deterministic compiler: governed source record → canonical runtime policy + digest.
- `schemas/resolveProductionReadAuthority.v1.schema.json` — source record schema.
- `config/registry-production-read-candidate.json` — candidate registry shape (NOT the operator registry).
- `tests/test_production_read.py`, `run-tests.sh` — 19 offline tests + frozen-suite regression (42 tests) against this worker.
- Governance: `../docs/resolve-integration/production-read/PRODUCTION-READ-AUTHORITY-v1.candidate.json` (hosts EMPTY = deny-all until Mikko selects a canary).

## Operating (future, after review + Mikko's canary selection + live canary acceptance)
`compile_production_read_policy.py AUTHORITY.json policy.json` → note `policy_file_sha256` → worker started with
`--mode PRODUCTION_READ --production-policy policy.json --production-policy-sha256 <policy_file_sha256>`. The operator registry stays
qualification-only until a governance record changes it. WRITE AUTHORITY = NONE. PERSISTENT WORKER AUTHORITY = NONE. External Scripting = Local.
