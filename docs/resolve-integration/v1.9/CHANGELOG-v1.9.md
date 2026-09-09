
# CHANGELOG — Resolve authority bundle v1.9 (extremely narrow correction of v1.8)

- **Parent:** v1.8.0, branch `docs/resolve-authority-freeze-v1.8` @ `41081f7f4f227255f44bbb3a94637928187289f0`, manifest `727bcaad6ee49f1439eb84b33bf36cb11d2c94d41165b4b092f728a167626d86`. v1.8 committed its bundle and its DOC-AUTHORITY registration together, so its `semantic_head` is the same commit; the manifest records both fields so the lineage shape stays uniform.
- **This version:** 1.9.0, directory `docs/resolve-integration/v1.9/`, own `FREEZE-MANIFEST.json`.
- **Input of record:** Codex's v1.8 adjudication — 1856/1856 supplied validation twice, ES-1 and ES-2 closed, one EVIDENCE_STORE_AUTHORIZING implementation, closed-world detection, content addressing, capture shim, documentation precedence, STORE-14, legacy traversal and every v1.7 regression passing — with four remaining evidence-store integrity defects: **S19-1** symlinked session root accepted, **S19-2** inventory/session semantics incomplete, **S19-3** attempt id binding too weak, **S19-4** finalized permission change undetected.
- **Scope discipline:** only those four findings and their versioning, documentation and test consequences. Nothing that passed v1.8 independent review was redesigned. No Resolve launched or contacted; no `EKA`; no M0; no M0A probe executed; no merge; v1.0–v1.8 bytes untouched; unrelated production and Earth Studio code untouched.

All four were reproduced against the frozen v1.8 bundle before anything was changed. Two turned out worse than
reported: **S19-3** did not merely permit a collision, it accepted a reused attempt id in another layer and created a
**second distinct record**; and the symlinked root of **S19-1** passed create, finalize *and* verify.

## S19-1 — root trust boundary established before any resolution

`RootBoundary` inspects the configured evidence root with `lstat` and no resolution, refusing `ROOT_SYMLINK_REFUSED`
for a symlink and `ROOT_NOT_A_DIRECTORY` otherwise; then the session directory entry itself
(`SESSION_SYMLINK_REFUSED`). The boundary keeps the literal path and the root's device and inode, and re-checks them
on every operation (`ROOT_REPLACED`). No `realpath` appears anywhere on the trust path. Reads use `O_NOFOLLOW`.
Honest scope: detection, not a TOCTOU guarantee, and inode reuse is explicitly not claimed to be detected.

## S19-2 — session identity and semantic reconciliation

A frozen session identity tuple of sixteen fields is digested into `session_identity_sha256` and carried by the
manifest, the inventory and the finalization marker. The session directory basename **is** the session id (policy A)
and the verifier recomputes it. Every record's storage name is its semantic key over (session, layer, logical
identity, content digest); the inventory records layer, record key, logical identity, attempt ids and keys, file type,
mode and record-internal session and probe ids, and reconciles all of them. Verification PASS now requires four zeros:
missing, unexpected, changed and **semantic_mismatch**.

## S19-3 — attempt uniqueness is a tuple, not a digest

The canonical key is `(session_id, layer, logical_identity, attempt_id)` bound to the record bytes. A logical identity
is required on every write. Cross-layer and cross-identity reuse of an attempt id are refused by name
(`ATTEMPT_ID_CROSS_LAYER`, `ATTEMPT_ID_CROSS_IDENTITY`); the same tuple with different bytes is `ATTEMPT_ID_REUSED`;
only the identical tuple with identical bytes is idempotent. Attempt indexes are built from a list and duplicate tuple
keys refuse before any map exists.

## S19-4 — POSIX file type and permission mode are frozen metadata

Canonical modes are set explicitly with `chmod` rather than left to the umask, recorded per entry in the inventory,
and reconciled at verification as `MODE_MISMATCH`. A regular file replaced by another filesystem type fails even
though the path exists. No inode, timestamp or owner is recorded.

## Also changed

- `tools/evidence_store.py` — store version `vidtoolz.resolveEvidenceStore.v3`, session schema `…Session.v3`, inventory schema `…Inventory.v2`, new finalization schema `vidtoolz.resolveEvidenceFinalization.v1`; new domains for session identity, record key and attempt key; `verify_summary()` alongside `verify()`.
- `tools/authority_lib.py` — the new store/session/inventory/finalization constants and platform scope; the session-manifest law gains `evidence_finalization_schema`, `session_identity_sha256`, `session_dir_basename` and `platform_scope`; the lineage law pins v1.8.
- `M0A-BINDING-VALUES.json` — adds the finalization schema, the platform scope, the session path identity law, the session identity tuple, the attempt tuple law, the record key law, the mode metadata law, the root symlink refusal law and the verification counters.
- `tools/validate_v1_9.py` — new sections `evidence-root-trust`, `evidence-session-identity`, `evidence-semantic-inventory`, `evidence-attempt-tuple`, `evidence-mode-authority`; the ES-1/ES-2 sections retained and re-run.
- `FINDING-RESOLUTION-MATRIX-v1.9.json` / `.md` — the active matrix. The v1.7 and v1.6 matrices are retained unchanged as history.

## Retained without redesign

Everything Codex passed in v1.8 and v1.7: the single evidence-store authority, closed-world finalization, STORE-14 and
legacy-traversal regressions, content addressing, partial state, the capture shim with no storage surface,
documentation precedence, content-sensitive caching, the schema registry, the trusted shim, exact stored chain
resolution, receiver identity, strict raw ingestion, the H0 gate, commit authority, transaction precedence and
identity claim scoping.

## Retired in v1.9

`realpath` on the trust path; digest-only attempt binding; optional logical identity on a write; the v1.8 assumption
that filesystem metadata is outside frozen authority. `tools/build_v1_8.py` and `tools/validate_v1_8.py` are replaced.
