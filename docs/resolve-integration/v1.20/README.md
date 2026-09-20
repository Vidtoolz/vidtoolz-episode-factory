# Resolve authority v1.20 — implementation-author candidate

Successor of the accepted v1.19 authority (`docs/resolve-authority-freeze-v1.19` @ `5efbcae6a36b76d4a359f3e65e503336576575c7`, manifest `06811f07b422d1cdf30ae6c076bae2bc0b598fc3ac464a0e180a8553a76a2848`, accepted by Mikko on 2026-09-20 after independent review; see `LINEAGE.md`). v1.18 (`5d9dbba7`) is HISTORICAL — REJECTED; v1.19 is HISTORICAL — ACCEPTED; SUPERSEDED. Neither is modified.

v1.20 adds the independently freeze-review-approved **Resolve Control Plane Phase 1** as the accepted **read-only** control substrate: `CONTROL-PLANE.md` (architecture, identity model, exact nine-operation allowlist, error set, security, session, journal), `PHASE1-SOURCE-PIN.json` (byte-exact pin of `resolve-control/**` at `77c26103`), `PHASE1-QUALIFICATION-RECORD.json` (the §A4 qualification carried forward by identity), `KNOWN-LIMITATIONS-PHASE1.md` (bounded P3 items with closure gates), and binds the qualification-library observations in `TARGET-CONTRACT.json`. Every v1.19 repair (V118-M1…M4, N1…N3) is retained and regression-tested.

**WRITE AUTHORITY = NONE. AUTOMATED RESOLVE WRITES ARE NOT QUALIFIED. HERMES FACADE = ABSENT.** Nothing in this bundle is human approval of any run, gate or publication; no Resolve was launched or mutated to build it; `EKA` was not accessed. M3 material remains provisional design.

Validate with `python3 -B tools/validate_v1_20.py` (report: `VALIDATION-REPORT.md`). Read, in this order: `LINEAGE.md`, `CHANGELOG-v1.20.md`, `CONTROL-PLANE.md`, `PHASE1-QUALIFICATION-RECORD.json`, `KNOWN-LIMITATIONS-PHASE1.md`, then the inherited doctrine (`DOCTRINE.md`, `ADJUDICATION-FREEZE-CONTRACT.md` §A4/§A5, `TARGET-CONTRACT.json`, `TRANSPORT.md`, `SNAPSHOT-CONCURRENCY-RECOVERY.md`).

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
