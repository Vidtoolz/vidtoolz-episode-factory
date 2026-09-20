# FINDING RESOLUTION MATRIX — the v1.11 pre-M0A workflow gap answered in v1.12

Machine form: `FINDING-RESOLUTION-MATRIX-v1.12.json`. `validate_v1_12.py` reads it, requires exactly the four ids
below, and fails unless every validation section they name exists and passes. Earlier matrices — including
`FINDING-RESOLUTION-MATRIX-v1.11.json` — are retained unchanged as history and re-run as v1.12 regressions.

Input of record: the architectural adjudication of the failed A2 repair. **`AUTHORITY_UNDERSPECIFIED`** — derivation
correctness and record-form specification were both COMPLETE and demonstrated; the failure was operational authority
completeness, and fixture/runtime parity was false.

| id | severity | gap | v1.12 correction | negative fixture | expected failure layer |
|---|---|---|---|---|---|
| V112-1 | BLOCKER | no governed persistence location for the evidence-set document | one topology under `QUALIFICATION_EVIDENCE_ROOT`, path derived from the session id, atomic replace, O_EXCL writer lock, self-location check, safe-basename session ids; Store.v5 deliberately not merged | `workflow-persistence`: forbidden locations, seven path-escape ids, moved document, held lock, `SET_EXISTS`/`SET_NOT_FOUND` | pre-M0A workflow (persistence) |
| V112-2 | BLOCKER | no document lifecycle sequencing preparer against verifier | `OPEN → PREPARED → VERIFIED` with `(state, role)` grants, `VERIFIED` granting nothing, two seals, and a governed staleness law | `workflow-lifecycle`, `workflow-e2e-negative`: post-PREPARED preparer writes, post-VERIFIED writes, second verification, tamper-after-verification, stale and future documents | pre-M0A workflow (lifecycle) |
| V112-3 | BLOCKER | no writer designated; independence rested on two self-declared strings | frozen role-bound principal registry with actor disjointness, frozen write grants, a single authorization choke point, derived envelopes, and a derivation that requires registered distinct-actor principals | `workflow-principals`, `workflow-e2e-negative`: seven invalid principals, preparer self-verification, verifier writing a preparer record, unregistered and same-actor principals | pre-M0A workflow (principal / permission) |
| V112-4 | BLOCKER | no production law permitted an independent verifier to author `BUNDLE_VERIFICATION`; no runtime path to `ATTACHMENT_READY` | `tools/a2_verify.py` as the one A2V path, everything derived or independently computed, an explicit `PASS`-only result, the verified record ids and the self-computed pinned-file digest set, all bound by the derivation | `workflow-e2e-positive` (mandatory runtime path), `workflow-e2e-negative` (28 cases), `workflow-parity` (production field sets identical to fixture field sets) | pre-M0A workflow (write authority / parity) |

## Deliberately not changed

Store.v5 semantics, `Boundary.v1`, `Inventory.v4`, marker cardinality, mode law, content addressing, the caches, the
schema-registry architecture, the trusted shim, strict raw ingestion, the exact stored chain, H0, commit authority,
precedence, the capability matrix, and the M0B/M0C/M0D phase design. The three record shapes keep their v1.11 fields
verbatim; `RECORD_TYPE_VERSION` stays `"1.10"`; the derivation gains one additive binding and nothing else.

## What is still not closed

- A principal is an operational label, not an authenticated identity. A human who runs both tools is still one human.
- No probe has run, no A1 evidence exists, and no Resolve was contacted by anything in this bundle.
- `SCHEMA-VALID != AUTHORIZED TO MUTATE`. Passing proves internal consistency and that the reproduced gaps are closed.
