# FINDING RESOLUTION MATRIX — Codex's sole v1.16 finding answered in v1.17

Machine form: `FINDING-RESOLUTION-MATRIX-v1.17.json`. `validate_v1_17.py` reads it, requires exactly the one id
below, and fails unless every validation section it names exists and passes. Earlier matrices — including
`FINDING-RESOLUTION-MATRIX-v1.16.json` — are retained unchanged as history and re-run as v1.17 regressions.

Input of record: Codex's v1.16 forensic adjudication — intake PASS, supplied suite PASS, receipt parity PASS, v1.15
functional regressions **57/57**, independent assertions **84/85**, **1 BLOCKER**, **0 merge majors**, **0 minors**,
MERGE BLOCKED, A1 authority-ready NO. The candidate remained clean and unmodified.

| id | severity | defect (exact key path) | v1.17 correction | negative fixture | expected failure layer |
|---|---|---|---|---|---|
| V116-B1 | BLOCKER | `EVIDENCE-SET-WORKFLOW.json:254`, key `toctou.law`: *"…the bundle's binding no longer resolves, and `derive_attachment_state` refuses."* A **current normative law** designating the DIAGNOSTIC core as the refusing authority, with no diagnostic marking. That key path was **absent from the hand-written ten-slot** authorizing inventory. And the v1.16 scanner **suppressed** it because its marker list contained the bare phrase `no longer` — which here modifies *the binding*, not the function's class — while commas were not clause delimiters, so `and derive_attachment_state refuses` (DIAGNOSTIC / NON_AUTHORIZING) was never isolated. | (1) the law names `derive_attachment_state_authorizing` (session wrapper equivalent) and marks the bare function DIAGNOSTIC / NON_AUTHORIZING in its own clause, with **TOCTOU semantics unchanged**; (2) the hand-written slot dictionaries are **removed** in favour of a frozen **semantic slot-discovery law**, with the inventory **generated** into `AUTHORITY-SLOT-INVENTORY.json` by `tools/authority_slots.py` — **32 slots across 54 current artifacts** where v1.16 listed ten; (3) the scanner is rebuilt: comma- and paren-aware clause splitting that never cuts a dotted reference, wrapped prose rejoined into logical lines, per-reference roles read only from the reference's own clause with published signal precedence, **no bare negation in any token list**, six reference forms normalised to one canonical `(module, name)`, module awareness, and an artifact scope **derived from precedence status + published document role** rather than a filename pattern | `b1-toctou`, `slot-discovery`, `scanner-negation`, `unknown-slot`, `v117-property`, `v117-runtime-parity`, `v117-static` | active authority publication (authority designation and slot discovery) |

## How the correction is proved, not asserted

- **The reproduction has four parts**, all against the frozen v1.16 bundle: the exact stale value; the ten-slot
  inventory without that key; **the suppression mechanism proved from the v1.16 validator's own source** (its marker
  list literally contains `"no longer"`, and it splits clauses only at `. ` and `; `); and the demonstration that
  comma-aware splitting isolates the offending clause at once.
- **The exact v1.16 sentence is a pinned failing case.** It must classify as
  `DEMOTED_FUNCTION_DESIGNATED_AUTHORITATIVE`, with the isolated clause named in the failure detail.
- **Five unfamiliar key names** — `decision_handler`, `refusal_owner`, `state_engine`, `gatekeeper`, `who_decides` —
  naming the diagnostic function as deciding authority are all detected. The same keys naming the **authorizing**
  function are accepted, so the rule discriminates rather than objecting to unfamiliar keys.
- **Negation binds locally**: "X is no longer authoritative; Y is authoritative" classifies both correctly, and the
  adversarial "X is no longer diagnostic; X is authoritative" is caught.
- **48 + 16 seeded property cases** over demoted/authorizing functions × six reference formats × eight key names ×
  six authority verbs × three negation prefixes × optional class marking: no false negative and no false positive,
  and historical statements are not flagged while the same sentence without a historical marker is.
- **Runtime parity is asserted, not asserted-away**: three runtime files byte-identical to v1.16,
  `evidence_store.py` one comment line, and every changed line in `authority_lib.py` shown to be a version pin, a
  lineage pin or a tool-name reference.

## Three further stale statements the new engine found

Codex named one; the exhaustive derived scan found three more, all corrected:

- `SNAPSHOT-CONCURRENCY-RECOVERY.md:17` — "a commit is decided **solely** by `commit_eligibility` (PROVISIONAL_UNTIL_M3 non-authorizing) →
  `validate_transaction_set`" (PROVISIONAL_UNTIL_M3 non-authorizing): a current designation of the **provisional-until-M3** pair. Same class as V116-B1.
- `CAPABILITIES.json` and `READ-PRIMITIVES.json` — the **retired** `CAPABILITY_EVIDENCE` record type still described
  as the qualification mechanism; replaced by the chain `RAW_CAPABILITY_CAPTURE → DERIVED_CAPABILITY_RESULT →
  REVIEW_DECISION → REFREEZE_RECORD`. These surfaced because v1.17 registers **every** artifact in precedence, which
  brought them into the retired-term scan for the first time.

**Zero violations** now stand across all 54 current artifacts and 258 classified references.

## Preserved and re-run

**No runtime semantics changed.** The governed evidence byte binding, the `GovernedEvidenceSet` snapshot law, the
authorizing/diagnostic split, the authorizing transaction and commit path, the governed root law, `WORKFLOW.json`
no-follow, malformed-carrier handling, the PREPARER/VERIFIER/APPROVER roles, A2V, the `OPEN → PREPARED → VERIFIED`
lifecycle, the record constructors, BUNDLE semantics, the checked-file law, TOCTOU **runtime** enforcement, locking,
Store.v5 (`evidence_store.py` differs by **one comment line**), cache, the schema-registry architecture, the trusted
shim, raw ingestion, the exact stored chain, H0, the commit stage architecture, the capability matrix and
M0B/M0C/M0D. The V115-M1 receipt parity is untouched: ten runtime-bound fields, published identically, domain
unchanged.

## What is still not closed

- **The authorizing transaction path still has no positive control** — no production path authors M3 write evidence.
  Unchanged since v1.15 and restated here, not closed by this correction.
- A designation phrased with a verb outside the frozen token list would be recorded as a `MENTION`. The token list,
  the clause law, the signal precedence and the accepted reference forms are all published in
  `AUTHORITY-FUNCTION-CLASSES.json#slot_discovery_law` so a reviewer can attack them directly.
- A document mis-registered as `GENERATED_EVIDENCE` would escape the function-designation scan; every artifact's
  status and role is in `AUTHORITY-PRECEDENCE.json` for review.
- `SCHEMA-VALID != AUTHORIZED TO MUTATE`. No probe has run and no Resolve was contacted.
