# FINDING RESOLUTION MATRIX — Codex's two v1.15 findings answered in v1.16

Machine form: `FINDING-RESOLUTION-MATRIX-v1.16.json`. `validate_v1_16.py` reads it, requires exactly the two ids
below, and fails unless every validation section each one names exists and passes. Earlier matrices — including
`FINDING-RESOLUTION-MATRIX-v1.15.json` — are retained unchanged as history and re-run as v1.16 regressions.

Input of record: Codex's v1.15 forensic adjudication — independent harness **54/57 PASS**, **1 BLOCKER**, **1 MERGE
MAJOR**, `WORKFLOW_CONTRADICTORY`, MERGE BLOCKED, A1 authority-ready NO. The candidate remained clean and
unmodified, and **every executable v1.15 repair was confirmed CLOSED**.

**Neither finding is an executable defect.** Both are frozen statements that disagree with the runtime — and a
consumer chooses its authority by reading statements. The v1.16 law:

> **ONE function → ONE current authority class, published from the executable surface. And the published receipt
> binding IS the runtime receipt binding, exactly, in both directions.**

| id | severity | defect (exact key paths) | v1.16 correction | negative fixture | expected failure layer |
|---|---|---|---|---|---|
| V115-B1 | BLOCKER | `TARGET-CONTRACT.json:5` (`qualification_note`) — "derived by `tools/authority_lib.py#derive_attachment_state`"; `:167` (`attachment_law`) — "computed by `derive_attachment_state`"; both current normative fields, neither marking the function diagnostic. `SCHEMA-REGISTRY.md:8-11` — named the `*_authorizing` pair and then said **"those two"** are `PROVISIONAL_UNTIL_M3`/non-authorizing, the inverse of the executable surface. The v1.15 audit missed both because its invariant exempted whole key names including `law` and `qualification_note`. | one canonical `AUTHORITY-FUNCTION-CLASSES.json`, **generated** from `AUTHORITY_SURFACE`, with the class law, the twelve decision functions, the authorizing- and diagnostic-slot inventories by exact key path, and the runtime-lookup law; the three statements corrected at their key paths; the invariant made exhaustive (20 key exemptions → 7 self-declaring ones) and extended to module-qualified names, which surfaced **four more** stale generated values, all corrected; the provisional pair keeps its exact class and behaviour | `b1-classification`, `b1-property`, `v116-static` | active authority publication (authority selection) |
| V115-M1 | MERGE MAJOR | `EVIDENCE-SET-WORKFLOW.json:71-82` published `receipt.binds` with the **seven** v1.14 fields; runtime `location_receipt` (`authority_lib.py:302`) binds **ten** — omitting `workflow_path`, `workflow_sha256` (v1.15 V114-B4) and `evidence_snapshot_digest` (v1.15 V114-B1) | `RECEIPT_BOUND_FIELDS` declares the ten in digest order and `location_receipt()` **assembles its digest body from that tuple**, refusing `RECEIPT_BINDING_DRIFT` on disagreement; `receipt_binding_publication()` generates both machine publications, with per-field semantics (source, normative, in_digest, revalidated_live, consumed_by_authorizing_core); parity asserted in both directions and by AST against the function body; domain unchanged, snapshot domain still distinct | `m1-receipt-parity`, `m1-property`, `v116-static` | machine-readable authority publication (receipt binding contract) |

## How the corrections are proved, not asserted

- **Both reproductions run against the frozen v1.15 bundle**, at Codex's exact key paths, and assert the
  contradiction **is present there** and absent here — including that v1.15's `qualification_note` and
  `attachment_law` contained no diagnostic marking at all.
- **The v1.15 audit's blind spot is itself a test.** One check asserts the current invariant no longer carries the
  exemption list (`law`, `note`, `qualification_note`, `reason`) that let the contradiction pass.
- **Generated, not restated.** The classification map and the receipt publication are both produced from
  `authority_lib`, so an artifact cannot drift from the code without the generator changing.
- **The declared receipt tuple is read out of the function by AST**, so `RECEIPT_BOUND_FIELDS` cannot claim a set the
  function does not digest — and the function refuses `RECEIPT_BINDING_DRIFT` if it ever does.
- **Slot-level, not document-level.** Ten authorizing slots and four diagnostic slots are enumerated by exact
  artifact key path and each is checked for what it names.
- **Exact-set negatives.** Removing any one of the ten receipt fields fails; the exact v1.15 seven-field list fails
  naming precisely the three omissions; five plausible over-claims fail; 24 seeded permutations fail.
- **A consumer's recomputation is tested.** Digesting the published field list, in the published order, under the
  published domain is asserted to produce the authority's own receipt value — the operational point of the fix.
- **Runtime lookup proved, not assumed.** No `getattr` on the module, no `eval`/`exec`/`importlib`, and the single
  `globals()[...]` in the bundle is `parser_sha256()` over the frozen module constant `PARSER_FUNCTION_NAMES` — a
  digest computation, not an authority selection.

## Preserved and re-run

**No runtime law changed.** The v1.15 consumed-evidence byte binding, the immutable carrier and snapshot law,
governed root enforcement, the diagnostic/authorizing API separation, the transaction/commit provenance gate, the
`WORKFLOW.json` no-follow/file-type law and malformed-carrier handling; all of v1.13's root law and v1.12's workflow;
Store.v5 (`evidence_store.py` differs from v1.15 by **one comment line**), cache, the schema-registry architecture,
validator-injection protection, the trusted shim, strict ingestion, the exact stored chain, receiver identity, H0,
the commit stage laws, precedence, the capability matrix and M0B/M0C/M0D.

## What is still not closed

- **The authorizing transaction path still has no positive control** — no production path authors M3 write evidence.
  Unchanged from v1.15, restated here, not closed by this correction.
- Documentation cannot be made self-enforcing; what v1.16 changes is that every current classification statement is
  compared, exhaustively and by machine, against one generated source of truth.
- An actor with write access to governed evidence, this bundle's code, or the running interpreter remains outside the
  threat boundary (`THREAT-MODEL.md`).
- `SCHEMA-VALID != AUTHORIZED TO MUTATE`. No probe has run and no Resolve was contacted.
