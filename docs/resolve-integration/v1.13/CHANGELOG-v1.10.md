
# CHANGELOG — Resolve authority bundle v1.10 (narrowly scoped correction of v1.9)

- **Parent:** v1.9.0, branch `docs/resolve-authority-freeze-v1.9` @ `863fe4fb5944935bad51a318a50b25ed748be22d`, manifest `5aac34dae6c2ec9842aaa3499d7c20ffd104f65966ba7cb8b0c79d32d42eb9fe`. v1.9 committed its bundle and its DOC-AUTHORITY registration together, so its `semantic_head` is the same commit.
- **This version:** 1.10.0, directory `docs/resolve-integration/v1.10/`, own `FREEZE-MANIFEST.json`.
- **Input of record:** Codex's independent v1.9 result — all v1.7 and v1.8 regressions 211/211 PASS — with five remaining evidence-store findings: **S110-1** session boundary not persisted or rechecked, **S110-2** inventory and finalization semantics partly self-asserted, **S110-3** stored attempt marker authority incomplete, **S110-4** mode authority incomplete before finalization, **S110-5** filesystem error vocabulary.
- **Scope discipline:** only those five findings and their versioning, documentation and test consequences. Nothing that passed v1.9 was redesigned; cache, schema registry, trusted shim, exact-chain, strict-ingestion, H0, commit, precedence and matrix architecture are untouched. No Resolve launched or contacted; no `EKA`; no M0; no M0A probe executed; no merge; v1.0–v1.9 bytes untouched; unrelated production and Earth Studio code untouched.

All five were reproduced against the frozen v1.9 bundle before anything was changed.

## S110-1 — a persisted SESSION_BOUNDARY receipt, and root identity inside session identity

`BOUNDARY.json` is written at creation as governed evidence and binds the configured root's literal path, device and
inode together with the session directory's basename, device and inode, closed by its own digest. Its digest joins the
session identity tuple, and `check_boundary()` re-lstats both entries against it before every authorizing operation.
Session directory replacement is `SESSION_BOUNDARY_CHANGED`; the same basename under another root is
`ROOT_IDENTITY_MISMATCH`. Ordinary replacement is detectable; deliberate device and inode reuse is not claimed.

## S110-2 — the model is recomputed; the inventory is compared to it

`expected_model()` rebuilds everything from filesystem facts, record bytes, the session manifest, the boundary receipt
and frozen store law, and never reads the inventory. Every normative inventory header field, every entry field, every
directory kind and mode, and every normative finalization-marker field — including the store and authority versions
v1.9 ignored — are derived independently and compared. Duplicate paths, record keys, attempt keys and directories are
refused before any index exists. `INVENTORY-FIELD-PROVENANCE.json` publishes the source of every normative field and
forbids `TRUSTED_FROM_INVENTORY_ITSELF`.

## S110-3 — stored attempt markers reconcile as a bijection

Markers are never trusted from filename or content. Every marker must resolve to exactly one record whose semantic key
recomputes from the marker's tuple, and every record must have exactly one such marker. Foreign markers, orphaned
records and duplicate attempt ids are refused, and the check runs in the ACTIVE integrity path so a corrupted session
cannot reach FINALIZED.

## S110-4 — continuous mode authority including the session directory

`MODE_TABLE` derives expected modes from entry kind, the session directory is inside authority, and the comparison
runs from creation onward. An ACTIVE chmod blocks the next canonical operation and blocks finalization.

## S110-5 — one filesystem error boundary

`fs()` and `ERRNO_TO_CODE` convert expected errno conditions into frozen `FS_*` classes. A raw `PermissionError` no
longer escapes the public authority path.

## Also changed

- `tools/evidence_store.py` — store version `vidtoolz.resolveEvidenceStore.v4`, session schema `…Session.v4`, new boundary schema `vidtoolz.resolveEvidenceBoundary.v1`, inventory schema `…Inventory.v3`, finalization schema `…Finalization.v2`; new `RootBoundary` receipt, `expected_model()`, `active_integrity()`, `verify_summary()` counters and the `fs()` boundary.
- `tools/authority_lib.py` — the new store, session, boundary, inventory and finalization constants; the session-manifest law gains `evidence_boundary_schema`; the lineage law pins v1.9.
- `INVENTORY-FIELD-PROVENANCE.json` — new published artifact.
- `M0A-BINDING-VALUES.json` — adds the boundary schema and receipt file, the boundary receipt law, the root/session identity law, the attempt marker derivation law, the active integrity law, the mode authority law and the filesystem refusal vocabulary.
- `tools/validate_v1_10.py` — new sections `evidence-boundary-receipt`, `evidence-recomputed-model`, `evidence-finalization-fields`, `evidence-attempt-derivation`, `evidence-fs-errors`; `evidence-mode-authority` extended to ACTIVE state; property tests for boundary replacement, marker mutation and permission bits.
- `FINDING-RESOLUTION-MATRIX-v1.10.json` / `.md` — the active matrix. Earlier matrices are retained unchanged as history.

## Retained without redesign

Everything Codex passed: content-sensitive caching, the schema registry, the trusted shim, exact stored chain
resolution, receiver identity, strict raw ingestion, the H0 gate, commit authority, transaction precedence, matrix
integrity, the single store authority, closed-world finalization, content addressing, partial state, STORE-14 and
legacy traversal.

## Retired in v1.10

Process-memory-only boundary state; inventory fields trusted from the inventory; attempt markers trusted from disk;
mode checks that only run after finalization; raw `OSError` on the public authority path. `tools/build_v1_9.py` and
`tools/validate_v1_9.py` are replaced.
