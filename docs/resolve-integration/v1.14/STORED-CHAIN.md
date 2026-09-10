# STORED-CHAIN.md — the exact artifacts a promotion rests on (v1.7, FROZEN_NOW)

Correction of Codex v1.6 BLOCKER **C16-B4**: *derived, review and refreeze substitutions can authorize because the
exact stored chain is not always resolved and compared.*

## What went wrong in v1.6

v1.6 recomputed the derived result from the raw capture and compared digests. That closes forgery of the *value* but
not substitution of the *artifact*. Three gaps remained:

- If the chain claimed a `DERIVED_CAPABILITY_RESULT` and the evidence set did not contain it, qualification proceeded
  on the recomputation alone. A downstream review referencing that missing artifact was still honoured.
- A stored derived result belonging to a different raw capture could satisfy the digest comparison if it happened to
  recompute the same way.
- When more than one review or more than one reviewed refreeze record matched, selection was implicit. Whichever the
  iteration happened to yield first became the decision.

## The v1.7 law

`resolve_stored_chain(entry, method, caps, rp, es, env, active)` resolves the exact stored artifacts one promoted
matrix evidence entry names, by digest, and refuses every substitution.

| link | what must resolve |
|---|---|
| RAW | exactly one `RAW_CAPABILITY_CAPTURE` under `raw_capture_sha256`: well formed, trusted-shim produced, carrying a strict-parse receipt, and belonging to the entry's probe id, session id and method |
| DERIVED | `derived_result_sha256` **and** `derived_record_sha256` must resolve to the same single stored `DERIVED_CAPABILITY_RESULT`, which belongs to that raw capture, is bound to the active parser and primitive spec, and is byte-equal to the recomputation |
| REVIEW | exactly one CURRENT `REVIEW_DECISION` under `review_decision_sha256`, referencing exactly that stored derived digest and that raw digest, deciding ACCEPT, by a reviewer who is not the operator |
| REFREEZE | exactly one CURRENT reviewed `REFREEZE_RECORD` promoting exactly that raw, derived, review and probe id, naming the active capability matrix, bound to the active authority, parser and spec |
| BINDING | the entry itself binds every one of those plus the refreeze block digest, the trusted shim identity, the parser, the primitive spec, the session and the contract host, product, version and build |

1. **A missing derived artifact is never replaced.** If the chain claims one and the evidence set does not hold it,
   the refusal is `DERIVED_ARTIFACT_MISSING`. A fresh recomputation is not a substitute for the artifact the review
   was written about.
2. **A derived artifact of another raw capture is never accepted.** `DERIVED_ARTIFACT_SUBSTITUTED`, even when both
   recompute to SUCCESS.
3. **Review A cannot serve derived B.** The review must reference the exact stored derived digest, not merely a digest
   that recomputes the same way.
4. **Multiplicity is a CONFLICT, not a choice.** `supersession_resolve` resolves candidates deterministically:

   | candidates | result |
   |---|---|
   | none | `<LINK>_NONE` |
   | exactly one non-superseded | that record is CURRENT |
   | more than one non-superseded | `<LINK>_CONFLICT` |
   | all superseded (a cycle) | `<LINK>_CONFLICT` |

   The only way one record retires another is by naming its record id in `supersedes`. Insertion order, array order,
   map order and record age never decide anything. There is no first-wins and no last-wins.
5. **A conflicting review of the same raw capture is a conflict too.** A second current review that references a
   different derived digest for the same capture is `REVIEW_CONFLICT` and must be resolved by explicit supersession
   before anything can qualify.
6. **The refreeze block is bound, not the refreeze record id.** A matrix row cannot name the refreeze record's id
   without a digest cycle, because that record's id depends on the matrix digest, which depends on the rows. The row
   therefore binds `refreeze_block_sha256`, the digest of the matrix's own refreeze block, which is a sibling of the
   rows and carries the promoted probe, raw, derived and review digests. The refreeze *record* is resolved by
   supersession and must match that block.

## What this does not claim

Resolving a chain proves that the artifacts a promotion names exist, belong together and recompute. It does not prove
that the capture reflects reality, that a human reviewed it carefully, or that the primitive works. Those remain M0B
and M0C questions, and M0 has not begun.
