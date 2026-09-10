# CHANGELOG — Resolve authority bundle v1.17 (extremely narrow correction of Codex's sole v1.16 finding)

- **Parent:** v1.16.0, branch `docs/resolve-authority-freeze-v1.16` @ `a03923cd4b09e8e11d40e8cf13819f8df763063a`, manifest `ba77bfa2226696b61be27f2a7c74cf551720f601f57b8c11c9f2f6f50a159507`. Grandparent v1.15.0 @ `459bd29e358574896f0cf69f4b0bfb347bf2902d`, manifest `af2c1b11485233f5c2b6b5447a6695a3b6cbe6ba4cbdb06f3727973f4b2c9fe2`.
- **This version:** 1.17.0, directory `docs/resolve-integration/v1.17/`, own `FREEZE-MANIFEST.json`.
- **Input of record:** Codex's v1.16 forensic adjudication — intake PASS, supplied suite PASS, receipt parity PASS, v1.15 functional regressions **57/57**, independent assertions **84/85**, **1 BLOCKER (`V116-B1`)**, 0 merge majors, 0 minors, merge BLOCKED, A1 authority-ready NO.
- **Scope discipline:** that one finding and its direct documentation/validation/versioning consequences. **No runtime semantics changed.** `tools/evidence_authoring.py`, `tools/a2_prepare.py` and `tools/a2_verify.py` are **byte-identical** to v1.16; `tools/evidence_store.py` differs by one comment line; every changed line in `tools/authority_lib.py` is a version pin, a lineage pin or a tool-name reference. No Resolve launched or contacted; no `EKA`; no A1/A2/A2V/A3; no merge; v1.0–v1.16 bytes untouched.

## V116-B1 — the eleventh slot, and the phrase that hid it

`EVIDENCE-SET-WORKFLOW.json:254`, key `toctou.law`, said:

> "…so editing a verified preparer record changes its id, the bundle's binding **no longer** resolves, and
> `derive_attachment_state` (DIAGNOSTIC / NON_AUTHORIZING) refuses."

Three defects in one sentence, all reproduced against frozen v1.16 before anything was changed:

1. **A current normative law designated the diagnostic core as the refusing authority.** `derive_attachment_state`
   is `diagnostic_non_authorizing`; the authorizing refusal is `derive_attachment_state_authorizing`. A machine
   consumer following this law would select the non-authorizing function for an authorizing TOCTOU decision.
2. **That key path was absent from the canonical authorizing-slot inventory** — which v1.16 published as a
   **hand-written list of ten**. A hand-written inventory cannot notice a slot nobody listed. (v1.16's own report
   disclosed this as a residual and invited exactly this finding.)
3. **The v1.16 scanner suppressed the violation.** Its marker list contained the bare phrase `no longer`, and the
   sentence contains it — attached to *the bundle's binding*, not to the function's authority class. Commas were not
   clause delimiters, so `and derive_attachment_state refuses` (DIAGNOSTIC / NON_AUTHORIZING) was never isolated. **A test that reads a phrase
   instead of a claim will eventually read the wrong claim.**

## The correction, in three parts

**1. The TOCTOU law names the authorizing function.** TOCTOU semantics are untouched — the same record-id/content-digest
law, the same two additional seals, the same runtime enforcement. Only the designated function changed:

> "…changes its id and the bundle's binding no longer resolves. The AUTHORIZING refusal is
> `tools/authority_lib.py#derive_attachment_state_authorizing` (equivalently `#derive_attachment_state_for_session`,
> which loads through `#load_governed_evidence_set`), which refuses such an evidence set. The bare-evidence
> `tools/authority_lib.py#derive_attachment_state` is DIAGNOSTIC / NON_AUTHORIZING and applies the same semantic rule
> for fixtures and diagnosis only."

**2. Slots are discovered, not listed.** The hand-written `authorizing_slots` and `diagnostic_slots` dictionaries are
**gone** from `AUTHORITY-FUNCTION-CLASSES.json`. In their place is a frozen **slot-discovery law**:

> A slot is AUTHORIZING if its value or text designates a function as authoritative, deciding, refusing, enforcing,
> deriving current authority state, gating eligibility or commit, or validating — **whatever its key is called**.

The inventory itself is **generated** into the new `AUTHORITY-SLOT-INVENTORY.json` by `validate_v1_17.py` through the
new tooling module `tools/authority_slots.py`, from the current artifacts themselves: one row per reference, with
artifact, key path or line, referenced function, authority role, canonical class and current/historical status. The
discovered count is **32 authorizing slots across 54 current artifacts** — where v1.16 hand-listed ten.

**3. The scanner is rebuilt.** Two frozen laws, both fail-closed:

- **R1** every reference to a demoted function in a current artifact carries an explicit class token **in its own clause**;
- **R2** every clause that designates authority names a function whose canonical class is `authorizing`.

and the mechanism underneath them:

| mechanism | v1.16 | v1.17 |
|---|---|---|
| clause boundaries | `.` and `;` followed by a space | `.` `;` `:` `,` and newline, at parenthesis depth zero, **only before whitespace** — so an argument list, a dotted module path and a version number stay intact |
| wrapped prose | scanned per physical line | rejoined into **logical lines** first, so line-wrap position cannot change a classification |
| negation | a list of ~25 phrases including bare `no longer` | **no bare negation in any token list**; a claim is read only from the reference's own clause, so "X is no longer authoritative; Y is authoritative" classifies X and Y separately |
| signal precedence | one substring test | published: explicit class/history token in the clause → structured key path → that clause's authority verbs |
| reference forms | bare and `#`-anchored only | six forms — bare, backticked, module-qualified, anchor, path-qualified, call — normalised to one canonical `(module, name)` |
| module awareness | none (names conflated) | a same-named function in another module is a **different symbol**: `evidence_authoring.derive_attachment_state` is the authorizing wrapper, never judged against the `authority_lib` class map |
| artifact scope | filename patterns (`CHANGELOG-v1.*`, `VALIDATION-REPORT.md`) | **derived from precedence**: every artifact registered with a STATUS and a published ROLE — `NORMATIVE_AUTHORITY`, `CORRECTION_RECORD`, `GENERATED_EVIDENCE`, `HISTORICAL_INPUT` |

## Three further stale statements the new engine found

Running it exhaustively over every current artifact surfaced three contradictions Codex had not named, all corrected:

- `SNAPSHOT-CONCURRENCY-RECOVERY.md:17` — "a commit is decided **solely** by `commit_eligibility` (PROVISIONAL_UNTIL_M3 non-authorizing) →
  `validate_transaction_set`" (PROVISIONAL_UNTIL_M3 non-authorizing): a **current designation of the provisional-until-M3 pair** as the deciding authority.
  Same defect class as V116-B1.
- `CAPABILITIES.json` and `READ-PRIMITIVES.json` — still described qualification as requiring "a matching
  `CAPABILITY_EVIDENCE` record", the **record type v1.7 retired**. Now the chain `RAW_CAPABILITY_CAPTURE →
  DERIVED_CAPABILITY_RESULT → REVIEW_DECISION → REFREEZE_RECORD`. (These surfaced because v1.17 registers *every*
  artifact in precedence, which brought them into the retired-term scan for the first time.)

Zero violations now stand across all 54 current artifacts and 258 classified references.

## The adversarial regressions, frozen

- **The exact v1.16 sentence** fails classification, as `DEMOTED_FUNCTION_DESIGNATED_AUTHORITATIVE`, with the
  isolated clause `and derive_attachment_state refuses` (DIAGNOSTIC / NON_AUTHORIZING) named in the failure.
- **Five unfamiliar key names** — `decision_handler`, `refusal_owner`, `state_engine`, `gatekeeper`, `who_decides` —
  naming the diagnostic function as deciding authority are all detected; the same keys naming the authorizing
  function are accepted, so the rule discriminates rather than objecting to unfamiliar keys.
- **Negation**: "X is no longer authoritative; Y is authoritative" classifies both correctly, and the adversarial
  "X is no longer diagnostic; X is authoritative" is caught.
- **Mixed clause**: a diagnostic declaration and an authorizing designation in one sentence classify separately.
- **48 + 16 seeded property cases** over demoted/authorizing functions × six reference formats × eight key names ×
  six authority verbs × three negation prefixes × optional class marking: no false negative, no false positive, and
  historical statements are not flagged while the same sentence without a historical marker is.
- **The v1.16 suppression mechanism is proved from the frozen v1.16 validator source**: its marker list literally
  contained `"no longer"`, and it split clauses only at `. ` and `; `.

## Version decisions

| identifier | decision | why |
|---|---|---|
| `AUTHORITY_VERSION` 1.16.0 → **1.17.0** | bumped | the bundle version |
| `tools/authority_slots.py` | **new** tooling, `INTERNAL_NON_AUTHORIZING` | the discovery/classification engine; not runtime, not authority |
| `AUTHORITY-SLOT-INVENTORY.json` | **new**, `vidtoolz.resolveAuthoritySlotInventory.v1` | the generated inventory (mission §18) |
| `AUTHORITY-FUNCTION-CLASSES.json` | hand-written slot dicts **removed**, `slot_discovery_law` added | the inventory is derived; only the law is frozen here |
| `EVIDENCE-SET-WORKFLOW.json#toctou.law` | text corrected | the finding; TOCTOU semantics unchanged |
| `AUTHORITY-PRECEDENCE.json` | `role` per document, `document_role_law`, `retired_term_exempt_law`, S64 | the scan scope is machine-derived (mission §16/§17) |
| runtime schemas, `resolveEvidenceSet`, `RECORD_TYPE_VERSION`, Store.v5, `HASH_DOMAINS`, `LOCATION_ERRORS`, `AUTHORITY_SURFACE`, the receipt domain and its ten fields | **NOT bumped** | no accepted instance and no runtime law changed |

## What this does not do

Nothing here authorizes a run, and nothing here changes what the authority does — only which function its documents
name, how slots are found, and how a reference is classified. `SCHEMA-VALID != AUTHORIZED TO MUTATE`. The v1.15
residual stands and is not closed here: the authorizing transaction path has no positive control because no
production path authors M3 write evidence. A2 and A2V each still require Mikko's own explicit approval. v1.17 is a
CANDIDATE for independent review.
