# Human acceptance — Resolve Authority v1.19.0 candidate `5efbcae6` accepted as successor to v1.18 and parent of v1.20.0 (2026-09-20)

Recorded from Mikko's written decisions of 2026-09-20 (chat, relayed missions), in the class of `v1.18/AUTHORIZATION-2026-09-08.md`
and the 2026-09-20 scope adjudication; placed outside every frozen bundle. Substance recorded, not reinterpreted.

## Decision chain
1. **Lineage selection (mission "EXISTING v1.19.0 INDEPENDENT REVIEW + SUCCESSOR-LINEAGE ADJUDICATION")** — Mikko:
   > "Option A — independently review the existing Resolve Authority v1.19.0 candidate first. **If it is accepted, v1.19
   > becomes the authoritative parent for a new v1.20.0 bundle** incorporating the already freeze-review-approved Resolve
   > Control Plane Phase 1." — "Do NOT bypass the existing v1.19 candidate. Do NOT create another v1.19."
2. **Independent review result** — `~/outputs/resolve-authority-v1.19-independent-review-2026-09-20/` (manifest
   `b9247a558304bc40778b5ce7773cda2db82c82be91d5c717687c8b3c25dd8a13`): **ACCEPT v1.19 WITH NON-BLOCKING FOLLOW-UPS**;
   P0/P1/P2 = 0; manifest `06811f07b422d1cdf30ae6c076bae2bc0b598fc3ac464a0e180a8553a76a2848` reproduced by clean reconstruction;
   all seven v1.18 findings and repairs independently re-derived.
3. **Construction directive (mission "RESOLVE AUTHORITY v1.20.0 — v1.19 ACCEPTANCE RECORD + UNIFIED PHASE 1 AUTHORITY CANDIDATE
   CONSTRUCTION")** — Mikko directs construction of v1.20.0 "using the independently reviewed v1.19 authority candidate as its
   parent", lineage `v1.18 → v1.19 accepted authority → v1.20 candidate = v1.19 + accepted Phase 1`, and requires that this
   acceptance be recorded using the existing adjudication/authorization convention before construction.

## Recorded acceptance (substantive)
> Mikko accepts Resolve Authority v1.19.0 candidate `5efbcae6a36b76d4a359f3e65e503336576575c7` (bundle
> `docs/resolve-integration/v1.19/`, manifest `06811f07b422d1cdf30ae6c076bae2bc0b598fc3ac464a0e180a8553a76a2848`), following
> the independent review of 2026-09-20, as the authoritative successor to v1.18 (`5d9dbba7`, manifest `80b108e4…`, HISTORICAL —
> REJECTED on independently re-verified findings V118-M1…M4, N1…N3) and authorizes it to serve as the parent of the v1.20.0
> candidate.

The acceptance is constituted by decisions 1 and 3 with condition 1 satisfied by 2. It grants **no** operational, write,
Hermes or deployment authority; it selects lineage only. v1.19 bytes are not modified; v1.19's own DOC-AUTHORITY label
"CURRENT — implementation-author candidate" is superseded by the v1.20 registration ("HISTORICAL — ACCEPTED … SUPERSEDED").
Mikko may void this record by a later written decision.

| Item | Value |
|---|---|
| Accepted object | `5efbcae6` / `06811f07…` / `docs/resolve-integration/v1.19/` |
| Predecessor | v1.18 `5d9dbba7` / `80b108e4…` (HISTORICAL — REJECTED) |
| Basis | independent review manifest `b9247a55…` (ACCEPT WITH NON-BLOCKING FOLLOW-UPS) |
| Successor authorized | v1.20.0 candidate (implementation-author candidate; independent review required) |
| Decided by | Mikko · Recorded by | Claude Code, 2026-09-20 |
