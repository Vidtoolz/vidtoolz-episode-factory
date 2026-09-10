# CHANGELOG — Resolve authority bundle v1.14 (narrowly scoped correction of the v1.13 authorizing location bypass)

- **Parent:** v1.13.0, branch `docs/resolve-authority-freeze-v1.13` @ `65895c6dedceadff012a08c1bafcdf9e92b65221`, manifest `436e12c8616ea6704fef2dbd0e14517cf33092aec1a7ff064dd4b10fb3dad573`. Grandparent v1.12.0 @ `73150d00a72820b155caf357c412f46b8ec4a9ba`, manifest `e5eace278a1b6130971a38f55ef207620cdc97d7b3872d11ce9ab8909e4014fb`.
- **This version:** 1.14.0, directory `docs/resolve-integration/v1.14/`, own `FREEZE-MANIFEST.json`.
- **Input of record:** Hermes's v1.13 operational review **PASS**, and Codex's v1.13 result — **93 of 96 checks passed with one BLOCKER, `V113-B1`, and one MINOR**.
- **Scope discipline:** `V113-B1` and its direct consequences only. Nothing else is reopened: the v1.12/v1.13 workflow, principals, A2V, the lifecycle, the record constructors, `record_id`, the envelope law, `BUNDLE_VERIFICATION` semantics, the TOCTOU law, the checked-file law, locking, Store.v5, cache, the schema registry, the shim, strict ingestion, H0, commit authority, precedence, the matrix architecture, M0B/M0C/M0D and pre-M3 transaction authority are all untouched. `tools/evidence_store.py` differs from v1.13 by **exactly one comment line** (the validator's filename, carried by the tool rename) and by nothing else. No Resolve launched or contacted; no `EKA`; no A1/A2/A2V/A3 executed; no merge; v1.0–v1.13 bytes untouched; unrelated production and Earth Studio code untouched.

## V113-B1 — the same mistake, one layer down

v1.13 removed the caller-selectable evidence root and put the governed-location law in
`tools/evidence_authoring.py`. It did not put it in the authority. `authority_lib.derive_attachment_state()` and
`authority_lib.evaluate_eligibility()` — the two functions v1.13's own `AUTHORITY_SURFACE` declared **authorizing** —
still took a bare evidence-set dictionary and knew nothing about where it came from.

So Codex skipped the wrapper. A complete, mechanically perfect workflow authored under a sandbox root — the exact
document `evidence_authoring.derive_attachment_state()` refuses with `NOT_PRODUCTION_ROOT` — was passed straight to
the core:

```
evidence_authoring.derive_attachment_state(sid)          ->  REFUSED NOT_PRODUCTION_ROOT
authority_lib.derive_attachment_state(tc, es, active)     ->  ATTACHMENT_READY
authority_lib.evaluate_eligibility(..., es, active)       ->  eligible: true
```

That is the whole finding, and it is the same class as `V112-RP1`: **a law stated in prose and enforced in only one
place is not a property of the authority, it is a property of that place.** v1.13 moved the defect from a parameter
to a layer. v1.14 removes the layer as the point of enforcement.

Reproduced against the frozen v1.13 bundle at `65895c6d` before anything was changed, and pinned as a test:
`validate_v1_14.py` section `core-bypass` asserts the wrapper's refusal, the diagnostic function's
`ATTACHMENT_READY` **and** the authorizing function's refusal in the same check, so the difference between v1.13 and
v1.14 is visible rather than asserted.

## The correction — location authority lives in the core

**One door.** `authority_lib.load_governed_evidence_set(session_id, active)` is the only way to obtain an evidence
set that can authorize anything. It takes a session id and the active authority and **nothing else** — no root, no
path, no document. It computes the canonical location from the frozen constant, classifies the root, session and
document entries with `lstat` before anything is resolved, reads the document only from the path it computed, checks
the document's own recorded location and session identity against where it was actually found, requires the recorded
`authority_root` to be the frozen constant and `written_under_production_root` to be true, compares the bytes against
the digest sealed at `VERIFIED`, and mints a location receipt.

**A provenance object nothing else can build.** The result is a `GovernedEvidenceSet`. Its `__init__` refuses without
a module-private token, it has `__slots__` and no instance dictionary, and a subclass cannot construct one either.
A dictionary with every field filled in correctly, a namespace object with the same attributes, and a hand-computed
receipt are all refused with `LOCATION_PROVENANCE_MISSING`.

**A receipt that is recomputed, never trusted.** `location_receipt()` digests the session id, the canonical document
path, the frozen governed root, the authority version, the active manifest digest, the live document digest and the
validation result, under the registered hash domain `vidtoolz.resolveLocationReceipt.v1`. Every authorizing entry
point calls `governed_provenance_errors()` first, which re-derives all of it **from the filesystem now**. Possession
of a previously valid object is therefore not authority: a document changed underneath it is refused
`LOCATION_RECEIPT_INVALID`, and so is an object bound to a different active manifest.

**Two new authorizing entry points, and two demotions.**

| function | v1.13 | v1.14 |
|---|---|---|
| `derive_attachment_state_authorizing(tc, governed, active)` | — | **AUTHORIZING**; accepts only a `GovernedEvidenceSet`; returns the derivation plus `authorizing`, the receipt and the canonical document path |
| `evaluate_eligibility_authorizing(perms, request, rp, caps, tc, governed, active)` | — | **AUTHORIZING**; fail-closed; recomputes the attachment state itself; has no state parameter |
| `derive_attachment_state_for_session` / `evaluate_eligibility_for_session` | — | **AUTHORIZING** convenience: the core does its own loading, so no caller-parsed evidence set participates at all |
| `derive_attachment_state(tc, es, active)` | AUTHORIZING | **DIAGNOSTIC / NON_AUTHORIZING** — semantic derivation only, returns no receipt |
| `evaluate_eligibility(...)` | AUTHORIZING | **DIAGNOSTIC / NON_AUTHORIZING** — same |

`AUTHORITY_SURFACE` now has three keys instead of two: `authorizing`, `internal_non_authorizing` and the new
`diagnostic_non_authorizing`, which names exactly those two functions. Their behaviour is unchanged — v1.14 demotes
them, it does not weaken the semantic derivation the whole inherited suite depends on.

**Precedence, in that order.** `location authority → attachment semantics → eligibility`. The authorizing path checks
provenance **before** it computes readiness; it does not compute readiness and retract it afterwards. On a location
failure the derivation returns `CONFLICT` with `authorizing: false` and `LOCATION_AUTHORITY_INVALID`, and never a
readiness value; eligibility returns `eligible: false`, `permitted_by_policy: false`, `prerequisites_satisfied: false`
and no derived state at all.

**One implementation, not two.** The authoring layer no longer restates the location law: `NAME_SAFE` **is**
`authority_lib.SESSION_ID_RE`, `_session_id()` delegates to `session_id_errors()`, `_require_trusted_dir()` delegates
to `governed_dir_errors()` and relabels its codes, `canonical_set_dir()` delegates to `canonical_session_dir()`, and
the wrapper's own `realpath` alias check is gone because the core performs it. The wrapper keeps its early checks as
**defence in depth** — deliberately, and stated in its docstring — and then takes its authorizing answer from
`load_governed_evidence_set()` + `derive_attachment_state_authorizing()`, raising `NOT_PRODUCTION_ROOT` if the core
declines to authorize.

## New names and refusal codes

`LOCATION_RECEIPT_DOMAIN`, `EVIDENCE_SET_FILE_NAME`, `WORKFLOW_FILE_NAME`, `SESSION_ID_RE`, `LOCATION_ERRORS`,
`authority_attachment_root()`, `canonical_session_dir()`, `canonical_document_path()`, `session_id_errors()`,
`governed_dir_errors()`, `location_errors()`, `location_receipt()`, `GovernedEvidenceSet`,
`load_governed_evidence_set()`, `governed_provenance_errors()`.

`LOCATION_ERRORS` is frozen and closed, and adds to the v1.13 root vocabulary: `SESSION_ID_INVALID`,
`SESSION_NOT_FOUND`, `DOCUMENT_NOT_FOUND`, `DOCUMENT_SYMLINK_REFUSED`, `DOCUMENT_NOT_AT_CANONICAL_PATH`,
`SELF_LOCATION_MISMATCH`, `LOCATION_PROVENANCE_MISSING`, `LOCATION_RECEIPT_INVALID`. The authorizing results use one
additional failure label, `LOCATION_AUTHORITY_INVALID`, which is what a caller sees instead of a state.

## The MINOR, fixed

`EVIDENCE-SET-WORKFLOW.json` still carried a `test_root_override` claim that the authoring API accepts a root
parameter. It has not since v1.13. The stale key is removed and the remaining text matches the code, asserted as a
static audit.

## Preserved, and re-run as regressions

Everything v1.13 established about the root — the frozen constant, the argument-free resolver, no root parameter on
any authorizing function or CLI, lstat-first entry trust with `realpath` only as a later alias check, no `.resolve()`
anywhere, the per-load recheck, the `INTERNAL_NON_AUTHORIZING` testkit that refuses to sandbox the frozen root — and
everything v1.12 established about the workflow: the `OPEN → PREPARED → VERIFIED` lifecycle, the `(state, role)`
grants, the `_authorize` choke point, the write-after-`VERIFIED` refusal, the principal registry with actor
disjointness, A2V as a distinct authorization, `make_record` / `record_id` / the envelope law, all three record
constructors, the verified record-id bindings, the pinned-file map, the checked-file law and the TOCTOU seals.

## Version decisions

| identifier | v1.13 | v1.14 | why |
|---|---|---|---|
| `AUTHORITY_VERSION` | `1.13.0` | **`1.14.0`** | the bundle version |
| `AUTHORITY_SURFACE` | 2 keys | **3 keys** | two functions are demoted; the surface must say so in machine form |
| `HASH_DOMAINS` | — | **+ `vidtoolz.resolveLocationReceipt.v1`** | a new digest with a new meaning |
| `GOVERNED_ATTACHMENT_ROOT` | frozen constant | unchanged | v1.13's law stands |
| `resolveEvidenceSet` | `…v1.12` | `…v1.12` (unchanged) | no record shape, body or accepted instance changed |
| `RECORD_TYPE_VERSION` | `"1.10"` | `"1.10"` (unchanged) | envelope law untouched |
| `EVIDENCE_STORE_VERSION` | `…Store.v5` | `…Store.v5` (unchanged) | no semantic change; one comment line differs |
| every other schema `$id` | — | unchanged | only version pin values moved |

## Also changed

- `tools/authority_lib.py` — the core location-authority block, the two authorizing entry points and their
  by-session-id forms, the surface split, the demotion docstrings, and lineage pinned to the v1.13 parent.
- `tools/evidence_authoring.py` — delegation to the core's single implementation, the authorizing derive path,
  `load_governed(session_id)` and `evaluate_eligibility_authorizing(...)`.
- `EVIDENCE-SET-WORKFLOW.json` — the `core_authority` block; the stale `test_root_override` key removed.
- `M0A-BINDING-VALUES.json` — 10 new bindings (102 total): the authorizing and diagnostic entry points, the governed
  loader, the receipt domain and what it binds, the location provenance law, the refusal vocabulary, the three
  authority-surface classes, and the v1.14 package update requirement.
- `FINDING-RESOLUTION-MATRIX-v1.14.json` / `.md`, `AUTHORITY-PRECEDENCE.json` / `.md` (S61), `THREAT-MODEL.md`.
  `README.md` is unchanged: like v1.11–v1.13, this correction adds no new reading order, only a new record of one.

## What this does not do

Nothing here authorizes a run. `SCHEMA-VALID != AUTHORIZED TO MUTATE`. The frozen attachment root still does not
exist on this host, and the production path refuses `ROOT_NOT_FOUND` until an operator creates it as a `0700`
directory. The location receipt is not a cryptographic location proof, and none of this is a TOCTOU guarantee — see
`THREAT-MODEL.md`, including the one scoped residual v1.14 records rather than fixes: the M3 composed path still
consumes the diagnostic eligibility, which cannot yield M0A probe eligibility and belongs to the milestone that
freezes write authority. A2 and A2V each still require Mikko's own explicit approval. v1.14 is a CANDIDATE for
independent review.
