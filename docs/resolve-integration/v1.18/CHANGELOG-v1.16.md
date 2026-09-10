# CHANGELOG — Resolve authority bundle v1.16 (extremely narrow correction of Codex's two v1.15 findings)

- **Parent:** v1.15.0, branch `docs/resolve-authority-freeze-v1.15` @ `459bd29e358574896f0cf69f4b0bfb347bf2902d`, manifest `af2c1b11485233f5c2b6b5447a6695a3b6cbe6ba4cbdb06f3727973f4b2c9fe2`. Grandparent v1.14.0 @ `b61f248238ec7ed60deca79aa9728ec0cde86edd`, manifest `0d4fc9915923d17ef6ec469cc01fb164b4d2ee1001fc7983d557bf4c9d9032b8`.
- **This version:** 1.16.0, directory `docs/resolve-integration/v1.16/`, own `FREEZE-MANIFEST.json`.
- **Input of record:** Codex's v1.15 forensic adjudication — independent harness **54/57 PASS**, **1 BLOCKER (`V115-B1`)**, **1 MERGE MAJOR (`V115-M1`)**, authority completeness `WORKFLOW_CONTRADICTORY`, merge BLOCKED, A1 authority-ready NO. The candidate remained clean and unmodified. Everything executable that v1.15 fixed was confirmed CLOSED.
- **Scope discipline:** those two findings and their direct documentation/validation/versioning consequences only. **No runtime law changed.** The consumed-evidence byte binding, the immutable carrier, the governed root, the diagnostic/authorizing API separation, the transaction/commit provenance gate, the `WORKFLOW.json` no-follow/file-type law, malformed-carrier handling, Store.v5, roles, A2V, the lifecycle, constructors, `BUNDLE_VERIFICATION`, the checked-file law, TOCTOU, locking, cache, the schema-registry architecture, the trusted shim, strict ingestion, the exact stored chain, H0, the commit stage architecture, the capability matrix and M0B/M0C/M0D are all untouched and re-run. `tools/evidence_store.py` differs from v1.15 by **exactly one comment line**. No Resolve launched or contacted; no `EKA`; no A1/A2/A2V/A3; no merge; v1.0–v1.15 bytes untouched.

## What Codex actually found

Neither finding is an executable defect. Both are **frozen statements that disagree with the runtime** — and a
consumer chooses its authority by reading those statements.

## V115-B1 — two current artifacts contradicted the four-class law

Exact evidence, from §18 of the report:

1. `TARGET-CONTRACT.json:5` (`qualification_note`): *"attachment state is derived by
   `tools/authority_lib.py#derive_attachment_state`"*, and `:167` (`attachment_law`): *"computed by
   `derive_attachment_state`"*. Both are **current normative contract fields**, and neither marked that function
   diagnostic. The corrected `attachment_derivation` field at `:169` and the diagnostic field at `:242` did not erase
   them.
2. `SCHEMA-REGISTRY.md:8-11` named `validate_transaction_set_authorizing` / `commit_eligibility_authorizing` as the
   authorizing pair and then said **"those two"** are `PROVISIONAL_UNTIL_M3` and non-authorizing — the exact inverse
   of the executable surface, and a wording error introduced by v1.15 itself.

And the reason v1.15's own audit passed: *"The candidate static check misses the TARGET-CONTRACT contradiction because
it excludes fields such as `qualification_note` and generic `law` from its active-name invariant."* **An exclusion
list is not an invariant.**

**The correction.**

- **One canonical map, generated.** New `AUTHORITY-FUNCTION-CLASSES.json` is produced from
  `authority_lib.AUTHORITY_SURFACE` via `authority_function_classes()`: one function → one class, the four classes
  asserted disjoint, all twelve decision functions classified, plus the **authorizing-slot** and **diagnostic-slot**
  inventories and the **runtime-lookup law**. Every other artifact now quotes a generated fact instead of restating a
  claim.
- **The three contradictory statements are fixed** at their exact key paths: `qualification_note` and
  `attachment_law` name `#derive_attachment_state_authorizing` / `#derive_attachment_state_for_session` and mark the
  bare function `DIAGNOSTIC / NON_AUTHORIZING`; the `SCHEMA-REGISTRY.md` sentence now says it is the **legacy
  bare-evidence pair** that is provisional.
- **The invariant is exhaustive.** The audit's key-name exemptions dropped from twenty (including `law`, `note`,
  `qualification_note`, `reason`) to seven that *self-declare* as a demoted-function inventory or as history — and
  each of those seven is separately asserted to match the canonical map. The scanner also now catches
  **module-qualified** references (`authority_lib.derive_attachment_state`), which the v1.15 lookbehind let through.
  Running it exhaustively surfaced **four more** stale statements in generated values
  (`EVIDENCE-SET-WORKFLOW.json#read_only_journal.law`, `M0A-BINDING-VALUES.json#values.verification_result_law` and
  `#values.toctou_law`, `FREEZE-MANIFEST.json#files[].qualification_note` for the target contract), all corrected.
- **The provisional pair keeps its exact class.** It was not relabelled to make the contradiction disappear, and its
  behaviour is unchanged — still twelve stages, still `eligible=true` over a bare dict, still not authority.
- **Runtime lookup proved.** No authorizing code resolves a function by name from any artifact: no `getattr` on the
  module, no `eval`/`exec`/`importlib`, and the single `globals()[...]` in the bundle is `parser_sha256()` over the
  frozen module constant `PARSER_FUNCTION_NAMES` — a digest computation, not an authority selection. A stale document
  could mislead a human or an external consumer; it could never make the authority call a diagnostic function. That
  is why the fix is a publication fix, and why it is nonetheless a BLOCKER.

## V115-M1 — the published receipt binding omitted three runtime-bound fields

Exact evidence, from §31: `EVIDENCE-SET-WORKFLOW.json:71-82` published a `receipt.binds` list of the **seven v1.14
fields**; runtime `location_receipt` (`authority_lib.py:302`) binds **ten**, additionally:

| omitted field | since | what it binds |
|---|---|---|
| `workflow_path` | v1.15 (V114-B4) | the canonical `WORKFLOW.json` path derived from the frozen root |
| `workflow_sha256` | v1.15 (V114-B4) | the exact `WORKFLOW.json` bytes read no-follow |
| `evidence_snapshot_digest` | v1.15 (V114-B1) | the canonical digest of the parse of the validated document bytes |

**The correction** — a publication fix, not a semantic one:

- `RECEIPT_BOUND_FIELDS` declares the ten fields **in digest order**, and `location_receipt()` now assembles its
  digest body *from that tuple*, refusing `RECEIPT_BINDING_DRIFT` if the two ever disagree. The declared set and the
  digested set are one thing, not two.
- `receipt_binding_publication()` generates the machine publication, and both
  `EVIDENCE-SET-WORKFLOW.json#core_authority.receipt` and `AUTHORITY-FUNCTION-CLASSES.json#receipt_binding` are
  produced from it.
- **Per-field semantics are published** (§19), not just names: `source`, `normative`, `in_digest`,
  `revalidated_live`, `consumed_by_authorizing_core` — so a consumer can reproduce the receipt from frozen machine
  authority alone, which is the operational point.
- Parity is machine-checked **in both directions**, by AST against the function body, and the negatives are frozen:
  removing any one of the ten fails, the exact v1.15 seven-field list fails naming precisely the three omissions, five
  plausible over-claims fail, and 24 seeded permutations fail.
- The receipt domain `vidtoolz.resolveLocationReceipt.v1` is **unchanged** (§20) and the snapshot domain remains
  **distinct** (§21). Documentation catching up is not a contract change.

## Version decisions

| identifier | v1.15 | v1.16 | why |
|---|---|---|---|
| `AUTHORITY_VERSION` | `1.15.0` | **`1.16.0`** | the bundle version |
| `AUTHORITY-FUNCTION-CLASSES.json` | — | **new**, `vidtoolz.resolveAuthorityFunctionClasses.v1` | the classification publication is new machine authority (V115-B1) |
| `EVIDENCE-SET-WORKFLOW.json#core_authority.receipt` | 7 published fields | **10 + per-field semantics** | the publication was incomplete (V115-M1); the *binding* did not change |
| `vidtoolz.resolveLocationReceipt.v1` | unchanged | **unchanged** | the accepted-instance and hash law are identical; only the document caught up |
| `vidtoolz.resolveEvidenceSetSnapshot.v1` | unchanged | **unchanged** | still distinct, still published as distinct |
| `HASH_DOMAINS` | 33 | 33 (unchanged) | no new digest |
| `LOCATION_ERRORS` | 24 | **25** (+ `RECEIPT_BINDING_DRIFT`) | one new internal-consistency refusal |
| `AUTHORITY_SURFACE` | 4 classes | 4 classes (unchanged) | the classes were right; only their publication changed |
| `EVIDENCE_STORE_VERSION` | `…Store.v5` | unchanged | no semantic change; one comment line differs |
| `resolveEvidenceSet`, `RECORD_TYPE_VERSION`, every other schema `$id` | — | unchanged | only version pin values moved |

## Also changed

- `tools/authority_lib.py` — `RECEIPT_BOUND_FIELDS`, `RECEIPT_FIELD_SEMANTICS`, `receipt_binding_publication()`,
  `FUNCTION_CLASS_LAW`, `authority_function_classes()`, `authority_function_class()`,
  `CLASSIFIED_DECISION_FUNCTIONS`, the drift-guarded receipt body, and lineage pinned to the v1.15 parent.
- **new** `AUTHORITY-FUNCTION-CLASSES.json` + `schemas/resolveAuthorityFunctionClasses.schema.json`.
- `TARGET-CONTRACT.json` (`qualification_note`, `attachment_law`), `SCHEMA-REGISTRY.md`,
  `EVIDENCE-SET-WORKFLOW.json` (generated receipt block, `read_only_journal.law`), `M0A-BINDING-VALUES.json`
  (6 new bindings, 118 total; `verification_result_law`, `toctou_law` corrected), `FREEZE-MANIFEST.json` note.
- `AUTHORITY-PRECEDENCE.json` / `.md` (S63), `THREAT-MODEL.md`,
  `FINDING-RESOLUTION-MATRIX-v1.16.json` / `.md`.

## What this does not do

Nothing here authorizes a run, and nothing here changes what the authority does — only what it *says* and how that
saying is generated and checked. `SCHEMA-VALID != AUTHORIZED TO MUTATE`. The v1.15 residual stands: the authorizing
transaction path has no positive control until a milestone freezes M3 write evidence. A2 and A2V each still require
Mikko's own explicit approval. v1.16 is a CANDIDATE for independent review.
