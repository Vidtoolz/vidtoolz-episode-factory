# CHANGELOG — Resolve authority bundle v1.13 (extremely narrow correction of the v1.12 governed-root defect)

- **Parent:** v1.12.0, branch `docs/resolve-authority-freeze-v1.12` @ `73150d00a72820b155caf357c412f46b8ec4a9ba`, manifest `e5eace278a1b6130971a38f55ef207620cdc97d7b3872d11ce9ab8909e4014fb`. v1.12 committed its bundle and its DOC-AUTHORITY registration together, so its `semantic_head` is the same commit.
- **This version:** 1.13.0, directory `docs/resolve-integration/v1.13/`, own `FREEZE-MANIFEST.json`.
- **Input of record:** Hermes's v1.12 operational review **PASS** on the intended path (lifecycle, positive runtime-only E2E, canonical records, 9/9 checked files, role separation, TOCTOU, `NO_RERUN_RISK = YES`, zero Resolve/EKA contact) and Codex's v1.12 result — intake PASS, semantic delta PASS, **runtime-parity oracle FAIL**, classification `WORKFLOW_CONTRADICTORY`, finding **V112-RP1**.
- **Scope discipline:** V112-RP1 and its direct consequences only. Nothing that passed the v1.12 operational review is reopened: principal roles, A2V semantics, the lifecycle, the record constructors, the `BUNDLE_VERIFICATION` content, the TOCTOU law, the checked-file law, Store.v5, cache, shim, strict ingestion, H0, commit authority, precedence, the capability matrix and M0B/M0C/M0D are untouched. `tools/evidence_store.py` differs from v1.12 by **exactly one comment line** (the validator's filename, carried by the tool rename) and by nothing else — every semantic constant is identical. No Resolve launched or contacted; no `EKA`; no A1/A2/A2V/A3 executed; no merge; v1.0–v1.12 bytes untouched; unrelated production and Earth Studio code untouched.

## V112-RP1 — the defect, and it was mine

v1.12 froze "exactly one governed attachment evidence root" in prose, and then shipped code that let any caller pick
a different one. Every authorizing function in `tools/evidence_authoring.py` took `root=None`, and both CLIs took
`--evidence-root` — introduced deliberately, and documented as such, so the validation suite could exercise the real
code in a temporary directory. **The test convenience was placed on the authorizing surface.** The law lived only in
prose and the code won.

Reproduced against the frozen v1.12 bundle at `73150d00`:

```
a2_prepare.py adopt   --evidence-root /tmp/<dir>   ...
a2_prepare.py prepare --evidence-root /tmp/<dir>
a2_verify.py  verify  --evidence-root /tmp/<dir>   ->  derived state ATTACHMENT_READY
```

and the identical sequence with the root pointing at a **symlink** also printed `ATTACHMENT_READY`, with both
documents living under `/tmp`. `governed_root(root)` called `os.path.abspath` on the caller's value and never
classified the entry, so a symlink was followed rather than refused.

Consequences Codex drew, all correct: MERGE BLOCKED, A2 and A2V not AUTHORITY_READY, ATTACHMENT_READY FAIL, A1
authority-ready NO.

## The correction

**One root, and no way to choose another.** `authority_lib` freezes
`GOVERNED_ATTACHMENT_ROOT = /home/vidtoolz/resolve-qualification-evidence/attachment` and `GOVERNED_ROOT_MODE = 0o700`.
`evidence_authoring.governed_attachment_root()` **takes no argument**. No authorizing function and neither CLI accepts
`root`, `evidence_root`, `output_root`, `base_dir`, `directory`, `path`, `dir` or `prefix`. The preparer's
Resolve-library option was renamed `--library-root`, so no production CLI carries an option literally called
`--root` — that exact ambiguity is what made the defect easy to miss.

**Entry trust before resolution.** `require_governed_root()` classifies the root **entry** with `lstat` first —
absolute, already normalised, existing, a directory, not a symlink, mode `0700` — and only afterwards consults
`realpath` as an alias check. The module contains no `.resolve()` call anywhere.
`require_governed_session_dir()` applies the same no-follow law to `<root>/<session_id>` plus the basename,
containment and alias checks.

**Rechecked everywhere, not just at creation.** Both trust checks run on **every** authorizing load, so update,
verify, finalize and derive are as protected as create. The authorizing derivation additionally requires the
document's recorded `authority_root` to equal the frozen constant and `written_under_production_root` to be true.

**Test override, properly separated.** Scratch roots live in `tools/evidence_authoring_testkit.py`,
`AUTHORITY_CLASS = INTERNAL_NON_AUTHORIZING`. Neither CLI imports it, it refuses to sandbox the frozen root, and
every document it produces is refused by the authorizing derivation. The sandbox changes the root **prefix only**:
every trust, lifecycle, principal, TOCTOU and freshness check runs unchanged on the same code, so it cannot establish
a state production location policy forbids — it can only fail to be authority.

## New refusal codes

`ROOT_NOT_GOVERNED`, `ROOT_SYMLINK_REFUSED`, `ROOT_NOT_A_DIRECTORY`, `ROOT_NOT_FOUND`, `ROOT_MODE_INVALID`,
`SESSION_SYMLINK_REFUSED`, `SESSION_NOT_A_DIRECTORY`, `SESSION_PATH_NOT_GOVERNED`, `NOT_PRODUCTION_ROOT`.

## What the CLIs do now

`a2_verify.py verify` and `a2_prepare.py status` report `REFUSED <code>` and exit non-zero instead of tracebacking
when the authorizing derivation refuses the location. Under the non-authorizing sandbox that is exactly what happens:
`adopt`, `prepare` and `check` exit 0 and the workflow is mechanically sound, and `verify` and `status` refuse to hand
back authority. **In v1.12 they returned `ATTACHMENT_READY` there.** That difference is the whole fix, and it is
asserted as a test.

## Preserved, and re-run as regressions

The `OPEN → PREPARED → VERIFIED` lifecycle, the `(state, role)` grants, the `_authorize` choke point, the
write-after-VERIFIED refusal, the PREPARER/VERIFIER/APPROVER registry with actor disjointness, A2V as a distinct
authorization, `make_record` / `record_id` / the envelope law, all three record constructors, the verified record-id
bindings, the pinned-file map and the checked-file law, and the TOCTOU seals. `evidence_store.py` carries no semantic change (one comment line differs).

One law moved without changing: document **freshness** was inside the authorizing derive in v1.12 and is now
`require_fresh()`, called by both the authorizing derivation and the non-authorizing testkit — so the sandbox applies
the same staleness rule production does.

## Version decisions

| identifier | v1.12 | v1.13 | why |
|---|---|---|---|
| `AUTHORITY_VERSION` | `1.12.0` | **`1.13.0`** | the bundle version |
| `GOVERNED_ATTACHMENT_ROOT` | (implicit, caller-selectable) | **frozen constant** | the finding |
| `resolveEvidenceSet` | `…v1.12` | `…v1.12` (unchanged) | no record shape or body changed |
| `RECORD_TYPE_VERSION` | `"1.10"` | `"1.10"` (unchanged) | envelope law untouched |
| `EVIDENCE_STORE_VERSION` | `…Store.v5` | `…Store.v5` (unchanged) | no semantic change; one comment line differs |
| every other schema `$id` | — | unchanged | only version pin values moved |

## Also changed

- `tools/evidence_authoring.py` — the governed-root resolver, entry-trust checks, per-load location recheck, the
  production-root binding in `WORKFLOW.json`, `require_fresh()`, the nine new refusal codes, and the removal of every
  `root` parameter.
- **new** `tools/evidence_authoring_testkit.py` — the `INTERNAL_NON_AUTHORIZING` scratch-root harness.
- `tools/a2_prepare.py` — `--evidence-root` removed, `--root` renamed `--library-root`, refusals reported not raised.
- `tools/a2_verify.py` — `--evidence-root` removed, refusals reported not raised.
- `tools/authority_lib.py` — `AUTHORITY_VERSION` 1.13.0, `GOVERNED_ATTACHMENT_ROOT`, `GOVERNED_ROOT_MODE`, lineage
  pinned to the v1.12 parent.
- `EVIDENCE-SET-WORKFLOW.json` — the governed-root, trust, recheck, refusal-code and test-override laws.
- `M0A-BINDING-VALUES.json` — 11 new bindings (92 total), including the operational package update requirement.
- `FINDING-RESOLUTION-MATRIX-v1.13.json` / `.md`, `AUTHORITY-PRECEDENCE.json` / `.md` (S60), `THREAT-MODEL.md`.

## What this does not do

Nothing here authorizes a run. `SCHEMA-VALID != AUTHORIZED TO MUTATE`. The frozen attachment root does not exist yet
on this host, and the production path refuses with `ROOT_NOT_FOUND` until an operator creates it as a `0700`
directory — that is deliberate: no evidence can appear anywhere by default. A2 and A2V each still require Mikko's own
explicit approval. v1.13 is a CANDIDATE for independent review.
