# DRIFT-POLICY.md — reconciliation law (v1.1, FROZEN_NOW as doctrine; conflict schema PROVISIONAL_UNTIL_M3)

Corrects the v1.0 BLOCKER (adjudication finding B1): under v1.0 the drift policy `IMPORT_OVERRIDE` and the `STALE_ASSET` definition allowed a Resolve observation to become Episode Factory truth or to select Episode Factory's current handoff.

## Law
1. **A Resolve observation can never directly become Episode Factory truth.** The only path is: Resolve observation → `PROPOSE_REVIEW_NOTE` → an *unsubmitted, non-authoritative* `vidtoolz.draftReview.v2` proposal → human / Episode Factory adjudication (reviewer submits through `draft-review-intake.js`, or rejects) → possible future canonical update by the canonical revision authority. The former policy name `IMPORT_OVERRIDE` is retired; `resolveConflict.policy` is `PRESERVE | PROPOSE_REVIEW_NOTE | REQUEST_RECONCILIATION | STOP`, and every conflict record carries `authority_effect: NONE_UNTIL_HUMAN_ADJUDICATION`.
2. **`STALE_ASSET` is evaluated against the Episode Factory canonical head**: the binding revision derived from the head handoff that Episode Factory declares current. An observed source sha that differs from the head's expectation is `STALE_ASSET` (or `UNOWNED_CONTENT` if the sha is not an ACCEPTED asset at all). Whether some "newer handoff" exists is never inferred from Resolve.
3. **`MISSING_ASSET`** (offline/missing source) never triggers automatic relink; it is reported. Repair requires an explicit plan naming the exact observed cause and current EF authority (M10 doctrine).
4. **`POSITION_DRIFT`, `DURATION_DRIFT`, `UNKNOWN_TIMELINE_ITEM`, changed enable state outside an agent session** → `PRESERVE` (human by default) + `REQUEST_RECONCILIATION`. Never repaired automatically.
5. **Session ownership** is the only distinction between agent and human change: the adapter's own COMMITTED post-snapshot guard is the baseline; any later difference is human until adjudicated.
6. A conflict or drift record is never permission to mutate.
