# FINDING RESOLUTION MATRIX — Codex's v1.13 BLOCKER answered in v1.14

Machine form: `FINDING-RESOLUTION-MATRIX-v1.14.json`. `validate_v1_14.py` reads it, requires exactly the one id
below, and fails unless every validation section it names exists and passes. Earlier matrices — including
`FINDING-RESOLUTION-MATRIX-v1.13.json` — are retained unchanged as history and re-run as v1.14 regressions.

Input of record: Hermes's v1.13 operational review PASS, and Codex's v1.13 result — **93 of 96 checks passed, one
BLOCKER (`V113-B1`) and one MINOR**.

| id | severity | defect | v1.14 correction | negative fixture | expected failure layer |
|---|---|---|---|---|---|
| V113-B1 | BLOCKER | direct calls to `authority_lib.derive_attachment_state()` and `authority_lib.evaluate_eligibility()` — the two functions v1.13's authority surface declared AUTHORIZING — consumed a forbidden-location evidence set and returned `ATTACHMENT_READY` and `eligible: true`, bypassing the v1.13 wrapper-level governed-location law entirely | location reconciliation moved INTO the core: `load_governed_evidence_set()` is the only door and mints a token-guarded `GovernedEvidenceSet`; `derive_attachment_state_authorizing()` and `evaluate_eligibility_authorizing()` accept nothing else and re-verify the location receipt against the live filesystem before any semantic work; the two old functions are demoted to DIAGNOSTIC / NON_AUTHORIZING on a three-key authority surface; the eligibility gate has no attachment-state parameter and recomputes the state itself; the authoring layer delegates to the core's single implementation of the root, session-id and entry-trust laws | `core-authority`, `core-bypass`, `core-positive`, `core-callgraph`, `core-selflocation`, `core-property`, `core-static` | authorizing core (location authority before attachment semantics) |

Severity of the MINOR, also fixed: `EVIDENCE-SET-WORKFLOW.json` carried a stale `test_root_override` claim that the
authoring API accepts a root parameter. Removed, and its absence is asserted.

## How the correction is proved, not asserted

- **The exact reproduction, pinned.** One check asserts, together, that the wrapper refuses the sandbox document with
  `NOT_PRODUCTION_ROOT`, that the **diagnostic** core still derives `ATTACHMENT_READY` from it, and that the
  **authorizing** core refuses it. The v1.13 behaviour and the v1.14 behaviour are visible side by side.
- **No escalation route.** Eight payloads — the raw evidence-set dictionary, the diagnostic derivation result, a bare
  `ATTACHMENT_READY` string, the diagnostic eligibility result, `None`, a dictionary with every provenance field
  filled in correctly, a namespace object with the same attributes, and a subclass built without the token — each
  yield `eligible: false` and `authorizing: false`.
- **A positive control at the real canonical root.** With the governed root absent, the suite creates it `0700`,
  drives the production authoring path, and asserts `ATTACHMENT_READY` with `authorizing: true` plus
  `eligible: true` with reason code `ELIGIBLE`, then removes the entire tree in a `finally`. If the root already
  exists on the host the control is skipped by design, because the suite must never touch operator evidence. This is
  what stops the fix from being "refuse everything".
- **Relocation and symlinks against the core.** The same bytes copied outside the governed root cannot authorize;
  the session directory replaced by a symlink **at** the canonical path is refused even though the document behind it
  is the valid one; and the refusal disappears when the real directory is restored.
- **Provenance is not replayable.** A previously valid `GovernedEvidenceSet` is refused once the document changes
  underneath it, and refused when bound to a different active manifest.
- **The call graph, by AST.** The diagnostic derivation is called only by the authorizing derivation and by the
  diagnostic eligibility; the diagnostic eligibility only by `semantic_mutation_plan`; that only by the M3 composed
  path. Both production CLIs reach authority through the authoring wrapper, and neither imports the testkit.
- **Property tests, fixed seed.** 24 seeded forbidden-root, precomputed-state, diagnostic-result, raw-dictionary,
  symlinked-root and sibling-prefix cases, and 40 seeded session ids proving the core law and the authoring layer
  agree exactly because there is now one implementation.

## Preserved and re-run

The whole v1.13 root law (frozen constant, argument-free resolver, no root parameter anywhere on the authorizing
surface or either CLI, lstat-first entry trust, `realpath` only as a later alias check, no `.resolve()`, per-load
recheck, the `INTERNAL_NON_AUTHORIZING` testkit), and the whole v1.12 workflow: principal roles, A2V semantics, the
`OPEN → PREPARED → VERIFIED` lifecycle, the `_authorize` choke point, record-type permissions, the
write-after-VERIFIED refusal, the TOCTOU binding, all three record constructors, `make_record` / `record_id` / the
envelope law, the `BUNDLE_VERIFICATION` content, the checked-file law, the principal registry, Store.v5
(`evidence_store.py` differs from v1.13 by **one comment line** — the validator's filename — and by nothing else;
every semantic constant is identical), cache, shim, strict ingestion, H0, commit authority, precedence, the
capability matrix and M0B/M0C/M0D.

## What is still not closed

- The M3 composed path still consumes the **diagnostic** eligibility through `semantic_mutation_plan`. It cannot
  yield M0A probe eligibility — it refuses without a mutation plan and a complete `S0` snapshot, and an M0A probe
  request is not a plan — and pre-M3 transaction authority is deliberately outside v1.14's scope. Recorded as a
  scoped residual in `THREAT-MODEL.md`, not fixed here.
- The frozen attachment root does not exist on this host; the production path refuses `ROOT_NOT_FOUND` until an
  operator creates it as a `0700` directory. That is deliberate.
- The location receipt is a digest over filesystem facts, not a cryptographic location proof, and none of this is a
  time-of-check/time-of-use guarantee for the filesystem beneath the checks.
- A principal remains a role-bound operational label, not an authenticated identity (`THREAT-MODEL.md`).
- `SCHEMA-VALID != AUTHORIZED TO MUTATE`. No probe has run and no Resolve was contacted.
