# Human acceptance — Hermes Resolve read-only integration candidate `8e068fea` accepted (2026-09-22)

Recorded from Mikko's written decision of 2026-09-22, in the class of `../2026-09-21-v1.20-freeze-acceptance/`; additive, placed
outside every frozen bundle (v1.20 manifest `29216e6b…` unchanged). Machine form `ACCEPTANCE.json`, record_id `43fc21e3abf9bfe5…`
(same derivation as the v1.20 acceptance). Substance recorded, not reinterpreted.

## Recorded acceptance (substantive)

> I accept Hermes Resolve read-only integration candidate `8e068fea2d4df5b9709c387f6444502bd7bc2091` as the approved VIDTOOLZ Hermes
> read-only Resolve integration, based on the completed independent technical review and successful live qualification of PRESTO, vidnux and VIDLAP2.

## Approved capability

> Hermes may invoke the nine reviewed read-only Resolve facade tools against an explicitly selected configured Resolve host through the
> verified Phase 1 control path, subject to the existing authority, target, library, project and timeline identity gates.

Not "Hermes controls Resolve". Not "Hermes may edit Resolve". Not "workers may run persistently".

## Accepted identity
| Item | Value |
|---|---|
| Facade | commit `8e068fea2d4df5b9709c387f6444502bd7bc2091`, tree `ba9d431673d647a155f339738f3fee32760326c2`, branch `claude/hermes-resolve-readonly-facade-20260921` (not merged, not pushed, not installed, not enabled) |
| Resolve Authority | 1.20.0, candidate `cdda151a…`, acceptance `720b2d78…`, manifest `29216e6b…` — ACCEPTED / FROZEN, unchanged |
| Phase 1 | commit `77c26103…`, tree `5e78e8f5…`, worker `371caf13…` — ACCEPTED / FROZEN SOURCE, unchanged |
| Independent final acceptance review | `~/outputs/hermes-resolve-readonly-three-host-final-acceptance-review-2026-09-22/`, manifest `24644f21…`, verdict APPROVED WITH NON-BLOCKING FOLLOW-UPS — MIKKO FINAL ACCEPTANCE REQUIRED, P0/P1/P2 = 0 |
| PRESTO | LIVE QUALIFIED — R5 manifest `cd09f4c5…`, fixture project `38609cb5-92d0-4abe-b379-2e3b16b79a6d` |
| vidnux | LIVE QUALIFIED — R6 manifest `978599c7…`, fixture project `7ac4210e-5ada-46a3-9821-831bfa83a4cc` |
| VIDLAP2 | LIVE QUALIFIED — R7 manifest `0313e5af…`, fixture project `5bd68676-f8d6-4e21-8bc5-27440a59a0c4` |
| Three-host record | `…r7-vidlap2-2026-09-22/HOST-QUALIFICATION.json`, sha256 `5db54a13…` |
| Additive governance chain | e01c7f1c, d700bc8e, 9d7d0f08, 2d66013c (HEAD before this record) |
| Hermes core | `~/.hermes/hermes-agent` @ 524041b9 (v0.21.4), facade not installed/enabled, config sha `9e1bf835…` |

## Tool surface (exactly nine; no other Resolve tool is accepted)
1. `resolve_health`
2. `resolve_identify`
3. `resolve_get_current_project`
4. `resolve_get_current_timeline`
5. `resolve_list_timelines`
6. `resolve_get_project_settings`
7. `resolve_get_timeline_settings`
8. `resolve_get_media_pool_summary`
9. `resolve_get_project_fingerprint`

## Targets
`presto`, `vidnux`, `vidlap2`. Explicit target required; no default; no fallback; no caller-controlled endpoint; no raw host/IP targeting.

## Boundaries (hard invariants)
`WRITE AUTHORITY = NONE` · `PERSISTENT WORKER AUTHORITY = NONE` · `External Scripting = Local` (Network not authorized).
Not authorized: Resolve writes, timeline edits, markers, media imports, project/timeline creation, setting mutation, render/export, persistent or
boot-time workers, services/scheduled tasks, Network scripting, generic Resolve execution, write-capability development under this acceptance.
Deployment/enablement is a separate later gate. The three qualification fixtures are evidence, not production-write authority.

## P3 carry-forward (none closed by this record)
- **P3-A** — `resolve_health` shaping omits `library_gate` diagnostic detail. Observability; enforcement below facade; non-blocking. Closure gate: before relying on enriched facade health diagnostics.
- **P3-B** — facade generation/version mapping ≠ worker `worker_generation`/`version` → null shaped diagnostics. Observability/schema; raw evidence correct; non-blocking. Closure gate: before relying on shaped worker generation/version diagnostics.
- Retained binding: F-07, F-09, R-02, R-04 (before writes); F-10, F-11 (before persistence); TOCTOU/re-verification (before expanding local trust); R-05, F-120-07 (preserve history/provenance); F-120-06; F-120-08; HFINAL-P3-01 (test-bytecode hygiene); HFINAL-P3-02 (before future protocol extensions); HACC-P3-01 (additive erratum only if republished).

## Status model after this record
Resolve Authority v1.20.0 ACCEPTED / FROZEN · Phase 1 ACCEPTED / FROZEN SOURCE · Hermes facade 8e068fea **ACCEPTED** · PRESTO, vidnux, VIDLAP2 LIVE QUALIFIED ·
Hermes production deployment NOT YET ENABLED · WRITE AUTHORITY NONE · PERSISTENT WORKER AUTHORITY NONE.
