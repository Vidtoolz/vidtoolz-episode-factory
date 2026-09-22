# resolve-control-production-read — isolated-session production READ-ONLY worker CANDIDATE 0.3.0

**Status: CANDIDATE_FOR_INDEPENDENT_REVIEW. Not deployed. No live production read has ever been performed.**

Successor to candidate `59a5593d` (0.2.1), which independent review **REJECTED**. This is a successor, not an amendment: `59a5593d`
is untouched in git and is used here as a test fixture that proves the defect it was rejected for. Derived from the frozen Phase 1
worker (`resolve-control/worker/resolve_worker.py`, 0.1.1, sha `371caf13…`, commit `77c26103`), which stays frozen and untouched.

- candidate worker sha256: `8caa235d956e13005c5e28208b8283646c6487391285503e76553686fe436527`
- accepted Hermes facade: `8e068fea2d4df5b9709c387f6444502bd7bc2091` — **unchanged**, not a line of it is touched here
- frozen Resolve Authority v1.20 and frozen Phase 1: **unchanged**

## Why the predecessor was rejected

Registration metadata plus a project UUID cannot prove which *physical* library an arbitrary, pre-existing Resolve handle is actually
backed by. The reviewer read B-only data while the worker verified A and journaled `ALLOWED`. Everything the old worker inspected —
the display name, the `.dblist` entry, the canonical root, the device/inode, even a `Project.db` content anchor — describes the
*filesystem*, not the *handle*. A byte-identical clone of the authorized library defeats all of it, and the operator's own
long-running session was never established by anything the worker observed.

`tests/test_prior_bypass_regression.py` extracts the rejected worker and compiler from git at `59a5593d` and reproduces that leak
end to end, then shows this candidate refusing the same session.

## What replaces inference: session provenance

Identity is no longer deduced from a handle. It is established **before** the handle exists, by constructing the session:

```
ACCEPTED human authority record (vidnux, Linux, ISOLATED_DISK_SESSION, ONE Disk library, explicit project UUIDs)
  -> deterministic compiler                    (LIVE policy only from an accepted, fully bound record; else a deny-all preview)
  -> deterministic session-profile generator   (a sealed profile directory registering EXACTLY ONE Project Library)
  -> operator launches a FRESH Resolve with that profile          (BMD_RESOLVE_CONFIG_DIR/SUPPORT_DIR/LOGS_DIR + XDG_CACHE_HOME)
  -> worker attests the live process           (single instance, own uid, pinned executable, started AFTER the seal, exactly the
                                                sealed profile environment, and the scripting endpoint owned by it or a descendant)
  -> library gate: the open library must be the profile's single registered library    (no discovery, no first-match)
  -> project gate: the current project UUID must be in the accepted allowlist
  -> one of the same nine read-only operations
```

A session that predates the seal, was launched with another profile, is one of several Resolve processes, or does not own the
scripting endpoint is refused **before** the Resolve scripting library is touched. The whole chain — policy digest, authority bytes
and acceptance semantics, the worker's own re-hashed bytes, the accepted facade commit, the sealed profile digest, every sealed
file's digest, the one-line registration, and the root's realpath/device/inode — is re-verified at **every** operation, and the
attested process identity is pinned for the worker's lifetime (a Resolve restart refuses with `SESSION_RESTARTED`).

Every refusal fails closed, emits only frozen `vrc.v1` error codes (semantics travel in `detail.reason`), and journals one explicit
authorization decision with its stage: `policy | authority | profile | session | library | project | resolve | pre-resolve`.

## Scope, deliberately narrow

v1 is **structurally** vidnux-only and Linux-only. PRESTO, VIDLAP2, Windows, UNC roots and network libraries (EKA, nelja,
PostgreSQL/QPSQL) cannot be expressed in the schema, cannot be compiled, and are refused by the worker. The authorized library must
be a local Disk library whose canonical root is its own realpath, pinned by device and inode.

**Operational consequence:** Resolve enforces a single instance per machine on Linux. An isolated production-read session is
therefore *mutually exclusive* with Mikko's normal Resolve session — the read window is a deliberate, operator-initiated act, not
something that can happen quietly alongside ordinary editing.

## Operator procedure (for a future, separately approved canary)

```bash
# 1. compile the accepted authority record into a LIVE policy
tools/compile_production_read_policy.py AUTHORITY.json policy.json --worker worker/resolve_worker.py

# 2. seal an isolated session profile (registers exactly the one authorized Disk library; never writes to the operator's config)
tools/generate_session_profile.py --authority AUTHORITY.json --policy policy.json --worker worker/resolve_worker.py \
    --source-config ~/.local/share/DaVinciResolve/configs --profile-root /run/user/1000/vrc-session --out session-profile.json

# 3. verify the whole deployment offline, before anything is launched
tools/verify_deployment_binding.py --facade-dir <installed facade> --facade-manifest data/accepted-facade-8e068fea.manifest.json \
    --worker worker/resolve_worker.py --authority AUTHORITY.json --policy policy.json --session session-profile.json

# 4. quit the normal Resolve; launch the isolated session with the recipe printed by step 2
# 5. start the worker with all five bound artifacts (see config/registry-production-read-candidate.json)
```

## Files

- `worker/resolve_worker.py` — the candidate. `diff` it against the frozen worker to review every change.
- `tools/compile_production_read_policy.py` — closed-schema validator + deterministic policy compiler (`SOURCE OUT --worker W [--preview]`).
- `tools/generate_session_profile.py` — deterministic isolated-profile generator and sealer.
- `tools/verify_deployment_binding.py` — offline facade/worker/authority/policy/profile pairing verifier.
- `schemas/resolveProductionReadAuthority.v1.schema.json`, `schemas/resolveProductionReadSessionProfile.v1.schema.json`.
- `data/accepted-facade-8e068fea.manifest.json` — the accepted facade's exact file set and digests, taken from git.
- `config/registry-production-read-candidate.json` — candidate registry shape (NOT the operator registry).
- `tests/test_production_read.py` (47), `tests/test_prior_bypass_regression.py` (4), `run-tests.sh` (+ `--self-test`).
  93 tests total including the frozen Phase 1 suites (22 + 20) run unchanged against these worker bytes.
- Governance: `../docs/resolve-integration/production-read/PRODUCTION-READ-AUTHORITY-v1.candidate.json` — deny-all, CANDIDATE,
  null approver, `library: null`, `projects: []`. It authorizes nothing.

## Carried, unrepaired

`PRR-P302`: the accepted facade shapes away the worker's `authorization` block (and the frozen `library_gate` detail) from tool
output. Review the raw envelope and the worker journal, not the facade's rendering. Repairing it would change accepted facade bytes,
which this mission has no authority to do.

WRITE AUTHORITY = NONE. PERSISTENT WORKER AUTHORITY = NONE. External Scripting = Local. No live production read. No deployment.
