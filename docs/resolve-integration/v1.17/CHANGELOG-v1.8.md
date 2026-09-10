
# CHANGELOG — Resolve authority bundle v1.8 (extremely narrow correction of v1.7)

- **Parent:** v1.7.0, branch `docs/resolve-authority-freeze-v1.7` @ `6a805181b14617c1b6259847b0905e21362a935c` (the metadata-registration branch HEAD), manifest `8da668fcb3df771b645e7feb092e88ce381d9fa5a4f9de931bfaf1bc2f55fb5d`. The **inherited semantic v1.7 commit** — the one that froze the v1.7 bundle bytes — is `ebc2dd4db2462f73db20054ba60cf36691ab29b3`, and the manifest records it as `parent.semantic_head`. The two commits have a bit-identical `docs/resolve-integration` tree, so the inherited bytes are the same either way; the distinction is preserved rather than collapsed.
- **This version:** 1.8.0, directory `docs/resolve-integration/v1.8/`, own `FREEZE-MANIFEST.json` (schema `resolveFreezeManifest.v1.8`).
- **Input of record:** Codex's final v1.7 adjudication — intake PASS, supplied validation 1800/1800 twice, independent harness 210/211, every other gate passing (cache 43/43, validation law 20/20, trusted shim 16/16, exact stored chain 30/30, receiver identity 9/9, strict byte ingestion 21/21, H0 6/6, commit authority 8/8, precedence PASS, historical authority PASS, contamination NONE), with exactly one remaining defect class: **evidence store integrity / competing store authority**, findings ES-1 and ES-2.
- **Scope discipline:** this corrects ES-1 and ES-2 and the versioning consequences of making the evidence-store surface singular and fail-closed. Nothing that passed independent review was redesigned. No Resolve launched or contacted; no `EKA`; no M0; no M0A probe executed; no merge; v1.0–v1.7 bytes untouched; unrelated production and Earth Studio code untouched.

## ES-1 — the finalized session is now a closed world

v1.7's verifier only examined entries it already expected, so a file planted in a finalized session's root was never
looked at and `verify()` returned clean. Codex's independent attack STORE-14 passed against v1.7. A file planted inside
a layer was caught only incidentally and mis-reported as `PARTIAL_RECORD`; an unexpected directory was ignored.

v1.8 makes finalization record the **complete allowed inventory**. `INVENTORY.json` (self-digesting, read-only,
schema `vidtoolz.resolveEvidenceInventory.v1`) lists every governed entry with its path, kind, layer, digest, byte
count, schema type, logical identity and attempt ids, plus the expected directory set and the session manifest digest.
`FINALIZED` names the inventory digest. `verify()` walks the whole tree — files and directories, every depth, never
following links — and compares EXPECTED against ACTUAL, requiring `missing == 0`, `unexpected == 0`, `changed == 0`.
An unknown entry is `UNEXPECTED_ENTRY`. `HASHES.json` is retired in favour of the inventory.

New session states are explicit: `ACTIVE`, `PARTIAL`, `FINALIZED`, `INVALID`. A crashed session reports `PARTIAL` and
can never report `FINALIZED`.

## ES-2 — one evidence-storage authority, and no caller-supplied paths

The `EvidenceRoot` class is **removed** from `tools/capture_shim_reference.py`. It was a second storage implementation
whose four write methods each interpolated a caller string into a filesystem path; all four escaped the evidence root
on `../../x`, not only the `add_derived` path Codex reported.

`tools/evidence_store.py` is the single `EVIDENCE_STORE_AUTHORIZING` implementation. Its write API is
`put_raw` / `put_derived` / `put_review` / `put_promotion`, each taking an attempt id, content and an optional logical
identity; the store derives the content-addressed destination itself. No signature on the write surface has a `path`
parameter. Every caller-supplied identifier passes one logical-name gate and a resolved-path containment proof.

The capture shim now captures facts and serializes frames and nothing else: it creates no directory, derives no
evidence path and writes no evidence. It names the one store module and disclaims storage authority.

## Also changed

- `tools/authority_lib.py` — `EVIDENCE_STORE_MODULE`, `EVIDENCE_STORE_VERSION` (`…Store.v2`), `EVIDENCE_SESSION_SCHEMA` (`…Session.v2`), `EVIDENCE_INVENTORY_SCHEMA`, `EVIDENCE_STORE_AUTHORITY_CLASS`; the session-manifest law gains `evidence_inventory_schema`; the lineage law pins the v1.7 parent branch HEAD **and** the inherited semantic commit.
- `M0A-BINDING-VALUES.json` — adds `evidence_inventory_schema`, `evidence_store_module`, `evidence_store_sha256`, `evidence_store_authority_class`, `closed_world_verification` and `path_identifier_constraints`.
- `FINDING-RESOLUTION-MATRIX-v1.8.json` / `.md` — the active matrix (ES-1, ES-2). The v1.6 matrix is retained unchanged as `FINDING-RESOLUTION-MATRIX-v1.7.json` and its corrections are re-run as regressions.
- `tools/validate_v1_8.py` — new sections `evidence-closed-world`, `evidence-single-authority`, `evidence-traversal`; the `evidence-store` section rewritten for the v1.8 API.
- Documents: `EVIDENCE-ROOT.md` rewritten as the single normative store document; `CAPTURE-SHIM.md`, `M0-PROBE-CONTRACT.md`, `M0A-PROBE-COMPATIBILITY.md`, `THREAT-MODEL.md`, `AUTHORITY-PRECEDENCE.json/.md` (S46, S47), `README.md`.

## Retained without redesign

Everything Codex passed: content-sensitive authority caching, the internally pinned schema registry, the trusted
capture shim, exact stored derived/review/refreeze chain resolution, receiver-path uniqueness, strict raw byte
ingestion, the H0 early write gate, the single commit authority, transaction precedence and identity claim scoping.
All are re-run as v1.8 regressions.

## Retired in v1.8

`EvidenceRoot` and every independent storage/path implementation outside `tools/evidence_store.py`; `HASHES.json` as
the finalization receipt; the v1.7 assumption that a verifier may ignore entries it did not expect.
`tools/build_v1_7.py` and `tools/validate_v1_7.py` are replaced.
