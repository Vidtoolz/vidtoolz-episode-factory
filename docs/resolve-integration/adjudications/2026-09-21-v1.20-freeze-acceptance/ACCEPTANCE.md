# Human acceptance — Resolve Authority v1.20.0 candidate `cdda151a` accepted and frozen as the current Resolve authority (2026-09-21)

Recorded from Mikko's written decision of 2026-09-21, in the class of `v1/AUTHORIZATION-2026-09-08.md` and the
2026-09-20 v1.19 acceptance; placed outside every frozen bundle. Substance recorded, not reinterpreted.

## Decision chain

1. **v1.19 acceptance (2026-09-20)** — Mikko accepted v1.19.0 `5efbcae6` as the authoritative successor to v1.18 and
   the parent of a v1.20.0 candidate. Recorded in `../2026-09-20-v1.19-acceptance/`.
2. **Three independent reviews of v1.20.** `e65ed5a4` was rejected on three P2 generator defects. `06b204f7` was
   rejected on two P2 blockers, F-120-04 foreign-evidence deletion still reachable in the full validator and F-120-10
   a permitted cold start changing the frozen required-check set. Each rejection was repaired by a new candidate and
   re-reviewed; no candidate history was amended.
3. **Final independent review of `cdda151a`** — `~/outputs/resolve-authority-v1.20-cdda151a-independent-review-2026-09-21/`,
   manifest `a0d323cb8a40612eeae193c3c769ebb38e2bfa06ac8b105377659662101decac`:
   **FREEZE TECHNICALLY APPROVED — MIKKO FINAL ACCEPTANCE REQUIRED**. F-120-04, F-120-09 and F-120-10 CLOSED;
   T04-A through T04-F pass together with two concurrent full validators; validator 3147/3147, fail 0, warnings 0;
   P0 0, P1 0, P2 0, P3 11 bounded follow-ups.
4. **Mikko final freeze acceptance (this record).**

## Recorded acceptance (substantive)

> I accept Resolve Authority v1.20.0 candidate `cdda151ac3101f98e0cca678e522d6e19f528086`, bundle manifest
> `29216e6bd6024a8e4e35b0e77ac2aa7fbba8fa34c2a222b9145f93bb81cfedfb`, following its successful independent final
> review, as the frozen authoritative Resolve integration authority v1.20.0.

The acceptance is limited to the capabilities actually reviewed and qualified.

## What this acceptance explicitly preserves

`WRITE AUTHORITY = NONE`. `HERMES FACADE = ABSENT`. No automated Resolve writes. No persistent worker authorization.
Resolve External Scripting remains Local. No native remote Resolve scripting as the production control path. All
eleven remaining P3 closure gates remain binding and none is closed by this freeze.

## What this acceptance does not authorize

Hermes integration. Resolve write capability. Persistent worker deployment. Concurrent automated mutation. Any
capability not included in the reviewed v1.20 authority. The frozen authority is a bounded one: VIDTOOLZ has a
qualified, read-only, explicitly targeted Resolve control substrate. It does not mean Hermes can edit Resolve.

## Frozen bytes are not modified by this record

This record is additive and references the reviewed immutable candidate bytes, which is the convention every
acceptance in this repository has followed. Two consequences are recorded here rather than silently absorbed.

`docs/resolve-integration/v1.20/FREEZE-MANIFEST.json` continues to read `approval_status =
CANDIDATE_FOR_INDEPENDENT_REVIEW` and `approver = null`, exactly as v1.19's manifest still does after its own
acceptance. The schema admits `APPROVED`, but no bundle in the lineage has ever carried it, `tools/build_manifest.py`
emits `CANDIDATE_FOR_INDEPENDENT_REVIEW` unconditionally, and a hand-set value would therefore be reverted by the
sanctioned regeneration path, destroying the byte-stability the independent review just certified. Acceptance lives
here, in the adjudication record, and is bound to the candidate by commit and manifest digest.

`docs/DOC-AUTHORITY.md` still describes v1.20 as an implementation-author candidate awaiting independent review.
That file is pinned by digest and byte count in the reviewed manifest (`external_pins.doc_authority`,
`c88b1c012819e478f14fe178b2a48281fcfe7332f9c18fcfd3997247ac44bb09`, 15407 bytes), so editing it now would make the
frozen authority fail its own external-pin validation. The lineage row is corrected when the next bundle is
constructed, which is exactly how v1.19's row became "HISTORICAL — ACCEPTED … SUPERSEDED" during v1.20 construction,
and how v1.7's pin still records the file's pre-registration digest.

## Lineage

```text
v1.18   HISTORICAL — REJECTED
  ↓
v1.19   HISTORICAL — ACCEPTED / SUPERSEDED
  ↓
v1.20   CURRENT — ACCEPTED / FROZEN
```

## Bound identities

| Item | Value |
|---|---|
| Accepted object | `cdda151a` / `29216e6b…` / `docs/resolve-integration/v1.20/` |
| Predecessor | v1.19 `5efbcae6` / `06811f07…` (HISTORICAL — ACCEPTED; SUPERSEDED) |
| Basis | independent review manifest `a0d323cb…` (FREEZE TECHNICALLY APPROVED) |
| Phase 1 source pin | `77c26103` / tree `5e78e8f5…` / worker `371caf13…` |
| Decision | ACCEPT / FREEZE, scope = reviewed read-only Resolve authority |
| Decided by | Mikko · Recorded by Claude Code, 2026-09-21 |

Mikko may void this record by a later written decision.
