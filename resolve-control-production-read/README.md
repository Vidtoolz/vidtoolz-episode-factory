# resolve-control-production-read — production-library READ-ONLY worker CANDIDATE (0.2.1, repair of PRR-F01..F06)

**Status: CANDIDATE_FOR_INDEPENDENT_RE-REVIEW. Not deployed. No live production read has ever been performed.**
Derived from the frozen Phase 1 worker (`resolve-control/worker/resolve_worker.py`, 0.1.1, sha `371caf13…`, commit 77c26103), which
stays frozen and untouched. Candidate worker sha256: `620fae2e8269489ad43684adc0ecb9488e26cc8a9c7f6b81c73bb299462deb7d`.
Predecessor candidate 0.2.0 (`54b2c690`) was REJECTED by independent review; this is the repair, not an amendment.

## The chain a production read must satisfy
```
ACCEPTED human authority record (status ACCEPTED + approver Mikko + approval date + acceptance-record path)
  -> deterministic compiler (native closed-schema validation; LIVE policy only from an accepted, fully bound record)
  -> policy file pinned by sha256 on the worker command line, re-verified at EVERY operation
  -> worker verifies: policy body digest, source-authority BYTES + acceptance semantics, its OWN sha256, accepted facade commit, host grant
  -> current library: Disk only, exactly one unambiguous registration entry, strict per-platform grammar, absolute non-UNC root
  -> physical root: realpath (symlinks/junctions resolved) + device/inode, compared with the policy's canonical pin
  -> current project UUID listed under that library
  -> content anchor: Project.db under the physical root carries the reported project + timeline UUIDs and the project set matches
  -> one of the same nine read-only operations
```
Any failure refuses, fails closed, and is journaled with an explicit stage (`policy | library | project | content | resolve | pre-resolve`).

## What the repair changed (per finding)
- **PRR-F01** A populated CANDIDATE record, or ACCEPTED with a null/missing/invalid approver, no approval date or no acceptance-record
  reference, can no longer produce a usable policy: the compiler refuses a LIVE policy (`--preview` yields a `live:false`, `hosts:{}`
  artifact) and the worker independently re-checks acceptance semantics on the source bytes at every operation.
- **PRR-F02** Native closed-schema validation (unknown fields, types, enums, UUID/40-hex/64-hex patterns, exact law strings) precedes
  compilation. The worker verifies the source record's **bytes** against the policy's `source_record_sha256`, its **own** sha256 against
  the worker pin, and the accepted facade commit against a constant compiled into the worker. A re-pinned policy naming another worker,
  another facade, another source or a project the accepted record does not grant is refused.
- **PRR-F03** The frozen qualification parser is restored byte-for-byte and is never used by production mode. Production mode has its own
  strict grammar (exactly six colon fields; platform-specific Disk forms; `NOTDISK`, truncated, quoted, relative, UNC, `.`/`..`,
  trailing-separator and empty-name records invalidate the file), rejects duplicate/conflicting registrations outright (no first-match),
  resolves the registered root to a canonical physical identity, and binds the open handle to that root with a content anchor.
- **PRR-F04** Every PRODUCTION_READ request journals one authorization decision (ALLOWED / DENIED / NOT_REACHED / NOT_APPLICABLE) with
  stage, reason, code, policy digest, library identity (name, registration root, realpath, dev, ino), project UUID and content digest —
  separate from transport liveness and the Resolve probe. The record is a per-request slot, so a refusal that discards the Resolve
  snapshot still produces evidence. Health liveness semantics are unchanged.
- **PRR-F05** `run-tests.sh` uses `set -o pipefail`, no `tee`/`tail` masking, per-suite exit codes, an aggregate nonzero exit, and a
  minimum collected-test count per suite so a truncated suite cannot pass silently. `./run-tests.sh --self-test` proves propagation.
- **PRR-F06** The production CLI calls `load_production_api()`, which loads only the real DaVinciResolveScript and refuses to start if any
  `VRC_FAKE*` / `RESOLVE_FAKE_API` / `VRC_TEST_API` variable is present. The fake-Resolve seam (`load_api()`) is never reachable from
  `main()`; offline tests inject the fake module directly into `Worker(...)`.
- **PRR-P301** `--mode`, `--host-id`, `--require-library`, `--production-policy`, `--production-policy-sha256` and
  `--production-authority` are refused if given twice (no last-value-wins).
- **PRR-P302** carried unrepaired: the accepted facade still shapes away the authorization block. Use raw envelope/journal evidence.

## Unchanged from the accepted system
Nine read operations, `READ_ONLY_OPS` and `FORBIDDEN_OPS` byte-identical to frozen, refusal before any Resolve attach, loopback-only
bind, HMAC + durable replay guard, bounded pool, session anchor and controller liveness, journal shape, and the accepted facade
(`8e068fea`, nine tools, no source change): the candidate emits only frozen error codes and carries semantics in `detail.reason`.
Network/PostgreSQL libraries (EKA, nelja) are refused by compiler and worker regardless of display name; UNC roots are refused.

## Files
- `worker/resolve_worker.py` — the candidate. `diff` it against the frozen worker to review every change.
- `tools/compile_production_read_policy.py` — validator + deterministic compiler (`SOURCE.json OUT.json --worker WORKER.py [--preview]`).
- `schemas/resolveProductionReadAuthority.v1.schema.json` — source-record schema (the compiler enforces it natively).
- `config/registry-production-read-candidate.json` — candidate registry shape (NOT the operator registry).
- `tests/test_production_read.py` (22 tests), `run-tests.sh` (+ `--self-test`) — offline only; fake Resolve and real temp-dir libraries.
- Governance: `../docs/resolve-integration/production-read/PRODUCTION-READ-AUTHORITY-v1.candidate.json` — deny-all, CANDIDATE, null approver.

WRITE AUTHORITY = NONE. PERSISTENT WORKER AUTHORITY = NONE. External Scripting = Local.
