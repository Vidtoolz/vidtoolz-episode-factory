# FINDING RESOLUTION MATRIX — Codex's six v1.14 release findings answered in v1.15

Machine form: `FINDING-RESOLUTION-MATRIX-v1.15.json`. `validate_v1_15.py` reads it, requires exactly the six ids
below, and fails unless every validation section each one names exists and passes. Earlier matrices — including
`FINDING-RESOLUTION-MATRIX-v1.14.json` — are retained unchanged as history and re-run as v1.15 regressions.

Input of record: Codex's v1.14 forensic adjudication and blocking-findings extraction — **four BLOCKERs, one MERGE
MAJOR, one MINOR**; authority completeness `WORKFLOW_CONTRADICTORY`; merge FAIL. Hermes's root-existence sensitivity
was classified `REVIEW_ENVIRONMENT_EFFECT` and is **not** treated as a candidate defect.

The one law all six corrections serve:

> **THE EXACT BYTES VALIDATED AS GOVERNED EVIDENCE ARE THE EXACT BYTES CONSUMED BY AUTHORIZING DERIVATION.**

| id | severity | defect | v1.15 correction | negative fixture | expected failure layer |
|---|---|---|---|---|---|
| V114-B1 | BLOCKER | the governed carrier's `evidence_set` slot was writable, so provenance for document A could be presented with semantic evidence B; validation applied to byte stream A while authorization consumed object B, deriving a **false `ATTACHMENT_READY` under A's own receipt** | the carrier holds the validated **bytes** and no parsed object: frozen slots, no `evidence_set` slot, a reparsing read-only property, copy/deepcopy/pickle refused, a new parsed-snapshot digest domain bound into the receipt, and `governed_consume()` as the one source of consumed truth — it re-reads, re-digests, reparses, schema-validates and **returns** the semantic object every authorizing entry point consumes | `b1-consumed-evidence`, `b1-positive`, `v115-property`, `v115-static` | authorizing core (consumed evidence bound to validated bytes) |
| V114-B2 | BLOCKER | `commit_eligibility` / `validate_transaction_set` were classified AUTHORIZING while consuming a bare evidence dict; the complete committed-consistent fixture supplied that way completed all twelve stages and returned `eligible: true` | `validate_transaction_set_authorizing` / `commit_eligibility_authorizing` require a `GovernedEvidenceSet` and refuse `GOVERNED_EVIDENCE_REQUIRED` before any stage; `semantic_mutation_plan` picks its eligibility law **by type**, never by a caller-supplied callback; the old pair is demoted to a fourth surface class, `provisional_until_m3_non_authorizing`, with every stage law unchanged | `b2-transaction-authority`, `v115-property`, `v115-static` | authorizing transaction / commit boundary |
| V114-B3 | BLOCKER | `TARGET-CONTRACT.json`, `PERMISSIONS.json`, `TARGET-ATTACHMENT-GATE.md` and `ELIGIBILITY.md` still designated the demoted raw functions as current authority, contradicting the code registry | all four designate the authorizing entry points; the diagnostic pair appears only *as* diagnostic, in its own schema-pinned contract field; `AUTHORITY-PRECEDENCE.json` carries a blanket re-reading clause and S62; the workflow law and M0A bindings publish the class lists from the code itself | `b3-active-naming`, `v115-static` | active authority bindings (authority selection) |
| V114-B4 | BLOCKER | `WORKFLOW.json` — session identity, governed root, production-root claim, lifecycle state, sealed digest — was checked only for existence and then opened through `strict_load`, which **followed a symlink to foreign bytes**, **blocked forever on a FIFO** and **raised a raw `IsADirectoryError` on a directory** | one authority-file law for both governed files, in the core and in the wrapper: lstat first, symlink refused, regular file required, alias checked, then `O_NOFOLLOW`+`O_NONBLOCK` open re-verified by `fstat` for device and inode; the workflow digest is bound into the receipt and re-checked on every call | `b4-workflow-file`, `v115-property`, `v115-static` | governed location (authority-file entry trust) |
| V114-M1 | MERGE MAJOR | `object.__new__(GovernedEvidenceSet)` passed `isinstance` and leaked a raw `AttributeError` out of both public authorizing boundaries | `governed_structure_errors` validates type and every field with defaults **before** any dereference and runs first inside `governed_consume`; ten malformed shapes fail closed as `GOVERNED_EVIDENCE_INVALID` at all three public boundaries; genuine programming errors still raise | `m1-malformed-carrier`, `v115-property`, `v115-static` | authorizing core (input validation / fail-closed vocabulary) |
| V114-N1 | MINOR | `CANONICALIZATION.md`'s closed hash-domain list omitted `vidtoolz.resolveLocationReceipt.v1` — and, checked exhaustively, four more domains plus two recorded at superseded versions | the document names every registered domain and what the governed-location ones bind; section `hash-domain-parity` compares it with `HASH_DOMAINS` exactly, **in both directions**, and the document records that the comparison exists | `hash-domain-parity`, `v115-static` | documentation / authority-claim consistency |

## How the corrections are proved, not asserted

- **Each reproduction is pinned first.** All six were reproduced against the frozen v1.14 bundle at `b61f2482`
  before anything was changed, and two proved worse than reported: the FIFO hang and the raw `IsADirectoryError` in
  B4, and a five-domain-plus-two-stale gap in N1.
- **The sharpest B1 case is a control, not a claim.** Two governed sessions are authored at the real canonical root
  with genuinely different authority (`ATTACHMENT_READY` vs `PROVISIONED_NOT_VERIFIED`), and the suite asserts their
  receipts and snapshot digests differ — so the substitution attack has something real to substitute.
- **Forcing every provenance field in turn.** `object.__setattr__` bypasses the freeze, as Python allows; the suite
  forces bytes, then the document digest, then the snapshot digest, then the receipt, and requires a refusal at each
  step. The defence is the digest binding, not the attribute guard, and that is what is tested.
- **Authority follows bytes, not objects.** Two independently loaded carriers for one document are different Python
  objects with identical digests and identical authorizing results.
- **Every entry-touching call is alarm-bounded**, so "refuses" and "hangs the authority" can never be confused —
  which is exactly how the v1.14 FIFO behaviour was found.
- **The gate is a gate, not a wall.** With a legitimate governed carrier, the authorizing transaction validator
  passes provenance and then produces **identical** stage errors to the demoted validator, proving v1.15 added a
  gate in front of the stage laws and changed none of them.
- **The audit scans everything.** B3's static audit covers every current top-level artifact, machine and prose — the
  precedence table does not even list `TARGET-CONTRACT.json` or `PERMISSIONS.json`, so scanning only that table
  would have missed the defect Codex found.
- **Property tests, fixed seed**: 32 seeded cases over carrier substitution, receipt/snapshot mismatch, malformed
  carriers, diagnostic-into-commit injection and `WORKFLOW.json` path/file types.

## Preserved and re-run

Everything v1.14 got right (the authorizing/diagnostic type separation, raw/precomputed/lookalike refusals, live
receipt revalidation, the no-attachment-state eligibility signature, `LOCATION → ATTACHMENT → ELIGIBILITY`), all of
v1.13's root law, all of v1.12's workflow, and Store.v5 (`evidence_store.py` differs from v1.14 by **one comment
line** — the validator's filename — and by nothing else), cache, schema registry, validator-injection protection,
trusted shim, strict ingestion, exact stored chain, receiver identity, H0, precedence, the capability matrix and
M0B/M0C/M0D.

## What is still not closed

- **The authorizing transaction path has no positive control.** No production path authors M3 write evidence, so
  `validate_transaction_set_authorizing` is proved fail-closed and proved to apply the ordinary pre-M3 stage laws
  once provenance passes — but its first true positive belongs to the milestone that freezes write evidence. This is
  the same shape as the v1.11 → v1.12 gap, one milestone later, and it is stated rather than left to be discovered.
- An actor with write access to the governed evidence, to this bundle's code, or to the running interpreter is
  outside the boundary; the digest bindings turn such tampering into a refusal, not a bypass (`THREAT-MODEL.md`).
- The location receipt is not a cryptographic location proof, and none of this is a time-of-check/time-of-use
  guarantee for the filesystem beneath the checks.
- A principal remains a role-bound operational label, not an authenticated identity.
- `SCHEMA-VALID != AUTHORIZED TO MUTATE`. No probe has run and no Resolve was contacted.
