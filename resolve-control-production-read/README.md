# resolve-control-production-read — attested isolated-session production READ-ONLY worker CANDIDATE 0.4.0

**Status: CANDIDATE_FOR_INDEPENDENT_RE-REVIEW. Not deployed. No live production read has ever been performed.**

Successor to candidate `4ae35e7c` (0.3.0), which independent review **REJECTED** with 2×P1 and 3×P2. That candidate had the right
architecture — session provenance instead of handle interrogation — but an incomplete attestation boundary. This is the repair, not
an amendment: `4ae35e7c` and `59a5593d` are untouched in git and both are used here as test fixtures that prove the defects they were
rejected for. Derived from the frozen Phase 1 worker (`resolve-control/worker/resolve_worker.py`, 0.1.1, sha `371caf13…`, commit
`77c26103`), which stays frozen and untouched.

- candidate worker sha256: `d2a10dd521f1035e25657b96cf9d9579d10ca31aecc7d7b94310a6d080307584`
- accepted Hermes facade `8e068fea2d4df5b9709c387f6444502bd7bc2091` — **unchanged**, not a line of it is touched here
- frozen Resolve Authority v1.20 and frozen Phase 1: **unchanged**

## What the review found, and what closed it

| Finding | Defect | Repair |
|---|---|---|
| **P1 ISOR-F01** | Linux allows duplicate environment entries. glibc `getenv()` takes the **first**; the worker's parser built a dict and kept the **last**. An unauthorized cloned-B profile first + the sealed-A value last let Resolve open B while the worker attested A — `LIBRARY_B_ONLY_SECRET` was returned and journaled `ALLOWED`. | `SystemProbe.environ_entries()` returns the **raw ordered list**; the collapsing parser is gone. Every security-relevant key must occur **exactly once** — zero is `SESSION_ENV_MISSING`, two or more is `SESSION_ENV_AMBIGUOUS`. Ambiguity itself denies, even when both values are correct. |
| **P1 ISOR-F02** | Listener discovery skipped `/proc/<pid>/fd` directories it could not read, so an unattributable LISTEN inode could hide beside a legitimate owner. | Closed law: every LISTEN inode on the scripting port must be **attributed** to a process, and every such process must be the attested Resolve or a descendant. An unattributed inode, an unreadable socket table, or a listener set that changes while it is mapped all refuse (`SESSION_ENDPOINT_UNATTRIBUTED` / `UNVERIFIABLE` / `UNSTABLE`), with a bounded stable-snapshot retry. |
| **P2 ISOR-F03** | `process_start_epoch == seal_epoch` was accepted; wall-clock seconds cannot order a seal and a launch inside the same second. | The ordering law moved to the **monotonic boot clock**: the profile records `seal_uptime` (`/proc/uptime`) and the process's own boot-relative start (`stat` field 22 ÷ `SC_CLK_TCK`) must be **strictly greater**. Independently, a fresh **session nonce** generated after the seal must be present exactly once in the process environment — a pre-existing process cannot carry it. |
| **P2 ISOR-F04** | Relative and symlinked profile roots were accepted, and a symlinked root let the manifest sit physically inside the profile. | The generator refuses a relative root, a symlinked root or a symlinked parent, and compares **realpaths** when requiring the manifest to live outside. The root's `realpath`/`dev`/`ino` are pinned in the manifest and rechecked every operation. |
| **P2 ISOR-F05** | The seal listed file digests but not the file **set**; post-seal additions were ignored. | The manifest carries the **exact tree** (every file with its digest, every directory). At every operation the worker enumerates the root and requires exactly that, plus at most a bounded, explicitly listed runtime-volatile allowlist. Any symlink anywhere refuses. `config/.activedb` is the one file Resolve may rewrite, and its content stays constrained to the single authorized library. |
| **P3 ISOR-F06** | The executable digest was recorded but only path and size were enforced. | `realpath` + size + **sha256** are all enforced; the digest is recomputed whenever the inode's identity, size, mtime or ctime changes (an in-place edit always bumps ctime). |

## The chain a production read must satisfy

```
ACCEPTED human authority record (vidnux, Linux, ISOLATED_DISK_SESSION, ONE Disk library, explicit project UUIDs)
  -> compile_production_read_policy.py   LIVE policy only from an accepted, fully bound record; else a deny-all preview
  -> generate_session_profile.py         a sealed profile: EXACTLY ONE registered library, EXACT tree, pinned root identity
  -> verify_deployment_binding.py        offline: facade + worker + authority + policy + profile (+ attestation) are one deployment
  -> launch_isolated_session.py          ephemeral, operator-run: fresh nonce, explicit duplicate-free environment, Resolve launched,
                                         runtime attestation written OUTSIDE the profile (pid, start ticks, boot, exe digest, nonce digest)
  -> worker, at EVERY operation:         policy + authority bytes + own bytes + facade + profile digest + exact tree + root identity
                                         + attestation digest + one process + owner + executable sha + strictly-after-seal + exactly-once
                                         environment + nonce + closed listener attribution
  -> library gate (the profile's single library) -> project gate (allowlisted UUID) -> one of the same nine read operations
```

Every refusal fails closed, emits only frozen `vrc.v1` error codes (semantics in `detail.reason`), and journals one authorization
decision with its stage: `policy | authority | profile | attestation | session | library | project | resolve | pre-resolve`.

## Scope, deliberately narrow

v1 is **structurally** vidnux-only and Linux-only. PRESTO, VIDLAP2, Windows, UNC roots and network libraries (EKA, nelja,
PostgreSQL/QPSQL) cannot be expressed in the schema, cannot be compiled, and are refused by the worker.

**Operational consequence:** Resolve is single-instance on Linux, so an isolated production-read session is *mutually exclusive* with
Mikko's normal Resolve session, and quitting Resolve ends the session permanently (a new seal + launch is required).

## Files

- `worker/resolve_worker.py` — the candidate. `diff` it against the frozen worker to review every change.
- `tools/compile_production_read_policy.py` — closed-schema validator + deterministic policy compiler.
- `tools/generate_session_profile.py` — deterministic isolated-profile generator and exact-tree sealer.
- `tools/launch_isolated_session.py` — the ephemeral operator launcher that creates the attested session.
- `tools/verify_deployment_binding.py` — offline facade/worker/authority/policy/profile/attestation pairing verifier (`--pre-launch` before a session exists).
- `schemas/` — authority, session profile and runtime attestation schemas.
- `data/accepted-facade-8e068fea.manifest.json` — the accepted facade's exact file set and digests, taken from git.
- `config/registry-production-read-candidate.json` — candidate registry shape (NOT the operator registry).
- `tests/test_production_read.py` (76), `tests/test_reviewer_attacks_regression.py` (5), `tests/test_prior_bypass_regression.py` (4),
  `run-tests.sh` (+ `--self-test`). **127 tests** including the frozen Phase 1 suites (22 + 20) run unchanged against these bytes.
- Governance: `../docs/resolve-integration/production-read/PRODUCTION-READ-AUTHORITY-v1.candidate.json` — deny-all, CANDIDATE,
  null approver, `library: null`, `projects: []`. It authorizes nothing.

## Carried, unrepaired

- **ISOR-F07 (P3)** the local `scriptapp()` attach cannot name a target pid; binding stays indirect (one Resolve, born from the sealed
  profile, sole attributable owner of the scripting endpoint).
- **ISOR-F08 / PRR-P302 (P3)** the accepted facade shapes away the `authorization` block; review raw envelopes and the worker journal.
- **ISOR-F09 (P3)** single-instance Resolve makes a canary interrupt normal editing.

WRITE AUTHORITY = NONE. PERSISTENT WORKER AUTHORITY = NONE. External Scripting = Local. No live production read. No deployment.
