# LINEAGE.md — how v1.20 came to be (FROZEN_NOW)

```
1.18.0  5d9dbba7  manifest 80b108e4…  HISTORICAL — REJECTED (V118-M1..M4, N1..N3; independently re-verified 2026-09-20)
   ↓
1.19.0  5efbcae6  manifest 06811f07…  HISTORICAL — ACCEPTED after independent review 2026-09-20 (manifest b9247a55…);
                                       Mikko's acceptance recorded in docs/resolve-integration/adjudications/2026-09-20-v1.19-acceptance/
   ↓
1.20.0  (this bundle)                  = accepted v1.19 authority + accepted Resolve Control Plane Phase 1 (77c26103) + settlement
                                        of the bounded P3 items; implementation-author candidate; independent review required
```

Two successor lines had forked from v1.18: the v1.19 repair candidate (Codex, 2026-09-10) and the Phase 1 control-plane chain
(b8be09ff → 91bf571e → 77c26103 → 10e8e398, 2026-09-20). The fork was resolved by independently reviewing v1.19 first, then
layering Phase 1 on top. The Phase 1 commits were transferred onto this freeze branch with `git cherry-pick -x`
(provenance lines name the originals); `resolve-control/**` is byte-identical to `77c26103` (PHASE1-SOURCE-PIN.json).
Nothing in v1.18 or v1.19 was modified.

The first v1.20 candidate commit, `e65ed5a4` (manifest `2f58bc3b…`), was independently reviewed on 2026-09-21 and REJECTED —
REPAIR REQUIRED for three P2 bundle-construction defects (F-120-01 parent-pin byte count, F-120-02 manifest rule bound to
1.19.0, F-120-03 stale inherited v1.19 matrix; review manifest `740c656d…`). This bundle is its narrow repair at the same
authority version 1.20.0, authored on top of `e65ed5a4`, which stays in branch history as the rejected candidate. The repair
changed generator and validator tooling, the generated records they emit and this bundle's own prose only: v1.18, v1.19,
`resolve-control/**`, the Phase 1 qualification evidence and Mikko's recorded v1.19 acceptance are unchanged.
