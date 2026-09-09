# Resolve execution subsystem: authority bundle v1.8

Versioned correction of v1.5 (parent branch `docs/resolve-authority-freeze-v1.5` @ `9d944e01358b4b88d6ee4c9993a4db4084ba23ad`, parent manifest `a40c6954fbe7f72d48eaf3957c0ac036c471a7a92496e277660530386e7aba5a`; grandparent v1.4 `d2d7768` / `34a7d050…dd84f`; v1.3 `1c9e090` / `ad1e6bfc…55dc`; v1.2 `c6d1284`; v1.1 `47ddb22`; v1.0 `e2874f6`). `../v1/` … `../v1.5/` are immutable history. Read `FREEZE-MANIFEST.json` first (closed status vocabulary, sha256 and byte count per file), then `AUTHORITY-PRECEDENCE.md`, `CHANGELOG-v1.7.md` and `FINDING-RESOLUTION-MATRIX-v1.7.md`. `PROVISIONAL.md` lists what is not frozen.

It corrects the Codex forensic adjudication of v1.5 (F15-01 … F15-07; 3 BLOCKER, 4 MAJOR), the independent architectural findings (M-RAW, M-H0, M-PRECEDENCE, M-ID and three minors), the qualified offline prototype and the M0A driver compatibility findings. Gate consequences of the parent stand until this bundle is independently reviewed: capability refreeze, ordinary qualified M0 reads and pre-M3 transaction authority remain **blocked** by the v1.5 adjudication, and nothing here authorizes M0.

Laws in one line each: `SCHEMA-VALID != AUTHORIZED TO MUTATE` (`SEMANTIC-VALIDATION.md`); `PERMISSION DECLARATION != ELIGIBILITY` (`ELIGIBILITY.md`); **a capture records what happened, never what it means** (`RAW-CAPTURE.md`, `CAPTURE-SHIM.md`); **meaning is derived by one versioned reference parser and recomputed by every validator** (`REFERENCE-PARSER.md`); **every expectation is a documented hypothesis until a reviewed refreeze validates it** (`PRIMITIVE-SPEC.md`); `ACCEPT` only over a recomputed `SUCCESS`, by a reviewer who is not the operator, and **the active capability matrix is its own content digest** (`REVIEW-REFREEZE.md`); `PROBE_ALLOWED != QUALIFIED_READ` and no M0 phase implies the next (`M0-PROBE-CONTRACT.md`, `M0-PHASES.md`); attachment state is derived from a coherent, current, envelope-bound evidence set against the active reviewed manifest (`TARGET-ATTACHMENT-GATE.md`); every OBSERVED snapshot field cites the promoted raw capture, and item properties/fades/speed/takes/links are **not represented, not compared and not claimed** (`SNAPSHOT-COMPLETENESS.md`); a degraded H0 can never be a write precondition and the gate is evaluated before any mutator (`GUARD-AUTHORITY.md`, `ELIGIBILITY.md`); verification is derived from S0 → S1 over the protected surface with a mandatory checkpoint and a compared applied-operation list, and **`commit_eligibility` → `validate_transaction_set` with a mandatory schema validator is the only authorizing commit path** (`SEMANTIC-VALIDATION.md`); identity callability, uniqueness and stability are three separate M0 claims and survival is an M3 question (`IDENTITY-EVIDENCE.md`); evidence roots are append-only and content-addressed (`EVIDENCE-ROOT.md`); the defensive controls and their residual risks are listed in `THREAT-MODEL.md`.

Validate with `python3 -B tools/validate_v1_6.py` (report: `VALIDATION-REPORT.md`, with per-finding coverage; layers raw parse → schema → evidence-binding → attachment → capability → snapshot → semantic → eligibility → linked-set/composed authorization; seeded random-order property tests; the reference capture shim executed against fake in-process objects; a bypass audit of the authority surface incl. parameter defaults; exact-manifest binding against the real `FREEZE-MANIFEST.json`). Regenerate machine artifacts with `python3 -B tools/build_v1_6.py` from v1.5-seeded inputs, then the manifest with `python3 -B tools/build_manifest.py` after a passing validation, then validate again (two cycles converge; the report never embeds the manifest sha). Run every tool with `python3 -B`; a `__pycache__` directory is a validation failure.

Nothing in this bundle is human approval of any run, gate or publication; no Resolve was launched or mutated; `EKA` was not accessed; M0 has not begun; no adapter or production capture driver exists; mutation-capable schemas remain PROVISIONAL_UNTIL_M3; the capability matrix still has zero `QUALIFIED_READ` rows and an unreviewed refreeze block.

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
