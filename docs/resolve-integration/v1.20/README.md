# Resolve authority v1.20 — implementation-author candidate

Successor of the accepted v1.19 authority (`docs/resolve-authority-freeze-v1.19` @ `5efbcae6a36b76d4a359f3e65e503336576575c7`, manifest `06811f07b422d1cdf30ae6c076bae2bc0b598fc3ac464a0e180a8553a76a2848`, accepted by Mikko on 2026-09-20 after independent review; see `LINEAGE.md`). v1.18 (`5d9dbba7`) is HISTORICAL — REJECTED; v1.19 is HISTORICAL — ACCEPTED; SUPERSEDED. Neither is modified.

v1.20 adds the independently freeze-review-approved **Resolve Control Plane Phase 1** as the accepted **read-only** control substrate: `CONTROL-PLANE.md` (architecture, identity model, exact nine-operation allowlist, error set, security, session, journal), `PHASE1-SOURCE-PIN.json` (byte-exact pin of `resolve-control/**` at `77c26103`), `PHASE1-QUALIFICATION-RECORD.json` (the §A4 qualification carried forward by identity), `KNOWN-LIMITATIONS-PHASE1.md` (bounded P3 items with closure gates), and binds the qualification-library observations in `TARGET-CONTRACT.json`. Every v1.19 repair (V118-M1…M4, N1…N3) is retained and regression-tested.

**WRITE AUTHORITY = NONE. AUTOMATED RESOLVE WRITES ARE NOT QUALIFIED. HERMES FACADE = ABSENT.** Nothing in this bundle is human approval of any run, gate or publication; no Resolve was launched or mutated to build it; `EKA` was not accessed. M3 material remains provisional design.

Validate with `python3 -B tools/validate_v1_20.py` (report: `VALIDATION-REPORT.md`). Read, in this order: `LINEAGE.md`, `CHANGELOG-v1.20.md`, `CONTROL-PLANE.md`, `PHASE1-QUALIFICATION-RECORD.json`, `KNOWN-LIMITATIONS-PHASE1.md`, then the inherited doctrine (`DOCTRINE.md`, `ADJUDICATION-FREEZE-CONTRACT.md` §A4/§A5, `TARGET-CONTRACT.json`, `TRANSPORT.md`, `SNAPSHOT-CONCURRENCY-RECOVERY.md`).

**Self-test evidence ownership (F-120-04, final repair).** A validator run owns exactly one object under the governed root `/home/vidtoolz/resolve-qualification-evidence/attachment`: the session directory for a run-unique self-test id (`sess-selftest-<tag>-<pid>-<128-bit token>`) that did not exist at entry. Cleanup removes exactly that directory (lstat-checked, never a symlink, directly under the root) and nothing else — never the root, never a sibling, never the qualification tree — whether or not the root existed before and whether the run exits normally or by exception. An absent root is created with the frozen mode and left in place (possibly empty). Sessions of any other writer survive; existing names are never adopted. No operating restriction is required for evidence safety; running validators one at a time is advisable only for host load. Section `selftest-ownership` proves this against private roots, including the pre-repair behaviour as a regression fixture. Validation requires the repository checkout with `resolve-control/**` present (section `phase1-pin`).

**Reproducible validation and build (F-120-09, final repair).** Frozen bundle bytes depend only on the canonical source: every report detail is scrubbed of the temp directory and checkout root where they are used as paths (canonical paths such as the governed evidence root are never rewritten; the working directory is never read), of digests, inodes and run-unique ids; no raw environment-derived total is published, and section `report-determinism` fails a leaking run. Archive the candidate anywhere, run the validator alone → zero changed files; run the regeneration cycle (no reference-metadata remap) → `changed_files = 0`; repeat under another scratch root and `TMPDIR` → identical hashes and manifest.

## The v1.7 correction of v1.6 (historical)

v1.7 is a narrowly scoped correction of the four BLOCKERs and three M0A MAJORs in Codex's final forensic adjudication
of v1.6, plus the operational closure of the Hermes M0A binding values. Read, in this order:

1. `CHANGELOG-v1.7.md` — what changed and what was deliberately retained.
2. `FINDING-RESOLUTION-MATRIX-v1.7.md` (and its `.json` form) — each finding, its correction, its negative fixture and
   the layer the attack must fail at.
3. `AUTHORITY-CACHING.md` — why no authority cache may be keyed on an object identity.
4. `SCHEMA-REGISTRY.md` — why the authority, never the caller, owns the validator.
5. `TRUSTED-SHIM.md` — the one capture shim a promotable capture may come from.
6. `STORED-CHAIN.md` — the exact stored artifacts a promotion rests on.
7. `EVIDENCE-ROOT.md` — the append-only store, now executable code the validator attacks.
8. `M0A-BINDING-VALUES.json` — the identities an M0A package must bind to. Publishing them is not authorization.

Trust roots of this bundle: `TRUSTED-SHIM.json` and `SCHEMA-REGISTRY.json`, both pinned by `FREEZE-MANIFEST.json` and
both re-verified against the files on disk on every resolution.

Nothing in v1.7 authorizes M0A, M0B, M0C, M0D or any mutation. No Resolve instance was launched or contacted.

## The v1.8 correction of v1.7 (historical)

v1.8 is an extremely narrow correction of the one defect class Codex left open against v1.7: **evidence-store
integrity and competing store authority**. Everything else v1.7 established was retained and re-run as regressions.

1. `CHANGELOG-v1.8.md` — what changed and what was deliberately retained.
2. `FINDING-RESOLUTION-MATRIX-v1.8.md` (and its `.json` form) — ES-1 and ES-2, their negative fixtures and the layer
   each attack must fail at.
3. `EVIDENCE-ROOT.md` — **the** evidence store: one authorizing implementation, no caller-supplied paths, closed-world
   finalization. This is the only document in the bundle that describes evidence storage.

There is exactly one evidence-storage authority here: `tools/evidence_store.py`, classified
`EVIDENCE_STORE_AUTHORIZING`. The legacy `EvidenceRoot` surface in the capture shim is removed (precedence S47), and a
finalized session is a closed world whose verification requires missing == 0, unexpected == 0 and changed == 0
(precedence S46).

Nothing in v1.8 authorizes M0A, M0B, M0C, M0D or any mutation. No Resolve instance was launched or contacted.

## The v1.9 correction of v1.8 (historical)

v1.9 is an extremely narrow correction of the four evidence-store integrity defects Codex left open against v1.8.
Everything v1.8 and v1.7 established was retained and re-run as regressions.

1. `CHANGELOG-v1.9.md` — what changed and what was deliberately retained.
2. `FINDING-RESOLUTION-MATRIX-v1.9.md` (and its `.json` form) — S19-1 … S19-4, their fixtures and expected layers.
3. `EVIDENCE-ROOT.md` — **the** evidence store, now with the root trust boundary, the session identity tuple, the
   session path law, semantic record keys, the attempt tuple and POSIX mode authority.

Mode and file-type verification are POSIX semantics on the reference host. No Windows parity is claimed.

Nothing in v1.9 authorizes M0A, M0B, M0C, M0D or any mutation. No Resolve instance was launched or contacted.

## The v1.10 correction of v1.9

v1.10 is a narrowly scoped correction of the five evidence-store findings Codex left open against v1.9, whose v1.7 and
v1.8 regressions all passed. Everything else was retained and re-run.

1. `CHANGELOG-v1.10.md` — what changed and what was deliberately retained.
2. `FINDING-RESOLUTION-MATRIX-v1.10.md` (and its `.json` form) — S110-1 … S110-5.
3. `EVIDENCE-ROOT.md` — **the** evidence store, now with a persisted boundary receipt, an independently recomputed
   verification model, attempt-marker derivation, continuous mode authority and a frozen filesystem error vocabulary.
4. `INVENTORY-FIELD-PROVENANCE.json` — the source of every normative field. No normative field is self-asserted.

Nothing in v1.10 authorizes M0A, M0B, M0C, M0D or any mutation. No Resolve instance was launched or contacted.

## v1.19 release correction

This candidate corrects V117-I1 and extracted V117-S1 through V117-S5. RELEASE-AUTHORITY.md states the new release tooling law. AUTHORITY-REFERENCE-METADATA.json supplies source-bound per-reference declarations, AUTHORITY-DOCUMENT-UNIVERSE.json publishes inclusion, and REQUIRED-VALIDATION-CHECKS.json pins the mandatory check set. Runtime semantics remain frozen. Author tests are not independent adjudication.

## v1.20 repair candidate (2026-09-21)

The first v1.20 candidate (`e65ed5a4`, manifest `2f58bc3b23693d97e0bda480c0b560ec3ed9eedb375d050b22a1936420f9b6c0`) was independently reviewed and **REJECTED — REPAIR REQUIRED** (review manifest `740c656d1a1c5e261d45a3656922b2aa4bc2e1dbb2901909085e2d7a9b4bc546`; P0 0, P1 0, P2 3). This bundle is its narrow repair at the same authority version 1.20.0:

- **F-120-01** — the parent pin's byte count was read from the v1.18 manifest; `tools/build_manifest.py` now derives path, digest and byte count of every external pin from one resolved file and refuses to write a manifest whose pins do not re-verify (section `external-pins`).
- **F-120-02** — manifest rule 4 bound records to authority version 1.19.0; the rule text is now generated from the canonical version constant and every version statement is cross-checked (section `authority-version`).
- **F-120-03** — the bundle's copy of the v1.19 finding matrix was regenerated from a stale v1.17 literal; `tools/build_v1_20.py` now inherits the v1.17, v1.18 and v1.19 matrices byte-asserted from the frozen parent and re-stamps only `authority_version` (section `inherited-matrices`).
- **F-120-05** — every top-level JSON member now validates against its registered schema or carries an explicit `NO_REGISTERED_SCHEMA:` reason in the manifest (section `registered-json`); the matrix schema admits the historical id and severity forms it is declared on.
- **F-120-06** — `resolve-control/**` is machine-verified against `PHASE1-SOURCE-PIN.json` (section `phase1-pin`); the pin has a registered schema.

`resolve-control/**` (77c26103), v1.18, v1.19, the Phase 1 qualification evidence and the recorded human v1.19 acceptance are unchanged. `e65ed5a4` remains in branch history as the rejected candidate. The dispositions of all eight review findings are in `FINDING-RESOLUTION-MATRIX-v1.20.{md,json}` and `KNOWN-LIMITATIONS-PHASE1.md`. Still an implementation-author candidate; independent re-review required.

## v1.20 final repair (2026-09-21, second re-review)

The repaired candidate `1e2ce233` (manifest `b296dc6a…`) was independently re-reviewed (review manifest `79923a9bc96040675f4dfd99da460eb6efc5e975a56f86476cc84c180409ecab`): F-120-01/02/03 confirmed closed; two P2 blockers found and repaired in this bundle at the same authority version 1.20.0:

- **F-120-04** — the self-test seam treated root absence at entry as ownership and removed the whole tree at exit, deleting any other writer's later session. Now: own-session-only ownership with run-unique ids, no whole-tree removal, symlink-safe cleanup, exception-safe; `tools/v120_ownership_tests.py` (section `selftest-ownership`).
- **F-120-09** — four report details carried environment-bound values (temp-root path; raw inventory `total_bytes` including the serialized root path, device and inode), so a successful validation rewrote a frozen file. Now: environment scrub, outcome-only detail, section `report-determinism`; byte-identical under short, medium and long scratch roots.

Both rejected candidates (`e65ed5a4`, `1e2ce233`) remain in branch history. Still an implementation-author candidate; independent re-review required.
