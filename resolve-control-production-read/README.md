# resolve-control-production-read — dedicated-capsule production READ-ONLY worker CANDIDATE 0.5.0

**Status: CANDIDATE_FOR_INDEPENDENT_REVIEW. Not deployed. No live production read has ever been performed.**

Successor to candidate `60e8bcd8` (0.4.0). That candidate's attestation was sound but it could only observe the session *after* it
existed: everything it verified — the sealed profile, the executable, the environment — lived in files the operator account could
rewrite between the seal and the launch. Independent review called that the launch-time profile-rollback P1.

The repair is not more hashing. It is a **host boundary**, approved by independent host review on 2026-09-22 (review manifest
`84f5bcbcf85e6cb7b1664b16ed1a715077a5e46c07da39c6f39304b4c6202de5`, 31/31 verified): a dedicated `vrc-capsule` account (uid 981) the
operator cannot enter, a root-owned zero-argument broker, and a frozen root-owned copy of the Resolve runtime. This candidate is the
application side of that boundary — the part the host review explicitly left open.

- candidate worker sha256: `b497865862dd0705257743de4897013bdea620d3f80e2cb519fd49f4a17d22b4`
- accepted Hermes facade `8e068fea2d4df5b9709c387f6444502bd7bc2091` — **unchanged**, not a line of it is touched here
- frozen Resolve Authority v1.20, frozen Phase 1, and the installed host primitive: **unchanged**

## What this candidate adds

| Finding | Defect | Repair |
|---|---|---|
| **P1 launch-time rollback** | Everything the worker attested lived in operator-writable files; the seal could be rolled back between sealing and launching. | `DEDICATED_CAPSULE_V1` is the only authorizable execution environment. The account, the broker bytes, the frozen runtime root, its manifest, the Resolve binary and the scripting library are pinned in the accepted authority and **re-derived from the running system** at startup and at every operation. |
| **Scripting fallback (host review, mandatory)** | The frozen runtime still ships the vendor loader, whose documented order is `import fusionscript` → `$RESOLVE_SCRIPT_LIB` → hardcoded `/opt/resolve/libs/Fusion/`. All three can reach bytes the operator may rewrite — and on this host the operator's own shell already exports those variables pointing into `/opt/resolve`. | Production mode never runs the vendor loader. `load_capsule_api()` loads the pinned extension itself: no inherited `RESOLVE_SCRIPT_*`/`PYTHON*`/`LD_*`, no pre-imported module, realpath contained in the frozen runtime, root-owned, digest equal to the runtime manifest — then checks `/proc/self/maps` and refuses if *anything* is mapped from `/opt/resolve`. |
| **Cross-account transport** | Hermes runs as the operator; the worker now runs as a different account. | The shared HMAC key is owned by the operator, granted to the capsule **read-only** by ACL, and its identity (`sha256(key)[:16]`) is named in the accepted authority. A key the capsule could rewrite, own, or substitute refuses. `tools/prepare_session_key.py` places and verifies it. |
| **Worker evidence inside one uid** | Worker and Resolve share the capsule account, so file modes alone protect nothing: a compromised Resolve could rewrite the journal or read the key. | The capsule init starts Resolve in its **own mount namespace** with every sealed evidence path masked by an empty read-only tmpfs, an **empty capability bounding set**, `no_new_privs`, and a **seccomp filter** that refuses `mount`, `umount2`, `unshare`, `setns`, `pivot_root`, `chroot`, the new mount API, `clone` with any namespace flag, `ptrace` and cross-process memory access. The worker re-reads those facts from `/proc` at every operation. |
| **No way to end a session** | The operator cannot signal, enter or inspect the capsule — by design — and therefore could not stop a running session. | A governed `session_stop`: an authenticated request on the same loopback transport, gated by the *whole* production chain, that takes no parameters and can name no process. The worker SIGKILLs the pid the launcher attested and exits; the capsule init exits with it and pid 1 of the capsule's pid namespace takes the capsule down. No new host authority, no privileged helper, no sudo rule. |
| **Evidence the operator can trust** | Nothing sealed the session record, so the only copy lived inside the capsule. | The governed stop seals the session journal into the finalized evidence directory at mode `0440`, once — a second finalization refuses rather than replacing it. On the approved host that directory is setgid `vrc-capsule:vidtoolz`, so the operator can read the sealed record and cannot rewrite it, and it is one of the paths masked out of Resolve's namespace. |

The nine read operations, the accepted facade and the frozen Phase 1 worker are unchanged. `session_stop` is not a Resolve operation:
it never attaches, and the accepted facade does not expose it.

## The chain a production read must satisfy

```
ACCEPTED human authority (vidnux, Linux, ISOLATED_DISK_SESSION, DEDICATED_CAPSULE_V1, the approved host primitive,
                          one Disk library, explicit project UUIDs, one caller identity, one control operation)
  -> compile_production_read_policy.py   LIVE policy only from an accepted, fully bound record; else a deny-all preview
  -> prepare_session_key.py              the shared HMAC key: operator-owned, capsule-readable, never capsule-writable
  -> generate_session_profile.py         a sealed profile: ONE registered library, EXACT tree, pinned root, evidence mask, confinement
  -> verify_deployment_binding.py        offline: facade + worker + authority + policy + profile (+ key, + attestation) are one deployment
  -> vrc-capsule-launch (root broker)    drops to uid 981 and starts the capsule
  -> vrc_capsule_init.py                 pid 1 of the capsule; starts Resolve CONFINED, then the worker; tears the capsule down
  -> launch_isolated_session.py          fresh nonce, explicit duplicate-free environment, confined child, runtime attestation
  -> worker, at EVERY operation:         policy + authority + own bytes + facade + profile digest + exact tree + root identity
                                         + host primitive + key placement + attestation + one process + capsule account + namespaces
                                         + seccomp + capabilities + evidence mask + read-only library + strictly-after-seal
                                         + exactly-once environment + nonce + closed listener attribution
  -> library gate -> project gate -> one of the same nine read operations
```

Every refusal fails closed, emits only frozen `vrc.v1` error codes (semantics in `detail.reason`), and journals one authorization
decision with its stage: `policy | authority | profile | attestation | capsule | session | library | project | session_stop | resolve |
pre-resolve`.

## Scope, deliberately narrow

v1 is **structurally** vidnux-only and Linux-only. PRESTO, VIDLAP2, Windows, UNC roots and network libraries (EKA, nelja,
PostgreSQL/QPSQL) cannot be expressed in the schema, cannot be compiled, and are refused by the worker.

**Operational consequence:** Resolve is single-instance on Linux, so an isolated production-read session is *mutually exclusive* with
Mikko's normal Resolve session.

## Files

- `worker/resolve_worker.py` — the candidate. `diff` it against `60e8bcd8` to review every change.
- `capsule/vrc_capsule_confine.py` — the confinement primitives (evidence mask, capability drop, seccomp filter). Deterministic bytes:
  the filter's sha256 is pinned in every sealed profile.
- `capsule/vrc_capsule_init.py` — the capsule's pid 1. **Not installed**; deployment is a separate, unauthorized step.
- `tools/compile_production_read_policy.py`, `tools/generate_session_profile.py`, `tools/launch_isolated_session.py`,
  `tools/verify_deployment_binding.py`, `tools/prepare_session_key.py`, `tools/session_stop.py`.
- `schemas/` — authority, session profile and runtime attestation schemas.
- `tests/test_production_read.py` (76), `tests/test_dedicated_capsule.py` (81), `tests/test_capsule_confinement.py` (20),
  `tests/test_reviewer_attacks_regression.py` (5), `tests/test_prior_bypass_regression.py` (4), plus the FROZEN Phase 1 suites
  (22 + 20) run unchanged against these bytes. **228 tests**, `./run-tests.sh` (+ `--self-test`).
- Governance: `../docs/resolve-integration/production-read/PRODUCTION-READ-AUTHORITY-v1.candidate.json` — deny-all, CANDIDATE,
  null approver, `library: null`, `projects: []`, placeholder key identity. It authorizes nothing.

## A note on the test seams

`SystemProbe`, the Resolve API and the capsule boundary are injected by **constructor/parameter only**. The production CLI passes none
of them and reads no environment switch, and a record naming a synthetic boundary is refused by a worker compiled against the frozen
constants (`HostPrimitive.test_a_synthetic_boundary_is_refused_by_a_production_worker`). The real kernel behaviour is not faked
anywhere: `tests/test_capsule_confinement.py` builds a real capsule with rootlesskit and runs the candidate's own law against it.

## Carried, unrepaired

- **CAP-01 (P2)** real-Resolve qualification inside the capsule is **not performed**: `vrc-capsule` is in no `video`/`render` group and
  cannot read the operator's X cookie, so starting the real Resolve there needs host changes this mission was not authorized to make.
  The exact requirement is in the sealed report.
- **ISOR-F07 (P3)** the local `scriptapp()` attach cannot name a target pid; binding stays indirect.
- **ISOR-F08 / PRR-P302 (P3)** the accepted facade shapes away the `authorization` block; review raw envelopes and the worker journal.
- **ISOR-F09 (P3)** single-instance Resolve makes a canary interrupt normal editing.

WRITE AUTHORITY = NONE. PERSISTENT WORKER AUTHORITY = NONE. External Scripting = Local. No live production read. No deployment.
No canary. No production-library ACL. No EKA.
