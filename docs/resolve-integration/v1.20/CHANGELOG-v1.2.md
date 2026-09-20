# CHANGELOG — Resolve authority bundle v1.2 (versioned correction of v1.1)

- **Parent:** v1.1.0, branch `docs/resolve-authority-freeze-v1.1` @ `47ddb225335b8c85ca5255b1de86ff508e0e8e91`, manifest `83d8a307098cdc18931f6f09de2ce782afa0bdef94ec8540c2a143910cd448c5`. Grandparent v1.0.0 @ `e2874f6f67f5adb3a5ced0e0e138c370e38995cb`, manifest `d9cd54780e0a123ae2045ac575bbc41638039ef3e878f1b608afbce3989a8821`. Neither is modified.
- **This version:** 1.2.0, directory `docs/resolve-integration/v1.2/`, own `FREEZE-MANIFEST.json` (schema `resolveFreezeManifest.v1.2`, validated by the suite).
- **Rationale:** six Codex MAJOR findings affecting M0/M1 eligibility (permission vs eligibility; read-primitive mapping; snapshot completeness; marker canonicalization; QUALIFIED_READ evidence granularity; authority precedence; semantic validators) plus the enumerated MINOR/consistency items in Mikko's v1.2 mission.
- **Inputs:** Mikko's v1.2 mission text (enumerating the Codex findings), v1.1 bundle, estate evidence re-checked read-only (Scorecraft guard locations; recorded Resolve API evidence and versions).

## Changed / new authorities
`TARGET-CONTRACT.json` (+schema: attachment states, evidence, required future observations); `PERMISSIONS.json` (+schema: prerequisites per entry, `target_contract_ref`, logical read ops, probe op); `READ-PRIMITIVES.json` (+schema, new); `CAPABILITIES.json` (+schema: evidence records; all read rows downgraded; identity readability vs survival split); `schemas/resolveSnapshot.schema.json` (profiles, field statuses, ordinal, duration_convention, nullable ids); `schemas/resolveGuard.schema.json`; `schemas/provisional/resolveMutationPlan|resolveTransactionJournal|resolveCommitManifest`; `schemas/resolveFreezeManifest.schema.json` (new); `MILESTONE-MATRIX.json`, `M3-PROBES.json`, `AUTHORITY-PRECEDENCE.json/.md`, `ELIGIBILITY.md`, `TARGET-ATTACHMENT-GATE.md`, `SNAPSHOT-COMPLETENESS.md` (new); `CANONICALIZATION.md`, `M3-MATRIX.md`, `MILESTONES.md`, `SCORECRAFT-EXTRACTION.md`, `SEMANTIC-VALIDATION.md`, `SNAPSHOT-CONCURRENCY-RECOVERY.md`, `GUARD-AUTHORITY.md`, `PROVISIONAL.md`, `README.md`; tools `authority_lib.py`, `build_v1_2.py`, `validate_v1_2.py`, `build_manifest.py`; all fixtures regenerated under `fixtures/layered`, `fixtures/eligibility`, `fixtures/canonicalization`, `fixtures/parse`, `fixtures/snapshot`, `fixtures/guard`, `fixtures/timebase`.

## Inherited unchanged
`AUTHORIZATION-2026-09-08.md`, `DOCTRINE.md`, `TRANSPORT.md`, `DRIFT-POLICY.md`, `REVIEW-MARKER-POLICY.md`, `IDENTITY-BINDING.md`, `CANARIES.md`, `CLIENT-VERSION-INVENTORY.md`, `TIMEBASE.json` (+schema), `CANARY-SOURCE-MANIFEST.json` (+schema), `schemas/resolveTrackPolicy.*`, `QUARANTINE-MANIFEST.json`, `fixtures/timebase/canary-boundaries.json`, unchanged provisional schemas, historical inputs (`ADJUDICATION-FREEZE-CONTRACT.md`, `AUTHORITY-ARCHITECTURE-ADJUDICATION-M0-M3.md`, `CHANGELOG-v1.1.md`, `FINDING-RESOLUTION-MATRIX.md`).

## Removed relative to v1.1
`tools/build_v1_1.py`, `tools/validate_v1_1.py` (replaced); `fixtures/schema/*`, `fixtures/semantic/*`, `fixtures/permissions/*` (replaced by layered fixtures); `VALIDATION-REPORT.md` regenerated.

## Mutation prohibition preserved
No Resolve launched or mutated; no EKA; no M0 begun; no adapter implementation; mutation schemas remain PROVISIONAL_UNTIL_M3; `PERMISSIONS.json` grants `mutation_allowed` only at M3 with `MIKKO_M3_AUTHORIZATION` and `TARGET_STATE_SCRATCH_WRITE_READY`.
